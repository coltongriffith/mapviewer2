import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from '@babel/parser';
import { describe, expect, it, vi } from 'vitest';
import { cloneFigureState, createProjectLoader, snapshotCamera } from '../src/three-d/project-load.js';
import { withDefaults } from '../src/three-d/design-version.js';
import { geophysFilePolicy, GEOPHYS_NUMERIC_POLICY } from '../src/three-d/geophys-policy.js';
import { isXYZ, parseXYZ, refineRole, matchCols, roleOf } from '../src/three-d/roles.js';
import { readPoints } from '../src/three-d/geophys-points.js';
import { init as history } from '../src/three-d/history.js';

const source = readFileSync('src/three-d/studio.js', 'utf8');
const ast = parse(source, { sourceType: 'module' });
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const item of value) { const hit = find(item, predicate); if (hit) return hit; } }
    else if (value && typeof value === 'object') { const hit = find(value, predicate); if (hit) return hit; }
  }
  return null;
}
const call = find(ast, n => n.type === 'CallExpression' && n.callee?.name === 'createProjectLoader');
if (!call) throw new Error('Native studio loader hooks were not found');
const hooksSource = source.slice(call.arguments[0].start, call.arguments[0].end);
const logoNode = find(ast, n => n.type === 'FunctionDeclaration' && n.id?.name === 'commitLogo');
const logoSource = source.slice(logoNode.start, logoNode.end);
const signatureNode = find(ast, n => n.type === 'VariableDeclarator' && n.id?.name === 'projectSignature');
const signatureSource = `const ${source.slice(signatureNode.start, signatureNode.end)};`;
function fixture({ restoreFails = false } = {}) {
  const image = { src: 'data:original-logo', cloneNode: () => ({ src: 'data:original-logo' }) };
  Object.setPrototypeOf(image, { decoded: true });
  const originalFile = { name: 'science.csv', text: '\uFEFFID,Value\r\nA,12tail', role: 'geophys', cols: { value: 1 }, geophysNumericPolicy: 'future-policy' };
  const S = { title: 'Original dirty title', logo: image, section: null, nested: { labels: ['original'] } };
  const ui = { textContent: '', appendChild: vi.fn() }, drawDecoded = vi.fn(), newImage = vi.fn(() => { throw new Error('Checkpoint restoration must not refetch an image'); });
  const hist = history({ base: { title: 'Opened' }, apply: vi.fn(), el: { hidden: true } });
  hist.note({ title: 'Original dirty title' });
  const images = { N: { decoded: true } }, oldImages = images.N;
  const worker = { terminate: vi.fn() }, candidateWorker = { terminate: vi.fn() };
  const ctx = {
    structuredClone, cloneFigureState, snapshotCamera, withDefaults, drawDecoded, Image: newImage, S, files: [originalFile], project: { holes: [{ id: 'A' }], empty: false },
    usingSample: false, refresh: null, eqApplied: true, usage: Object.assign(vi.fn(), { own: true }),
    HIST: hist, histP: Promise.resolve(hist), histBase: { title: 'Opened' }, histT: 0, pubT: 0,
    geo: { code: 'EPSG:4326', fwd: () => ['A-longitude', 'A-latitude'] }, realT: { job: 4, dem: { key: 'A-dem' }, img: { key: 'A-image' } },
    shell: { job: 3, worker, busy: true, waiters: [vi.fn()], field: { source: 'A-field' }, mesh: { source: 'A-mesh' } },
    LB: { state: { src: 'original-unprocessed-logo', removed: true }, render: vi.fn() },
    EXT: { geology: { checkpointImages: () => { const old = { ...images }; return () => { Object.assign(images, old); }; } } },
    recoveryProject: null, projectLoad: 0, projectCommitting: false, projectReadSnapshot: null, readSnapshot: null,
    window: { dispatchEvent: vi.fn() }, Event, document: { body: { children: [] }, documentElement: { matches: () => false }, createElement: vi.fn(() => ({ setAttribute: vi.fn(), getContext: () => ({ drawImage: drawDecoded }) })) },
    $: () => ui, clearTimeout: vi.fn(), locked: [], cleanSection: x => x, ROLE_LABEL: { geophys: 'Geophysics' }, gradeCols: () => [],
    isImg: x => typeof x?.$image === 'string', S_DEFAULTS: { section: null }, loadImg: vi.fn(async src => ({ src })),
    gapCallouts: () => [], gapText: x => x, status: vi.fn(), schedulePublish: vi.fn(), histTick: vi.fn(),
    renderFiles: vi.fn(), renderSummary: vi.fn(), renderChecks: vi.fn(), renderStyle: vi.fn(), renderCalloutEditor: vi.fn(), renderLabelList: vi.fn(), renderWallLabelList: vi.fn(), renderCRS: vi.fn(),
    filesDigest: () => 'raw-digest', getState: () => ({ title: S.title }),
  };
  ctx.camera = { azimuth: 42, target: [1, 2, 3], zoom: 120 };
  ctx.getProject = () => ({ v: 1, settings: { title: S.title, logo: S.logo ? { $image: S.logo.src } : null, nested: structuredClone(S.nested), section: null }, files: ctx.files.map(f => ({ ...f, cols: { ...f.cols } })), camera: structuredClone(ctx.camera) });
  ctx.addFiles = list => { ctx.files = list.map(f => ({ ...f, header: ['ID', 'Value'], rows: [['B', '4']] })); };
  ctx.histReset = () => { ctx.HIST = null; ctx.histP = null; ctx.histBase = null; };
  ctx.refresh = Object.assign(() => {
    ctx.project = { holes: [{ id: 'B' }], empty: false };
    ctx.geo.fwd = () => ['B-longitude', 'B-latitude'];
    worker.terminate(); ctx.shell.worker = candidateWorker; ctx.shell.busy = true;
    ctx.realT.dem = { key: 'B-dem' }; images.N = { decoded: 'B' };
    history({ base: { title: 'Candidate history' }, apply: vi.fn(), el: { hidden: true } });
  }, { secSet: false });
  ctx.settle = vi.fn(async cam => {
    if (cam) ctx.camera = structuredClone(cam);
    if (ctx.camera?.pan === null) delete ctx.camera.pan; // native getCam omits zero pan
    if (S.title === 'Candidate' || restoreFails) throw new Error('preview failed');
  });
  ctx.rebuildScene = vi.fn();
  vm.createContext(ctx);
  vm.runInContext(logoSource, ctx);
  vm.runInContext(signatureSource, ctx);
  const hooks = vm.runInContext(`(${hooksSource})`, ctx);
  return { ctx, hooks, load: createProjectLoader(hooks), image, originalFile, hist, oldImages, images, worker, candidateWorker };
}
// Fresh replacement executes the same native parser, file-policy handling,
// resetDerived and apply hooks. Only GPU/terrain-provider work is a seam.
function freshFixture() {
  const f = fixture(), { ctx } = f;
  const legacy = { name: 'legacy-geophys.csv', text: '\uFEFFCustomX,CustomY,Z,Reading\r\n1,2,3,12tail', role: 'geophys', cols: { east: 0, north: 1, elev: 2, value: 3 } };
  ctx.files = [legacy];
  Object.assign(ctx.S, { eq: { base: 'Cu', metals: { Au: { price: 2000 } } }, displayCutoff: 1, provisional: { A: true },
    section: { a: { x: 1, y: 2 } }, sections: [{ id: 'old-section' }], coOverrides: { A: { line1: 'Original custom wording' } }, pubOverrides: { R: { show: false } },
    meshes: { old: { show: false } }, libRefs: { old: { libFileId: 'old-id' } }, drillSource: { propertyId: 'old-property' }, calloutMode: 'manual',
    tags: { status: { A: 'new' }, groups: [{ id: 'old-group' }] }, geology: { legend: [{ code: 'OLD', name: 'Old scientific label' }], title: 'Lithology' },
    geophys: { mode: 'off' }, shell: { enabled: true, cutoff: 2 }, holesShown: ['A'], block: { colors: { A: '#abcdef' } } });
  ctx.getProject = () => ({ v: 1, settings: { ...structuredClone({ ...ctx.S, logo: null }), logo: ctx.S.logo ? { $image: ctx.S.logo.src } : null },
    files: ctx.files.map(file => ({ ...file, cols: file.cols && { ...file.cols } })), camera: structuredClone(ctx.camera), usingSample: false });
  Object.assign(ctx, { geophysFilePolicy, isXYZ, parseXYZ, refineRole, matchCols, roleOf, callouts: [], calcCallouts: [],
    isOverlay: () => false, syncShell: vi.fn(() => { expect(ctx.projectCommitting).toBe(true); expect(ctx.S.shell.enabled).toBe(false); }),
    setCRS: vi.fn(async code => { expect(ctx.projectCommitting).toBe(true); ctx.S.crs = code; }),
  });
  for (const name of ['parseCSV', 'addFiles', 'resetDerived', 'extAutoOn']) {
    const node = find(ast, n => n.type === 'FunctionDeclaration' && n.id?.name === name);
    if (!node) throw new Error(`Native ${name} was not found`);
    vm.runInContext(source.slice(node.start, node.end), ctx);
  }
  ctx.refresh = Object.assign(vi.fn(() => { ctx.project = { empty: false, holes: [{ id: 'B' }] }; }), { secSet: false });
  return { ...f, legacy };
}
const freshDrill = () => ({ files: [
  { name: 'property-collars.csv', text: 'HoleID,X,Y,Z,Depth\nB,1,2,3,10' },
  { name: 'fresh-geophys.csv', text: 'X,Y,Z,Value\n1,2,3,12tail' },
  { name: 'property-results.csv', role: 'published', text: 'ResultID,HoleID,From,To,ApprovedText\nR,B,0,1,1 g/t Au' },
], drillSource: { kind: 'property', propertyId: 'new-property', resultsRecipe: { name: 'Default', version: 3 } }, geologyTitle: 'Alteration', crs: 'EPSG:32610' });
const candidate = () => ({ v: 1, settings: { title: 'Candidate', logo: null, nested: { labels: ['candidate'] } }, camera: { azimuth: 180, target: [8, 9, 0], zoom: 55 }, files: [{ name: 'science.csv', text: 'ID,Value\nB,4', role: 'geophys', cols: { value: 1 } }] });

