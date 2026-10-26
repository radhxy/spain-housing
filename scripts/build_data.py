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
MIVAU_BUYERS_XLS = "https://apps.fomento.gob.es/BoletinOnline2/sedal/340101d0.XLS"
BDE_CSV = "https://www.bde.es/webbe/es/estadisticas/compartido/datos/csv/si_1_5.csv"
CAT_RENTS = ("https://analisi.transparenciacatalunya.cat/resource/hepw-33ik.json"
             "?$where=ambit_territorial%20in%20('Prov%C3%ADncia','Catalunya')&$limit=5000")
OECD_HOUSING = ("https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,1.0/"
                "ESP+PRT+IRL+GBR.Q.HPI_YDH+HPI_RPI.?startPeriod=1980-Q1&format=csvfilewithlabels")
ECB_MIR = "https://data-api.ecb.europa.eu/service/data/MIR/M.{}.B.A2C.A.R.A.2250.EUR.N?format=csvdata&startPeriod=2003-01"
BOE_RATE = ("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes"
            "&Datefrom=01/Jan/2003&Dateto=now&SeriesCodes=IUMBV34&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N")
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
            for key in row_keys(sh.cell_value(r, 1)):
                for c, t in cols:
                    v = sh.cell_value(r, c)
                    if isinstance(v, float) and v > 0:
                        out.setdefault(key, {})[t] = round(v, 1)
    return {k: to_series(sorted(v.items())) for k, v in out.items()}


def row_keys(label):
    """Geo keys for a MIVAU row label; single-province regions map to both."""
    label = str(label).strip()
    if not label:
        return []
    if is_national(label):
        return ["ES"]
    keys = []
    if ccaa_code(label):
        keys.append("c" + ccaa_code(label))
    if province_code(label):
        keys.append("p" + province_code(label))
    return keys


def build_buyers():
    """Notarised home purchases by buyer residence and nationality (MIVAU table 1.6).

    One sheet per quarter since 2007; columns are total, residents (Spanish /
    foreign / unknown), non-residents (Spanish / foreign / unknown), unknown.
    Spanish nationals are grouped together whether resident or not, so the
    split is: locals, foreigners living in Spain, foreigners buying from abroad.
    """
    import xlrd

    print("MIVAU transactions by buyer residence")
    book = xlrd.open_workbook(file_contents=fetch(MIVAU_BUYERS_XLS))
    out = {}
    for sh in book.sheets():
        q, year = sh.name.lower().split("t")
        t = f"{int(year)}Q{int(q)}"
        for r in range(sh.nrows):
            row = sh.row_values(r)
            if len(row) < 13 or not isinstance(row[3], float):
                continue
            num = [v if isinstance(v, float) else 0.0 for v in row]
            vals = {
                "total": num[3],
                "spanish": num[5] + num[9],
                "foreign_res": num[6],
                "foreign_nonres": num[10],
            }
            for key in row_keys(row[1]):
                for k, v in vals.items():
                    out.setdefault(key, {}).setdefault(k, {})[t] = int(v)
    return {key: {k: to_series(sorted(s.items())) for k, s in d.items()} for key, d in out.items()}


# ---------------------------------------------------------------- Banco de España

BDE_MONTHS = {m: i + 1 for i, m in enumerate(["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"])}
BDE_SERIES = {  # BdE code -> output name (table si_1_5, "Indicadores del mercado de la vivienda")
    "D_TKB57110_IPV": "price_income",        # house price / gross income per household (years)
    "D_TKB57210_IPV": "effort",              # theoretical annual mortgage effort, % of income
    "D_TKR60REA_VIV_IPV": "gross_yield",     # gross rental yield, trailing 12 months (%)
    "D_TKR600RV_VIV_IPV": "total_return",    # rental yield + capital gain (%)
    "DIP2025LTVA_C0411.M": "cpi_rent",       # CPI actual rents paid by tenants, y/y (%)
    "D_1KB56100_IDEA": "idealista_sale",     # idealista second-hand asking price €/m²
    "D_1KB56100_FOTO": "fotocasa_sale",      # Fotocasa second-hand asking price €/m²
    "D_IMVTIPLV": "mortgage_rate",           # new home-purchase loan rate (%)
    "DHIRINOAPLDMDUVT.T": "mortgage_term",   # average mortgage term (months)
    "DHIRINOAPLCPRUVT_TRPV.T": "ltv",        # average loan-to-value at purchase (%)
    "DHIRINOAPLCPRUVT_TPRPVS81.T": "ltv80",  # share of loans with LTV > 80% (%)
}


