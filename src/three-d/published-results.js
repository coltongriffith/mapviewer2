// Published results for Exploration Maps 3D: the intercepts a company released, as records apart from the
// assays, and the callouts drawn straight from them (S.calloutMode "published"). Loaded on first use, like the
// layers; studio.js keeps only the hooks. Also the "manual" mode's callouts (hand-picked holes, their depths
// fixed when picked).
//
// A record (version 1), one per row of a table the user marked "Published results":
//   { version: 1, resultId, holeId, fromM, toM, publishedLengthText, gradeText, analyte, unit,
//     parentResultId, approvedText, releaseDate, sourceRef, approvalStatus }
// The numeric depths locate the interval on the desurveyed hole; the strings are kept as written (outer
// spaces trimmed), so the figure shows the release's own precision. Released composites never join the
// assays: they colour no hole and feed no histogram or shell.
// A published length that disagrees with to − from (beyond the precision it was written to) keeps both
// and is flagged; neither is picked silently.
// A result whose parentResultId names another result on the same hole, and lies inside it, is an "incl."
// interval: its own record, ribbon and wording, drawn as the second line of its parent's callout.
// Edited wording (S.pubOverrides[resultId].line1) belongs to that result and to the depths it was written
// for (at: [fromM, toM]); if the result's depths change, the approved text shows and the panel says why.

