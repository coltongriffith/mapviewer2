import { test, expect } from '@playwright/test';
import { xlsxFixture } from '../tests/fixtures/xlsx.js';
import readExcelFile from 'read-excel-file/node';
import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';

// Company workspaces against an in-memory Supabase (auth, REST and RPC are
// mocked; no request leaves the browser). Needs the configured client build
// (dist-auth-check, VITE_SUPABASE_URL=https://example.supabase.co).
test.skip(!process.env.E2E_ADMIN, 'Requires the configured client build with isolated auth fixtures');

const uid = '00000000-0000-4000-8000-0000000000e1';
const user = { id: uid, email: 'geo@star.test', role: 'authenticated', aud: 'authenticated', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: {}, app_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.test-signature`;
const session = { user, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer' };

const ORG = '00000000-0000-4000-8000-0000000000a1';
const PROP = '00000000-0000-4000-8000-0000000000b1';
const MAP = '00000000-0000-4000-8000-0000000000c1';
const FIG = '00000000-0000-4000-8000-0000000000d1';
const org = (role) => ({ id: ORG, name: 'Star Copper Corp.', slug: 'star-copper-corp', plan: 'free', role, member_count: 2, property_count: 1 });
const property = { id: PROP, org_id: ORG, name: 'Rails Copper-Gold', slug: 'rails-copper-gold', jurisdiction: 'bc', commodities: ['Cu', 'Au'], status: 'active', description: 'Porphyry target', crs: null, created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' };

const ORG2 = '00000000-0000-4000-8000-0000000000a2';
const jvOrg = { id: ORG2, name: 'North Rock JV', slug: 'north-rock-jv', plan: 'free', role: 'viewer', member_count: 3, property_count: 1 };
const jvProperty = { ...property, id: '00000000-0000-4000-8000-0000000000b2', org_id: ORG2, name: 'Rails JV', description: 'Joint venture ground' };

const FILE = '00000000-0000-4000-8000-0000000000f1';
const assays = { id: FILE, name: 'assays.csv', kind: 'drill', role: 'assays', version: 2, path: `${ORG}/${PROP}/${FILE}/v2/assays.csv`, bytes: 2048, sha256: 'a'.repeat(64), note: null, uploaded_at: '2026-10-19T00:00:00Z', uploaded_by_email: 'cfo@star.test' };

const BATCH0 = '00000000-0000-4000-8000-0000000000e0';
const collarBatch = { id: BATCH0, kind: 'collars', filename: 'Rails collars.csv', rows: 12, rows_written: 12, summary: { new: 12, changed: 0, unchanged: 0, new_holes: 12 }, created_at: '2026-10-18T00:00:00Z', created_by_email: 'cfo@star.test', rolled_back_at: null, blocked_by: null };
const drillSummary = () => ({ collars: 12, planned: 2, metres: 3420.5, surveys: 40, assays: 0, lithology: 0, holes: 12, elements: [], limit: 20000, batches: [{ ...collarBatch }] });

test('lab certificates: pin a PDF version, download it and retract a mistaken link', async ({ page }) => {
  const fake = await fakeSupabase(page);
  fake.drill.batches = [{ ...collarBatch, kind: 'assays', filename: 'assays.csv' }];
  fake.files = [{ ...assays, name: 'Lab certificate.pdf', kind: 'document', role: null, version: 1, path: `${ORG}/${PROP}/${FILE}/v1/lab.pdf` }];
  const links = [];
  await page.route('**/rest/v1/rpc/drill_batch_certificates', route => route.fulfill({ json: links }));
  await page.route('**/rest/v1/drill_batch_files*', route => {
    const request = route.request();
    if (request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({ batch_id: BATCH0, file_id: FILE, version: 1 });
      if (links.length) return route.fulfill({ status: 409, json: { code: '23505', message: 'duplicate' } });
      links.push({ file_id: FILE, version: 1, name: 'Lab certificate.pdf', storage_path: fake.files[0].path });
    } else {
      expect(request.postDataJSON()).toEqual({ retraction_reason: 'Wrong laboratory job' });
      links[0].retracted_at = '2026-10-23T00:00:00Z'; links[0].retraction_reason = 'Wrong laboratory job';
    }
    return route.fulfill({ json: links });
  });
  await page.route('**/storage/v1/object/sign/property-files/**?token=t*', route => route.fulfill({ contentType: 'application/pdf', headers: { 'content-disposition': 'attachment; filename="lab.pdf"' }, body: '%PDF-1.4\n% synthetic certificate fixture' }));
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  await page.getByRole('button', { name: 'Lab certificates' }).click();
  await page.getByLabel('Certificate PDF').selectOption(FILE);
  await page.getByRole('button', { name: 'Link certificate' }).click();
  await expect(page.getByText('Certificate linked to this assay import.')).toBeVisible();
  fake.files[0] = { ...fake.files[0], version: 2, path: `${ORG}/${PROP}/${FILE}/v2/lab.pdf` };
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Lab certificate.pdf · v1' }).click();
  await downloaded;
  expect(fake.signed).toEqual([`${ORG}/${PROP}/${FILE}/v1/lab.pdf`]);
  await page.getByRole('button', { name: 'Retract link' }).click();
  await page.getByLabel('Why retract Lab certificate.pdf?').fill('Wrong laboratory job');
  await page.getByRole('button', { name: 'Confirm retraction' }).click();
  await expect(page.getByText('· Retracted: Wrong laboratory job')).toBeVisible();
  await page.getByRole('button', { name: 'Link certificate' }).click();
  await expect(page.getByRole('alert')).toContainText('was retracted from this import');
  await expect(page.getByText('Certificate linked to this assay import.')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('lab certificates: a saved PDF with a failed link stays available for retry', async ({ page }) => {
  const fake = await fakeSupabase(page);
  fake.drill.batches = [{ ...collarBatch, kind: 'assays', filename: 'assays.csv' }];
  await page.route('**/rest/v1/rpc/drill_batch_certificates', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/drill_batch_files*', route => route.fulfill({ status: 403, json: { code: '42501', message: 'permission denied' } }));
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  await page.getByRole('button', { name: 'Lab certificates' }).click();
  await page.getByLabel('Upload lab certificate').setInputFiles({ name: 'New lab.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% synthetic fixture') });
  await expect(page.getByRole('alert')).toContainText('was saved in the property library, but was not linked');
  await expect(page.getByText('Certificate linked to this assay import.')).toHaveCount(0);
  expect(fake.files.find(f => f.name === 'New lab.pdf')).toBeTruthy();
  await expect(page.getByLabel('Certificate PDF')).toHaveValue(fake.files.find(f => f.name === 'New lab.pdf').id);
  await expect(page.getByRole('button', { name: '+ Import CSV or Excel' })).toBeEnabled();
});

// Observe the browser's locally generated SVG; download and decode the actual PNG.
async function checkChartDownload(page, testInfo, title, filename, expected) {
  await page.evaluate(() => {
    window.__chartSvg = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      if (blob.type.startsWith('image/svg+xml')) window.__chartSvg.push(blob.text());
      return original.call(this, blob);
    };
  });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: `Download ${title} PNG` }).click();
  const download = await pending; expect(download.suggestedFilename()).toBe(filename);
  const path = testInfo.outputPath(filename); await download.saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.readUInt32BE(16)).toBe(1920); expect(bytes.readUInt32BE(20)).toBeLessThanOrEqual(4096);
  const labels = await page.evaluate(async () => {
    const text = await Promise.all(window.__chartSvg);
    return text.map(svg => new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.textContent).join('');
  });
  for (const text of expected) expect(labels).toContain(text);
  expect(labels).toContain('Rails Copper-Gold'); expect(labels).toContain('Historical written-import subset only');
  expect(labels).toContain('not a full-file, whole-job or current-property report');
  const pixels = await page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const values = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let blue = 0, dark = 0;
    for (let i = 0; i < values.length; i += 4) { if (values[i+2] > 100 && values[i+2] > values[i] * 2) blue++; if (values[i] < 100 && values[i+1] < 100 && values[i+2] < 100) dark++; }
    return { blue, dark, corner: [...values.slice(0, 4)] };
  }, bytes.toString('base64'));
  expect(pixels.blue).toBeGreaterThan(30); expect(pixels.dark).toBeGreaterThan(2000); expect(pixels.corner).toEqual([255, 255, 255, 255]);
}

// The PDF is intentionally raster-based. Inspect all page text at its draw
// boundary as well as the actual file/page structure; local release validation
// also renders representative downloaded pages with PyMuPDF.
async function checkComparisonPdf(page, testInfo, filename, expected, artifactPrefix = '') {
  await page.evaluate(() => {
    window.__pdfText = [];
    if (!window.__pdfTextHook) {
      window.__pdfTextHook = true;
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
        if (this.canvas.width === 1584 && this.canvas.height === 1224) window.__pdfText.push(text);
        return original.call(this, text, ...rest);
      };
    }
  });
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download comparison PDF', exact: true }).click();
  const download = await pending; expect(download.suggestedFilename()).toBe(filename);
  const path = testInfo.outputPath(artifactPrefix + filename); await download.saveAs(path); const bytes = await readFile(path);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.length).toBeLessThanOrEqual(32 * 1024 * 1024);
  const pdf = bytes.toString('latin1'), pages = [...pdf.matchAll(/\/Type\s*\/Page\b/g)].length;
  expect(pages).toBeGreaterThan(1); expect(pages).toBeLessThanOrEqual(100);
  const boxes = [...pdf.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map(match => match[1].trim().split(/\s+/).map(Number));
  expect(boxes.length).toBe(pages); expect(boxes.every(box => JSON.stringify(box) === '[0,0,792,612]')).toBe(true);
  const text = await page.evaluate(() => window.__pdfText.join('\n'));
  for (const value of expected) expect(text).toContain(value);
  expect(text).toContain('Rails Copper-Gold'); expect(text).toContain('Page');
  await expect(page.getByRole('button', { name: 'Download comparison PDF', exact: true })).toBeEnabled();
  return { pages, bytes: bytes.length, text };
}

test('QA/QC duplicate comparisons: scoped historical charts, raw exclusions and read-only return', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await fakeSupabase(page, { role: 'viewer' });
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const batch = { id: id(10), property_id: PROP, kind: 'samples', row_count: 9, rows_written: 4, request_hash: 'synthetic-request',
    provenance: { filename: 'synthetic-duplicates.csv', sha256: 'a'.repeat(64) }, summary: { new: 4, changed: 0 }, created_at: '2026-10-23T12:00:00Z', rolled_back_at: '2026-10-23T13:00:00Z', depends_on: [] };
  const record = (sample_id, sample_type, value) => ({ sample_id, sample_type, lab_id: 'Lab-A', lab_batch_id: 'Job-1', values: { Au: value }, units: { Au: 'g/t' }, raw_values: { Au: value.toFixed(2) }, bdl: {} });
  const parents = Array.from({ length: 4 }, (_, i) => ({ id: id(100 + i), property_id: PROP, batch_id: id(9), source_row: i + 1, superseded_by_batch: id(99), record: record(`P${i}`, 'routine', i === 2 ? 0 : 90) }));
  const duplicates = parents.map((parent, i) => ({ id: id(200 + i), property_id: PROP, batch_id: batch.id, source_row: i + 2, parent_version_id: parent.id, record: { ...record(`D${i}`, 'field_dup', i === 1 || i === 2 ? 0 : 110), parent_sample_id: parent.record.sample_id } }));
  parents[3].record.bdl.Au = 0.005; parents[3].record.raw_values.Au = 'ND';
  let failReferences = false;
  await page.route('**/rest/v1/drill_qaqc_batches*', route => route.fulfill({ json: [batch] }));
  await page.route('**/rest/v1/drill_qaqc_samples*', route => {
    const q = new URL(route.request().url()).searchParams;
    expect(q.get('property_id')).toBe(`eq.${PROP}`);
    if (q.has('superseded_by_batch')) return route.fulfill({ json: [] });
    if (q.has('batch_id')) { expect(q.get('batch_id')).toBe(`eq.${batch.id}`); return route.fulfill({ json: q.has('or') ? [] : duplicates }); }
    if (failReferences) return route.fulfill({ status: 403, json: { message: 'Denied synthetic reference read' } });
    return route.fulfill({ json: q.getAll('id').some(value => value.startsWith('gt.')) ? [] : parents });
  });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  await page.getByRole('button', { name: 'Open QA/QC register' }).click();
  await page.getByRole('button', { name: 'Compare duplicates' }).click();
  await page.getByLabel('Comparison group').selectOption('0');
  await expect(page.getByText('2 eligible / 4 selected pairs')).toBeVisible();
  await expect(page.getByText(/9 rows submitted; 4 records written/)).toHaveText(/rolled back/);
  await expect(page.getByRole('img', { name: /log scatter, 1 positive pairs/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Ranked HARD cumulative plot, 2 eligible pairs/ })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Duplicate comparison data' })).toContainText('ND g/t (below detection; recorded limit 0.005 g/t)');
  await expect(page.getByText(/HARD ≤10%: 1\/2 \(50%\)/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('duplicate-comparison.png'), fullPage: true });
  await checkChartDownload(page, testInfo, 'Original vs duplicate', `qaqc-scatter-${batch.id}.png`, ['1 positive pairs plotted', '1 otherwise eligible zero-value pairs', '2 assessed / 4 selected; 2 unassessed', 'not HARD thresholds', batch.id]);
  await checkChartDownload(page, testInfo, 'Ranked HARD', `qaqc-hard-${batch.id}.png`, ['Cumulative denominator: 2 eligible pairs', 'HARD = 100', 'HARD ≤10%: 1/2', 'Rolled back:']);
  await checkComparisonPdf(page, testInfo, `qaqc-duplicates-${batch.id}.pdf`, ['D0', 'D3', parents[0].id, 'ND', '0.005', 'synthetic-duplicates.csv', batch.id]);
  await page.getByRole('button', { name: 'Back to QA/QC' }).click();
  await expect(page.getByRole('button', { name: 'Compare duplicates' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Roll back QA/QC import' })).toHaveCount(0);
  failReferences = true;
  await page.getByRole('button', { name: 'Compare duplicates' }).click();
  await page.getByLabel('Comparison group').selectOption('0');
  await expect(page.getByRole('alert')).toContainText('No comparison is shown');
  await expect(page.getByRole('table', { name: 'Duplicate comparison data' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('QA/QC standard comparisons: pinned supplied references, zero and censored evidence, denied retry', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await fakeSupabase(page, { role: 'viewer' });
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const batch = { id: id(30), property_id: PROP, kind: 'samples', row_count: 9, rows_written: 4, request_hash: 'synthetic-standards-request',
    provenance: { filename: 'synthetic-standards.csv', sha256: 'b'.repeat(64) }, summary: { new: 4, changed: 0 }, created_at: '2026-10-23T12:00:00Z', rolled_back_at: '2026-10-23T13:00:00Z', depends_on: [] };
  const crm = { id: id(29), property_id: PROP, batch_id: id(28), source_row: 2, superseded_by_batch: id(99),
    record: { crm_id: 'CRM-TEST', revision: 'rev-01', element: 'Au', unit: 'g/t', expected: 10, sd: 2, source: ('Synthetic supplied certificate only — μ <source> Ω 🧪 ' + 'x'.repeat(1000)).slice(0, 1000) } };
  const standards = [15, 0, null, 17].map((value, i) => ({ id: id(300 + i), property_id: PROP, batch_id: batch.id, source_row: 2 * i + 1, crm_version_ids: [crm.id],
    record: { sample_id: `STD-00${i}`, sample_type: 'standard', lab_id: 'Lab-A', lab_batch_id: 'Job-1', crm_id: 'CRM-TEST', crm_revision: 'rev-01',
      values: { Au: value }, units: { Au: 'g/t' }, raw_values: { Au: value === null ? 'ND' : value.toFixed(3) }, bdl: value === null ? { Au: 0.005 } : {} } }));
  let failReferences = false;
  await page.route('**/rest/v1/drill_qaqc_batches*', route => route.fulfill({ json: [batch] }));
  await page.route('**/rest/v1/drill_qaqc_samples*', route => {
    const q = new URL(route.request().url()).searchParams;
    expect(q.get('property_id')).toBe(`eq.${PROP}`);
    if (q.has('superseded_by_batch')) return route.fulfill({ json: [] });
    expect(q.get('batch_id')).toBe(`eq.${batch.id}`);
    return route.fulfill({ json: q.has('or') ? [] : standards });
  });
  await page.route('**/rest/v1/drill_crm_values*', route => {
    const q = new URL(route.request().url()).searchParams;
    expect(q.get('property_id')).toBe(`eq.${PROP}`); expect(q.get('record->>crm_id')).toBe('eq.CRM-TEST');
    expect(q.get('record->>revision')).toBe('eq.rev-01'); expect(q.get('record->>element')).toBe('eq.Au'); expect(q.get('record->>unit')).toBe('eq.g/t');
    expect(q.has('superseded_by_batch')).toBe(false); expect(q.getAll('id').some(value => value.startsWith('in.'))).toBe(true);
    if (failReferences) return route.fulfill({ status: 403, json: { message: 'Denied synthetic reference read' } });
    return route.fulfill({ json: q.getAll('id').some(value => value.startsWith('gt.')) ? [] : [crm] });
  });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click(); await page.getByRole('button', { name: 'Open QA/QC register' }).click();
  await page.getByRole('button', { name: 'Compare standards' }).click();
  await expect(page.getByRole('table', { name: 'Standards comparison data' })).toHaveCount(0);
  await page.getByLabel('Comparison group').selectOption('0');
  await expect(page.getByText('3 assessed / 4 selected standards')).toBeVisible();
  await expect(page.getByText(/9 rows submitted; 4 records written/)).toHaveText(/rolled back/);
  const plot = page.getByRole('img', { name: /CRM reference plot, 3 assessed/ }); await expect(plot).toBeVisible();
  expect(await plot.locator('polyline').count()).toBe(0); expect(await plot.locator('circle').count()).toBe(1); expect(await plot.locator('rect[data-rule="fail"]').count()).toBe(2);
  const table = page.getByRole('table', { name: 'Standards comparison data' });
  await expect(table).toContainText('ND g/t (below detection; recorded limit 0.005 g/t)'); await expect(table).toContainText('0.000 g/t');
  await expect(page.getByText('Outside ±3 supplied SD: 2/3 (66.667%)')).toBeVisible();
  await expect(page.getByText('Shewhart rule failures: 2/3 (66.667%)')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Standards failing Shewhart rules' })).toContainText('Row 3 · STD-001: 0.000 g/t (z = -5) — Outside ±3 supplied SD');
  await table.locator('summary').filter({ hasText: 'Record provenance' }).first().click();
  await expect(table).toContainText(`Pinned CRM: ${crm.id}`); await expect(table).toContainText('Synthetic supplied certificate only');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('standards-comparison.png'), fullPage: true });
  await checkChartDownload(page, testInfo, 'CRM reference comparison', `qaqc-standards-${batch.id}.png`, ['Supplied expected value: 10; supplied SD: 2 g/t.', 'CRM CRM-TEST | revision rev-01', '3 assessed / 4 selected; 1 unassessed', 'Outside ±3 supplied SD: 2/3.', 'Shewhart failures: 2/3', 'no analytical order or trend implied', 'synthetic-standards-request', batch.id]);
  await checkComparisonPdf(page, testInfo, `qaqc-standards-${batch.id}.pdf`, ['STD-000', 'STD-003', crm.id, 'ND', '0.005', '0.000', 'Synthetic supplied certificate only', 'Shewhart rule failures: 2/3', 'Failure: source row 7, sample STD-003', batch.id]);
  await page.getByRole('button', { name: 'Back to QA/QC' }).click(); await expect(page.getByRole('button', { name: 'Compare standards' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Roll back QA/QC import' })).toHaveCount(0);
  failReferences = true; await page.getByRole('button', { name: 'Compare standards' }).click(); await page.getByLabel('Comparison group').selectOption('0');
  await expect(page.getByRole('alert')).toContainText('No comparison is shown'); await expect(table).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('QA/QC blank comparisons: N × detection-limit threshold, censored passes, unassessed blanks, PNG and PDF', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await fakeSupabase(page, { role: 'viewer' });
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const batch = { id: id(40), property_id: PROP, kind: 'samples', row_count: 9, rows_written: 5, request_hash: 'synthetic-blanks-request',
    provenance: { filename: 'synthetic-blanks.csv', sha256: 'd'.repeat(64) }, summary: { new: 5, changed: 0 }, created_at: '2026-10-23T12:00:00Z', rolled_back_at: null, depends_on: [] };
  const row = (n, sample_id, sample_type, value, raw, bdl = {}) => ({ id: id(400 + n), property_id: PROP, batch_id: batch.id, source_row: n, parent_version_id: null,
    record: { sample_id, sample_type, lab_id: 'Lab-A', lab_batch_id: 'Job-1', values: { Au: value }, units: { Au: 'g/t' }, raw_values: { Au: raw }, bdl } });
  const rows = [row(1, 'BLK-001', 'blank', 0.004, '0.004'), row(2, 'R-001', 'routine', null, '<0.005', { Au: 0.005 }), row(3, 'BLK-002', 'blank', 0.02, '0.020'),
    row(5, 'BLK-003', 'blank', null, '<0.005', { Au: 0.005 }), row(7, 'BLK-004', 'blank', 0.04, '0.040')];
  await page.route('**/rest/v1/drill_qaqc_batches*', route => route.fulfill({ json: [batch] }));
  await page.route('**/rest/v1/drill_qaqc_samples*', route => {
    const q = new URL(route.request().url()).searchParams;
    expect(q.get('property_id')).toBe(`eq.${PROP}`);
    if (q.has('superseded_by_batch')) return route.fulfill({ json: [] });
    expect(q.get('batch_id')).toBe(`eq.${batch.id}`);
    return route.fulfill({ json: q.has('or') ? [] : rows });
  });
  await page.route('**/rest/v1/drill_crm_values*', route => { throw new Error(`Blank comparisons read no CRM definitions: ${route.request().url()}`); });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click(); await page.getByRole('button', { name: 'Open QA/QC register' }).click();
  await page.getByRole('button', { name: 'Compare blanks' }).click();
  await expect(page.getByRole('heading', { name: 'Compare blanks' })).toBeFocused();
  await expect(page.getByRole('table', { name: 'Blanks comparison data' })).toHaveCount(0);
  await page.getByLabel('Comparison group').selectOption('0');
  await expect(page.getByText('4 assessed / 4 selected blanks')).toBeVisible();
  await expect(page.getByText(/9 rows submitted; 5 records written/)).toHaveText(/newer versions may exist/);
  await expect(page.getByRole('combobox', { name: /^Blank threshold/ })).toHaveValue('5');
  const plot = page.getByRole('img', { name: /Blank threshold plot, 4 assessed blanks/ }); await expect(plot).toBeVisible();
  expect(await plot.locator('[data-outcome="censored"]').count()).toBe(1); expect(await plot.locator('rect[data-outcome="fail"]').count()).toBe(1);
  await expect(page.getByRole('region', { name: 'Blanks above threshold' })).toContainText('Row 7 · BLK-004: 0.040 g/t is 8 × the detection limit 0.005 g/t');
  const table = page.getByRole('table', { name: 'Blanks comparison data' });
  await expect(table).toContainText('<0.005 g/t (below detection; recorded limit 0.005 g/t)'); await expect(table).toContainText('Pass (below detection; censored)');
  await expect(table).not.toContainText('R-001');
  await page.getByRole('combobox', { name: /^Blank threshold/ }).selectOption('3');
  await expect(page.getByRole('region', { name: 'Blanks above threshold' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText('Above threshold (fail): 2/4 (50%)')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('blanks-comparison.png'), fullPage: true });
  await checkChartDownload(page, testInfo, 'Blank threshold comparison', `qaqc-blanks-${batch.id}.png`, ['Recorded detection limit: 0.005 g/t; threshold 3 × detection limit = 0.015 g/t.', 'Above threshold: 2/4', 'no analytical order implied', 'Group: blank | lab Lab-A | job Job-1', '4 assessed / 4 selected; 0 unassessed', 'synthetic-blanks-request', batch.id]);
  await checkComparisonPdf(page, testInfo, `qaqc-blanks-${batch.id}.pdf`, ['BLK-001', 'BLK-004', rows[1].id, 'Blank threshold: 3 × detection limit', 'Above 3 × detection limit (fail): 2/4', 'Failure: source row 3, sample BLK-002', 'pass (below detection; censored)', 'Recorded detection-limit sources', '<0.005', 'synthetic-blanks.csv', batch.id]);
  await page.getByRole('button', { name: 'Back to QA/QC' }).click(); await expect(page.getByRole('button', { name: 'Compare blanks' })).toBeFocused();
  rows.splice(1, 1); rows.splice(2, 1); batch.rows_written = 3;
  await page.getByRole('button', { name: 'Compare blanks' }).click(); await page.getByLabel('Comparison group').selectOption('0');
  await expect(page.getByText('0 assessed / 3 selected blanks')).toBeVisible(); await expect(page.getByRole('img')).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Blanks comparison data' }).getByText(/Unassessed: No detection limit is recorded/)).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Download Blank threshold comparison PNG' })).toBeDisabled();
  const evidence = await checkComparisonPdf(page, testInfo, `qaqc-blanks-${batch.id}.pdf`, ['BLK-001', 'BLK-004', 'Assessed controls: 0', 'missing_detection_limit', 'No numeric detection limit is recorded'], 'unassessed-');
  expect(evidence.text).toContain('percentage unavailable');
  expect(errors).toEqual([]);
});

test('QA/QC PDF retains all 51 selected records beyond table pagination and supports evidence-only reports', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await fakeSupabase(page, { role: 'viewer' });
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const batch = { id: id(700), property_id: PROP, kind: 'samples', row_count: 70, rows_written: 51, request_hash: 'synthetic-long-report', provenance: { filename: 'synthetic-long-duplicates.csv', sha256: 'c'.repeat(64), sheet: 'Field controls', header_row: 2 }, summary: { new: 51 }, created_at: '2026-10-23T12:00:00Z', rolled_back_at: null, depends_on: [] };
  const parent = { id: id(701), property_id: PROP, batch_id: id(699), source_row: 1, record: { sample_id: 'P-BASE', sample_type: 'routine', lab_id: 'Lab-L', lab_batch_id: 'Job-L', values: { Au: 90 }, units: { Au: 'g/t' }, raw_values: { Au: '90.000000' }, bdl: {} } };
  const rows = Array.from({ length: 51 }, (_, i) => ({ id: id(800 + i), property_id: PROP, batch_id: batch.id, source_row: i + 1, parent_version_id: parent.id, record: { sample_id: `D-${String(i).padStart(3, '0')}`, sample_type: 'field_dup', parent_sample_id: 'P-BASE', lab_id: 'Lab-L', lab_batch_id: 'Job-L', values: { Au: i === 50 ? null : 110 }, units: { Au: 'g/t' }, raw_values: { Au: i === 50 ? 'ND' : '110.000000' }, bdl: i === 50 ? { Au: 0.005 } : {} } }));
  await page.route('**/rest/v1/drill_qaqc_batches*', route => route.fulfill({ json: [batch] }));
  await page.route('**/rest/v1/drill_qaqc_samples*', route => {
    const q = new URL(route.request().url()).searchParams;
    expect(q.get('property_id')).toBe(`eq.${PROP}`);
    if (q.has('superseded_by_batch')) return route.fulfill({ json: [] });
    if (q.has('batch_id')) return route.fulfill({ json: q.has('or') ? [] : rows });
    return route.fulfill({ json: q.getAll('id').some(value => value.startsWith('gt.')) ? [] : [parent] });
  });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold'); await page.getByRole('tab', { name: 'Drill data' }).click();
  await page.getByRole('button', { name: 'Open QA/QC register' }).click(); await page.getByRole('button', { name: 'Compare duplicates' }).click(); await page.getByLabel('Comparison group').selectOption('0');
  await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Duplicate comparison data' })).not.toContainText('D-050');
  const full = await checkComparisonPdf(page, testInfo, `qaqc-duplicates-${batch.id}.pdf`, ['D-000', 'D-025', 'D-050', rows[50].id, parent.id, 'ND', '0.005', 'Field controls'], 'all51-');
  expect(full.pages).toBeGreaterThan(10); expect(full.text).toContain('Selected controls: 51');
  await page.getByRole('button', { name: 'Back to QA/QC' }).click();
  for (const row of rows) { row.record.values.Au = null; row.record.raw_values.Au = 'ND'; row.record.bdl.Au = 0.005; }
  await page.getByRole('button', { name: 'Compare duplicates' }).click(); await page.getByLabel('Comparison group').selectOption('0');
  await expect(page.getByText('0 eligible / 51 selected pairs')).toBeVisible(); await expect(page.getByRole('img')).toHaveCount(0);
  const evidence = await checkComparisonPdf(page, testInfo, `qaqc-duplicates-${batch.id}.pdf`, ['D-000', 'D-050', 'Assessed controls: 0', 'Unassessed controls: 51', 'ND', '0.005'], 'unassessed51-');
  expect(evidence.text).toContain('percentage unavailable'); await expect(page.getByRole('table', { name: 'Duplicate comparison data' })).toBeVisible();
});

test('QA/QC register: CRM then routine and dependent samples, stable retry and protected rollback', async ({ page }) => {
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await fakeSupabase(page);
  const store = { samples: [], crms: [], batches: [] }, commits = [], results = new Map();
  let uncertain = true;
  for (const [table, key] of [['drill_qaqc_samples', 'samples'], ['drill_crm_values', 'crms'], ['drill_qaqc_batches', 'batches']]) {
    await page.route(`**/rest/v1/${table}*`, route => route.fulfill({ json: store[key] }));
  }
  await page.route('**/rest/v1/rpc/drill_qaqc_import', route => {
    const args = route.request().postDataJSON(), diff = { ok: true, new: args.p_rows.length, changed: 0, unchanged: 0 };
    if (args.p_dry_run) return route.fulfill({ json: diff });
    commits.push(args);
    if (results.has(args.p_batch)) return route.fulfill({ json: { ...results.get(args.p_batch), replayed: true } });
    const result = { ...diff, committed: true, batch_id: args.p_batch };
    results.set(args.p_batch, result);
    const dependent = args.p_kind === 'samples' && args.p_rows.some(row => row.sample_type !== 'routine');
    store[args.p_kind].push(...args.p_rows.map((record, i) => ({ id: crypto.randomUUID(), record, batch_id: args.p_batch, source_row: i + 1 })));
    store.batches.unshift({ id: args.p_batch, kind: args.p_kind, provenance: args.p_provenance, summary: diff, created_at: '2026-10-23T12:00:00Z', depends_on: dependent ? store.batches.map(b => b.id) : [], rolled_back_at: null });
    if (args.p_kind === 'samples' && uncertain) { uncertain = false; return route.fulfill({ status: 500, json: { message: 'Response lost; retry this import' } }); }
    return route.fulfill({ json: result });
  });
  await page.route('**/rest/v1/rpc/drill_qaqc_rollback', route => route.fulfill({ status: 400, json: { message: 'BATCH_DEPENDENCY' } }));
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  await page.getByRole('button', { name: 'Open QA/QC register' }).click();
  const region = page.getByRole('region', { name: 'QA/QC', exact: true });
  await region.getByRole('combobox', { name: 'Import data', exact: true }).selectOption('crms');
  const crm = 'crm_id,revision,element,unit,expected,sd,source\nCRM-TEST,rev1,Au,g/t,1,0.05,Synthetic certificate fixture';
  await region.getByLabel('QA/QC data file').setInputFiles({ name: 'synthetic-crm.csv', mimeType: 'text/csv', buffer: Buffer.from(crm) });
  await region.getByRole('button', { name: 'Check QA/QC import' }).click();
  await region.getByRole('button', { name: 'Commit QA/QC import' }).click();
  await expect(region.getByText('Imported: 1 new, 0 changed, 0 unchanged.')).toBeVisible();
  await region.getByLabel('Show records').selectOption('crms');
  await expect(region.getByRole('table', { name: 'QA/QC register' }).getByRole('cell', { name: 'CRM-TEST', exact: true })).toBeVisible();
  await region.getByLabel('Show records').selectOption('samples');
  await expect(region.getByText('No current samples on this page.')).toBeVisible();
  await region.getByRole('combobox', { name: 'Import data', exact: true }).selectOption('samples');
  const sampleRows = [['lab_id', 'lab_batch_id', 'sample_id', 'sample_type', 'Au'], ['Lab-TEST', 'Job-TEST', '00001', 'routine', '<0.005']];
  await region.getByLabel('QA/QC data file').setInputFiles({ name: 'synthetic-routine.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(xlsxFixture([{ name: 'Samples', rows: sampleRows }])) });
  await region.getByRole('button', { name: 'Use these columns' }).click();
  await region.getByRole('checkbox', { name: 'Au', exact: true }).check();
  await region.getByLabel('Unit for Au').fill('g/t');
  await region.getByRole('button', { name: 'Check QA/QC import' }).click();
  await region.getByRole('button', { name: 'Commit QA/QC import' }).click();
  await expect(region.getByRole('alert')).toContainText('Response lost');
  await region.getByRole('button', { name: 'Commit QA/QC import' }).click();
  await expect(region.getByText('Previous import confirmed: 1 new, 0 changed, 0 unchanged.')).toBeVisible();
  expect(commits[1].p_batch).toBe(commits[2].p_batch);
  expect(commits[1].p_rows[0]).toMatchObject({ sample_id: '00001', values: { Au: null }, bdl: { Au: 0.005 }, raw_values: { Au: '<0.005' } });
  expect(commits[1].p_provenance).toMatchObject({ filename: 'synthetic-routine.xlsx', sheet: 'Samples', header_row: 1 });
  expect(commits[1].p_provenance.sha256).toMatch(/^[0-9a-f]{64}$/);
  const dependent = 'lab_id,lab_batch_id,sample_id,sample_type,parent_sample_id,crm_id,crm_revision,Au\nLab-TEST,Job-TEST,STD-TEST,standard,,CRM-TEST,rev1,1.020\nLab-TEST,Job-TEST,DUP-TEST,field_dup,00001,,,0.006';
  await region.getByLabel('QA/QC data file').setInputFiles({ name: 'synthetic-dependent.csv', mimeType: 'text/csv', buffer: Buffer.from(dependent) });
  await region.getByRole('checkbox', { name: 'Au', exact: true }).check(); await region.getByLabel('Unit for Au').fill('g/t');
  await region.getByRole('button', { name: 'Check QA/QC import' }).click(); await region.getByRole('button', { name: 'Commit QA/QC import' }).click();
  await expect(region.getByText('Imported: 2 new, 0 changed, 0 unchanged.')).toBeVisible();
  const table = region.getByRole('table', { name: 'QA/QC register' });
  await expect(table.getByRole('cell', { name: '00001', exact: true })).toBeVisible();
  await expect(table.getByText('Au: <0.005 g/t (below detection)', { exact: true })).toBeVisible();
  await region.getByLabel('Show records').selectOption('crms');
  await expect(table.getByRole('cell', { name: 'CRM-TEST', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '00001', exact: true })).toHaveCount(0);
  await region.getByLabel('Show records').selectOption('samples');
  await expect(table.getByRole('cell', { name: '00001', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'CRM-TEST', exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  const history = region.getByRole('table', { name: 'QA/QC imports' });
  await expect(history.getByRole('row').filter({ hasText: 'synthetic-routine.xlsx' }).getByRole('button', { name: 'Roll back QA/QC import' })).toBeDisabled();
  page.once('dialog', dialog => dialog.accept());
  await history.getByRole('row').filter({ hasText: 'synthetic-dependent.csv' }).getByRole('button', { name: 'Roll back QA/QC import' }).click();
  await expect(region.getByRole('alert')).toContainText('Roll back the dependent import first');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('QA/QC register: unavailable schema leaves ordinary imports available', async ({ page }) => {
  await fakeSupabase(page);
  await page.route('**/rest/v1/drill_qaqc_samples*', route => route.fulfill({ status: 404, json: { code: 'PGRST205', message: 'missing table' } }));
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click(); await page.getByRole('button', { name: 'Open QA/QC register' }).click();
  await expect(page.getByRole('alert')).toContainText('Existing drill imports still work');
  await expect(page.getByRole('button', { name: '+ Import CSV or Excel' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Import QA/QC CSV or Excel' })).toHaveCount(0);
});

async function fakeSupabase(page, { role = 'owner', orgs = [org(role)], properties = null } = {}) {
  const fake = { rpc: [], orgs, properties: properties || (orgs.length ? [property] : []), invites: [], files: [{ ...assays }], uploads: [], signed: [], patches: [], drill: drillSummary(), templates: [], recipes: [], assayRows: [] };
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const single = (req.headers().accept || '').includes('vnd.pgrst.object');
    const rows = (list) => (single ? (list[0] ? json(list[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406)) : json(list));
    // Property data library: storage uploads, signed downloads, soft deletes.
    if (path.startsWith('/storage/v1/object/sign/')) {
      const p = decodeURIComponent(path.slice('/storage/v1/object/sign/property-files/'.length));
      fake.signed.push(p);
      return json({ signedURL: `/object/sign/property-files/${p}?token=t` });
    }
    if (path.startsWith('/storage/v1/object/property-files/') && method === 'POST') {
      fake.uploads.push(decodeURIComponent(path.slice('/storage/v1/object/property-files/'.length)));
      return json({ Key: path, Id: 'x' });
    }
    if (path === '/rest/v1/property_files' && method === 'PATCH') {
      const id = (url.searchParams.get('id') || '').slice(3);
      fake.patches.push({ id, body: req.postDataJSON() });
      fake.files = fake.files.filter((f) => f.id !== id);
      return json([{ id }]);
    }
    if (path.startsWith('/auth/v1/')) {
      const fn = path.split('/').pop();
      if (fn === 'token') return json(session);
      if (fn === 'user') return json(user);
      return json({});
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop(), args = req.postDataJSON() || {};
      fake.rpc.push({ fn, args });
      if (fn === 'get_my_workspaces') return json(fake.orgs);
      if (fn === 'create_organization') {
        fake.orgs = [{ id: ORG, name: args.p_name, slug: 'star-copper-corp', plan: 'free', role: 'owner', member_count: 1, property_count: 0 }];
        return json({ id: ORG, name: args.p_name, slug: 'star-copper-corp', role: 'owner' });
      }
      if (fn === 'list_org_members') {
        return json([{ user_id: uid, email: user.email, role: fake.orgs[0]?.role || 'owner', joined_at: '2026-10-02T00:00:00Z', is_me: true },
          ...(fake.orgs[0]?.member_count > 1 ? [{ user_id: 'u2', email: 'cfo@star.test', role: 'admin', joined_at: '2026-10-02T00:00:00Z', is_me: false }] : [])]);
      }
      if (fn === 'list_org_invites') return json(fake.invites);
      if (fn === 'create_org_invite') {
        const t = 'a'.repeat(64);
        const inv = { id: 'i1', email: args.p_email, role: args.p_role, expires_at: '2026-11-03T00:00:00Z', created_at: '2026-10-20T00:00:00Z', token: t, link: `https://www.explorationmaps.com/invite?token=${t}` };
        fake.invites = [{ id: 'i1', email: args.p_email, role: args.p_role, expires_at: inv.expires_at, created_at: inv.created_at }];
        return json(inv);
      }
      if (fn === 'get_org_activity') return json([{ id: 'a1', created_at: '2026-10-20T10:00:00Z', action: 'created', entity_type: 'map', property_id: PROP, property_name: property.name, actor_email: 'cfo@star.test', summary: 'Created map "Rails claims"' }]);
      if (fn === 'get_property_claims') return json([]);
      if (fn === 'list_property_files') return json(fake.files);
      // Drill database: a dry run returns the diff; a commit adds a batch; a rollback marks it.
      if (fn === 'drill_property_summary') return json(fake.drill);
      if (fn === 'drill_import_batch') {
        const diff = { ok: true, kind: args.p_kind, rows: args.p_rows.length, new: args.p_rows.length, changed: 0, unchanged: 0, holes: 2, new_holes: 1,
          missing_collars: 1, missing_collar_holes: ['R-9'], overlaps_existing: 0, overlap_holes: [], changed_sample: [], errors: [], error_count: 0, limit: 20000 };
        if (args.p_dry_run) return json({ ...diff, dry_run: true });
        fake.drill = { ...fake.drill, assays: fake.drill.assays + diff.new, holes: 13, elements: ['Au', 'Cu'],
          batches: [{ id: args.p_batch, kind: args.p_kind, filename: args.p_filename, rows: diff.rows, rows_written: diff.new, summary: diff, created_at: '2026-10-21T00:00:00Z', created_by_email: user.email, rolled_back_at: null, blocked_by: null }, ...fake.drill.batches] };
        return json({ ...diff, dry_run: false, committed: true, batch_id: args.p_batch, rows_written: diff.new });
      }
      if (fn === 'drill_rollback_batch') {
        fake.drill = { ...fake.drill, assays: fake.rollbackAssays ?? 0, holes: 12, elements: [], batches: fake.drill.batches.map((b) => (b.id === args.p_batch ? { ...b, rolled_back_at: '2026-10-21T01:00:00Z' } : b)) };
        return json({ batch_id: args.p_batch, rolled_back: true, already: false, withdrawn: 3, restored: 0 });
      }
      // Results recipes: each save is the next version of its name.
      if (fn === 'drill_property_recipes') return json(fake.recipes);
      if (fn === 'drill_save_recipe') {
        const cur = fake.recipes.find((r) => r.name === args.p_name);
        const r = { id: `r${(cur?.version || 0) + 1}`, name: args.p_name, version: (cur?.version || 0) + 1, recipe: args.p_recipe, created_at: '2026-10-21T00:00:00Z', created_by_email: user.email, versions: [] };
        fake.recipes = [...fake.recipes.filter((x) => x !== cur), r];
        return json({ ...r, unchanged: false });
      }
      if (fn === 'drill_save_template') {
        const t = { id: 't1', kind: args.p_kind, name: args.p_name, mapping: args.p_mapping, updated_at: '2026-10-21T00:00:00Z' };
        fake.templates = [t];
        return json(t);
      }
      if (fn === 'add_property_file_version') {
        const f = fake.files.find((x) => x.id === args.p_file);
        const version = f ? f.version + 1 : 1;
        const entry = { ...(f || { id: args.p_file, name: args.p_name, kind: args.p_kind, role: args.p_role }), version, path: args.p_path, bytes: args.p_bytes, sha256: args.p_sha256, uploaded_at: '2026-10-21T00:00:00Z', uploaded_by_email: user.email };
        fake.files = [...fake.files.filter((x) => x.id !== args.p_file), entry].sort((a, b) => a.name.localeCompare(b.name));
        return json({ file_id: args.p_file, version, unchanged: false });
      }
      return json(null);
    }
    if (path === '/rest/v1/properties') {
      if (method === 'POST') {
        const body = req.postDataJSON();
        const p = { ...property, ...body, id: 'p-new', slug: 'new-property' };
        fake.properties.push(p);
        return json([p], 201);
      }
      const slug = url.searchParams.get('slug'), orgId = url.searchParams.get('org_id');
      return rows(fake.properties.filter((p) => (!slug || `eq.${p.slug}` === slug) && (!orgId || `eq.${p.org_id}` === orgId)));
    }
    if (path === '/rest/v1/projects') {
      if (url.searchParams.get('property_id')) return rows([{ id: MAP, name: 'Rails claims', updated_at: '2026-10-19T00:00:00Z', thumbnail: null, revision: 3, user_id: 'u2' }]);
      return rows([]);
    }
    if (path === '/rest/v1/three_d_projects') {
      if (url.searchParams.get('property_id')) return rows([{ id: FIG, name: 'Rails 3D section', updated_at: '2026-10-18T00:00:00Z', thumbnail: null }]);
      return rows([]);
    }
    if (path === '/rest/v1/drill_column_templates') return json(fake.templates);
    if (path === '/rest/v1/drill_assays') { fake.assayReads = (fake.assayReads || 0) + 1; return url.searchParams.has('offset') ? json({ message: 'assays are keyset-paged, not offset' }, 400) : json(url.searchParams.has('or') ? [] : fake.assayRows); }
    if (path === '/rest/v1/user_plans') return single ? json({ plan: 'free', source: 'signup', status: 'active' }) : json([]);
    return single ? json({ code: 'PGRST116', message: 'no rows' }, 406) : json([]);
  });
  await page.addInitScript((s) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify(s));
    localStorage.setItem(`em_migration_v2_${s.user.id}`, JSON.stringify({ done: true, projects: {} }));
  }, session);
  return fake;
}

