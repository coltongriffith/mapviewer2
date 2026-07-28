// Marketing copy for plans & pricing. Every capability line here MUST map to a
// key in src/utils/entitlements.js — that file decides what is actually
// enforced, this one decides how it is described. Keeping the two in sync is
// the whole point: previously the pricing page sold HD PNG and reusable brand
// kits that the product never gated.
//
// To change prices: update PRICING here, then point the matching Prices in the
// Stripe dashboard (server env: STRIPE_PRICE_MONTHLY_ID / _YEARLY_ID).
//
// GRANDFATHERING: every account that existed before PRO_GRANDFATHER_CUTOFF
// has full Pro access forever, at no charge. This is enforced twice — rows
// seeded as plan='pro', source='grandfathered' by the billing migration, AND
// a client-side created_at check as a backstop — so an early account can
// never be denied a Pro feature even if its plan row is missing.

import {
  ENTITLEMENTS, TIERS, FREE_MAX_EXPORT_PIXELS, PRO_MAX_EXPORT_PIXELS,
} from './entitlements';

export const PRO_GRANDFATHER_CUTOFF = new Date('2026-07-17T00:00:00Z');

export const PRICING = {
  currency: 'USD',
  monthly: 29,   // $/month, billed monthly
  yearly: 290,   // $/year (2 months free vs monthly)
};

export const yearlyMonthlyEquivalent = () => Math.round((PRICING.yearly / 12) * 100) / 100;

export const FREE_FEATURES = [
  'Full map editor — layers, styling, labels, legend',
  'Live claim registry search (Canada + U.S. federal BLM)',
  'Import CSV, GeoJSON, KML/KMZ, shapefiles',
  `PNG export up to ${FREE_MAX_EXPORT_PIXELS.toLocaleString()} px with a small explorationmaps.com credit`,
  `Up to ${ENTITLEMENTS[TIERS.FREE].max_cloud_projects} saved cloud projects`,
];

export const PRO_FEATURES = [
  'Everything in Free',
  'Clean exports — no watermark or credit',
  `High-resolution PNG up to ${PRO_MAX_EXPORT_PIXELS.toLocaleString()} px`,
  'SVG, Illustrator (AI) and PDF export',
  'Unlimited cloud projects',
  'Reusable brand kits and templates',
];

// Cloud projects a free account can save. Grandfathered/Pro = unlimited.
// Sourced from the entitlement matrix so there is exactly one number.
export const FREE_PROJECT_LIMIT = ENTITLEMENTS[TIERS.FREE].max_cloud_projects;

// Export formats that require Pro. Derived from the matrix: anything Pro can
// export that Free cannot. Standard PNG stays free (with credit) so export is
// never fully blocked.
export const PRO_EXPORT_FORMATS = ENTITLEMENTS[TIERS.PRO].allowed_export_formats
  .filter((f) => !ENTITLEMENTS[TIERS.FREE].allowed_export_formats.includes(f));

export const isGrandfathered = (user) =>
  Boolean(user?.created_at) && new Date(user.created_at) < PRO_GRANDFATHER_CUTOFF;
