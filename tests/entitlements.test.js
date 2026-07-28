import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ENTITLEMENTS, TIERS, PRO_GRACE_MS,
  resolveTier, resolveEntitlements, entitlementsFor,
  canExportFormat, clampExportSize, maxPixelRatioFor,
  canSaveBrandKit, canCreateProject,
  rememberProGrace, clearProGrace, hasProGrace,
  FREE_MAX_EXPORT_PIXELS, PRO_MAX_EXPORT_PIXELS,
} from '../src/utils/entitlements';
import { FREE_FEATURES, PRO_FEATURES, PRO_EXPORT_FORMATS, FREE_PROJECT_LIMIT } from '../src/utils/pricing';

// The audit's core requirement: every advertised Free/Pro line maps to an
// enforced entitlement, and no tier can reach a benefit it did not pay for.

const USER = { id: 'u1', created_at: '2027-01-01T00:00:00Z' }; // post-cutoff
const ready = (plan) => ({ plan, source: plan === 'pro' ? 'stripe' : 'signup', ready: true });
const unresolved = { plan: null, source: null, ready: false };

beforeEach(() => { clearProGrace(); });
afterEach(() => { clearProGrace(); vi.useRealTimers(); });

describe('tier resolution', () => {
  it('anonymous visitors are never Pro', () => {
    expect(resolveTier(null, unresolved)).toBe(TIERS.ANONYMOUS);
    expect(resolveTier(null, ready('pro'))).toBe(TIERS.ANONYMOUS);
  });

  it('a definitive free plan resolves to free', () => {
    expect(resolveTier(USER, ready('free'))).toBe(TIERS.FREE);
  });

  it('a definitive pro plan resolves to pro', () => {
    expect(resolveTier(USER, ready('pro'))).toBe(TIERS.PRO);
  });

  // THE fail-open fix (P0-04): an unknown plan must not mint a Pro account.
  it('an UNRESOLVED plan falls back to free, not pro', () => {
    expect(resolveTier(USER, unresolved)).toBe(TIERS.FREE);
  });

  it('an unresolved plan keeps Pro for a RECENTLY CONFIRMED pro user (grace)', () => {
    rememberProGrace(USER.id);
    expect(resolveTier(USER, unresolved)).toBe(TIERS.PRO);
  });

  it('grace expires', () => {
    rememberProGrace(USER.id);
    const later = Date.now() + PRO_GRACE_MS + 1000;
    expect(resolveTier(USER, unresolved, later)).toBe(TIERS.FREE);
  });

  it('grace is per-user — another account cannot inherit it', () => {
    rememberProGrace(USER.id);
    expect(hasProGrace('someone-else')).toBe(false);
    expect(resolveTier({ id: 'someone-else' }, unresolved)).toBe(TIERS.FREE);
  });

  it('a definitive free answer revokes an existing grace record', () => {
    rememberProGrace(USER.id);
    clearProGrace(); // what refreshPlan() does on a confirmed free answer
    expect(resolveTier(USER, unresolved)).toBe(TIERS.FREE);
  });
});

describe('export format gate', () => {
  it('PNG is available to every tier so export is never fully blocked', () => {
    for (const tier of Object.values(TIERS)) {
      expect(canExportFormat(entitlementsFor(tier), 'png')).toBe(true);
    }
  });

  it.each(['svg', 'svg_ai', 'pdf'])('%s is Pro-only', (fmt) => {
    expect(canExportFormat(ENTITLEMENTS[TIERS.FREE], fmt)).toBe(false);
    expect(canExportFormat(ENTITLEMENTS[TIERS.ANONYMOUS], fmt)).toBe(false);
    expect(canExportFormat(ENTITLEMENTS[TIERS.PRO], fmt)).toBe(true);
  });

  it('an unresolved-plan user cannot reach a Pro format', () => {
    expect(canExportFormat(resolveEntitlements(USER, unresolved), 'pdf')).toBe(false);
  });
});

