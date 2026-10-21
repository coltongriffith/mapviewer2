import { describe, it, expect, vi, beforeEach } from 'vitest';
import { init, publish, list, checkForm, banner, versionLink, today, explain, projectOf } from '../src/three-d/versions.js';

// Published figure versions, the /3d client (src/three-d/versions.js). The
// SQL is tested in figure-versions-sql.test.js, the whole flow in
// e2e/three-d-versions.spec.js.

describe('form and wording', () => {
  it('needs a label of up to 200 characters and a real date, if any', () => {
    expect(checkForm({ label: 'News release 2026-10-21', releaseDate: '2026-10-21' })).toBe('');
    expect(checkForm({ label: 'Investor deck' })).toBe('');
    expect(checkForm({ label: '   ' })).toMatch(/label/);
    expect(checkForm({ label: 'x'.repeat(201) })).toMatch(/200/);
    for (const d of ['21/10/2026', '2026-13-40', '3001-01-01', '1800-01-01']) expect(checkForm({ label: 'ok', releaseDate: d }), d).toMatch(/date/);
  });

  it('names the version on the read-only banner, with the date unless the label has it', () => {
    expect(banner({ version: 3, label: 'News release 2026-10-21', releaseDate: '2026-10-21' })).toBe('Published version 3 · News release 2026-10-21 · read-only');
    expect(banner({ version: 1, label: 'Investor deck', releaseDate: '2026-11-02' })).toBe('Published version 1 · Investor deck · 2026-11-02 · read-only');
    expect(banner({ version: 2, label: 'Draft', releaseDate: null })).toBe('Published version 2 · Draft · read-only');
  });

  it('links to a version and dates in local time', () => {
    expect(versionLink('abc-1', 3, 'https://www.explorationmaps.com')).toBe('https://www.explorationmaps.com/3d?project=abc-1&version=3');
    expect(today(new Date(2026, 9, 21, 23, 59))).toBe('2026-10-21');
    expect(today(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('puts the server refusals in plain words', () => {
    expect(explain({ message: 'VERSION_STALE: the figure was saved again since this copy was opened' }).message).toMatch(/saved somewhere else/);
    expect(explain({ message: 'VERSION_READ_ONLY: editors and up can publish a company figure' }).message).toMatch(/view-only/);
    expect(explain({ message: 'VERSION_FILES_MISSING: x is not in storage' }).message).toMatch(/Save the figure again/);
    expect(explain({ message: 'VERSION_INVALID: give the version a label of up to 200 characters' }).message).toBe('Give the version a label of up to 200 characters.');
    expect(explain({ code: 'PGRST202', message: 'Could not find the function public.publish_figure_version' }).message).toMatch(/not available/);
    expect(explain(new TypeError('Failed to fetch')).message).toMatch(/Check your connection/);
  });
});

describe('a snapshot to the figure', () => {
  const settings = { v: 1, settings: { title: 'RAILS', designVersion: 3 }, camera: { azimuth: 200, plunge: 35, zoom: 130 } };
  const blob = (t) => new Blob([t]);

  it('reads its data files from storage at the published paths, settings verbatim (the design version included)', async () => {
    const read = vi.fn(async (p) => blob(p.endsWith('collars.csv') ? 'HoleID,X\nA,1' : 'HoleID,From\nA,0'));
    const snapshot = { kind: 'figure', settings, file_paths: [{ name: 'collars.csv', path: 'u/f/r1/collars.csv', role: 'collar', cols: { id: 0 } }, { name: 'assays.csv', path: 'u/f/r1/assays.csv' }],
      files: [{ path: 'u/f/r1/collars.csv', size: 12 }, { path: 'u/f/r1/assays.csv', size: null }] };
    const p = await projectOf(snapshot, read);
    expect(read.mock.calls.map((c) => c[0])).toEqual(['u/f/r1/collars.csv', 'u/f/r1/assays.csv']);
    expect(p).toEqual({ ...settings, files: [{ name: 'collars.csv', text: 'HoleID,X\nA,1', role: 'collar', cols: { id: 0 } }, { name: 'assays.csv', text: 'HoleID,From\nA,0', role: undefined, cols: undefined }] });
    expect(p.settings.designVersion).toBe(3);
  });

  it('takes inline files as they are, and refuses a file that does not match or a snapshot that is not a figure', async () => {
    const inline = await projectOf({ kind: 'figure', settings: { ...settings, files: [{ name: 'a.csv', text: 'x' }] }, file_paths: [] }, () => { throw new Error('no storage'); });
    expect(inline.files).toEqual([{ name: 'a.csv', text: 'x' }]);
    await expect(projectOf({ kind: 'figure', settings, file_paths: [{ name: 'a.csv', path: 'p' }], files: [{ path: 'p', size: 99 }] }, async () => blob('short')))
      .rejects.toThrow(/does not match the published version/);
    await expect(projectOf({ kind: 'map', payload: {} }, async () => blob(''))).rejects.toThrow(/not a 3D figure/);
  });
});

describe('publishing from the editor', () => {
  let rpc, host;
  beforeEach(() => {
    rpc = vi.fn(async (fn) => (fn === 'publish_figure_version'
      ? { data: { id: 'v-id', version: 2, label: 'News release 2026-10-21', release_date: '2026-10-21', name: 'Rails', content_hash: 'a'.repeat(64), created_at: '2026-10-21T10:00:00Z' }, error: null }
      : { data: [{ id: 'v-id', version: 2, label: 'L', release_date: null, name: 'Rails', content_hash: 'b'.repeat(64), published_by_email: 'geo@star.test', created_at: 'x' }], error: null }));
    host = { client: async () => ({ rpc }), current: () => ({ id: 'fig-1', name: 'Rails', savedAt: '2026-10-21T09:59:00.123Z' }), dirty: () => false, frozen: () => null };
    init(host);
  });

  it('asks the server to copy the saved figure, naming the save on screen', async () => {
    const v = await publish({ label: '  News release 2026-10-21 ', releaseDate: '2026-10-21' });
    expect(rpc).toHaveBeenCalledWith('publish_figure_version', { p_kind: 'figure', p_figure_id: 'fig-1', p_label: 'News release 2026-10-21', p_release_date: '2026-10-21', p_expected_updated_at: '2026-10-21T09:59:00.123Z' });
    expect(v).toMatchObject({ version: 2, releaseDate: '2026-10-21', contentHash: 'a'.repeat(64), link: `${location.origin}/3d?project=fig-1&version=2` });
    expect(Object.keys(rpc.mock.calls[0][1])).not.toContain('p_snapshot'); // the browser never sends the content
  });

  it('refuses unsaved changes, an unsaved figure, a version on screen and a bad label, before calling the server', async () => {
    init({ ...host, dirty: () => true });
    await expect(publish({ label: 'x' })).rejects.toThrow(/unsaved changes/);
    init({ ...host, current: () => null });
    await expect(publish({ label: 'x' })).rejects.toThrow(/Save this figure/);
    init({ ...host, frozen: () => ({ version: 1 }) });
    await expect(publish({ label: 'x' })).rejects.toThrow(/read-only/);
    init(host);
    await expect(publish({ label: '' })).rejects.toThrow(/label/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('lists a figure’s versions with who published them', async () => {
    expect(await list()).toEqual([{ id: 'v-id', version: 2, label: 'L', releaseDate: null, name: 'Rails', contentHash: 'b'.repeat(64), publishedBy: 'geo@star.test', createdAt: 'x' }]);
    expect(rpc).toHaveBeenCalledWith('list_figure_versions', { p_kind: 'figure', p_figure_id: 'fig-1' });
  });
});
