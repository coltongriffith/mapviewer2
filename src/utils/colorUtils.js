const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+[\s,\d.]*\)|hsla?\([^)]{0,60}\)|[a-zA-Z]{2,30})$/;

export function safeColor(value, fallback = '#000000') {
  const str = String(value ?? '').trim();
  return SAFE_COLOR_RE.test(str) ? str : fallback;
}
