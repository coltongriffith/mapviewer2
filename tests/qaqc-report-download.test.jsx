import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import QaqcReportDownload from '../src/components/workspace/QaqcReportDownload';
import { analyzeDuplicateSnapshot } from '../shared/qaqcDuplicates';
const { pdf } = vi.hoisted(() => ({ pdf: vi.fn() }));
vi.mock('../src/utils/qaqcReportPdf', () => ({ downloadQaqcReportPdf: pdf }));
let current;
beforeEach(() => {
  current = true; pdf.mockReset().mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: text => ({ width: [...text].length * 5 }) });
});
afterEach(() => vi.restoreAllMocks());
function props(count = 1, censored = false) {
  const scope = { propertyId: 'p', batchId: 'b', sampleType: 'field_dup', labId: 'L', labBatchId: 'J', element: 'Au', unit: 'g/t' };
  const record = (id, type, value) => ({ sample_id: id, sample_type: type, lab_id: 'L', lab_batch_id: 'J', values: { Au: value }, units: { Au: 'g/t' }, raw_values: { Au: `${value}.000` }, bdl: {} });
  const snapshot = { scope, complete: true,
    records: Array.from({ length: count }, (_, i) => ({ id: `version-${i}`, property_id: 'p', batch_id: 'b', source_row: i + 1, parent_version_id: 'parent', record: { ...record(`D-${i}`, 'field_dup', 110), parent_sample_id: 'P' } })),
    parents: [{ id: 'parent', property_id: 'p', batch_id: 'old', source_row: 1, record: record('P', 'routine', 90) }] };
  if (censored) for (const row of snapshot.records) { row.record.raw_values.Au = 'ND'; row.record.bdl.Au = 0.005; }
  const analysis = analyzeDuplicateSnapshot(snapshot);
  snapshot.manifest = { scope, population: 'written_import_rows', currentStateClaimed: false, statusRefreshed: true, referenceReadsComplete: true,
    expectedWrittenCount: count, loadedWrittenCount: count, selectedCount: count, submittedCount: count + 3, provenance: { filename: 'synthetic.csv' }, requestHash: 'hash', retrievedAt: '2026-10-23T12:00:00Z', rolledBackAt: null };
  const holder = document.createElement('div');
  if (!censored) holder.innerHTML = '<svg viewBox="0 0 405 385"><circle cx="100" cy="200" r="3"/></svg>';
  return { kind: 'duplicates', snapshot, analysis, propertyName: 'Synthetic property', chartRefs: { scatter: { current: holder }, hard: { current: holder } }, captureCurrent: () => () => current };
}

it('synchronously freezes every selected row beyond UI pagination before the lazy renderer awaits', async () => {
  const input = props(51); let finish; pdf.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<QaqcReportDownload {...input} />); fireEvent.click(screen.getByRole('button'));
  input.snapshot.records[50].record.raw_values.Au = 'MUTATED'; input.snapshot.manifest.provenance.filename = 'MUTATED';
  input.chartRefs.scatter.current.querySelector('circle').setAttribute('cx', '999');
  await waitFor(() => expect(pdf).toHaveBeenCalledTimes(1));
  const capture = pdf.mock.calls[0][0], text = capture.layout.pages.flatMap(page => page.commands.filter(c => c.kind === 'text').map(c => c.text)).join('\n');
  expect(text).toContain('D-0'); expect(text).toContain('D-25'); expect(text).toContain('D-50'); expect(text).toContain('synthetic.csv'); expect(text).not.toContain('MUTATED');
  expect(capture.charts.scatter.svg).toContain('cx="100"'); expect(capture.filename).toBe('qaqc-duplicates-b.pdf');
  await act(async () => finish()); expect(screen.getByRole('button')).toBeEnabled();
});

it('does not start a lazy render after the comparison is invalidated during capture', async () => {
  render(<QaqcReportDownload {...props()} />);
  act(() => { screen.getByRole('button').click(); current = false; });
  await act(async () => {}); expect(pdf).not.toHaveBeenCalled();
});

it('passes validity through later scope changes and unmount, with no stale progress update', async () => {
  let finish; pdf.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const ui = render(<QaqcReportDownload {...props()} />); fireEvent.click(screen.getByRole('button')); await waitFor(() => expect(pdf).toHaveBeenCalled());
  const options = pdf.mock.calls[0][1]; expect(options.isCurrent()).toBe(true);
  act(() => options.onProgress({ page: 2, total: 5 })); expect(screen.getByRole('status')).toHaveTextContent('page 2 of 5');
  ui.unmount(); expect(options.isCurrent()).toBe(false); await act(async () => { options.onProgress({ page: 3, total: 5 }); finish(); });
});

it('allows complete evidence-only PDFs and refuses zero selected controls', async () => {
  const ui = render(<QaqcReportDownload {...props(2, true)} />); expect(screen.getByText(/no assessed chart is available/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button')); await waitFor(() => expect(pdf).toHaveBeenCalled());
  expect(pdf.mock.calls[0][0].charts).toEqual({}); expect(pdf.mock.calls[0][0].layout.pages.flatMap(page => page.commands).some(c => c.kind === 'chart')).toBe(false);
  await waitFor(() => expect(screen.getByRole('button')).toBeEnabled()); ui.unmount();
  render(<QaqcReportDownload {...props(0)} />); expect(screen.queryByRole('button')).toBeNull(); expect(screen.getByText(/No selected controls/)).toBeTruthy();
});

it('keeps a failed export retryable without falling back to a partial report', async () => {
  pdf.mockRejectedValueOnce(new Error('PDF size limit reached. No report downloaded.')).mockResolvedValueOnce();
  render(<QaqcReportDownload {...props()} />); fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('No report downloaded'); expect(screen.getByRole('button')).toBeEnabled();
  fireEvent.click(screen.getByRole('button')); await waitFor(() => expect(pdf).toHaveBeenCalledTimes(2)); await waitFor(() => expect(screen.getByRole('button')).toBeEnabled()); expect(screen.queryByRole('alert')).toBeNull();
});
