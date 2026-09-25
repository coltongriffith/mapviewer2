import { EXPORT_RATIOS } from '../constants';
import { logicalStageSize } from './stageScale';

// Fixed logical stage the author framed the map on (export shape or custom
// pixel size), or null for a free-form stage that fills the window.
export function projectStageSize(layout) {
  const w = layout?.exportSettings?.customWidth || 0;
  const h = layout?.exportSettings?.customHeight || 0;
  if (w > 0 && h > 0) return logicalStageSize(w / h);
  const r = layout?.exportRatio;
  return r && EXPORT_RATIOS[r] ? logicalStageSize(EXPORT_RATIOS[r].ratio) : null;
}

const validView = (v) => v?.center && Number.isFinite(v.center.lat) && Number.isFinite(v.center.lng) && Number.isFinite(v.zoom);

// The view the project was saved/shared at, with the stage size it was framed
// on (width/height may be missing on old projects).
export function savedViewFor(project) {
  const layout = project?.layout;
  const r = layout?.exportRatio;
  const custom = (layout?.exportSettings?.customWidth || 0) > 0 && (layout?.exportSettings?.customHeight || 0) > 0;
  const rv = r && !custom ? project?.ratioMapStates?.[r] : null;
  if (validView(rv)) {
    const s = projectStageSize(layout);
    return { center: rv.center, zoom: rv.zoom, width: s?.width, height: s?.height };
  }
  const mv = project?.mapView;
  if (validView(mv)) return { center: mv.center, zoom: mv.zoom, width: mv.screenW, height: mv.screenH };
  return null;
}

// Zoom that keeps the saved extent in view on a stage of a different size.
export function zoomForSize(view, width, height) {
  if (!view.width || !view.height || !width || !height) return view.zoom;
  const k = Math.min(width / view.width, height / view.height);
  return Number.isFinite(k) && k > 0 ? view.zoom + Math.log2(k) : view.zoom;
}
