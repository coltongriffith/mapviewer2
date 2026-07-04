# pSEO pipeline — /companies/[ticker] claim-map pages

Generates one static, indexable page per TSXV/CSE mining issuer showing its
mineral claims (map + claim table + stats), following the plan phases. Same
static-HTML pattern as `scripts/generate-blog.js` — no framework needed; pages
land in `public/companies/` on the main domain.

**Run order** (all commands from repo root; Node ≥ 18):

```
node scripts/pseo/01_fetch_issuers.mjs                 # issuers.csv (TSXV xlsx + CSE csv)
node scripts/pseo/02_fetch_claims_bc.mjs --discover    # verify field names, then:
node scripts/pseo/02_fetch_claims_bc.mjs               # claims_bc.csv (full pull)
node scripts/pseo/03_fetch_claims_on.mjs --discover    # find claims layer id, then:
node scripts/pseo/03_fetch_claims_on.mjs --layer N     # claims_on.csv
node scripts/pseo/04_match_owners.mjs                  # matches.csv + review_queue.csv
node scripts/pseo/05_fetch_geometry.mjs [--layer N]    # data/pseo/geo/[TICKER].geojson
node scripts/pseo/06_render_maps.mjs                   # SVG map + 1200×630 OG PNG per ticker
node scripts/pseo/07_generate_pages.mjs                # pages for tickers in publish_batch.txt
```

**End-to-end demo without network** (fictional companies, pages come out
noindex and are never sitemapped):

```
npm run pseo:fixture
npx vite preview   # → http://localhost:4173/companies/
```

## The review loop (Phase 1)

`04` writes two files:
- `matches.csv` — score ≥ 92 (auto). `verified` column is blank; **hand-verify
  the top-300 by market cap and set `verified=yes` before those pages ship.**
- `review_queue.csv` — scores 80–91. Confirm each row, append confirmed pairs to
  `data/pseo/aliases.csv` (`owner_raw,ticker`), re-run `04`.

Variants scoring below 80 are dropped silently — that's what aliases are for.
Real example from the fixtures: `CEDAR RIDGE RES. INC.` scores ~70 against
"Cedar Ridge Resources Inc." (abbreviated token), so it only matches once an
alias row exists. Numbered companies (`0987654 B.C. LTD.`) always need aliases;
hunt them through SEDAR+ subsidiary disclosures for the top-300.

## Rollout batching (Phase 4)

`07` only publishes tickers listed in `data/pseo/publish_batch.txt` (one per
line, `#` comments). Batch 1 = the ~100 outreach targets; verify indexing in
Search Console 1–2 weeks; then extend the file (batch 2 ≈ next 400, then the
rest). `--all` exists but **never bulk-publish all 1,250 on day one.**
`sitemap-companies.xml` is regenerated on every publish run — submit it in
Search Console alongside the existing `sitemap.xml`.

Delistings: remove the ticker from `publish_batch.txt`, delete
`public/companies/<ticker>/`, and serve a 410 (or redirect on name change) —
TSXV churns constantly, so run the prune monthly.

## Nightly refresh

Cron the pull + regenerate on any box (or a GitHub Action):

```
0 9 * * *  cd /path/to/repo && node scripts/pseo/02_fetch_claims_bc.mjs \
  && node scripts/pseo/03_fetch_claims_on.mjs --layer N \
  && node scripts/pseo/04_match_owners.mjs \
  && node scripts/pseo/05_fetch_geometry.mjs --layer N \
  && node scripts/pseo/06_render_maps.mjs \
  && node scripts/pseo/07_generate_pages.mjs && git add -A && git commit -m "pseo refresh" && git push
```

Every page shows "Claims updated {date}" from the run date.

## Notes & risks

- **ToS**: BC/ON registry layers are OGL-style open data, but confirm MTO's
  terms specifically before launch (plan → Risks). The disclaimer + "Report an
  error" link renders on every page; keep `PAGES.correctionEmail` current.
- **Endpoints move**: `--discover` fails loudly by design. CSE's CSV endpoint is
  undocumented — fallback is a manual export via `01 --cse-csv <file>`; the TSXV
  workbook likewise via `01 --xlsx <file>`.
- **Maps are tile-free vector plats** — no basemap-tile licensing questions on
  1,250 static pages; the "Open interactive version" link carries users into the
  app for the full basemap.
- **Pricing copy** is off (`PAGES.showPricing=false`) until the C$179/C$149
  SKUs are actually purchasable; pages say "free during early access" meanwhile.
- Generated CSVs, geometry, and `public/companies*/` output are gitignored —
  fixture demo pages (fictional companies) must never deploy to the live site.
  Once you're publishing real batches, remove those ignore lines so the nightly
  job can commit refreshed pages.
