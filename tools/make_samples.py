"""Draw the made-up sample as-built surveys in samples/, and their known answers.

    python tools/make_samples.py

These are invented lots for people to try the upload and "Read survey with AI" steps with.
Every sheet says SAMPLE ONLY. None is a real property. Needs Pillow.

samples/answers.json holds what each drawing really shows (corners on the 0-1000 grid the
survey reader uses, and feet per pixel), so lambda/try_reader.py can score a reading.
"""
import json
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "samples")
W, H = 1100, 1400
INK, PAPER, GREY = "#222222", "#fbfbf8", "#999999"


def font(size, bold=False):
    for name in (("arialbd.ttf",) if bold else ()) + ("arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


class Sheet:
    """One survey sheet. Positions are given in feet on the lot (x east, y south) and
    turned into pixels with `k` pixels per foot from the origin (ox, oy)."""

    def __init__(self, k, ox, oy):
        self.k, self.ox, self.oy = k, ox, oy
        self.im = Image.new("RGB", (W, H), PAPER)
        self.g = ImageDraw.Draw(self.im)
        self.g.rectangle([18, 18, W - 18, H - 18], outline=INK, width=3)

    def px(self, p):
        return (self.ox + p[0] * self.k, self.oy + p[1] * self.k)

    def text(self, t, xy, size=16, bold=False, angle=0, fill=INK, back=False):
        f = font(size, bold)
        box = self.g.textbbox((0, 0), t, font=f)
        w, h = box[2] + 8, box[3] + 8
        tile = Image.new("RGBA", (w, h), (251, 251, 248, 255) if back else (0, 0, 0, 0))
        ImageDraw.Draw(tile).text((4, 2), t, fill=fill, font=f)
        if angle:
            tile = tile.rotate(angle, expand=True)
        self.im.paste(tile, (int(xy[0] - tile.width / 2), int(xy[1] - tile.height / 2)), tile)

    def poly(self, pts, width=3, fill=None):
        p = [self.px(q) for q in pts]
        if fill:
            self.g.polygon(p, fill=fill)
        self.g.line(p + [p[0]], fill=INK, width=width, joint="curve")

    def dashed(self, a, b, dash=10, gap=7, width=2, feet=True):
        a, b = (self.px(a), self.px(b)) if feet else (a, b)
        n = math.hypot(b[0] - a[0], b[1] - a[1])
        ux, uy = (b[0] - a[0]) / n, (b[1] - a[1]) / n
        d = 0
        while d < n:
            e = min(d + dash, n)
            self.g.line([(a[0] + ux * d, a[1] + uy * d), (a[0] + ux * e, a[1] + uy * e)], fill=INK, width=width)
            d += dash + gap

    def dashed_poly(self, pts):
        for i in range(len(pts)):
            self.dashed(pts[i], pts[(i + 1) % len(pts)])

    def building(self, pts, label, size_note):
        """Hatched outline with its name and size printed inside."""
        p = [self.px(q) for q in pts]
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).polygon(p, fill=255)
        hatch = Image.new("RGB", (W, H), PAPER)
        hg = ImageDraw.Draw(hatch)
        for i in range(-H, W, 11):
            hg.line([(i, H), (i + H, 0)], fill=GREY, width=1)
        self.im.paste(hatch, (0, 0), mask)
        self.g.line(p + [p[0]], fill=INK, width=3)
        cx, cy = sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)
        self.text(label, (cx, cy - 10), 15, back=True)
        self.text(size_note, (cx, cy + 10), 13, back=True)

    def edge_lengths(self, lot, inside_point):
        """Print each lot line's length beside it, outside the lot."""
        for i in range(len(lot)):
            a, b = lot[i], lot[(i + 1) % len(lot)]
            length = math.hypot(b[0] - a[0], b[1] - a[1])
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            nx, ny = -(b[1] - a[1]) / length, (b[0] - a[0]) / length
            if (inside_point[0] - mx) * nx + (inside_point[1] - my) * ny > 0:
                nx, ny = -nx, -ny
            ang = math.degrees(math.atan2(-(b[1] - a[1]), b[0] - a[0]))
            if ang > 90 or ang <= -90:
                ang += 180
            x, y = self.px((mx, my))
            self.text("%.2f'" % length, (x + nx * 16, y + ny * 16), 15, angle=ang)

    def street(self, a, b, name, inside_point, band_ft=14):
        """Two lines for a right-of-way running along the lot line a-b, outside the lot."""
        n = math.hypot(b[0] - a[0], b[1] - a[1])
        ux, uy = (b[0] - a[0]) / n, (b[1] - a[1]) / n
        nx, ny = -uy, ux
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if (inside_point[0] - mx) * nx + (inside_point[1] - my) * ny > 0:
            nx, ny = -nx, -ny
        near, far = 6, 6 + band_ft
        for off in (near, far):
            p, q = (a[0] - ux * 14 + nx * off, a[1] - uy * 14 + ny * off), (b[0] + ux * 14 + nx * off, b[1] + uy * 14 + ny * off)
            self.g.line([self.px(p), self.px(q)], fill=INK, width=2)
        mid = self.px((mx + nx * (near + far) / 2, my + ny * (near + far) / 2))
        ang = math.degrees(math.atan2(-(b[1] - a[1]), b[0] - a[0]))
        if ang > 90 or ang <= -90:
            ang += 180
        self.text(name, mid, 15, angle=ang)

    def north(self, x, y):
        self.g.line([(x, y + 70), (x, y), (x - 11, y + 22)], fill=INK, width=2)
        self.g.line([(x, y), (x + 11, y + 22)], fill=INK, width=2)
        self.text("N", (x, y - 16), 18, True)

    def titles(self, lines, zoning, scale_note):
        self.text("AS-BUILT SURVEY", (W / 2, 56), 28, True)
        self.text(lines[0], (W / 2, 90), 16)
        self.text("SAMPLE ONLY. NOT A REAL SURVEY.", (W / 2, 116), 16, True)
        self.text("ZONING: %s (example)" % zoning, (170, H - 46), 14)
        self.text(scale_note, (W - 170, H - 46), 14)

    def norm(self, pts):
        """Feet on the lot to the reader's 0-1000 grid."""
        return [[round(self.px(p)[0] * 1000 / W, 1), round(self.px(p)[1] * 1000 / H, 1)] for p in pts]


