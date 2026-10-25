import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import QaqcCrmView from '../src/components/workspace/QaqcCrmView';
import QaqcPanel from '../src/components/workspace/QaqcPanel';
const { load, discover, records, batches, capture, png } = vi.hoisted(() => ({ load: vi.fn(), discover: vi.fn(), records: vi.fn(), batches: vi.fn(), capture: vi.fn(), png: vi.fn() }));
vi.mock('../src/utils/qaqcChartPng', async original => ({ ...(await original()), captureChartPng: capture, downloadChartPng: png }));
vi.mock('../src/utils/drillQaqcSnapshot', () => ({ loadCrmSnapshot: load, discoverCrmGroups: discover }));
vi.mock('../src/utils/drillQaqcDb', async original => ({ ...(await original()), listQaqcRecords: records, listQaqcBatches: batches }));
vi.mock('../src/lib/supabase', () => ({ supabase: null }));
const scope = { propertyId: 'p', batchId: 'b', labId: 'L', labBatchId: 'J', crmId: 'CRM', crmRevision: 'rev-01', element: 'Au', unit: 'g/t' };
const client = {};
function snapshot(count = 4) {
  return { scope, complete: true,
    records: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, property_id: 'p', batch_id: 'b', source_row: 2 * i + 1, crm_version_ids: ['crm-old'],
      record: { sample_id: `000${i}`, sample_type: 'standard', lab_id: 'L', lab_batch_id: 'J', crm_id: 'CRM', crm_revision: 'rev-01',
        values: { Au: i === 1 ? 0 : i === 2 ? null : 15 }, units: { Au: 'g/t' }, raw_values: { Au: i === 1 ? '0.000' : i === 2 ? 'ND' : '15.000' }, bdl: i === 2 ? { Au: 0.005 } : {} } })),
    crms: [{ id: 'crm-old', property_id: 'p', batch_id: 'crm-import', source_row: 2, record: { crm_id: 'CRM', revision: 'rev-01', element: 'Au', unit: 'g/t', expected: 10, sd: 2, source: 'Synthetic reference only' } }],
    manifest: { submittedCount: count + 5, loadedWrittenCount: count, provenance: { filename: 'synthetic.csv', sha256: 'hash' }, requestHash: 'request', retrievedAt: '2026-10-23T12:00:00Z', rolledBackAt: '2026-10-23T11:00:00Z' },
  };
}
beforeEach(() => {
  vi.resetAllMocks(); discover.mockResolvedValue({ complete: true, groups: [scope, { ...scope, unit: 'ppm' }] });
  load.mockResolvedValue(snapshot()); records.mockResolvedValue({ rows: [], next: null }); batches.mockResolvedValue({ rows: [], next: null });
});
const view = props => <QaqcCrmView client={client} propertyId="p" batchId="b" onClose={() => {}} {...props} />;
async function choose(choice = '0') { fireEvent.change(await screen.findByLabelText('Comparison group'), { target: { value: choice } }); }

