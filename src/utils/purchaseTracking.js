export function trackVerifiedPurchase(result, gtag = window.gtag) {
  const p = result?.purchase;
  if (result?.status !== 'paid' || p?.livemode !== true || !p.transaction_id
    || !Number.isFinite(p.value) || p.value < 0 || !/^[A-Z]{3}$/.test(p.currency || '') || typeof gtag !== 'function') return false;
  const key = `em_purchase_${p.transaction_id}`;
  try { if (localStorage.getItem(key)) return false; } catch { /* optional */ }
  // Google Ads also deduplicates by transaction_id across tabs/devices.
  gtag('event', 'conversion', { send_to: 'AW-18358773663/2_5ZCOf43dgcEJ_PkrJE',
    value: p.value, currency: p.currency, transaction_id: p.transaction_id });
  try { localStorage.setItem(key, '1'); } catch { /* optional */ }
  return true;
}
