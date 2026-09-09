import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BASEMAPS, BASEMAP_KEYS, basemapThumb, basemapConfig } from '../src/utils/basemapConfig.js';
import { REFERENCE_OVERLAY_CONFIG } from '../src/utils/referenceOverlayConfig.js';

// A tile service that starts demanding an API key does not fail like a broken
// service. CARTO kept answering 200 with a perfectly valid PNG — one with
// "API KEY REQUIRED / carto.com/basemaps/apikey" printed diagonally across it.
// So Leaflet's `tileerror` never fired, the health log stayed clean, the export
// pipeline drew the watermarked tiles into finished maps without complaint, and
// the only symptom was a defaced default basemap that a user had to report.
//
// Nothing here can detect that watermark from Node. What it CAN do is hold the
// two conditions that made the outage expensive: the app used a host whose free
// anonymous tier had been retired, and it hard-coded that host in five separate
// files, so fixing it in the obvious one left the picker, the inset and the
// portfolio map still serving it.

const SRC = 'src';

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(path);
  }
  return out;
}

const FILES = sourceFiles(SRC);

// Every tile-template URL written anywhere in the app, wherever it lives —
// including any new copy someone pastes into a component tomorrow.
const tileUrlsInSource = FILES.flatMap((path) => {
  const text = readFileSync(path, 'utf8');
  return [...text.matchAll(/https:\/\/[^'"`\s)]+/g)]
    .map((m) => m[0])
    .filter((url) => url.includes('{z}'))
    .map((url) => ({ path, url }));
});

const configuredUrls = [
  ...BASEMAP_KEYS.map((key) => BASEMAPS[key].url),
  ...Object.values(REFERENCE_OVERLAY_CONFIG).map((cfg) => cfg.url),
].filter(Boolean);

function hostOf(url) {
  return url.replace(/^https:\/\//, '').split('/')[0].replace('{s}', '*');
}

describe('the tiles the app asks for are tiles it is allowed to have', () => {
  // The retired service, by name. Anything still pointing at it renders a
  // watermark rather than an error, which is why a source-level check earns
  // its place: there is no runtime signal to assert on.
  it('serves nothing from a host whose anonymous tier was retired', () => {
    const retired = [...tileUrlsInSource, ...configuredUrls.map((url) => ({ path: '(config)', url }))]
      .filter(({ url }) => /cartocdn\.com/.test(url));
    expect(retired, `these would render with "API KEY REQUIRED" across them: ${JSON.stringify(retired)}`).toEqual([]);
  });

  it('leaves no basemap needing a key we do not ship', () => {
    // A key smuggled into a tile URL is a credential in a public bundle, and a
    // key that expires takes the basemap down with it.
    configuredUrls.forEach((url) => {
      expect(url, `${url} carries a credential`).not.toMatch(/api[-_]?key|access[-_]?token|[?&]key=/i);
    });
  });

  it('allows every tile host in the Content-Security-Policy', () => {
    // Without this the browser blocks the request before the service is ever
    // reached — which looks exactly like the service being down, and is how a
    // working overlay was once nearly deleted as dead.
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const csp = vercel.headers
      .flatMap((h) => h.headers)
      .find((h) => h.key === 'Content-Security-Policy').value;
    const imgSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('img-src')).split(/\s+/).slice(1);
    const allowed = imgSrc.filter((e) => e.startsWith('https://')).map((e) => e.replace('https://', ''));
    // A bare `https:` scheme source admits every https host. It is there on
    // purpose: custom tile and WMS services are the user's own choice, so
    // their hosts cannot be an allowlist kept here.
    const anyHttps = imgSrc.includes('https:');

    const hosts = new Set([
      ...configuredUrls.map(hostOf),
      ...tileUrlsInSource.map(({ url }) => hostOf(url)),
      hostOf(REFERENCE_OVERLAY_CONFIG.geology.url),
    ]);

    for (const host of hosts) {
      const ok = anyHttps || allowed.some((entry) => (
        entry === host || (entry.startsWith('*.') && host.endsWith(entry.slice(1)))
      ));
      expect(ok, `img-src does not allow ${host} — its tiles are blocked before the service is reached`).toBe(true);
    }
  });
});

describe('a basemap cannot be half-migrated', () => {
  it('keeps one definition, read by every consumer', () => {
    // The five copies are the actual defect. MapCanvas was the obvious one;
    // the picker thumbnails were not, and a thumbnail pointing at a dead
    // service still looks like a thumbnail, so nothing reports it.
    const consumers = [
      'src/App.jsx',
      'src/components/MapCanvas.jsx',
      'src/components/tenure/TenureMap.jsx',
    ];
    for (const path of consumers) {
      const own = tileUrlsInSource.filter((t) => t.path === path);
      expect(own, `${path} hard-codes a tile URL instead of reading basemapConfig`).toEqual([]);
      expect(readFileSync(path, 'utf8'), `${path} no longer reads the shared basemaps`).toMatch(/basemapConfig/);
    }
  });

  it('previews each basemap with the tiles that basemap actually draws', () => {
    for (const key of BASEMAP_KEYS) {
      const { url } = BASEMAPS[key];
      const thumb = basemapThumb(key);
      if (!url) {
        expect(thumb, 'the blank basemap has no tiles to preview').toBeNull();
        continue;
      }
      expect(thumb.startsWith(url.split('{')[0])).toBe(true);
      expect(thumb, 'an unsubstituted placeholder would 404').not.toMatch(/[{}]/);
    }
  });

  it('credits and names every basemap that draws tiles', () => {
    for (const key of BASEMAP_KEYS) {
      expect(BASEMAPS[key].label, `${key} has no label for the picker`).toBeTruthy();
      if (BASEMAPS[key].url) {
        expect(BASEMAPS[key].attribution, `${key} is served uncredited`).toBeTruthy();
      }
    }
  });

  it('falls back to a real basemap for a key it does not know', () => {
    // Saved projects carry whatever basemap key was current when they were
    // saved, including one that has since been renamed or removed.
    expect(basemapConfig('a_basemap_that_was_removed')).toBe(BASEMAPS.light);
    expect(basemapConfig(undefined)).toBe(BASEMAPS.light);
  });
});

describe('the map keeps drawing past the end of a tile cache', () => {
  it('says how deep each cache goes', () => {
    // Esri's canvas basemaps stop at 16 and the topographic map at 19. Asking
    // for level 20 does not fall back — it returns nothing, and the ground
    // disappears from under the claims at exactly the zoom a property is read
    // at. maxNativeZoom is what turns that into an upscaled tile instead.
    for (const key of BASEMAP_KEYS) {
      const { url, maxNativeZoom } = BASEMAPS[key];
      if (!url || maxNativeZoom === undefined) continue;
      expect(Number.isInteger(maxNativeZoom)).toBe(true);
      expect(maxNativeZoom).toBeGreaterThan(0);
      expect(maxNativeZoom).toBeLessThanOrEqual(21);
    }
    expect(BASEMAPS.light.maxNativeZoom, 'the default basemap must declare its limit').toBe(16);
  });

  it('hands that limit to Leaflet', () => {
    // Declaring it in the config and not passing it through is the same blank
    // map with more code.
    const mapCanvas = readFileSync('src/components/MapCanvas.jsx', 'utf8');
    expect(mapCanvas).toMatch(/maxNativeZoom: cfg\.maxNativeZoom/);
    expect(readFileSync('src/components/tenure/TenureMap.jsx', 'utf8')).toMatch(/maxNativeZoom/);
  });
});
