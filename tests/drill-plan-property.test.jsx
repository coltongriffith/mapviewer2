import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import DrillPlanControls from '../src/components/DrillPlanControls.jsx';
import { defaultRecipe, computeResults, toPublishedFile } from '../shared/drillResults.js';
import { toFiles } from '../src/three-d/property-data.js';
import { parseTable, guessKind, buildPlan } from '../src/utils/drillPlanData.js';

const mock = vi.hoisted(() => ({ list: vi.fn(), pull: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../src/utils/propertyResults.js', async (original) => ({ ...(await original()), listRecipes: mock.list, pullPropertyResults: mock.pull }));
const saved = { id: 'recipe-3', name: 'Default', version: 3, recipe: { ...defaultRecipe(['Au'], { Au: 'g/t' }), inclCutoff: null } };
const rows = {
  collars: [{ hole_id: 'SYN-01', x: -120, y: 50, z: 1000, crs: 'EPSG:4326', azimuth: 0, dip: -60, depth: 10 }],
  assays: [0.5, 0.9].map((v, i) => ({ hole_id: 'SYN-01', from_m: 2 * i, to_m: 2 * i + 2, values: { Au: v }, units: { Au: 'g/t' }, bdl: {} })),
};
function payload(recipe = saved) {
  const ref = { kind: 'property', propertyId: 'p1', holes: 1, assays: 2, crs: 'EPSG:4326' }, files = toFiles(rows);
  if (recipe) {
    const out = computeResults(rows.assays, recipe.recipe);
    ref.resultsRecipe = { ...structuredClone(recipe), fileName: 'property-recipe-results.csv' };
    files.push(toPublishedFile(out.results, out.columns, 'Synthetic recipe test', ref.resultsRecipe.fileName));
  }
  return { ref, files, rows };
}
const props = (overrides = {}) => ({ plan: null, onReplace: vi.fn(), onChange: vi.fn(), propertyId: 'p1', ...overrides });
const picker = async () => {
  fireEvent.click(screen.getByRole('button', { name: "From the property's drill data" }));
  return screen.findByLabelText('Property results');
};
const load = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Load property data' }));
  await screen.findByRole('button', { name: /^(Build|Rebuild) the drill plan$/ });
};
beforeEach(() => { mock.list.mockReset().mockResolvedValue([saved]); mock.pull.mockReset().mockResolvedValue(payload()); });
afterEach(cleanup);

describe('2D property recipe import', () => {
  it('stages the saved recipe, builds exact table text and preserves the source through save/reopen serialization', async () => {
    const p = props(), ui = render(<DrillPlanControls {...p} />);
    expect(mock.list).not.toHaveBeenCalled();
    expect(await picker()).toHaveValue('r:Default');
    await load(); expect(p.onReplace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Build the drill plan' }));
    await waitFor(() => expect(p.onReplace).toHaveBeenCalledTimes(1));
    const plan = p.onReplace.mock.calls[0][0];
    expect(plan.results[0]).toMatchObject({ resultId: 'SYN-01:1', approvedText: computeResults(rows.assays, saved.recipe).results[0].line });
    expect(plan.drillSource.resultsRecipe).toMatchObject({ name: 'Default', version: 3 });
    ui.rerender(<DrillPlanControls {...p} plan={JSON.parse(JSON.stringify(plan))} />);
    expect(screen.getByText(/Calculated with saved property recipe Default v3/)).toBeVisible();
    expect(screen.getByText(/1 holes.*1 calculated results/)).toBeVisible();
    expect(mock.list).toHaveBeenCalledTimes(1); // opening a saved plan does not replace its results
  });

  it('requires a choice for multiple recipes and passes an explicit raw-only choice', async () => {
    mock.list.mockResolvedValue([{ ...saved, name: 'A' }, { ...saved, name: 'B' }]); mock.pull.mockResolvedValue(payload(null));
    render(<DrillPlanControls {...props()} />);
    const select = await picker(); expect(select).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Load property data' })).toBeDisabled();
    fireEvent.change(select, { target: { value: 'raw' } }); await load();
    expect(mock.pull).toHaveBeenCalledWith({}, { id: 'p1', name: null }, { recipeName: null });
  });

  it.each([{ list: [] }, { list: [{ ...saved, name: 'Gold' }] }])('handles no recipe or a sole named recipe', async ({ list }) => {
    mock.list.mockResolvedValue(list);
    render(<DrillPlanControls {...props()} />);
    expect(await picker()).toHaveValue(list.length ? 'r:Gold' : 'raw');
  });

  it('requires explicit raw-only selection after a recipe read error', async () => {
    mock.list.mockRejectedValue(new Error('forbidden'));
    render(<DrillPlanControls {...props()} />); await picker();
    expect(screen.getByRole('button', { name: 'Load property data' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('forbidden'); expect(mock.pull).not.toHaveBeenCalled();
  });

  it('discards a cancelled load and a late response for a different property', async () => {
    const pending = []; mock.pull.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const p = props(), ui = render(<DrillPlanControls {...p} />);
    await picker(); fireEvent.click(screen.getByRole('button', { name: 'Load property data' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel staged import' }));
    await act(async () => pending[0](payload()));
    expect(screen.queryByRole('button', { name: 'Build the drill plan' })).toBeNull();
    await picker(); fireEvent.click(screen.getByRole('button', { name: 'Load property data' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    ui.rerender(<DrillPlanControls {...p} propertyId="p2" />);
    await act(async () => pending[1](payload()));
    expect(screen.queryByRole('button', { name: 'Build the drill plan' })).toBeNull(); expect(p.onReplace).not.toHaveBeenCalled();
  });

  it('manual uploads replace staged property files and remove stale recipe provenance on rebuild', async () => {
    const loaded = payload();
    const tables = await Promise.all(loaded.files.map(async (f) => { const t = await parseTable(f.text); return { ...t, name: f.name, kind: guessKind(t.header, t.rows, f.name) }; }));
    const previous = (await buildPlan(tables, { drillSource: loaded.ref })).plan;
    const p = props({ plan: previous }); render(<DrillPlanControls {...p} />);
    await picker(); await load();
    const collar = toFiles(rows)[0];
    fireEvent.change(screen.getByLabelText('Drill files: collars, surveys, assays, published results'), { target: { files: [{ name: 'manual-collars.csv', text: async () => collar.text }] } });
    await screen.findByLabelText(/manual-collars.csv/);
    expect(screen.queryByLabelText(/property-recipe-results.csv/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild the drill plan' }));
    await waitFor(() => expect(p.onReplace).toHaveBeenCalledTimes(1));
    const next = p.onReplace.mock.calls[0][0];
    expect(next.drillSource).toBeUndefined(); expect(next.results).toEqual([]); expect(previous.drillSource).toEqual(loaded.ref);
  });

  it('keeps a zero-result recipe snapshot and leaves the saved plan unchanged on load failure', async () => {
    mock.pull.mockResolvedValue(payload({ ...saved, recipe: { ...saved.recipe, cutoff: 99 } }));
    const p = props(); render(<DrillPlanControls {...p} />); await picker(); await load();
    fireEvent.click(screen.getByRole('button', { name: 'Build the drill plan' }));
    await waitFor(() => expect(p.onReplace).toHaveBeenCalledTimes(1));
    expect(p.onReplace.mock.calls[0][0]).toMatchObject({ results: [], drillSource: { resultsRecipe: { version: 3 } } });
    mock.pull.mockRejectedValue(new Error('access revoked')); await picker();
    fireEvent.click(screen.getByRole('button', { name: 'Load property data' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('access revoked'));
    expect(p.onReplace).toHaveBeenCalledTimes(1);
  });
});
