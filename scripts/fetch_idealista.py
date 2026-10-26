"""Sample idealista listings through the official API into data/idealista_api.json.

Needs API credentials from https://developers.idealista.com (set the
IDEALISTA_API_KEY and IDEALISTA_API_SECRET environment variables, or GitHub
secrets of the same name). Without them the script exits quietly.

For each province it searches homes for sale and for rent within a radius of
the provincial capital and stores the median asking €/m². build_data.py then
uses the sale/rent pair as a listing-level gross yield for provinces that
idealista's monthly report doesn't cover.

The free API tier allows roughly 100 requests a month, so each run only
refreshes the stalest provinces, within a request budget:
  IDEALISTA_MAX_REQUESTS   requests per run           (default 40)
  IDEALISTA_REFRESH_DAYS   re-sample after this many  (default 56)
"""
import base64
import json
import os
import statistics
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(__file__))
from geo import PROVINCES  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "idealista_api.json")
TOKEN_URL = "https://api.idealista.com/oauth/token"
SEARCH_URL = "https://api.idealista.com/3.5/es/search"
RADIUS_M = 6000
MAX_ITEMS = 50

# provincial capitals (lat, lon)
CAPITALS = {
    "01": (42.846, -2.672), "02": (38.994, -1.858), "03": (38.345, -0.481), "04": (36.834, -2.464),
    "05": (40.656, -4.700), "06": (38.879, -6.970), "07": (39.570, 2.650), "08": (41.387, 2.170),
    "09": (42.344, -3.697), "10": (39.475, -6.372), "11": (36.527, -6.288), "12": (39.986, -0.051),
    "13": (38.985, -3.927), "14": (37.888, -4.779), "15": (43.362, -8.411), "16": (40.070, -2.137),
    "17": (41.979, 2.821), "18": (37.177, -3.599), "19": (40.633, -3.167), "20": (43.318, -1.981),
    "21": (37.261, -6.945), "22": (42.136, -0.408), "23": (37.779, -3.785), "24": (42.599, -5.567),
    "25": (41.618, 0.620), "26": (42.466, -2.445), "27": (43.012, -7.556), "28": (40.417, -3.704),
    "29": (36.721, -4.421), "30": (37.992, -1.131), "31": (42.812, -1.646), "32": (42.336, -7.864),
    "33": (43.362, -5.849), "34": (42.010, -4.532), "35": (28.124, -15.430), "36": (42.431, -8.644),
    "37": (40.970, -5.664), "38": (28.464, -16.251), "39": (43.462, -3.810), "40": (40.943, -4.109),
    "41": (37.389, -5.984), "42": (41.764, -2.464), "43": (41.119, 1.245), "44": (40.345, -1.106),
    "45": (39.863, -4.027), "46": (39.470, -0.376), "47": (41.652, -4.724), "48": (43.263, -2.935),
    "49": (41.503, -5.746), "50": (41.649, -0.889), "51": (35.889, -5.321), "52": (35.292, -2.938),
}


def post(url, data, headers):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def token(key, secret):
    auth = base64.b64encode(f"{key}:{secret}".encode()).decode()
    res = post(TOKEN_URL, {"grant_type": "client_credentials", "scope": "read"},
               {"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
    return res["access_token"]


def search(tok, operation, center):
    return post(SEARCH_URL, {
        "operation": operation, "propertyType": "homes", "center": f"{center[0]},{center[1]}",
        "distance": RADIUS_M, "maxItems": MAX_ITEMS, "numPage": 1, "order": "publicationDate", "sort": "desc",
    }, {"Authorization": f"Bearer {tok}", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})


def median_m2(elements, lo, hi):
    """Median €/m² of listings, dropping obvious outliers (bad sizes, holiday lets, typos)."""
    vals = []
    for e in elements:
        size, price = e.get("size"), e.get("price")
        if not size or not price or size < 20 or size > 400:
            continue
        v = price / size
        if lo <= v <= hi:
            vals.append(v)
    return (round(statistics.median(vals), 2) if vals else None), len(vals)


def summarise(code, sale, rent):
    sale_m2, n_sale = median_m2(sale.get("elementList", []), 300, 20000)
    rent_m2, n_rent = median_m2(rent.get("elementList", []), 3, 60)
    return {
        "date": date.today().isoformat(), "center": CAPITALS[code], "radius_m": RADIUS_M,
        "sale_m2": sale_m2, "rent_m2": rent_m2, "n_sale": n_sale, "n_rent": n_rent,
        "gross_yield": round(rent_m2 * 12 / sale_m2 * 100, 2) if sale_m2 and rent_m2 else None,
        "total_sale": sale.get("total"), "total_rent": rent.get("total"),
    }


def main():
    key, secret = os.environ.get("IDEALISTA_API_KEY"), os.environ.get("IDEALISTA_API_SECRET")
    if not key or not secret:
        print("idealista: no API credentials set, skipping")
        return
    budget = int(os.environ.get("IDEALISTA_MAX_REQUESTS", 40))
    refresh = int(os.environ.get("IDEALISTA_REFRESH_DAYS", 56))
    store = {"provinces": {}}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as fh:
            store = json.load(fh)
    have = store["provinces"]
    today = date.today()

    def age(code):
        s = have.get(code)
        return 10_000 if not s else (today - datetime.strptime(s["date"], "%Y-%m-%d").date()).days

    due = sorted((c for c in PROVINCES if age(c) >= refresh), key=age, reverse=True)
    due = due[: budget // 2]  # two requests (sale + rent) per province
    if not due:
        print("idealista: all provinces fresh")
        return
    tok = token(key, secret)
    for code in due:
        try:
            sale = search(tok, "sale", CAPITALS[code])
            time.sleep(1.1)  # API allows about one request per second
            rent = search(tok, "rent", CAPITALS[code])
            time.sleep(1.1)
        except Exception as e:  # keep what we have if quota runs out mid-run
            print(f"idealista: stopped at {code} ({e})")
            break
        have[code] = summarise(code, sale, rent)
        s = have[code]
        print(f"  {PROVINCES[code][0]}: sale €{s['sale_m2']}/m² (n={s['n_sale']}), rent €{s['rent_m2']}/m² (n={s['n_rent']})")
    store["updated"] = today.isoformat()
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, indent=1)
    print(f"idealista: sampled {len(due)} provinces")


if __name__ == "__main__":
    main()
