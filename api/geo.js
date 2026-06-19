// Returns the caller's approximate (city-level) location from Vercel's edge
// geolocation headers. No external service, no API key, no rate limit.
// Used to plot live visitors on the admin world map.
export default function handler(req, res) {
  const h = req.headers || {};
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const decode = (v) => {
    if (!v) return null;
    try { return decodeURIComponent(v); } catch { return v; }
  };

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    lat: num(h['x-vercel-ip-latitude']),
    lng: num(h['x-vercel-ip-longitude']),
    city: decode(h['x-vercel-ip-city']) || null,
    region: decode(h['x-vercel-ip-country-region']) || null,
    country: h['x-vercel-ip-country'] || null,
  });
}
