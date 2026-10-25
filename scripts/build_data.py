"""Fetch official housing data and assemble data/dashboard.json.

Sources pulled automatically:
  * INE IPV  (table 80270)  - quarterly house price index by region
  * INE ETDP (table 6150)   - monthly home sales by province
  * INE IPVA (table 59058)  - annual rent index by province
  * MIVAU valor tasado      - quarterly appraised €/m² by province
  * ECB                     - 12-month Euribor, monthly average
  * Eurostat prc_hpi_q      - house price growth, Spain vs EU peers
Hand-curated inputs live in data/curated/*.json and are merged in.

    pip install -r requirements.txt && python3 scripts/build_data.py
"""
import csv
import io
import json
import math
import re
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from geo import CCAA, PROVINCES, ccaa_code, is_national, province_code  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data")
INE = "https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/{}?nult={}"
MIVAU_XLS = "https://apps.fomento.gob.es/BoletinOnline2/sedal/35101000.XLS"
ECB = ("https://data-api.ecb.europa.eu/service/data/FM/"
       "M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA?format=csvdata&startPeriod=2005-01")
EUROSTAT = ("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hpi_q"
            "?unit=RCH_A&purchase=TOTAL&sinceTimePeriod=2015-Q1"
            "&geo=ES&geo=EU27_2020&geo=DE&geo=FR&geo=IT&geo=PT&geo=NL&geo=IE")
QUARTER = {19: 1, 20: 2, 21: 3, 22: 4}
YEAR_CELL = re.compile(r"^Año \d{4}\s*$")


