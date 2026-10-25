import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Importer } from '../src/components/workspace/DrillPanel.jsx';
vi.mock('../src/lib/supabase', () => ({ supabase: null }));

it('explains a saved template CRS mismatch and preserves the new file source', async () => {
  const dryRun = vi.fn(async () => ({ ok: true, new: 1 }));
  render(<Importer property={{ id: 'synthetic', crs: 'EPSG:26910' }} orgId="fixture" onDone={() => {}} db={{ dryRun, templates: async () => [{ id: 't', name: 'Old NAD27 columns', mapping: { columns: { hole_id: 'HoleID', x: 'Easting', y: 'Northing' }, crs: 'EPSG:26710' } }] }} />);
  fireEvent.change(screen.getByLabelText('Drill data file'), { target: { files: [{ name: 'synthetic-collars.csv', size: 100, text: async () => 'HoleID,Easting,Northing\nSYNTHETIC-01,512345.678,5432109.876' }] } });
  await screen.findByRole('option', { name: 'Old NAD27 columns' });
  fireEvent.change(screen.getByLabelText('Saved columns'), { target: { value: 't' } });
  expect(screen.getByRole('status')).toHaveTextContent('Columns applied; the source CRS stays EPSG:26910. This template used EPSG:26710');
  expect(screen.getByLabelText('Source coordinate system')).toHaveValue('EPSG:26910');
  fireEvent.click(screen.getByRole('button', { name: 'Check against stored data' }));
  await waitFor(() => expect(dryRun).toHaveBeenCalledOnce());
  expect(dryRun.mock.calls[0][0].rows).toEqual([{ hole_id: 'SYNTHETIC-01', x: 512345.678, y: 5432109.876, crs: 'EPSG:26910' }]);
});

const csv = { name: 'synthetic-collars.csv', size: 100, text: async () => 'HoleID,Easting,Northing\nSYNTHETIC-01,512345.678,5432109.876' };
// No jurisdiction: no grid is chosen, so the 3-parameter fallback applies (no grid fetch here).
const openConverted = async (dryRun) => {
  render(<Importer property={{ id: 'synthetic', crs: 'EPSG:26910', jurisdiction: null }} orgId="fixture" onDone={() => {}} db={{ dryRun, templates: async () => [] }} />);
  fireEvent.change(screen.getByLabelText('Drill data file'), { target: { files: [csv] } });
  fireEvent.change(await screen.findByLabelText('Source coordinate system'), { target: { value: 'EPSG:26710' } });
  fireEvent.click(screen.getByLabelText(/Convert X\/Y to the property’s EPSG:26910/));
  fireEvent.click(await screen.findByLabelText(/I accept converted positions/));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check against stored data' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Check against stored data' }));
};

it('requires acknowledging the fallback warning, then sends converted rows with their originals', async () => {
  const dryRun = vi.fn(async () => ({ ok: true, new: 1, changed: 0, unchanged: 0, source_coordinates: 1 }));
  render(<Importer property={{ id: 'synthetic', crs: 'EPSG:26910', jurisdiction: null }} orgId="fixture" onDone={() => {}} db={{ dryRun, templates: async () => [] }} />);
  fireEvent.change(screen.getByLabelText('Drill data file'), { target: { files: [csv] } });
  fireEvent.change(await screen.findByLabelText('Source coordinate system'), { target: { value: 'EPSG:26710' } });
  fireEvent.click(screen.getByLabelText(/Convert X\/Y to the property’s EPSG:26910/));
  expect(await screen.findByText(/NAD27→NAD83 without a grid shift can be off by up to ~50 m/)).toHaveTextContent('no national grid is chosen');
  expect(screen.getByRole('button', { name: 'Check against stored data' })).toBeDisabled();
  cleanup();
  await openConverted(dryRun);
  await waitFor(() => expect(dryRun).toHaveBeenCalledOnce());
  const { rows: [row], mapping } = dryRun.mock.calls[0][0];
  expect(row).toMatchObject({ hole_id: 'SYNTHETIC-01', crs: 'EPSG:26910', x_src: 512345.678, y_src: 5432109.876, crs_src: 'EPSG:26710', transform: { method: 'helmert', expected_error_m: 50 } });
  expect(Math.hypot(row.x - 512345.678, row.y - 5432109.876)).toBeGreaterThan(50);
  expect(mapping.coordinateSource).toMatchObject({ operation: 'convert', crs: 'EPSG:26710', target: 'EPSG:26910', acknowledged: true, methods: { helmert: 1 } });
  expect(await screen.findByRole('button', { name: 'Commit import' })).toBeEnabled();
});

it('keeps the source values with a notice when the database lacks the source-coordinate columns', async () => {
  const dryRun = vi.fn(async () => ({ ok: true, new: 1, changed: 0, unchanged: 0 }));
  await openConverted(dryRun);
  expect(await screen.findByText(/cannot store converted coordinates with their originals yet, so nothing was converted/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Convert X\/Y/)).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Check against stored data' }));
  await waitFor(() => expect(dryRun).toHaveBeenCalledTimes(2));
  expect(dryRun.mock.calls[1][0].rows).toEqual([{ hole_id: 'SYNTHETIC-01', x: 512345.678, y: 5432109.876, crs: 'EPSG:26710' }]);
  expect(dryRun.mock.calls[1][0].mapping.coordinateSource).toEqual({ version: 1, crs: 'EPSG:26710', operation: 'preserve-source', axisOrder: 'xy' });
});
