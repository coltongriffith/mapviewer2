import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import QaqcDuplicateView from '../src/components/workspace/QaqcDuplicateView';
import QaqcPanel from '../src/components/workspace/QaqcPanel';
const { load, discover, records, batches } = vi.hoisted(() => ({ load: vi.fn(), discover: vi.fn(), records: vi.fn(), batches: vi.fn() }));
vi.mock('../src/utils/drillQaqcSnapshot', () => ({ loadDuplicateSnapshot: load, discoverDuplicateGroups: discover }));
vi.mock('../src/utils/drillQaqcDb', async original => ({ ...(await original()), listQaqcRecords: records, listQaqcBatches: batches }));
vi.mock('../src/lib/supabase', () => ({ supabase: null }));
const scope = { propertyId: 'p', batchId: 'b', sampleType: 'field_dup', labId: 'L', labBatchId: 'J', element: 'Au', unit: 'g/t' };
const client = {};
function snapshot(count = 4) {
  const record = (sample_id, sample_type, value) => ({ sample_id, sample_type, lab_id: 'L', lab_batch_id: 'J', values: { Au: value }, units: { Au: 'g/t' }, raw_values: { Au: `${value}.00` }, bdl: {} });
  return { scope, complete: true,
    records: Array.from({ length: count }, (_, index) => ({ id: `d${index}`, property_id: 'p', batch_id: 'b', source_row: index + 1, parent_version_id: `r${index}`, record: { ...record(`D${index}`, 'field_dup', index === 1 || index === 2 ? 0 : 110), parent_sample_id: `P${index}` } })),
    parents: Array.from({ length: count }, (_, index) => ({ id: `r${index}`, property_id: 'p', batch_id: 'old', source_row: index + 1, record: record(`P${index}`, 'routine', index === 2 ? 0 : 90) })),
    manifest: { submittedCount: count + 5, loadedWrittenCount: count, provenance: { filename: 'synthetic.csv', sha256: 'testhash' }, requestHash: 'fingerprint', retrievedAt: '2026-10-23T12:00:00Z', rolledBackAt: '2026-10-23T11:00:00Z' },
  };
}
beforeEach(() => {
  vi.resetAllMocks(); discover.mockResolvedValue({ complete: true, groups: [scope, { ...scope, unit: 'ppm' }] });
  const data = snapshot(); data.parents[3].record.bdl.Au = 0.05; data.parents[3].record.raw_values.Au = '<0.05';
  load.mockResolvedValue(data); records.mockResolvedValue({ rows: [], next: null }); batches.mockResolvedValue({ rows: [], next: null });
});
const view = props => <QaqcDuplicateView client={client} propertyId="p" batchId="b" onClose={() => {}} {...props} />;
async function choose(index = '0') { fireEvent.change(await screen.findByLabelText('Comparison group'), { target: { value: index } }); }
it('opens deliberately with actual group choices, accurate distinct denominators and raw excluded values', async () => {
  render(view()); await screen.findByLabelText('Comparison group'); expect(load).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Compare duplicates' })).toHaveFocus();
  await choose(); await screen.findByText('2 eligible / 4 selected pairs');
  expect(screen.getByText(/Log scatter: 1 pairs/)).toBeTruthy();
  expect(screen.getByText(/9 rows submitted; 4 records written/)).toHaveTextContent('rolled back');
  expect(screen.getByRole('img', { name: /log scatter, 1 positive pairs/ })).toBeTruthy();
  const table = screen.getByRole('table', { name: 'Duplicate comparison data' });
  expect(within(table).getByText(/<0.05/)).toHaveTextContent('below detection');
  expect(within(table).getByText(/Both results are zero/)).toBeTruthy();
  expect(screen.getByText(/HARD ≤10%: 1\/2 \(50%\)/)).toBeTruthy();
  expect(screen.getByText(/not HARD thresholds/)).toBeTruthy();
  expect(load.mock.calls[0][1]).toEqual(scope);
});
it('discards older group responses and clears results when no group is selected', async () => {
  let release; load.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  render(view()); await choose(); await choose('1'); await screen.findByText('2 eligible / 4 selected pairs');
  const stale = snapshot(); stale.records[0].record.sample_id = 'STALE';
  await act(async () => release(stale)); expect(screen.queryByText(/STALE/)).toBeNull();
  expect(load.mock.calls[0][2].signal.aborted).toBe(true);
  await choose(''); expect(screen.queryByRole('table')).toBeNull(); expect(screen.queryByRole('status')).toBeNull();
});
it('abandons property/session loads and never keeps a previous authenticated report', async () => {
  let auth; const unsubscribe = vi.fn(); const authenticated = { auth: { onAuthStateChange: callback => { auth = callback; return { data: { subscription: { unsubscribe } } }; } } };
  const ui = render(view({ client: authenticated })); await choose(); await screen.findByRole('table');
  discover.mockResolvedValue({ complete: false, issues: [{ message: 'Access unavailable' }] });
  act(() => auth('SIGNED_OUT'));
  await screen.findByRole('alert'); expect(screen.queryByRole('table')).toBeNull(); expect(screen.queryByLabelText('Comparison group')).toBeNull();
  ui.rerender(view({ client: authenticated, propertyId: 'other' }));
  await waitFor(() => expect(discover.mock.calls.at(-1)[1].propertyId).toBe('other'));
  expect(unsubscribe).toHaveBeenCalled();
});
it('shows no statistics for failed reads and a clear empty group result', async () => {
  load.mockResolvedValue({ complete: false, issues: [{ message: 'Read interrupted' }] });
  const ui = render(view()); await choose(); expect(await screen.findByRole('alert')).toHaveTextContent('Read interrupted'); expect(screen.queryByRole('table')).toBeNull();
  discover.mockResolvedValue({ complete: true, groups: [] }); ui.rerender(view({ batchId: 'empty' }));
  expect(await screen.findByText('No duplicate comparison groups were written by this import.')).toBeTruthy();
});
it('cancels a pending previous-property comparison before it can populate the new view', async () => {
  let release; load.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const ui = render(view()); await choose();
  discover.mockResolvedValue({ complete: true, groups: [] }); ui.rerender(view({ propertyId: 'other' }));
  await screen.findByText('No duplicate comparison groups were written by this import.');
  await act(async () => release(snapshot()));
  expect(load.mock.calls[0][2].signal.aborted).toBe(true); expect(screen.queryByRole('table')).toBeNull();
});
it('pages every underlying pair, preserves source ordering and resets page on selection', async () => {
  load.mockResolvedValue(snapshot(51)); render(view()); await choose(); await screen.findByText('Page 1 of 2');
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(50);
  fireEvent.click(screen.getByRole('button', { name: 'Next pairs' })); expect(screen.getByText('Page 2 of 2')).toBeTruthy(); expect(screen.getByText('51 · D50')).toBeTruthy();
  await choose('1'); await screen.findByText('Page 1 of 2');
});
it('renders finite chart coordinates at register numeric extremes and no false percent for no eligible pairs', async () => {
  const data = snapshot(1); data.parents[0].record.values.Au = Number.MIN_VALUE; data.records[0].record.values.Au = 999999999999;
  load.mockResolvedValue(data); render(view()); await choose(); await screen.findByRole('table');
  expect(screen.getByRole('img', { name: /log scatter/ }).outerHTML).not.toMatch(/NaN|Infinity/);
  const zero = snapshot(1); zero.parents[0].record.values.Au = 0; zero.records[0].record.values.Au = 0;
  load.mockResolvedValue(zero); await choose('1'); await screen.findByText(/No eligible pairs; percentages are unavailable/);
  expect(screen.queryByRole('img')).toBeNull();
});
it('allows read-only sample history comparison and returns keyboard focus to its entry', async () => {
  batches.mockResolvedValue({ rows: [{ id: 'b', kind: 'samples', provenance: { filename: 'test' }, summary: { new: 4, changed: 0 }, depends_on: [] }], next: null });
  render(<QaqcPanel property={{ id: 'p' }} perms={{ edit: false }} client={client} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Compare duplicates' }));
  await screen.findByLabelText('Comparison group');
  expect(screen.queryByRole('button', { name: 'Roll back QA/QC import' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to QA/QC' }));
  expect(await screen.findByRole('button', { name: 'Compare duplicates' })).toHaveFocus();
});
