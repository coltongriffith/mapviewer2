import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import DrillPanel from '../src/components/workspace/DrillPanel';

const { db } = vi.hoisted(() => ({ db: { templates: vi.fn(), dryRun: vi.fn(), commit: vi.fn(), summary: vi.fn(), rollback: vi.fn() } }));
vi.mock('../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../src/utils/drillDb', async importOriginal => ({ ...await importOriginal(), drillDb: () => db }));
vi.mock('../src/components/workspace/BatchCertificates', () => ({ default: () => null }));
const property = { id: 'property', org_id: 'org' };
const diff = { ok: true, new: 1, changed: 0, unchanged: 0 };
const csv = 'HoleID,From,To,Au_gpt\nH1,0,1,2.5';
let batches;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  batches = [{ id: 'older-batch', filename: 'older.csv', kind: 'assays', summary: diff }];
  db.templates.mockResolvedValue([]);
  db.dryRun.mockResolvedValue(diff);
  db.summary.mockImplementation(async () => ({ batches: [...batches] }));
  db.commit.mockImplementation(async () => {
    batches.push({ id: 'server-batch', filename: 'assays.csv', kind: 'assays', summary: diff });
    return { ...diff, committed: true, batch_id: 'server-batch' };
  });
  db.rollback.mockImplementation(async id => {
    batches = batches.map(b => b.id === id ? { ...b, rolled_back_at: '2026-10-27T12:00:00Z' } : b);
  });
});
async function openFile(name = 'assays.csv') {
  fireEvent.change(screen.getByLabelText('Drill data file'), { target: { files: [{ name, size: csv.length, text: async () => csv }] } });
  await screen.findByRole('form', { name: 'Import drill data' });
}
async function imported() {
  render(<DrillPanel property={property} perms={{ edit: true }} />);
  await openFile();
  fireEvent.click(screen.getByRole('button', { name: 'Check against stored data' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Commit import' }));
  await screen.findByText(/^Imported assays\.csv:/);
  await screen.findByRole('button', { name: 'Roll back assays.csv' });
}
it('removes the committed receipt only after its exact server batch rolls back', async () => {
  await imported();
  let finish;
  db.rollback.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Roll back assays.csv' }));
  expect(screen.getByText(/^Imported assays\.csv:/)).toBeVisible();
  expect(db.rollback).toHaveBeenCalledWith('server-batch');
  await act(async () => finish());
  await waitFor(() => expect(screen.queryByText(/^Imported assays\.csv:/)).toBeNull());
});
it('keeps the current receipt when a different import is rolled back', async () => {
  await imported();
  fireEvent.click(screen.getByRole('button', { name: 'Roll back older.csv' }));
  await screen.findByText(/^Rolled back /);
  expect(screen.getByText(/^Imported assays\.csv:/)).toBeVisible();
});
it('keeps the receipt when rollback fails', async () => {
  await imported();
  db.rollback.mockRejectedValueOnce(new Error('Cannot roll back while a later import depends on it.'));
  fireEvent.click(screen.getByRole('button', { name: 'Roll back assays.csv' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot roll back');
  expect(screen.getByText(/^Imported assays\.csv:/)).toBeVisible();
});
it('preserves a different in-progress import and its checked columns during rollback', async () => {
  await imported();
  await openFile('next.csv');
  fireEvent.change(screen.getByLabelText('Unit for Au_gpt'), { target: { value: 'ppm' } });
  fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Next lab mapping' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check against stored data' }));
  await screen.findByRole('button', { name: 'Commit import' });
  fireEvent.click(screen.getByRole('button', { name: 'Roll back assays.csv' }));
  await screen.findByText(/^Rolled back /);
  expect(screen.getByRole('form', { name: 'Import drill data' })).toBeVisible();
  expect(screen.getByLabelText('Unit for Au_gpt')).toHaveValue('ppm');
  expect(screen.getByLabelText('Template name')).toHaveValue('Next lab mapping');
  expect(screen.getByRole('button', { name: 'Commit import' })).toBeEnabled();
});

it('does not restore a receipt when its delayed commit response arrives after rollback, even after another rollback', async () => {
  let finish;
  batches.push({ id: 'other-batch', filename: 'other.csv', kind: 'assays', summary: diff });
  db.commit.mockImplementationOnce(() => {
    batches.push({ id: 'server-batch', filename: 'assays.csv', kind: 'assays', summary: diff });
    return new Promise(resolve => { finish = resolve; });
  });
  render(<DrillPanel property={property} perms={{ edit: true }} />);
  await openFile();
  fireEvent.click(screen.getByRole('button', { name: 'Check against stored data' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Commit import' }));
  // The server committed, but its response is delayed. A separate rollback's
  // history refresh can already discover the batch before that response.
  fireEvent.click(screen.getByRole('button', { name: 'Roll back older.csv' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Roll back assays.csv' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Roll back assays.csv' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Roll back other.csv' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Roll back other.csv' })).toBeNull());
  await act(async () => finish({ ...diff, committed: true, batch_id: 'server-batch' }));
  await screen.findByRole('button', { name: '+ Import CSV or Excel' });
  expect(screen.queryByText(/^Imported assays\.csv:/)).toBeNull();
  expect(screen.queryByRole('region', { name: 'Import certificate step' })).toBeNull();
});
