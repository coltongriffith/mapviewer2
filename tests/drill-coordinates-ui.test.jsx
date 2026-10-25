import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
