// Exploration Maps 3D: drill data from a property's drill database (Phase 2B;
// supabase/migrations/20261027100000_drill_database.sql). Loaded by
// account-core.js on first use: "From property drill database" in step 1, and,
// when a figure that took its holes from a property opens, a check for newer
// imports.
//
// The current rows (superseded_by_batch is null) are read a page at a time
// and written out as the CSV files an upload would be (property-collars.csv,
// ...), so the editor reads them with the same column matcher and parsers.
// The figure keeps that text, as it keeps uploaded files, and so stays as it
// was approved: S.drillSource records the property and the newest import (or
// roll-back) it saw. Opening the figure later only offers newer data; the
// figure changes when the user presses Update, never by itself.

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const em = () => window.EM3D;
const PAGE = 1000;
const fmtN = (n) => Number(n || 0).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${fmtN(n)} ${n === 1 ? one : many}`;

export const FILE_NAMES = { collars: 'property-collars.csv', surveys: 'property-surveys.csv', assays: 'property-assays.csv', lithology: 'property-lithology.csv' };
const DRILL_ROLES = ['collar', 'survey', 'assay', 'litho'];
const TABLES = {
  collars: { select: 'hole_id,x,y,z,crs,azimuth,dip,depth,status,planned', order: ['hole_id'] },
  surveys: { select: 'hole_id,depth_m,azimuth,dip', order: ['hole_id', 'depth_m'] },
  assays: { select: 'hole_id,from_m,to_m,values,units', order: ['hole_id', 'from_m', 'to_m'] },
  lithology: { select: 'hole_id,from_m,to_m,code,description', order: ['hole_id', 'from_m', 'to_m'] },
};

// ── Rows to files (pure) ────────────────────────────────────────────────────
const cell = (v) => {
  const t = v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v);
  return /[",;\t\r\n]|^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (header, rows) => `${[header, ...rows].map((r) => r.map(cell).join(',')).join('\n')}\n`;
// An element and unit as a column the editor reads as a grade with its unit (labelFor in studio.js).
const UNIT_TOKEN = { '%': 'pct', 'g/t': 'gpt', ppm: 'ppm', ppb: 'ppb' };
const gradeHeader = (el, unit) => (unit ? `${el}_${UNIT_TOKEN[unit] || String(unit).replace(/[^a-z0-9]+/gi, '')}` : el);

/**
 * The editor's files for a property's current drill rows: { collars, surveys,
 * assays, lithology } of rows as selected (TABLES). Assay columns follow the
 * order the elements were imported in (batches' mappings, oldest first), then
 * the rest by name; one column per element and unit, so an element stored in
 * two units is never mixed.
 * @returns {{ name: string, text: string }[]} one file per kind that has rows
 */
export function toFiles(rows, batches = []) {
  const out = [];
  const c = rows.collars || [];
  if (c.length) {
    // Collars in latitude/longitude (EPSG:4326) are read as such, and converted, by the editor.
    const ll = c.every((r) => r.crs === 'EPSG:4326');
    out.push({ name: FILE_NAMES.collars, text: csv(['HoleID', ll ? 'Longitude' : 'Easting', ll ? 'Latitude' : 'Northing', 'Elevation', 'Azimuth', 'Dip', 'Depth', 'Status'],
      c.map((r) => [r.hole_id, r.x, r.y, r.z, r.azimuth, r.dip, r.depth, r.planned ? (r.status ? `${r.status} (planned)` : 'Planned') : r.status])) });
  }
  const s = rows.surveys || [];
  if (s.length) out.push({ name: FILE_NAMES.surveys, text: csv(['HoleID', 'Depth', 'Azimuth', 'Dip'], s.map((r) => [r.hole_id, r.depth_m, r.azimuth, r.dip])) });
  const a = rows.assays || [];
  if (a.length) {
    const order = [];
    [...batches].filter((b) => b.kind === 'assays' && !b.rolled_back_at).sort((p, q) => Date.parse(p.created_at) - Date.parse(q.created_at))
      .forEach((b) => (b.mapping?.elements || []).forEach((e) => { if (!e.skip && e.name && !order.includes(e.name)) order.push(e.name); }));
    const keys = new Map(); // "Cu|%" → { el, unit }
    for (const r of a) for (const el of Object.keys(r.values || {})) { const unit = r.units?.[el] || ''; keys.set(`${el}|${unit}`, { el, unit }); }
    const rank = (el) => { const i = order.indexOf(el); return i < 0 ? order.length : i; };
    const cols = [...keys.values()].sort((p, q) => rank(p.el) - rank(q.el) || p.el.toLowerCase().localeCompare(q.el.toLowerCase()) || p.unit.localeCompare(q.unit));
    const line = (r) => [r.hole_id, r.from_m, r.to_m, ...cols.map((k) => ((r.units?.[k.el] || '') === k.unit ? r.values?.[k.el] : null))];
    // The editor tells grade columns by their first 200 rows: each column's first value goes up front.
    const first = new Set(cols.map((k) => a.findIndex((r) => r.values?.[k.el] != null && (r.units?.[k.el] || '') === k.unit)).filter((i) => i >= 0));
    const ordered = [...[...first].sort((p, q) => p - q).map((i) => a[i]), ...a.filter((_, i) => !first.has(i))];
    out.push({ name: FILE_NAMES.assays, text: csv(['HoleID', 'From', 'To', ...cols.map((k) => gradeHeader(k.el, k.unit))], ordered.map(line)) });
  }
  const l = rows.lithology || [];
  if (l.length) out.push({ name: FILE_NAMES.lithology, text: csv(['HoleID', 'From', 'To', 'Code', 'Description'], l.map((r) => [r.hole_id, r.from_m, r.to_m, r.code ?? r.description, r.description])) });
  return out;
}

// ── Snapshot and newer data (pure) ──────────────────────────────────────────
const at = (t) => (t ? Date.parse(t) : -Infinity);
// The latest change to a property's drill data: an import or a roll-back.
const latestOf = (batches) => batches.reduce((m, b) => Math.max(m, at(b.created_at), at(b.rolled_back_at)), -Infinity);

/** What a figure records about the data it took: S.drillSource. */
export function snapshotOf({ propertyId, propertyName = null }, batches, rows) {
  const live = batches.filter((b) => !b.rolled_back_at).sort((p, q) => at(q.created_at) - at(p.created_at));
  const t = latestOf(batches), crs = [...new Set((rows.collars || []).map((r) => r.crs).filter(Boolean))];
  return {
    kind: 'property', propertyId, propertyName,
    latestBatchId: live[0]?.id || null, latestAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
    holes: (rows.collars || []).length, assays: (rows.assays || []).length, crs: crs.length === 1 ? crs[0] : null,
  };
}

/**
 * Imports since the snapshot (not rolled back), and roll-backs since it of
 * imports it had: { imports, holes (new collars), assays (new or changed),
 * rolledBack }, or null when nothing changed.
 */
export function newerSince(ref, batches) {
  const t = at(ref?.latestAt);
  const added = batches.filter((b) => !b.rolled_back_at && at(b.created_at) > t);
  const rolledBack = batches.filter((b) => b.rolled_back_at && at(b.rolled_back_at) > t && at(b.created_at) <= t).length;
  if (!added.length && !rolledBack) return null;
  const sum = (kind, f) => added.filter((b) => b.kind === kind).reduce((n, b) => n + f(b.summary || {}), 0);
  return { imports: added.length, holes: sum('collars', (s) => +s.new || 0), assays: sum('assays', (s) => (+s.new || 0) + (+s.changed || 0)), rolledBack };
}

export const noticeText = (d) => (d.imports
  ? `New drill data since this figure (${plural(d.holes, 'new hole')}, ${plural(d.assays, 'assay')})${d.rolledBack ? `, ${plural(d.rolledBack, 'import')} rolled back` : ''}`
  : `Drill data changed since this figure (${plural(d.rolledBack, 'import')} rolled back)`);

// ── Reading the database ────────────────────────────────────────────────────
let host = null; // { client, current, say, listHomes } from account-core.js
let props = [];  // the properties the user is a member of
let pending = null; // the newer data behind the notice: { ref }

async function listBatches(sb, propertyId) {
  const { data, error } = await sb.from('drill_import_batches').select('id,kind,summary,mapping,created_at,rolled_back_at')
    .eq('property_id', propertyId).order('created_at', { ascending: false }).limit(1000);
  if (error) throw new Error(`Could not read the property's drill imports (${error.message}).`);
  return data || [];
}

