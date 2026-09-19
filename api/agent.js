import capabilitiesHandler from './_lib/agent/capabilities.js';
import keysHandler from './_lib/agent/keys.js';
import mapsHandler from './_lib/agent/maps.js';

const HANDLERS = {
  capabilities: capabilitiesHandler,
  keys: keysHandler,
  maps: mapsHandler,
};

export default async function handler(req, res) {
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