it('requires a populated group choice and presents supplied-reference evidence with disjoint denominators', async () => {
  render(view()); await screen.findByLabelText('Comparison group'); expect(load).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Compare standards' })).toHaveFocus();
  expect(screen.getByRole('option', { name: 'CRM (rev-01) · L / J · Au (g/t)' })).toBeTruthy();
  await choose(); await screen.findByText('3 assessed / 4 selected standards');
  expect(screen.getByText(/9 rows submitted; 4 records written/)).toHaveTextContent('rolled back');
  const plot = screen.getByRole('img', { name: /CRM reference plot, 3 assessed/ });
<<<<<<< HEAD
  expect(plot.querySelector('polyline')).toBeNull(); expect(plot.querySelectorAll('circle')).toHaveLength(2);
  expect(plot.querySelectorAll('rect[data-rule="fail"]')).toHaveLength(1);
=======
  expect(plot.querySelector('polyline')).toBeNull(); expect(plot.querySelectorAll('circle')).toHaveLength(3);
>>>>>>> origin/main
  expect(plot.querySelectorAll('line')).toHaveLength(5); expect(plot).toHaveTextContent('Submitted row (not analysis order)');
  const table = screen.getByRole('table', { name: 'Standards comparison data' });
  expect(within(table).getByText('ND g/t (below detection; recorded limit 0.005 g/t)')).toBeTruthy();
  expect(within(table).getByText('0.000 g/t')).toBeTruthy();
  expect(within(table).getAllByText('Expected 10; SD 2 g/t')).toHaveLength(4);
  expect(screen.getByText('Outside ±2, within/on ±3 supplied SD: 2/3 (66.667%)')).toBeTruthy();
  expect(screen.getByText('Outside ±3 supplied SD: 1/3 (33.333%)')).toBeTruthy();
<<<<<<< HEAD
  // Rows 1 and 7 are +2.5 SD but row 3 (-5 SD) lies between them in import order.
  expect(screen.getByText('Shewhart rule failures: 1/3 (33.333%)')).toBeTruthy();
  expect(screen.getByText('Warnings only (outside ±2 supplied SD): 2/3 (66.667%)')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Standards failing Shewhart rules' })).getByText(/Row 3 · 0001: 0.000 g\/t \(z = -5\) — Outside ±3 supplied SD/)).toBeTruthy();
  expect(screen.getByText(/import order, not analytical order/)).toBeTruthy();
  expect(within(table).getAllByText('Warning (outside ±2 supplied SD)')).toHaveLength(2);
  expect(load.mock.calls[0][1]).toEqual(scope);
});

it('fails two consecutive same-side ±2 SD standards in displayed order and shows them as failures', async () => {
  const data = snapshot(4); data.records[1].record.values.Au = 15; data.records[1].record.raw_values.Au = '15.000';
  data.records[2].record.values.Au = 5; data.records[2].record.raw_values.Au = '5.000'; data.records[2].record.bdl = {};
  load.mockResolvedValue(data); render(view()); await choose(); await screen.findByText('4 assessed / 4 selected standards');
  expect(screen.getByText('Shewhart rule failures: 2/4 (50%)')).toBeTruthy();
  const failures = screen.getByRole('region', { name: 'Standards failing Shewhart rules' });
  expect(within(failures).getAllByRole('listitem').map(li => li.textContent)).toEqual([
    'Row 1 · 0000: 15.000 g/t (z = 2.5) — Two consecutive assessed standards outside ±2 supplied SD on the same side',
    'Row 3 · 0001: 15.000 g/t (z = 2.5) — Two consecutive assessed standards outside ±2 supplied SD on the same side']);
  expect(screen.getByRole('img').querySelectorAll('rect[data-rule="fail"]')).toHaveLength(2);
});

=======
  expect(load.mock.calls[0][1]).toEqual(scope);
});

>>>>>>> origin/main
it('cancels stale selections and clears the report when deselected', async () => {
  let release; load.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  render(view()); await choose(); await choose('1'); await screen.findByRole('table');
  const stale = snapshot(); stale.records[0].record.sample_id = 'STALE';
  await act(async () => release(stale)); expect(screen.queryByText(/STALE/)).toBeNull();
  expect(load.mock.calls[0][2].signal.aborted).toBe(true);
  await choose(''); expect(screen.queryByRole('table')).toBeNull(); expect(screen.queryByRole('status')).toBeNull();
});

it('clears authenticated reports and cancels pending property loads', async () => {
  let auth, release; const unsubscribe = vi.fn();
  const signedIn = { auth: { onAuthStateChange: cb => { auth = cb; return { data: { subscription: { unsubscribe } } }; } } };
  const ui = render(view({ client: signedIn })); await choose(); await screen.findByRole('table');
  discover.mockResolvedValue({ complete: false, issues: [{ message: 'Access unavailable' }] });
  act(() => auth('SIGNED_OUT')); await screen.findByRole('alert'); expect(screen.queryByRole('table')).toBeNull();
  discover.mockResolvedValue({ complete: true, groups: [scope] });
  ui.rerender(view({ client: signedIn, propertyId: 'next' }));
  load.mockReturnValue(new Promise(resolve => { release = resolve; })); await choose();
  discover.mockResolvedValue({ complete: true, groups: [] }); ui.rerender(view({ client: signedIn, propertyId: 'third' }));
  await screen.findByText('No standard comparison groups were written by this import.');
  await act(async () => release(snapshot()));
  expect(load.mock.calls.at(-1)[2].signal.aborted).toBe(true); expect(screen.queryByRole('table')).toBeNull(); expect(unsubscribe).toHaveBeenCalled();
});

