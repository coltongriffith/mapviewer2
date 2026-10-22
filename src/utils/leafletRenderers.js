import L from 'leaflet';

// Two Leaflet 1.9.4 renderer faults that reached error_events.
//
// 1. Leaflet's default renderer can be null. Map#getRenderer falls back to L.svg() or, with preferCanvas,
//    L.canvas(), and each answers null when its feature test fails (L.Browser.svg checks
//    SVGSVGElement#createSVGRect). getRenderer then calls hasLayer(null), which throws "Cannot use 'in'
//    operator to search for '_leaflet_id' in null" from inside addLayer, after the path was already put in
//    the map's layers; the map's removal later finds that path with no renderer and throws "Cannot read
//    properties of undefined (reading '_removePath')". Both were seen together on the phone claims viewer,
//    from browsers whose SVG test fails. pathRenderer() picks a renderer that works, or says there is none,
//    so a caller never adds a path that cannot be drawn.
//
// 2. A Canvas redraw that outlives its renderer. Canvas#_redraw clears _redrawRequest when it runs, but a
//    synchronous redraw (any view change: setView, fitBounds, invalidateSize) runs while a frame requested
//    earlier is still pending, and forgets that frame without cancelling it. Removing the map then cancels
//    only the newest request and deletes the canvas context, and the forgotten frame runs against it:
//    "Cannot read properties of undefined (reading 'clearRect')" at _clear <- _redraw. The fix cancels the
//    pending frame whenever a redraw runs, so a renderer never has more than one frame outstanding and
//    removal (which cancels _redrawRequest) cancels it.

const redraw = L.Canvas.prototype._redraw;
if (!redraw.emPendingFrameFix) {
  const fixed = function _redraw() {
    if (this._redrawRequest) L.Util.cancelAnimFrame(this._redrawRequest);
    return redraw.call(this);
  };
  fixed.emPendingFrameFix = true;
  L.Canvas.include({ _redraw: fixed });
}

const canvasWorks = () => Boolean(L.Browser.canvas && document.createElement('canvas').getContext('2d'));

/**
 * A renderer for vector paths on a map: SVG where the browser has it, else Canvas where a 2D context is
 * available, else null (no vector layer can be drawn; the caller leaves them off the map).
 * @param {object} [options] renderer options (padding, tolerance…)
 * @returns {L.Renderer|null}
 */
export function pathRenderer(options) {
  if (L.Browser.svg) return L.svg(options);
  if (canvasWorks()) return L.canvas(options);
  return null;
}