test('creates a company workspace and invites a colleague', async ({ page }) => {
  const fake = await fakeSupabase(page, { orgs: [] });
  await page.goto('/workspace');
  await expect(page.getByRole('heading', { name: 'Create a company workspace' })).toBeVisible();
  await page.getByLabel('Company name').fill('Star Copper Corp.');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Star Copper Corp\./ })).toBeVisible();
  expect(fake.rpc.find((c) => c.fn === 'create_organization').args).toEqual({ p_name: 'Star Copper Corp.' });
  await expect(page.getByRole('region', { name: /Members/ }).getByText('geo@star.test (you)')).toBeVisible();

  const invites = page.getByRole('region', { name: 'Invite people' });
  await invites.getByLabel('Email').fill('investor@fund.test');
  await invites.getByLabel('Role').selectOption('viewer');
  await invites.getByRole('button', { name: 'Send invite' }).click();
  await expect(invites.getByText(/Invite sent to investor@fund\.test/)).toBeVisible();
  await expect(invites.locator('code')).toHaveText(`https://www.explorationmaps.com/invite?token=${'a'.repeat(64)}`);
  await expect(invites.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(invites.getByRole('list', { name: 'Pending invites' }).getByText('investor@fund.test')).toBeVisible();
  expect(fake.rpc.find((c) => c.fn === 'create_org_invite').args).toEqual({ p_org: ORG, p_email: 'investor@fund.test', p_role: 'viewer' });
  // Phone width: nothing widens the page.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('the property page lists its map and its 3D figure', async ({ page }) => {
  await fakeSupabase(page, { role: 'editor' });
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Rails Copper-Gold', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/star-copper-corp\/p\/rails-copper-gold$/);
  await expect(page.getByRole('heading', { level: 1, name: /Rails Copper-Gold/ })).toBeVisible();
  await expect(page.getByText('Porphyry target')).toBeVisible();

  await page.getByRole('tab', { name: 'Maps' }).click();
  await expect(page.getByRole('button', { name: 'Open Rails claims' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New map in this property' })).toBeVisible();

  await page.getByRole('tab', { name: '3D figures' }).click();
  await expect(page.getByRole('button', { name: 'Open Rails 3D section' })).toBeVisible();

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('Created map "Rails claims"')).toBeVisible();
});

test('the data library lists, adds, versions, downloads and deletes files', async ({ page }) => {
  const fake = await fakeSupabase(page, { role: 'admin' });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Data library' }).click();
  const region = page.getByRole('region', { name: 'Data library' });
  const table = region.getByRole('table', { name: 'Data files' });
  await expect(table.getByRole('row', { name: /assays\.csv.*Drill data · assays.*v2.*cfo@star\.test/ })).toBeVisible();

  // A new file: kind guessed from the name, uploaded to v1 of its own folder, then recorded.
  let chooser = page.waitForEvent('filechooser');
  await region.getByRole('button', { name: '+ Add a file' }).click();
  await (await chooser).setFiles({ name: 'Rails collars.csv', mimeType: 'text/csv', buffer: Buffer.from('HoleID,Easting,Northing\nR-1,1,2\n') });
  await expect(region.getByLabel('Kind of data')).toHaveValue('drill');
  await region.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(region.getByText('Added Rails collars.csv.')).toBeVisible();
  expect(fake.uploads[0]).toMatch(new RegExp(`^${ORG}/${PROP}/[0-9a-f-]{36}/v1/[0-9a-f]{8}-Rails_collars\\.csv$`));
  const added = fake.rpc.find((c) => c.fn === 'add_property_file_version').args;
  expect(added).toMatchObject({ p_property: PROP, p_name: 'Rails collars.csv', p_kind: 'drill', p_role: 'collars', p_path: fake.uploads[0], p_bytes: 32 });
  expect(added.p_sha256).toMatch(/^[0-9a-f]{64}$/);
  await expect(table.getByRole('row', { name: /Rails collars\.csv.*v1.*geo@star\.test/ })).toBeVisible();

  // A new version of an existing file goes into its next folder.
  chooser = page.waitForEvent('filechooser');
  await region.getByRole('button', { name: 'Upload a new version of assays.csv' }).click();
  await (await chooser).setFiles({ name: 'assays-batch7.csv', mimeType: 'text/csv', buffer: Buffer.from('HoleID,From,To,Cu\nR-1,0,2,0.4\n') });
  await expect(region.getByText('Uploaded version 3 of assays.csv.')).toBeVisible();
  expect(fake.uploads[1]).toMatch(new RegExp(`^${ORG}/${PROP}/${FILE}/v3/[0-9a-f]{8}-assays-batch7\\.csv$`));
  await expect(table.getByRole('row', { name: /assays\.csv.*v3/ })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.route('https://example.supabase.co/storage/v1/object/sign/property-files/**', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, headers: { 'content-disposition': 'attachment; filename="assays.csv"' }, body: 'HoleID' }) : route.fallback()));
  await region.getByRole('button', { name: 'Download assays.csv' }).click();
  expect((await download).suggestedFilename()).toBe('assays.csv');
  expect(fake.signed).toEqual([fake.uploads[1]]);

  page.once('dialog', (d) => d.accept());
  await region.getByRole('button', { name: 'Delete assays.csv' }).click();
  await expect(table.getByText('assays.csv')).toHaveCount(0);
  expect(fake.patches).toEqual([{ id: FILE, body: { deleted_at: expect.any(String) } }]);
});