// One table's current rows, PAGE at a time in key order (the order of its current-row index).
// PostgREST's raw OR grammar needs quoted/escaped text independently of URL encoding.
const filterValue = (v) => typeof v === 'string' ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : String(v);
async function readAll(sb, kind, propertyId, onPage) {
  const { select, order } = TABLES[kind], rows = [], cursors = new Set();
  let cursor = null;
  for (;;) {
    let q = sb.from(`drill_${kind}`).select(select).eq('property_id', propertyId).is('superseded_by_batch', null);
    order.forEach((k) => { q = q.order(k, { ascending: true }); });
    if (cursor) {
      if (order.length === 1) q = q.gt(order[0], filterValue(cursor[0]));
      else {
        const terms = order.map((k, i) => {
          const parts = order.slice(0, i).map((p, j) => `${p}.eq.${filterValue(cursor[j])}`);
          parts.push(`${k}.gt.${filterValue(cursor[i])}`);
          return parts.length === 1 ? parts[0] : `and(${parts.join(',')})`;
        });
        // The redundant leading-key bound enables an index seek before the OR filter.
        q = q.gte(order[0], filterValue(cursor[0])).or(terms.join(','));
      }
    }
    const { data, error } = await q.limit(PAGE);
    if (error) throw new Error(`Could not read the property's ${kind} (${error.message}).`);
    if (!data?.length) return rows;
    cursor = order.map((k) => data.at(-1)[k]);
    const key = JSON.stringify(cursor);
    if (cursor.some((v, i) => i === 0 ? typeof v !== 'string' || !v.length : !Number.isFinite(v)) || cursors.has(key)) {
      throw new Error(`Could not read the property's ${kind} (invalid or repeated page cursor).`);
    }
    cursors.add(key);
    for (const r of data || []) rows.push(r);
    onPage(rows.length);
    // Continue to an empty page even if a deployment caps responses below PAGE.
  }
}

