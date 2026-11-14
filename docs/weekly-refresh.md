# Weekly refresh

Official series (INE, Ministry of Housing, Banco de España, ECB, Eurostat, OECD,
Bank of England, Incasòl) and headlines refresh daily through
`.github/workflows/update-data.yml`. This checklist covers the parts that need
research, done once a week, on branch `claude/spain-housing-dashboard-5rejd0`.

1. **Sync.** `git pull origin claude/spain-housing-dashboard-5rejd0` (the daily job commits to it).
2. **Rents** (`data/curated/market.json`): if idealista has published a new monthly
   rent report since `as_of`, update the national €/m², y/y and q/q, every region's
   y/y and any €/m² given, and the provinces named. Press-agency copies of the
   idealista press release (Europa Press via diariosigloxxi.com, democrata.es) carry
   the full text; idealista.com blocks automated access. Keep a figure from an
   earlier month only where the new report doesn't give one, and say so in `_note`.
   idealista's sale prices are quarterly and reach the dashboard through Banco de
   España automatically, so leave `sale` alone unless a new quarterly figure is out
   and BdE hasn't caught up. Refresh Fotocasa or other indicators in
   `other_indicators` if a newer release exists.
3. **Politics** (`data/curated/politics.json`):
   - Add timeline events since `updated`: laws, votes, court rulings, protests,
     pledges, election results and government formation. Each needs a date,
     category, title, a one- or two-sentence detail and a source URL.
   - Update `decrees` statuses, `headline` and `upcoming` (drop dates that have
     passed, add new ones).
   - Add new polls as rows, entering only figures a pollster or aggregator
     published. After an election, add the result and stop adding polls.
   - Update `parties` when positions change.
   - Set `updated` to today.
4. **Forecasts** (`data/curated/projections.json`): add a row for each new published
   house-price or sales forecast (source, publication date, year, value, URL, and a
   note for ranges or approximations). Never edit old vintages. After the election,
   update the scenario probabilities and rationales to reflect the result.
5. **Sources** (`data/curated/sources.json`): add any new source used.
6. **Build and check.** Run `pip install -r requirements.txt`, then
   `python3 scripts/fetch_news.py && python3 scripts/build_data.py`. Confirm
   `stale_sources` in `data/dashboard.json` is empty, or note which source was down.
   Serve the folder (`python3 -m http.server`), load it in headless Chromium and
   confirm there are no console errors.
7. **Publish.** Commit with a message listing what changed, and push to
   `claude/spain-housing-dashboard-5rejd0`. GitHub Pages redeploys automatically.
   If a push is rejected because the daily job committed first, merge (don't
   rebase), rebuild `data/dashboard.json`, and push again.

Rules: only enter figures you have found in a source, cite every addition, and
where sources disagree, say so in the item's detail instead of picking one silently.
