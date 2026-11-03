import { createPropertyBoundaryResolver } from './propertyBoundaryGeometry.js';
import { getTemplateStyle } from './featureStyle.js';

const resolve = createPropertyBoundaryResolver();
const hex = /^#[0-9a-f]{6}$/i;
const unavailable = (reason) => ({ ok: false, reason, primitives: [] });
const alpha = (value) => Number.isFinite(value) ? Math.max(0,Math.min(1,value)) : 1;

// Clip original segments, never close a clipped path along the viewport edge:
// an invented closing edge could look like a supplied property boundary.
function clip(a, b, box) {
  const dx = b[0]-a[0], dy = b[1]-a[1];
  let lo = 0, hi = 1;
  for (const [p,q] of [[-dx,a[0]-box.left],[dx,box.right-a[0]],[-dy,a[1]-box.top],[dy,box.bottom-a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q/p;
    if (p < 0) lo = Math.max(lo,t); else hi = Math.min(hi,t);
    if (lo > hi) return null;
  }
  return [[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]];
}

/** One stroke plan for native/read-only/PNG/SVG. Explicit setting only. The
 * ordinary feature paths remain untouched and this overlay owns no hit targets.
 */
export function propertyBoundaryScene(project, view, { template, trimLayerId, featureStyleLayerId } = {}) {
  const enabled = project?.layout?.propertyBoundaryOutline === true;
  if (!enabled) return unavailable('disabled');
  const selectedId = project.layout.primaryLayerId;
  if (selectedId && (trimLayerId === selectedId || featureStyleLayerId === selectedId)) return unavailable('editing-source');
  const derived = resolve(project,{ enabled });
  if (!derived.ok) return unavailable(derived.reason);
  const layer = project.layers.find((l) => l.id === derived.layerId);
  const style = getTemplateStyle(template,layer);
  const baseWidth = Number.isFinite(style.strokeWidth) ? style.strokeWidth : 2.2;
  const opacity = alpha(style.opacity)*alpha(style.layerOpacity);
  if (baseWidth <= 0 || opacity === 0) return unavailable('stroke-hidden');
  const sw = Math.min(24,baseWidth+2), half = sw/2;
  const frame = view.frame || { left: 0, top: 0, right: view.W, bottom: view.H };
  if (![frame.left,frame.top,frame.right,frame.bottom].every(Number.isFinite)) return unavailable('invalid-frame');
  const box = { left: frame.left+half, top: frame.top+half, right: frame.right-half, bottom: frame.bottom-half };
  if (box.right <= box.left || box.bottom <= box.top) return unavailable('invalid-frame');
  const lines = [];
  for (const feature of derived.geometry.features) for (const ring of feature.geometry.coordinates) {
    const points = ring.map(([lng,lat]) => view.pt(lng,lat));
    if (points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) return unavailable('invalid-projection');
    for (let i = 1; i < points.length; i++) {
      const segment = clip(points[i-1],points[i],box);
      if (segment && (segment[0][0] !== segment[1][0] || segment[0][1] !== segment[1][1])) lines.push(segment);
    }
  }
  return { ok: true, reason: null, layerId: derived.layerId, primitives: lines.length
    ? [{ t: 'stroke', lines, closed: false, stroke: hex.test(style.stroke || '') ? style.stroke : '#233b43', sw, opacity, cap: 'round' }] : [] };
}