def box(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def city_lot_with_alley():
    """A 50 x 140 ft city lot: street in front, alley behind, garage off the alley."""
    s = Sheet(6.6, 385, 250)
    lot = box(0, 0, 50, 140)
    house, garage = box(10, 80, 40, 120), box(26, 5, 46, 27)
    s.titles(["LOT 12, BLOCK 4, SAMPLE ADDITION"], "R-1", "SCALE: 1 in = 20 ft")
    s.poly(lot, 4)
    s.edge_lengths(lot, (25, 70))
    s.street(lot[3], lot[2], "E. SAMPLE STREET  (60' R.O.W.)", (25, 70))
    s.street(lot[0], lot[1], "20' ALLEY", (25, 70), 9)
    s.building(house, "EXISTING HOUSE", "30.0' x 40.0'")
    s.building(garage, "GARAGE", "20.0' x 22.0'")
    s.dashed((28, 5), (28, 0), 5, 4); s.dashed((44, 5), (44, 0), 5, 4)
    s.north(930, 240)
    return s, {"file": "sample-city-lot-alley.jpg", "title": "City lot with an alley",
               "lot": lot, "front_edge": 2, "alley_edges": [0], "buildings": {"House": house, "Garage": garage}, "no_build": {}, "zoning": "R-1"}


def corner_lot():
    """A 70 x 110 ft corner lot with an L-shaped house, a shed and a rear easement."""
    s = Sheet(8.5, 190, 190)
    lot = box(0, 0, 70, 110)
    house = [(12, 52), (50, 52), (50, 68), (38, 68), (38, 90), (12, 90)]
    shed = box(8, 12, 18, 24)
    ease = box(0, 0, 70, 6)
    s.titles(["LOT 1, BLOCK 9, SAMPLE HEIGHTS SUBDIVISION"], "R-2M", "SCALE: 1 in = 20 ft")
    s.poly(lot, 4)
    s.edge_lengths(lot, (35, 55))
    s.street(lot[3], lot[2], "W. EXAMPLE AVENUE  (60' R.O.W.)", (35, 55))
    s.street(lot[1], lot[2], "SAMPLE STREET  (50' R.O.W.)", (35, 55))
    s.dashed(ease[3], ease[2])
    s.text("6' UTILITY EASEMENT", s.px((35, 3)), 13)
    s.building(house, "EXISTING HOUSE", "38.0' x 38.0' L-SHAPE")
    s.building(shed, "SHED", "10' x 12'")
    s.north(95, 250)
    return s, {"file": "sample-corner-lot.jpg", "title": "Corner lot",
               "lot": lot, "front_edge": 2, "alley_edges": [], "buildings": {"House": house, "Shed": shed}, "no_build": {"Utility easement": ease}, "zoning": "R-2M"}


def large_lot_with_septic():
    """A five-sided hillside lot of about three quarters of an acre, on a well and septic system."""
    s = Sheet(5, 110, 230)
    lot = [(0, 30), (110, 0), (180, 50), (180, 200), (0, 200)]
    house, shop = box(62, 118, 106, 148), box(128, 66, 152, 96)
    septic, ease = box(14, 92, 46, 132), box(0, 30, 15, 200)
    s.titles(["LOT 3, SAMPLE RIDGE ESTATES"], "R-6", "SCALE: 1 in = 40 ft")
    s.poly(lot, 4)
    s.edge_lengths(lot, (90, 110))
    s.street(lot[4], lot[3], "SAMPLE HILL ROAD  (60' R.O.W.)", (90, 110))
    s.dashed(ease[1], ease[2])
    s.text("15' DRAINAGE EASEMENT", s.px((7.5, 150)), 12, angle=90)
    s.dashed_poly(septic)
    s.text("SEPTIC", s.px((30, 106)), 13)
    s.text("FIELD", s.px((30, 116)), 13)
    wx, wy = s.px((150, 168))
    s.g.ellipse([wx - 9, wy - 9, wx + 9, wy + 9], outline=INK, width=2)
    s.text("WELL", (wx, wy + 22), 13)
    s.building(house, "EXISTING HOUSE", "44.0' x 30.0'")
    s.building(shop, "SHOP", "24.0' x 30.0'")
    s.dashed((84, 148), (84, 200)); s.dashed((98, 148), (98, 200))
    s.text("GRAVEL DRIVE", s.px((91, 176)), 11, angle=90)
    s.text("LOT AREA: 32,600 SQ FT", (W / 2, 150), 14)
    s.north(960, 250)
    return s, {"file": "sample-large-lot-septic.jpg", "title": "Large lot with a well and septic field",
               "lot": lot, "front_edge": 3, "alley_edges": [], "buildings": {"House": house, "Shop": shop},
               "no_build": {"Septic field": septic, "Drainage easement": ease}, "zoning": "R-6"}


def main():
    os.makedirs(OUT, exist_ok=True)
    answers = {"about": "What each made-up sample survey really shows. Corners are on the survey reader's 0-1000 grid (x from the left edge, y from the top edge). Written by tools/make_samples.py; do not edit by hand.", "samples": []}
    for make in (city_lot_with_alley, corner_lot, large_lot_with_septic):
        s, a = make()
        s.im.save(os.path.join(OUT, a["file"]), "JPEG", quality=88)
        answers["samples"].append({
            "file": a["file"], "title": a["title"], "width_px": W, "height_px": H, "px_per_ft": s.k,
            "lot": s.norm(a["lot"]), "front_edge": a["front_edge"], "alley_edges": a["alley_edges"],
            "buildings": {k: s.norm(v) for k, v in a["buildings"].items()},
            "no_build": {k: s.norm(v) for k, v in a["no_build"].items()},
            "zoning": a["zoning"],
        })
        print(a["file"], os.path.getsize(os.path.join(OUT, a["file"])) // 1000, "KB")
    with open(os.path.join(OUT, "answers.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(answers, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
