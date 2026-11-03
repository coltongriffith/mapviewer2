import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const studio = readFileSync('src/three-d/studio.js', 'utf8');
const native = studio.slice(studio.indexOf('const extPending ='), studio.indexOf('const exportLayers ='));

describe('native export waiting bridge', () => {
  it('waits for pending setters without passing their result array as a layer guard', async () => {
    let finish;
    const setter = new Promise(resolve => { finish = resolve; });
    const ready = vi.fn((check = () => {}) => { check(); return 'ready'; });
    const ctx = vm.createContext({ Promise, Set, Error, setTimeout: vi.fn(), extReady: ready });
    vm.runInContext(`${native}\n globalThis.run = settled; globalThis.add = p => extPending.add(p);`, ctx);
    ctx.add(setter);
    const result = ctx.run();
    await Promise.resolve(); await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    finish('a completed setter');
    await expect(result).resolves.toBe('ready');
    expect(ready).toHaveBeenCalledWith();
  });
});
