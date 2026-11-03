import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from '@babel/parser';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('src/three-d/studio.js', 'utf8');
const node = parse(source, { sourceType: 'module' }).program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'loadProject');
const actual = source.slice(node.start, node.end);
const input = () => ({ v: 1, settings: { title: 'New' }, files: [{ name: 'raw.csv', text: '\uFEFFID,Value\r\nA,<0.1' }] });
function fixture() {
  let resolve, reject;
  const module = new Promise((yes, no) => { resolve = yes; reject = no; });
  const ctx = { projectLoaderPromise: module, projectLoading: 0, signature: 'original', projectSignature: () => ctx.signature };
  vm.createContext(ctx); vm.runInContext(actual, ctx);
  return { ctx, resolve, reject, load: ctx.loadProject };
}
describe('actual lazy native load entry', () => {
  it('does not overwrite an edit made while the loader module is arriving', async () => {
    const f = fixture(), loader = vi.fn();
    const pending = f.load(input());
    expect(f.ctx.projectLoading).toBe(1);
    f.ctx.signature = 'new unsaved edit'; f.resolve(loader);
    await expect(pending).rejects.toMatchObject({ code: 'PROJECT_CHANGED', stateRestored: true });
    expect(loader).not.toHaveBeenCalled(); expect(f.ctx.signature).toBe('new unsaved edit'); expect(f.ctx.projectLoading).toBe(0);
  });
  it('checks the caller account/navigation guard again after a cold import', async () => {
    const f = fixture(), loader = vi.fn(); let current = true;
    const pending = f.load(input(), { isCurrent: () => current });
    current = false; f.resolve(loader);
    await expect(pending).rejects.toMatchObject({ code: 'PROJECT_CHANGED', stateRestored: true });
    expect(loader).not.toHaveBeenCalled(); expect(f.ctx.projectLoading).toBe(0);
  });
  it('preserves the original when the module itself cannot load', async () => {
    const f = fixture(), pending = f.load(input()); f.reject(new Error('offline chunk'));
    await expect(pending).rejects.toMatchObject({ message: 'offline chunk', stateRestored: true });
    expect(f.ctx.signature).toBe('original'); expect(f.ctx.projectLoading).toBe(0);
  });
  it('passes the original raw project and guard to the live coordinator when current', async () => {
    const f = fixture(), project = input(), guard = () => true, loader = vi.fn().mockResolvedValue({ ready: true });
    const pending = f.load(project, { isCurrent: guard }); f.resolve(loader);
    await expect(pending).resolves.toEqual({ ready: true });
    expect(loader).toHaveBeenCalledWith(project, { isCurrent: guard }); expect(f.ctx.projectLoading).toBe(0);
  });
});
