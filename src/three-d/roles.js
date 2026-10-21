// File roles for the optional figure layers: lithology/alteration logs and geophysics points, and the
// published-results (release) table. Small and loaded with the page, because a file's role is decided the
// moment it is added; the layers themselves (geology.js, geophys.js, published-results.js) load on first use.

const norm = (h) => String(h).toLowerCase().replace(/[\s\-.()/#]+/g, '_').replace(/^_+|_+$/g, '');
const LITHO_NAME = /^(lith|litho|lithology|lith_code|lithcode|lithology_code|rock|rock_type|rocktype|rock_code|geology|geol|geol_code|unit|unit_code|formation|fm|alteration|alt|alt_code|alteration_code|alt_type|domain|code|zone|log_code)$/;
const DESC_NAME = /^(desc|description|lith_desc|lithology_description|alt_desc|unit_name|name|comments?|notes?|remarks?)$/;
const LINE_NAME = /^(line|line_id|lineid|line_no|line_number|line_name|survey_line|profile|profile_id)$/;
const GEOPHYS_NAME = /(charg|resist|conduct|^rho|ohm|mv_?v|msec|^ip$|^ip_|^mt$|^mt_|susc|^mag|density|^value$|^val$|^model|inv|^res$|^cond$|^sigma)/;
const GEOPHYS_FILE = /(^|[^a-z])(ip|mt|geophys\w*|inversion|charg\w*|resist\w*|conduct\w*|amt|csamt|dcip)([^a-z]|$)/i;

const isNum = (v) => { const t = String(v ?? '').trim().replace(/^</, ''); return t !== '' && Number.isFinite(parseFloat(t)) && /^[-+]?[\d.]/.test(t); };
const share = (rows, i, test) => { let n = 0, tot = 0; for (const r of rows.slice(0, 300)) { const v = (r[i] ?? '').trim(); if (!v) continue; tot++; if (test(v)) n++; } return tot ? n / tot : 0; };

// Geosoft-style XYZ: "/" comment lines (the last one before the data names the columns),
// "Line 1000" / "Tie 10" lines that start a new line, whitespace-separated values, "*" for no data.
// Plain whitespace-separated text with a header row reads the same way.
export function isXYZ(name, text) {
  if (/\.(xyz|dat)$/i.test(name)) return true;
  const first = (text.split(/\r?\n/).find((l) => l.trim()) || '');
  return /^\s*\//.test(first) || (/^\s*\S+(\s+\S+){2,}\s*$/.test(first) && !/[,;\t]/.test(first));
}
export function parseXYZ(text) {
  let header = null, lastComment = null, line = '', hasLine = false; const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim(); if (!t) continue;
    if (t.startsWith('/')) { lastComment = t.replace(/^\/+\s*/, ''); continue; }
    const lm = t.match(/^(line|tie|trend)\s+(\S+)/i);
    if (lm) { line = lm[2]; hasLine = true; continue; }
    const parts = t.split(/[\s,;]+/);
    if (!header) {
      if (parts.some((p) => !isNum(p) && p !== '*')) { header = parts; continue; } // a header row of names
      const named = lastComment ? lastComment.split(/[\s,;]+/) : [];
      header = named.length === parts.length ? named : parts.map((_, i) => ['X', 'Y', 'Z', 'Value'][i] || `Col${i + 1}`);
    }
    rows.push(parts.map((p) => (p === '*' ? '' : p)).concat(hasLine ? [line] : []));
  }
  header = (header || []).concat(hasLine ? ['Line'] : []);
  // Rows read before the first "Line" record get an empty line ID.
  rows.forEach((r) => { while (r.length < header.length) r.push(''); });
  return { header, rows };
}

// Refines the role from the core column matcher: a hole/from/to file whose code column is text is a
// lithology log; an east/north/elevation file with a property column (or a geophysics file name) is
// geophysics. Adds the matched columns to entry.cols (code, desc / value, line).
export function refineRole(entry, role, name) {
  const { header, rows, cols } = entry, n = header.map(norm), used = new Set(Object.values(cols));
  const has = (...k) => k.every((x) => cols[x] !== undefined);
  // A table of published results is never read as assays (its composites would colour the holes and feed the
  // shell), and never taken for a release table either: it waits, unrecognised, for the user to say so.
  if (has('hole', 'from', 'to') && n.some((h) => RELEASE_HINT.test(h))) { entry.hint = 'published'; return 'unknown'; }
  if (has('hole', 'from', 'to')) {
    const cand = n.map((h, i) => ({ h, i })).filter(({ h, i }) => !used.has(i) && LITHO_NAME.test(h));
    const code = cand.find(({ i }) => share(rows, i, (v) => !isNum(v)) > 0.5) || cand.find(({ h }) => /lith|alt|geol|rock|unit|code/.test(h));
    const numeric = n.filter((h, i) => !used.has(i) && (!code || i !== code.i) && share(rows, i, isNum) > 0.8).length;
    if (code && (/lith|geol|alter|log|rock/i.test(name) || numeric === 0 || /lith|alt|geol|rock/.test(code.h))) {
      cols.code = code.i;
      const d = n.findIndex((h, i) => i !== code.i && !used.has(i) && DESC_NAME.test(h)); if (d >= 0) cols.desc = d;
      return 'litho';
    }
    return role;
  }
  // A lithology legend: a code column and a name or colour column, no holes and no coordinates (QMD, Quartz
  // monzodiorite, #e3b8c8).
  if (!has('hole') && !has('east') && !has('north')) {
    const code = n.findIndex((h) => LITHO_NAME.test(h)), name = n.findIndex((h, i) => i !== code && DESC_NAME.test(h)), color = n.findIndex((h) => /^(colou?r|hex|colou?r_hex|fill|rgb)$/.test(h));
    if (code >= 0 && (name >= 0 || color >= 0) && share(rows, code, (v) => !isNum(v)) > 0.5) {
      Object.assign(cols, { code }, name >= 0 ? { desc: name } : {}, color >= 0 ? { color } : {});
      return 'lithlegend';
    }
  }
  if (has('east', 'north', 'elev') && !(role === 'collar' && (has('depth') || has('az') || has('dip')))) {
    const free = n.map((h, i) => ({ h, i })).filter(({ i }) => !used.has(i));
    const value = free.find(({ h, i }) => GEOPHYS_NAME.test(h) && share(rows, i, isNum) > 0.8)
      || (GEOPHYS_FILE.test(name) ? free.find(({ h, i }) => !LINE_NAME.test(h) && share(rows, i, isNum) > 0.8) : null);
    if (value) {
      cols.value = value.i;
      const l = n.findIndex((h, i) => i !== value.i && !used.has(i) && LINE_NAME.test(h)); if (l >= 0) cols.line = l;
      return 'geophys';
    }
  }
  return role;
}

// Published results ("Published results" role, published-results.js): a release table is only ever one by the
// user's choice, and its columns are mapped then. A file that looks like one is held back from the assays.
const RELEASE_HINT = /^(result_?id|approved_?text|approval_?status|release_?date|published_\w+)$/;
