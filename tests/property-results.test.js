import { describe, it, expect, vi } from 'vitest';
import { defaultRecipe, computeResults } from '../shared/drillResults.js';
import { pull, init, toggle, check, reset } from '../src/three-d/property-data.js';
import { pullPropertyResults, selectRecipe, recipeChange, RESULTS_FILE } from '../src/utils/propertyResults.js';
import { parseTable, guessKind, buildPlan } from '../src/utils/drillPlanData.js';
import { readResults, pubCols, pubCallouts, pubLines } from '../src/three-d/published-results.js';
import { matchCols } from '../src/three-d/roles.js';
import { parseDrillFilter, matchesDrillFilter } from './fixtures/drill-filter.js';

// Entirely synthetic fixtures: these are not measured Tower positions or grades.
const prop = { id: 'test-property', name: 'Illustrative only' };
const saved = (name = 'Default', version = 3, overrides = {}) => ({
  id: `${name}-${version}`, name, version,
  recipe: { ...defaultRecipe(['Au'], { Au: 'g/t' }), inclCutoff: null, ...overrides },
});

function figureHarness(f) {
  let project = { v: 1, settings: { calloutMode: 'calculated', drillSource: null, pubOverrides: {} }, files: [{ name: 'other.csv', role: 'litho-model', text: 'keep' }] };
  let figureId = 'figure-1';
  const E = {
    getState: () => ({ drillSource: project.settings.drillSource, terrain: { crs: 'EPSG:4326' }, usingSample: false }),
    getProject: () => structuredClone(project),
    clearFiles: vi.fn(() => { project.files = []; project.settings.drillSource = null; }),
    addFiles: vi.fn((files, { drillSource }) => { project.files = structuredClone(files); project.settings.drillSource = drillSource; }),
    setStyle: vi.fn((style) => Object.assign(project.settings, style)),
    setCRS: vi.fn(async () => {}),
    loadProject: vi.fn(async (p) => { project = structuredClone(p); }),
  };
  document.body.innerHTML = '<button id="drill-add"></button><div id="drill-pick" hidden><div id="drill-body"></div></div><div id="drill-notice" hidden><span id="drill-notice-text"></span><button id="drill-update"></button><button id="drill-dismiss"></button></div>';
  window.EM3D = E;
  const say = vi.fn();
  init({ client: async () => f.sb, current: () => ({ id: figureId }), say, listHomes: async () => ({ properties: [prop] }) });
  reset();
  return { E, say, get: () => structuredClone(project), set: (p) => { project = structuredClone(p); }, switchFigure: () => { figureId = 'figure-2'; reset(); } };
}
const el = (id) => document.getElementById(id);
async function clickAction(id) {
  el(id).click();
  await vi.waitFor(() => expect(el(id).disabled).toBe(false));
}

