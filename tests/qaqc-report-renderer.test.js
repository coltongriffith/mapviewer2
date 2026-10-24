import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { captureQaqcReportCharts } from '../src/utils/qaqcReportCapture';
import { downloadQaqcReportPdf } from '../src/utils/qaqcReportPdf';
const { download, pdf } = vi.hoisted(() => ({ download: vi.fn(), pdf: { setProperties: vi.fn(), setCreationDate: vi.fn(), addPage: vi.fn(), addImage: vi.fn(), output: vi.fn() } }));
vi.mock('../src/utils/svg', () => ({ downloadBlob: download }));
vi.mock('jspdf', () => ({ jsPDF: class { constructor() { return pdf; } } }));
let context, canvases, images, autoImage, encodes;
beforeEach(() => {
  vi.clearAllMocks(); canvases = []; images = []; autoImage = true; encodes = [];
  context = { scale: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), measureText: text => ({ width: [...text].length * 6 }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { if (!canvases.includes(this)) canvases.push(this); return context; });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) { encodes.push(this); callback({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }); });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:chart'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('Image', class { constructor() { images.push(this); } set src(value) { this.source = value; if (value && autoImage) queueMicrotask(() => this.onload?.()); } });
  pdf.output.mockReturnValue({ size: 1024 });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const svg = () => new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 405 385"><circle cx="100" cy="200" r="3"/><text transform="translate(13 175) rotate(-90)" data-export-transform="translate(-8 175) rotate(-90)">Original &amp; raw</text></svg>', 'image/svg+xml').documentElement;
const args = (count = 3) => ({ filename: 'comparison.pdf', generatedAt: '2026-10-23T12:00:00.000Z', charts: { hard: { svg: '<svg/>', width: 405, height: 385 } }, layout: { width: 792, height: 612, pages: Array.from({ length: count }, (_, i) => ({ commands: [{ kind: 'text', text: `Evidence ${i} ND <0.005`, x: 36, y: 36, fontSize: 10 }, { kind: 'chart', key: 'hard', x: 36, y: 60, width: 300, height: 280 }] })) } });

it('captures native graph only with reviewed PNG axis padding and freezes it before later DOM changes', () => {
  const live = svg(), captured = captureQaqcReportCharts({ hard: live, scatter: null });
  live.querySelector('circle').setAttribute('cx', '999');
  const doc = new DOMParser().parseFromString(captured.hard.svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull(); expect(captured.hard.width).toBe(429); expect(captured.hard.height).toBe(385);
  expect(doc.documentElement.getAttribute('width')).toBe('858'); expect(doc.documentElement.getAttribute('viewBox')).toBe('-24 0 429 385');
  expect(doc.querySelector('circle').getAttribute('cx')).toBe('100'); expect(doc.querySelector('text').getAttribute('transform')).toBe('translate(-8 175) rotate(-90)');
  expect(doc.documentElement.textContent).toBe('Original & raw'); expect(captured.scatter).toBeUndefined();
});

it('points shortened long-unit labels to the PDF scope rather than PNG-only text below the chart', () => {
  const live = svg(); live.querySelector('text').setAttribute('data-export-label', 'Original (unit below)');
  const captured = captureQaqcReportCharts({ hard: live });
  expect(captured.hard.svg).toContain('Original (unit in scope)'); expect(live.textContent).toBe('Original & raw');
});

it('renders all pages sequentially into one canvas and downloads only the complete PDF', async () => {
  const progress = vi.fn(); await downloadQaqcReportPdf(args(), { onProgress: progress });
  expect(pdf.addImage).toHaveBeenCalledTimes(3); expect(pdf.addPage).toHaveBeenCalledTimes(2); expect(encodes[0]).toBe(encodes[2]);
  expect(context.fillText.mock.calls.map(call => call[0])).toEqual(['Evidence 0 ND <0.005', 'Evidence 1 ND <0.005', 'Evidence 2 ND <0.005']);
  expect(progress.mock.calls.map(([step]) => step.page)).toEqual([1, 2, 3]); expect(download).toHaveBeenCalledWith('comparison.pdf', { size: 1024 });
  expect(encodes[0].width).toBe(0); expect(encodes[0].height).toBe(0); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  expect(images.every(image => image.source === '')).toBe(true);
});

it('discards the accumulated document after cancellation on a later page', async () => {
  let current = true;
  await expect(downloadQaqcReportPdf(args(5), { isCurrent: () => current, onProgress: ({ page }) => { if (page === 3) current = false; } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(pdf.addImage).toHaveBeenCalledTimes(2); expect(pdf.output).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); expect(encodes[0].width).toBe(0);
});

it('checks cancellation again after image decode and releases its local URL', async () => {
  autoImage = false; let current = true; const pending = downloadQaqcReportPdf(args(1), { isCurrent: () => current });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await waitFor(() => expect(images).toHaveLength(1)); current = false; images[0].onload(); await rejected;
  expect(context.drawImage).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
});

it('cancels after page encoding before adding that page or downloading', async () => {
  let finish, current = true;
  HTMLCanvasElement.prototype.toBlob.mockImplementation(callback => { finish = callback; });
  const pending = downloadQaqcReportPdf(args(1), { isCurrent: () => current });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  current = false; finish({ arrayBuffer: async () => new ArrayBuffer(1) }); await rejected;
  expect(pdf.addImage).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); expect(canvases[0].width).toBe(0);
});

it('reports chart/encoding failures without a partial download', async () => {
  autoImage = false; let pending = downloadQaqcReportPdf(args(1)); let rejected = expect(pending).rejects.toThrow('Could not render');
  await waitFor(() => expect(images).toHaveLength(1)); images[0].onerror(); await rejected;
  autoImage = true; HTMLCanvasElement.prototype.toBlob.mockImplementation(callback => callback(null));
  pending = downloadQaqcReportPdf(args(1)); rejected = expect(pending).rejects.toThrow('Could not encode'); await rejected;
  expect(download).not.toHaveBeenCalled(); expect(canvases.every(canvas => canvas.width === 0)).toBe(true);
});

it('rejects oversized layouts before rendering and oversized output before downloading', async () => {
  await expect(downloadQaqcReportPdf(args(101))).rejects.toThrow('PDF limit'); expect(pdf.addImage).not.toHaveBeenCalled();
  pdf.output.mockReturnValue({ size: 32 * 1024 * 1024 + 1 }); await expect(downloadQaqcReportPdf(args(1))).rejects.toThrow('32 MiB'); expect(download).not.toHaveBeenCalled(); expect(encodes[0].width).toBe(0);
});

it('supports a fully laid-out evidence-only report without creating chart images', async () => {
  const input = args(1); input.layout.pages[0].commands.pop(); input.charts = {};
  await downloadQaqcReportPdf(input); expect(images).toHaveLength(0); expect(download).toHaveBeenCalledTimes(1);
});
