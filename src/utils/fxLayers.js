import L from 'leaflet';
import { fxScene, mapView, paintFxCanvas, washPrims } from './geoStyle.js';
import { panelObstacles } from './calloutLayout';
import { getMapFrame } from './coordinateFrame.js';
import { getFeatureStyle, canDissolve } from './featureStyle.js';
import { featureKey } from './featureIdentity.js';

// The geology and label styling (utils/geoStyle.js) on the editor's Leaflet map, painted by the same canvas
// painter as the PNG export, on three canvases in their own panes so they stack as the exporters draw them:
// the wash over the basemap (under images, z 310), the styled layers under the plain data layers (z 390), and
// the labels over every data layer and marker (z 640). Each is a Leaflet Canvas renderer with no paths of its
// own, so it follows pans, zooms (with the zoom animation) and high-DPI screens as the map's renderer does,
// and never takes a click: the layers' own (invisible) paths stay on the map for selecting them.

const PANES = { wash: 310, band: 390, labels: 640 };

const FxCanvas = L.Canvas.extend({
  initialize(paint, options) {
    L.Canvas.prototype.initialize.call(this, { padding: 0.25, ...options });
    this._paint = paint;
  },
  onAdd() {
    L.Canvas.prototype.onAdd.call(this);
    this._container.style.pointerEvents = 'none';
  },
  _update() {
    if (this._map._animatingZoom && this._bounds) return;
    L.Canvas.prototype._update.call(this);
    this.repaint();
  },
  repaint() {
    const ctx = this._ctx;
    if (!ctx || !this._map || !this._bounds) return;
    const b = this._bounds, o = this._map.containerPointToLayerPoint([0, 0]);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._container.width, this._container.height);
    ctx.restore();
    // The canvas is set up in layer px; the paint is in container px.
    ctx.save();
    ctx.translate(o.x, o.y);
    this._paint(ctx, b.getSize());
    ctx.restore();
  },
  // Leaflet's own redraws (a view reset, a non-animated zoom) clear the canvas and call this: paint again.
  _draw() { this.repaint(); },
});

function paneFor(map, key) {
  const name = `emFx${key}`;
  const pane = map.getPane(name) || map.createPane(name);
  pane.style.zIndex = PANES[key];
  pane.style.pointerEvents = 'none';
  return name;
}

// What the canvases draw from, out of the editor's state: the visible layers with fx, each with the shapes the
// exporters draw (renderScene getLayerGeojson: dissolved as the layer asks, except while its shapes are being
// removed or styled one by one) and their styles; the panels the labels step clear of (the legend counts once it
// has rows, as in the export); the map's clear rect inside a coordinate frame.
function inputOf({ project, template, zones, legendItems, geometry, trimLayerId, featureStyleLayerId }) {
  const layout = project?.layout || {};
  return {
    layers: (project?.layers || []).filter((l) => l.fx && l.visible !== false && l.geojson),
    wash: layout.wash,
    obstacles: zones ? panelObstacles(zones, { ...layout, legendItems: legendItems || [] }) : [],
    family: layout.fonts?.label || 'Inter',
    frameOf: (size) => getMapFrame(layout, { width: size.x, height: size.y }, { sidebarFrac: template?.sidebarFrac }),
    entry: (layer) => {
      const line = layer.type === 'line' || (layer.geojson.features || []).some((f) => String(f?.geometry?.type).includes('Line'));
      const geojson = geometry(layer, { dissolve: canDissolve(layer) && !line && trimLayerId !== layer.id && featureStyleLayerId !== layer.id });
      return { layer, features: geojson?.type === 'FeatureCollection' ? geojson.features || [] : geojson ? [geojson] : [], styleOf: (f) => getFeatureStyle(template, layer, f, featureKey(f)) };
    },
  };
}

/**
 * Brings the map's fx canvases up to date from the editor's state (see inputOf). state: the previous return
 * value (or null). Returns the new state; the map fires 'emfxreport' with the labels that still overlap something.
 */
export function syncFx(map, state, editor) {
  const s = state || { canvases: {}, input: null, scene: null };
  const input = inputOf(editor);
  s.input = input;
  const want = { wash: !!washPrims(input.wash, 1, 1).length, band: input.layers.length > 0, labels: input.layers.some((l) => l.fx?.label && l.fx.label.on !== false) };
  const scene = () => {
    if (s.scene) return s.scene;
    const size = map.getSize();
    s.scene = fxScene(s.input.layers.map(s.input.entry), mapView(map, size.x, size.y, { obstacles: s.input.obstacles, family: s.input.family, frame: s.input.frameOf?.(size) }));
    map.emFxReport = { overlaps: s.scene.overlaps, placed: s.scene.placed };
    map.fire('emfxreport', map.emFxReport);
    return s.scene;
  };
  const paint = {
    wash: (ctx, pad) => { const size = map.getSize(); paintFxCanvas(ctx, washPrims(s.input.wash, size.x, size.y, Math.max(pad.x, pad.y))); },
    band: (ctx) => paintFxCanvas(ctx, scene().band),
    labels: (ctx) => paintFxCanvas(ctx, scene().labels),
  };
  if (!s.listening) {
    // A new view lays out again (labels are placed for what is on screen); the band repaints from it.
    s.listening = () => { s.scene = null; };
    map.on('moveend zoomend viewreset resize', s.listening);
  }
  s.scene = null;
  Object.keys(PANES).forEach((key) => {
    const c = s.canvases[key];
    if (!want[key]) { if (c) { map.removeLayer(c); delete s.canvases[key]; } return; }
    if (c) c.repaint();
    else s.canvases[key] = new FxCanvas(paint[key], { pane: paneFor(map, key) }).addTo(map);
  });
  if (!Object.keys(s.canvases).length && s.listening) { map.off('moveend zoomend viewreset resize', s.listening); s.listening = null; }
  return s;
}
