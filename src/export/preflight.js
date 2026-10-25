// Export preflight: the opt-in "Publication check" run before a 2D download.
//
// It looks at the figure the exporter is about to draw (the same logical
// stage, template zones, callout placement and legend layout renderScene.js
// uses, at the output's real size) and returns structured diagnostics
// (shared/figureDiagnostics.js) for a user to review. It never changes the
// project or the export: an ordinary download does not run it, and a user can
// export anyway past a visual warning.
//
// The checks renderScene already makes at export time (callout collisions,
// truncated legends, missing assets, fonts) are reused through its exported
// helpers and an export context, so the preflight and the export agree.
// Waits for imagery and fonts are bounded: a slow host yields a diagnostic,
// never a hang.

import { diagnostic, mergeDiagnostics, unionBounds, needsReview } from '../../shared/figureDiagnostics.js';
import {
  createExportContext, ensureExportFonts, getTileImages, loadImage, placeCallouts, calloutCardMetrics,
  legendLayoutReport, exportFrame, getTheme, fitText, titleTextSizes, getOverlayMetrics, mapLabelOverlaps, creditLinesFor,
} from './renderScene.js';
import { disclosureChecks, standardOf } from '../../shared/disclosure.js';
import { projectionLabel, NI_TEMPLATE_ID } from '../utils/coordinateFrame.js';
import { panelObstacles } from '../utils/calloutLayout';
import { PDF_SIZES } from './exportPDF.js';
import { hasVisibleFeatures, layerFeatures } from '../utils/featureIdentity.js';
import { legendEntryIds } from '../utils/legendCustomization.js';

// For the editor: whether the findings need the user to look before downloading.
export { needsReview };

// Smallest readable text: print in points at the page's physical size, a
// slide in points on a 13.33 in wide 16:9 slide, a screen image in CSS px at
// its 1x size.
export const MIN_TEXT = { print: 6, slide: 7, screen: 8 };
const SLIDE_WIDTH_IN = 13.33;
const DEFAULT_TIMEOUT_MS = 5000;

const withTimeout = (promise, ms) => {
  let timer;
  return Promise.race([
    Promise.resolve(promise).then(() => 'ok', () => 'failed'),
    new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), ms); }),
  ]).finally(() => clearTimeout(timer));
};
const name = (c) => {
  const t = String(c.text || c.label || c.badgeValue || '').split('\n')[0].trim();
  return t ? `“${t.length > 40 ? `${t.slice(0, 39)}…` : t}”` : 'A callout';
};
const fmt = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

// What one composition px becomes in the output, and the minimum to compare with.
export function textScale(scene, options = {}) {
  if (options.format === 'pdf') {
    const size = PDF_SIZES[options.pdfSize] || PDF_SIZES.letter_landscape;
    const aspect = scene.width / scene.height;
    // The page letterboxes the image, as exportPDF does.
    const widthIn = aspect > size.w / size.h ? size.w : size.h * aspect;
    return { medium: 'print', unit: 'pt', perPx: (widthIn * 72) / scene.width, min: MIN_TEXT.print, where: `on a ${size.label} page` };
  }
  if (scene.project?.layout?.exportRatio === 'landscape') {
    return { medium: 'slide', unit: 'pt', perPx: (SLIDE_WIDTH_IN * 72) / scene.width, min: MIN_TEXT.slide, where: 'on a 16:9 slide' };
  }
  return { medium: 'screen', unit: 'px', perPx: 1, min: MIN_TEXT.screen, where: 'at its normal size' };
}

// Canvas text metrics when there is a canvas; an average glyph width when
// there is not (tests), so the checks still run.
function textMeasurer() {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx?.measureText) return ctx;
  } catch { /* no canvas */ }
  return {
    font: '12px sans-serif',
    measureText(text) { return { width: String(text).length * (Number(/([\d.]+)px/.exec(this.font)?.[1]) || 12) * 0.56 }; },
  };
}

