// Client calls to the Stripe endpoints. Both redirect the browser to a
// Stripe-hosted page on success; errors surface as thrown Errors for the
// caller's toast.

import { supabase } from '../lib/supabase';
import { trackEvent } from './track';

async function authedPost(path, body) {
  if (!supabase) throw new Error('Sign in is not configured.');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token || null;
  if (!token) throw new Error('Sign in to manage billing.');
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// interval: 'month' | 'year'
export async function startCheckout(interval) {
  trackEvent('upgrade_checkout_started', { interval });
  const { url } = await authedPost('/api/stripe-checkout', { interval });
  if (!url) throw new Error('Could not start checkout.');
  window.location.assign(url);
}

export async function openBillingPortal() {
  const { url } = await authedPost('/api/stripe-portal', {});
  if (!url) throw new Error('Could not open the billing portal.');
  window.location.assign(url);
}