describe('actual native studio checkpoint hooks with deterministic renderer seams', () => {
  it('restores dirty source, decoded assets, history, camera, projection and caches without refetch', async () => {
    const f = fixture(), original = f.ctx.getProject();
    await expect(f.load(candidate())).rejects.toMatchObject({ message: 'preview failed', stateRestored: true });
    expect(f.ctx.getProject()).toEqual(original);
    expect(f.ctx.files[0]).toBe(f.originalFile);
    expect(f.ctx.S.logo).toBe(f.image);
    expect(f.ctx.S.nested.labels).toEqual(['original']);
    expect(f.hist.state().entries.map(e => e.label)).toEqual(['Opened', 'Title']);
    expect(f.hist.state().current).toBe(1);
    expect(f.ctx.geo.fwd()).toEqual(['A-longitude', 'A-latitude']);
    expect(f.ctx.LB.state).toEqual({ src: 'original-unprocessed-logo', removed: true });
    expect(f.ctx.realT.dem.key).toBe('A-dem'); expect(f.ctx.realT.img.key).toBe('A-image');
    expect(f.images.N).toBe(f.oldImages);
    expect(f.ctx.loadImg).not.toHaveBeenCalled();
    expect(f.ctx.Image).not.toHaveBeenCalled();
    expect(f.ctx.drawDecoded).toHaveBeenCalledWith(f.image, 0, 0, 1, 1);
    expect(f.candidateWorker.terminate).toHaveBeenCalledOnce();
    expect(f.ctx.shell.worker).toBeNull(); expect(f.ctx.shell.busy).toBe(false);
    expect(f.ctx.shell.field.source).toBe('A-field');
    expect(f.ctx.projectCommitting).toBe(false);
  });
  it('retains the original native project even when original preview rebuilding also fails', async () => {
    const f = fixture({ restoreFails: true }), original = f.ctx.getProject();
    await expect(f.load(candidate())).rejects.toMatchObject({ stateRestored: false, restoreError: expect.any(Error) });
    expect(f.ctx.recoveryProject).toEqual(original);
    expect(f.ctx.S.title).toBe(original.settings.title);
    expect(f.ctx.files[0].text).toBe(original.files[0].text);
    expect(f.hist.state().current).toBe(1);
    expect(f.ctx.loadImg).not.toHaveBeenCalled();
    expect(f.ctx.Image).not.toHaveBeenCalled();
    expect(f.ctx.drawDecoded).toHaveBeenCalledWith(f.image, 0, 0, 1, 1);
    expect(f.ctx.projectCommitting).toBe(false);
  });
});