describe('3D property recipe controls', () => {
  it('defaults to the saved recipe, preserves other files and enables its exact callouts', async () => {
    const f = fixture(), h = figureHarness(f);
    await toggle();
    expect(el('drill-recipe').value).toBe('r:Default');
    await clickAction('drill-load');
    expect(h.get().settings).toMatchObject({ calloutMode: 'published', drillSource: { resultsRecipe: { name: 'Default', version: 3 } } });
    expect(h.get().files.find((x) => x.name === RESULTS_FILE).role).toBe('published');
    expect(h.get().files.find((x) => x.name === 'other.csv')).toEqual({ name: 'other.csv', role: 'litho-model', text: 'keep' });
    expect(h.say).toHaveBeenLastCalledWith(expect.stringContaining('Results calculated with Default v3'));
  });

  it('requires a choice for ambiguous recipes and lets raw-only avoid the recipe query on load', async () => {
    const f = fixture([saved('A'), saved('B')]), h = figureHarness(f);
    await toggle();
    expect(el('drill-load').disabled).toBe(true);
    el('drill-recipe').value = 'raw'; el('drill-recipe').dispatchEvent(new Event('change', { bubbles: true }));
    f.sb.rpc.mockClear(); await clickAction('drill-load');
    expect(f.sb.rpc).not.toHaveBeenCalled();
    expect(h.get().settings.drillSource.resultsRecipe).toBeUndefined();
    expect(h.E.setStyle).not.toHaveBeenCalled();
  });

  it('keeps uploaded results and refuses silently mixing their IDs with a property recipe', async () => {
    const f = fixture(), h = figureHarness(f), before = h.get();
    before.files.push({ name: 'release.csv', role: 'published', text: 'uploaded results' }); h.set(before);
    await toggle(); await clickAction('drill-load');
    expect(h.get()).toEqual(before); expect(h.E.clearFiles).not.toHaveBeenCalled();
    expect(el('drill-progress').textContent).toContain('already has uploaded results');
    el('drill-recipe').value = 'raw'; el('drill-recipe').dispatchEvent(new Event('change', { bubbles: true }));
    await clickAction('drill-load');
    expect(h.get().files).toContainEqual(before.files[1]);
  });

  it('offers recipe-only updates and changes only its managed file when asked', async () => {
    const f = fixture(), h = figureHarness(f);
    await toggle(); await clickAction('drill-load');
    const before = h.get(); before.settings.pubOverrides = { 'TEST-01:1': { dx: 20, show: false } }; h.set(before);
    f.db.recipes = [saved('Default', 4, { cutoff: 99 })];
    await check();
    expect(el('drill-notice').hidden).toBe(false);
    expect(el('drill-notice-text').textContent).toContain('v3 to v4');
    expect(h.get()).toEqual(before);
    await clickAction('drill-update');
    expect(h.get().settings.drillSource.resultsRecipe.version).toBe(4);
    expect(h.get().files.filter((x) => x.name === RESULTS_FILE)).toHaveLength(1);
    expect((await parseTable(h.get().files.find((x) => x.name === RESULTS_FILE).text)).rows).toEqual([]);
    expect(h.get().files.find((x) => x.name === 'other.csv')).toEqual(before.files.find((x) => x.name === 'other.csv'));
    expect(h.get().settings.calloutMode).toBe('published');
    expect(h.get().settings.pubOverrides).toEqual(before.settings.pubOverrides);
  });

  it('refuses a recipe update when an uploaded results file was added after loading the recipe', async () => {
    const f = fixture(), h = figureHarness(f);
    await toggle(); await clickAction('drill-load');
    const before = h.get();
    before.files.push({ name: 'release.csv', role: 'published', text: before.files.find((x) => x.name === RESULTS_FILE).text });
    h.set(before);
    f.db.recipes = [saved('Default', 4, { cutoff: 99 })];
    await check(); await clickAction('drill-update');
    expect(h.get()).toEqual(before);
    expect(h.E.loadProject).not.toHaveBeenCalled();
    expect(h.say).toHaveBeenLastCalledWith(expect.stringContaining('uploaded results alongside its property recipe'));
    expect(el('drill-notice').hidden).toBe(false);
    // Removing the conflicting upload lets the same pending update complete.
    h.set({ ...before, files: before.files.filter((x) => x.name !== 'release.csv') });
    await clickAction('drill-update');
    expect(h.get().settings.drillSource.resultsRecipe.version).toBe(4);
  });

  it('leaves the figure unchanged if its recipe disappears or another figure opens during a load', async () => {
    const f = fixture(), h = figureHarness(f);
    await toggle(); await clickAction('drill-load');
    const before = h.get(); f.db.recipes = [];
    await check(); expect(el('drill-notice-text').textContent).toContain('no longer available');
    await clickAction('drill-update'); expect(h.get()).toEqual(before);
    expect(h.say).toHaveBeenLastCalledWith(expect.stringContaining('no longer available'));
    f.db.recipes = [saved()]; f.db.onRead = (table) => { if (table === 'drill_assays') h.switchFigure(); };
    // The picker is still open; reload its initial selection before starting another load.
    await toggle(); await toggle();
    el('drill-load').click();
    await vi.waitFor(() => expect(f.reads.filter((r) => r.table === 'drill_assays').length).toBeGreaterThan(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.get()).toEqual(before);
  });

  it('restores the previous figure if applying newly loaded data fails', async () => {
    const f = fixture(), h = figureHarness(f), before = h.get();
    h.E.addFiles.mockImplementationOnce(() => { throw new Error('bad figure'); });
    await toggle(); await clickAction('drill-load');
    expect(h.get()).toEqual(before); expect(el('drill-progress').textContent).toBe('bad figure');
  });

  it('preserves edited result wording rather than silently carrying stale grades into a recipe update', async () => {
    const f = fixture(), h = figureHarness(f);
    await toggle(); await clickAction('drill-load');
    const before = h.get(); before.settings.pubOverrides = { 'TEST-01:1': { line1: 'User wording' } }; h.set(before);
    f.db.recipes = [saved('Default', 4, { cutoff: 99 })];
    await check(); await clickAction('drill-update');
    expect(h.get()).toEqual(before);
    expect(h.say).toHaveBeenLastCalledWith(expect.stringContaining('edited result wording'));
  });
});
function fixture(recipes = [saved()]) {
  const db = {
    recipes,
    drill_import_batches: [{ id: 'batch-1', kind: 'assays', created_at: '2026-10-22T00:00:00Z' }],
    drill_collars: [{ hole_id: 'TEST-01', x: -120, y: 50, z: 1000, crs: 'EPSG:4326', azimuth: 0, dip: -60, depth: 10 }],
    drill_assays: [0.5, 0.9].map((v, i) => ({ hole_id: 'TEST-01', from_m: 2 * i, to_m: 2 * i + 2, values: { Au: v }, units: { Au: 'g/t' }, bdl: {} })),
  };
  const reads = [];
  const sb = {
    rpc: vi.fn(async (name, args) => {
      expect(name).toBe('drill_property_recipes'); expect(args).toEqual({ p_property: prop.id });
      return { data: structuredClone(db.recipes), error: db.recipeError || null };
    }),
    from(table) {
      let start = 0, end = Infinity, fields;
      const filters = [], order = [];
      const q = {
        select: (v) => { fields = v.split(','); return q; },
        eq: (k, v) => { expect([k, v]).toEqual(['property_id', prop.id]); return q; },
        is: (k, v) => { expect([k, v]).toEqual(['superseded_by_batch', null]); return q; },
        gt: (k, v) => { filters.push(parseDrillFilter(`${k}.gt.${v}`)); return q; },
        gte: (k, v) => { filters.push(parseDrillFilter(`${k}.gte.${v}`)); return q; },
        or: (v) => { filters.push(parseDrillFilter(`or(${v})`)); return q; },
        order: (k, options) => { order.push([k, options?.ascending !== false]); return q; },
        limit: (n) => { end = n; return q; }, range: (a, b) => { start = a; end = b + 1; return q; },
        then(resolve, reject) {
          reads.push({ table, start, fields, cursor: filters.length > 0 }); db.onRead?.(table, start);
          const data = (db[table] || []).filter((r) => filters.every((f) => matchesDrillFilter(r, f))).sort((a, b) => {
            for (const [k, asc] of order) { if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1) * (asc ? 1 : -1); } return 0;
          }).slice(start, end).map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])));
          return Promise.resolve({ data: structuredClone(data), error: db.failTable === table ? { message: 'forbidden' } : null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { db, sb, reads };
}

describe('saved property recipe selection', () => {
  it('prefers Default or the sole saved recipe, never alphabetical order', () => {
    expect(selectRecipe([saved('A'), saved()]).name).toBe('Default');
    expect(selectRecipe([saved('Copper')]).name).toBe('Copper');
    expect(selectRecipe([])).toBeNull();
    expect(selectRecipe([saved('A'), saved('B')], 'B').name).toBe('B');
    expect(selectRecipe([saved()], null)).toBeNull();
    expect(() => selectRecipe([saved('A'), saved('B')])).toThrow(/Choose one/);
    expect(() => selectRecipe([saved()], 'Missing')).toThrow(/no longer available/);
  });

  it('requires a choice before loading any drill rows when recipes are ambiguous', async () => {
    const { sb, reads } = fixture([saved('A'), saved('B')]);
    await expect(pullPropertyResults(sb, prop)).rejects.toMatchObject({ code: 'RECIPE_SELECTION_REQUIRED', recipes: [{ name: 'A', version: 3 }, { name: 'B', version: 3 }] });
    expect(reads).toEqual([]);
  });
});

describe('property recipe snapshot', () => {
  it('gives the table, 2D plan and 3D callouts identical IDs and wording', async () => {
    const { db, sb } = fixture();
    const loaded = await pullPropertyResults(sb, prop);
    const expected = computeResults(db.drill_assays, db.recipes[0].recipe).results;
    expect(loaded.resultCount).toBe(1);
    expect(loaded.ref.resultsRecipe).toMatchObject({ id: 'Default-3', name: 'Default', version: 3, fileName: RESULTS_FILE });
    const file = loaded.files.find((f) => f.name === RESULTS_FILE);
    expect(file.role).toBe('published');
    const parsed = await parseTable(file.text);
    const parsed3d = readResults(parsed.header, parsed.rows, pubCols(parsed.header, matchCols(parsed.header)), file.name);
    expect(parsed3d.problems).toEqual([]);
    expect(parsed3d.results[0]).toMatchObject({ resultId: expected[0].id, approvedText: expected[0].line });
    const callout = pubCallouts(parsed3d.results, [{ id: 'TEST-01', len: 10 }])[0];
    const lines = pubLines(callout);
    expect(lines.l1 + lines.l1b).toBe(expected[0].line);
    const tables = await Promise.all(loaded.files.map(async (f) => { const t = await parseTable(f.text); return { ...t, name: f.name, kind: guessKind(t.header, t.rows, f.name) }; }));
    const { plan } = await buildPlan(tables);
    expect(plan.results[0]).toMatchObject({ resultId: expected[0].id, approvedText: expected[0].line });
    expect(file.text).toContain('Calculated property results: Illustrative only; Default v3');
    db.recipes[0].recipe.cutoff = 99;
    expect(loaded.ref.resultsRecipe.recipe.cutoff).toBe(0.3);
  });

  it.each(['half', 'zero', 'dl'])('keeps BDL flags and converts units with the %s rule', async (bdl) => {
    const { db, sb, reads } = fixture([saved('Default', 3, { bdl, cutoff: 0, minLength: 0 })]);
    db.drill_assays[0] = { ...db.drill_assays[0], values: { Au: null }, units: { Au: 'ppb' }, bdl: { Au: 500 } };
    const loaded = await pullPropertyResults(sb, prop);
    const expected = computeResults(db.drill_assays, db.recipes[0].recipe).results[0];
    expect(reads.find((r) => r.table === 'drill_assays').fields).toContain('bdl');
    expect(loaded.files.find((f) => f.name === RESULTS_FILE).text).toContain(expected.line);
  });

  it.each(['half', 'zero', 'dl'])('preserves %s BDL recipe results across an assay page boundary', async (bdl) => {
    const { db, sb, reads } = fixture([saved('Default', 3, { bdl, cutoff: 0, minLength: 0 })]);
    db.drill_assays = Array.from({ length: 1001 }, (_, i) => ({ hole_id: 'TEST-01', from_m: i * 2, to_m: i * 2 + 2,
      values: { Au: i >= 999 ? null : 900 }, units: { Au: 'ppb' }, bdl: i >= 999 ? { Au: 500 } : {} }));
    const loaded = await pullPropertyResults(sb, prop);
    expect(loaded.rows.assays).toEqual(db.drill_assays);
    const expected = computeResults(db.drill_assays, db.recipes[0].recipe).results;
    const file = loaded.files.find((f) => f.name === RESULTS_FILE), parsed = await parseTable(file.text);
    const actual = readResults(parsed.header, parsed.rows, pubCols(parsed.header, matchCols(parsed.header)), file.name);
    expect(actual.problems).toEqual([]);
    expect(actual.results.map((r) => [r.resultId, r.approvedText])).toEqual(expected.map((r) => [r.id, r.line]));
    expect(reads.filter((r) => r.table === 'drill_assays').map((r) => r.cursor)).toEqual([false, true, true]);
    expect(loaded.ref.resultsRecipe).toMatchObject({ name: 'Default', version: 3, recipe: { bdl } });
  });

  it('raw-only and old pull callers do not read recipes or acquire recipe metadata', async () => {
    const { sb } = fixture();
    const raw = await pull(sb, prop);
    expect(await pullPropertyResults(sb, prop, { recipeName: null })).toEqual(raw);
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(raw.ref.resultsRecipe).toBeUndefined();
  });

  it('no saved recipe leaves the raw file contract unchanged; zero results still freeze the chosen recipe', async () => {
    const { sb } = fixture([]);
    expect(await pullPropertyResults(sb, prop)).toEqual(await pull(sb, prop));
    const empty = fixture([saved('Default', 3, { cutoff: 99 })]);
    const loaded = await pullPropertyResults(empty.sb, prop);
    expect(loaded.resultCount).toBe(0);
    expect(loaded.ref.resultsRecipe.version).toBe(3);
    expect((await parseTable(loaded.files.find((f) => f.name === RESULTS_FILE).text)).rows).toEqual([]);
  });

  it('retries rows when a recipe changes during loading and records only the final recipe', async () => {
    const { db, sb, reads } = fixture();
    let changed = false;
    db.onRead = (table) => { if (table === 'drill_assays' && !changed) { changed = true; db.recipes = [saved('Default', 4, { cutoff: 99 })]; } };
    const loaded = await pullPropertyResults(sb, prop);
    expect(loaded.ref.resultsRecipe.version).toBe(4); expect(loaded.resultCount).toBe(0);
    expect(reads.filter((r) => r.table === 'drill_assays' && !r.cursor)).toHaveLength(2);
  });

  it('refuses continuously changing recipes, failed reads and unconvertible grades', async () => {
    const moving = fixture();
    moving.db.onRead = (table) => { if (table === 'drill_assays') moving.db.recipes = [saved('Default', moving.db.recipes[0].version + 1)]; };
    await expect(pullPropertyResults(moving.sb, prop)).rejects.toThrow(/changed while/);
    expect(moving.sb.rpc).toHaveBeenCalledTimes(4);
    const denied = fixture(); denied.db.recipeError = { message: 'forbidden' };
    await expect(pullPropertyResults(denied.sb, prop)).rejects.toThrow(); expect(denied.reads).toEqual([]);
    const rowError = fixture(); rowError.db.failTable = 'drill_assays';
    await expect(pullPropertyResults(rowError.sb, prop)).rejects.toThrow(/assays/);
    const units = fixture(); units.db.drill_assays[0].units.Au = 'unknown';
    await expect(pullPropertyResults(units.sb, prop)).rejects.toThrow(/cannot convert/);
  });

  it('retries imports independently, including a simultaneous recipe change', async () => {
    const { db, sb } = fixture(); let changed = false;
    db.onRead = (table) => {
      if (table !== 'drill_assays' || changed) return;
      changed = true;
      db.drill_import_batches.unshift({ id: 'batch-2', kind: 'assays', created_at: '2026-10-23T00:00:00Z' });
      db.recipes = [saved('Default', 4)]; db.drill_assays[0].values.Au = 0.7;
    };
    const loaded = await pullPropertyResults(sb, prop);
    expect(loaded.ref).toMatchObject({ latestBatchId: 'batch-2', resultsRecipe: { version: 4 } });
    expect(loaded.files.find((f) => f.name === RESULTS_FILE).text).toContain('4.0 m @ 0.80 g/t Au');
  });

  it('notices recipe-only changes and deletion without mutating the figure snapshot', async () => {
    const { sb } = fixture(); const { ref } = await pullPropertyResults(sb, prop); const before = structuredClone(ref);
    expect(recipeChange(ref, [saved()])).toBeNull();
    expect(recipeChange(ref, [saved('Default', 4)])).toEqual({ name: 'Default', fromVersion: 3, toVersion: 4, missing: false });
    expect(recipeChange(ref, [])).toMatchObject({ missing: true, toVersion: null });
    expect(recipeChange({}, [saved()])).toBeNull(); expect(ref).toEqual(before);
  });
});
