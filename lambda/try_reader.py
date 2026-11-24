"""Send one survey image through the deployed survey reader and report time and accuracy.

    python lambda/try_reader.py                 the built-in sample survey (drawn here, answers known)
    python lambda/try_reader.py my-survey.jpg   any JPEG or PNG (no accuracy figures)

Each run makes one paid model call. The address and the page's public key come from Terraform.
Needs Pillow for the sample. Not part of the unit tests.
"""
import base64
import io
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

ORIGIN = "http://127.0.0.1:8000"
K = 6  # pixels per foot in the sample, as in ui.js sample()
LOT = (200, 130, 560, 880)        # 60 x 125 ft
HOUSE = (260, 592, 500, 760)      # 40 x 28 ft
GARAGE = (230, 400, 350, 532)     # 20 x 22 ft
W, H = 760, 1000


def tf(name):
    return subprocess.run(["terraform", "-chdir=terraform/aws", "output", "-raw", name], capture_output=True, text=True, check=True).stdout.strip()


def sample_jpeg():
    """The made-up sample survey from ui.js sample(), drawn with Pillow."""
    from PIL import Image, ImageDraw, ImageFont

    im = Image.new("RGB", (W, H), "#fbfbf8")
    g = ImageDraw.Draw(im)

    def font(size, bold=False):
        for name in (("arialbd.ttf",) if bold else ()) + ("arial.ttf", "DejaVuSans.ttf"):
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                pass
        return ImageFont.load_default()

    def text(t, x, y, size=12, bold=False, vertical=False):
        f = font(size, bold)
        if not vertical:
            g.text((x, y), t, fill="#222", font=f, anchor="ms")
            return
        box = g.textbbox((0, 0), t, font=f)
        tile = Image.new("RGBA", (box[2] + 4, box[3] + 4), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text((2, 2), t, fill="#222", font=f)
        tile = tile.rotate(90, expand=True)
        im.paste(tile, (int(x - tile.width / 2), int(y - tile.height / 2)), tile)

    def hatch(x0, y0, x1, y1):
        for i in range(-(y1 - y0), x1 - x0, 9):
            a, b = (x0 + i, y1), (x0 + i + (y1 - y0), y0)
            # clip the diagonal to the box
            pts = []
            for (px, py) in (a, b):
                pts.append((px, py))
            ax, ay, bx, by = *a, *b
            if ax < x0:
                ay -= (x0 - ax); ax = x0
            if bx > x1:
                by += (bx - x1); bx = x1
            if ax < bx:
                g.line([(ax, ay), (bx, by)], fill="#999", width=1)
        g.rectangle([x0, y0, x1, y1], outline="#222", width=2)

    g.rectangle([14, 14, W - 14, H - 14], outline="#222", width=2)
    text("AS-BUILT SURVEY", 380, 50, 20, True)
    text("LOT 7, BLOCK 3, EXAMPLE SUBDIVISION", 380, 72)
    text("SAMPLE ONLY. NOT A REAL SURVEY.", 380, 92, 12, True)
    x0, y0, x1, y1 = LOT
    g.rectangle([x0, y0, x1, y1], outline="#222", width=3)
    text("N 89°58' E   60.00'", 380, y0 - 8)
    text("60.00'", 380, y1 + 18)
    text("125.00'", x0 - 14, 505, vertical=True)
    text("125.00'", x1 + 16, 505, vertical=True)
    for x in range(x0, x1, 13):
        g.line([(x, y0 + 10 * K), (min(x + 8, x1), y0 + 10 * K)], fill="#222", width=1)
    text("10' UTILITY EASEMENT", 380, y0 + 34, 11)
    hatch(*HOUSE)
    g.rectangle([310, 660, 450, 694], fill="#fbfbf8")
    text("EXISTING HOUSE", 380, 675)
    text("40.0' x 28.0'", 380, 689, 11)
    hatch(*GARAGE)
    g.rectangle([250, 452, 330, 482], fill="#fbfbf8")
    text("GARAGE", 290, 466)
    text("20.0' x 22.0'", 290, 479, 10)
    for y in range(532, 880, 8):
        g.line([(232, y), (232, min(y + 4, 880))], fill="#222")
        g.line([(292, y), (292, min(y + 4, 880))], fill="#222")
    text("DRIVEWAY", 262, 820, 10, vertical=True)
    g.line([(40, 900), (720, 900)], fill="#222")
    g.line([(40, 950), (720, 950)], fill="#222")
    text("W. EXAMPLE AVENUE  (60' R.O.W.)", 380, 930)
    g.line([(660, 200), (660, 140), (650, 160)], fill="#222")
    g.line([(660, 140), (670, 160)], fill="#222")
    text("N", 660, 132, 14, True)
    text("SCALE: 1 in = 20 ft", 640, 975, 11)
    text("ZONING: R-1 (example)", 120, 975, 11)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def box_error_ft(pts, box):
    """Largest distance, in feet, from a true corner of `box` to the nearest traced corner."""
    x0, y0, x1, y1 = box
    px = [(p[0] * W / 1000, p[1] * H / 1000) for p in pts]
    worst = 0.0
    for cx, cy in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        worst = max(worst, min(((cx - x) ** 2 + (cy - y) ** 2) ** 0.5 for x, y in px) / K)
    return worst


def main():
    known = len(sys.argv) < 2
    raw = sample_jpeg() if known else open(sys.argv[1], "rb").read()
    url, key = tf("read_survey_url"), tf("page_key")
    req = urllib.request.Request(url, data=json.dumps({"image": base64.b64encode(raw).decode()}).encode(),
                                 headers={"content-type": "application/json", "x-api-key": key, "Origin": ORIGIN}, method="POST")
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            status, body = r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        status, body = e.code, json.loads(e.read() or b"{}")
    secs = time.monotonic() - started
    print(f"image {len(raw):,} bytes   HTTP {status}   {secs:.1f} s")
    if status != 200:
        print(body)
        return 1
    print(f"lot corners {len(body['lot'])}, front edge {body['front_edge']}, alleys {body['alley_edges']}")
    print("buildings:", [(b["label"], len(b["pts"])) for b in body["buildings"]])
    print("no-build:", [(b["label"], len(b["pts"])) for b in body["no_build"]])
    print("scale:", body["scale"], " zoning:", repr(body["zoning"]))
    print("notes:", body["notes"] or "(none)")
    if known:
        print(f"\nagainst the known sample (a 60 x 125 ft lot):")
        print(f"  lot: {len(body['lot'])} corners (4 true), worst corner off by {box_error_ft(body['lot'], LOT):.1f} ft")
        for name, box in (("house", HOUSE), ("garage", GARAGE)):
            errs = sorted(box_error_ft(b["pts"], box) for b in body["buildings"] if b["pts"])
            print(f"  {name}: best-matching traced building is off by {errs[0]:.1f} ft at its worst corner" if errs else f"  {name}: no building traced")
        s = body["scale"]
        if s["feet"] > 0:
            d = (((s["p1"][0] - s["p2"][0]) * W / 1000) ** 2 + ((s["p1"][1] - s["p2"][1]) * H / 1000) ** 2) ** 0.5
            print(f"  scale: {s['feet']} ft over {d:.0f} px = {d / s['feet']:.2f} px per ft (true {K})")
        front = body["front_edge"]
        n = len(body["lot"])
        if n:
            a, b = body["lot"][front % n], body["lot"][(front + 1) % n]
            print(f"  front edge runs y={a[1]:.0f} to y={b[1]:.0f} (the street is at the bottom, y=880)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
