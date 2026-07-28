// THE entitlement matrix — single source of truth for what each plan allows.
//
// Every pricing surface (landing page, upgrade modal, account billing) and
// every gate (export format, export resolution, project quota, brand kits)
// reads from here. A promise on the pricing table that has no entitlement key
// below is a promise the product does not actually enforce.
//
// Replaces the old single `isPro` boolean, which could not express "free users
// get PNG but only up to N pixels" — the gap that let a free account export a
// 12,000px map that was being sold as a Pro feature.
//
// GRACE / FAIL-CLOSED: an unresolved plan lookup no longer grants Pro. Instead
// we remember the last *confirmed* Pro answer for a bounded window, so a
// paying or grandfathered user survives a plan-service outage while an
// unconfirmed account is never silently upgraded. See resolveEntitlements().

export const TIERS = { ANONYMOUS: 'anonymous', FREE: 'free', PRO: 'pro' };

// Long-edge pixel cap for raster export. Free is deliberately generous enough
// to prove product quality in a deck while leaving HD/print as the upgrade.
export const FREE_MAX_EXPORT_PIXELS = 2000;
export const PRO_MAX_EXPORT_PIXELS = 12000;

export const ENTITLEMENTS = {
  [TIERS.ANONYMOUS]: {
    clean_export: false,
    max_export_pixels: FREE_MAX_EXPORT_PIXELS,
    allowed_export_formats: ['png'],
    max_cloud_projects: 0,
    max_brand_kits: 0,
  },
  [TIERS.FREE]: {
    clean_export: false,
    max_export_pixels: FREE_MAX_EXPORT_PIXELS,
    allowed_export_formats: ['png'],
    max_cloud_projects: 2,
    max_brand_kits: 0,   // may capture/preview a kit; saving it is Pro
  },
  [TIERS.PRO]: {
    clean_export: true,
    max_export_pixels: PRO_MAX_EXPORT_PIXELS,
    allowed_export_formats: ['png', 'svg', 'svg_ai', 'pdf'],
    max_cloud_projects: Infinity,
    max_brand_kits: Infinity,
  },
};

// How long a CONFIRMED Pro answer keeps working when the plan service is
// unreachable. Long enough to ride out an outage, short enough that a real
// cancellation takes effect promptly.
export const PRO_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const GRACE_KEY = 'em_plan_grace';

// Remember that this user was DEFINITIVELY Pro, so a later failed lookup can
// keep serving them. Only ever called with a confirmed answer.
export function rememberProGrace(userId) {
  if (!userId) return;
  try {
    localStorage.setItem(GRACE_KEY, JSON.stringify({ userId, at: Date.now() }));
  } catch { /* private mode — grace simply won't apply */ }
}

export function clearProGrace() {
  try { localStorage.removeItem(GRACE_KEY); } catch { /* noop */ }
}

// True only if THIS user was confirmed Pro inside the grace window.
export function hasProGrace(userId, now = Date.now()) {
  if (!userId) return false;
  try {
    const raw = localStorage.getItem(GRACE_KEY);
    if (!raw) return false;
    const rec = JSON.parse(raw);
    return rec?.userId === userId && Number.isFinite(rec.at) && (now - rec.at) < PRO_GRACE_MS;
  } catch {
    return false;
  }
}

/**
 * Resolve the effective tier for the current auth/plan state.
 *
 * @param {object|null} user      Supabase user, or null when anonymous.
 * @param {object} planState      { plan, source, ready } from useAuth.
 * @returns {'anonymous'|'free'|'pro'}
 */
export function resolveTier(user, planState, now = Date.now()) {
  if (!user) return TIERS.ANONYMOUS;
  if (planState?.ready) {
    return planState.plan === 'pro' ? TIERS.PRO : TIERS.FREE;
  }
  // Plan unknown (still loading, or the lookup failed). Fail CLOSED to free
  // unless this exact user was recently confirmed Pro.
  return hasProGrace(user.id, now) ? TIERS.PRO : TIERS.FREE;
}

export function entitlementsFor(tier) {
  return ENTITLEMENTS[tier] || ENTITLEMENTS[TIERS.ANONYMOUS];
}

/** Convenience: user + planState → the entitlement object itself. */
export function resolveEntitlements(user, planState, now = Date.now()) {
  return entitlementsFor(resolveTier(user, planState, now));
}

// ── Gate helpers (used by the UI so every gate reads the same rules) ────────

export function canExportFormat(ent, format) {
  return (ent?.allowed_export_formats || []).includes(format);
}

/**
 * Clamp a requested export size to the plan's pixel budget.
 * Returns { width, height, clamped } — `clamped` drives the upgrade nudge.
 * Aspect ratio is preserved so a clamped export is still the user's framing.
 */
export function clampExportSize(ent, width, height) {
  const max = ent?.max_export_pixels || FREE_MAX_EXPORT_PIXELS;
  const w = Math.max(1, Math.round(width || 0));
  const h = Math.max(1, Math.round(height || 0));
  const longEdge = Math.max(w, h);
  if (longEdge <= max) return { width: w, height: h, clamped: false };
  const k = max / longEdge;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), clamped: true };
}

/**
 * Highest pixelRatio the plan allows for a given on-screen frame, so the
 * Scale dropdown can disable (not silently ignore) out-of-plan choices.
 */
export function maxPixelRatioFor(ent, baseLongEdgePx) {
  const max = ent?.max_export_pixels || FREE_MAX_EXPORT_PIXELS;
  const base = Math.max(1, baseLongEdgePx || 0);
  return Math.max(1, Math.floor(max / base));
}

export function canSaveBrandKit(ent, currentKitCount) {
  return (currentKitCount || 0) < (ent?.max_brand_kits ?? 0);
}

export function canCreateProject(ent, currentProjectCount) {
  return (currentProjectCount || 0) < (ent?.max_cloud_projects ?? 0);
}