// A tile that loaded with nothing in it (a transparent placeholder answered
// with HTTP 200). Sampled on a small canvas; an image that cannot be read (no
// canvas, a tainted cross-origin canvas) counts as fine.
export function isBlankImage(img) {
  try {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const ctx = c.getContext('2d');
    if (!ctx?.getImageData) return false;
    ctx.drawImage(img, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
    return true;
  } catch { return false; }
}

function frameBox(scene) {
  const f = exportFrame(scene, 1);
  return f ? { left: f.mapLeft, top: f.mapTop, right: f.mapRight, bottom: f.mapBottom } : { left: 0, top: 0, right: scene.width, bottom: scene.height };
}
const outside = (b, F) => b.left < F.left - 0.5 || b.top < F.top - 0.5 || b.left + b.width > F.right + 0.5 || b.top + b.height > F.bottom + 0.5;
const pointIn = (p, F) => p && p.x >= F.left && p.x <= F.right && p.y >= F.top && p.y <= F.bottom;

async function checkImagery(scene, { timeoutMs, load }, out) {
  if ((scene.project.layout || {}).basemap === 'blank' || !scene.container) return;
  const F = frameBox(scene);
  const tiles = getTileImages(scene.container)
    .filter((t) => t.x < F.right && t.y < F.bottom && t.x + t.width > F.left && t.y + t.height > F.top);
  if (!tiles.length) {
    out.push(diagnostic({ code: 'imagery-missing', message: 'no basemap imagery is showing on the map', action: 'wait for the map to load, or choose another basemap' }));
    return;
  }
  if (tiles.every((t) => t.opacity < 0.05)) {
    out.push(diagnostic({ code: 'imagery-invisible', message: 'the basemap imagery is fully transparent', action: 'raise the basemap opacity' }));
  }
  // The export draws tiles fetched with CORS: a tile that cannot be fetched
  // that way is a blank square in the file even if the editor shows it.
  const probe = (t) => load(t.href, 'anonymous', timeoutMs).then((img) => (isBlankImage(img) ? Promise.reject(new Error('blank')) : img));
  const results = await Promise.all(tiles.map((t) => withTimeout(probe(t), timeoutMs)));
  const failed = tiles.filter((_, i) => results[i] === 'failed');
  const slow = tiles.filter((_, i) => results[i] === 'timeout');
  const box = (list) => unionBounds(list.map((t) => ({ left: t.x, top: t.y, width: t.width, height: t.height })));
  if (failed.length) {
    out.push(diagnostic({ code: 'imagery-tile-failed', bounds: box(failed), message: `${failed.length} of ${tiles.length} imagery tiles failed to load or are empty, and will export blank`, action: 'pan the map slightly or switch basemap, then check again' }));
  }
  if (slow.length) {
    out.push(diagnostic({ code: 'imagery-timeout', bounds: box(slow), message: `${slow.length} imagery tile${slow.length === 1 ? ' was' : 's were'} still loading after ${Math.round(timeoutMs / 1000)} s`, action: 'check the connection and run the check again' }));
  }
}

async function checkAssets(scene, { timeoutMs, load }, out) {
  const layout = scene.project.layout || {};
  const assets = [
    layout.logo && { src: layout.logo, id: 'logo', what: 'logo' },
    layout.insetMode === 'custom_image' && layout.insetImage && { src: layout.insetImage, id: 'inset', what: 'inset image' },
    ...(scene.project.callouts || []).filter((c) => c.logo?.image && c.type !== 'badge').map((c) => ({ src: c.logo.image, id: c.id, what: 'callout logo' })),
    ...(scene.project.markers || []).filter((m) => m.type === 'image' && m.image).map((m) => ({ src: m.image, id: m.id, what: 'placed logo' })),
  ].filter(Boolean);
  const results = await Promise.all(assets.map((a) => withTimeout(load(a.src, null, timeoutMs), timeoutMs)));
  assets.forEach((a, i) => {
    if (results[i] !== 'ok') out.push(diagnostic({ code: 'asset-missing', elementId: a.id, message: `the ${a.what} could not be loaded and will be left out`, action: 'upload it again' }));
  });
}

function checkCallouts(scene, measure, sizes, out) {
  const callouts = scene.project.callouts || [];
  for (const c of callouts) {
    const a = c.anchor;
    if (!a || !Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lng))) {
      out.push(diagnostic({ code: 'interval-geometry-invalid', severity: 'error', elementId: c.id, message: `${name(c)} has no valid map position and is left out of the export`, action: 'set its anchor on the map, or delete it' }));
    }
    const from = c.fromM ?? c.interval?.fromM, to = c.toM ?? c.interval?.toM;
    if ((from != null || to != null) && !(Number.isFinite(Number(from)) && Number.isFinite(Number(to)) && Number(from) >= 0 && Number(to) > Number(from))) {
      out.push(diagnostic({ code: 'interval-geometry-invalid', severity: 'error', elementId: c.id, message: `${name(c)} has an invalid interval (${from ?? '?'}–${to ?? '?'} m)`, action: 'correct From and To in the source table' }));
    }
  }
  if (!scene.map) return;
  const F = frameBox(scene);
  const font = `${scene.project.layout?.fonts?.callout || 'Inter'}, Arial, sans-serif`;
  // placeCallouts records overlaps on the scene's export context, as the export does.
  for (const c of placeCallouts(scene, 1)) {
    if (!pointIn(c.anchorPx, F)) {
      out.push(diagnostic({ code: 'callout-anchor-outside', elementId: c.id, bounds: c, message: `${name(c)} points at a place outside the map frame`, action: 'pan the map to include it, or move its anchor' }));
    }
    if (c.type === 'badge') {
      const fs = c.style?.fontSize || 12;
      const chipW = Math.max(44, (c.badgeValue || '').length * 8 + 20);
      measure.font = `700 ${fs}px ${font}`;
      if (c.text && fitText(measure, c.text, c.width - chipW - 16) !== c.text) {
        out.push(diagnostic({ code: 'text-outside-card', elementId: c.id, bounds: c, message: `${name(c)} is cut short to fit its badge`, action: 'shorten the text' }));
      }
      if (outside(c, F)) out.push(diagnostic({ code: 'label-clipped', elementId: c.id, bounds: c, message: `${name(c)} is cut off at the edge of the map`, action: 'drag it inside the frame' }));
      sizes.push({ kind: 'callout', px: fs, id: c.id });
      continue;
    }
    const m = calloutCardMetrics(measure, c, 1, font, Boolean(c.logo?.image));
    const box = { left: c.left, top: c.top, width: c.width, height: Math.max(c.height, m.needed) };
    const wide = (lines, px, weight) => { measure.font = `${weight}${px}px ${font}`; return lines.some((l) => measure.measureText(l).width > m.maxTextW + 0.5); };
    if (c.type !== 'plain' && (wide(m.titleLines, m.fontSize, '700 ') || wide(m.subtextLines, m.subtextSize, ''))) {
      out.push(diagnostic({ code: 'text-outside-card', elementId: c.id, bounds: box, message: `text in ${name(c)} runs past its card`, action: 'widen the card or break the long word' }));
    }
    if (outside(box, F)) {
      out.push(diagnostic({ code: 'label-clipped', elementId: c.id, bounds: box, message: `${name(c)} is cut off at the edge of the map`, action: 'drag it inside the frame or shorten its text' }));
    }
    sizes.push({ kind: 'callout', px: m.subtextLines.length ? m.subtextSize : m.fontSize, id: c.id });
  }
}

