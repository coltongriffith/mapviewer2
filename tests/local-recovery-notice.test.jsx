import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LocalRecoveryNotice from '../src/components/LocalRecoveryNotice.jsx';
import { getRecoveryInfo, listProjects, loadDraft } from '../src/utils/projectStorage';
import { downloadBlob } from '../src/utils/svg';

vi.mock('../src/utils/svg', () => ({ downloadBlob: vi.fn() }));
const PROJECTS = 'mapviewer.projects.v1', DRAFT = 'mapviewer.draft.v1';
const raw = { [PROJECTS]: 'gz1:corrupt-saved-maps\r\nQA', [DRAFT]: 'gz1:corrupt-draft-é-\u0000' };
function seed() {
  for (const [key, value] of Object.entries(raw)) localStorage.setItem(key, value);
  listProjects(); loadDraft(); return getRecoveryInfo();
}
const snapshot = () => Object.fromEntries([PROJECTS, DRAFT].flatMap(key => [key, key + '.recovery']).map(key => [key, localStorage.getItem(key)]));
const text = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onerror = reject; r.onload = () => resolve(new TextDecoder('utf-8', { ignoreBOM: true }).decode(r.result)); r.readAsArrayBuffer(blob); });
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); downloadBlob.mockResolvedValue(undefined); });

describe('non-destructive local recovery downloads', () => {
  it('adds nothing for healthy storage or unknown record keys', () => {
    const view = render(<LocalRecoveryNotice records={[]} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('region')).toBeNull();
    view.rerender(<LocalRecoveryNotice records={[{ key: 'constructor' }, { key: 'other-key' }]} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('region')).toBeNull();
  });
  it('downloads both exact preserved raw strings with safe distinct filenames and leaves all storage intact', async () => {
    const records = seed(), before = snapshot();
    render(<LocalRecoveryNotice records={records} onDismiss={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Local data recovery' })).toBeInTheDocument();
    for (const [label, key, file] of [['saved maps', PROJECTS, 'saved-maps'], ['draft', DRAFT, 'draft']]) {
      fireEvent.click(screen.getByRole('button', { name: `Download ${label} recovery copy` }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('download started'));
      const [filename, blob] = downloadBlob.mock.calls.at(-1);
      expect(filename).toBe(`exploration-maps-${file}-recovery.txt`);
      expect(await text(blob)).toBe(raw[key]); expect(blob.type).toBe('text/plain;charset=utf-8');
      expect(snapshot()).toEqual(before);
    }
    expect(screen.getByText(/not a repaired map/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete|remove|repair|import/i })).toBeNull();
  });
  it('exposes pending status, disables duplicate actions and recovers from download failure without writing data', async () => {
    const records = seed(), before = snapshot(); let fail;
    downloadBlob.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    render(<LocalRecoveryNotice records={records} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download draft recovery copy' }));
    expect(screen.getByRole('status')).toHaveTextContent('Preparing');
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Download saved maps recovery copy' })).toBeDisabled();
    await act(async () => fail(new Error('Synthetic download refusal')));
    expect(screen.getByText(/Synthetic download refusal/)).toHaveAttribute('role', 'alert');
    expect(snapshot()).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: 'Download draft recovery copy' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('download started'));
    expect(snapshot()).toEqual(before);
  });
  it('reports a missing preserved copy rather than downloading an empty replacement', async () => {
    const records = seed(); localStorage.removeItem(DRAFT + '.recovery'); const before = snapshot();
    render(<LocalRecoveryNotice records={records} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download draft recovery copy' }));
    await screen.findByText(/preserved copy is unavailable/);
    expect(downloadBlob).not.toHaveBeenCalled(); expect(snapshot()).toEqual(before);
  });
  it('refuses lossy encoding of malformed text while keeping the exact original code units', async () => {
    const records = seed(), malformed = 'gz1:' + String.fromCharCode(0xd800);
    localStorage.setItem(DRAFT + '.recovery', malformed); const before = snapshot();
    render(<LocalRecoveryNotice records={records} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download draft recovery copy' }));
    await screen.findByText(/without changing its contents/);
    expect(downloadBlob).not.toHaveBeenCalled(); expect(snapshot()).toEqual(before);
  });
  it('preserves a leading UTF-8 BOM instead of treating it as lossy encoding', async () => {
    const bom = '\uFEFF{"synthetic":"BOM corruption fixture"}';
    localStorage.setItem(DRAFT, bom); expect(loadDraft()).toBeNull();
    const records = getRecoveryInfo(), before = snapshot();
    render(<LocalRecoveryNotice records={records} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download draft recovery copy' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('download started'));
    const [filename, blob] = downloadBlob.mock.calls[0];
    expect(filename).toBe('exploration-maps-draft-recovery.txt');
    expect(await text(blob)).toBe(bom);
    const reader = new FileReader();
    const bytes = await new Promise((resolve) => { reader.onload = () => resolve(new Uint8Array(reader.result)); reader.readAsArrayBuffer(blob); });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(snapshot()).toEqual(before);
  });
  it('dismisses only the notice and never removes or rewrites preserved data', () => {
    const records = seed(), before = snapshot(), dismiss = vi.fn();
    render(<LocalRecoveryNotice records={records} onDismiss={dismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss recovery notice' }));
    expect(dismiss).toHaveBeenCalledOnce(); expect(snapshot()).toEqual(before);
  });
});