def build_bde():
    print("Banco de España housing indicators")
    rows = list(csv.reader(io.StringIO(fetch(BDE_CSV).decode("latin-1"))))
    codes, freqs = rows[0], rows[5]
    out = {}
    for i, code in enumerate(codes):
        name = BDE_SERIES.get(code)
        if not name:
            continue
        quarterly = freqs[i].startswith("TRIM")
        pts = []
        for r in rows[6:]:
            if len(r) <= i or not re.match(r"^[A-Z]{3} \d{4}$", r[0]) or r[i] in ("_", ""):
                continue
            mon, year = BDE_MONTHS[r[0][:3]], r[0][4:]
            t = f"{year}Q{(mon + 2) // 3}" if quarterly else f"{year}-{mon:02d}"
            pts.append((t, float(r[i])))
        out[name] = to_series(sorted(pts))
    return out


# ---------------------------------------------------------------- international affordability

INTL = {"ES": "ESP", "PT": "PRT", "IE": "IRL", "UK": "GBR"}
MORTGAGE_YEARS = 25


def _quarterly_mean(points):
    q = {}
    for t, v in points:  # t = YYYY-MM
        key = f"{t[:4]}Q{(int(t[5:7]) + 2) // 3}"
        q.setdefault(key, []).append(v)
    return {k: sum(v) / len(v) for k, v in q.items() if len(v) == 3}


def _rebase(series, start):
    """Index each country to its own average since `start` = 100, so levels read as above/below normal."""
    vals = [v for t, v in series.items() if t >= start]
    avg = sum(vals) / len(vals)
    return {t: round(v / avg * 100, 1) for t, v in series.items() if t >= start}


def build_intl():
    """Spain vs Portugal, Ireland and the UK on comparable affordability measures.

    price_income: OECD price-to-disposable-income index.
    mortgage_cost: price-to-income x the annual payment on a 25-year annuity at
    the country's new mortgage rate (ECB for euro countries, BoE 2-year fixed
    at 75% LTV for the UK), so it moves with both prices and the cost of credit.
    Both are rebased to each country's own average (1995+ and 2003+).
    """
    print("OECD / ECB / BoE international affordability")
    raw = {}
    for r in csv.DictReader(io.StringIO(fetch(OECD_HOUSING).decode("utf-8-sig"))):
        if r.get("OBS_VALUE"):
            raw.setdefault((r["REF_AREA"], r["MEASURE"]), {})[r["TIME_PERIOD"].replace("-", "")] = float(r["OBS_VALUE"])
    rates = {}
    for c in ("ES", "PT", "IE"):
        rows = csv.DictReader(io.StringIO(fetch(ECB_MIR.format(c)).decode()))
        rates[c] = _quarterly_mean((r["TIME_PERIOD"], float(r["OBS_VALUE"])) for r in rows if r.get("OBS_VALUE"))
    boe = csv.reader(io.StringIO(fetch(BOE_RATE).decode()))
    next(boe)
    rates["UK"] = _quarterly_mean(
        (datetime.strptime(r[0], "%d %b %Y").strftime("%Y-%m"), float(r[1])) for r in boe if len(r) == 2 and r[1])

    out = {}
    for c, iso in INTL.items():
        pti = raw.get((iso, "HPI_YDH"), {})
        cost = {}
        for t, p in pti.items():
            r = rates[c].get(t)
            if r is None:
                continue
            m, n = r / 1200, MORTGAGE_YEARS * 12
            cost[t] = p * 12 * m / (1 - (1 + m) ** -n)
        out[c] = {
            "price_income": to_series(sorted(_rebase(pti, "1995Q1").items())),
            "price_rent": to_series(sorted(_rebase(raw.get((iso, "HPI_RPI"), {}), "1995Q1").items())),
            "mortgage_rate": to_series(sorted((t, round(v, 2)) for t, v in rates[c].items())),
            "mortgage_cost": to_series(sorted(_rebase(cost, "2003Q1").items())),
        }
    return out


