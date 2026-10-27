import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import NumericColumnInspector from '../src/components/NumericColumnInspector.jsx';
import * as numbers from '../src/utils/numericColumnSummary.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const makeLayer = (id = 'one') => ({ id, name: `Layer ${id}`, classification: { field: 'Old', mode: 'graduated', classes: [{ max: null }] },
  geojson: { type: 'FeatureCollection', features: [1, 2, 3, 4].map(Au => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { Au, Cu: Au * 10, Blank: null } })) } });
async function toggle(open) {
  const details = screen.getByText('Inspect numeric columns').closest('details');
  details.open = open; fireEvent(details, new Event('toggle'));
  if (open) await screen.findByLabelText('Column to inspect');
}
function choose(name) {
  fireEvent.change(screen.getByLabelText('Column to inspect'), { target: { value: screen.getByRole('option', { name, exact: true }).value } });
}
it('does no data work while closed and does not recompute on unrelated layer style/name renders', async () => {
  const scan = vi.spyOn(numbers, 'pointColumnSnapshot'), calculate = vi.spyOn(numbers, 'summarizePointColumn');
  const layer = makeLayer(), updateLayer = vi.fn(), before = JSON.stringify(layer);
  const { rerender } = render(<NumericColumnInspector layer={layer} updateLayer={updateLayer} />);
  expect(scan).not.toHaveBeenCalled(); expect(calculate).not.toHaveBeenCalled();
  await toggle(true); choose('Au');
  expect(screen.getByText('4 of 4 Point values are plain finite numbers.')).toBeInTheDocument();
  expect(within(screen.getByRole('row', { name: 'P50 2' })).getByText('2')).toBeInTheDocument();
  const calls = calculate.mock.calls.length;
  rerender(<NumericColumnInspector layer={{ ...layer, name: 'Renamed', style: { markerSize: 14 } }} updateLayer={updateLayer} />);
  expect(scan).toHaveBeenCalledTimes(1); expect(calculate).toHaveBeenCalledTimes(calls);
  choose('Cu'); expect(screen.getByRole('row', { name: 'P50 20' })).toBeInTheDocument();
  choose('Blank'); expect(screen.getByText('No plain finite numbers in this column.')).toBeInTheDocument();
  await toggle(false);
  const closedCalls = scan.mock.calls.length;
  rerender(<NumericColumnInspector layer={{ ...layer, geojson: { ...layer.geojson } }} updateLayer={updateLayer} />);
  expect(scan).toHaveBeenCalledTimes(closedCalls);
  expect(updateLayer).not.toHaveBeenCalled(); expect(JSON.stringify(layer)).toBe(before);
});
it('resets column choice on close, layer switch and source replacement without stale statistics', async () => {
  const layer = makeLayer(); const { rerender } = render(<NumericColumnInspector layer={layer} />);
  await toggle(true); choose('Au');
  rerender(<NumericColumnInspector layer={{ ...layer, geojson: { ...layer.geojson } }} />);
  expect(screen.getByLabelText('Column to inspect')).toHaveValue('');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  choose('Cu'); await toggle(false); await toggle(true);
  expect(screen.getByLabelText('Column to inspect')).toHaveValue('');
  choose('Au'); rerender(<NumericColumnInspector layer={makeLayer('two')} />);
  expect(screen.getByText('Inspect numeric columns').closest('details').open).toBe(false);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  await toggle(true); expect(screen.getByText('Layer two')).toBeInTheDocument();
  expect(screen.getByLabelText('Column to inspect')).toHaveValue('');
});
it('shows late columns and explicit scope, and handles no-Point data without hook-order changes', async () => {
  const layer = makeLayer(); layer.geojson.features = Array.from({ length: 501 }, () => layer.geojson.features[0]);
  layer.geojson.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { Late: '<1' } });
  const { rerender } = render(<NumericColumnInspector layer={layer} />);
  await toggle(true); choose('Late');
  expect(screen.getByText('Excluded: 501 blank or missing; 1 inequality-marked text; 0 other nonnumeric values.')).toBeInTheDocument();
  rerender(<NumericColumnInspector layer={{ ...layer, geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[0, 0]] } }] } }} />);
  await waitFor(() => expect(screen.getByText('No Point-record columns to inspect.')).toBeInTheDocument());
  expect(screen.getByText(/0 Point records of 1 feature records/)).toHaveTextContent('1 MultiPoint records');
});
