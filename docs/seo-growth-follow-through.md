# SEO and customer-conversion follow-through — September 5, 2026

This release follows the [performance and dashboard review](performance-growth-review.md). It fixes observable search-entry problems while the new real-data activation and retention cohorts accumulate. Production reporting remains private; low-volume activity is not treated as evidence for pricing changes or a claimed conversion lift.

## Changes

| Finding | Change and resulting behavior |
| --- | --- |
| The drill-results landing page opened a file dialog that rejected CSV. | The dialog delegates CSV files to the existing parser and column mapper. A search visitor can now import drill collars without finding another upload control. |
| Project files imported through the claims dialog were tagged as registry imports. | Uploaded GeoJSON/KML/shapefiles retain `upload` provenance; CSV uses `csv`; registry results retain `registry`. This keeps source reporting defensible. |
| Tenure articles opened the map editor; some file and regional guides opened an unrelated workflow. | Centralize matching actions across navigation, article prompts and sidebars. Tenure guides open the monitor, file/drill guides open upload, and registry guides retain the relevant region. |
| The main SEO landing pages put their action after a long guide. | Add a matching starting action immediately after the introduction on all six landing pages, with clear Free/Pro terms. |
| Gallery figures downloaded large PNGs despite existing WebP variants. | Reuse the existing small/large WebPs with responsive source widths. Reserve intrinsic dimensions for gallery figures and PNG screenshots; retain eager hero and lazy below-fold loading. |
| Every build claimed that every article and sitemap URL had just changed. | Use explicit reviewed content revision dates, preserve known publication dates, and omit unknown modification dates. Display known article updates consistently with structured data. |
| Several guides promised credit-free exports for an email, vector PDF output, or unsupported output equivalence. | Align the copy with the current product: Free PNG includes a small credit; Pro removes it; PDF contains a rendered map image. Remove unsupported comparison and automatic-compliance claims. |
| App workspaces and operational routes could appear in search. | Add `X-Robots-Tag: noindex, follow` to admin, dashboard, account, tenure-monitor, shared-map and API routes. Public marketing pages, company pages and sitemaps remain indexable. |

No additional content pages or dependencies were added. The existing application boundaries and lazy engine loading remain in place.

## Measured impact and validation

The comparison-page map previously referenced a 2,759,411-byte PNG. Its existing WebP alternatives are 139,606 bytes and 317,162 bytes (about 95% and 89% smaller). Browsers choose the appropriate source for the viewport and display density. This is an asset-size reduction, not a measured improvement in field Core Web Vitals or rankings.

- 1,178 unit/component tests passed, including a future-build regression that verifies article/sitemap dates do not advance in 2040 without a content revision.
- 62 anonymous production-build browser tests passed. Four admin cases are skipped in this suite and run separately with configured auth fixtures.
- Eight configured admin flows passed across desktop and mobile. New browser cases cover CSV import, manual column mapping, upload attribution, matching tenure actions, mobile landing actions, WebP loading, overflow and indexability headers.
- Both anonymous and configured-auth builds passed their performance budgets. Configured homepage, editor, admin and claims startup graphs are 124.4, 301.6, 139.8 and 311.2 KiB gzip respectively. The new CSV handoff adds approximately 0.1 KiB to the editor graph.
- Lint has zero errors and the same 92 pre-existing warnings. Commit-specific CI and deployment results belong in the release PR.

## Content maintenance

Set `updatedDate` to a real `YYYY-MM-DD` content revision when a page receives a meaningful change. Do not update it merely because the site was rebuilt. Unknown dates should remain omitted. The seven articles with substantive copy corrections and all six landing pages revised here use September 5, 2026. Publication dates remain unchanged. The company sitemap's existing registry-snapshot dates are maintained by its separate pipeline.

When adding a gallery variant, update `scripts/blog-data/image-variants.json` with its actual dimensions. Keep screenshots relevant to the current workflow and check both narrow and wide layouts.

These choices follow Google's guidance on [accurate sitemap modification dates](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [robots response headers and crawl access](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), and [consistent canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls). A correct sitemap and indexable response do not prove Google has indexed or ranked a page.

## Weekly review

The enabled review runs Mondays at 04:00 America/Vancouver, beginning September 7, 2026. It targets completion by 05:15 and stops starting interactive work at 05:50, preserving the owner's before-06:00 preference.

Review the last seven complete Pacific days against the prior seven and a 28-day context. Prioritize real imports that reach useful exports, mature seven-day activation, week-two return, confirmed accounts, and Stripe-backed subscriptions/estimated MRR. Keep source denominators and cohort maturity explicit. Admin/demo activity and incomplete tracking must not become paid-customer claims.

Use the strongest evidence to make bounded, tested improvements through a branch, PR, passing release checks and production verification. If the data does not justify a change, report that instead. Leave an incomplete or higher-risk change reviewable with its concrete blocker. Customer data and private metrics must not be committed to the public repository.

Search Console and acquisition-spend reporting are not connected to this review. Do not infer search impressions, rankings, CAC, ROAS or collected revenue from public search results or subscription estimates. Direct Vercel account access is currently unavailable to the connector; deployment verification uses the existing GitHub integration and the public site.

The next measurement priority is Search Console coverage and query-to-page performance alongside the app's real-data conversion funnel. Reassess after enough complete cohorts are available. Rollback is an application revert through the existing deployment flow; this release requires no database migration.