/**
 * Collars in more than one coordinate system cannot share one figure (they would be placed untransformed):
 * a plain message naming each system and its count, or null when they all share one.
 */
export function mixedCrs(collars, name = 'This property') {
  const n = new Map();
  for (const r of collars || []) n.set(r.crs || null, (n.get(r.crs || null) || 0) + 1);
  if (n.size < 2) return null;
  const list = [...n].sort((p, q) => q[1] - p[1]).map(([c, k]) => `${c || 'no coordinate system'}: ${plural(k, 'collar')}`).join(', ');
  return `${name}'s collars are in more than one coordinate system (${list}). Re-import them in one on the property page, then load again.`;
}

/** The property's current drill data as files, and the snapshot to record. sb: a Supabase client. */
export async function pull(sb, prop, onProgress = () => {}, tries = 2) {
  const before = await listBatches(sb, prop.id), counts = {};
  const rows = Object.fromEntries(await Promise.all(Object.keys(TABLES).map(async (k) => [k, await readAll(sb, k, prop.id, (n) => { counts[k] = n; onProgress(counts); })])));
  // An import that landed while the pages were read: read again, so a figure never mixes two versions.
  if (latestOf(await listBatches(sb, prop.id)) !== latestOf(before)) {
    if (tries > 1) return pull(sb, prop, onProgress, tries - 1);
    throw new Error('The drill data changed while it was loading. Try again in a moment.');
  }
  const mixed = mixedCrs(rows.collars, prop.name || undefined);
  if (mixed) throw new Error(mixed);
  return { files: toFiles(rows, before), ref: snapshotOf({ propertyId: prop.id, propertyName: prop.name }, before, rows), rows };
}

// ── UI ──────────────────────────────────────────────────────────────────────
const hideNotice = () => { $('drill-notice').hidden = true; };
/** Another figure opened (or none): its notice and pending update go with it. */
export function reset() { hideNotice(); pending = null; }
// The pending update still belongs to the figure on screen: the same saved figure and property.
const stillOurs = (p) => !!p && host.current()?.id === p.figureId && em().getState().drillSource?.propertyId === p.ref.propertyId;
const progressText = (n) => `Loading… ${['collars', 'surveys', 'assays', 'lithology'].filter((k) => n[k]).map((k) => `${fmtN(n[k])} ${k}`).join(', ')}`;

export function init(h) {
  host = h;
  $('drill-pick').addEventListener('click', (e) => { if (e.target.id === 'drill-load') load(); });
  $('drill-update').addEventListener('click', update);
  $('drill-dismiss').addEventListener('click', hideNotice);
}

