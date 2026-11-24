"""Read each made-up sample survey through the deployed survey reader and score it against
samples/answers.json. Each sample is one paid model call.

    python lambda/score_samples.py

This is the start of the Phase 4 evaluation: real, redacted as-builts with hand-traced
answers in the same format can be added to samples/answers.json and scored the same way.
"""
import base64, json, os, subprocess, sys, time, urllib.error, urllib.request
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
tf = lambda n: subprocess.run(["terraform", "-chdir=terraform/aws", "output", "-raw", n], capture_output=True, text=True, check=True).stdout.strip()
URL, KEY = tf("read_survey_url"), tf("page_key")
ans = json.load(open("samples/answers.json", encoding="utf-8"))["samples"]


def worst_ft(truth, traced, a):
    """Largest distance in feet from a true corner to the nearest traced corner."""
    W, H, k = a["width_px"], a["height_px"], a["px_per_ft"]
    if not traced:
        return None
    return max(min((((tx - x) * W / 1000) ** 2 + ((ty - y) * H / 1000) ** 2) ** 0.5 for x, y in traced) for tx, ty in truth) / k


for a in ans:
    raw = open(os.path.join("samples", a["file"]), "rb").read()
    req = urllib.request.Request(URL, data=json.dumps({"image": base64.b64encode(raw).decode()}).encode(),
                                 headers={"content-type": "application/json", "x-api-key": KEY, "Origin": "http://127.0.0.1:8000"}, method="POST")
    t = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            st, b = r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        st, b = e.code, json.loads(e.read() or b"{}")
    secs = time.monotonic() - t
    print("\n== %s  HTTP %s  %.1f s" % (a["file"], st, secs))
    if st != 200:
        print(b)
        continue
    print("  lot: %d corners traced, %d true, worst true corner off by %.1f ft" % (len(b["lot"]), len(a["lot"]), worst_ft(a["lot"], b["lot"], a)))
    n = len(b["lot"])
    if n:
        # the reader may start the lot at a different corner, so street sides are compared by their midpoints
        mids = lambda lot, idx: sorted("(%.0f, %.0f)" % ((lot[i % len(lot)][0] + lot[(i + 1) % len(lot)][0]) / 2, (lot[i % len(lot)][1] + lot[(i + 1) % len(lot)][1]) / 2) for i in idx)
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
