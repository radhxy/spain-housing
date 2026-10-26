# Spain Housing Monitor

A dashboard tracking house prices, rents, rental yields and sales across Spain's 52 provinces, alongside the political fight over housing ahead of the 29 November 2026 general election.

## What's in it

| Section | Contents | Source |
|---|---|---|
| Overview | Headline KPIs, decree status, countdown to the 12 Nov ratification vote and the 29 Nov election | INE, MIVAU, idealista, ECB, BOE |
| Map | Province choropleth with a timeline (2005 → today) for appraised €/m², price change, 12-month sales and sales change, plus current yield, rent and rent change. Click a province for its history | MIVAU, INE ETDP, idealista |
| Prices & sales | INE price index (new vs second-hand), ranking by region, monthly sales, prices vs rents since 2015, Spain vs EU, Euribor | INE IPV/ETDP/IPVA, Eurostat, ECB |
| Affordability | Price ÷ household income and mortgage effort since 1987, with the pre-GFC peak, GFC trough and today marked; Spain vs Portugal, Ireland and the UK on comparable indices; mortgage rate, term and LTV | Banco de España, OECD, ECB, Bank of England |
| Who's buying | Purchases by Spanish nationals, resident foreigners and non-resident foreigners; foreign share; a shock detector for foreign-led declines; contribution of each group to the change in sales; province exposure calculator | Ministry of Housing (notarial data by buyer residence) |
| Yields & rents | Gross yield for all 52 provinces, price vs yield, official BdE yield since 1987, asking vs paid rents, and Catalonia's signed-lease rents before and after the 2024 caps | idealista (reports + API), MIVAU, BdE, INE, Incasòl |
| Outlook | Every published 2026/27 forecast against INE actuals, a real-time check that recomputes on each release, and an interactive election-scenario model to 2028 | BBVA Research, S&P, Fitch, CaixaBank, Bankinter + own model |
| Politics | Timeline of laws, votes, protests and campaign pledges; polls; party positions on housing | BOE, Congreso, press, poll aggregators |
| News | Latest Spanish and English headlines, tagged by topic | Google News RSS |
| Sources | Catalogue of 23 sources that track Spanish housing, showing which are automated, curated or candidates to add | — |

## Run locally

```bash
pip install -r requirements.txt
python3 scripts/fetch_news.py      # headlines -> data/news.json
python3 scripts/build_data.py      # official data + curated files -> data/dashboard.json
python3 -m http.server 8000        # open http://localhost:8000
```

## Keeping it current

- **Automatic:** `.github/workflows/update-data.yml` runs daily. It pulls INE (IPV, ETDP, IPVA), the Ministry of Housing appraisal and buyer-residence workbooks, Banco de España housing indicators, Catalonia's Incasòl lease register, ECB Euribor, Eurostat and Google News, then commits the refreshed `data/`. The national idealista sale price also updates automatically through Banco de España's monthly republication.
- **idealista API (optional):** request access at https://developers.idealista.com/access-request, then add `IDEALISTA_API_KEY` and `IDEALISTA_API_SECRET` as repository secrets (Settings → Secrets and variables → Actions). `scripts/fetch_idealista.py` then samples sale and rent listings around each provincial capital. To stay within the free quota (about 100 requests a month), each province is refreshed about every 8 weeks. These samples replace modelled rents in the yield table.
- **Hosting:** `.github/workflows/pages.yml` redeploys the site to GitHub Pages after every push and data refresh: https://radhxy.github.io/spain-housing/
- **By hand** (sites that block automated access, and political events):
  - `data/curated/market.json`: idealista and Fotocasa rents and sale prices, once a month after each report (around the 1st).
  - `data/curated/politics.json`: timeline, upcoming dates, decree status, polls and party positions.
  - `data/curated/projections.json`: new forecasts (add a row per vintage) and the scenario assumptions.
  - `data/curated/sources.json`: the source catalogue.

## Method notes

- **Gross yield** = 12 × asking rent ÷ asking price. Prices are the Ministry of Housing's appraised €/m², rescaled so the national level matches idealista's asking price. Rents come from idealista where published. Elsewhere they are modelled as region rent × (province price ÷ region price)^β, with β fitted on the provinces that have published figures. As a check, the modelled Madrid price (€5,088/m²) is close to idealista's published €5,065/m².
- **Scenario model**: the dashboard's own illustrative assumptions, not a forecast. The baseline is the average of the latest published forecasts. Each election outcome adds documented adjustments to price, rent and sales growth for 2027–28, and a Euribor sensitivity of −2 pp of price growth per +1 pp of rates. Default probabilities loosely reflect late-October polls, and every assumption can be adjusted on the page.
- Portal figures are asking prices. INE and Ministry series are official but published with a lag: INE IPV is quarterly, about 10 weeks after quarter-end.

Province boundaries come from [click_that_hood](https://github.com/codeforgermany/click_that_hood), simplified with `scripts/make_geo.py`. The Canary Islands are shown as an inset.
