// Small import-time policy primitives. Point scans and diagnostic wording stay
// in the lazy geophysics reader, rather than shipping with role detection.
export const GEOPHYS_NUMERIC_POLICY = 'finite-decimal-v1';
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function geophysFilePolicy(file, restoring = false) {
  return restoring ? geophysPolicyMetadata(file).geophysNumericPolicy : GEOPHYS_NUMERIC_POLICY;
}
// JSON metadata roundtrips preserve absence for legacy files. A defined but
// malformed marker stays unsupported, never becoming legacy by omission.
export function geophysPolicyMetadata(file) {
  const policy = file.geophysNumericPolicy;
  return policy === undefined ? {} : { geophysNumericPolicy: typeof policy === 'string' && policy.length <= 80 ? policy : null };
}
export function geophysNumber(value, policy) {
  const text = String(value ?? '').trim();
  if (policy === undefined) {
    const n = text === '' ? NaN : parseFloat(text);
    return { value: n, reason: Number.isFinite(n) ? null : text ? 'invalid' : 'missing' };
  }
  if (policy !== GEOPHYS_NUMERIC_POLICY) return { value: NaN, reason: 'unsupported-policy' };
  if (!text) return { value: NaN, reason: 'missing' };
  if (/^[<>≤≥]/.test(text)) return { value: NaN, reason: 'qualified' };
  if ((typeof value !== 'number' && typeof value !== 'string') || !decimal.test(text)) return { value: NaN, reason: 'invalid' };
  const n = Number(text);
  return { value: n, reason: Number.isFinite(n) ? null : 'nonfinite' };
}
export const finiteGeophysNumber = (value) => !geophysNumber(value, GEOPHYS_NUMERIC_POLICY).reason;
