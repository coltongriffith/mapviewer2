import { describe, it, expect } from 'vitest';
import {
  invoiceSubscriptionId, chargeInvoiceId, deriveInvoiceStatus,
} from '../api/stripe-webhook.js';

// P1-28: Stripe's 2025-03-31 "Basil" release moved an invoice's subscription
// link to parent.subscription_details.subscription and removed Charge.invoice.
// Reading only the legacy fields would mirror subscription renewals as bespoke
// custom work and lose the invoice link on refunds.

describe('invoice → subscription link (both API shapes)', () => {
  it('reads the legacy top-level subscription field', () => {
    expect(invoiceSubscriptionId({ subscription: 'sub_1' })).toBe('sub_1');
  });

  it('reads the Basil parent.subscription_details shape', () => {
    expect(invoiceSubscriptionId({
      parent: { subscription_details: { subscription: 'sub_2' } },
    })).toBe('sub_2');
  });

  it('returns null for a genuinely standalone invoice', () => {
    expect(invoiceSubscriptionId({ id: 'in_1', customer: 'cus_1' })).toBeNull();
    expect(invoiceSubscriptionId({ parent: { subscription_details: {} } })).toBeNull();
  });

  it('tolerates null/undefined', () => {
    expect(invoiceSubscriptionId(null)).toBeNull();
    expect(invoiceSubscriptionId(undefined)).toBeNull();
  });
});

describe('charge → invoice link (both API shapes)', () => {
  it('reads the legacy charge.invoice field', () => {
    expect(chargeInvoiceId({ invoice: 'in_1' })).toBe('in_1');
  });

  it('falls back to the expanded payment intent', () => {
    expect(chargeInvoiceId({ payment_intent: { invoice: 'in_2' } })).toBe('in_2');
  });

  it('falls back to invoice_payment', () => {
    expect(chargeInvoiceId({ invoice_payment: { invoice: 'in_3' } })).toBe('in_3');
  });

  it('returns null for a non-invoice charge', () => {
    expect(chargeInvoiceId({ id: 'ch_1' })).toBeNull();
  });
});

// P1-29: the mirror stored one mutually exclusive label, so ANY credit note
// marked the whole invoice credited and ANY refund marked it fully refunded.
describe('status derived from amounts, not from event type', () => {
  const base = { total: 10000, amountPaid: 0, amountRefunded: 0, amountCredited: 0 };

  it('an unpaid finalized invoice is open — previously invisible entirely', () => {
    expect(deriveInvoiceStatus({ ...base, stripeStatus: 'open' })).toBe('open');
  });

  it('a fully paid invoice is paid', () => {
    expect(deriveInvoiceStatus({ ...base, stripeStatus: 'paid', amountPaid: 10000 })).toBe('paid');
  });

  it('a PARTIAL payment is still open, not paid', () => {
    expect(deriveInvoiceStatus({ ...base, stripeStatus: 'open', amountPaid: 4000 })).toBe('open');
  });

  it('a PARTIAL refund is not reported as fully refunded', () => {
    expect(deriveInvoiceStatus({ ...base, amountPaid: 10000, amountRefunded: 2500 }))
      .toBe('partially_refunded');
  });

  it('a FULL refund is refunded', () => {
    expect(deriveInvoiceStatus({ ...base, amountPaid: 10000, amountRefunded: 10000 }))
      .toBe('refunded');
  });

  it('a PARTIAL credit is not reported as fully credited', () => {
    expect(deriveInvoiceStatus({ ...base, amountPaid: 10000, amountCredited: 1000 }))
      .toBe('partially_credited');
  });

  it('a FULL credit is credited', () => {
    expect(deriveInvoiceStatus({ ...base, amountPaid: 10000, amountCredited: 10000 }))
      .toBe('credited');
  });

  it('void and uncollectible win over payment state', () => {
    expect(deriveInvoiceStatus({ ...base, stripeStatus: 'void', amountPaid: 10000 })).toBe('void');
    expect(deriveInvoiceStatus({ ...base, stripeStatus: 'uncollectible' })).toBe('uncollectible');
  });

  it('a failed payment is reported as payment_failed', () => {
    expect(deriveInvoiceStatus({ ...base, stripeStatus: 'open', paymentFailed: true }))
      .toBe('payment_failed');
  });

  it('a refund takes precedence over a credit when both exist', () => {
    expect(deriveInvoiceStatus({ ...base, amountPaid: 10000, amountRefunded: 10000, amountCredited: 500 }))
      .toBe('refunded');
  });

  it('a zero-total invoice does not divide by zero into a false "paid"', () => {
    expect(deriveInvoiceStatus({ ...base, total: 0, stripeStatus: 'open' })).toBe('open');
  });
});
