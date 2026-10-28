import capabilitiesHandler from './_lib/agent/capabilities.js';
import keysHandler from './_lib/agent/keys.js';
import mapsHandler from './_lib/agent/maps.js';
import previewHandler from './_lib/agent/preview.js';

const HANDLERS = {
  capabilities: capabilitiesHandler,
  keys: keysHandler,
  maps: mapsHandler,
  preview: previewHandler,
};

export default async function handler(req, res) {
  // Reuse the existing function slot; Tour retains its own user-JWT/RPC
  // authorization and never inherits Agent API-key permissions.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  if (req.query?.action === 'tour') {
    const {default: tour} = await import('./_lib/tour.js');
    return tour(req, res);
  }
  const action = String(req.query?.action || '');
  const selected = HANDLERS[action];
  if (!selected) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Unknown ExplorationMaps Agent API action.',
        retryable: false,
      },
    });
  }
  return selected(req, res);
}
