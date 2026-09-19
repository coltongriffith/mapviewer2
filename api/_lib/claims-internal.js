import claimsHandler from '../claims.js';
import bcClaimsHandler from '../bc-claims.js';

function responseCapture() {
  const state = { status: 200, body: null, headers: {} };
  const res = {
    setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; return res; },
    status(code) { state.status = Number(code); return res; },
    json(value) { state.body = value; return value; },
    end(value) { state.body = value ?? state.body; return value; },
  };
  return { state, res };
}

export async function runClaimsSearch({
  jurisdiction,
  query = null,
  type = 'company',
  bbox = null,
  clientIp = 'agent-internal',
}) {
  const params = new URLSearchParams();
  params.set('province', jurisdiction);
  if (query) params.set('q', query);
  if (type) params.set('type', type);
  if (bbox) params.set('bbox', bbox.join(','));

  const req = {
    method: 'GET',
    query: {
      province: jurisdiction,
      ...(query ? { q: query } : {}),
      ...(type ? { type } : {}),
      ...(bbox ? { bbox: bbox.join(',') } : {}),
    },
    headers: { 'x-real-ip': clientIp },
    url: `/api/claims?${params.toString()}`,
  };

  const { state, res } = responseCapture();
  const handler = jurisdiction === 'bc' && bbox ? bcClaimsHandler : claimsHandler;
  await handler(req, res);

  if (state.status >= 400) {
    const err = new Error(state.body?.error || 'Claim registry search failed.');
    err.status = state.status;
    err.detail = state.body;
    throw err;
  }
  return state.body;
}
