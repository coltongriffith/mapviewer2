// Lazy point scans and diagnostics; eager consumers import only the policy.
import { GEOPHYS_NUMERIC_POLICY, geophysNumber as number } from './geophys-policy.js';
export { GEOPHYS_NUMERIC_POLICY, geophysFilePolicy, geophysPolicyMetadata, finiteGeophysNumber } from './geophys-policy.js';

export function readPoints(files) {
  const x = [], y = [], z = [], v = [], line = [];
  const diagnostics = { submitted: 0, accepted: 0, excluded: 0, reasons: {}, legacyFiles: 0, files: [] };
  const reject = (reason, file) => {
    for (const d of [diagnostics, file]) { d.excluded++; d.reasons[reason] = (d.reasons[reason] || 0) + 1; }
  };
  files.forEach((file) => {
    const policy = file.geophysNumericPolicy;
    if (policy === undefined) diagnostics.legacyFiles++;
    const report = { name: file.name || '', policy: policy === undefined ? 'legacy-prefix' : policy === GEOPHYS_NUMERIC_POLICY ? policy : 'unsupported',
      submitted: file.rows.length, accepted: 0, excluded: 0, reasons: {} };
    diagnostics.files.push(report);
    file.rows.forEach((row) => {
      diagnostics.submitted++;
      if (policy !== undefined && policy !== GEOPHYS_NUMERIC_POLICY) { reject('unsupported-policy', report); return; }
      if (policy !== undefined && Array.isArray(file.header) && row.length !== file.header.length) { reject('row-width', report); return; }
      const cols = file.cols;
      const values = ['east', 'north', 'elev', 'value'].map((key) => number(row[cols[key]], policy));
      const bad = values.findIndex((cell) => cell.reason);
      if (bad >= 0) { reject(`${values[bad].reason}-${bad === 3 ? 'value' : 'coordinate'}`, report); return; }
      x.push(values[0].value); y.push(values[1].value); z.push(values[2].value); v.push(values[3].value);
      line.push(cols.line !== undefined ? String(row[cols.line] ?? '').trim() : '');
      diagnostics.accepted++;
      report.accepted++;
    });
  });
  return { x: Float64Array.from(x), y: Float64Array.from(y), z: Float64Array.from(z), v: Float64Array.from(v),
    line, lines: [...new Set(line)].filter(Boolean), n: x.length, diagnostics };
}
export function geophysReadNote(points) {
  const d = points.diagnostics;
  const labels = { 'unsupported-policy': 'unsupported numeric policy', 'row-width': 'column count mismatch' };
  const reasons = Object.entries(d.reasons).map(([key, count]) => `${count} ${labels[key] || key.replace('-', ' ')}`).join(', ');
  return `${d.accepted} of ${d.submitted} points accepted${d.excluded ? `; ${d.excluded} excluded (${reasons})` : ''}. Raw source rows are unchanged.${d.legacyFiles ? ` Legacy numeric interpretation retained for ${d.legacyFiles} saved file(s).` : ''}`;
}
