"""How often people correct an AI tracing: the accuracy measure for the Phase 4 pilot.

    python lambda/correction_report.py            the last 90 days
    python lambda/correction_report.py 30         the last 30 days
    python lambda/correction_report.py 30 --all   include the page's made-up sample surveys

Reads the survey reader's own log lines (lambda/handler.py): one "read" line for each survey
the AI traced, one "checked" line each time a person pressed "This tracing looks right". The
lines hold no image, tracing or address. Needs boto3 and AWS credentials that can query the
log group. Makes no model call; a CloudWatch Logs Insights query costs well under a cent here.

How to read it:
  - "Accepted" is confirmations out of tracings. The rest were never confirmed: the person
    left, loaded something else, or gave up on the tracing. The log cannot say which.
  - "Corrected" counts a confirmation where the person changed any part first. Setting a scale
    the AI could not read is counted on its own line, not as a correction.
  - Street sides are reset when the lot is redrawn, so that line overlaps the lot line.
  - The reports come from the page and anyone could send false ones, so treat a sudden jump
    with suspicion. Lines from before the log was added (2026-11-24) have no "checked" events.
"""
import json
import statistics
import sys
import time

import boto3

LOG_GROUP = "/aws/lambda/adu-fit-check-survey-prod"
REGION = "us-west-2"
PARTS = [("lot", "lot lines"), ("buildings", "buildings"), ("no_build", "no-build areas"), ("streets", "street sides"), ("district", "zoning district or rules")]
LIMIT = 10000


def events(days):
    logs = boto3.client("logs", region_name=REGION)
    now = int(time.time())
    qid = logs.start_query(
        logGroupName=LOG_GROUP, startTime=now - days * 86400, endTime=now, limit=LIMIT,
        queryString='fields @message | filter @message like /"event": "(read|checked)"/ | sort @timestamp asc',
    )["queryId"]
    while True:
        r = logs.get_query_results(queryId=qid)
        if r["status"] in ("Complete", "Failed", "Cancelled", "Timeout"):
            break
        time.sleep(1)
    if r["status"] != "Complete":
        sys.exit("The log query did not finish: " + r["status"])
    out = []
    for row in r["results"]:
        msg = next((f["value"] for f in row if f["field"] == "@message"), "")
        try:
            out.append(json.loads(msg[msg.index("{"):]))
        except ValueError:
            pass
    if len(out) >= LIMIT:
        print("Only the first %d log lines were read. Ask for fewer days." % LIMIT)
    return out


def pct(n, of):
    return "%d of %d (%d%%)" % (n, of, round(100 * n / of)) if of else "0 of 0"


def report(evs, with_samples):
    keep = lambda e: e.get("ok") and (with_samples or not e.get("sample"))  # noqa: E731
    reads = [e for e in evs if e.get("event") == "read" and keep(e)]
    checks = [e for e in evs if e.get("event") == "checked" and keep(e)]
    lines = ["Tracings the AI made:       %d" % len(reads),
             "Accepted by the person:     %s" % pct(len(checks), len(reads))]
    if not checks:
        return lines + ["No accepted tracings yet, so there is nothing to say about corrections."]
    lines.append("Corrected before accepting: %s" % pct(sum(1 for e in checks if e.get("changed")), len(checks)))
    for key, name in PARTS:
        lines.append("  changed %-27s %s" % (name + ":", pct(sum(1 for e in checks if e.get(key)), len(checks))))
    had = [e for e in checks if e.get("scale_read")]
    lines.append("  changed a scale the AI had read:    %s" % pct(sum(1 for e in had if e.get("scale")), len(had)))
    lines.append("AI could not read a scale:  %s" % pct(len(checks) - len(had), len(checks)))
    moves = [e["lot_move_ft"] for e in checks if e.get("lot") and isinstance(e.get("lot_move_ft"), int)]
    if moves:
        lines.append("Where lot lines were changed and the corner count kept (%d): furthest corner moved a median of %d ft, at most %d ft"
                     % (len(moves), statistics.median(moves), max(moves)))
    return lines


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--all"]
    days = int(args[0]) if args else 90
    with_samples = "--all" in sys.argv
    print("Last %d days, %s the made-up sample surveys" % (days, "with" if with_samples else "without"))
    print("\n".join(report(events(days), with_samples)))