test('drill data: source coordinate preview preserves the imported survey values', async ({ page }) => {
  const fake = await fakeSupabase(page, { role: 'editor', properties: [{ ...property, crs: 'EPSG:26910' }] });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  await page.getByLabel('Drill data file').setInputFiles({ name: 'synthetic-collars.csv', mimeType: 'text/csv', buffer: Buffer.from('HoleID,Easting,Northing\nSYNTHETIC-01,512345.678,5432109.876\n') });
  const source = page.getByRole('region', { name: 'Source coordinates', exact: true });
  await expect(source.getByLabel('Source coordinate system')).toHaveValue('EPSG:26910');
  await source.getByLabel('Source coordinate system').fill('EPSG:26710');
  await expect(source.getByText(/The property uses EPSG:26910/)).toBeVisible();
  await source.getByRole('button', { name: 'Preview source coordinates' }).click();
  const preview = source.getByRole('table', { name: 'Source coordinate preview' });
  await expect(preview.getByRole('columnheader', { name: 'Longitude (NAD27)' })).toBeVisible();
  await expect(preview.getByRole('cell', { name: '512345.678', exact: true })).toBeVisible();
  await expect(source.getByText(/it is not a WGS84 map position/)).toBeVisible();
  await page.getByRole('button', { name: 'Check against stored data' }).click();
  await page.getByRole('button', { name: 'Commit import' }).click();
  await expect(page.getByText(/Imported synthetic-collars.csv/)).toBeVisible();
  const requests = fake.rpc.filter(c => c.fn === 'drill_import_batch');
  expect(requests).toHaveLength(2);
  for (const { args } of requests) {
    expect(args.p_rows).toEqual([{ hole_id: 'SYNTHETIC-01', x: 512345.678, y: 5432109.876, crs: 'EPSG:26710' }]);
    expect(args.p_mapping.coordinateSource).toEqual({ version: 1, crs: 'EPSG:26710', operation: 'preserve-source', axisOrder: 'xy' });
  }
});

