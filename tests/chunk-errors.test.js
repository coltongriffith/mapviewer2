import { describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, retryImport } from '../shared/chunkErrors.js';

describe('isChunkLoadError', () => {
  // Each one as error_events recorded it, plus the other engines' wording.
  it.each([
    'Failed to fetch dynamically imported module: https://www.explorationmaps.com/assets/MapStyleGallery-SbX3ZVDy.js',
    'Failed to fetch dynamically imported module: https://www.explorationmaps.com/assets/publishedCallouts-DXd09QQ9.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/vendor-leaflet-CIGW-MKW.css',
    'error loading dynamically imported module: https://www.explorationmaps.com/assets/App-JTKPGumv.js',
    "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\".",
    "'text/html' is not a valid JavaScript MIME type.",
    'Loading chunk 42 failed.',
    'Loading CSS chunk vendor failed',
  ])('recognises %s', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
    expect(isChunkLoadError(message)).toBe(true);
  });

  it('recognises a ChunkLoadError by name', () => {
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
  });

  it.each([
    // A plain network failure is not a stale chunk: those callers show their own retry.
    'Failed to fetch',
    'Load failed',
    "Cannot read properties of undefined (reading '_removePath')",
    "Cannot read properties of undefined (reading 'clearRect')",
    'Reference overlay "labels" failed to load tiles',
    '',
  ])('leaves %j alone', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(false);
  });

  it('is safe on anything a rejection can carry', () => {
    for (const reason of [undefined, null, 0, 42, {}, { message: 5 }, Symbol('x'), []]) {
      expect(isChunkLoadError(reason)).toBe(false);
    }
  });
});

describe('retryImport', () => {
  const stale = () => new TypeError('Failed to fetch dynamically imported module: /assets/LegendEditor-old.js');

  it('loads once when the first try works', async () => {
    const load = vi.fn(async () => ({ default: 1 }));
    await expect(retryImport(load)).resolves.toEqual({ default: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('tries a failed chunk once more (a dropped connection reads the same)', async () => {
    const load = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValueOnce({ default: 2 });
    await expect(retryImport(load, { delayMs: 1 })).resolves.toEqual({ default: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second failure with the chunk error', async () => {
    const load = vi.fn(async () => { throw stale(); });
    await expect(retryImport(load, { delayMs: 1 })).rejects.toThrow(/dynamically imported module/);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not retry an error in the module itself', async () => {
    const load = vi.fn(async () => { throw new ReferenceError('x is not defined'); });
    await expect(retryImport(load, { delayMs: 1 })).rejects.toThrow('x is not defined');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
