import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GEOPHYS_NUMERIC_POLICY as POLICY, geophysFilePolicy, readPoints } from '../src/three-d/geophys-points.js';

const services = vi.hoisted(() => ({ pull: vi.fn(), recipes: vi.fn(), choose: vi.fn(), library: vi.fn() }));
vi.mock('../src/utils/propertyResults.js', () => ({
  pullPropertyResults: services.pull, listRecipes: services.recipes, selectRecipe: services.choose,
}));
vi.mock('../src/utils/propertyFiles.js', async (original) => ({
  ...await original(), library: services.library,
}));

const source = (name, policy) => ({
  name, text: 'X,Y,Z,Value\n1,2,3,12tail', role: 'geophys', cols: { east: 0, north: 1, elev: 2, value: 3 },
  ...(policy !== undefined ? { geophysNumericPolicy: policy } : {}),
});
const prop = { id: 'qa-property', name: 'Synthetic QA property', orgName: 'QA' };
const newDrill = { name: 'property-collars.csv', text: 'HoleID,X,Y,Z,Depth\nQA-A,1,2,3,100' };

function studio(files) {
  let project = { v: 1, usingSample: false, settings: { drillSource: null, eq: { old: true }, libRefs: {} }, files: structuredClone(files) };
  const E = {
    getProject: () => structuredClone(project),
    getState: () => ({ usingSample: false, terrain: { crs: null }, drillSource: project.settings.drillSource, libRefs: project.settings.libRefs, files: project.files }),
    clearFiles: vi.fn(() => { project.files = []; project.settings.eq = null; project.settings.drillSource = null; }),
    loadProject: vi.fn(async (p) => { project = structuredClone(p); }),
    addFiles: vi.fn((fresh, options) => {
      project.files.push(...fresh.map((file) => ({ ...file, geophysNumericPolicy: geophysFilePolicy(file) })));
      project.settings.drillSource = options?.drillSource ?? null;
    }),
    setStyle: vi.fn(), setCRS: vi.fn(async () => {}),
  };
  window.EM3D = E;
  return E;
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  services.recipes.mockResolvedValue([]); services.choose.mockReturnValue(null);
  services.pull.mockResolvedValue({ files: [newDrill], ref: { kind: 'property', propertyId: prop.id, holes: 1, assays: 0 } });
});

async function propertyPicker(E, current = () => ({ id: 'qa-figure' })) {
  document.body.innerHTML = '<div id="drill-pick" hidden><div id="drill-body"></div></div>'
    + '<button id="drill-add"></button><div id="drill-notice" hidden></div><div id="drill-notice-text"></div>'
    + '<button id="drill-update"></button><button id="drill-dismiss"></button>';
  const module = await import('../src/three-d/property-data.js');
  module.init({ client: async () => ({}), current, say: vi.fn(), listHomes: async () => ({ properties: [prop] }) });
  await module.toggle();
  expect(window.EM3D).toBe(E);
  return document.getElementById('drill-load');
}

describe('unrelated property drill replacement preserves source interpretation', () => {
  it('restores retained files exactly, then sends only new drill files through fresh import', async () => {
    const kept = [source('legacy.csv'), source('strict.csv', POLICY), source('future.csv', 'future-policy')];
    const E = studio([...kept, { name: 'old-collars.csv', text: 'old', role: 'collar' }]);
    const button = await propertyPicker(E);
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(E.clearFiles).toHaveBeenCalledTimes(1);
    expect(E.loadProject).toHaveBeenCalledTimes(1);
    expect(E.loadProject.mock.calls[0][0].files).toEqual(kept);
    expect(E.loadProject.mock.calls[0][0].settings.eq).toBeNull(); // normal old-data reset retained
    expect(E.addFiles.mock.calls[0][0]).toEqual([newDrill]);
    const saved = E.getProject();
    expect(saved.files.slice(0, 3)).toEqual(kept);
    expect(saved.files[0]).not.toHaveProperty('geophysNumericPolicy');
    expect(saved.files.at(-1).geophysNumericPolicy).toBe(POLICY);
    const points = readPoints(saved.files.slice(0, 3).map((f) => ({ ...f, header: ['X', 'Y', 'Z', 'Value'], rows: [['1', '2', '3', '12tail']] })));
    expect([...points.v]).toEqual([12]);
    expect(points.diagnostics).toMatchObject({ accepted: 1, excluded: 2, legacyFiles: 1 });
  });

  it('does not append new drill files if another figure opens during retained-file restoration', async () => {
    const E = studio([source('legacy.csv')]);
    let id = 'qa-figure';
    E.loadProject.mockImplementation(async () => { id = 'another-figure'; });
    const button = await propertyPicker(E, () => ({ id }));
    button.click();
    await vi.waitFor(() => expect(E.loadProject).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(E.addFiles).not.toHaveBeenCalled());
  });
});

describe('explicit library replacement updates only replaced source policy', () => {
  it('marks new version text strict without changing untouched legacy, strict or unsupported files', async () => {
    const files = [source('updated.csv'), source('untouched-legacy.csv'), source('untouched-strict.csv', POLICY), source('untouched-future.csv', 'future-policy')];
    const E = studio(files);
    const initial = E.getProject(); initial.settings.libRefs = { 'updated.csv': { libFileId: 'lib-qa', version: 1 } };
    await E.loadProject(initial); E.loadProject.mockClear();
    const replacement = 'X,Y,Z,Value\n1,2,3,15tail';
    services.library.mockReturnValue({
      list: vi.fn(async () => [{ id: 'lib-qa', name: 'updated.csv', version: 2, path: 'qa-v2' }]),
      text: vi.fn(async () => replacement),
    });
    document.body.innerHTML = '<div id="lib-list"></div><button id="lib-update"></button><button id="lib-dismiss"></button>'
      + '<div id="lib-notice" hidden></div><div id="lib-notice-text"></div>';
    const module = await import('../src/three-d/library.js');
    module.init({ client: async () => ({}), current: () => ({ home: { propertyId: prop.id } }), say: vi.fn() });
    await module.check();
    const button = document.getElementById('lib-update'); button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(E.loadProject).toHaveBeenCalledTimes(1);
    const saved = E.getProject();
    expect(saved.files[0]).toEqual({ ...files[0], text: replacement, geophysNumericPolicy: POLICY });
    expect(saved.files.slice(1)).toEqual(files.slice(1));
    expect(saved.settings.libRefs['updated.csv']).toEqual({ libFileId: 'lib-qa', version: 2 });
    expect(files[0]).not.toHaveProperty('geophysNumericPolicy');
    expect(files[0].text).toContain('12tail');
  });
});
