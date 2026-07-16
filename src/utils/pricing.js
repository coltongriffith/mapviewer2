// Single source of truth for plans & pricing. Marketing surfaces (landing
// pricing section, upgrade modal, account billing) and gating logic all read
// from here — change prices in ONE place, then update the matching Prices in
// the Stripe dashboard (server env: STRIPE_PRICE_MONTHLY_ID / _YEARLY_ID).
//
// GRANDFATHERING: every account that existed before PRO_GRANDFATHER_CUTOFF
// has full Pro access forever, at no charge. This is enforced twice — rows
// seeded as plan='pro', source='grandfathered' by the billing migration, AND
// a client-side created_at check as a backstop — so an early account can
// never be denied a Pro feature even if its plan row is missing.

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
  'Standard PNG export with a small explorationmaps.com credit',
  'Up to 3 saved cloud projects',
];

export const PRO_FEATURES = [
  'Everything in Free',
  'Clean exports — no watermark or credit',
  'High-resolution PNG, SVG, Illustrator (AI) and PDF export',
  'Unlimited cloud projects',
  'Brand kits and reusable templates',
];

// Cloud projects a free account can save. Grandfathered/Pro = unlimited.
export const FREE_PROJECT_LIMIT = 3;

// Export formats that require Pro. Standard PNG stays free (with credit) so
// export is never fully blocked.
export const PRO_EXPORT_FORMATS = ['svg', 'svg_ai', 'pdf'];

export const isGrandfathered = (user) =>
  Boolean(user?.created_at) && new Date(user.created_at) < PRO_GRANDFATHER_CUTOFF;