function checkMarkerLabels(scene, measure, sizes, out) {
  if (!scene.map) return;
  const F = frameBox(scene);
  const labelFont = scene.project.layout?.fonts?.label || 'Inter';
  for (const marker of scene.project.markers || []) {
    if (!marker.label || !Number.isFinite(Number(marker.lat)) || !Number.isFinite(Number(marker.lng))) continue;
    const p = scene.map.latLngToContainerPoint([marker.lat, marker.lng]);
    if (!pointIn(p, F)) continue;
    let box, px;
    if (marker.type === 'maplabel') {
      px = marker.size || 28;
      measure.font = `${marker.bold !== false ? '700' : '400'} ${px}px ${labelFont}, Arial, sans-serif`;
      const w = measure.measureText(String(marker.label).toUpperCase()).width;
      // A rotated label: the bounding box of the turned text.
      const a = ((Number(marker.rotation) || 0) * Math.PI) / 180, cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
      const bw = w * cos + px * sin, bh = w * sin + px * cos;
      box = { left: p.x - bw / 2, top: p.y - bh / 2, width: bw, height: bh };
    } else {
      px = 12;
      measure.font = `700 ${px}px ${labelFont}, Arial, sans-serif`;
      box = { left: p.x + (marker.size || 18) * 0.5 + 8, top: p.y - 11, width: measure.measureText(marker.label).width + 16, height: 22 };
    }
    sizes.push({ kind: 'map label', px, id: marker.id });
    if (outside(box, F)) out.push(diagnostic({ code: 'label-clipped', elementId: marker.id, bounds: box, message: `label “${marker.label}” is cut off at the edge of the map`, action: 'move the marker or pan the map' }));
  }
}

