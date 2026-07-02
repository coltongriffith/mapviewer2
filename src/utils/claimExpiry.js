// Claim-expiry summary for a layer's GeoJSON: how many claims lapse soon and
// which date is first. Registry data normalizes the good-standing date onto
// GOOD_TO_DATE (see api/claims.js normalizeProps); raw uploads may carry the
// provincial variants, so the same fallbacks claimInfo.js uses apply here.
const DATE_KEYS = ['GOOD_TO_DATE', 'EXPIRY_DATE', 'GOODSTANDI', 'good_to_date'];

const cache = new WeakMap();

function parseDate(value) {
  if (value == null) return null;
  const s = String(value).slice(0, 10);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function claimExpirySummary(geojson, withinDays = 90) {
  if (!geojson || typeof geojson !== 'object') return null;
  const cached = cache.get(geojson);
  if (cached && cached.withinDays === withinDays) return cached.summary;

  const features = geojson.features || (geojson.type === 'Feature' ? [geojson] : []);
  const now = Date.now();
  const soonCutoff = now + withinDays * 86400000;
  let soonest = null;
  let expiringSoon = 0;
  let expired = 0;
  let dated = 0;

  for (const f of features) {
    const props = f?.properties;
    if (!props) continue;
    let t = null;
    for (const key of DATE_KEYS) {
      t = parseDate(props[key]);
      if (t != null) break;
    }
    if (t == null) continue;
    dated += 1;
    if (t < now) expired += 1;
    else if (t <= soonCutoff) expiringSoon += 1;
    if (soonest == null || t < soonest) soonest = t;
  }

  const summary = dated === 0 ? null : {
    soonest: new Date(soonest).toISOString().slice(0, 10),
    expiringSoon,
    expired,
    dated,
    withinDays,
  };
  cache.set(geojson, { withinDays, summary });
  return summary;
}