it('shows no partial statistics for incomplete snapshots', async () => {
  load.mockResolvedValue({ ...snapshot(), complete: false, issues: [{ message: 'Read interrupted' }] });
  render(view()); await choose(); expect(await screen.findByRole('alert')).toHaveTextContent('Read interrupted');
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.queryByRole('table')).toBeNull();
});

it('pages raw evidence in original submitted order and restores page on a new choice', async () => {
  load.mockResolvedValue(snapshot(51)); render(view()); await choose(); await screen.findByText('Page 1 of 2');
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(50);
  fireEvent.click(screen.getByRole('button', { name: 'Next standards' })); expect(screen.getByText('101 · 00050')).toBeTruthy();
  await choose('1'); await screen.findByText('Page 1 of 2');
});

it('keeps zero-denominator percentages unavailable and explains numerical precision exclusions', async () => {
  const data = snapshot(1); data.records[0].record.values.Au = 1e-320; data.crms[0].record.expected = 0; data.crms[0].record.sd = 1e10;
  load.mockResolvedValue(data); render(view()); await choose(); await screen.findByText('0 assessed / 1 selected standards');
<<<<<<< HEAD
  expect(screen.getAllByText(/0\/0 \(percentage unavailable\)/)).toHaveLength(6);
=======
  expect(screen.getAllByText(/0\/0 \(percentage unavailable\)/)).toHaveLength(3);
>>>>>>> origin/main
  expect(screen.getByRole('button', { name: 'Download CRM reference comparison PNG' })).toBeDisabled();
  expect(screen.queryByRole('img')).toBeNull(); expect(within(screen.getByRole('table')).getByText(/Unassessed: The score or reference bands cannot be represented/)).toBeTruthy();
});

it('renders finite linear coordinates at very small and very large scales, retaining negative bands', async () => {
  const data = snapshot(1); data.records[0].record.values.Au = 0; data.crms[0].record.expected = 0; data.crms[0].record.sd = 1e-300;
  load.mockResolvedValue(data); render(view()); await choose(); await screen.findByRole('img');
  expect(screen.getByRole('img').outerHTML).not.toMatch(/NaN|Infinity/);
  expect(screen.getByRole('img')).toHaveTextContent('lower3: -3e-300');
  data.records[0].record.values.Au = 999999999999; data.crms[0].record.sd = 999999999999;
  load.mockResolvedValue(structuredClone(data)); await choose('1');
  await waitFor(() => expect(screen.getByRole('img')).toHaveTextContent('lower3: -2999999999997'));
  expect(screen.getByRole('img').outerHTML).not.toMatch(/NaN|Infinity/);
});