function checkLegend(scene, measure, sizes, out) {
  const layout = scene.project.layout || {};
  const items = layout.legendItems || [];
  const report = legendLayoutReport(scene);
  if (report) {
    const lfs = layout.legendFontScale ?? 1;
    if (report.hidden.length) {
      const n = report.hidden.length;
      out.push(diagnostic({ code: 'legend-truncated', elementId: 'legend', bounds: report.zone, message: `${n} legend row${n === 1 ? '' : 's'} did not fit the legend panel`, action: 'enlarge it or switch the legend to compact' }));
    }
    const lp = getTheme(scene).panelAccentLeft ? 20 : 16;
    measure.font = `${report.labelPx * lfs}px ${layout.fonts?.legend || 'Inter'}, Arial, sans-serif`;
    const cut = report.rows.filter((r) => r.item && fitText(measure, r.item.label || 'Layer', report.zone.width - lp - 40) !== (r.item.label || 'Layer'));
    if (cut.length) out.push(diagnostic({ code: 'legend-label-truncated', elementId: 'legend', bounds: report.zone, message: `${cut.length} legend label${cut.length === 1 ? ' is' : 's are'} cut short`, action: 'widen the legend or shorten the labels' }));
    sizes.push({ kind: 'legend label', px: report.labelPx * lfs, id: 'legend' });
    if (report.rows.some((r) => r.heading)) sizes.push({ kind: 'legend heading', px: report.headingPx * lfs, id: 'legend' });
  }
  // A layer drawn on the map with no key: the reader cannot tell what it is.
  const keyed = new Set(items.flatMap((item) => legendEntryIds(item)).map(String));
  const missing = (scene.project.layers || []).filter((layer) => layer.visible !== false
    && !String(layer.id).startsWith('__ac_') && hasVisibleFeatures(layer)
    && ![...keyed].some((id) => id === String(layer.id) || id.startsWith(`${layer.id}::`)));
  if (!missing.length) return;
  if (layout.showLegend === false || !items.length) {
    out.push(diagnostic({ code: 'legend-row-missing', elementId: 'legend', message: `the legend is off, so ${missing.length} map layer${missing.length === 1 ? ' has' : 's have'} no key`, action: 'show the legend, unless the figure is captioned elsewhere' }));
    return;
  }
  missing.forEach((layer) => out.push(diagnostic({ code: 'legend-row-missing', elementId: layer.id, message: `“${layer.displayName || layer.legend?.label || layer.name || 'A layer'}” is on the map but not in the legend`, action: 'turn its legend row back on, or hide the layer' })));
}

// Panels laid over one another: the title, legend, locator, north arrow, scale bar and logo.
function checkPanelOverlaps(scene, out) {
  const boxes = panelObstacles(getOverlayMetrics(scene), scene.project.layout || {});
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
    if (a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height) {
      out.push(diagnostic({ code: 'panel-overlap', elementId: `${a.key}+${b.key}`, bounds: a, message: `the ${a.key} overlaps the ${b.key}`, action: 'drag one of them clear, or resize it' }));
    }
  }));
}

