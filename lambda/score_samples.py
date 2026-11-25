"""Score the survey reader against surveys whose true tracing is known: the Phase 4 evaluation.

    python lambda/score_samples.py                      the three made-up samples (three paid model calls)
    python lambda/score_samples.py --replay             score the replies saved by the last run again, no calls
    python lambda/score_samples.py path/to/answers.json your own set, images in the same folder

For each survey it reports how far each traced corner is from the truth, in feet, and whether
the fit verdict changes: for each catalog plan (plans.json), would the page say "Could fit" on
the true tracing and on the reader's tracing? Both verdicts come from the page's own code
(tools/verdict.mjs), so Node is needed as well as Python.

The evaluation the work order asks for is 20 redacted real as-builts from Development Services
with hand-traced answers. Put them in a folder OUTSIDE this repository with an answers.json in
the format of samples/answers.json (see ANSWERS FORMAT below) and pass its path.

Each reply is saved under .survey-replies/ (not committed) so a run can be scored again
with --replay. A saved reply holds the reader's tracing of that survey, so for real surveys
treat that folder like the surveys themselves. Requests are marked as samples, so they are
left out of the figures for how often people correct a tracing (lambda/correction_report.py).

ANSWERS FORMAT: {"samples": [{...}]}, each with
  file                     image file name, JPEG or PNG, at most 1.5 MB and 1,600 pixels a side
  width_px, height_px      size of that image
  px_per_ft                pixels per foot in the image
  lot                      [[x, y], ...] corners in order, on a 0 to 1000 grid (x from the left
                           edge, y from the top edge), as are all points below
  street_edges             [i, ...] lot lines on a street; line i runs from corner i to corner i+1
  alley_edges              [i, ...] lot lines on an alley
  buildings, no_build      {"name": [[x, y], ...], ...}
  zoning                   the district printed on the survey, or ""
"""
import base64
import json
import os
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPLIES = os.path.join(ROOT, ".survey-replies")


def tf(name):
    return subprocess.run(["terraform", "-chdir=" + os.path.join(ROOT, "terraform", "aws"), "output", "-raw", name], capture_output=True, text=True, check=True).stdout.strip()


def worst_ft(truth, traced, a):
    """Largest distance in feet from a true corner to the nearest traced corner."""
    W, H, k = a["width_px"], a["height_px"], a["px_per_ft"]
    if not traced:
        return None
    return max(min((((tx - x) * W / 1000) ** 2 + ((ty - y) * H / 1000) ** 2) ** 0.5 for x, y in traced) for tx, ty in truth) / k


def truth_tracing(a):
    """The true answer in the survey reader's own format, so both go through the same code."""
    shapes = lambda d: [{"label": name, "pts": pts} for name, pts in d.items()]  # noqa: E731
    return {
        "lot": a["lot"],
        # no names: the page tells unnamed streets apart by direction, as it does for the reader
        "street_edges": [{"edge": i, "street": ""} for i in a["street_edges"]],
        "alley_edges": a["alley_edges"],
        "buildings": shapes(a["buildings"]), "no_build": shapes(a["no_build"]),
        "scale": {"p1": [0, 0], "p2": [1000, 0], "feet": a["width_px"] / a["px_per_ft"]},
        "zoning": a["zoning"], "notes": "",
    }


def verdicts(items):
    """The page's fit verdict for each tracing: tools/verdict.mjs."""
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "verdict.mjs")], input=json.dumps(items), capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        sys.exit("tools/verdict.mjs failed:\n" + r.stderr)
    return json.loads(r.stdout)


def read(a, folder, url, key):
    raw = open(os.path.join(folder, a["file"]), "rb").read()
    req = urllib.request.Request(url, data=json.dumps({"image": base64.b64encode(raw).decode(), "sample": True}).encode(),
                                 headers={"content-type": "application/json", "x-api-key": key, "Origin": "http://127.0.0.1:8000"}, method="POST")
    t = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            st, b = r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        st, b = e.code, json.loads(e.read() or b"{}")
    return st, b, time.monotonic() - t