describe('native fresh drill replacement inside the checkpoint', () => {
  it('resets old derived settings atomically while retaining exact legacy interpretation and marking new imports strict', async () => {
    const f = freshFixture(), original = f.ctx.getProject(), fresh = freshDrill();
    const fitted = { azimuth: 90, plunge: 20, zoom: 100 };
    f.ctx.refresh.mockImplementation(() => { f.ctx.project = { empty: false, holes: [{ id: 'B' }] }; f.ctx.camera = structuredClone(fitted); });
    await f.load(original, { freshDrill: fresh });
    expect(f.ctx.getProject().camera).toEqual(fitted); // new data keeps its native fitted view, not the old figure's camera
    expect(f.ctx.usage).toHaveBeenCalledWith('three_d_data_added', { kind: 'collar', source: 'drill_db' }, 'collar');
    const kept = f.ctx.files.find(file => file.name === f.legacy.name);
    expect(kept).toMatchObject({ text: f.legacy.text, role: f.legacy.role, cols: f.legacy.cols });
    expect(kept).not.toHaveProperty('geophysNumericPolicy');
    expect(f.ctx.files.map(file => file.name)).toEqual([f.legacy.name, ...fresh.files.map(file => file.name)]);
    for (const incoming of fresh.files) {
      const loaded = f.ctx.files.find(file => file.name === incoming.name);
      expect(loaded.text).toBe(incoming.text); expect(loaded.geophysNumericPolicy).toBe(GEOPHYS_NUMERIC_POLICY);
    }
    const diagnostics = readPoints(f.ctx.files.filter(file => file.role === 'geophys'));
    expect([...diagnostics.v]).toEqual([12]);
    expect(diagnostics.diagnostics).toMatchObject({ accepted: 1, excluded: 1, legacyFiles: 1 });
    expect(f.ctx.S).toMatchObject({ eq: null, displayCutoff: null, provisional: {}, section: null, sections: null,
      coOverrides: {}, pubOverrides: {}, tags: { status: {}, groups: [] }, geology: { legend: [], title: 'Alteration' },
      shell: { enabled: false, cutoff: null }, calloutMode: 'published', drillSource: fresh.drillSource, crs: fresh.crs });
    expect(f.ctx.S.block.colors).toBeUndefined(); expect(f.ctx.shell.mesh).toBeNull(); expect(f.ctx.shell.field).toBeNull();
    expect(f.ctx.setCRS).toHaveBeenCalledWith(fresh.crs); expect(f.ctx.usage.own).toBe(true); expect(f.ctx.usingSample).toBe(false);
    expect(f.ctx.S.geophys.mode).toBe('curtain'); expect(f.ctx.projectCommitting).toBe(false);
    expect(original.settings.eq).not.toBeNull(); expect(original.files[0].text).toBe(f.legacy.text);
  });
  it('restores the complete prior source and derived settings if final replacement preview fails', async () => {
    const f = freshFixture(), original = f.ctx.getProject();
    f.ctx.settle.mockImplementationOnce(async () => { throw new Error('fresh preview failed'); });
    await expect(f.load(original, { freshDrill: freshDrill() })).rejects.toMatchObject({ message: 'fresh preview failed', stateRestored: true });
    expect(f.ctx.getProject()).toEqual(original);
    expect(f.ctx.files).toHaveLength(1); expect(f.ctx.files[0]).toBe(f.legacy); expect(f.ctx.files[0]).not.toHaveProperty('geophysNumericPolicy');
    expect(f.ctx.S.eq).toEqual(original.settings.eq); expect(f.ctx.S.pubOverrides).toEqual(original.settings.pubOverrides);
    expect(f.hist.state().current).toBe(1); expect(f.ctx.projectCommitting).toBe(false);
  });
});
