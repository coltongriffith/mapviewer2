import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REFERENCE_OVERLAY_CONFIG } from '../src/utils/referenceOverlayConfig.js';

// A reference overlay that stops rendering used to produce NO signal at all.
// The only symptom was a toggle that appeared to do nothing — which looks
// exactly like a subtle layer working correctly, so nobody reports it.
//
// That cost real damage: the bedrock geology overlay was investigated, no
// evidence of failure could be found anywhere in the app, and the conclusion
// drawn was that the upstream USGS service had died. It had not. A working
// feature was nearly deleted because the app could not say what was wrong.
//
// All four overlays are third-party services outside our control.

const mapCanvas = readFileSync('src/components/MapCanvas.jsx', 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');
const vercel = readFileSync('vercel.json', 'utf8');

describe('every reference overlay is still wired up', () => {
  it('keeps all four overlays', () => {
    // Read from the config itself rather than grepped out of MapCanvas: the
    // definitions moved to utils/referenceOverlayConfig.js so the exporter
    // could credit them without importing Leaflet, and a source-text match
    // called that a deleted overlay.
    for (const key of ['context', 'labels', 'rail', 'geology']) {
      expect(REFERENCE_OVERLAY_CONFIG[key], `${key} is no longer defined`).toBeTruthy();
      expect(REFERENCE_OVERLAY_CONFIG[key].url, `${key} has no tile URL`).toBeTruthy();
      expect(app, `${key} has no toggle`).toMatch(new RegExp(`referenceOverlays\\.${key}`));
    }
  });

  it('builds its Leaflet layers from that config', () => {
    // The point of the move is one definition, not two. If MapCanvas ever
    // grows its own copy again, the credits can drift from the map — which is
    // how CARTO went uncredited in exports.
    expect(mapCanvas).toMatch(/REFERENCE_OVERLAY_CONFIG/);
    expect(mapCanvas).not.toMatch(/\n {2}context: \{/);
  });

  it('allows the geology host in the Content-Security-Policy', () => {
    // Without this the tiles are blocked by the browser before the service is
    // ever reached, which looks identical to the service being down.
    expect(vercel).toMatch(/mrdata\.usgs\.gov/);
  });

  it('names every overlay for the failure notice', () => {
    const labels = app.slice(app.indexOf('const OVERLAY_LABELS'), app.indexOf('function getFeatureLabel'));
    for (const key of ['context', 'labels', 'rail', 'geology']) {
      expect(labels, `${key} would show as a raw key`).toMatch(new RegExp(`${key}:`));
    }
  });
});

describe('a failing tile source announces itself', () => {
  it('listens for tile errors', () => {
    expect(mapCanvas).toMatch(/tiles\.on\('tileerror'/);
  });

  it('reports to the error log and to the user', () => {
    // The log so the operator finds out; the UI so the person staring at a
    // dead toggle is told which of the two things is broken.
    expect(mapCanvas).toMatch(/reportError\(/);
    expect(mapCanvas).toMatch(/onOverlayErrorRef\.current\?\.\(key\)/);
    expect(app).toMatch(/overlay-error-note/);
  });

  it('reports each overlay only once per session', () => {
    // A broken source emits an error for every tile in view.
    expect(mapCanvas).toMatch(/reportedTileErrors\.current\.has\(key\)/);
    expect(mapCanvas).toMatch(/reportedTileErrors\.current\.add\(key\)/);
  });

  it('only warns about overlays the user actually switched on', () => {
    // An overlay that failed, was turned off, and is now irrelevant must not
    // keep nagging.
    expect(app).toMatch(/Object\.keys\(overlayErrors\)\.filter\(\(k\) => referenceOverlays\[k\]\)/);
  });

  it('tells the user their own data is fine', () => {
    // The failure is upstream and there is nothing for them to fix; the note
    // exists to stop a dead toggle reading as a dead application.
    expect(app).toMatch(/Your own layers are unaffected/);
  });
});
