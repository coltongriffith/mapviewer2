import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackVerifiedPurchase } from '../src/utils/purchaseTracking';
beforeEach(() => localStorage.clear());
describe('verified Google Ads purchases', () => {
  it('sends actual currency/value once with a stable transaction id', () => {
    const tag = vi.fn();
    const result = { status: 'paid', purchase: { transaction_id: 'cs_live_123', value: 29, currency: 'USD', livemode: true } };
    expect(trackVerifiedPurchase(result, tag)).toBe(true);
    expect(trackVerifiedPurchase(result, tag)).toBe(false);
    expect(tag).toHaveBeenCalledTimes(1);
    expect(tag.mock.calls[0][2]).toMatchObject({ transaction_id: 'cs_live_123', value: 29, currency: 'USD' });
  });
  it('never converts unverified, processing, or test-mode checkouts', () => {
    const tag = vi.fn();
    const purchase = { transaction_id: 'cs_test_123', value: 29, currency: 'USD', livemode: false };
    trackVerifiedPurchase({ status: 'paid', purchase }, tag);
    trackVerifiedPurchase({ status: 'processing', purchase: { ...purchase, livemode: true } }, tag);
    trackVerifiedPurchase({ status: 'paid' }, tag);
    expect(tag).not.toHaveBeenCalled();
  });
});
