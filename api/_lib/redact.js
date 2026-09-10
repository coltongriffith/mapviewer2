// Strip anything that looks like a secret or personal identifier before a
// client-supplied string is stored. Stack traces and messages routinely
// contain URLs with tokens in the query string. Shared by the error sink
// (api/client-error.js) and the feedback endpoint (api/feedback.js).
export function redact(text) {
  if (!text) return null;
  return String(text)
    .replace(/(access_token|refresh_token|api[-_]?key|apikey|password|secret|authorization|bearer)=[^&\s"']+/gi, '$1=[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[jwt]')
    .replace(/\b(sk|pk|rk|whsec)_[A-Za-z0-9]{10,}/g, '[key]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
}
