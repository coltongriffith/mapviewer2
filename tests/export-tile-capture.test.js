import { describe, it, expect, beforeEach } from 'vitest';
import { getTileImages } from '../src/export/renderScene.js';

// Which tiles an export claims as "this map's".
//
// The satellite locator is a second Leaflet map nested inside the stage the
// main-map export captures. A plain descendant query for tiles collected the
// inset's as well, and the main pass then drew province-scale imagery at the
// inset's screen position, unclipped — a rectangle of foreign terrain sitting
// around the inset card in every export that used the locator.
//
// It was invisible in the editor: the inset wrapper's `overflow: hidden` hides
// the spill on screen, while the tiles keep reporting full-size boxes to
// getBoundingClientRect. So the editor looked right and only the PDF was wrong.

function rect(el, { x, y, w, h }) {
  el.getBoundingClientRect = () => ({
    left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y,
  });
}

function tile(href) {
  const img = document.createElement('img');
  img.className = 'leaflet-tile';
  // Only when there is one: assigning '' makes jsdom resolve the document URL,
  // which would make a "source-less" tile look like it has a source.
  if (href) img.src = href;
  return img;
}

function buildStage() {
  // stage
  //  ├── main map (.leaflet-container) → tile pane → 2 tiles
  //  └── inset card → .satellite-inset-map (.leaflet-container) → 1 tile
  document.body.innerHTML = `
    <div class="map-stage">
      <div class="leaflet-container main">
        <div class="leaflet-tile-pane"></div>
      </div>
      <div class="inset-card">
        <div class="inset-satellite-wrap">
          <div class="satellite-inset-map leaflet-container">
            <div class="leaflet-tile-pane"></div>
          </div>
        </div>
      </div>
    </div>`;

  const stage = document.querySelector('.map-stage');
  const mainPane = document.querySelector('.leaflet-container.main .leaflet-tile-pane');
  const inset = document.querySelector('.satellite-inset-map');
  const insetPane = inset.querySelector('.leaflet-tile-pane');

  rect(stage, { x: 0, y: 0, w: 1000, h: 800 });
  rect(document.querySelector('.leaflet-container.main'), { x: 0, y: 0, w: 1000, h: 800 });
  rect(mainPane, { x: 0, y: 0, w: 1000, h: 800 });
  rect(inset, { x: 700, y: 40, w: 220, h: 132 });
  rect(insetPane, { x: 700, y: 40, w: 220, h: 132 });

  const mainA = tile('https://basemap.example/8/1/1.png');
  const mainB = tile('https://basemap.example/8/1/2.png');
  mainPane.append(mainA, mainB);
  rect(mainA, { x: 0, y: 0, w: 256, h: 256 });
  rect(mainB, { x: 256, y: 0, w: 256, h: 256 });

  // Scaled past the card, the way fractional zoom leaves them.
  const insetTile = tile('https://imagery.example/3/1/0.png');
  insetPane.append(insetTile);
  rect(insetTile, { x: 660, y: 10, w: 294, h: 294 });

  return { stage, inset, insetTile };
}

describe('getTileImages', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('leaves the nested locator out of the main map capture', () => {
    const { stage } = buildStage();
    const hrefs = getTileImages(stage).map((t) => t.href);
    expect(hrefs).toHaveLength(2);
    expect(hrefs.every((h) => h.includes('basemap.example'))).toBe(true);
    expect(hrefs.some((h) => h.includes('imagery.example'))).toBe(false);
  });

  it('still captures the locator when the locator is what is being captured', () => {
    // The inset panel draws itself from the same helper, so the filter has to
    // recognise the inset as its own root rather than exclude it outright.
    const { inset } = buildStage();
    const hrefs = getTileImages(inset).map((t) => t.href);
    expect(hrefs).toEqual(['https://imagery.example/3/1/0.png']);
  });

  it('reports positions relative to the capture root', () => {
    const { stage } = buildStage();
    const [first] = getTileImages(stage);
    expect(first.x).toBe(0);
    expect(first.y).toBe(0);
    expect(first.width).toBe(256);
  });

  it('reports the locator tile relative to the locator, not the page', () => {
    const { inset } = buildStage();
    const [only] = getTileImages(inset);
    // Tile at page x=660 inside a container at x=700 sits 40px to its left.
    expect(only.x).toBe(-40);
    expect(only.y).toBe(-30);
  });

  it('drops tiles with no source or no size', () => {
    const { stage } = buildStage();
    const pane = document.querySelector('.leaflet-container.main .leaflet-tile-pane');
    const empty = tile('');
    const zero = tile('https://basemap.example/8/9/9.png');
    pane.append(empty, zero);
    rect(empty, { x: 0, y: 0, w: 256, h: 256 });
    rect(zero, { x: 0, y: 0, w: 0, h: 0 });
    expect(getTileImages(stage)).toHaveLength(2);
  });
});
