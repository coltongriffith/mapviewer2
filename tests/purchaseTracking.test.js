import { describe, expect, it, vi } from 'vitest';
import { trackVerifiedPurchase } from '../src/utils/purchaseTracking.js';

describe('trackVerifiedPurchase', () => {
  it('sends a server-verified paid purchase to the configured Google Ads action', () => {
    const gtag = vi.fn();
    const purchase = {
      status: 'paid',
      purchase: {
        livemode: true,
        transaction_id: 'cs_live_verified',
        value: 29,
        currency: 'USD',
      },
    };

    expect(trackVerifiedPurchase(purchase, gtag)).toBe(true);
    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: 'AW-18358773663/OoEDCO-btPIcEJ_PkrJE',
      value: 29,
      currency: 'USD',
      transaction_id: 'cs_live_verified',
    });
  });

  it('does not report an unpaid checkout', () => {
    const gtag = vi.fn();
    const checkout = {
      status: 'open',
      purchase: {
        livemode: true,
        transaction_id: 'cs_live_unpaid',
        value: 29,
        currency: 'USD',
      },
    };

    expect(trackVerifiedPurchase(checkout, gtag)).toBe(false);
    expect(gtag).not.toHaveBeenCalled();
  });
});