# ---------------------------------------------------------------- Catalonia (Incasòl deposits)

def build_catalonia_rents():
    """Average rent and count of new leases from the Incasòl deposit register, by province."""
    print("Catalonia signed-lease rents")
    rows = json.loads(fetch(CAT_RENTS))
    quarters = {"gener-març": 1, "abril-juny": 2, "juliol-setembre": 3, "octubre-desembre": 4}
    out = {}
    for r in rows:
        q = quarters.get(r.get("periode"))
        if not q or not r.get("renda"):
            continue
        key = "c09" if r["ambit_territorial"] == "Catalunya" else "p" + r["codi_territorial"].zfill(2)
        t = f"{r['any']}Q{q}"
        out.setdefault(key, {"rent": {}, "leases": {}})
        out[key]["rent"][t] = round(float(r["renda"]), 1)
        out[key]["leases"][t] = int(float(r.get("habitatges") or 0))
    return {k: {m: to_series(sorted(s.items())) for m, s in d.items()} for k, d in out.items()}


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


def build_yields(appraisal, market, api=None):
    """Gross rental yield by province (asking rent ÷ asking-equivalent price).

    Prices: MIVAU appraised €/m² rescaled to idealista's asking-price level using
    the national ratio (appraisals sit well below asking prices).
    Rents: idealista where published (province, or single-province region);
    otherwise the listing-level yield from the idealista API sample of the
    provincial capital (scripts/fetch_idealista.py, when credentials exist);
    otherwise the region's idealista rent scaled by the province's relative
    price with an elasticity fitted on the published provinces.
    """
    api = api or {}
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
        sample = api.get(code)
        if code in anchors:
            r, method = anchors[code], "published"
        elif sample and sample.get("n_rent", 0) >= API_MIN_LISTINGS and sample.get("n_sale", 0) >= API_MIN_LISTINGS:
            # apply the capital's listing yield to the province price level
            r, method = sample["rent_m2"] / sample["sale_m2"] * price_a * k, "api"
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


# ---------------------------------------------------------------- idealista

API_MIN_LISTINGS = 15
API_MAX_AGE_DAYS = 120


def load_idealista_api():
    """Fresh province samples written by scripts/fetch_idealista.py (empty without credentials)."""
    path = os.path.join(DATA, "idealista_api.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        samples = json.load(fh).get("provinces", {})
    today = datetime.now(timezone.utc).date()
    fresh = {}
    for code, s in samples.items():
        age = (today - datetime.strptime(s["date"], "%Y-%m-%d").date()).days
        if age <= API_MAX_AGE_DAYS:
            fresh[code] = s
    return fresh


def refresh_national_sale(market, bde):
    """Use BdE's monthly republication of idealista's national asking price when newer than the curated file."""
    s = bde.get("idealista_sale")
    if not s or not s["t"]:
        return
    t, v = s["t"][-1], s["v"][-1]
    nat = market["sale"]["national"]
    if t > market.get("sale_as_of", market["as_of"]):
        prev = s["v"][s["t"].index(t) - 12] if len(s["t"]) > 12 else None
        nat["eur_m2"] = v
        if prev:
            nat["yoy"] = round((v / prev - 1) * 100, 1)
        market["sale_as_of"] = t
        nat["via"] = "Banco de España (idealista series)"


# ---------------------------------------------------------------- main

def load(name):
    with open(os.path.join(DATA, "curated", name), encoding="utf-8") as fh:
        return json.load(fh)


def main():
    market = load("market.json")
    appraisal = build_appraisal()
    bde = build_bde()
    refresh_national_sale(market, bde)
    api = load_idealista_api()
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
        "yields": build_yields(appraisal, market, api),
        "idealista_api": {"provinces": api, "count": len(api)},
        "bde": bde,
        "buyers": build_buyers(),
        "catalonia_rents": build_catalonia_rents(),
        "intl": build_intl(),
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