export const RECORD_VERSION = 1;
// The columns of a release table ("Published results" role), offered for mapping once the user picks the role
// and guessed then; Hole, From and To come from the core column matcher. Each can be changed in the files list.
export const PUB_FIELDS = { resultId: 'Result ID', hole: 'Hole ID', from: 'From', to: 'To', length: 'Published length', grade: 'Grade', analyte: 'Analyte', unit: 'Unit', parent: 'Parent result', approved: 'Approved text', date: 'Release date', source: 'Source', status: 'Approval status' };
const norm = (h) => String(h).toLowerCase().replace(/[\s\-.()/#]+/g, '_').replace(/^_+|_+$/g, '');
const PUB_NAME = { resultId: /^(result_?id|result|intercept_?id|release_?id)$/, length: /^(published_)?(length|interval|width|core_length)(_m)?$/, grade: /^(published_)?(grade|grade_text|avg_grade)$/,
  analyte: /^(analyte|element|metal|commodity)$/, unit: /^(units?|grade_unit)$/, parent: /^(parent|parent_?(result_?)?id|parent_result)$/, approved: /^(approved(_?text)?|published_text|headline|callout_?text)$/,
  date: /^(release_?date|date|published_date)$/, source: /^(source(_?ref)?|reference|news_release)$/, status: /^(approval_?status|status|approval)$/ };
export function pubCols(header, cols) {
  const n = header.map(norm), out = { ...cols };
  Object.entries(PUB_NAME).forEach(([k, re]) => { const i = n.findIndex((h) => re.test(h)); if (i >= 0 && out[k] === undefined) out[k] = i; });
  return out;
}
const TOL = 0.01;
const APPROVED = /^(approved|released|published|final)$/i;
export const isApproved = (r) => APPROVED.test(r.approvalStatus || '');
const str = (v) => { const t = String(v ?? '').trim(); return t || null; };
const depth = (v) => { const t = str(v); return t !== null && /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? +t : NaN; };
const m = (v) => `${+v.toFixed(3)}`;

// The published length against the depths: null when they agree to the precision the length was written
// to ("122" covers 121.5-122.5 m, "122.0" covers 121.95-122.05 m), else both numbers.
export function lengthCheck(text, fromM, toM) {
  const x = String(text ?? '').match(/^\s*(\d+(?:\.(\d+))?)/);
  if (!x) return null;
  const pub = +x[1], tol = Math.max(0.5 * 10 ** -(x[2] || '').length, TOL) + 1e-9, span = toM - fromM;
  return Math.abs(pub - span) > tol ? { published: pub, depths: +span.toFixed(6) } : null;
}

// Rows of one release table to records, and what is wrong with them: { results, problems }. A row without a
// result ID, a hole, valid depths or any text is left out; the rest are kept and flagged where needed.
export function readResults(header, rows, cols, file = '') {
  const results = [], problems = [], seen = new Set(), noStatus = cols.status === undefined;
  const flag = (kind, id, message) => problems.push({ kind, resultId: id, file, message });
  rows.forEach((r, i) => {
    const get = (k) => (cols[k] === undefined ? null : str(r[cols[k]])), id = get('resultId'), at = `Row ${i + 2}${file ? ` of ${file}` : ''}`;
    if (!id) { if (r.some((v) => str(v))) flag('no-result-id', null, `${at} has no result ID, so it is left out.`); return; }
    if (seen.has(id)) { flag('duplicate-result-id', id, `${at}: result ID ${id} is used twice; the later row is left out.`); return; }
    seen.add(id);
    const rec = { version: RECORD_VERSION, resultId: id, holeId: get('hole'), fromM: depth(r[cols.from]), toM: depth(r[cols.to]), publishedLengthText: get('length'), gradeText: get('grade'), analyte: get('analyte'), unit: get('unit'),
      parentResultId: get('parent'), approvedText: get('approved'), releaseDate: get('date'), sourceRef: get('source'), approvalStatus: noStatus ? 'approved' : get('status') };
    if (!rec.holeId) return flag('no-hole', id, `${id} has no hole ID, so it is left out.`);
    if (!Number.isFinite(rec.fromM) || !Number.isFinite(rec.toM) || rec.toM <= rec.fromM) return flag('bad-depths', id, `${id}: From and To must be depths in metres with To below From, so it is left out.`);
    if (!rec.approvedText && !rec.gradeText) return flag('no-text', id, `${id} has neither approved text nor a grade, so it is left out.`);
    const d = lengthCheck(rec.publishedLengthText, rec.fromM, rec.toM);
    if (d) flag('length-discrepancy', id, `${id}: the published length (${rec.publishedLengthText}) is not To − From (${m(rec.toM)} − ${m(rec.fromM)} = ${m(d.depths)} m). Both are kept: the text as published, the depths for where it sits. Check the release.`);
    if (!isApproved(rec)) flag('not-approved', id, `${id} is ${rec.approvalStatus ? `"${rec.approvalStatus}"` : 'without an approval status'}, so it is not drawn.`);
    results.push(rec);
  });
  results.forEach((r) => {
    if (!r.parentResultId) return;
    const p = results.find((x) => x.resultId === r.parentResultId);
    if (!p) flag('unknown-parent', r.resultId, `${r.resultId}: its parent ${r.parentResultId} is not in the table, so it is drawn on its own.`);
    else if (p.holeId !== r.holeId) flag('parent-other-hole', r.resultId, `${r.resultId} is on ${r.holeId} but its parent ${p.resultId} is on ${p.holeId}, so it is drawn on its own.`);
    else if (r.fromM < p.fromM - TOL || r.toM > p.toM + TOL) flag('outside-parent', r.resultId, `${r.resultId} (${m(r.fromM)}–${m(r.toM)} m) is not inside its parent ${p.resultId} (${m(p.fromM)}–${m(p.toM)} m), so it is drawn on its own.`);
  });
  if (noStatus && results.length) problems.push({ kind: 'no-status-column', resultId: null, file, message: `${file || 'The table'} has no approval status column, so every row is taken as approved.` });
  return { results, problems };
}

// Every release table among the files (role "published"), read once per text and column choice.
const memo = new WeakMap();
export function readFiles(files) {
  const out = { results: [], problems: [] }, ids = new Set();
  files.filter((f) => f.role === 'published' && f.header).forEach((f) => {
    if (f.cols.resultId === undefined) f.cols = pubCols(f.header, f.cols); // the columns guessed once it is a release table
    if (['resultId', 'hole', 'from', 'to'].some((k) => f.cols[k] === undefined)) return out.problems.push({ kind: 'unmapped', resultId: null, file: f.name, message: `${f.name}: pick its Result ID, Hole ID, From and To columns (step 1).` });
    const sig = `${f.text.length}|${JSON.stringify(f.cols)}`;
    let hit = memo.get(f); if (!hit || hit.sig !== sig) memo.set(f, hit = { sig, ...readResults(f.header, f.rows, f.cols, f.name) });
    hit.results.forEach((r) => { if (ids.has(r.resultId)) out.problems.push({ kind: 'duplicate-result-id', resultId: r.resultId, file: f.name, message: `Result ID ${r.resultId} is in more than one table; the copy in ${f.name} is left out.` }); else { ids.add(r.resultId); out.results.push(r); } });
    out.problems.push(...hit.problems);
  });
  return out;
}
// The same, checked against the holes on the figure: a result on a hole without a collar is not drawn, and
// one past the end of its hole as drawn is flagged.
export function readAll(files, holes = []) {
  const out = readFiles(files), hole = new Map(holes.map((h) => [h.id, h]));
  out.results.forEach((r) => {
    const h = hole.get(r.holeId), flag = (kind, message) => out.problems.push({ kind, resultId: r.resultId, file: '', message });
    if (!h) flag('no-collar', `${r.resultId}: hole ${r.holeId} is not among the collars, so it is not drawn.`);
    else if (r.toM > h.len + TOL) flag('beyond-hole', `${r.resultId} ends at ${m(r.toM)} m, past the end of ${h.id} as drawn (${m(h.len)} m).`);
  });
  return out;
}

// The parent a result is drawn under: another result on the same hole that contains it (no loops).
export function parentOf(r, byId) {
  const p = r.parentResultId && byId.get(r.parentResultId);
  return p && p !== r && p.holeId === r.holeId && r.fromM >= p.fromM - TOL && r.toM <= p.toM + TOL ? p : null;
}
const span = (r) => ({ from: r.fromM, len: r.toM - r.fromM, mid: (r.fromM + r.toM) / 2, avg: null });

// Callouts from the approved results on holes of the figure, unticked ones (ov[id].show === false) left out.
// One callout per result, except that a shown result whose shown ancestor contains it is an "incl." line on
// that ancestor's callout (with its own ribbon): a nested interval is never a second callout or a second
// reported interval. Each: { key: resultId, h, pub, kids, ic: { broad, incl, incls } }, in table order.
export function pubCallouts(results, holes, ov = {}) {
  const hole = new Map(holes.map((h) => [h.id, h])), byId = new Map(results.map((r) => [r.resultId, r]));
  const on = (r) => isApproved(r) && hole.has(r.holeId) && (ov[r.resultId] || {}).show !== false;
  const topOf = (r) => { let top = r; const seen = new Set([r]); for (let p = parentOf(r, byId); p && !seen.has(p); p = parentOf(p, byId)) { seen.add(p); if (on(p)) top = p; } return top; };
  const cards = new Map();
  results.filter(on).forEach((r) => { const t = topOf(r); if (!cards.has(t)) cards.set(t, { key: t.resultId, h: hole.get(t.holeId), pub: t, kids: [] }); if (t !== r) cards.get(t).kids.push(r); });
  return [...cards.values()].map((c) => {
    c.kids.sort((a, b) => a.fromM - b.fromM); const incls = c.kids.map(span);
    return { ...c, ic: { broad: span(c.pub), incl: incls[0] || null, incls } };
  });
}

// The wording drawn: the approved text as written, else length @ grade from the depths; edited wording only
// while the result still has the depths it was written for.
const fixM = (t) => (/^\d+(\.\d+)?$/.test(t) ? `${t} m` : t);
export function headline(r) {
  if (r.approvedText) return { l1: r.approvedText, l1b: '' };
  const g = r.gradeText + (r.unit && !r.gradeText.endsWith(r.unit) ? (r.unit === '%' ? '%' : ` ${r.unit}`) : '');
  return { l1: `${fixM(r.publishedLengthText || m(r.toM - r.fromM))} @ ${[g, r.analyte].filter(Boolean).join(' ')}`, l1b: ` from ${m(r.fromM)} m` };
}
// The depths wording was written for: a result's [fromM, toM]; a calculated callout's [from, to] and any
// "incl." [from, to]. tie() keeps them with the wording (setCallout), a hand-picked hole those it was ticked at.
export const icAt = (ic) => ic && [ic.broad.from, ic.broad.from + ic.broad.len, ...(ic.incl ? [ic.incl.from, ic.incl.from + ic.incl.len] : [])];
export function tie(cur, o, mode, at) {
  const manual = mode === 'manual';
  if (manual && o.show === false) delete cur.at;
  else if (at && !(manual && cur.at) && (o.line1 !== undefined || o.line2 !== undefined || (manual && cur.show))) cur.at = at;
}
export const atOf = (results, id) => { const r = results.find((x) => x.resultId === id); return r ? [r.fromM, r.toM] : null; };
export const stale = (o, r) => !o.at || Math.abs(o.at[0] - r.fromM) > TOL || Math.abs(o.at[1] - r.toM) > TOL;
export function textOf(r, ov = {}) { const o = ov[r.resultId] || {}; return o.line1 && !stale(o, r) ? { l1: o.line1, l1b: '' } : headline(r); }
export function pubLines(c, ov = {}) {
  const top = textOf(c.pub, ov), kids = c.kids.map((r) => { const t = textOf(r, ov), s = t.l1 + t.l1b; return /^incl/i.test(s) ? s : `incl. ${s}`; });
  return { l1: top.l1, l1b: top.l1b, l2: kids.length ? kids.join('; ') : null };
}
// Wording kept but not drawn: written for other depths, or for a result no longer in the tables.
export function staleNotes(results, ov = {}) {
  const byId = new Map(results.map((r) => [r.resultId, r]));
  return Object.entries(ov).filter(([, o]) => o.line1).map(([id, o]) => {
    const r = byId.get(id);
    if (!r) return `Your wording for ${id} is kept, but no result ${id} is in the tables.`;
    return stale(o, r) ? `${id}: your wording was written for ${o.at ? `${m(o.at[0])}–${m(o.at[1])} m` : 'other depths'}; the result is now ${m(r.fromM)}–${m(r.toM)} m, so its approved text is shown. Retype it to keep yours.` : null;
  }).filter(Boolean);
}

// For getState(): a published callout's result IDs, and the tables' records and flags.
export const ids = (c) => (c.pub ? { resultId: c.key, fromM: c.pub.fromM, toM: c.pub.toM, incl: c.kids.map((r) => r.resultId) } : {});
export const summary = (files, holes, ov) => { if (!files.some((f) => f.role === 'published')) return null; const r = readAll(files, holes); return { ...r, staleWording: staleNotes(r.results, ov) }; };

// Manual mode: only the holes ticked by hand, each at the depths fixed when it was ticked or reworded
// (o.at: [from, to, inclFrom, inclTo]), whatever the cut-offs do since; calc: the calculated callouts, for a
// ticked hole not yet fixed. avg(h, from, to): the grade over those depths.
export function manualCallouts(calc, holes, ov, avg) {
  const hole = new Map(holes.map((h) => [h.id, h])), out = [];
  Object.entries(ov).forEach(([id, o]) => {
    const h = hole.get(id); if (!h || o.show !== true) return;
    if (!o.at) { const c = calc.find((x) => x.key === id); if (c) out.push(c); return; }
    const part = (a, b) => ({ from: a, len: b - a, mid: (a + b) / 2, avg: avg(h, a, b) });
    const broad = part(o.at[0], o.at[1]), incl = Number.isFinite(o.at[2]) ? part(o.at[2], o.at[3]) : null;
    if (Number.isFinite(broad.avg)) out.push({ key: id, h, ic: { broad, incl: incl && Number.isFinite(incl.avg) ? incl : null } });
  });
  return out.sort((a, b) => b.ic.broad.len * b.ic.broad.avg - a.ic.broad.len * a.ic.broad.avg);
}

// A line under the release table in the files list.
export function fileNote(f, esc) {
  const { results, problems } = readFiles([f]), n = results.filter(isApproved).length;
  return `<span class="muted">${n} approved result${n === 1 ? '' : 's'} of ${results.length}</span>${problems.filter((p) => p.kind !== 'not-approved').map((p) => `<span class="${p.kind === 'no-status-column' ? 'muted' : 'warn'}">${esc(p.message)}</span>`).join('')}`;
}
