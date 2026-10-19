import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateUser = vi.fn(async () => ({ data: {}, error: null }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { updateUser } } }));

const {
  queueFullResExport, loadFullResExport, clearFullResExport, fullResCreditUsed, markFullResCreditUsed, FULLRES_USED_KEY,
} = await import('../src/utils/fullResExport.js');

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => localStorage.clear());

describe('pending full-resolution export', () => {
  it('survives the email round trip for a week', () => {
    queueFullResExport({ requestedPx: 2666.4 }, 1_000);
    expect(loadFullResExport(1_000 + 6 * DAY)).toEqual({ requestedPx: 2666, at: 1_000 });
    expect(loadFullResExport(1_000 + 8 * DAY)).toBeNull();
  });

  it('is gone once cleared, and unreadable storage reads as none', () => {
    queueFullResExport({ requestedPx: 3000 });
    clearFullResExport();
    expect(loadFullResExport()).toBeNull();
    localStorage.setItem('mapviewer.pendingFullResExport.v1', '{not json');
    expect(loadFullResExport()).toBeNull();
  });
});

describe('the account\'s one free export', () => {
  it('is spent once the account records it', () => {
    expect(fullResCreditUsed(null)).toBe(false);
    expect(fullResCreditUsed({ user_metadata: {} })).toBe(false);
    expect(fullResCreditUsed({ user_metadata: { [FULLRES_USED_KEY]: '2026-10-19T00:00:00.000Z' } })).toBe(true);
  });

  it('is recorded on the account, not in the browser', async () => {
    await markFullResCreditUsed(new Date('2026-10-19T12:00:00Z'));
    expect(updateUser).toHaveBeenCalledWith({ data: { em_fullres_export_at: '2026-10-19T12:00:00.000Z' } });
  });
});