export async function toggle() {
  const box = $('drill-pick'), body = $('drill-body');
  box.hidden = !box.hidden;
  $('drill-add').setAttribute('aria-expanded', String(!box.hidden));
  if (box.hidden) return;
  body.innerHTML = '<p class="muted">Loading your properties…</p>';
  props = (await host.listHomes()).properties;
  if (!props.length) { body.innerHTML = '<p class="muted">You are not a member of a company property yet.</p>'; return; }
  const pick = em().getState().drillSource?.propertyId || host.current()?.home?.propertyId;
  body.innerHTML = `<label class="field"><span>Property</span><select id="drill-prop">${props.map((p) => `<option value="${esc(p.id)}"${p.id === pick ? ' selected' : ''}>${esc(p.name)} · ${esc(p.orgName)}</option>`).join('')}</select></label>
    <p class="muted">Its current collars, surveys, assays and lithology replace the figure's drill files. The figure keeps this data until you choose to update it.</p>
    <div class="row"><button class="btn primary" type="button" id="drill-load">Load drill data</button></div><p class="muted" id="drill-progress" role="status"></p>`;
}

async function load() {
  const prop = props.find((p) => p.id === $('drill-prop').value), btn = $('drill-load'), out = $('drill-progress');
  if (!prop) return;
  btn.disabled = true; out.textContent = 'Loading…';
  try {
    const { files, ref } = await pull(await host.client(), prop, (n) => { out.textContent = progressText(n); });
    if (!ref.holes) throw new Error(`${prop.name} has no collars in its drill database yet. Import them on the property page (Drill data).`);
    const E = em(), st = E.getState(), crs = st.terrain.crs;
    // A new data set (as when the sample is replaced): the property's data replaces the figure's drill files;
    // topography, models, overlays and geophysics stay.
    const keep = st.usingSample ? [] : E.getProject().files.filter((f) => !DRILL_ROLES.includes(f.role) && !Object.values(FILE_NAMES).includes(f.name));
    if (!st.usingSample) E.clearFiles();
    E.addFiles([...keep.map(({ name, text }) => ({ name, text })), ...files], { drillSource: ref });
    // The property's coordinate system when it has one; the figure's earlier one otherwise.
    if (ref.crs || crs) await E.setCRS(ref.crs || crs).catch(() => {});
    out.textContent = '';
    hideNotice(); pending = null;
    host.say(`Loaded ${prop.name} from its drill database: ${plural(ref.holes, 'hole')}, ${plural(ref.assays, 'assay')}. Save to keep it with the figure.`);
  } catch (err) {
    out.textContent = err.message;
  } finally { btn.disabled = false; }
}

/** On opening a figure that took its holes from a property: offer newer data. */
export async function check() {
  reset();
  const ref = em().getState().drillSource, p = { ref, figureId: host.current()?.id || null };
  if (ref?.kind !== 'property' || !ref.propertyId) return;
  const d = newerSince(ref, await listBatches(await host.client(), ref.propertyId));
  if (!d || !stillOurs(p)) return; // nothing newer, or another figure opened meanwhile
  pending = p;
  $('drill-notice-text').textContent = `${noticeText(d)} —`;
  $('drill-notice').hidden = false;
}

// Re-read the property and reopen the figure with it, exactly as it was otherwise (camera, labels, style).
async function update() {
  const was = pending;
  if (!stillOurs(was)) { reset(); return; }
  const btn = $('drill-update'), { ref } = was;
  btn.disabled = true; btn.textContent = 'Updating…';
  let backup = null;
  try {
    const { files, ref: now } = await pull(await host.client(), { id: ref.propertyId, name: ref.propertyName });
    if (pending !== was || !stillOurs(was)) { if (pending === was) reset(); return; } // another figure opened while it read
    const p = em().getProject(), names = Object.values(FILE_NAMES);
    p.files = p.files.filter((f) => !names.includes(f.name)).concat(files);
    p.settings.drillSource = now;
    backup = em().getProject();
    await em().loadProject(p);
    pending = null; hideNotice();
    host.say(`Updated from ${ref.propertyName || 'the property'}: ${plural(now.holes, 'hole')}, ${plural(now.assays, 'assay')}. Save to keep it.`);
  } catch (err) {
    if (backup) try { await em().loadProject(backup); } catch { /* the editor keeps whatever it has */ }
    host.say(`Could not update the drill data (${err.message}). The figure is unchanged.`);
  } finally {
    btn.disabled = false; btn.textContent = 'Update';
  }
}
