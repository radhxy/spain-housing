"""One-off: build data/geo/provinces.geojson from the click_that_hood province file.

Simplifies the outlines (Douglas-Peucker), rounds coordinates, keys every
feature by INE province code and moves the Canary Islands into an inset
south-west of the peninsula, as Spanish maps usually do.

    python3 scripts/make_geo.py path/to/spain-provinces.geojson
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from geo import PROVINCES  # noqa: E402

TOLERANCE = 0.012  # degrees, about 1 km
CANARY_SHIFT = (5.2, 6.6)  # lon, lat
CANARIAS = {"35", "38"}
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "geo", "provinces.geojson")


def _perp(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / (dx * dx + dy * dy) ** 0.5


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0.0, None
        for k in range(i + 1, j):
            d = _perp(pts[k], pts[i], pts[j])
            if d > best:
                best, idx = d, k
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(pts, keep) if k]


def ring(r, shift):
    pts = simplify(r, TOLERANCE)
    if len(pts) < 4:
        return None
    return [[round(x + shift[0], 3), round(y + shift[1], 3)] for x, y in pts]


def polygon(rings, shift):
    out = [ring(r, shift) for r in rings]
    if out[0] is None:
        return None
    return [r for r in out if r]


def main(src):
    feats = []
    for f in json.load(open(src, encoding="utf-8"))["features"]:
        code = f["properties"]["cod_prov"].zfill(2)
        shift = CANARY_SHIFT if code in CANARIAS else (0, 0)
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        polys = [p for p in (polygon(p, shift) for p in polys) if p]
        if not polys:  # tiny territory: keep the raw outline
            polys = [[[[round(x + shift[0], 4), round(y + shift[1], 4)] for x, y in g["coordinates"][0]]]]
        feats.append({
            "type": "Feature",
            "properties": {"code": code, "name": PROVINCES[code][0], "ccaa": PROVINCES[code][1]},
            "geometry": {"type": "MultiPolygon", "coordinates": polys},
        })
    feats.sort(key=lambda f: f["properties"]["code"])
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(feats)} provinces, {os.path.getsize(OUT) // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1])
