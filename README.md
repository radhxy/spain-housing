# Spain Housing Monitor

A dashboard tracking house prices, rents, rental yields and sales across Spain's 52 provinces, alongside the political fight over housing ahead of the 29 November 2026 general election.

## What's in it

| Section | Contents | Source |
|---|---|---|
| Overview | Headline KPIs, decree status, countdown to the 12 Nov ratification vote and the 29 Nov election | INE, MIVAU, idealista, ECB, BOE |
| Map | Province choropleth with a timeline (2005 → today) for appraised €/m², price change, 12-month sales and sales change, plus current yield, rent and rent change. Click a province for its history | MIVAU, INE ETDP, idealista |
| Prices & sales | INE price index (new vs second-hand), ranking by region, monthly sales, prices vs rents since 2015, Spain vs EU, Euribor | INE IPV/ETDP/IPVA, Eurostat, ECB |
| Yields | Gross yield for all 52 provinces, price vs yield scatter, method notes | idealista + MIVAU (modelled where unpublished) |
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

- **Automatic:** `.github/workflows/update-data.yml` runs daily. It pulls INE (IPV, ETDP, IPVA), the Ministry of Housing appraisal workbook, ECB Euribor, Eurostat and Google News, then commits the refreshed `data/`. For a public URL, enable GitHub Pages on this branch (Settings → Pages → Deploy from branch).
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
