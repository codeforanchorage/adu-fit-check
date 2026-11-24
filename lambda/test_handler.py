"""Unit tests for the survey reader. No network and no key: the model client is replaced.

    python -m unittest discover -s lambda -p "test_*.py"
"""
import base64
import json
import os
import unittest
from types import SimpleNamespace

os.environ["ALLOWED_ORIGINS"] = "https://www.example.org,http://127.0.0.1:8000"
os.environ["ANTHROPIC_API_KEY"] = "test-key-not-real"

import handler  # noqa: E402

ORIGIN = "https://www.example.org"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 2000
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 2000
GOOD = {
    "lot": [{"x": 100, "y": 100}, {"x": 900, "y": 100}, {"x": 900, "y": 900}, {"x": 100, "y": 900}],
    "street_edges": [{"edge": 2, "street": "W. EXAMPLE AVENUE"}, {"edge": 1, "street": "SAMPLE STREET"}], "alley_edges": [],
    "buildings": [{"label": "House", "pts": [{"x": 300, "y": 600}, {"x": 700, "y": 600}, {"x": 700, "y": 800}, {"x": 300, "y": 800}]}],
    "no_build": [], "scale": {"p1": {"x": 100, "y": 100}, "p2": {"x": 900, "y": 100}, "feet": 60.0},
    "zoning": "R-1", "notes": "",
}


class FakeClient:
    """Stands in for anthropic.Anthropic. Records what it was asked and returns a canned reply."""

    def __init__(self, text=None, stop_reason="end_turn", raises=None):
        self.calls, self.raises = [], raises
        self.resp = SimpleNamespace(model="claude-opus-5-5", stop_reason=stop_reason, _request_id="req_test",
                                    usage=SimpleNamespace(input_tokens=3000, output_tokens=812),
                                    content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text if text is not None else json.dumps(GOOD))])
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        if self.raises:
            raise self.raises
        return self.resp


def event(image=JPEG, origin=ORIGIN, method="POST", body=None):
    if body is None:
        body = json.dumps({"image": base64.b64encode(image).decode()})
    return {"httpMethod": method, "headers": {"Origin": origin} if origin else {}, "body": body}


def call(ev, client=None):
    handler._client = client or FakeClient()
    r = handler.lambda_handler(ev, None)
    return r, json.loads(r["body"]), handler._client


class Reads(unittest.TestCase):
    def test_good_survey_comes_back_in_the_page_shape(self):
        r, body, client = call(event())
        self.assertEqual(r["statusCode"], 200)
        self.assertEqual(body["lot"], [[100, 100], [900, 100], [900, 900], [100, 900]])
        self.assertEqual(body["buildings"][0]["pts"][0], [300, 600])
        self.assertEqual([s["edge"] for s in body["street_edges"]], [2, 1])
        self.assertEqual(body["front_edge"], 2)   # the first street, for an older copy of the page
        self.assertEqual(body["scale"], {"p1": [100, 100], "p2": [900, 100], "feet": 60.0})
        self.assertEqual(r["headers"]["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(r["headers"]["Cache-Control"], "no-store")

    def test_request_to_the_model(self):
        _, _, client = call(event(PNG))
        kw = client.calls[0]
        self.assertEqual(kw["model"], "claude-opus-5-5")
        self.assertEqual(kw["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(kw["fallbacks"], "default")
        image, text = kw["messages"][0]["content"]
        self.assertEqual(image["source"]["media_type"], "image/png")
        self.assertEqual(base64.b64decode(image["source"]["data"]), PNG)
        self.assertIn("0 at the left edge", text["text"])
        # the page never chooses the model, the prompt or sampling settings
        for banned in ("temperature", "top_p", "top_k", "system"):
            self.assertNotIn(banned, kw)

    def test_preflight(self):
        r, _, client = call(event(method="OPTIONS"))
        self.assertEqual(r["statusCode"], 204)
        self.assertEqual(r["headers"]["Access-Control-Allow-Headers"], "content-type,x-api-key")
        self.assertEqual(client.calls, [])


class Refuses(unittest.TestCase):
    def no_model_call(self, ev, status, code):
        r, body, client = call(ev)
        self.assertEqual((r["statusCode"], body["error"]), (status, code))
        self.assertEqual(client.calls, [], "the model must not be called")
        return r

    def test_other_sites(self):
        r = self.no_model_call(event(origin="https://evil.example"), 403, "origin")
        self.assertNotIn("Access-Control-Allow-Origin", r["headers"])
        self.no_model_call(event(origin=""), 403, "origin")

    def test_not_an_image(self):
        self.no_model_call(event(b"%PDF-1.7 " + b"0" * 500), 415, "bad_type")
        self.no_model_call(event(b"<svg onload=alert(1)>"), 415, "bad_type")

    def test_too_large(self):
        self.no_model_call(event(b"\xff\xd8\xff" + b"0" * handler.MAX_IMAGE_BYTES), 413, "too_large")

    def test_broken_requests(self):
        self.no_model_call(event(body="not json"), 400, "bad_request")
        self.no_model_call(event(body=json.dumps({"image": "***"})), 400, "bad_image")
        self.no_model_call(event(body=json.dumps({})), 400, "no_image")
        self.no_model_call(event(method="GET"), 405, "method")

    def test_model_declines_or_fails(self):
        r, body, _ = call(event(), FakeClient(stop_reason="refusal"))
        self.assertEqual((r["statusCode"], body["error"]), (422, "declined"))
        r, body, _ = call(event(), FakeClient(stop_reason="max_tokens"))
        self.assertEqual((r["statusCode"], body["error"]), (502, "cut_off"))
        r, body, _ = call(event(), FakeClient(text="{}"))
        self.assertEqual((r["statusCode"], body["error"]), (502, "bad_reply"))


class Crashes(unittest.TestCase):
    def test_an_unexpected_error_still_answers_in_the_page_format(self):
        r, body, _ = call(event(), FakeClient(raises=RuntimeError("boom")))
        self.assertEqual((r["statusCode"], body["error"]), (500, "failed"))
        self.assertEqual(r["headers"]["Access-Control-Allow-Origin"], ORIGIN)

    def test_a_body_that_is_not_valid_base64_is_refused(self):
        ev = event()
        ev["isBase64Encoded"] = True
        ev["body"] = "%%% not base64 %%%"
        r, body, client = call(ev)
        self.assertIn(r["statusCode"], (400, 500))
        self.assertEqual(client.calls, [])


class Logs(unittest.TestCase):
    def test_log_line_has_no_image_and_no_tracing(self):
        with self.assertLogs(level="INFO") as cm:
            call(event())
        line = "\n".join(cm.output)
        self.assertIn('"event": "read"', line)
        self.assertIn('"lot_points": 4', line)
        self.assertNotIn(base64.b64encode(JPEG).decode()[:40], line)
        self.assertNotIn("900", line)        # no coordinates
        self.assertNotIn("EXAMPLE", line)    # no street names
        self.assertNotIn("test-key", line)   # no key


if __name__ == "__main__":
    unittest.main()
