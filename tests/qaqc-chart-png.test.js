import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureChartPng, chartProvenance, downloadChartPng } from '../src/utils/qaqcChartPng';
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('../src/utils/svg', () => ({ downloadBlob: download }));
let images, encode, context;
beforeEach(() => {
  images = []; encode = null; download.mockReset();
  context = { measureText: text => ({ width: [...text].length * 8 }), drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) { encode = { cb, canvas: this }; });
  vi.stubGlobal('Image', class { constructor() { images.push(this); } });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:chart'), revokeObjectURL: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const chart = () => new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 405 385"><line x1="55" x2="355" y1="325" y2="25" stroke="currentColor"/><circle cx="200" cy="155" r="3"/><text data-export-label="Original (unit below)">very long unit</text></svg>', 'image/svg+xml').documentElement;
const capture = () => captureChartPng(chart(), { title: 'Synthetic chart', lines: ['Exact unit: <g/t> & raw 0.000', 'x'.repeat(400)], filename: 'chart.png' });

it('freezes exact plotted geometry, wraps all metadata, escapes text and uses a white portable SVG', () => {
  const svg = chart(), result = captureChartPng(svg, { title: 'A', lines: ['Exact unit: <g/t> & raw 0.000', 'x'.repeat(400)], filename: 'a.png' });
  svg.querySelector('circle').setAttribute('cx', '999');
  const doc = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  expect(doc.querySelector('circle').getAttribute('cx')).toBe('200');
  expect(doc.querySelector('line').getAttribute('y1')).toBe('325');
  expect(doc.querySelector('rect').getAttribute('fill')).toBe('#fff');
  expect(doc.querySelector('svg svg').getAttribute('color')).toBe('#172033');
  expect(doc.querySelector('svg svg').textContent).toBe('Original (unit below)');
  const metadata = [...doc.documentElement.children].filter(el => el.tagName === 'text').map(el => el.textContent).join('');
  expect(metadata).toBe('AExact unit: <g/t> & raw 0.000' + 'x'.repeat(400));
  expect(result.width).toBe(1920); expect(result.height).toBeLessThanOrEqual(4096);
});

it('keeps exact selected scope, history and excluded counts without analytical-date claims', () => {
  const lines = chartProvenance({ scope: { propertyId: 'p', batchId: 'b', labId: 'L', labBatchId: 'J', crmId: 'CRM', crmRevision: 'r', element: 'Au', unit: 'g/t' }, eligibleCount: 3, selectedCount: 4, excludedCount: 1 }, { submittedCount: 9, loadedWrittenCount: 4, retrievedAt: 'retrieved', rolledBackAt: 'rollback', requestHash: 'hash', provenance: { filename: 'file.csv', sha256: 'sha' } }, 'Property A').join('\n');
  expect(lines).toContain('Property: Property A | ID: p'); expect(lines).toContain('CRM CRM | revision r');
  expect(lines).toContain('3 assessed / 4 selected; 1 unassessed'); expect(lines).toContain('4 records written / 9 rows submitted');
  expect(lines).toContain('Rolled back: rollback'); expect(lines).toContain('retrieved (not an analysis date)');
  expect(lines).toContain('not a full-file, whole-job or current-property report'); expect(lines).toContain('Request fingerprint: hash');
});

it('fails explicitly for absent charts or labels beyond bounded canvas capacity without truncation', () => {
  expect(() => captureChartPng(null, {})).toThrow('No chart');
  expect(() => captureChartPng(chart(), { title: 'A', lines: ['x'.repeat(30000)] })).toThrow('No labels were omitted');
});

it('downloads captured PNG only after encoding and releases resources', async () => {
  const result = capture(), promise = downloadChartPng(result);
  images[0].onload(); await Promise.resolve(); expect(download).not.toHaveBeenCalled();
  const blob = new Blob(['png'], { type: 'image/png' }); encode.cb(blob); await promise;
  expect(download).toHaveBeenCalledWith('chart.png', blob); expect(context.drawImage).toHaveBeenCalled();
  expect(encode.canvas.width).toBe(0); expect(encode.canvas.height).toBe(0); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:chart');
});

it.each(['decode', 'encode'])('cancels a stale snapshot during %s, with no download', async stage => {
  let current = true; const promise = downloadChartPng(capture(), () => current);
  const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  if (stage === 'decode') current = false;
  images[0].onload(); await Promise.resolve();
  if (stage === 'encode') { current = false; encode.cb(new Blob(['png'])); }
  await rejected; expect(download).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).toHaveBeenCalled();
});

it('reports image and encoding failures without downloading', async () => {
  let promise = downloadChartPng(capture()); const first = expect(promise).rejects.toThrow('Could not render'); images[0].onerror(); await first;
  promise = downloadChartPng(capture()); const second = expect(promise).rejects.toThrow('Could not encode'); images[1].onload(); await Promise.resolve(); encode.cb(null); await second;
  expect(download).not.toHaveBeenCalled(); expect(encode.canvas.width).toBe(0);
});


it('pads crowded vertical titles only in the PNG without moving live or captured data', () => {
  const svg = chart(), label = svg.querySelector('text'); label.setAttribute('transform', 'translate(13 175) rotate(-90)'); label.setAttribute('data-export-transform', 'translate(-8 175) rotate(-90)');
  const captured = captureChartPng(svg, { title: 'Scatter', lines: [], filename: 'scatter.png' });
  const doc = new DOMParser().parseFromString(captured.svg, 'image/svg+xml');
  expect(svg.getAttribute('viewBox')).toBe('0 0 405 385'); expect(label.getAttribute('transform')).toBe('translate(13 175) rotate(-90)');
  expect(doc.querySelector('svg svg').getAttribute('viewBox')).toBe('-24 0 429 385');
  expect(doc.querySelector('[data-export-transform]').getAttribute('transform')).toBe('translate(-8 175) rotate(-90)');
  expect(doc.querySelector('circle').getAttribute('cx')).toBe('200'); expect(doc.querySelector('line').getAttribute('y1')).toBe('325');
});
