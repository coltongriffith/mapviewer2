import L from 'leaflet';

// An imported figure on the editor map, turned and scaled by its fit.
//
// L.imageOverlay stretches a picture into a north-up box, which is right for a
// world-file grid but not for a figure drawn at 45°. This places the <img> by
// three of its corners (top-left, top-right, bottom-left, in lat/lng) with a
// CSS matrix, recomputed on every zoom like Leaflet's own image overlay, so
// the editor shows what the exporters draw from the same corners.
// Fetched only when a map has such a layer.

const FigureOverlay = L.Layer.extend({
  options: { pane: 'overlayPane', zIndex: null },

  initialize(raster, options) {
    this._raster = raster;
    L.setOptions(this, options);
  },

  onAdd() {
    const r = this._raster;
    const img = L.DomUtil.create('img', 'leaflet-image-layer leaflet-zoom-animated');
    img.alt = '';
    img.src = r.dataUri;
    Object.assign(img.style, {
      position: 'absolute', left: '0', top: '0', width: `${r.width}px`, height: `${r.height}px`,
      maxWidth: 'none', transformOrigin: '0 0', pointerEvents: 'none', opacity: String(r.opacity ?? 0.85),
    });
    if (this.options.zIndex != null) img.style.zIndex = String(this.options.zIndex);
    this._img = img;
    this.getPane().appendChild(img);
    this._reset();
  },

  onRemove() {
    L.DomUtil.remove(this._img);
    this._img = null;
  },

  getEvents() {
    return { zoom: this._reset, viewreset: this._reset, zoomanim: this._animate };
  },

  setCorners(corners) {
    this._raster = { ...this._raster, corners };
    if (this._map) this._reset();
    return this;
  },

  setOpacity(opacity) {
    this._raster = { ...this._raster, opacity };
    if (this._img) this._img.style.opacity = String(opacity);
    return this;
  },

  _place(project) {
    const { corners, width: w, height: h } = this._raster;
    if (!this._img || !corners) return;
    const [tl, tr, bl] = ['tl', 'tr', 'bl'].map((k) => project(L.latLng(corners[k][0], corners[k][1])));
    this._img.style.transform = `matrix(${(tr.x - tl.x) / w},${(tr.y - tl.y) / w},${(bl.x - tl.x) / h},${(bl.y - tl.y) / h},${tl.x},${tl.y})`;
  },

  _reset() {
    this._place((ll) => this._map.latLngToLayerPoint(ll));
  },

  _animate(e) {
    this._place((ll) => this._map._latLngToNewLayerPoint(ll, e.zoom, e.center));
  },
});

export function figureOverlay(raster, options) {
  return new FigureOverlay(raster, options);
}