test('alteration import: CSV and Excel preserve source text with retry, templates and rollback', async ({ page }, testInfo) => {
  const fake = await fakeSupabase(page, { role: 'editor' });
  fake.drill.alteration = 0;
  const imports = [], committed = new Set(); let uncertain = true;
  await page.route('**/rest/v1/rpc/drill_import_batch', route => {
    const args = route.request().postDataJSON(); imports.push(args);
    expect(args.p_kind).toBe('alteration');
    const diff = { ok: true, new: args.p_rows.length, changed: 0, unchanged: 0, new_holes: 0, missing_collars: 1, missing_collar_holes: ['SOURCE-01'], overlaps_existing: 0, changed_sample: [] };
    if (args.p_dry_run) return route.fulfill({ json: diff });
    if (!committed.has(args.p_batch)) {
      committed.add(args.p_batch); fake.drill.alteration = args.p_rows.length;
      fake.drill.batches.unshift({ id: args.p_batch, kind: 'alteration', filename: args.p_filename, summary: diff, created_at: '2026-10-23T12:00:00Z', rolled_back_at: null });
    }
    if (uncertain) { uncertain = false; return route.fulfill({ status: 500, json: { message: 'Synthetic response lost; retry unchanged import' } }); }
    return route.fulfill({ json: { ...diff, committed: true } });
  });
  await page.route('**/rest/v1/rpc/drill_rollback_batch', route => {
    const args = route.request().postDataJSON(); fake.drill.alteration = 0;
    fake.drill.batches = fake.drill.batches.map(b => b.id === args.p_batch ? { ...b, rolled_back_at: '2026-10-23T13:00:00Z' } : b);
    return route.fulfill({ json: { rolled_back: true, withdrawn: 2, restored: 0 } });
  });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold'); await page.getByRole('tab', { name: 'Drill data' }).click();
  const region = page.getByRole('region', { name: 'Drill data', exact: true }), form = region.getByRole('form', { name: 'Import drill data' });
  const rows = [['HoleID', 'From', 'To', 'Alteration code', 'Description', 'Intensity'], ['SOURCE-01', '0', '2', '03', '', '03'], ['SOURCE-01', '1', '3', '', 'Sericite', 'weak']];
  await region.getByLabel('Drill data file').setInputFiles({ name: 'alteration.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.map(r => r.join(',')).join('\n')) });
  await expect(form.getByLabel('Data')).toHaveValue('alteration'); await expect(form.getByLabel('Intensity (text)')).toHaveValue('Intensity');
  await expect(form.getByText(/Overlapping intervals in 1 hole/)).toBeVisible();
  await form.getByRole('button', { name: 'Check against stored data' }).click();
  await expect(form.getByRole('status', { name: 'Changes' })).toContainText('2 new alteration intervals');
  await expect(form.getByText('1 hole has no collar yet: SOURCE-01')).toBeVisible();
  await form.getByLabel('Template name').fill('Alteration source'); await form.getByRole('button', { name: 'Save columns as template' }).click();
  await expect(form.getByLabel('Saved columns').locator('option', { hasText: 'Alteration source' })).toHaveCount(1);
  await form.getByRole('button', { name: 'Commit import' }).click(); await expect(form.getByRole('alert')).toContainText('Synthetic response lost');
  await form.getByRole('button', { name: 'Commit import' }).click(); await expect(region.getByText('Imported alteration.csv: 2 new alteration intervals.')).toBeVisible();
  const attempts = imports.filter(a => !a.p_dry_run); expect(attempts[0].p_batch).toBe(attempts[1].p_batch);
  expect(attempts[0].p_rows).toEqual([{ hole_id: 'SOURCE-01', from_m: 0, to_m: 2, code: '03', intensity: '03' }, { hole_id: 'SOURCE-01', from_m: 1, to_m: 3, description: 'Sericite', intensity: 'weak' }]);
  await expect(region.getByText('Alteration intervals', { exact: true }).locator('..')).toHaveText('Alteration intervals2');
  expect(fake.drill.collars).toBe(12); expect(fake.drill.assays).toBe(0);
  page.once('dialog', d => d.accept()); await region.getByRole('button', { name: 'Roll back alteration.csv' }).click();
  await expect(region.getByRole('table', { name: 'Import history' }).getByRole('row', { name: /alteration.csv.*Rolled back/ })).toBeVisible();
  await expect(region.getByText('Alteration intervals', { exact: true }).locator('..')).toHaveText('Alteration intervals0');
  await region.getByLabel('Drill data file').setInputFiles({ name: 'alteration.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(xlsxFixture([{ name: 'Alteration', rows }])) });
  await region.getByRole('button', { name: 'Use these columns' }).click();
  await expect(form.getByLabel('Data')).toHaveValue('alteration'); await form.getByLabel('Saved columns').selectOption({ label: 'Alteration source' });
  await form.getByRole('button', { name: 'Check against stored data' }).click(); await expect(form.getByRole('button', { name: 'Commit import' })).toBeEnabled();
  expect(imports.at(-1).p_rows).toEqual(attempts[0].p_rows);
  await form.getByRole('button', { name: 'Commit import' }).click(); await expect(region.getByText('Imported alteration.xlsx: 2 new alteration intervals.')).toBeVisible();
  expect(fake.rpc.find(c => c.fn === 'drill_save_template').args.p_kind).toBe('alteration');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('alteration-import.png'), fullPage: true });
});

test('alteration import: unavailable database support leaves legacy import usable', async ({ page }) => {
  await fakeSupabase(page, { role: 'editor' });
  await page.route('**/rest/v1/rpc/drill_import_batch', route => {
    const args = route.request().postDataJSON();
    return args.p_kind === 'alteration' ? route.fulfill({ status: 400, json: { code: '22023', message: 'INVALID_KIND: alteration' } }) : route.fulfill({ json: { ok: true, new: 1, changed: 0, unchanged: 0 } });
  });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold'); await page.getByRole('tab', { name: 'Drill data' }).click();
  await page.getByLabel('Drill data file').setInputFiles({ name: 'alteration.csv', mimeType: 'text/csv', buffer: Buffer.from('HoleID,From,To,Alteration code,Intensity\nH1,0,1,03,weak') });
  const form = page.getByRole('form', { name: 'Import drill data' });
  await form.getByRole('button', { name: 'Check against stored data' }).click(); await expect(form.getByRole('alert')).toContainText('Alteration imports are not available on this site yet');
  await form.getByLabel('Data').selectOption('lithology'); await form.getByRole('combobox', { name: 'Code', exact: true }).selectOption('Alteration code');
  await form.getByRole('button', { name: 'Check against stored data' }).click(); await expect(form.getByRole('button', { name: 'Commit import' })).toBeEnabled();
  await expect(page.getByText('Alteration intervals', { exact: true })).toHaveCount(0);
});

test('drill data: import a CSV, map its columns, see the diff, commit and roll back', async ({ page }, testInfo) => {
  const fake = await fakeSupabase(page, { role: 'editor' });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  const region = page.getByRole('region', { name: 'Drill data' });
  const summary = region.getByRole('definition').filter({ hasText: '12 (2 planned)' });
  await expect(summary).toBeVisible();
  await expect(region.getByText('3,420.5')).toBeVisible();
  const history = region.getByRole('table', { name: 'Import history' });
  await expect(history.getByRole('row', { name: /Collars.*Rails collars\.csv.*12 new holes.*cfo@star\.test/ })).toBeVisible();

  // A file with an unclosed quote is refused whole, naming the line.
  const broken = page.waitForEvent('filechooser');
  await region.getByRole('button', { name: '+ Import CSV or Excel' }).click();
  await (await broken).setFiles({ name: 'lith.csv', mimeType: 'text/csv', buffer: Buffer.from('HoleID,From,To,Code,Description\nR-1,0,2,QMD,"Quartz monzodiorite\nR-1,2,4,AND,Andesite\n') });
  await expect(region.getByRole('alert')).toContainText('Line 2: a quoted value starts here and is never closed');
  await expect(region.getByRole('form', { name: 'Import drill data' })).toHaveCount(0);

  // The kind and columns are detected; the BDL value is flagged before anything is sent.
  const chooser = page.waitForEvent('filechooser');
  await region.getByRole('button', { name: '+ Import CSV or Excel' }).click();
  await (await chooser).setFiles({ name: 'assays-2026.csv', mimeType: 'text/csv', buffer: Buffer.from('HoleID,Sample,From,To,Cu_pct,Au_gpt\nR-1,A1,0,2,0.41,<0.005\nR-1,A2,2,4,0.55,0.12\nR-9,A3,0,1.5,0.2,0.03\n') });
  const form = region.getByRole('form', { name: 'Import drill data' });
  await expect(form.getByLabel('Data')).toHaveValue('assays');
  await expect(form.getByLabel('Hole ID *')).toHaveValue('HoleID');
  await expect(form.getByLabel('From *')).toHaveValue('From');
  await expect(form.getByLabel('Sample ID')).toHaveValue('Sample');
  await expect(form.getByLabel('Element for Au_gpt')).toHaveValue('Au');
  await expect(form.getByLabel('Unit for Au_gpt')).toHaveValue('g/t');
  await expect(form.getByText('1 value below detection, stored as half the detection limit and flagged')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await form.getByRole('button', { name: 'Check against stored data' }).click();
  await expect(form.getByRole('status', { name: 'Changes' })).toContainText('1 new hole, 3 new assays');
  await expect(form.getByText('1 hole has no collar yet: R-9')).toBeVisible();
  const dry = fake.rpc.find((c) => c.fn === 'drill_import_batch').args;
  expect(dry).toMatchObject({ p_property: PROP, p_kind: 'assays', p_filename: 'assays-2026.csv', p_dry_run: true, p_batch: null });
  expect(dry.p_rows[0]).toEqual({ hole_id: 'R-1', sample_id: 'A1', from_m: 0, to_m: 2, values: { Cu: 0.41, Au: 0.0025 }, bdl: { Au: 0.005 }, units: { Cu: '%', Au: 'g/t' } });
  expect(dry.p_mapping).toMatchObject({ columns: { hole_id: 'HoleID', from_m: 'From', to_m: 'To', sample_id: 'Sample' }, bdl: 'half' });
  await page.screenshot({ path: testInfo.outputPath('drill-diff.png'), fullPage: true });

  // Columns saved as a template for the next file from this lab.
  await form.getByLabel('Template name').fill('ALS export');
  await form.getByRole('button', { name: 'Save columns as template' }).click();
  await expect(form.getByLabel('Saved columns').locator('option', { hasText: 'ALS export' })).toHaveCount(1);
  expect(fake.rpc.find((c) => c.fn === 'drill_save_template').args).toMatchObject({ p_org: ORG, p_kind: 'assays', p_name: 'ALS export' });

  await form.getByRole('button', { name: 'Commit import' }).click();
  await expect(region.getByText('Imported assays-2026.csv: 1 new hole, 3 new assays.')).toBeVisible();
  const commit = fake.rpc.filter((c) => c.fn === 'drill_import_batch')[1].args;
  expect(commit).toMatchObject({ p_dry_run: false, p_batch: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  await expect(history.getByRole('row', { name: /Assays.*assays-2026\.csv.*1 new hole, 3 new assays.*geo@star\.test/ })).toBeVisible();
  await expect(region.getByText('Au, Cu')).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await history.getByRole('button', { name: 'Roll back assays-2026.csv' }).click();
  await expect(history.getByRole('row', { name: /assays-2026\.csv.*Rolled back/ })).toBeVisible();
  expect(fake.rpc.find((c) => c.fn === 'drill_rollback_batch').args).toEqual({ p_batch: commit.p_batch });
});

test('drill Excel: sheet and header preview, decimal text, mapping and commit', async ({ page }) => {
  const fake = await fakeSupabase(page, { role: 'editor' });
  const requests = []; page.on('request', r => requests.push(r.url()));
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  const region = page.getByRole('region', { name: 'Drill data' });
  await expect(region.getByRole('button', { name: '+ Import CSV or Excel' })).toBeVisible();
  expect(requests.some(u => /xlsxRead-/.test(u))).toBe(false);
  const bytes = xlsxFixture([
    { name: 'Notes', rows: [['Illustrative fixture; no real drill locations']] },
    { name: 'Assays', merge: 'A1:E1', rows: [['Illustrative assay workbook'], [], ['HoleID', 'From', 'To', 'Au_ppm', 'Sample_ID'], ['TEST-01', '0,5', '1,5', '<0,005', '000123']] },
  ]);
  await region.getByLabel('Drill data file').setInputFiles({ name: 'assays.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) });
  const picker = region.getByRole('region', { name: 'Choose Excel sheet' });
  await expect(picker.getByRole('button', { name: 'Use these columns' })).toBeDisabled();
  await picker.getByRole('combobox', { name: 'Sheet', exact: true }).selectOption({ label: 'Assays' });
  await expect(picker.getByLabel('Header row')).toHaveValue('3');
  await picker.getByLabel('Header row').fill('1');
  await expect(picker.getByRole('button', { name: 'Use these columns' })).toBeDisabled();
  await picker.getByLabel('Header row').fill('3');
  await picker.getByLabel('Decimal separator in text values').selectOption('comma');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await picker.getByRole('button', { name: 'Use these columns' }).click();
  const form = region.getByRole('form', { name: 'Import drill data' });
  await expect(form.getByLabel('Import Au_ppm', { exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await form.getByRole('button', { name: 'Choose sheet or header' }).click();
  await expect(picker.getByLabel('Header row')).toHaveValue('3');
  await expect(picker.getByLabel('Decimal separator in text values')).toHaveValue('comma');
  await picker.getByRole('button', { name: 'Use these columns' }).click();
  await form.getByRole('button', { name: 'Check against stored data' }).click();
  await expect(form.getByRole('button', { name: 'Commit import' })).toBeEnabled();
  const dry = fake.rpc.find(c => c.fn === 'drill_import_batch').args;
  expect(dry.p_rows[0]).toEqual({ hole_id: 'TEST-01', sample_id: '000123', from_m: 0.5, to_m: 1.5, values: { Au: 0.0025 }, bdl: { Au: 0.005 }, units: { Au: 'ppm' } });
  expect(dry.p_mapping).toMatchObject({ decimalComma: true, excel: { sheet: 'Assays', headerRow: 3 } });
  await form.getByRole('button', { name: 'Commit import' }).click();
  await expect(region.getByText(/Imported assays.xlsx:/)).toBeVisible();
  expect(fake.rpc.filter(c => c.fn === 'drill_import_batch')[1].args.p_rows).toEqual(dry.p_rows);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('drill Excel: legacy errors, large workbook workers and the row cap', async ({ page }) => {
  await fakeSupabase(page, { role: 'editor' });
  await page.addInitScript(() => { window.workerViolations = []; document.addEventListener('securitypolicyviolation', e => { if (e.effectiveDirective === 'worker-src') window.workerViolations.push(e.blockedURI); }); });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  const region = page.getByRole('region', { name: 'Drill data' });
  await region.getByLabel('Drill data file').setInputFiles({ name: 'old.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from([0xd0, 0xcf]) });
  await expect(region.getByRole('alert')).toContainText('older .xls');
  const rows = [['HoleID', 'From', 'To', 'Au_ppm'], ...Array.from({ length: 20001 }, (_, i) => [`TEST-${i}`, 0, 1, 0.52])];
  await region.getByLabel('Drill data file').setInputFiles({ name: 'large.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(xlsxFixture([{ name: 'Assays', rows }])) });
  const picker = region.getByRole('region', { name: 'Choose Excel sheet' });
  await expect(picker.getByRole('alert')).toContainText('more than 20,000', { timeout: 20000 });
  await expect(picker.getByRole('button', { name: 'Use these columns' })).toBeDisabled();
  expect(await page.evaluate(() => window.workerViolations)).toEqual([]);
  await picker.getByRole('button', { name: 'Cancel' }).click();
  await expect(region.getByRole('button', { name: '+ Import CSV or Excel' })).toBeVisible();
});

// Assays as the drill database returns them: 2 m samples, 122 m of mineralisation from 34 m with an 18 m core.
const assayRows = (hole) => Array.from({ length: 100 }, (_, i) => {
  const d = i * 2, v = d < 34 || d >= 156 ? { Cu: 0.02, Au: 0.01 } : d >= 80 && d < 98 ? { Cu: 1.0, Au: 0.42 } : { Cu: 0.355, Au: 0.174 };
  return { hole_id: hole, from_m: d, to_m: d + 2, values: v, bdl: {}, units: { Cu: '%', Au: 'g/t' } };
});
const RESULT = '122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m, incl. 18.0 m @ 1.32% CuEq';
const withAssays = (fake) => { fake.drill = { ...fake.drill, assays: 200, holes: 12, elements: ['Au', 'Cu'] }; fake.assayRows = [...assayRows('R-10'), ...assayRows('R-2')]; };

test('drill results: wide multipage images and PDF preserve the last hole and notes', async ({ page }, testInfo) => {
  const fake = await fakeSupabase(page, { role: 'editor' });
  withAssays(fake);
  // Synthetic rows only. All assay columns must appear across labelled page groups.
  fake.assayRows = Array.from({ length: 60 }, (_, i) => ({ ...assayRows('SYNTHETIC')[0], hole_id: `SYNTHETIC-${String(i).padStart(3, '0')}`, values: { Cu: 1, Au: 1, Ag: 1, Zn: 1, Pb: 1, Ni: 1, Co: 1, Mo: 1 }, units: { Cu: '%', Au: 'g/t', Ag: 'g/t', Zn: '%', Pb: '%', Ni: '%', Co: '%', Mo: '%' } }));
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.__tablePaint = [];
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.__tablePaint.push(text); return original.call(this, text, ...args); };
  });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  const region = page.getByRole('region', { name: 'Results' });
  await region.getByRole('button', { name: 'Show results' }).click();
  await region.getByLabel('True-width note').fill('Synthetic fixture only. ' + 'True widths are unknown. '.repeat(30));
  await region.getByRole('button', { name: 'Save recipe' }).click();
  await expect(region.getByRole('status')).toHaveText('Saved Default, version 1.');
  let count;
  for (const format of ['png', 'pdf']) {
    await page.evaluate(() => { window.__tablePaint = []; });
    await region.getByLabel('Table format').selectOption(format);
    const pending = page.waitForEvent('download');
    await region.getByRole('button', { name: `Download ${format.toUpperCase()}` }).click();
    const file = await pending;
    const chunks = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (format === 'png') {
      expect(file.suggestedFilename()).toBe('rails-copper-gold-results.zip');
      const files = unzipSync(bytes), names = Object.keys(files).sort(); count = names.length;
      expect(count).toBeGreaterThan(3);
      expect(names[0]).toBe('results-page-001.png');
      expect(names.at(-1)).toBe(`results-page-${String(count).padStart(3, '0')}.png`);
      for (const content of Object.values(files)) {
        const data = Buffer.from(content);
        expect([data.readUInt32BE(16), data.readUInt32BE(20)]).toEqual([1584, 1224]);
      }
    } else expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(count);
    await file.saveAs(testInfo.outputPath(`results-wide.${format === 'png' ? 'zip' : 'pdf'}`));
    const painted = await page.evaluate(() => window.__tablePaint);
    expect(painted).toContain('Saved recipe: Default, version 1. Calculated from current assays.');
    for (let i = 0; i < 60; i++) expect(painted.join('')).toContain(`SYNTHETIC-${String(i).padStart(3, '0')}`);
    expect(painted.join('')).toContain(('Synthetic fixture only. ' + 'True widths are unknown. '.repeat(30)).trim());
    expect(painted.join('')).toContain('column group 2 of 2');
    expect(painted.join('')).toContain('Mo (%)');
  }
});

test('drill results: the recipe, the release table, copies and downloads, then saved for 3D', async ({ page }, testInfo) => {
  const fake = await fakeSupabase(page, { role: 'editor' });
  withAssays(fake);
  await page.addInitScript(() => {
    navigator.clipboard.writeText = async (t) => { window.__copied = t; };
    navigator.clipboard.write = async ([item]) => {
      window.__formattedCopy = Object.fromEntries(await Promise.all(item.types.map(async (type) => [type, await (await item.getType(type)).text()])));
    };
  });
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  const region = page.getByRole('region', { name: 'Results' });
  await region.getByRole('button', { name: 'Show results' }).click();
  await expect(region.getByText('Not saved yet: a first recipe from the elements in the assays.')).toBeVisible();
  expect(fake.assayReads).toBe(1);
  await region.getByLabel('Recovery for Cu').fill('90');
  await region.getByLabel('Recovery for Au').fill('70');
  await region.getByLabel('"incl." cut-off').fill('1');
  await region.getByLabel('True-width note').fill('True widths are not yet known.');
  await expect(region.getByText('CuEq = Cu + 0.756 × Au', { exact: true })).toBeVisible();
  const table = region.getByRole('table', { name: 'Drill results' });
  // Sorted by hole (R-2 before R-10) and depth, each "incl." under its interval.
  await expect(table.getByRole('row')).toHaveText([/Hole ID.*CuEq \(%\).*Cu \(%\).*Au \(g\/t\)/, /^R-2\s*34\.0\s*156\.0\s*122\.0\s*0\.61\s*0\.45\s*0\.21$/, /^incl\.\s*80\.0\s*98\.0\s*18\.0\s*1\.32/, /^R-10\s*34\.0/, /^incl\./]);
  await expect(region.getByText('2 intercepts in 2 of 2 holes with assays.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('drill-results.png'), fullPage: true });

  await region.getByRole('button', { name: 'Copy as text' }).click();
  await expect(region.getByRole('status')).toHaveText('Copied the results as text.');
  const text = await page.evaluate(() => window.__copied);
  expect(text.split('\n').slice(0, 2)).toEqual([`R-2: ${RESULT}`, `R-10: ${RESULT}`]);
  expect(text).toContain('True widths are not yet known.');
  await region.getByRole('button', { name: 'Copy table (TSV)' }).click();
  expect((await page.evaluate(() => window.__copied)).split('\n')[1]).toBe('R-2\t\t34.0\t156.0\t122.0\t0.61\t0.45\t0.21\t122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m');
  const csv = page.waitForEvent('download');
  await region.getByRole('button', { name: 'Download CSV' }).click();
  const file = await csv;
  expect(file.suggestedFilename()).toBe('rails-copper-gold-results.csv');

  const downloadExcel = async () => {
    await region.getByLabel('Table format').selectOption('xlsx');
    const pending = page.waitForEvent('download');
    await region.getByRole('button', { name: 'Download Excel' }).click();
    const workbook = await pending;
    expect(workbook.suggestedFilename()).toBe('rails-copper-gold-results.xlsx');
    const chunks = [];
    for await (const chunk of await workbook.createReadStream()) chunks.push(chunk);
    const [sheet] = await readExcelFile(Buffer.concat(chunks), { trim: false });
    await workbook.saveAs(testInfo.outputPath(sheet.data[1][0].startsWith('Saved') ? 'results-saved.xlsx' : 'results-draft.xlsx'));
    expect(sheet.data[3].map(v => v ?? '')).toEqual(['R-2', '', '34.0', '156.0', '122.0', '0.61', '0.45', '0.21', RESULT.split(', incl.')[0]]);
    expect(sheet.data[4].slice(0, 2)).toEqual(['R-2', 'incl.']);
    expect(sheet.data.flat()).toContain('True widths are not yet known.');
    return sheet.data;
  };
  expect((await downloadExcel())[1][0]).toBe('Unsaved recipe: Default. Calculated from current assays.');

  // Actual image/PDF download, using the same formatted result and recipe notes.
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.__tablePaint = [];
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.__tablePaint.push(text); return original.call(this, text, ...args); };
  });
  for (const format of ['png', 'pdf']) {
    await page.evaluate(() => { window.__tablePaint = []; });
    await region.getByLabel('Table format').selectOption(format);
    const pending = page.waitForEvent('download');
    await region.getByRole('button', { name: `Download ${format.toUpperCase()}` }).click();
    const image = await pending;
    expect(image.suggestedFilename()).toBe(`rails-copper-gold-results.${format}`);
    const chunks = [];
    for await (const chunk of await image.createReadStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (format === 'png') {
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1584, 1224]);
    } else {
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(bytes.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
    }
    await image.saveAs(testInfo.outputPath(`results-draft.${format}`));
    const painted = await page.evaluate(() => window.__tablePaint);
    expect(painted.join('')).toContain(RESULT.split(', incl.')[0]);
    expect(painted).toEqual(expect.arrayContaining(['R-2', 'incl.', '34.0', '156.0', '122.0', '0.61', 'True widths are not yet known.', 'Unsaved recipe: Default. Calculated from current assays.']));
  }

  await region.getByLabel('Table format').selectOption('html');
  await region.getByRole('button', { name: 'Copy formatted table' }).click();
  await expect(region.getByRole('status')).toHaveText('Copied the formatted table and recipe notes.');
  const formatted = await page.evaluate(() => window.__formattedCopy);
  expect(formatted['text/plain']).toContain('Unsaved recipe: Default. Calculated from current assays.');
  expect(formatted['text/plain']).toContain('True widths are not yet known.');
  const htmlDownload = page.waitForEvent('download');
  await region.getByRole('button', { name: 'Download HTML' }).click();
  const htmlFile = await htmlDownload;
  expect(htmlFile.suggestedFilename()).toBe('rails-copper-gold-results.html');
  const html = await new Promise((resolve) => { let t = ''; htmlFile.createReadStream().then((st) => { st.on('data', (c) => { t += c; }); st.on('end', () => resolve(t)); }); });
  expect(html).toBe(formatted['text/html']);
  const exported = await page.context().newPage();
  await exported.setContent(html);
  await expect(exported.getByRole('row')).toHaveCount(5);
  await expect(exported.getByRole('cell', { name: RESULT.split(', incl.')[0], exact: true })).toHaveCount(2);
  await expect(exported.getByText('True widths are not yet known.')).toBeVisible();
  await exported.screenshot({ path: testInfo.outputPath('drill-results-html.png'), fullPage: true });
  await exported.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  // Results for 3D come from a saved recipe only.
  const for3d = region.getByRole('button', { name: 'Download for 3D figures' });
  await expect(for3d).toBeDisabled();
  await region.getByRole('button', { name: 'Save recipe' }).click();
  await expect(region.getByRole('status')).toHaveText('Saved Default, version 1.');
  const saved = fake.rpc.find((c) => c.fn === 'drill_save_recipe').args;
  expect(saved).toMatchObject({ p_property: PROP, p_name: 'Default', p_base_version: 0, p_recipe: { primary: 'Cu', equivalent: true, cutoff: 0.2, inclCutoff: 1, trueWidth: 'True widths are not yet known.' } });
  expect(saved.p_recipe.elements).toEqual([{ name: 'Cu', unit: '%', price: 4.5, recovery: 90 }, { name: 'Au', unit: 'g/t', price: 3000, recovery: 70 }]);
  await expect(region.getByText(/Default, version 1 · saved/)).toBeVisible();
  expect((await downloadExcel())[1][0]).toBe('Saved recipe: Default, version 1. Calculated from current assays.');
  await region.getByLabel('Table format').selectOption('html');
  await region.getByRole('button', { name: 'Copy formatted table' }).click();
  await expect(region.getByRole('status')).toHaveText('Copied the formatted table and recipe notes.');
  expect((await page.evaluate(() => window.__formattedCopy))['text/plain']).toContain('Saved recipe: Default, version 1. Calculated from current assays.');
  await page.evaluate(() => { navigator.clipboard.write = async () => { throw new Error('Denied'); }; });
  await region.getByRole('button', { name: 'Copy formatted table' }).click();
  await expect(region.getByText('Copying a formatted table was blocked or is not supported by this browser. Download HTML instead.')).toBeVisible();
  await expect(region.getByRole('button', { name: 'Download HTML' })).toBeEnabled();
  const pub = page.waitForEvent('download');
  await for3d.click();
  const pf = await pub;
  expect(pf.suggestedFilename()).toBe('rails-copper-gold-published-results.csv');
  const body = await new Promise((resolve) => { let t = ''; pf.createReadStream().then((st) => { st.on('data', (c) => { t += c; }); st.on('end', () => resolve(t)); }); });
  expect(body.split('\r\n').slice(0, 3)).toEqual([
    'Result ID,Hole ID,From,To,Published length,Grade,Analyte,Unit,Parent result,Approved text,Release date,Source,Approval status',
    'R-2:1,R-2,34,156,122.0,0.61,CuEq,%,,"122.0 m @ 0.61% CuEq (0.45% Cu, 0.21 g/t Au) from 34.0 m",,Property results: Default v1,approved',
    'R-2:1.1,R-2,80,98,18.0,1.32,CuEq,%,R-2:1,18.0 m @ 1.32% CuEq,,Property results: Default v1,approved',
  ]);

  // A roll-back (or an import) changes the assays: Results reads them again.
  fake.rollbackAssays = 100;
  fake.assayRows = assayRows('R-2');
  const reads = fake.assayReads;
  page.once('dialog', (d) => d.accept());
  await page.getByRole('table', { name: 'Import history' }).getByRole('button', { name: 'Roll back Rails collars.csv' }).click();
  await expect(region.getByText('1 intercept in 1 of 1 holes with assays.')).toBeVisible();
  expect(fake.assayReads).toBe(reads + 1);
  await expect(region.getByText(/Default, version 1 · saved/)).toBeVisible();
});

test('drill results: members see the saved recipe and its table, without editing it', async ({ page }) => {
  const fake = await fakeSupabase(page, { role: 'viewer' });
  withAssays(fake);
  fake.recipes = [{ id: 'r3', name: 'Default', version: 3, created_at: '2026-10-20T00:00:00Z', created_by_email: 'cfo@star.test', versions: [],
    recipe: { version: 1, primary: 'Cu', equivalent: true, elements: [{ name: 'Cu', unit: '%', price: 4.5, recovery: 90 }, { name: 'Au', unit: 'g/t', price: 3000, recovery: 70 }],
      cutoff: 0.2, minLength: 2, maxDilution: 6, inclCutoff: 1, inclMinLength: 2, inclMaxDilution: 0, bdl: 'stored', lengthDecimals: 1, gradeDecimals: {}, trueWidth: '' } }];
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await page.getByRole('tab', { name: 'Drill data' }).click();
  const region = page.getByRole('region', { name: 'Results' });
  await region.getByRole('button', { name: 'Show results' }).click();
  await expect(region.getByText('Default, version 3 · saved')).toBeVisible();
  await expect(region.getByRole('table', { name: 'Drill results' }).getByRole('row').nth(1)).toHaveText(/^R-2\s*34\.0\s*156\.0\s*122\.0\s*0\.61/);
  await expect(region.getByLabel('Recovery for Au')).toBeDisabled();
  await expect(region.getByLabel('Cut-off', { exact: true })).toBeDisabled();
  await expect(region.getByRole('button', { name: 'Save recipe' })).toHaveCount(0);
  await expect(region.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await expect(region.getByRole('button', { name: 'Download for 3D figures' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test('a viewer gets the same pages without editing controls', async ({ page }) => {
  await fakeSupabase(page, { role: 'viewer' });
  await page.goto('/workspace');
  await expect(page.getByText(/You have view-only access to Star Copper Corp\./)).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New property' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Invite people' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Rails Copper-Gold' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /Role for/ })).toHaveCount(0);

  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await expect(page.getByText(/View only\. You can open every map/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Maps' }).click();
  await expect(page.getByRole('button', { name: 'Open Rails claims' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New map in this property' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Move one of my maps here' })).toHaveCount(0);
  await page.getByRole('tab', { name: '3D figures' }).click();
  await expect(page.getByRole('button', { name: 'Open Rails 3D section' })).toBeVisible();
  await expect(page.getByRole('link', { name: '+ New 3D figure' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Data library' }).click();
  await expect(page.getByRole('button', { name: 'Download assays.csv' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add a file' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Upload a new version/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Drill data' }).click();
  await expect(page.getByRole('table', { name: 'Import history' }).getByRole('row', { name: /Rails collars\.csv.*12 new holes/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Import CSV or Excel' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Roll back/ })).toHaveCount(0);
});

test('an older property link opens directly when only one company has that address', async ({ page }) => {
  await fakeSupabase(page, { role: 'editor' });
  await page.goto('/workspace/p/rails-copper-gold');
  await expect(page.getByRole('heading', { level: 1, name: /Rails Copper-Gold/ })).toBeVisible();
  await expect(page).toHaveURL(/\/workspace\/star-copper-corp\/p\/rails-copper-gold$/);
});

test('an older property link shared by two companies asks which one', async ({ page }) => {
  await fakeSupabase(page, { role: 'editor', orgs: [org('editor'), jvOrg], properties: [property, jvProperty] });
  await page.goto('/workspace/p/rails-copper-gold');
  await expect(page.getByRole('heading', { name: 'Which property did you mean?' })).toBeVisible();
  await expect(page).toHaveURL(/\/workspace\/p\/rails-copper-gold$/);
  await page.getByRole('button', { name: 'Open in North Rock JV' }).click();
  await expect(page).toHaveURL(/\/workspace\/north-rock-jv\/p\/rails-copper-gold$/);
  await expect(page.getByRole('heading', { level: 1, name: /Rails JV/ })).toBeVisible();
  await expect(page.getByText('Joint venture ground')).toBeVisible();
  // Each company's address opens its own property.
  await page.goto('/workspace/star-copper-corp/p/rails-copper-gold');
  await expect(page.getByRole('heading', { level: 1, name: /Rails Copper-Gold/ })).toBeVisible();
});

test('an invite link signed out asks to sign in and keeps the token', async ({ page }) => {
  await page.route('**/api/track', (route) => route.fulfill({ status: 204 }));
  await page.route('https://example.supabase.co/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  const t = 'b'.repeat(64);
  await page.goto(`/invite?token=${t}`);
  await expect(page.getByRole('heading', { name: /invited to a company workspace/ })).toBeVisible();
  await expect(page).toHaveURL(/\/invite$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('em.pendingInvite.v1')).token)).toBe(t);
});
