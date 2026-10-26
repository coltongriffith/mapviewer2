import React from 'react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ReleasePackPanel from '../src/components/workspace/ReleasePackPanel.jsx';
import { defaultRecipe } from '../shared/drillResults.js';
const mock = vi.hoisted(() => ({ db: {}, summary: vi.fn(), recipes: vi.fn(), assays: vi.fn(), maps: vi.fn(), figures: vi.fn(), cloud: vi.fn(), pkg: vi.fn(), xlsx: vi.fn(), pdf: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../src/hooks/useAuth.jsx', () => ({ useAuth: () => ({ user: { id: 'u' } }) }));
vi.mock('../src/utils/releasePackDb', async original => ({ ...(await original()), releasePackDb: () => mock.db }));
vi.mock('../src/utils/drillDb', () => ({ drillDb: () => ({ summary: mock.summary }) }));
vi.mock('../src/utils/drillResultsDb', () => ({ MAX_ASSAYS: 200000, drillResultsDb: () => ({ recipes: mock.recipes, assays: mock.assays }) }));
vi.mock('../src/utils/cloudStorage', () => ({ loadCloudProject: mock.cloud }));
vi.mock('../src/utils/workspace', () => ({ listPropertyMaps: mock.maps, listPropertyFigures: mock.figures, formatWhen: x => x }));
vi.mock('../src/components/workspace/shared', () => ({ ErrorNote: ({ error }) => error && <p role="alert">{error}</p> }));
vi.mock('../src/components/PackageExport', () => ({ default: props => { mock.pkg(props); return <div role="dialog">Ready to download</div>; } }));
vi.mock('../src/utils/drillResultsXlsx.js', () => ({ resultsTableXlsx: mock.xlsx }));
vi.mock('../src/utils/drillResultsPages.js', () => ({ resultsTablePages: mock.pdf }));
let state;
const property = { id: 'p', name: 'Synthetic property' };
const mount = async () => { const ui = render(<ReleasePackPanel property={property} perms={{ edit: true }} />); await screen.findByText(/Up to date: approved/); return ui; };
const prepare = () => fireEvent.click(screen.getByRole('button', { name: 'Download pack', exact: true }));
beforeEach(() => {
  vi.clearAllMocks();
  const items = [{ kind: 'results_table', ref: 'Default' }];
  state = { pack: { id: 'pack', items }, approvals: [{ id: 'a', items, batch_ids: ['b1'], recipe: { name: 'Default', id: 'r1', version: 1 }, figures: [], approved_at: '2026-10-25' }], batches: [{ id: 'b1', kind: 'assays' }] };
  mock.db = { load: vi.fn(async () => structuredClone({ pack: state.pack, approvals: state.approvals })),
    liveBatches: vi.fn(async () => structuredClone(state.batches)), batchStatus: vi.fn(async () => structuredClone(state.batches)),
    latestVersions: vi.fn(async () => ({})), holes: vi.fn(async () => []), approve: vi.fn() };
  mock.summary.mockImplementation(async () => ({ batches: structuredClone(state.batches) }));
  mock.recipes.mockResolvedValue([{ name: 'Default', id: 'r1', version: 1, recipe: defaultRecipe(['Au']) }]);
  mock.assays.mockResolvedValue({ rows: [], capped: false }); mock.maps.mockResolvedValue([]); mock.figures.mockResolvedValue([]);
  const blob = { arrayBuffer: async () => new ArrayBuffer(1) };
  mock.xlsx.mockResolvedValue(blob); mock.pdf.mockResolvedValue({ blob });
});
afterEach(cleanup);
it('rereads sources before generation when an import lands with the tab open', async () => {
  await mount(); state.batches.push({ id: 'b2', kind: 'assays', summary: { new: 2 } });
  prepare(); await screen.findByRole('dialog');
  const preset = mock.pkg.mock.lastCall[0].preset;
  expect(preset.draft).toBe(true);
  const record = JSON.parse(new TextDecoder().decode(preset.extra['release-pack.json']));
  expect(record.status).toContain('Draft:'); expect(record.changes).toContain('2 new assays');
});
it('rejects imports arriving during the assay read rather than exporting a mixed snapshot', async () => {
  await mount(); mock.assays.mockImplementationOnce(async () => { state.batches.push({ id: 'b2', kind: 'assays' }); return { rows: [], capped: false }; });
  prepare(); await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('sources changed'); expect(mock.pkg).not.toHaveBeenCalled();
});
it('fails closed on a freshness-read error and allows a fresh retry', async () => {
  await mount(); mock.db.liveBatches.mockRejectedValueOnce(new Error('History unavailable'));
  prepare(); await screen.findByRole('alert'); expect(mock.pkg).not.toHaveBeenCalled();
  expect(screen.queryByText(/Up to date:/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry release pack' }));
  await screen.findByText(/Up to date: approved/); prepare(); await screen.findByRole('dialog');
});
it('a captured map payload replaces later live reads and the download validator refuses subsequent saves', async () => {
  state.pack.items.push({ kind: 'location_map', ref: 'm' }); state.approvals[0].items = structuredClone(state.pack.items);
  state.approvals[0].figures = [{ id: 'm', kind: 'map', revision: 3, saved_at: '2026-10-25' }];
  mock.maps.mockResolvedValue([{ id: 'm', name: 'Location', revision: 3, updatedAt: '2026-10-25' }]);
  const payload = { layout: { title: 'Captured map' }, layers: [] };
  mock.cloud.mockResolvedValue({ payload, revision: 3, property_id: 'p' });
  await mount(); prepare(); await screen.findByRole('dialog');
  const preset = mock.pkg.mock.lastCall[0].preset;
  expect(preset.mapPayloads.m).toEqual(payload);
  mock.maps.mockResolvedValue([{ id: 'm', name: 'Location', revision: 4, updatedAt: '2026-10-26' }]);
  await expect(preset.validate()).rejects.toThrow('sources changed');
});
it('invalidates a prepared download when leaving the property', async () => {
  const ui = await mount(); prepare(); await screen.findByRole('dialog');
  const preset = mock.pkg.mock.lastCall[0].preset;
  ui.unmount(); await expect(preset.validate()).rejects.toThrow('workspace changed');
});
it('does not show approved status when the initial complete history cannot be read', async () => {
  mock.db.liveBatches.mockRejectedValue(new Error('History unavailable'));
  render(<ReleasePackPanel property={property} perms={{ edit: true }} />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('History unavailable'));
  expect(screen.queryByText(/Up to date:/)).toBeNull(); expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
});

for (const approved of [true, false]) {
  for (const action of ['Download pack', 'Regenerate draft']) {
    it(`refuses capped results for ${approved ? 'approved' : 'draft'} packs via ${action}, then allows a complete retry`, async () => {
      if (!approved) state.approvals = [];
      render(<ReleasePackPanel property={property} perms={{ edit: true }} />);
      await screen.findByText(approved ? /Up to date: approved/ : 'Draft: not approved yet');
      mock.assays.mockResolvedValueOnce({ rows: [], capped: true });
      fireEvent.click(screen.getByRole('button', { name: action, exact: true }));
      await screen.findByRole('alert');
      expect(screen.getByRole('alert')).toHaveTextContent('200,000-assay loading limit');
      expect(mock.xlsx).not.toHaveBeenCalled(); expect(mock.pdf).not.toHaveBeenCalled();
      expect(mock.pkg).not.toHaveBeenCalled();
      prepare(); await screen.findByRole('dialog');
      expect(mock.xlsx).toHaveBeenCalledOnce(); expect(mock.pdf).toHaveBeenCalledOnce();
      expect(mock.pkg.mock.lastCall[0].preset.draft).toBe(!approved);
    });
  }
}