def describe(a, b):
    """The detail for one survey. Returns the worst lot corner error in feet."""
    lot_err = worst_ft(a["lot"], b["lot"], a)
    print("  lot: %d corners traced, %d true, worst true corner off by %s" % (len(b["lot"]), len(a["lot"]), "%.1f ft" % lot_err if lot_err is not None else "NOT TRACED"))
    if b["lot"]:
        # the reader may start the lot at a different corner, so street sides are compared by their midpoints
        mids = lambda lot, idx: sorted("(%.0f, %.0f)" % ((lot[i % len(lot)][0] + lot[(i + 1) % len(lot)][0]) / 2, (lot[i % len(lot)][1] + lot[(i + 1) % len(lot)][1]) / 2) for i in idx)  # noqa: E731
        print("  street sides: traced midpoints %s %s, true %s" % (mids(b["lot"], [s["edge"] for s in b["street_edges"]]), [s["street"] for s in b["street_edges"]], mids(a["lot"], a["street_edges"])))
        print("  alleys: traced midpoints %s, true %s" % (mids(b["lot"], b["alley_edges"]), mids(a["lot"], a["alley_edges"])))
    for kind in ("buildings", "no_build"):
        for name, truth in a[kind].items():
            errs = sorted((worst_ft(truth, s["pts"], a), s["label"], len(s["pts"])) for s in b[kind] if s["pts"])
            print("  %s %-18s -> %s" % (kind[:-1] if kind == "buildings" else "no-build", name, ("'%s' with %d corners, worst corner off by %.1f ft" % (errs[0][1], errs[0][2], errs[0][0])) if errs else "NOT TRACED"))
        print("  %s traced in all: %s" % (kind, [s["label"] for s in b[kind]]))
    s = b["scale"]
    if s["feet"] > 0:
        d = (((s["p1"][0] - s["p2"][0]) * a["width_px"] / 1000) ** 2 + ((s["p1"][1] - s["p2"][1]) * a["height_px"] / 1000) ** 2) ** 0.5
        print("  scale: %.2f px per ft read, %.2f true   zoning read %r, true %r" % (d / s["feet"], a["px_per_ft"], b["zoning"], a["zoning"]))
    else:
        print("  scale: NOT FOUND")
    print("  notes:", b["notes"] or "(none)")
    return lot_err


def compare(a, true_v, read_v):
    """Print the fit verdicts side by side. Returns (plans checked, plans whose verdict changed, names of those)."""
    if "error" in true_v:
        sys.exit("The true tracing for %s could not be used (%s). Check answers.json." % (a["file"], true_v["error"]))
    word = lambda p: ("Could fit, %.1f ft to spare" % p["spare"]) if p["fits"] else "No room found"  # noqa: E731
    if "error" in read_v:
        print("  fit verdict: the page could show none from this tracing (%s) until the person fixed it" % read_v["error"])
        return len(true_v["plans"]), len(true_v["plans"]), ["all plans: " + read_v["error"]]
    if read_v["district"] != true_v["district"]:
        print("  district the page would apply: %s from the reader's tracing, %s true" % (read_v["district"], true_v["district"]))
    changed = []
    for t, r in zip(true_v["plans"], read_v["plans"]):
        same = t["fits"] == r["fits"]
        print("  fit verdict, %-14s true tracing: %-30s reader's tracing: %-30s %s" % (t["name"] + ":", word(t), word(r), "same" if same else "CHANGED"))
        if not same:
            changed.append(t["name"])
    return len(true_v["plans"]), len(changed), changed


def main():
    args = [x for x in sys.argv[1:] if x != "--replay"]
    replay = "--replay" in sys.argv
    path = os.path.abspath(args[0]) if args else os.path.join(ROOT, "samples", "answers.json")
    folder = os.path.dirname(path)
    answers = json.load(open(path, encoding="utf-8"))["samples"]
    os.makedirs(REPLIES, exist_ok=True)
    url = key = None
    done = []
    for a in answers:
        saved = os.path.join(REPLIES, a["file"] + ".json")
        if replay:
            if not os.path.exists(saved):
                print("\n== %s  no saved reply; run without --replay first" % a["file"])
                continue
            b = json.load(open(saved, encoding="utf-8"))
            print("\n== %s  (saved reply)" % a["file"])
        else:
            if url is None:
                url, key = tf("read_survey_url"), tf("page_key")
            st, b, secs = read(a, folder, url, key)
            print("\n== %s  HTTP %s  %.1f s" % (a["file"], st, secs))
            if st != 200:
                print(b)
                continue
            json.dump(b, open(saved, "w", encoding="utf-8"))
        done.append((a, b, describe(a, b)))
    if not done:
        return
    size = lambda a: {"w": a["width_px"], "h": a["height_px"]}  # noqa: E731
    v = verdicts([{**size(a), "tracing": truth_tracing(a)} for a, _, _ in done] + [{**size(a), "tracing": b} for a, b, _ in done])
    checked = flipped = 0
    which = []
    for i, (a, b, _) in enumerate(done):
        print("\n== %s  fit verdicts" % a["file"])
        n, c, names = compare(a, v[i], v[len(done) + i])
        checked, flipped = checked + n, flipped + c
        which += ["%s (%s)" % (a["file"], x) for x in names]
    errs = [e for _, _, e in done if e is not None]
    print("\n== summary")
    print("  surveys read: %d of %d" % (len(done), len(answers)))
    if errs:
        print("  worst lot corner error per survey: median %.1f ft, largest %.1f ft" % (statistics.median(errs), max(errs)))
    print("  fit verdict changed: %d of %d plan checks%s" % (flipped, checked, (": " + "; ".join(which)) if which else ""))
    print("  Screening only. A verdict that did not change can still rest on a tracing that is feet off.")


if __name__ == "__main__":
    main()
