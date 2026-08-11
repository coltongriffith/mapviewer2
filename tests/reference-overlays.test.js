import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The bedrock-geology overlay was removed after its upstream service died for
// the SECOND time. Its history:
//
//   f9b95e7  "services/geology is dead, use services/worldgeol"
//   (this)   worldgeol is dead too
//
// Nothing in the app noticed either time, because no code listened for tile
// failures — the only symptom was a toggle that appeared to do nothing.

const mapCanvas = readFileSync('src/components/MapCanvas.jsx', 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');
const vercel = readFileSync('vercel.json', 'utf8');

describe('the dead geology overlay is fully gone', () => {
  it('has no overlay config left', () => {
    expect(mapCanvas).not.toMatch(/mrdata\.usgs\.gov|worldgeol/);
  });

  it('offers no toggle for it', () => {
    // A toggle for a layer that cannot render is worse than no toggle: the user
    // concludes the app is broken rather than that the source is.
    expect(app).not.toMatch(/referenceOverlays\.geology/);
  });

  it('drops the host from the Content-Security-Policy', () => {
    // Nothing requests it now, so the allowance should go with it.
    expect(vercel).not.toMatch(/mrdata\.usgs\.gov/);
  });

  it('keeps the overlays that still work', () => {
    for (const key of ['context', 'labels', 'rail']) {
      expect(mapCanvas).toMatch(new RegExp(`\\n  ${key}: \\{`));
    }
    expect(app).toMatch(/referenceOverlays\.rail/);
  });
});

describe('a tile source that dies is no longer silent', () => {
  it('reports a tile failure for every reference overlay', () => {
    // This is the reason two dead endpoints went unnoticed. All three remaining
    // overlays are third-party services outside our control.
    expect(mapCanvas).toMatch(/tiles\.on\('tileerror'/);
    expect(mapCanvas).toMatch(/reportError\(/);
  });

  it('reports each overlay only once per session', () => {
    // A broken source emits an error for every tile in view; without the guard
    // that is a flood of identical rows in Admin → Health.
    expect(mapCanvas).toMatch(/reportedTileErrors\.current\.has\(key\)/);
    expect(mapCanvas).toMatch(/reportedTileErrors\.current\.add\(key\)/);
  });
});

describe('a saved project that still has the overlay enabled', () => {
  it('is never given a default for it', () => {
    // geology was never in the default layout — only a user toggle could set
    // it — so a project saved with `geology: true` simply finds no config and
    // renders nothing. It must not throw, and there is nothing to migrate.
    const state = readFileSync('src/projectState.js', 'utf8');
    expect(state).not.toMatch(/geology/);
  });

  it('iterates the config, not the saved flags', () => {
    // The loop is over REFERENCE_OVERLAYS, so an unknown saved key is ignored
    // rather than looked up and dereferenced.
    expect(mapCanvas).toMatch(/Object\.entries\(REFERENCE_OVERLAYS\)\.forEach/);
  });
});