def fetch(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "spain-housing-dashboard/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # network hiccups are common on the INE API
            if i == tries - 1:
                raise
            print(f"  retry {url[:70]}… ({e})")
            time.sleep(2 ** (i + 1))


def ine_table(table, nult):
    print(f"INE table {table}")
    return json.loads(fetch(INE.format(table, nult)))


def period_label(d):
    p = d["FK_Periodo"]
    if p in QUARTER:
        return f"{d['Anyo']}Q{QUARTER[p]}"
    if 1 <= p <= 12:
        return f"{d['Anyo']}-{p:02d}"
    return str(d["Anyo"])


def series_points(s):
    pts = [(period_label(d), d["Valor"]) for d in s["Data"] if d.get("Valor") is not None]
    return sorted(pts)


def geo_key(name, prefer_province=False):
    """Map an INE/MIVAU geography label to 'ES', a CCAA code (c01) or a province code (p28)."""
    if is_national(name):
        return "ES"
    p, c = province_code(name), ccaa_code(name)
    if prefer_province and p:
        return "p" + p
    if c:
        return "c" + c
    return "p" + p if p else None


def to_series(points):
    return {"t": [t for t, _ in points], "v": [round(v, 3) for _, v in points]}


# ---------------------------------------------------------------- INE IPV

def build_ipv():
    out = {}
    kinds = {"General": "all", "Vivienda nueva": "new", "Vivienda segunda mano": "used"}
    measures = {"Índice": "index", "Variación anual": "yoy", "Variación trimestral": "qoq"}
    for s in ine_table(80270, 120):
        parts = [p.strip() for p in s["Nombre"].split(".") if p.strip()]
        if len(parts) < 3 or parts[1] not in kinds or parts[2] not in measures:
            continue
        key = geo_key(parts[0])
        if key is None or (key != "ES" and parts[2] == "Variación trimestral"):
            continue
        out.setdefault(key, {})[f"{kinds[parts[1]]}_{measures[parts[2]]}"] = to_series(series_points(s))
    return out


# ---------------------------------------------------------------- INE ETDP

def build_sales():
    out = {}
    kinds = {"General": "all", "Vivienda nueva": "new", "Vivienda segunda mano": "used"}
    for s in ine_table(6150, 260):
        parts = [p.strip() for p in s["Nombre"].split(".") if p.strip()]
        if len(parts) < 2 or parts[1] not in kinds:
            continue
        # Region-level names ("Madrid, Comunidad de") and their province twin
        # ("Madrid") carry the same numbers; store each once.
        name = parts[0]
        keys = []
        if is_national(name):
            keys = ["ES"]
        else:
            if ccaa_code(name):
                keys.append("c" + ccaa_code(name))
            if province_code(name):
                keys.append("p" + province_code(name))
        for key in keys:
            if key.startswith("p") and kinds[parts[1]] != "all":
                continue  # provinces: total only, keeps the payload small
            out.setdefault(key, {}).setdefault(kinds[parts[1]], to_series(series_points(s)))
    return out


# ---------------------------------------------------------------- INE IPVA

def build_rent_index():
    out = {}
    for s in ine_table(59058, 20):
        parts = [p.strip() for p in s["Nombre"].split(".") if p.strip()]
        if len(parts) < 3 or parts[1] != "Total":
            continue
        m = {"Índice": "index", "Variación anual": "yoy"}.get(parts[2])
        key = geo_key(parts[0], prefer_province=True)
        if m and key:
            out.setdefault(key, {})[m] = to_series(series_points(s))
    return out


# ---------------------------------------------------------------- MIVAU

def build_appraisal():
    import xlrd

    print("MIVAU valor tasado")
    book = xlrd.open_workbook(file_contents=fetch(MIVAU_XLS))
    out = {}
    for sh in book.sheets():
        # header row holds "Año YYYY" every four columns; data rows follow
        hdr = next(r for r in range(sh.nrows) if any(YEAR_CELL.match(str(v)) for v in sh.row_values(r)))
        # each "Año YYYY" heads up to four quarter columns ("1º".."4º" two rows
        # down); the latest year is followed by "Variación" columns, not quarters
        qrow = sh.row_values(hdr + 2)
        cols = [(c + q, f"{str(v).split()[1]}Q{q + 1}")
                for c, v in enumerate(sh.row_values(hdr)) if YEAR_CELL.match(str(v))
                for q in range(4)
                if c + q < sh.ncols and str(qrow[c + q]).strip().startswith(str(q + 1))]
        for r in range(hdr + 1, sh.nrows):
            label = str(sh.cell_value(r, 1)).strip()
            if not label:
                continue
            keys = []
            if is_national(label):
                keys = ["ES"]
            else:
                if ccaa_code(label):
                    keys.append("c" + ccaa_code(label))
                if province_code(label):
                    keys.append("p" + province_code(label))
            for key in keys:
                for c, t in cols:
                    v = sh.cell_value(r, c)
                    if isinstance(v, float) and v > 0:
                        out.setdefault(key, {})[t] = round(v, 1)
    return {k: to_series(sorted(v.items())) for k, v in out.items()}


# ---------------------------------------------------------------- ECB / Eurostat

def build_euribor():
    print("ECB Euribor")
    rows = csv.DictReader(io.StringIO(fetch(ECB).decode()))
    pts = [(r["TIME_PERIOD"], float(r["OBS_VALUE"])) for r in rows if r.get("OBS_VALUE")]
    return to_series(sorted(pts))


def build_eu_hpi():
    print("Eurostat HPI")
    d = json.loads(fetch(EUROSTAT))
    geos = d["dimension"]["geo"]["category"]["index"]
    times = d["dimension"]["time"]["category"]["index"]
    nt = len(times)
    out = {}
    for g, gi in geos.items():
        pts = []
        for t, ti in times.items():
            v = d["value"].get(str(gi * nt + ti))
            if v is not None:
                pts.append((t.replace("-", ""), v))
        out[g] = to_series(sorted(pts))
    return out


# ---------------------------------------------------------------- yields

def latest(series):
    return series["t"][-1], series["v"][-1]


def build_yields(appraisal, market):
    """Gross rental yield by province (asking rent ÷ asking-equivalent price).

    Prices: MIVAU appraised €/m² rescaled to idealista's asking-price level using
    the national ratio (appraisals sit well below asking prices).
    Rents: idealista where published (province, or single-province region);
    otherwise the region's idealista rent scaled by the province's relative
    price with an elasticity fitted on the published provinces.
    """
    rent = market["rent"]
    nat_rent = rent["national"]["eur_m2"]
    _, nat_appr = latest(appraisal["ES"])
    k = market["sale"]["national"]["eur_m2"] / nat_appr

    def appr(key):
        return latest(appraisal[key])[1] if key in appraisal else None

    anchors = {}
    for code, (_, cc, _) in PROVINCES.items():
        r = rent["province"].get(code, {}).get("eur_m2")
        single = sum(1 for v in PROVINCES.values() if v[1] == cc) == 1
        if r is None and single:
            r = rent["ccaa"].get(cc, {}).get("eur_m2")
        if r:
            anchors[code] = r

    # Fit log(rent_p / rent_ref) = beta * log(price_p / price_ref) on multi-province anchors.
    xs, ys = [], []
    for code, r in anchors.items():
        cc = PROVINCES[code][1]
        ref_r = rent["ccaa"].get(cc, {}).get("eur_m2")
        if ref_r and appr("p" + code) and appr("c" + cc) and appr("p" + code) != appr("c" + cc):
            xs.append(math.log(appr("p" + code) / appr("c" + cc)))
            ys.append(math.log(r / ref_r))
    beta = sum(x * y for x, y in zip(xs, ys)) / sum(x * x for x in xs) if xs else 0.7
    beta = min(max(beta, 0.4), 1.0)

    out = {}
    for code, (name, cc, _) in PROVINCES.items():
        price_a = appr("p" + code)
        if not price_a:
            continue
        if code in anchors:
            r, method = anchors[code], "published"
        else:
            ref_r = rent["ccaa"].get(cc, {}).get("eur_m2")
            ref_p = appr("c" + cc)
            if not ref_r or not ref_p:  # region rent unpublished: scale from national
                ref_r, ref_p = nat_rent, nat_appr
            r, method = ref_r * (price_a / ref_p) ** beta, "modelled"
        price = price_a * k
        out[code] = {
            "rent_m2": round(r, 2), "rent_method": method,
            "rent_yoy": rent["province"].get(code, {}).get("yoy",
                        rent["ccaa"].get(cc, {}).get("yoy")),
            "price_m2": round(price), "appraisal_m2": price_a,
            "gross_yield": round(r * 12 / price * 100, 2),
        }
    return {
        "by_province": out, "beta": round(beta, 3), "asking_over_appraisal": round(k, 3),
        "national": {"rent_m2": nat_rent, "price_m2": market["sale"]["national"]["eur_m2"],
                     "gross_yield": round(nat_rent * 12 / market["sale"]["national"]["eur_m2"] * 100, 2)},
    }


# ---------------------------------------------------------------- main

def load(name):
    with open(os.path.join(DATA, "curated", name), encoding="utf-8") as fh:
        return json.load(fh)


def main():
    market = load("market.json")
    appraisal = build_appraisal()
    out = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "provinces": {c: {"name": n, "ccaa": cc} for c, (n, cc, _) in PROVINCES.items()},
        "ccaa": CCAA,
        "ipv": build_ipv(),
        "sales": build_sales(),
        "rent_index": build_rent_index(),
        "appraisal": appraisal,
        "euribor": build_euribor(),
        "eu_hpi": build_eu_hpi(),
        "market": market,
        "yields": build_yields(appraisal, market),
        "projections": load("projections.json"),
        "politics": load("politics.json"),
        "sources": load("sources.json"),
    }
    news = os.path.join(DATA, "news.json")
    if os.path.exists(news):
        with open(news, encoding="utf-8") as fh:
            out["news"] = json.load(fh)
    path = os.path.join(DATA, "dashboard.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {path} ({os.path.getsize(path) // 1024} KB)")


if __name__ == "__main__":
    main()
