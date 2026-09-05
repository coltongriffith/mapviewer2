# September 2026 growth release

## What changes

- The public homepage mounts without the map/import/export workspace. A shared Vite preload helper has its own chunk so dynamic imports do not eagerly fetch the PDF engine. Build budgets now check the homepage's complete static import graph as well as total JavaScript; browser tests check the actual request graph. Returning users can still open local recent projects.
- Initial JavaScript measures about 59 kB gzip in the anonymous test build and 124 kB with Supabase Auth configured. CI checks both configurations. These are transfer sizes, not a measured Core Web Vitals improvement.
- Static SEO pages and React share a 90-day, first-touch attribution record across tabs. Only allowlisted campaign, click ID, referrer hostname, landing path, company ticker, and acquisition session fields are retained. Internal CTA tags do not overwrite an existing source. The privacy page describes this storage.
- Signup-time attribution is attached to new Supabase accounts as analytics metadata. Confirmed-account events use verified server identity and confirmation time, including delayed confirmations. Delivery failures can retry; the existing event primary key prevents concurrent-tab duplicates. Historical signup rows are preserved. Metadata never grants permissions.
- Export email-link status is visible, including failure and retry. The export continues independently. Links return to the editor; local draft recovery remains limited to the same browser/device. Creating an account alone does not guarantee that a cloud save has finished.
- Onboarding leads from actual claims/imports to a 16:9 investor layout, PNG export, and account saving. `export_completed.props.real_data` distinguishes supported real import sources from demos for new layers. Legacy layers without provenance must be treated as unknown, not proven demos or own-company data.
- Paid checkout verification returns Stripe's actual total, currency, live/test mode, and transaction ID. The existing Google Ads purchase action receives the verified live amount and transaction ID once. Pending/test/unverified checkouts do not emit a purchase conversion. Recurring invoices remain server-side billing records, not new browser checkout events.
- Search landing-page CTAs enter the matching registry, upload, or tenure workflow. Company-page copy now states the actual free PNG credit and Pro removal behavior.

## Company-data review

Refreshed the **30 already published companies** from the September 1 pipeline output in PR #197 (source commit `3d98e367df3d9b39e2d64c891ee34dad96b65f5f`). Their matched registry owner/province pairs agree with the previously published matches; all reviewed match scores were 100. Published 30 corresponding GeoJSON files containing 4,324 claim features so interactive links load the reviewed geometry instead of falling back to a name search.

The HTML claim IDs match the geometry; EPL intentionally displays only the first 400 of 476 records under the generator's existing table cap. Links to companies outside the published set were removed. Google's existing tag and the new acquisition script are retained on the refreshed pages. Snapshots remain dated, partial public-registry views, not legal ownership verification or real-time inventories.

PR #197's additional unpublished companies are **not included** in this release. Their owner matches need separate review before expanding the index. No database migration is required by this release.

## Measurement and operational follow-up

Use [growth-validation.md](growth-validation.md) for the five-user test and ten prepared maps. For reporting:

| Milestone | Evidence | Interpretation |
| --- | --- | --- |
| Acquisition | Pageviews plus signup metadata's source and acquisition session | A tab session is not a unique person. First-touch browser storage is not cross-device identity. |
| Link requested/sent/failed | `export_gate_signup_started`, `signup_link_sent`, `signup_link_failed` | An email submission or successful send is not a confirmed account. |
| Confirmed account | Server-verified `signup_completed`, keyed by account | Event time is confirmation time; delayed historical confirmations must not count as new release-period signups. |
| Useful export | `export_completed`, `real_data`, and participant confirmation | Real registry geometry is not proof that it belongs to the user or that they used the output. |
| Saved and returned | `project_saved` and later authenticated product activity | Separate a returning work session from a reload or auth token refresh. |
| Paid customer | Stripe-backed `user_plans` and verified billing records | Exclude admin grants, grandfathered access, trials without payment, and test mode. |

Exclude known admin accounts and their identifiable sessions from each measure. Retain the distinction between anonymous sessions and accounts when joining events; a signup can link back to its `acquisition_session`. Existing untagged history cannot be reconstructed reliably. Do not mix static-page sessions newly captured by this release with the old app-only denominator without labeling the measurement change.

Google Ads and Search Console account settings are separate from this code release. The existing Ads conversion destination is retained; confirm its category, counting setting, attribution, and value configuration in that account before spending. Check Search Console indexing/query data after deployment. No ad budget, outbound email, new tracking destination, or customer account has been created by this work.

## Rollback

Revert this release commit and let the existing GitHub/Vercel integration redeploy. Changes are backward compatible with the current database; no data rollback or deletion is needed. The new browser attribution key expires automatically. Preserve existing company pages if selectively rolling back only app code.
