# pSEO pipeline — /companies/[ticker] claim-map pages

Generates one static, indexable page per TSXV/CSE mining issuer showing its
mineral claims (map + claim table + stats). Same static-HTML pattern as
`scripts/generate-blog.js` — no framework needed; pages land in
`public/companies/` on the main domain and deploy through your existing
Vercel-on-push setup.

## Run it on GitHub (recommended — no local machine needed)

Two workflows live in `.github/workflows/`, both manual (Actions tab → select
workflow → **Run workflow**):

1. **pSEO — Discover registry schema** — read-only, changes nothing. Run this
   first to get the current Ontario MLAS claims-layer id (BC needs no id;
   government endpoints move without notice, so re-run this whenever a later
   step starts failing).
2. **pSEO — Generate company pages** — runs the full pipeline and opens a
   **Pull Request** with the result (it never pushes straight to `main`).
   Vercel auto-builds a preview deploy for that PR, so you can click through
   real company pages before anything goes live. Merging the PR is the actual
   publish step.

**First time:**
1. Add your issuer list. The exchanges block automated downloads (TSX returns
   HTTP 403 from a runner), so the reliable source is a hand-maintained CSV:
   copy `data/pseo/manual/issuers.example.csv` → `data/pseo/manual/issuers.csv`,
   fill in your batch (columns `ticker,exchange,company`), and commit it
   (GitHub's web "Add file" button works — no local setup needed). Step 01
   auto-detects that file; you don't touch any input.
2. Add a handful of tickers to `data/pseo/publish_batch.txt` (small PR, review
   as normal — only tickers listed there ever get a live page).
3. Run *Generate*. The Ontario claims-layer id is hardcoded (`layer 1`); leave
   `on_layer` blank unless a *Discover* run shows LIO renumbered the service.
4. On the opened PR: check `data/pseo/review_queue.csv` for real matches
   (confirmed ones go in `data/pseo/aliases.csv` for next run), hand-verify the
   top ~300 tickers by market cap in `data/pseo/matches.csv`, click through the
   Vercel preview, then merge.

Re-run *Generate* any time to refresh data (claim status, good-to dates) —
each run's PR shows exactly what changed.

## Run it locally (alternative)

```
node scripts/pseo/01_fetch_issuers.mjs                 # issuers.csv (uses data/pseo/manual/issuers.csv if present)
node scripts/pseo/02_fetch_claims_bc.mjs --discover    # verify field names, then:
node scripts/pseo/02_fetch_claims_bc.mjs               # claims_bc.csv (full pull)
node scripts/pseo/03_fetch_claims_on.mjs --discover    # find claims layer id, then:
node scripts/pseo/03_fetch_claims_on.mjs --layer N     # claims_on.csv
node scripts/pseo/04_match_owners.mjs                  # matches.csv + review_queue.csv
node scripts/pseo/05_fetch_geometry.mjs --layer N      # data/pseo/geo/[TICKER].geojson
node scripts/pseo/06_render_maps.mjs --skip-og         # SVG map per ticker (see OG images below)
node scripts/pseo/07_generate_pages.mjs                # pages for tickers in publish_batch.txt
```

Then review the same way (`review_queue.csv`, `matches.csv`, `npx vite
preview`) and commit/push yourself when ready.

**End-to-end demo without network** (fictional companies; pages come out
`noindex` and nothing is sitemapped):

```
npm run pseo:fixture
npx vite preview   # → http://localhost:4173/companies/
```

## The review loop (owner matching)

`04` writes two files:
- `matches.csv` — score ≥ 92 (auto). `verified` column is blank; **hand-verify
  the top-300 by market cap and set `verified=yes` before those pages are
  trusted.**
- `review_queue.csv` — scores 80–91. Confirm each row, append confirmed pairs
  to `data/pseo/aliases.csv` (`owner_raw,ticker`), re-run `04`.

Variants scoring below 80 are dropped silently — that's what aliases are for.
Real example from the fixtures: `CEDAR RIDGE RES. INC.` scores ~70 against
"Cedar Ridge Resources Inc." (abbreviated token), so it only matches once an
alias row exists. Numbered companies (`0987654 B.C. LTD.`) always need
aliases; hunt them through SEDAR+ subsidiary disclosures for the top-300.

Both `aliases.csv` and `publish_batch.txt` are small, human-curated, and
**tracked in git** (edit them via normal PRs) — they're the only pipeline
inputs that need to persist between runs. Everything else regenerates fresh
each time.

## Rollout batching

`07` only publishes tickers listed in `data/pseo/publish_batch.txt` (one per
line, `#` comments). Batch 1 = the ~100 outreach targets; verify indexing in
Search Console 1–2 weeks; then extend the file (batch 2 ≈ next 400, then the
rest). `--all` exists (local runs only, not exposed in the GitHub workflow) but
**never bulk-publish all 1,250 on day one.** `sitemap-companies.xml`
regenerates on every publish run — submit it in Search Console alongside the
existing `sitemap.xml`.

Delistings: remove the ticker from `publish_batch.txt`, delete
`public/companies/<ticker>/`, and serve a 410 (or redirect on name change) —
TSXV churns constantly, so run this prune monthly.

## OG images (optional, off by default)

`06_render_maps.mjs` defaults to `--skip-og` because rendering the 1200×630
`og:image` needs Playwright + a Chromium binary, which isn't installed by
default (keeps the GitHub Action fast and dependency-light for launch). Pages
without a rendered OG image fall back to the site's default `og-image.png`
automatically — nothing breaks. To turn OG images on later: `npm i -D
playwright`, add a `npx playwright install --with-deps chromium` step to
`pseo-generate.yml` before the render step, and drop `--skip-og`.

## Notes & risks

- **ToS**: BC/ON registry layers are OGL-style open data, but confirm MTO's
  terms specifically before launch. The disclaimer + "Report an error" link
  renders on every page; keep `PAGES.correctionEmail` current.
- **Endpoints move**: `--discover` fails loudly by design rather than
  publishing on stale/wrong data.
- **Maps are tile-free vector plats** — no basemap-tile licensing questions on
  1,250 static pages; the "Open interactive version" link carries visitors
  into the app for the full basemap experience.
- **Pricing copy** is off (`PAGES.showPricing=false`) until the C$179/C$149
  SKUs are actually purchasable; pages say "free during early access" instead.
- Large raw registry pulls (`claims_bc.csv`, `claims_on.csv`) and the
  per-ticker geometry cache (`geo/`) are gitignored — they're multi-MB and
  fully reproducible from a fresh pipeline run, so there's no reason to store
  them. Everything that actually needs to persist or deploy (`aliases.csv`,
  `publish_batch.txt`, `matches.csv`, `review_queue.csv`, `issuers.csv`, and
  the generated `public/companies*` output) is tracked in git.
