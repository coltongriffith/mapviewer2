import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import QaqcBlankView from '../src/components/workspace/QaqcBlankView';
import QaqcPanel from '../src/components/workspace/QaqcPanel';
const { load, discover, records, batches, capture, png } = vi.hoisted(() => ({ load: vi.fn(), discover: vi.fn(), records: vi.fn(), batches: vi.fn(), capture: vi.fn(), png: vi.fn() }));
vi.mock('../src/utils/qaqcChartPng', async original => ({ ...(await original()), captureChartPng: capture, downloadChartPng: png }));
vi.mock('../src/utils/drillQaqcSnapshot', () => ({ loadBlankSnapshot: load, discoverBlankGroups: discover }));
vi.mock('../src/utils/drillQaqcDb', async original => ({ ...(await original()), listQaqcRecords: records, listQaqcBatches: batches }));
vi.mock('../src/lib/supabase', () => ({ supabase: null }));
const scope = { propertyId: 'p', batchId: 'b', sampleType: 'blank', labId: 'L', labBatchId: 'J', element: 'Au', unit: 'g/t' };
const client = {};
// Synthetic blanks: 0.004 pass, 0.02 (4× DL) passes at 5× but fails at 3×, 0.04 fails, ND passes censored.
function snapshot(values = [0.004, 0.02, null, 0.04]) {
  return { scope, complete: true,
    records: values.map((value, i) => ({ id: `s${i}`, property_id: 'p', batch_id: 'b', source_row: 2 * i + 1,
      record: { sample_id: `BLK-${i}`, sample_type: 'blank', lab_id: 'L', lab_batch_id: 'J', values: { Au: value }, units: { Au: 'g/t' },
        raw_values: { Au: value === null ? '<0.005' : String(value) }, bdl: value === null ? { Au: 0.005 } : {} } })),
    manifest: { submittedCount: values.length + 5, loadedWrittenCount: values.length, provenance: { filename: 'synthetic.csv', sha256: 'hash' }, requestHash: 'request', retrievedAt: '2026-10-23T12:00:00Z', rolledBackAt: null },
  };
}
beforeEach(() => {
  vi.resetAllMocks(); discover.mockResolvedValue({ complete: true, groups: [scope, { ...scope, unit: 'ppm' }] });
  load.mockResolvedValue(snapshot()); records.mockResolvedValue({ rows: [], next: null }); batches.mockResolvedValue({ rows: [], next: null });
});
const view = props => <QaqcBlankView client={client} propertyId="p" batchId="b" onClose={() => {}} {...props} />;
async function choose(choice = '0') { fireEvent.change(await screen.findByLabelText('Comparison group'), { target: { value: choice } }); }

