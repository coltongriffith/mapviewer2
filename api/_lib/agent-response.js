export function agentError(res, status, code, message, retryable = false, details = undefined) {
  return res.status(status).json({
    error: {
      code,
      message,
      retryable,
      ...(details === undefined ? {} : { details }),
    },
  });
}

export function requestId(req) {
  const incoming = req.headers?.['x-request-id'];
  if (typeof incoming === 'string' && /^[A-Za-z0-9._:-]{8,100}$/.test(incoming)) return incoming;
  return globalThis.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function platformName(req) {
  const raw = String(req.headers?.['x-agent-platform'] || req.headers?.['user-agent'] || 'unknown').toLowerCase();
  if (raw.includes('muse')) return 'muse';
  if (raw.includes('claude')) return 'claude';
  if (raw.includes('chatgpt') || raw.includes('openai')) return 'chatgpt';
  if (raw.includes('gemini')) return 'gemini';
  return 'unknown';
}
