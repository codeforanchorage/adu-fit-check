"""Reads one uploaded survey image with Claude and returns the tracing the page draws.

Phase 4 of ADU_FIT_CHECK_TASK.md. Runs as an AWS Lambda behind API Gateway.

What it does not do, on purpose:
  - It never stores the image. It is held in memory for one request and dropped.
  - It never logs the image, the request body, an address or the tracing itself.
    The log line holds timing, token counts and how many shapes came back.
  - It never returns the model API key or lets the page choose the model or the prompt.

The tracing is a starting point for the homeowner to check, not a result.
Results are screening only. Zoning staff make the determination.

To move from the Anthropic API to Amazon Bedrock later, change make_client() and MODEL
(Bedrock model ids take an "anthropic." prefix). Nothing else here talks to the model.
"""
import base64
import binascii
import json
import logging
import os
import time

import anthropic

log = logging.getLogger()
log.setLevel(logging.INFO)

MODEL = os.environ.get("MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("EFFORT", "medium")
# API Gateway gives up at 29 seconds and the Lambda at 28, so the model call gets less.
MODEL_TIMEOUT_S = float(os.environ.get("MODEL_TIMEOUT_S", "25"))
# The page shrinks every upload to at most 1,600 pixels a side before sending, well under this.
MAX_IMAGE_BYTES = 1_500_000
KEY_PARAM = os.environ.get("ANTHROPIC_KEY_PARAM", "")
ALLOWED_ORIGINS = {o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()}

MAGIC = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png"}

PROMPT = """This image is a residential as-built survey or plot plan for one lot. A homeowner \
will use your reading as a first tracing, which they then check and correct by hand, to see \
where an accessory dwelling unit could fit. Accuracy of the corner positions matters more than \
anything else: a corner that is a few percent off moves a lot line by several feet.

Use a coordinate system where x runs from 0 at the left edge of the image to 1000 at the right \
edge, and y runs from 0 at the top edge to 1000 at the bottom edge.

Report:
- lot: the corners of the lot boundary, in order around the boundary. Edge i runs from corner \
i to corner i+1, and the last edge runs back to corner 0.
- street_edges: every lot edge that runs along a street, with the street name printed beside \nit (an empty string if no name is printed). A corner lot has edges on two streets: list them \nall. Put the edge the house faces first. Do not list alleys here.
- alley_edges: the indexes of any lot edges that run along an alley. Empty if there are none.
- buildings: the outline of each existing structure, such as the house, garage and sheds, \
with a short label for each.
- no_build: areas that cannot be built on, such as easements, septic fields and wells, with a \
short plain label for each. Empty if none are drawn.
- scale: the two ends of one line whose length in feet is printed on the drawing, and that \
length. Prefer a lot line. If no length can be read, give feet as 0.
- zoning: the zoning district if it is printed on the drawing, otherwise an empty string.
- notes: one or two plain sentences on anything you could not read or were unsure of, for the \
homeowner. Empty if nothing.

If the image is not a survey or plot plan of a lot, return an empty lot and say so in notes."""

POINT = {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}}, "required": ["x", "y"], "additionalProperties": False}
SHAPE = {"type": "object", "properties": {"label": {"type": "string"}, "pts": {"type": "array", "items": POINT}}, "required": ["label", "pts"], "additionalProperties": False}
STREET = {"type": "object", "properties": {"edge": {"type": "integer"}, "street": {"type": "string"}}, "required": ["edge", "street"], "additionalProperties": False}
SCHEMA = {
    "type": "object",
    "properties": {
        "lot": {"type": "array", "items": POINT},
        "street_edges": {"type": "array", "items": STREET},
        "alley_edges": {"type": "array", "items": {"type": "integer"}},
        "buildings": {"type": "array", "items": SHAPE},
        "no_build": {"type": "array", "items": SHAPE},
        "scale": {"type": "object", "properties": {"p1": POINT, "p2": POINT, "feet": {"type": "number"}}, "required": ["p1", "p2", "feet"], "additionalProperties": False},
        "zoning": {"type": "string"},
        "notes": {"type": "string"},
    },
    "required": ["lot", "street_edges", "alley_edges", "buildings", "no_build", "scale", "zoning", "notes"],
    "additionalProperties": False,
}


class Problem(Exception):
    """Something to tell the page, with an HTTP status and a short code the page can act on."""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


_client = None


def make_client():
    """The model client, made once per warm Lambda. The key comes from an encrypted SSM
    parameter (or ANTHROPIC_API_KEY when run on a developer's machine); it is never in the
    code, the deployment package, the Terraform state or a log."""
    global _client
    if _client is None:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            if not KEY_PARAM:
                raise Problem(503, "not_configured", "The survey reader is not set up yet.")
            import boto3  # in the Lambda runtime; not needed for local tests

            try:
                key = boto3.client("ssm").get_parameter(Name=KEY_PARAM, WithDecryption=True)["Parameter"]["Value"]
            except Exception as e:  # noqa: BLE001
                log.error(json.dumps({"event": "key_unavailable", "error": type(e).__name__}))
                raise Problem(503, "not_configured", "The survey reader is not set up yet.") from e
        # no retries: there is no time for a second attempt inside API Gateway's 29 seconds
        _client = anthropic.Anthropic(api_key=key, timeout=MODEL_TIMEOUT_S, max_retries=0)
    return _client


