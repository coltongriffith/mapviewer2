// Separate from the legacy assay parser: QA/QC preserves censoring and lab text,
// never substitutes a detection limit or invents a sample type/unit.
export const MAX_QAQC_ROWS = 5000;
export const MAX_QAQC_BYTES = 4000000;
export const QAQC_SAMPLE_TYPES = [
  ['routine', 'Routine'], ['standard', 'Standard'], ['blank', 'Blank'],
  ['field_dup', 'Field duplicate'], ['coarse_dup', 'Coarse duplicate'], ['pulp_dup', 'Pulp duplicate'],
].map(([value, label]) => ({ value, label }));
const field = (key, label, required = false) => ({ key, label, required });
export const QAQC_FIELDS = {
  samples: [field('lab_id', 'Laboratory ID', true), field('lab_batch_id', 'Lab job / batch ID', true),
    field('sample_id', 'Sample ID', true), field('sample_type', 'Sample type', true), field('parent_sample_id', 'Parent sample ID'),
    field('crm_id', 'CRM ID'), field('crm_revision', 'CRM revision'), field('hole_id', 'Hole ID'), field('from_m', 'From'), field('to_m', 'To')],
  crms: [field('crm_id', 'CRM ID', true), field('revision', 'CRM revision', true), field('element', 'Element', true),
    field('unit', 'Unit', true), field('expected', 'Certified expected value', true), field('sd', 'Certified standard deviation', true), field('source', 'Certificate / source', true)],
};
const aliases = {
  lab_id: ['lab_id', 'laboratory_id', 'lab'], lab_batch_id: ['lab_batch_id', 'lab_job', 'job_id', 'job'],
  sample_id: ['sample_id', 'sampleid', 'sample_no', 'sample'], sample_type: ['sample_type', 'sampletype'],
  parent_sample_id: ['parent_sample_id', 'parent_sample'], crm_id: ['crm_id', 'crm'], crm_revision: ['crm_revision'],
  hole_id: ['hole_id', 'holeid', 'bhid'], from_m: ['from_m', 'from'], to_m: ['to_m', 'to'],
  revision: ['revision', 'crm_revision'], element: ['element'], unit: ['unit'], expected: ['expected', 'certified_value'],
  sd: ['sd', 'standard_deviation'], source: ['source', 'certificate'],
};
const norm = s => String(s).trim().toLowerCase().replace(/[\s-]+/g, '_');
const text = value => value == null ? '' : String(value);
const present = value => text(value).trim().length > 0;
const constants = new Set(['lab_id', 'lab_batch_id', 'sample_type']);
export function autoQaqcMapping(kind, header) {
  const columns = {};
  for (const f of QAQC_FIELDS[kind] || []) {
    const matches = header.filter(h => aliases[f.key].includes(norm(h)));
    if (matches.length === 1) columns[f.key] = matches[0];
  }
  return { columns, constants: {}, decimalComma: false, elements: kind === 'samples'
    ? header.filter(h => !Object.values(columns).includes(h)).map(column => ({ column, element: column, unit: '', skip: true })) : [] };
}

function number(raw, decimalComma) {
  const s = text(raw).trim();
  if (!s) return { error: 'Missing value; supply the lab result or deselect this element. Missing is not below detection.' };
  if (s.startsWith('-')) return { error: 'Negative values are not supported. Confirm the laboratory convention; do not treat a negative code as a detection limit.' };
  const re = decimalComma ? /^\+?(?:\d+(?:,\d*)?|,\d+)(?:e[+-]?\d+)?$/i : /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  if (!re.test(s)) return { error: 'Expected a numeric value with the chosen decimal separator, without thousands separators.' };
  const value = Number(decimalComma ? s.replace(',', '.') : s);
  return Number.isFinite(value) && value >= 0 && value < 1e12 ? { value }
    : { error: 'Value must be finite, nonnegative and below 1e12.' };
}
export function parseQaqcValue(raw, { decimalComma = false } = {}) {
  const original = text(raw), s = original.trim();
  if (original.length > 100) return { error: 'Lab result text is longer than 100 characters.' };
  if (/^>/.test(s)) return { error: 'Upper-censored results (>) are not supported yet. Keep the original report; do not import the bound as an exact result.' };
  if (/^(BDL|ND|<DL|<LOD)$/i.test(s)) return { value: null, bdl: true, raw: original };
  if (s.startsWith('<')) {
    const parsed = number(s.slice(1).trim(), decimalComma);
    if (parsed.error) return parsed;
    if (parsed.value <= 0) return { error: 'A detection limit must be greater than zero.' };
    return { value: null, bdl: parsed.value, raw: original };
  }
  const parsed = number(s, decimalComma);
  return parsed.error ? parsed : { ...parsed, raw: original };
}