it('offers both comparison types to viewers and restores focus to the standards entry', async () => {
  batches.mockResolvedValue({ rows: [{ id: 'b', kind: 'samples', provenance: { filename: 'synthetic.csv' }, summary: { new: 4, changed: 0 }, depends_on: [] }], next: null });
  render(<QaqcPanel property={{ id: 'p' }} perms={{ edit: false }} client={client} />);
  const button = await screen.findByRole('button', { name: 'Compare standards' });
  expect(screen.getByRole('button', { name: 'Compare duplicates' })).toBeTruthy();
  fireEvent.click(button); await screen.findByLabelText('Comparison group');
  expect(screen.queryByRole('button', { name: 'Roll back QA/QC import' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to QA/QC' }));
  expect(await screen.findByRole('button', { name: 'Compare standards' })).toHaveFocus();
});


it('captures the selected chart and invalidates PNG export immediately on auth change, before React commits', async () => {
  let auth, resolve; const signedIn = { auth: { onAuthStateChange: cb => { auth = cb; return { data: { subscription: { unsubscribe() {} } } }; } } };
  const frozen = { svg: 'frozen', filename: 'chart.png' }; capture.mockReturnValue(frozen); png.mockReturnValue(new Promise(r => { resolve = r; }));
  render(view({ client: signedIn, propertyName: 'Synthetic property' })); await choose(); await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: 'Download CRM reference comparison PNG' }));
  expect(capture.mock.calls[0][0]).toBe(screen.getByRole('img')); expect(capture.mock.calls[0][1].lines.join(' ')).toContain('Property: Synthetic property | ID: p');
  expect(capture.mock.calls[0][1].lines.join(' ')).toContain('3 assessed / 4 selected; 1 unassessed');
  expect(png.mock.calls[0][0]).toBe(frozen); const current = png.mock.calls[0][1]; expect(current()).toBe(true);
  act(() => { auth('SIGNED_OUT'); expect(current()).toBe(false); });
  await act(async () => resolve()); expect(screen.queryByRole('table')).toBeNull();
});

it.each(['group', 'property', 'close'])('invalidates pending PNG on %s changes', async mode => {
  let resolve; capture.mockReturnValue({ svg: 'frozen' }); png.mockReturnValue(new Promise(r => { resolve = r; }));
  const ui = render(view()); await choose(); await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: 'Download CRM reference comparison PNG' })); const current = png.mock.calls[0][1];
  if (mode === 'group') await choose('');
  if (mode === 'property') ui.rerender(view({ propertyId: 'next' }));
  if (mode === 'close') fireEvent.click(screen.getByRole('button', { name: 'Back to QA/QC' }));
  expect(current()).toBe(false); await act(async () => resolve());
});


it('keeps exact long units in PNG metadata while shortening only the exported axis label', async () => {
  const unit = 'unit-' + 'u'.repeat(115), data = snapshot(1); data.scope = { ...scope, unit };
  data.records[0].record.units.Au = unit; data.crms[0].record.unit = unit;
  discover.mockResolvedValue({ complete: true, groups: [data.scope] }); load.mockResolvedValue(data); capture.mockReturnValue({ svg: 'frozen' }); png.mockResolvedValue();
  render(view()); await choose(); await screen.findByRole('table');
  const axis = screen.getByRole('img').querySelector('[data-export-label]');
  expect(axis.textContent).toBe(`Reported value (${unit})`); expect(axis.dataset.exportLabel).toBe('Reported value (unit below)');
  fireEvent.click(screen.getByRole('button', { name: 'Download CRM reference comparison PNG' }));
  expect(capture.mock.calls[0][1].lines.join(' ')).toContain(`exact unit ${unit}`);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download CRM reference comparison PNG' })).toBeEnabled());
});

it('shows a failed PNG encode and allows retry while preserving raw evidence', async () => {
  capture.mockReturnValue({ svg: 'frozen' }); png.mockRejectedValueOnce(new Error('Could not encode this chart as PNG.')).mockResolvedValueOnce();
  render(view()); await choose(); await screen.findByRole('table');
  const button = screen.getByRole('button', { name: 'Download CRM reference comparison PNG' }); fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not encode'); expect(screen.getByRole('table')).toBeTruthy();
  fireEvent.click(button); await waitFor(() => expect(button).toBeEnabled()); expect(screen.queryByRole('alert')).toBeNull(); expect(png).toHaveBeenCalledTimes(2);
});


it('refuses a new PNG click on stale rendered data between auth invalidation and React commit', async () => {
  let auth; const signedIn = { auth: { onAuthStateChange: cb => { auth = cb; return { data: { subscription: { unsubscribe() {} } } }; } } };
  render(view({ client: signedIn })); await choose(); await screen.findByRole('table');
  const button = screen.getByRole('button', { name: 'Download CRM reference comparison PNG' });
  act(() => { auth('SIGNED_OUT'); button.click(); });
  expect(capture).not.toHaveBeenCalled(); expect(png).not.toHaveBeenCalled();
});
