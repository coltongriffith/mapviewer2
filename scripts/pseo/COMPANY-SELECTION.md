# Company Selection Brief — /companies/ claim-map pages

Purpose: give a researcher (human or agent) everything needed to pick the **top
~100 companies** for Exploration Maps' programmatic company pages, and to hand
the result back in the exact format the pipeline consumes.

Live example: https://www.explorationmaps.com/companies/got/ (Goliath Resources,
94 BC claims, ~90,700 ha — this is what a *good* fit produces.)

---

## 1. What the feature is

Exploration Maps auto-generates one static, Google-indexable page per junior
mining company at `explorationmaps.com/companies/[ticker]`. Each page shows:

- A rendered **map of the company's mineral claims** (title block, scale bar,
  north arrow, "Map by Exploration Maps" watermark)
- Stats: claim count, total hectares, provinces, earliest good-to date
- A **claim table** (claim ID, name, area, good-to date, province)
- Links to neighbouring companies' pages, a "Claim this page" CTA aimed at the
  company's IR team, and a free-export CTA aimed at anyone researching the stock
- A disclaimer that the official registry is authoritative + a correction email

The business goal: rank for "\[company name] claims / claim map / property map"
searches, get discovered by the company's own IR/management (Zillow's
"claim your home" play), and convert them into Exploration Maps users.

Everything is generated from **public provincial registry data** — the company
does not need to participate or consent for a page to exist.

## 2. Hard eligibility requirements (all must be true)

The pipeline can only build a page for a company that passes every one of
these. A candidate that fails any of them is a wasted slot.

1. **Listed on TSXV or CSE** (mineral exploration / mining issuer).
2. **Holds ACTIVE mineral claims in British Columbia or Ontario.** These are
   the only two registries the pipeline pulls (BC Mineral Titles WFS + Ontario
   MLAS). Yukon, Quebec, Saskatchewan, NWT, Nunavut, and all foreign ground
   are invisible to it. Real examples from batch 1: Snowline Gold (SGD —
   flagship in Yukon) and Founders Metals (FDR — Suriname) produced **zero
   claims and no page**; Goliath Resources (GOT — Golden Triangle, BC)
   produced a full page.
3. **Claims are registered to the company's own legal name** (or a name we can
   map to it). The pipeline matches the registry's *registered owner* string
   against the issuer's legal name with fuzzy matching. "GOLIATH RESOURCES LTD"
   ↔ "Goliath Resources Limited" matches automatically. Claims held through a
   differently-named subsidiary (e.g. "1234567 B.C. LTD.") do NOT match unless
   we're told the alias. Claims optioned from a prospector but still registered
   to the vendor do not match at all — and would misattribute the ground if
   they somehow did.
4. **Claims are in good standing.** Tenures past their good-to/due date are
   filtered out. A company whose ground has lapsed gets no page.

## 3. What makes a company a TOP fit (ranking criteria)

Rank passing candidates by how many of these they hit:

- **BC or Ontario is the flagship**, not incidental ground. The page's map is
  the product demo; a company whose story is 90% Yukon with two stray BC cells
  gets a page that misrepresents it — skip those.
- **Registered owner ≈ legal name.** Prefer companies you can confirm hold
  claims under their own name (see §4 verification). Every alias we have to
  discover manually adds friction and risk of misattribution.
- **A substantial, contiguous claim package** (thousands of hectares, tens of
  claims). Big packages render into impressive maps; a 2-cell holding makes a
  thin page. Soft floor: ~5 claims or ~1,000 ha.
- **Active news flow** — drilling, assays, financings in the last 12 months.
  These names get searched (SEO demand exists) and their IR teams are engaged
  (conversion likelihood exists).
- **Real market presence** — market cap roughly C$5M–C$500M. Below that,
  nobody searches for them; far above, they have GIS departments and won't
  convert. The sweet spot is the active junior explorer with a lean team.
