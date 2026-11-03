import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from '@babel/parser';
import { describe, expect, it, vi } from 'vitest';
const source = readFileSync('src/three-d/studio.js', 'utf8');
const ast = parse(source, { sourceType: 'module' });
const names = ['setCRS', 'recheckCRS', 'syncRealTerrain'];
const nativeFunctions = names.map(name => {
  const node = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === name);
  if (!node) throw new Error(`Native ${name} was not found`);
  return source.slice(node.start, node.end);
}).join('\n');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };
function fixture() {
  const provider = {
    parseCRS: vi.fn(code => ({ code, label: code })), ready: vi.fn(async () => {}),
    loadDem: vi.fn(async key => ({ key, ok: true, z: 10, tiles: 2 })),
    loadImagery: vi.fn(async key => ({ key, ok: true, z: 11, tiles: 3 })),
  };
  const ctx = {
    projectLoad: 1, crsRequest: 0, S: { crs: 'A', terrainSource: 'dem', terrain: 'satellite' },
    geo: { code: 'A', label: 'A projection', fwd: () => [121, 54] },
    realT: { job: 0, dem: null, img: null, promise: null, status: 'off', message: '' },
    project: { empty: false, holes: [{ c: { x: 1, y: 2 } }] }, G: { B: { x0: 0, x1: 1, y0: 0, y1: 1 }, using: 'collars', terrainNote: 'fitted' },
    LATLON: { code: 'EPSG:4326' }, rtLoad: vi.fn(async () => provider), geoFor: vi.fn(() => () => [121, 54]),
    renderCRS: vi.fn(), rebuildScene: vi.fn(), schedulePublish: vi.fn(), status: vi.fn(),
    paintTerrain: vi.fn(), restyle: vi.fn(), renderSummary: vi.fn(),
    usage: Object.assign(vi.fn(), { own: false }), usingSample: false,
  };
  ctx.terrainKeyOf = () => `${ctx.S.crs}-block`;
  ctx.getState = () => ({ crs: ctx.S.crs });
  vm.createContext(ctx); vm.runInContext(nativeFunctions, ctx);
  return { ctx, provider };
}
function restoreOriginal(ctx) {
  ctx.projectLoad++; ctx.realT.job++;
  ctx.S.crs = 'Original';
  ctx.geo = { code: 'Original', label: 'Original projection', fwd: () => [10, 20] };
  ctx.realT.dem = { key: 'Original-dem', ok: true }; ctx.realT.img = { key: 'Original-image', ok: true };
  ctx.realT.status = 'ready';
}
describe('actual native coordinate and terrain async job ownership', () => {
  it('keeps the ordinary current CRS request working', async () => {
    const { ctx, provider } = fixture();
    await expect(ctx.setCRS('B')).resolves.toEqual({ crs: 'B' });
    expect(provider.ready).toHaveBeenCalledWith({ code: 'B', label: 'B' });
    expect(ctx.geo.code).toBe('B'); expect(ctx.rebuildScene).toHaveBeenCalledWith(true);
  });
  it('does not install an old candidate CRS after restoration while its definitions load', async () => {
    const { ctx, provider } = fixture(), gate = deferred(); provider.ready.mockReturnValue(gate.promise);
    const pending = ctx.setCRS('B'); const rejected = expect(pending).rejects.toMatchObject({ code: 'PROJECT_CHANGED' });
    await vi.waitFor(() => expect(provider.ready).toHaveBeenCalled());
    restoreOriginal(ctx); gate.resolve(); await rejected;
    expect(ctx.S.crs).toBe('Original'); expect(ctx.geo.code).toBe('Original');
    expect(ctx.realT.dem.key).toBe('Original-dem'); expect(ctx.rebuildScene).not.toHaveBeenCalled();
  });
  it('honours a newer explicit CRS request in the same figure generation', async () => {
    const { ctx, provider } = fixture(), gate = deferred();
    provider.ready.mockImplementation(c => c.code === 'B' ? gate.promise : Promise.resolve());
    const old = ctx.setCRS('B'); const rejected = expect(old).rejects.toMatchObject({ code: 'PROJECT_CHANGED' });
    await vi.waitFor(() => expect(provider.ready).toHaveBeenCalled());
    await ctx.setCRS('C'); gate.resolve(); await rejected;
    expect(ctx.S.crs).toBe('C'); expect(ctx.geo.code).toBe('C');
  });
  it('does not clear the restored CRS from a detached old recheck failure', async () => {
    const { ctx, provider } = fixture(), gate = deferred();
    ctx.geo = null; ctx.S.crs = 'Candidate'; provider.ready.mockReturnValue(gate.promise);
    ctx.recheckCRS(); await vi.waitFor(() => expect(provider.ready).toHaveBeenCalled());
    restoreOriginal(ctx); gate.reject(new Error('Old CRS provider failed'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(ctx.S.crs).toBe('Original'); expect(ctx.geo.code).toBe('Original');
    expect(ctx.status).not.toHaveBeenCalledWith(expect.stringContaining('cleared'));
  });
  it('commits both current DEM and imagery results and updates the preview', async () => {
    const { ctx, provider } = fixture(); await ctx.syncRealTerrain();
    expect(provider.loadDem).toHaveBeenCalledOnce(); expect(provider.loadImagery).toHaveBeenCalledOnce();
    expect(ctx.realT.dem).toMatchObject({ key: 'A-block', ok: true });
    expect(ctx.realT.img).toMatchObject({ key: 'A-block', ok: true });
    expect(ctx.realT.status).toBe('ready'); expect(ctx.rebuildScene).toHaveBeenCalledWith(true);
  });
  it.each(['resolve', 'reject'])('does not install a stale DEM %s result after restoration', async outcome => {
    const { ctx, provider } = fixture(), gate = deferred(); provider.loadDem.mockReturnValue(gate.promise);
    const pending = ctx.syncRealTerrain(); await vi.waitFor(() => expect(provider.loadDem).toHaveBeenCalled());
    restoreOriginal(ctx);
    if (outcome === 'resolve') gate.resolve({ key: 'Candidate-dem', ok: true, z: 8, tiles: 1 });
    else gate.reject(new Error('Candidate DEM failed'));
    await pending;
    expect(ctx.realT.dem.key).toBe('Original-dem'); expect(ctx.realT.img.key).toBe('Original-image');
    expect(provider.loadImagery).not.toHaveBeenCalled(); expect(ctx.rebuildScene).not.toHaveBeenCalled();
    expect(ctx.realT.status).toBe('ready');
  });
  it.each(['resolve', 'reject'])('does not install stale imagery %s after a newer job starts', async outcome => {
    const { ctx, provider } = fixture(), gate = deferred(); provider.loadImagery.mockReturnValue(gate.promise);
    const pending = ctx.syncRealTerrain(); await vi.waitFor(() => expect(provider.loadImagery).toHaveBeenCalled());
    restoreOriginal(ctx);
    if (outcome === 'resolve') gate.resolve({ key: 'Candidate-image', ok: true, z: 8, tiles: 1 });
    else gate.reject(new Error('Candidate imagery failed'));
    await pending;
    expect(ctx.realT.dem.key).toBe('Original-dem'); expect(ctx.realT.img.key).toBe('Original-image');
    expect(ctx.rebuildScene).not.toHaveBeenCalled(); expect(ctx.realT.status).toBe('ready');
  });
  it('does not request provider assets after a delayed provider resolves for an obsolete figure', async () => {
    const { ctx, provider } = fixture(), gate = deferred(); ctx.rtLoad.mockReturnValue(gate.promise);
    const pending = ctx.syncRealTerrain(); restoreOriginal(ctx); gate.resolve(provider); await pending;
    expect(provider.loadDem).not.toHaveBeenCalled(); expect(provider.loadImagery).not.toHaveBeenCalled();
    expect(ctx.realT.dem.key).toBe('Original-dem');
  });
});
