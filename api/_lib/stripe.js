// Minimal Stripe REST client + webhook signature verification.
// Deliberately dependency-free (no `stripe` npm package): the api/ functions
// in this repo use plain fetch, and Stripe's API is form-encoded HTTP — the
// three calls we need don't justify a vendored SDK.

import crypto from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// Flatten a nested object into Stripe's form encoding:
// { line_items: [{ price: 'x', quantity: 1 }] }
//   → line_items[0][price]=x & line_items[0][quantity]=1
function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (typeof item === 'object' && item !== null) formEncode(item, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(item));
      });
    } else if (typeof val === 'object') {
      formEncode(val, name, out);
    } else {
      out.append(name, String(val));
    }
  }
  return out;
}

export async function stripeRequest(path, params = null, { method = 'POST' } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  const r = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? formEncode(params).toString() : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || `Stripe ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data;
}

// Verify a Stripe-Signature header against the raw request body.
// https://docs.stripe.com/webhooks#verify-manually — v1 scheme is
// HMAC-SHA256 over `${timestamp}.${rawBody}` with the endpoint secret.
export function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!rawBody || !signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    String(signatureHeader).split(',').map((p) => {
      const i = p.indexOf('=');
      return i === -1 ? [p, ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false; // replay guard
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody}`, 'utf8')
    .digest('hex');
  // A header can carry multiple v1 signatures (secret rotation) — accept any.
  const candidates = String(signatureHeader)
    .split(',')
    .filter((p) => p.trim().startsWith('v1='))
    .map((p) => p.trim().slice(3));
  const expectedBuf = Buffer.from(expected, 'hex');
  return candidates.some((sig) => {
    const buf = Buffer.from(sig, 'hex');
    return buf.length === expectedBuf.length && crypto.timingSafeEqual(buf, expectedBuf);
  });
}