describe('export resolution cap (P0-13)', () => {
  it('free is capped and pro is not, at the advertised numbers', () => {
    expect(ENTITLEMENTS[TIERS.FREE].max_export_pixels).toBe(FREE_MAX_EXPORT_PIXELS);
    expect(ENTITLEMENTS[TIERS.PRO].max_export_pixels).toBe(PRO_MAX_EXPORT_PIXELS);
    expect(PRO_MAX_EXPORT_PIXELS).toBeGreaterThan(FREE_MAX_EXPORT_PIXELS);
  });

  it('clamps an oversized free export and preserves aspect ratio', () => {
    const { width, height, clamped } = clampExportSize(ENTITLEMENTS[TIERS.FREE], 8000, 4000);
    expect(clamped).toBe(true);
    expect(Math.max(width, height)).toBe(FREE_MAX_EXPORT_PIXELS);
    expect(width / height).toBeCloseTo(2, 5);
  });

  it('leaves an in-budget export untouched', () => {
    const { width, height, clamped } = clampExportSize(ENTITLEMENTS[TIERS.FREE], 1600, 900);
    expect(clamped).toBe(false);
    expect([width, height]).toEqual([1600, 900]);
  });

  it('does not clamp Pro below its own ceiling', () => {
    const { clamped } = clampExportSize(ENTITLEMENTS[TIERS.PRO], 8000, 4000);
    expect(clamped).toBe(false);
  });

  it('still clamps Pro at the absolute maximum', () => {
    const { clamped, width } = clampExportSize(ENTITLEMENTS[TIERS.PRO], 40000, 40000);
    expect(clamped).toBe(true);
    expect(width).toBe(PRO_MAX_EXPORT_PIXELS);
  });

  it('caps the offered pixelRatio for a free user on a large frame', () => {
    // 1600px frame → 2x = 3200px, over the free 2000px cap.
    expect(maxPixelRatioFor(ENTITLEMENTS[TIERS.FREE], 1600)).toBe(1);
    expect(maxPixelRatioFor(ENTITLEMENTS[TIERS.PRO], 1600)).toBeGreaterThanOrEqual(3);
  });
});

describe('project quota', () => {
  it('matches the advertised free limit', () => {
    expect(FREE_PROJECT_LIMIT).toBe(ENTITLEMENTS[TIERS.FREE].max_cloud_projects);
  });

  it('allows up to the limit and denies past it', () => {
    const free = ENTITLEMENTS[TIERS.FREE];
    expect(canCreateProject(free, free.max_cloud_projects - 1)).toBe(true);
    expect(canCreateProject(free, free.max_cloud_projects)).toBe(false);
  });

  it('is unlimited for pro', () => {
    expect(canCreateProject(ENTITLEMENTS[TIERS.PRO], 10_000)).toBe(true);
  });

  it('anonymous users cannot create cloud projects at all', () => {
    expect(canCreateProject(ENTITLEMENTS[TIERS.ANONYMOUS], 0)).toBe(false);
  });
});

describe('brand kits', () => {
  it('free cannot save a reusable kit', () => {
    expect(canSaveBrandKit(ENTITLEMENTS[TIERS.FREE], 0)).toBe(false);
  });

  it('pro can save many', () => {
    expect(canSaveBrandKit(ENTITLEMENTS[TIERS.PRO], 25)).toBe(true);
  });

  it('an unresolved plan cannot save kits', () => {
    expect(canSaveBrandKit(resolveEntitlements(USER, unresolved), 0)).toBe(false);
  });
});

describe('clean export (watermark removal)', () => {
  it('only Pro gets a clean file', () => {
    expect(ENTITLEMENTS[TIERS.ANONYMOUS].clean_export).toBe(false);
    expect(ENTITLEMENTS[TIERS.FREE].clean_export).toBe(false);
    expect(ENTITLEMENTS[TIERS.PRO].clean_export).toBe(true);
  });
});

describe('pricing copy matches enforcement', () => {
  it('PRO_EXPORT_FORMATS is derived from the matrix, not hand-maintained', () => {
    expect(PRO_EXPORT_FORMATS.sort()).toEqual(['pdf', 'svg', 'svg_ai']);
    for (const f of PRO_EXPORT_FORMATS) {
      expect(canExportFormat(ENTITLEMENTS[TIERS.FREE], f)).toBe(false);
      expect(canExportFormat(ENTITLEMENTS[TIERS.PRO], f)).toBe(true);
    }
  });

  it('the free feature list states the real project limit and pixel cap', () => {
    const blob = FREE_FEATURES.join(' ');
    expect(blob).toContain(String(ENTITLEMENTS[TIERS.FREE].max_cloud_projects));
    expect(blob).toContain(FREE_MAX_EXPORT_PIXELS.toLocaleString());
  });

  it('the pro feature list advertises the real ceiling', () => {
    expect(PRO_FEATURES.join(' ')).toContain(PRO_MAX_EXPORT_PIXELS.toLocaleString());
  });
});