// PostgreSQL jsonb text adds one space after each structural comma/colon.
// Count separators outside strings, so the client respects the RPC byte cap.
export function qaqcJsonBytes(value) {
  const json = JSON.stringify(value);
  let inside = false, escaped = false, separators = 0;
  for (const c of json) {
    if (inside) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inside = false; }
    else if (c === '"') inside = true;
    else if (c === ',' || c === ':') separators++;
  }
  return new TextEncoder().encode(json).length + separators;
}

export function buildQaqcImport(kind, table, mapping = {}) {
  const out = [], lines = [], errors = [], warnings = [];
  let errorCount = 0;
  const fail = (line, message) => { errorCount++; if (errors.length < 50) errors.push({ line, message }); };
  const finish = () => ({ rows: out, lines, errors, errorCount, warnings });
  const fields = QAQC_FIELDS[kind];
  if (!fields) { fail(null, 'Choose samples or crms.'); return finish(); }
  const header = table?.header || [], rows = table?.rows || [];
  if (!rows.length || rows.length > MAX_QAQC_ROWS) { fail(null, 'Import 1 to 5,000 QA/QC rows at a time.'); return finish(); }
  if (new Set(header).size !== header.length) { fail(null, 'Column headers must be unique.'); return finish(); }
  const cols = mapping.columns || {}, values = mapping.constants || {};
  const selected = kind === 'samples' ? (mapping.elements || []).filter(e => e.skip !== true) : [];
  const mapped = [];
  for (const f of fields) {
    if (cols[f.key]) {
      if (!header.includes(cols[f.key])) fail(null, `${f.label}: mapped column is missing.`);
      mapped.push(cols[f.key]);
    } else if (f.required && !(kind === 'samples' && constants.has(f.key) && present(values[f.key]))) fail(null, `Map ${f.label}${constants.has(f.key) && kind === 'samples' ? ' or supply an explicit constant' : ''}.`);
  }
  if (kind === 'samples' && (selected.length < 1 || selected.length > 64)) fail(null, 'Select 1 to 64 measured elements and specify their units.');
  const elementNames = new Set();
  for (const e of selected) {
    if (!header.includes(e.column)) fail(null, `Element column ${e.column || '(blank)'} is missing.`);
    mapped.push(e.column);
    if (typeof e.element !== 'string' || !present(e.element) || e.element.length > 30) fail(null, `${e.column}: element name must be 1 to 30 characters.`);
    if (typeof e.unit !== 'string' || !present(e.unit) || e.unit.length > 30) fail(null, `${e.column}: specify a unit of 1 to 30 characters.`);
    if (elementNames.has(e.element)) fail(null, `Element ${e.element} is mapped more than once.`);
    elementNames.add(e.element);
  }
  if (new Set(mapped).size !== mapped.length) fail(null, 'A source column is mapped more than once. Give each field and element its own column.');
  if (errorCount) return finish();
  const get = (r, k) => cols[k] ? text(r[header.indexOf(cols[k])]) : kind === 'samples' && constants.has(k) ? text(values[k]) : '';
  const seen = new Map();
  rows.forEach((r, i) => {
    const line = table.lines?.[i] ?? i + 2, before = errorCount, record = {};
    for (const f of fields) {
      const raw = get(r, f.key);
      if (!present(raw)) { if (f.required) fail(line, `${f.label} is empty.`); continue; }
      if (['expected', 'sd', 'from_m', 'to_m'].includes(f.key)) {
        const parsed = number(raw, mapping.decimalComma === true);
        if (parsed.error) fail(line, `${f.label}: ${parsed.error}`);
        else record[f.key] = parsed.value;
      } else if (raw.length > (f.key === 'source' ? 1000 : 120)) fail(line, `${f.label} is too long.`);
      else record[f.key] = raw;
    }
    if (kind === 'crms') {
      if (record.sd !== undefined && record.sd <= 0) fail(line, 'Certified standard deviation must be greater than zero.');
    } else {
      if (!QAQC_SAMPLE_TYPES.some(t => t.value === record.sample_type)) fail(line, 'Choose an exact sample type: routine, standard, blank, field_dup, coarse_dup or pulp_dup.');
      const duplicate = ['field_dup', 'coarse_dup', 'pulp_dup'].includes(record.sample_type);
      if (duplicate && (!record.parent_sample_id || record.parent_sample_id === record.sample_id)) fail(line, 'A duplicate requires a different parent sample ID.');
      if (!duplicate && record.parent_sample_id) fail(line, 'Only duplicate samples have a parent sample ID.');
      if (record.sample_type === 'standard' && (!record.crm_id || !record.crm_revision)) fail(line, 'A standard requires its CRM ID and exact revision.');
      if (record.sample_type !== 'standard' && (record.crm_id || record.crm_revision)) fail(line, 'Only standards have a CRM ID and revision.');
      if (record.from_m !== undefined || record.to_m !== undefined) {
        if (!record.hole_id || record.from_m === undefined || record.to_m === undefined || record.to_m <= record.from_m) fail(line, 'An interval needs a hole ID and 0 ≤ From < To.');
      }
      record.values = {}; record.units = {}; record.bdl = {}; record.raw_values = {};
      for (const e of selected) {
        const parsed = parseQaqcValue(r[header.indexOf(e.column)], { decimalComma: mapping.decimalComma === true });
        if (parsed.error) fail(line, `${e.column}: ${parsed.error}`);
        else {
          // defineProperty also preserves an element literally named __proto__.
          for (const [object, value] of [[record.values, parsed.value], [record.units, e.unit], [record.raw_values, parsed.raw]]) Object.defineProperty(object, e.element, { value, enumerable: true, configurable: true, writable: true });
          if (parsed.bdl !== undefined) Object.defineProperty(record.bdl, e.element, { value: parsed.bdl, enumerable: true });
        }
      }
    }
    if (errorCount !== before) return;
    const key = JSON.stringify(kind === 'samples' ? [record.lab_id, record.lab_batch_id, record.sample_id] : [record.crm_id, record.revision, record.element, record.unit]);
    if (seen.has(key)) { fail(line, `This identity also appears on line ${seen.get(key)}.`); return; }
    seen.set(key, line); out.push(record); lines.push(line);
  });
  if (kind === 'samples') out.forEach((r, i) => {
    if (r.parent_sample_id && seen.has(JSON.stringify([r.lab_id, r.lab_batch_id, r.parent_sample_id]))) fail(lines[i], 'The duplicate’s parent is in this file. Import routine parents separately before duplicates.');
  });
  if (out.some(r => r.parent_sample_id)) warnings.push({ message: 'Duplicates require a previously imported routine parent in the same laboratory and lab job. Import parents separately.' });
  if (out.some(r => r.sample_type === 'standard')) warnings.push({ message: 'Import the exact CRM revision, element and unit definitions before importing standards.' });
  if (qaqcJsonBytes(out) > MAX_QAQC_BYTES) fail(null, 'Mapped rows exceed the 4 MB request limit. Split the file into smaller imports.');
  return finish();
}