function checkTextSize(scene, options, sizes, out) {
  const ts = textScale(scene, options);
  const small = new Map();
  for (const z of sizes) {
    const eff = z.px * ts.perPx;
    if (eff >= ts.min - 1e-6) continue;
    const g = small.get(z.kind) || { n: 0, min: Infinity, id: z.id };
    g.n += 1; g.min = Math.min(g.min, eff);
    small.set(z.kind, g);
  }
  const verb = ts.medium === 'screen' ? 'shows' : 'prints';
  for (const [kind, g] of small) {
    out.push(diagnostic({
      code: 'text-too-small', elementId: g.n === 1 ? g.id : null,
      message: `${g.n === 1 ? `${kind} text` : `text in ${g.n} ${kind}s`} ${g.n === 1 ? verb : verb.replace(/s$/, '')} at ${fmt(g.min)} ${ts.unit} ${ts.where}`,
      action: `use at least ${ts.min} ${ts.unit}: enlarge the text${ts.medium === 'print' ? ' or choose a larger page' : ''}`,
    }));
  }
}

// "Assays pending" in a hole's attributes (not a claim's "Pending" status).
const pendingValue = ([k, v]) => /\b(assays?|results?)\s+(are\s+)?pending\b/i.test(String(v ?? '')) || (/assay|result/i.test(k) && /^\s*pending\s*$/i.test(String(v ?? '')));
// What a figure filed under its disclosure standard shows (shared/disclosure.js checks it).
export function disclosureFacts(scene) {
  const p = scene.project, layout = p.layout || {}, scaleBar = layout.showScaleBar !== false;
  const ni = (scene.template?.id || layout.templateId) === NI_TEMPLATE_ID && layout.showTitle !== false; // the title strip states the projection
  const shown = (p.layers || []).filter((l) => l.visible !== false && !String(l.id).startsWith('__ac_'));
  const footer = layout.footerEnabled !== false ? layout.footerText : '';
  // Only text the export draws: renderScene skips a hidden title or legend.
  const title = layout.showTitle !== false ? [layout.title, layout.subtitle] : [];
  const legend = layout.showLegend !== false ? (layout.legendItems || []).map((i) => i.label) : [];
  const texts = [...title, footer, ...legend,
    ...(p.callouts || []).flatMap((c) => [c.text, c.subtext, c.label]), ...(p.markers || []).map((m) => m.label)];
  return {
    scaleBar, northArrow: layout.showNorthArrow !== false, texts,
    crs: ni ? projectionLabel(layout, scene.map) : layout.showProjectionLabel && scaleBar ? projectionLabel(layout, scene.map) || 'stated' : '',
    credits: creditLinesFor(scene).filter((l) => l !== layout.footerText),
    intercepts: Boolean(p.drillPlan?.results?.length) || (p.callouts || []).some((c) => c.resultId),
    pending: Boolean(layout.disclosurePending) || shown.some((l) => layerFeatures(l).some((f) => Object.entries(f?.properties || {}).some(pendingValue))),
    historical: Boolean(layout.disclosureHistorical) || shown.some((l) => /\bhistoric/i.test(`${l.displayName || ''} ${l.name || ''}`)),
  };
}

/**
 * Diagnostics for the figure the export is about to draw.
 * options: format ('png' | 'svg' | 'svg_ai' | 'pdf'), pdfSize, timeoutMs (each
 * imagery/asset/font wait), and for tests loadImage and measure.
 */
export async function runPreflight(scene, options = {}) {
  const context = createExportContext();
  const s = { ...scene, exportContext: context };
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const io = { timeoutMs, load: options.loadImage || loadImage };
  const out = [];
  // Fonts must be in before text is measured; imagery and assets load meanwhile.
  await Promise.all([
    ensureExportFonts(s, Math.min(timeoutMs, 3000)),
    checkImagery(s, io, out),
    checkAssets(s, io, out),
  ]);
  const measure = options.measure || textMeasurer();
  const sizes = [];
  checkCallouts(s, measure, sizes, out);
  checkMarkerLabels(s, measure, sizes, out);
  checkLegend(s, measure, sizes, out);
  checkPanelOverlaps(s, out);
  // Map labels (geology styling) over panels, results cards or each other: found as the export places them.
  await mapLabelOverlaps(s);
  sizes.push(...titleTextSizes(s).map((t) => ({ ...t, id: 'title' })));
  checkTextSize(s, options, sizes, out);
  const standard = standardOf(s.project.layout);
  if (standard) out.push(...disclosureChecks(standard, disclosureFacts(s)));
  return mergeDiagnostics(out, context.diagnostics);
}
