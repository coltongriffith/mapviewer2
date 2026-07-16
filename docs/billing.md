# Billing (Stripe) — setup & operations

Status: v1. Pro subscription via Stripe Checkout + customer portal.
Last updated: 2026-07-16.

## Plans

| | Free | Pro |
|---|---|---|
| Price | $0 | **$29/month** or **$290/year** (2 months free) |
| Map editor, registry search, imports | ✓ | ✓ |
| Standard PNG export | ✓ (small corner credit) | ✓ (clean) |
| HD PNG / SVG / Illustrator / PDF export | — | ✓ |
| Cloud projects | 3 | Unlimited |
| Watermark/credit on exports | small credit | none |

Display prices live in **`src/utils/pricing.js`** (single source used by the
landing page, upgrade modal, and account billing). To change pricing: update
that file AND create/point the matching Prices in Stripe (env vars below).

## GRANDFATHERING — existing accounts keep everything

Every account created before `PRO_GRANDFATHER_CUTOFF` (2026-07-17, in
`src/utils/pricing.js`) has **full Pro access, free, forever**. Enforced in
three independent layers, so no early account can ever be denied:

1. **Database**: migration `20260716000001_billing_plans.sql` seeds every
   existing `auth.users` row as `plan='pro', source='grandfathered'`.
2. **Webhook**: every downgrade path in `api/stripe-webhook.js` is scoped to
   `source='stripe'` rows — a grandfathered row can never be downgraded.
3. **Client backstop**: `useAuth` treats any account with
   `created_at < PRO_GRANDFATHER_CUTOFF` as Pro even if its plan row is
   missing entirely.

On top of that, all plan checks **fail open**: if the plan lookup errors or
hasn't resolved, a signed-in user is treated as Pro. Gates deny only on a
*definitive* free plan.

## One-time setup (owner)

1. **Apply the migration** `supabase/migrations/20260716000001_billing_plans.sql`
   in the Supabase SQL editor. Verify:
   `select count(*) from public.user_plans where source='grandfathered';`
   — should equal your current user count.
2. **Stripe dashboard → Product catalog**: create a product "Exploration Maps
   Pro" with two recurring Prices: $29/month and $290/year (USD). Copy both
   `price_...` ids.
3. **Stripe dashboard → Developers → Webhooks**: add endpoint
   `https://www.explorationmaps.com/api/stripe-webhook` with events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   Copy the signing secret (`whsec_...`).
4. **Stripe dashboard → Settings → Billing → Customer portal**: enable the
   portal (allow cancel + payment-method update).
5. **Vercel env vars** (Production):
   - `STRIPE_SECRET_KEY` = your `sk_live_...`
   - `STRIPE_WEBHOOK_SECRET` = the `whsec_...` from step 3
   - `STRIPE_PRICE_MONTHLY_ID` / `STRIPE_PRICE_YEARLY_ID` = ids from step 2
   - (`SITE_URL` optional, defaults to https://www.explorationmaps.com)
6. **Redeploy.** Until step 5 is done the billing endpoints return
   503 "Billing is not configured yet" and the app behaves exactly as before
   (all plan checks fail open) — safe to ship code first, configure later.

## Architecture

- **`api/stripe-checkout.js`** — authenticated POST → creates/reuses the
  Stripe customer (stored on `user_plans.stripe_customer_id`) → returns a
  Checkout session URL. Card data never touches our servers.
- **`api/stripe-portal.js`** — authenticated POST → customer portal URL
  (cancel, change card, invoices).
- **`api/stripe-webhook.js`** — the single writer of subscription state into
  `public.user_plans`. Signature-verified (manual HMAC per Stripe's spec —
  no SDK dependency, matching the repo's zero-dep api/ style). `past_due`
  keeps Pro (payment grace); only terminal states downgrade, and only for
  `source='stripe'` rows.
- **`public.user_plans`** — one row per user; users can read only their own
  row (RLS); all writes via service role. New signups get a `free` row from
  the `on_auth_user_created_plan` trigger.
- **Client** — `useAuth()` exposes `isPro` (fail-open), `planDenied`
  (definitive-free only — the ONLY signal gates may deny on), `planSource`,
  and `refreshPlan()`. Gates: export formats (`PRO_EXPORT_FORMATS`) in
  `App.jsx handleExportClick`; watermark via `paidTier: isPro` in
  `handleExport`; project cap in `cloudStorage.assertProjectQuota`.

## Testing with Stripe test mode

Set the three env vars to test-mode values (`sk_test_...`, test Prices, test
webhook secret) in a Vercel preview env. Card `4242 4242 4242 4242`, any
future expiry/CVC. Verify: checkout → `user_plans` row flips to
`pro/active/stripe` (webhook) → clean SVG export works; cancel in the portal
→ row returns to `free/canceled` at period end.

## Verification checklist (after configuring)

- [ ] Existing account: exports stay clean, SVG/PDF work, >3 projects save. 
- [ ] Account page shows "Pro — early adopter" for a grandfathered user.
- [ ] New (post-launch) test account: PNG has small credit; SVG/PDF opens the
      upgrade modal; 4th project save is blocked with the upgrade message.
- [ ] Checkout with the test card upgrades the account within seconds.
- [ ] Customer portal opens from Account → Plan & Billing.
- [ ] Stripe dashboard → webhook shows 200s.
