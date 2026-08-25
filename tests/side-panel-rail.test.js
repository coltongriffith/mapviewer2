import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SIDE_PANEL_GRID,
  resolveSidePanelZones,
  sidePanelTemplate,
} from '../src/templates/sidePanelTemplate.js';

const SIZE = { width: 1200, height: 800 };
const ITEMS = [{ id: 'a', label: 'Claims' }, { id: 'b', label: 'Drillholes' }];

function zones(layout) {
  return resolveSidePanelZones(sidePanelTemplate, layout, SIZE, ITEMS);
}

describe('technical side-panel rail', () => {
  it('reads title → legend → locator → footer down the rail', () => {
    const z = zones({
      logo: 'data:image/png;base64,AA',
      sidePanelGrid: DEFAULT_SIDE_PANEL_GRID,
      insetEnabled: true,
      footerEnabled: true,
      footerText: 'Source: BC MTO',
    });
    expect(z.logo.top).toBeLessThan(z.title.top);
    expect(z.title.top).toBeLessThan(z.legend.top);
    expect(z.legend.top).toBeLessThan(z.inset.top);
    expect(z.inset.top).toBeLessThan(z.footer.top);
  });

  it('lifts the title out of the bottom of a legacy save that never stored one', () => {
    // Projects saved before the rail carried a title element. The old migration
    // appended it, which put the title below the locator inset.
    const z = zones({
      logo: 'data:image/png;base64,AA',
      sidePanelGrid: ['inset', 'legend', 'logo'],
      insetEnabled: true,
    });
    expect(z.title.top).toBeLessThan(z.inset.top);
    expect(z.title.top).toBeLessThan(z.legend.top);
  });

  it('keeps the footer inside the canvas when everything asks for too much room', () => {
    const z = zones({
      logo: 'data:image/png;base64,AA',
      sidePanelGrid: DEFAULT_SIDE_PANEL_GRID,
      insetEnabled: true,
      insetHeightPx: 300,
      legendHeightPx: 400,
      titleHeightPx: 180,
      logoHeightPx: 160,
      footerEnabled: true,
      footerText: 'Source: BC MTO',
      footerHeightPx: 60,
    });
    expect(z.footer.top + z.footer.height).toBeLessThanOrEqual(SIZE.height);
    expect(z.footer.height).toBe(60);
    expect(z.legend.height).toBeGreaterThanOrEqual(60);
  });

  it('leaves a saved element order alone', () => {
    const z = zones({
      sidePanelGrid: ['title', 'inset', 'legend'],
      insetEnabled: true,
    });
    expect(z.title.top).toBeLessThan(z.inset.top);
    expect(z.inset.top).toBeLessThan(z.legend.top);
  });
});

describe('map scale denominator', () => {
  // A fake Leaflet map: 800px wide, and 100 container pixels span ~2.5 km,
  // i.e. 25 m per pixel — a regional figure.
  const map = {
    getSize: () => ({ x: 800, y: 600 }),
    containerPointToLatLng: ([x]) => ({ lat: 54, lng: -128 + (x * 25) / (111320 * Math.cos((54 * Math.PI) / 180)) }),
  };

  it('reports a printable scale, not metres per pixel', async () => {
    const { scaleDenomFromMap, formatScaleDenom } = await import('../src/utils/geo.js');
    const denom = scaleDenomFromMap(map);
    // 25 m/px at 96 dpi ≈ 1:94,500 → rounded to a presentable step.
    expect(denom).toBeGreaterThan(50_000);
    expect(denom).toBeLessThan(200_000);
    expect(formatScaleDenom(denom)).toMatch(/^1:[\d,]+$/);
  });

  it('has no scale to report without a map', async () => {
    const { scaleDenomFromMap, formatScaleDenom } = await import('../src/utils/geo.js');
    expect(scaleDenomFromMap(null)).toBeNull();
    expect(formatScaleDenom(null)).toBe('');
  });
});