def check_image(b64):
    """Decode and validate the upload. Returns (bytes, media_type)."""
    if not isinstance(b64, str) or not b64:
        raise Problem(400, "no_image", "No image was sent.")
    if len(b64) > MAX_IMAGE_BYTES * 4 // 3 + 16:
        raise Problem(413, "too_large", "That image is too large.")
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as e:
        raise Problem(400, "bad_image", "That image could not be read.") from e
    if len(raw) > MAX_IMAGE_BYTES:
        raise Problem(413, "too_large", "That image is too large.")
    for magic, media_type in MAGIC.items():
        if raw.startswith(magic):
            return raw, media_type
    raise Problem(415, "bad_type", "Only JPEG and PNG images can be read.")


def to_page_shape(d):
    """The page (ui.js applyAI) takes points as [x, y] pairs."""
    pt = lambda p: [p["x"], p["y"]]  # noqa: E731
    shapes = lambda a: [{"label": s["label"][:40], "pts": [pt(p) for p in s["pts"]]} for s in a]  # noqa: E731
    streets = [{"edge": s["edge"], "street": s["street"][:40]} for s in d["street_edges"]]
    return {
        "lot": [pt(p) for p in d["lot"]],
        # every street side, so a corner lot gets a front setback on both streets
        "street_edges": streets,
        # the first one alone, for a copy of the page from before street_edges
        "front_edge": streets[0]["edge"] if streets else -1,
        "alley_edges": d["alley_edges"],
        "buildings": shapes(d["buildings"]),
        "no_build": shapes(d["no_build"]),
        "scale": {"p1": pt(d["scale"]["p1"]), "p2": pt(d["scale"]["p2"]), "feet": d["scale"]["feet"]},
        "zoning": d["zoning"][:20],
        "notes": d["notes"][:300],
    }


def read_survey(raw, media_type):
    """One model call. Returns (tracing for the page, facts for the log line)."""
    started = time.monotonic()
    try:
        resp = make_client().beta.messages.create(
            model=MODEL,
            max_tokens=8000,
            # if the model declines a request, the API re-runs it on a fallback model in the same call
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(raw).decode("ascii")}},
                    {"type": "text", "text": PROMPT},
                ],
            }],
        )
    except anthropic.RateLimitError as e:
        raise Problem(429, "busy", "The survey reader is busy. Try again in a minute.") from e
    except anthropic.APITimeoutError as e:
        raise Problem(504, "slow", "Reading the survey took too long.") from e
    except anthropic.APIConnectionError as e:
        raise Problem(502, "unreachable", "The survey reader could not be reached.") from e
    except anthropic.APIStatusError as e:
        log.error(json.dumps({"event": "model_error", "status": e.status_code, "request_id": getattr(e, "request_id", None)}))
        raise Problem(502, "model_error", "The survey reader had a problem.") from e
    except anthropic.APIError as e:  # anything else the SDK raises, such as a reply it cannot parse
        log.error(json.dumps({"event": "model_error", "error": type(e).__name__}))
        raise Problem(502, "model_error", "The survey reader had a problem.") from e
    facts = {
        "ms": round((time.monotonic() - started) * 1000),
        "model": resp.model,
        "stop_reason": resp.stop_reason,
        "input_tokens": resp.usage.input_tokens,
        "output_tokens": resp.usage.output_tokens,
        "request_id": getattr(resp, "_request_id", None),
    }
    if resp.stop_reason == "refusal":
        raise Problem(422, "declined", "The survey reader could not read this image.")
    if resp.stop_reason == "max_tokens":
        raise Problem(502, "cut_off", "The survey reader did not finish.")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        out = to_page_shape(json.loads(text))
    except (ValueError, KeyError, TypeError) as e:
        raise Problem(502, "bad_reply", "The survey reader gave an answer the page cannot use.") from e
    facts.update(lot_points=len(out["lot"]), street_edges=len(out["street_edges"]), buildings=len(out["buildings"]), no_build=len(out["no_build"]), scale_found=out["scale"]["feet"] > 0)
    return out, facts


def reply(status, body, origin):
    headers = {"Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin"}
    if origin in ALLOWED_ORIGINS:
        headers.update({
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST,OPTIONS",
            "Access-Control-Allow-Headers": "content-type,x-api-key",
            "Access-Control-Max-Age": "3600",
        })
    return {"statusCode": status, "headers": headers, "body": json.dumps(body)}


def lambda_handler(event, context):
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    origin = headers.get("origin", "")
    method = event.get("httpMethod", "")
    if method == "OPTIONS":
        return reply(204, {}, origin)
    try:
        if method != "POST":
            raise Problem(405, "method", "Use POST.")
        # Only the page may call this. A browser always sends Origin on a cross-site POST.
        if origin not in ALLOWED_ORIGINS:
            raise Problem(403, "origin", "This address is not allowed to use the survey reader.")
        body = event.get("body") or ""
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8", "replace")
        try:
            image = json.loads(body).get("image")
        except (ValueError, AttributeError) as e:
            raise Problem(400, "bad_request", "The request could not be read.") from e
        raw, media_type = check_image(image)
        out, facts = read_survey(raw, media_type)
        log.info(json.dumps({"event": "read", "ok": True, "image_bytes": len(raw), **facts}))
        return reply(200, out, origin)
    except Problem as p:
        log.info(json.dumps({"event": "read", "ok": False, "status": p.status, "code": p.code}))
        return reply(p.status, {"error": p.code, "message": p.message}, origin)
    except Exception as e:  # noqa: BLE001
        # A bug here must still answer in the page's own format, with the cross-origin headers,
        # or the page cannot tell the person what happened. Only the kind of error is logged.
        log.error(json.dumps({"event": "crash", "error": type(e).__name__}))
        return reply(500, {"error": "failed", "message": "The survey reader had a problem."}, origin)
