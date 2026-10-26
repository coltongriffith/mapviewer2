import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Importer } from '../src/components/workspace/DrillPanel.jsx';
vi.mock('../src/lib/supabase', () => ({ supabase: null }));
const diff = { ok: true, new: 1, changed: 0, unchanged: 0 };
const csv = 'HoleID,From,To,Au_gpt\nH1,0,1,2.5';
async function setup(result, kind = 'assays') {
  const done = vi.fn(), start = vi.fn();
  const commit = vi.fn(() => Promise.resolve(result));
  const db = { templates: async () => [], dryRun: async () => diff, commit };
  const ui = render(<Importer db={db} property={{ id: 'property' }} orgId="org" onDone={done} onStart={start} />);
  fireEvent.change(screen.getByLabelText('Drill data file'), { target: { files: [{ name: 'assays.csv', size: csv.length, text: async () => csv }] } });
  await screen.findByRole('form', { name: 'Import drill data' });
  if (kind !== 'assays') fireEvent.change(screen.getByLabelText('Data'), { target: { value: kind } });
  fireEvent.click(screen.getByRole('button', { name: 'Check against stored data' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Commit import' }));
  return { done, start, commit, ui };
}
it('offers the exact returned assay batch, not the generated request identity', async () => {
  const { done, start, commit } = await setup({ ...diff, committed: true, batch_id: 'server-batch' });
  await waitFor(() => expect(done).toHaveBeenCalledWith({ id: 'server-batch', filename: 'assays.csv', kind: 'assays', propertyId: 'property' }));
  expect(commit.mock.calls[0][0].batchId).not.toBe('server-batch'); expect(start).toHaveBeenCalledOnce();
});
it.each([
  { ...diff, nothing_to_do: true, committed: false },
  { ...diff, committed: true, batch_id: 'old-batch', rolled_back: true },
  { ...diff, committed: true },
  { ...diff, committed: false, batch_id: 'not-committed' },
])('does not offer attachment without a current committed batch: %j', async result => {
  const { done } = await setup(result); await waitFor(() => expect(done).toHaveBeenCalledWith(null));
});
it('ignores a stale commit after the importer unmounts', async () => {
  let resolve; const result = new Promise(r => { resolve = r; });
  const { done, commit, ui } = await setup(result);
  await waitFor(() => expect(commit).toHaveBeenCalledOnce());
  ui.unmount(); await act(async () => resolve({ ...diff, committed: true, batch_id: 'late-batch' }));
  expect(done).not.toHaveBeenCalled();
});
