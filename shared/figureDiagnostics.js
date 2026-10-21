// Structured figure diagnostics: what an export check found, in a form a UI can
// list and a test can assert on. Pure, no DOM; shared by the 2D export preflight
// and, later, the 3D annotation layer.
//
// A diagnostic is { code, severity, elementId, bounds, message, action }:
//   code      stable machine name ('imagery-tile-failed', 'label-clipped'…)
//   severity  'error' (the figure says something wrong: bad interval geometry),
//             'warning' (a visual fault a user may knowingly accept),
//             'info' (worth knowing, nothing to fix)
//   elementId the callout/marker/layer id it concerns, or null for the figure
//   bounds    { left, top, width, height } in 1x composition px, or null
//   message   one short plain-language sentence
//   action    what to do about it, or ''

export const SEVERITIES = ['error', 'warning', 'info'];
const RANK = { error: 0, warning: 1, info: 2 };

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function cleanBounds(b) {
  if (!b) return null;
  const out = { left: Number(b.left), top: Number(b.top), width: Number(b.width), height: Number(b.height) };
  return Object.values(out).every(Number.isFinite) ? out : null;
}

export function diagnostic({ code, severity = 'warning', elementId = null, bounds = null, message = '', action = '' }) {
  return {
    code: String(code || 'unknown'),
    severity: RANK[severity] === undefined ? 'warning' : severity,
    elementId: elementId == null ? null : String(elementId),
    bounds: cleanBounds(bounds),
    message: cap(String(message || code || '')),
    action: cap(String(action || '')),
  };
}

// Most severe first, then by code and element so the order is stable.
export function sortDiagnostics(list) {
  return [...(list || [])].sort((a, b) => (RANK[a.severity] - RANK[b.severity])
    || a.code.localeCompare(b.code)
    || String(a.elementId ?? '').localeCompare(String(b.elementId ?? '')));
}

// One list from several (preflight checks, render-time findings). The same code
// on the same element is one finding: the more severe copy is kept. Findings
// about the figure as a whole (no element) are told apart by their message.
export function mergeDiagnostics(...lists) {
  const byKey = new Map();
  for (const d of lists.flat().filter(Boolean)) {
    const item = d.code && d.severity in RANK ? d : diagnostic(d);
    const key = `${item.code}\u0000${item.elementId ?? `\u0001${item.message}`}`;
    const prev = byKey.get(key);
    if (!prev || RANK[item.severity] < RANK[prev.severity]) byKey.set(key, item);
  }
  return sortDiagnostics([...byKey.values()]);
}

export function countDiagnostics(list) {
  const out = { error: 0, warning: 0, info: 0 };
  for (const d of list || []) out[d.severity] += 1;
  return out;
}

// Anything but info asks the user to look before downloading.
export const needsReview = (list) => (list || []).some((d) => d.severity !== 'info');
export const hasErrors = (list) => (list || []).some((d) => d.severity === 'error');

// "2 problems and 1 warning", "No problems found"…
export function summaryLine(list) {
  const n = countDiagnostics(list);
  const parts = [];
  if (n.error) parts.push(`${n.error} problem${n.error === 1 ? '' : 's'}`);
  if (n.warning) parts.push(`${n.warning} warning${n.warning === 1 ? '' : 's'}`);
  if (n.info) parts.push(`${n.info} note${n.info === 1 ? '' : 's'}`);
  if (!parts.length) return 'No problems found';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

// Union of boxes (for a finding about several tiles or rows), or null.
export function unionBounds(boxes) {
  const valid = (boxes || []).map(cleanBounds).filter(Boolean);
  if (!valid.length) return null;
  const left = Math.min(...valid.map((b) => b.left)), top = Math.min(...valid.map((b) => b.top));
  const right = Math.max(...valid.map((b) => b.left + b.width)), bottom = Math.max(...valid.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}
