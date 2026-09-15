// Active titles only. --dry-run validates offline; --output FILE saves validated rows.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import shp from 'shpjs';
import JSZip from 'jszip';
export const SOURCE_URL = 'https://diffusion.mern.gouv.qc.ca/Public/GESTIM/telechargements/Province_shape/TITRES_ACTIFS_ACTIVE_TITLES.zip';
export const BATCH_SIZE = 1000;
export function sourceDate(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
export function assertActiveSource(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'diffusion.mern.gouv.qc.ca' || !/\/TITRES_ACTIFS_ACTIVE_TITLES\.zip$/i.test(u.pathname)) throw new Error('Refusing a source other than the official active-titles archive');
}
function roundGeometry(g) {
  if (!g || !['Polygon', 'MultiPolygon'].includes(g.type)) throw new Error('Expected polygon geometry');
  const walk = c => typeof c[0] === 'number' ? c.slice(0, 2).map(n => Math.round(n * 1e6) / 1e6) : c.map(walk);
  return { type: g.type, coordinates: walk(g.coordinates) };
}
export function validateRows(rows, { minRows = 100000, maxRows = 400000 } = {}) {
  if (rows.length < minRows || rows.length > maxRows) throw new Error(`Unexpected active-title count: ${rows.length}`);
  for (const row of rows) {
    if (!row.tag_number || !['Active', 'Actif', 'Suspended', 'Suspendu', 'Renewal Pending', 'En attente de renouvellement'].includes(row.status)) throw new Error('Non-active or unidentified title');
    if (!row.geometry || !['Polygon', 'MultiPolygon'].includes(row.geometry.type)) throw new Error('Missing polygon geometry');
    let points = 0;
    const check = c => {
      if (!Array.isArray(c) || !c.length) throw new Error('Empty geometry');
      if (typeof c[0] === 'number') {
        const [x, y] = c;
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < -81 || x > -56 || y < 43 || y > 64) throw new Error('Coordinates outside Quebec WGS84 bounds');
        points++;
      } else c.forEach(check);
    };
    check(row.geometry.coordinates);
    if (points < 4) throw new Error('Incomplete polygon');
  }
  return rows;
}
export async function downloadActive(url = SOURCE_URL) {
  assertActiveSource(url);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`Active archive HTTP ${r.status}`);
      assertActiveSource(r.url);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('Active archive is not a ZIP');
      console.log(`Downloaded ${(buf.length / 1e6).toFixed(1)} MB from the active archive.`);
      return buf;
    } catch (e) { lastError = e; if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000)); }
  }
  throw lastError; // Never discover another dataset after failure.
}
export async function prepareRows(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && !n.includes('__MACOSX'));
  const shapes = names.filter(n => /\.shp$/i.test(n));
  if (shapes.length !== 1) throw new Error(`Expected one active-title layer, found ${shapes.length}`);
  const base = shapes[0].slice(0, -4);
  const part = async ext => {
    const name = names.find(n => n.toLowerCase() === (base + ext).toLowerCase());
    if (!name) throw new Error(`Missing ${ext} companion`);
    return zip.files[name].async('nodebuffer');
  };
  const [shape, prj, dbf] = await Promise.all([part('.shp'), part('.prj'), part('.dbf')]);
  const geoms = shp.parseShp(shape, prj);
  const records = shp.parseDbf(dbf, process.env.QC_DBF_ENCODING || 'windows-1252');
  if (geoms.length !== records.length) throw new Error('Geometry and attribute counts differ');
  const retrieved = new Date().toISOString().slice(0, 10);
  const rows = records.map((p, i) => ({
    tag_number: p.TIT_NO?.toString() || null, owner_name: p.DET_NOM?.toString() || null,
    status: p.STI_DES_AN || p.STI_DES_FR,
    good_to_date: sourceDate(p.TIT_DAT_EX),
    area_hectares: p.TIT_SUPRF != null && Number.isFinite(Number(p.TIT_SUPRF)) ? Number(p.TIT_SUPRF) : null,
    title_type: p.TER_CODE || null, geometry: roundGeometry(geoms[i]),
    // API-compatible field; retrieval date, not a certified source publication date.
    source_updated_at: retrieved,
  }));
  validateRows(rows);
  console.log(`Validated ${rows.length} active titles with WGS84 polygon geometry.`);
  return rows;
}
export async function publishRows(rows, rpc) {
  validateRows(rows);
  const run = await rpc('begin_qc_import', { p_expected_rows: rows.length });
  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await rpc('stage_qc_import_batch', { p_run_id: run, p_batch_no: i / BATCH_SIZE, p_rows: rows.slice(i, i + BATCH_SIZE) });
      if (i % 25000 === 0) console.log(`Staged ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
    }
    const result = await rpc('publish_qc_import', { p_run_id: run });
    if (result !== rows.length) throw new Error(`Publication count mismatch: ${result}`);
    console.log(`Published ${result} active Quebec titles atomically.`);
  } catch (e) {
    // Only staging is discarded, including if a successful commit's response was lost.
    await rpc('abort_qc_import', { p_run_id: run }).catch(() => {});
    throw e;
  }
}
async function main() {
  const archiveInput = process.argv.indexOf('--archive');
  const buf = archiveInput >= 0 ? fs.readFileSync(process.argv[archiveInput + 1]) : await downloadActive(process.env.QC_CLAIMS_URL || SOURCE_URL);
  const archiveOutput = process.argv.indexOf('--archive-out');
  if (archiveOutput >= 0) fs.writeFileSync(process.argv[archiveOutput + 1], buf);
  const rows = await prepareRows(buf);
  const out = process.argv.indexOf('--output');
  if (out >= 0) fs.writeFileSync(process.argv[out + 1], JSON.stringify(rows));
  if (process.argv.includes('--dry-run')) return;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const rpc = async (name, args) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}: ${(await r.text()).slice(0, 250)}`);
    return r.json();
  };
  await publishRows(rows, rpc);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
