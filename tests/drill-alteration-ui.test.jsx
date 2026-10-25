import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Importer } from '../src/components/workspace/DrillPanel.jsx';
import { drillDb } from '../src/utils/drillDb.js';
vi.mock('../src/lib/supabase', () => ({ supabase: null }));
const diff = { ok: true, new: 1, changed: 0, unchanged: 0 };
const csv = 'HoleID,From,To,Alteration code,Description,Intensity\n0001,0,1,03,,03';
const setup = (overrides = {}) => {
  const db = { templates: vi.fn().mockResolvedValue([]), dryRun: vi.fn().mockResolvedValue(diff), commit: vi.fn().mockResolvedValue(diff), saveTemplate: vi.fn().mockResolvedValue({}), ...overrides }, done = vi.fn();
  const ui = render(<Importer db={db} property={{ id: 'property' }} orgId="org" onDone={done} />);
  return { db, done, ui };
};
async function upload(text = csv, name = 'alteration.csv') {
  fireEvent.change(screen.getByLabelText('Drill data file'), { target: { files: [{ name, size: text.length, text: async () => text }] } });
  await screen.findByRole('form', { name: 'Import drill data' });
}
const check = () => fireEvent.click(screen.getByRole('button', { name: 'Check against stored data' }));

it('imports source intensity text, retains UUID on an uncertain retry and clears it after a mapping edit', async () => {
  const { db, done } = setup({ commit: vi.fn().mockRejectedValueOnce(new Error('Outcome unknown')).mockRejectedValueOnce(new Error('Still unknown')).mockResolvedValue(diff) });
  await upload(); expect(screen.getByLabelText('Data')).toHaveValue('alteration');
  check(); await screen.findByRole('button', { name: 'Commit import' });
  fireEvent.click(screen.getByRole('button', { name: 'Commit import' })); await screen.findByText('Outcome unknown');
  const first = db.commit.mock.calls[0][0]; expect(first.rows[0]).toMatchObject({ code: '03', intensity: '03' });
  fireEvent.click(screen.getByRole('button', { name: 'Commit import' })); await screen.findByText('Still unknown');
  expect(db.commit.mock.calls[1][0].batchId).toBe(first.batchId);
  fireEvent.change(screen.getByLabelText('Intensity (text)'), { target: { value: '' } });
  expect(screen.queryByRole('button', { name: 'Commit import' })).toBeNull();
  check(); await screen.findByRole('button', { name: 'Commit import' });
  fireEvent.click(screen.getByRole('button', { name: 'Commit import' }));
  await screen.findByText('Imported alteration.csv: 1 new alteration interval.');
  expect(db.commit.mock.calls[2][0].batchId).not.toBe(first.batchId); expect(db.commit.mock.calls[2][0].rows[0]).not.toHaveProperty('intensity'); expect(done).toHaveBeenCalledOnce();
});

it.each(['alteration', 'lithology'])('does not reinstate a stale %s preview after mapping changes', async kind => {
  let release; const { db } = setup({ dryRun: vi.fn().mockReturnValue(new Promise(resolve => { release = resolve; })) });
  await upload(); fireEvent.change(screen.getByLabelText('Data'), { target: { value: kind } });
  // Explicit alteration column is deliberately not auto-mapped as legacy lithology.
  if (kind === 'lithology') fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'Alteration code' } });
  check(); await waitFor(() => expect(db.dryRun).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } });
  await act(async () => release(diff));
  expect(screen.queryByRole('button', { name: 'Commit import' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Check against stored data' })).toBeEnabled();
});

it('ignores a late check after kind changes and after cancel, including rejected requests', async () => {
  let release, reject;
  const { db } = setup({ dryRun: vi.fn().mockReturnValueOnce(new Promise(resolve => { release = resolve; })).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; })) });
  await upload(); check(); await waitFor(() => expect(db.dryRun).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText('Data'), { target: { value: 'lithology' } });
  await act(async () => release(diff)); expect(screen.queryByRole('button', { name: 'Commit import' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Data'), { target: { value: 'alteration' } }); check();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  await act(async () => reject(new Error('Late error')));
  expect(screen.queryByText('Late error')).toBeNull(); expect(screen.getByRole('button', { name: '+ Import CSV or Excel' })).toBeEnabled();
});

it('locks submission inputs during commit and does not refresh an unmounted property afterward', async () => {
  let release; const { db, done, ui } = setup({ commit: vi.fn().mockReturnValue(new Promise(resolve => { release = resolve; })) });
  await upload(); check(); await screen.findByRole('button', { name: 'Commit import' });
  fireEvent.click(screen.getByRole('button', { name: 'Commit import' })); await waitFor(() => expect(db.commit).toHaveBeenCalledOnce());
  expect(screen.getByLabelText('Data')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  ui.unmount(); await act(async () => release(diff)); expect(done).not.toHaveBeenCalled();
});

it('keeps late alteration templates out of the lithology choice and saves only its selected kind', async () => {
  let release;
  const { db } = setup({ templates: vi.fn((_org, kind) => kind === 'alteration' ? new Promise(resolve => { release = resolve; }) : Promise.resolve([{ id: 'l', name: 'Lithology columns', kind, mapping: { columns: { code: 'Description' } } }])) });
  await upload(); await waitFor(() => expect(db.templates).toHaveBeenCalledWith('org', 'alteration'));
  fireEvent.change(screen.getByLabelText('Data'), { target: { value: 'lithology' } }); await screen.findByRole('option', { name: 'Lithology columns' });
  await act(async () => release([{ id: 'a', name: 'Alteration columns', kind: 'alteration', mapping: {} }]));
  expect(screen.queryByRole('option', { name: 'Alteration columns' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Updated columns' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save columns as template' }));
  await waitFor(() => expect(db.saveTemplate).toHaveBeenCalledWith('org', 'lithology', 'Updated columns', expect.any(Object)));
});

it('explains undeployed alteration support without preventing a legacy import check', async () => {
  const sb = { rpc: vi.fn(async (_fn, args) => args.p_kind === 'alteration' ? { error: { code: '22023', message: 'INVALID_KIND: alteration' } } : { data: diff }) };
  setup({ ...drillDb(sb), templates: vi.fn().mockResolvedValue([]) });
  await upload(); check(); await screen.findByText(/Alteration imports are not available/);
  fireEvent.change(screen.getByLabelText('Data'), { target: { value: 'lithology' } });
  fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'Alteration code' } });
  check(); await screen.findByRole('button', { name: 'Commit import' });
  expect(sb.rpc.mock.calls.at(-1)[1].p_kind).toBe('lithology');
});