it('plots blanks against the recorded limit and a configurable 3–10× threshold, listing failures', async () => {
  render(view()); await screen.findByLabelText('Comparison group'); expect(load).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Compare blanks' })).toHaveFocus();
  expect(screen.getByRole('option', { name: 'Blanks · L / J · Au (g/t)' })).toBeTruthy();
  await choose(); await screen.findByText('4 assessed / 4 selected blanks');
  const threshold = screen.getByLabelText('Blank threshold');
  expect(threshold).toHaveValue('5'); expect(within(threshold).getAllByRole('option').map(o => o.value)).toEqual(['3', '4', '5', '6', '7', '8', '9', '10']);
  const plot = screen.getByRole('img', { name: /Blank threshold plot, 4 assessed blanks in g\/t, by submitted row. Threshold 5 times/ });
  expect(plot.querySelectorAll('[data-outcome="pass"]')).toHaveLength(2); expect(plot.querySelectorAll('[data-outcome="censored"]')).toHaveLength(1);
  expect(plot.querySelectorAll('rect[data-outcome="fail"]')).toHaveLength(1); expect(plot).toHaveTextContent('Submitted row (not analysis order)');
  expect(plot.outerHTML).not.toMatch(/NaN|Infinity/);
  expect(screen.getByText(/no analytical order is implied/)).toBeTruthy();
  const failures = screen.getByRole('region', { name: 'Blanks above threshold' });
  expect(within(failures).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Row 7 · BLK-3: 0.04 g/t is 8 × the detection limit 0.005 g/t (threshold 0.025 g/t)']);
  const table = screen.getByRole('table', { name: 'Blanks comparison data' });
  expect(within(table).getByText('<0.005 g/t (below detection; recorded limit 0.005 g/t)')).toBeTruthy();
  expect(within(table).getByText('Pass (below detection; censored)')).toBeTruthy();
  expect(within(table).getAllByText('Recorded for this laboratory job')).toHaveLength(3);
  fireEvent.change(threshold, { target: { value: '3' } });
  expect(within(screen.getByRole('region', { name: 'Blanks above threshold' })).getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('img', { name: /Threshold 3 times/ })).toBeTruthy();
  fireEvent.change(threshold, { target: { value: '10' } });
  expect(screen.queryByRole('region', { name: 'Blanks above threshold' })).toBeNull();
  expect(screen.getByText('Above threshold (fail): 0/4 (0%)')).toBeTruthy();
  expect(load.mock.calls[0][1]).toEqual(scope);
});

it('leaves detected blanks without a recorded limit unassessed and offers no chart', async () => {
  load.mockResolvedValue(snapshot([0.004, 0.04])); render(view()); await choose();
  await screen.findByText('0 assessed / 2 selected blanks');
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('button', { name: 'Download Blank threshold comparison PNG' })).toBeDisabled();
  expect(within(screen.getByRole('table')).getAllByText(/Unassessed: No detection limit is recorded/)).toHaveLength(2);
  expect(screen.getAllByText('Not recorded')).toHaveLength(2);
});

it('shows no partial statistics for incomplete snapshots', async () => {
  load.mockResolvedValue({ ...snapshot(), complete: false, issues: [{ message: 'Read interrupted' }] });
  render(view()); await choose(); expect(await screen.findByRole('alert')).toHaveTextContent('Read interrupted');
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.queryByRole('table')).toBeNull();
});

it('captures the PNG with threshold and provenance labels and invalidates it on close', async () => {
  let resolve; capture.mockReturnValue({ svg: 'frozen' }); png.mockReturnValue(new Promise(r => { resolve = r; }));
  render(view({ propertyName: 'Synthetic property' })); await choose(); await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: 'Download Blank threshold comparison PNG' }));
  expect(capture.mock.calls[0][0]).toBe(screen.getByRole('img'));
  const lines = capture.mock.calls[0][1].lines.join(' ');
  expect(lines).toContain('threshold 5 × detection limit = 0.025 g/t'); expect(lines).toContain('Above threshold: 1/4');
  expect(lines).toContain('Property: Synthetic property | ID: p'); expect(lines).toContain('Historical written-import subset only');
  const current = png.mock.calls[0][1]; expect(current()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Back to QA/QC' })); expect(current()).toBe(false); await act(async () => resolve());
});

it('offers blanks alongside duplicates and standards and restores focus to its entry', async () => {
  batches.mockResolvedValue({ rows: [{ id: 'b', kind: 'samples', provenance: { filename: 'synthetic.csv' }, summary: { new: 4, changed: 0 }, depends_on: [] }], next: null });
  render(<QaqcPanel property={{ id: 'p' }} perms={{ edit: false }} client={client} />);
  const button = await screen.findByRole('button', { name: 'Compare blanks' });
  expect(screen.getByRole('button', { name: 'Compare duplicates' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Compare standards' })).toBeTruthy();
  fireEvent.click(button); await screen.findByLabelText('Comparison group');
  fireEvent.click(screen.getByRole('button', { name: 'Back to QA/QC' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Compare blanks' })).toHaveFocus());
});