- **Zimtu network proximity** — companies Zimtu covers, has financed, shares
  directors with, or sees at conferences. Batch 1 doubles as a warm-outreach
  list; a page you can text to someone beats a page waiting for Google.
- **Geographic clustering.** Pages cross-link to their nearest neighbours, so
  10 Golden Triangle companies reinforce each other more than 10 scattered
  ones. Prioritize clusters: Golden Triangle / Stewart (BC), Toodoggone (BC),
  central BC porphyry belt, Abitibi Ontario side, Timmins, Red Lake,
  Thunder Bay / Ring of Fire periphery.

## 4. How to verify a candidate (do this before listing it)

For each shortlisted company:

1. **Confirm project location** from the company's website / latest corporate
   presentation / SEDAR+ filings: is the flagship actually in BC or Ontario?
2. **Confirm registered ownership** in the public registry:
   - BC: Mineral Titles Online free map viewer / tenure search
     (registered-owner search on the exact company name; try "LTD"/"LIMITED"/
     "CORP" variants).
   - Ontario: MLAS map viewer claim-holder search.
   If the claims appear under a subsidiary or JV vehicle, record that exact
   registered string as an **alias** (see §5 output format).
3. **Sanity-check standing**: are the good-to dates in the future?
4. Record confidence: `high` (saw claims under the company's name),
   `medium` (project confirmed in BC/ON but couldn't verify registered name),
   `low` (inference only). Only `high` and `medium` belong in the top 100.

## 5. Output format (what to hand back)

Three artifacts, all plain text:

**a) `data/pseo/manual/issuers.csv`** — one row per company:

```csv
ticker,exchange,company,sector,market_cap
GOT,TSXV,Goliath Resources Limited,Mining,150000000
```

- `ticker`: bare root ticker, no `.V`/`.TO`/`.CN` suffix.
- `exchange`: `TSXV` or `CSE`.
- `company`: the **full legal name** exactly as registered (this drives the
  registry match — "Goliath Resources Limited", not "Goliath Resources" or
  "Goliath Res."). Pull it from SEDAR+ or the exchange listing, not a news
  headline.
- `sector`: `Mining` is fine.
- `market_cap`: approximate CAD number, optional — it only orders the
  hand-verification queue.

**b) `data/pseo/publish_batch.txt`** — one ticker per line for the companies
that should actually go live (suffixed forms like `GOT.V` are accepted).

**c) Aliases (only where found)** — for claims registered under a different
name, rows for `data/pseo/aliases.csv`:

```csv
owner_raw,ticker
1234567 B.C. LTD.,XYZ
```

`owner_raw` must be the registry's exact registered-owner string.

Plus, ideally: a notes column/file per company — flagship project, region
cluster, confidence level, and why it made the list — so the batch can be
hand-reviewed fast.

## 6. Anti-goals (do not include)

- Companies whose only BC/ON ground is optioned/earn-in and still registered
  to the vendor.
- Shells with no active ground, or ground that lapses within ~60 days.
- Companies with pending name changes/mergers (the page would be stale on
  arrival).
- Anything where attribution is uncertain: a page that shows the wrong claims
  under a company's name is a reputational problem for us and them — the
  pipeline's review queue exists precisely to keep 80–91% fuzzy matches from
  auto-publishing.
- Oil & gas, coal-only, or industrial-minerals issuers whose "claims" are a
  different tenure type — stick to mineral claims.

## 7. Context an agent might need

- Matching thresholds: name-score ≥92 auto-accepts; 80–91 goes to a human
  review queue; aliases.csv overrides everything.
- Pages cap their claim table at 400 rows; gigantic holders still work but the
  table truncates.
- The pipeline refreshes from the registries on every run, filters expired
  tenures, and deletes pages for companies that drop out — so the list can be
  revised freely between runs.
- Rollout is deliberately batched via `publish_batch.txt`; the top-100 list
  does not go live at once. Indexing health is checked before expanding.
