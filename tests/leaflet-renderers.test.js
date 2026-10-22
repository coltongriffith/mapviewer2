import { afterEach, describe, expect, it, vi } from 'vitest';
import L from 'leaflet';
import { pathRenderer } from '../src/utils/leafletRenderers.js';

afterEach(() => vi.restoreAllMocks());

describe('pathRenderer', () => {
  it('is SVG where the browser has it', () => {
    vi.spyOn(L.Browser, 'svg', 'get').mockReturnValue(true);
    expect(pathRenderer()).toBeInstanceOf(L.SVG);
  });

  it('is Canvas where SVG fails its test but a 2D context exists', () => {
    vi.spyOn(L.Browser, 'svg', 'get').mockReturnValue(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    expect(pathRenderer()).toBeInstanceOf(L.Canvas);
  });

  it('is null where neither can draw, rather than the null renderer Leaflet would add paths with', () => {
    vi.spyOn(L.Browser, 'svg', 'get').mockReturnValue(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(pathRenderer()).toBeNull();
  });
});

describe('Canvas redraw', () => {
  it('cancels a frame still pending when a redraw runs, so removing the map cancels every frame', () => {
    const cancel = vi.spyOn(L.Util, 'cancelAnimFrame');
    const renderer = L.canvas();
    renderer._ctx = { save() {}, restore() {}, setTransform() {}, clearRect() {}, beginPath() {}, rect() {}, clip() {} };
    renderer._container = { width: 1, height: 1 };
    renderer._layers = {};
    renderer._drawFirst = null;
    renderer._redrawRequest = 7; // requested by an earlier change, not yet run
    renderer._redraw(); // a synchronous redraw from a view change
    expect(cancel).toHaveBeenCalledWith(7);
    expect(renderer._redrawRequest).toBeNull();
  });
});
