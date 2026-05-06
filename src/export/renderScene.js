import { escapeXml, downloadBlob } from '../utils/svg';
import { geojsonBounds, unionBounds } from '../utils/geometry';
import { resolveTemplateZones } from '../templates/technicalResultsTemplate';
import { getThemeTokens } from '../utils/themeTokens';
import { MARKER_ICON_PATHS, markerIconSvgFragment, drawMarkerIconCanvas } from '../utils/markerIcons.jsx';
import { safeColor } from '../utils/colorUtils.js';
import regionsNA from '../assets/regionsNA.json';
import { estimateBox, intersects as intersectsCallout, leaderEndpoint } from '../utils/calloutLayout';

let _exportWarnings = [];
export function getExportWarnings() { return _exportWarnings; }

function getPointAtFraction(pts, fraction) {
  const n = pts.length;
  const segs = [];
  let totalLen = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segs.push({ ax: a.x, ay: a.y, dx, dy, len });
    totalLen += len;
  }
  let target = (((fraction % 1) + 1) % 1) * totalLen;
  for (const seg of segs) {
    if (target <= seg.len) {
      const t = seg.len > 0 ? target / seg.len : 0;
      const x = seg.ax + t * seg.dx;
      const y = seg.ay + t * seg.dy;
      let angle = Math.atan2(seg.dy, seg.dx) * 180 / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      return { x, y, angle };
    }
    target -= seg.len;
  }
  return { x: pts[0].x, y: pts[0].y, angle: 0 };
}

function clonePoint(point, scale = 1) {
  return { x: point.x * scale, y: point.y * scale };
}
function isFinitePoint(point) { return Number.isFinite(point?.x) && Number.isFinite(point?.y); }
function toLatLng(coord) { return { lat: coord[1], lng: coord[0] }; }
function featureCollectionFeatures(geojson) {
  if (!geojson) return [];
  if (geojson.type === 'FeatureCollection') return geojson.features || [];
  if (geojson.type === 'Feature') return [geojson];
  return [];
}
function getLayerGeometryType(feature) { return feature?.geometry?.type || ''; }
function getTemplateStyle(template, layer) {
  const base = template?.roleStyles?.[layer?.role] || template?.roleStyles?.other || {};
  return { ...base, ...(layer?.style || {}) };
}
function projectCoordinate(map, coord, scale) { return clonePoint(map.latLngToContainerPoint(toLatLng(coord)), scale); }
function projectRing(map, ring, scale) { return ring.map((coord) => projectCoordinate(map, coord, scale)).filter(isFinitePoint); }
function projectLine(map, coords, scale) { return coords.map((coord) => projectCoordinate(map, coord, scale)).filter(isFinitePoint); }
function getTileImages(container) {
  const rootRect = container.getBoundingClientRect();
  const resolveEffectiveOpacity = (node) => {
    let opacity = 1;
    let current = node;
    while (current && current !== container) {
      const value = Number.parseFloat(getComputedStyle(current).opacity || '1');
      opacity *= Number.isFinite(value) ? value : 1;
      current = current.parentElement;
    }
    return Math.max(0, Math.min(1, opacity));
  };

  return Array.from(container.querySelectorAll('.leaflet-tile-pane img.leaflet-tile'))
    .map((img) => {
      const rect = img.getBoundingClientRect();
      return {
        element: img,
        href: img.currentSrc || img.src,
        x: rect.left - rootRect.left,
        y: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
        opacity: resolveEffectiveOpacity(img),
      };
    })
    .filter((tile) => tile.href && tile.width > 0 && tile.height > 0);
}

function loadImage(src, crossOrigin = null, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const done = (fn) => (...args) => { clearTimeout(timer); fn(...args); };
    if (crossOrigin) el.crossOrigin = crossOrigin;
    el.onload = done(resolve.bind(null, el));
    el.onerror = done(reject);
    el.src = src;
  });
}
function pathFromPoints(points, close = false) {
  if (!points.length) return '';
  const cmds = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let i = 1; i < points.length; i += 1) cmds.push(`L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`);
  if (close) cmds.push('Z');
  return cmds.join(' ');
}
function drawCanvasPath(ctx, points, close = false) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}
function rgba(hex, alpha = 1) {
  if (!hex) return `rgba(0,0,0,${alpha})`;
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.padEnd(6, '0').slice(0, 6);
  const int = Number.parseInt(normalized, 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}
function setCanvasStroke(ctx, style, scale) {
  ctx.strokeStyle = style.stroke || style.markerColor || '#111111';
  ctx.lineWidth = (style.strokeWidth ?? 2) * (scale >= 1 ? 1 : scale);
  ctx.setLineDash(style.dashArray ? style.dashArray.split(/[ ,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0) : []);
}
function buildPatternCanvas(style, scale) {
  const spacing = (style.fillPatternSpacing || 6) * scale;
  const color = rgba(style.fill || '#54a6ff', style.fillOpacity ?? 0.6);
  const pc = document.createElement('canvas');
  if (style.fillPattern === 'hatch') {
    pc.width = pc.height = spacing * 2;
    const px = pc.getContext('2d');
    px.strokeStyle = color; px.lineWidth = Math.max(1, 1.5 * scale);
    px.beginPath(); px.moveTo(0, spacing * 2); px.lineTo(spacing * 2, 0); px.stroke();
    px.beginPath(); px.moveTo(-spacing, spacing); px.lineTo(spacing, -spacing); px.stroke();
    px.beginPath(); px.moveTo(spacing, spacing * 3); px.lineTo(spacing * 3, spacing); px.stroke();
  } else if (style.fillPattern === 'cross') {
    pc.width = pc.height = spacing * 2;
    const px = pc.getContext('2d');
    px.strokeStyle = color; px.lineWidth = Math.max(1, 1.5 * scale);
    px.beginPath(); px.moveTo(0, spacing); px.lineTo(spacing * 2, spacing); px.stroke();
    px.beginPath(); px.moveTo(spacing, 0); px.lineTo(spacing, spacing * 2); px.stroke();
  } else if (style.fillPattern === 'dots') {
    pc.width = pc.height = spacing * 2;
    const px = pc.getContext('2d');
    px.fillStyle = color;
    px.beginPath(); px.arc(spacing, spacing, Math.max(1.5, 2 * scale), 0, Math.PI * 2); px.fill();
  }
  return pc;
}
function setCanvasFill(ctx, style) {
  if (style.fillPattern && style.fillPattern !== 'none') {
    const patternCanvas = buildPatternCanvas(style, 1);
    const pattern = ctx.createPattern(patternCanvas, 'repeat');
    ctx.fillStyle = pattern || rgba(style.fill || '#111111', style.fillOpacity ?? 0.2);
  } else {
    ctx.fillStyle = rgba(style.fill || style.markerFill || style.markerColor || '#111111', style.fillOpacity ?? 0.2);
  }
}
function drawCanvasGeometry(ctx, map, feature, style, scale) {
  const type = getLayerGeometryType(feature); const coords = feature?.geometry?.coordinates; if (!coords) return;
  const baseOpacity = Math.max(0, Math.min(1, style.opacity ?? 1));
  ctx.save();
  ctx.globalAlpha = baseOpacity;
  if (type === 'Polygon') { ctx.beginPath(); coords.forEach((ring) => drawCanvasPath(ctx, projectRing(map, ring, scale), true)); setCanvasFill(ctx, style); ctx.fill('evenodd'); setCanvasStroke(ctx, style, scale); ctx.stroke(); ctx.restore(); return; }
  if (type === 'MultiPolygon') { ctx.beginPath(); coords.forEach((polygon) => polygon.forEach((ring) => drawCanvasPath(ctx, projectRing(map, ring, scale), true))); setCanvasFill(ctx, style); ctx.fill('evenodd'); setCanvasStroke(ctx, style, scale); ctx.stroke(); ctx.restore(); return; }
  if (type === 'LineString') { ctx.beginPath(); drawCanvasPath(ctx, projectLine(map, coords, scale), false); setCanvasStroke(ctx, style, scale); ctx.stroke(); ctx.restore(); return; }
  if (type === 'MultiLineString') { ctx.beginPath(); coords.forEach((line) => drawCanvasPath(ctx, projectLine(map, line, scale), false)); setCanvasStroke(ctx, style, scale); ctx.stroke(); ctx.restore(); return; }
  if (type === 'Point') { const pt = projectCoordinate(map, coords, scale); const radius = (style.markerSize ?? 8) * scale * 0.5; ctx.beginPath(); ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2); ctx.fillStyle = style.markerFill || style.markerColor || '#ffffff'; ctx.fill(); ctx.lineWidth = (style.strokeWidth ?? 1.5) * scale; ctx.strokeStyle = style.markerColor || style.stroke || '#111111'; ctx.stroke(); ctx.restore(); return; }
  if (type === 'MultiPoint') { coords.forEach((coord) => drawCanvasGeometry(ctx, map, { geometry: { type: 'Point', coordinates: coord } }, style, scale)); ctx.restore(); return; }
  ctx.restore();
}
function buildSvgPatternDef(style, patternId, scale) {
  const color = safeColor(style.fill, '#54a6ff');
  const opacity = style.fillOpacity ?? 0.6;
  const spacing = (style.fillPatternSpacing || 6) * scale;
  if (style.fillPattern === 'hatch') {
    return `<pattern id="${patternId}" patternUnits="userSpaceOnUse" width="${spacing * 2}" height="${spacing * 2}"><line x1="0" y1="${spacing * 2}" x2="${spacing * 2}" y2="0" stroke="${color}" stroke-width="${Math.max(1, 1.5 * scale)}" stroke-opacity="${opacity}" /><line x1="${-spacing}" y1="${spacing}" x2="${spacing}" y2="${-spacing}" stroke="${color}" stroke-width="${Math.max(1, 1.5 * scale)}" stroke-opacity="${opacity}" /><line x1="${spacing}" y1="${spacing * 3}" x2="${spacing * 3}" y2="${spacing}" stroke="${color}" stroke-width="${Math.max(1, 1.5 * scale)}" stroke-opacity="${opacity}" /></pattern>`;
  }
  if (style.fillPattern === 'cross') {
    return `<pattern id="${patternId}" patternUnits="userSpaceOnUse" width="${spacing * 2}" height="${spacing * 2}"><line x1="0" y1="${spacing}" x2="${spacing * 2}" y2="${spacing}" stroke="${color}" stroke-width="${Math.max(1, 1.5 * scale)}" stroke-opacity="${opacity}" /><line x1="${spacing}" y1="0" x2="${spacing}" y2="${spacing * 2}" stroke="${color}" stroke-width="${Math.max(1, 1.5 * scale)}" stroke-opacity="${opacity}" /></pattern>`;
  }
  if (style.fillPattern === 'dots') {
    const r = Math.max(1.5, 2 * scale);
    return `<pattern id="${patternId}" patternUnits="userSpaceOnUse" width="${spacing * 2}" height="${spacing * 2}"><circle cx="${spacing}" cy="${spacing}" r="${r}" fill="${color}" fill-opacity="${opacity}" /></pattern>`;
  }
  return '';
}
function geometryToSvg(map, feature, style, scale) {
  const type = getLayerGeometryType(feature); const coords = feature?.geometry?.coordinates; if (!coords) return '';
  const stroke = safeColor(style.stroke || style.markerColor, '#111111');
  const fill = safeColor(style.fill || style.markerFill || style.markerColor, '#111111');
  const fillOpacity = (style.fillOpacity ?? 0.2) * (style.opacity ?? 1);
  const strokeWidth = (style.strokeWidth ?? 2) * scale;
  const opacity = Math.max(0, Math.min(1, style.opacity ?? 1));
  const dash = style.dashArray ? ` stroke-dasharray="${escapeXml(style.dashArray)}"` : '';

  let fillAttr = `fill="${fill}" fill-opacity="${fillOpacity}"`;
  let patternDef = '';
  if (style.fillPattern && style.fillPattern !== 'none' && (type === 'Polygon' || type === 'MultiPolygon')) {
    const pid = `pat-${style.fillPattern}-${Math.round((style.fillPatternSpacing || 6) * scale)}-${fill.replace('#', '')}`;
    patternDef = `<defs>${buildSvgPatternDef(style, pid, scale)}</defs>`;
    fillAttr = `fill="url(#${pid})"`;
  }

  if (type === 'Polygon') return `${patternDef}<path d="${coords.map((ring) => pathFromPoints(projectRing(map, ring, scale), true)).filter(Boolean).join(' ')}" ${fillAttr} stroke="${stroke}" stroke-width="${strokeWidth}"${dash} fill-rule="evenodd" stroke-opacity="${opacity}" />`;
  if (type === 'MultiPolygon') return `${patternDef}<path d="${coords.flatMap((polygon) => polygon.map((ring) => pathFromPoints(projectRing(map, ring, scale), true))).filter(Boolean).join(' ')}" ${fillAttr} stroke="${stroke}" stroke-width="${strokeWidth}"${dash} fill-rule="evenodd" stroke-opacity="${opacity}" />`;
  if (type === 'LineString') return `<path d="${pathFromPoints(projectLine(map, coords, scale), false)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${opacity}" />`;
  if (type === 'MultiLineString') return `<path d="${coords.map((line) => pathFromPoints(projectLine(map, line, scale), false)).filter(Boolean).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${opacity}" />`;
  if (type === 'Point') { const pt = projectCoordinate(map, coords, scale); const radius = (style.markerSize ?? 8) * scale * 0.5; return `<circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${safeColor(style.markerFill || fill)}" stroke="${safeColor(style.markerColor || stroke)}" stroke-width="${Math.max(scale, strokeWidth * 0.4).toFixed(2)}" opacity="${opacity}" />`; }
  if (type === 'MultiPoint') return coords.map((coord) => geometryToSvg(map, { geometry: { type: 'Point', coordinates: coord } }, style, scale)).join('');
  return '';
}
function getOverlayMetrics(scene) {
  return resolveTemplateZones(scene.template, scene.project.layout || {}, { width: scene.width, height: scene.height });
}
function drawRoundedRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function getTheme(scene) {
  const layout = scene?.project?.layout || {};
  const base = getThemeTokens(layout.themeId || 'investor_clean');
  const { accentColor, titleBgColor, titleFgColor, panelBgColor, panelFgColor } = layout;
  const overrides = {};
  if (accentColor) { overrides.titleAccent = accentColor; overrides.calloutBorder = accentColor; }
  if (titleBgColor) overrides.titleFill = titleBgColor;
  if (titleFgColor) { overrides.titleText = titleFgColor; overrides.subtitleText = titleFgColor + 'bb'; }
  if (panelBgColor) {
    overrides.panelFill = panelBgColor; overrides.northArrowFill = panelBgColor;
    overrides.scaleFill = panelBgColor; overrides.insetFill = panelBgColor;
    overrides.logoFill = panelBgColor; overrides.footerFill = panelBgColor;
    overrides.calloutFill = panelBgColor;
  }
  if (panelFgColor) {
    overrides.bodyText = panelFgColor; overrides.panelTitle = panelFgColor;
    overrides.northArrowText = panelFgColor; overrides.scaleStroke = panelFgColor;
    overrides.insetTitle = panelFgColor; overrides.insetMuted = panelFgColor + 'aa';
    overrides.footerText = panelFgColor; overrides.calloutText = panelFgColor;
    overrides.mutedText = panelFgColor + 'aa';
  }
  return Object.keys(overrides).length ? { ...base, ...overrides } : base;
}

function drawPanelRect(ctx, x, y, w, h, radius, fill, border, scale) {
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = Math.max(1, scale);
  ctx.stroke();
}

function drawPanelAccentLeft(ctx, x, y, h, theme, scale) {
  if (!theme.panelAccentLeft) return;
  ctx.fillStyle = theme.panelAccentLeft;
  ctx.fillRect(x, y, 4 * scale, h);
}

function svgRect(x, y, w, h, r, fill, border, scale) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${border}" stroke-width="${Math.max(1, scale)}" />`;
}


function drawTitleBlockCanvas(ctx, scene, scale) {
  const theme = getTheme(scene);
  const layout = scene.project.layout || {};
  const { title } = getOverlayMetrics(scene); const x = title.left * scale, y = title.top * scale, w = title.width * scale, h = title.height * scale;
  if (!layout.titleTransparent) drawPanelRect(ctx, x, y, w, h, (theme.titleRadius ?? theme.panelRadius ?? 10) * scale, theme.titleFill, theme.titleBorder, scale);
  const leftBar = theme.titleAccent && theme.titleAccentStyle === 'left';
  if (theme.titleAccent) {
    ctx.fillStyle = theme.titleAccent;
    if (leftBar) { ctx.fillRect(x, y, 6 * scale, h); }
    else { ctx.fillRect(x, y, w, 5 * scale); }
  }
  const titleFont = `${layout.fonts?.title || 'Inter'}, Arial, sans-serif`;
  const textX = (x + (leftBar ? 22 : 18) * scale);
  const topOff = (theme.titleAccent && !leftBar) ? 20 : 16;
  ctx.fillStyle = theme.titleText; ctx.font = `700 ${26 * scale}px ${titleFont}`; ctx.textBaseline = 'top'; ctx.fillText(layout.title || 'Project Map', textX, y + topOff * scale);
  ctx.fillStyle = theme.subtitleText; ctx.font = `${14 * scale}px ${titleFont}`; ctx.fillText(layout.subtitle || '', textX, y + (topOff + 34) * scale);
  // Metadata rows (date / project # / scale note) — right-aligned in title block
  const metaItems = [layout.mapDate, layout.projectNumber, layout.mapScaleNote].filter(Boolean);
  if (metaItems.length) {
    const metaFont = `${10 * scale}px ${titleFont}`;
    ctx.font = metaFont; ctx.textBaseline = 'top';
    ctx.fillStyle = theme.subtitleText;
    const rightX = x + w - 12 * scale;
    const savedAlign = ctx.textAlign; ctx.textAlign = 'right';
    metaItems.forEach((item, i) => { ctx.fillText(item, rightX, y + (topOff + 2 + i * 14) * scale); });
    ctx.textAlign = savedAlign;
  }
}

function groupLegendItems(items, layout) {
  const mode = layout?.legendMode || 'auto';
  const compact = mode === 'compact' || (mode === 'auto' && items.length <= 2);
  if (compact) return [{ heading: null, items }];
  const groups = [];
  for (const item of items) {
    const heading = item.group || 'Map Data';
    let bucket = groups.find((g) => g.heading === heading);
    if (!bucket) { bucket = { heading, items: [] }; groups.push(bucket); }
    bucket.items.push(item);
  }
  return groups;
}

function legendSwatchSvg(item, x, y, scale) {
  const style = item.style || {};
  if (item.type === 'points') return `<circle cx="${(x + 8 * scale).toFixed(2)}" cy="${(y + 8 * scale).toFixed(2)}" r="${(5 * scale).toFixed(2)}" fill="${style.markerFill || style.markerColor || '#ffffff'}" stroke="${style.markerColor || '#111111'}" stroke-width="${Math.max(1, scale).toFixed(2)}" />`;
  return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(18 * scale).toFixed(2)}" height="${(12 * scale).toFixed(2)}" fill="${style.fill || '#72a0ff'}" fill-opacity="${style.fillOpacity ?? 0.22}" stroke="${style.stroke || '#3b82f6'}" stroke-width="${Math.max(1, scale).toFixed(2)}" />`;
}
function drawLegendCanvas(ctx, scene, scale) {
  const theme = getTheme(scene);
  const legendFont = `${scene.project.layout?.fonts?.legend || 'Inter'}, Arial, sans-serif`;
  const { legend } = getOverlayMetrics(scene); const items = scene.project.layout?.legendItems || []; if (!items.length || !legend?.width || !legend?.height) return;
  const x = legend.left * scale, y = legend.top * scale, w = legend.width * scale, h = legend.height * scale;
  if (!scene.project.layout?.legendTransparent) drawPanelRect(ctx, x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.panelFill, theme.panelBorder, scale);
  drawPanelAccentLeft(ctx, x, y, h, theme, scale);
  const leftPad = theme.panelAccentLeft ? 20 : 16;
  ctx.fillStyle = theme.panelTitle; ctx.font = `700 ${15 * scale}px ${legendFont}`; ctx.textBaseline = 'top'; ctx.fillText(scene.project.layout?.legendTitle || 'Legend', x + leftPad * scale, y + 14 * scale);
  const lp = (theme.panelAccentLeft ? 20 : 16) * scale;
  let rowY = y + 40 * scale;
  groupLegendItems(items, scene.project.layout).forEach((group) => {
    if (group.heading) { ctx.fillStyle = theme.mutedText; ctx.font = `700 ${11 * scale}px ${legendFont}`; ctx.fillText(group.heading.toUpperCase(), x + lp, rowY); rowY += 18 * scale; }
    group.items.forEach((item) => {
      if (item.type === 'points') {
        ctx.beginPath(); ctx.arc(x + lp + 8 * scale, rowY + 9 * scale, 5 * scale, 0, Math.PI * 2); ctx.fillStyle = item.style.markerFill || item.style.markerColor || '#ffffff'; ctx.fill(); ctx.strokeStyle = item.style.markerColor || '#111111'; ctx.lineWidth = Math.max(1, scale); ctx.stroke();
      } else {
        ctx.fillStyle = rgba(item.style.fill || '#93c5fd', item.style.fillOpacity ?? 0.22); ctx.fillRect(x + lp, rowY + 2 * scale, 18 * scale, 12 * scale); ctx.strokeStyle = item.style.stroke || '#3b82f6'; ctx.lineWidth = Math.max(1, scale); ctx.strokeRect(x + lp, rowY + 2 * scale, 18 * scale, 12 * scale);
      }
      ctx.fillStyle = theme.bodyText; ctx.font = `${13 * scale}px ${legendFont}`; ctx.textBaseline = 'middle'; ctx.fillText(item.label || 'Layer', x + lp + 30 * scale, rowY + 9 * scale); rowY += 24 * scale;
    });
    rowY += 6 * scale;
  });
}

function drawNorthArrowCanvas(ctx, scene, scale) {
  if (scene.project.layout?.showNorthArrow === false) return;
  const theme = getTheme(scene);
  const { northArrow } = getOverlayMetrics(scene); const x = northArrow.left * scale, y = northArrow.top * scale, w = northArrow.width * scale, h = northArrow.height * scale, cx = x + w / 2;
  drawPanelRect(ctx, x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.northArrowFill, theme.panelBorder, scale);
  drawPanelAccentLeft(ctx, x, y, h, theme, scale);
  ctx.fillStyle = theme.northArrowText; ctx.font = `700 ${14 * scale}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('N', cx, y + 12 * scale);
  ctx.beginPath(); ctx.moveTo(cx, y + 28 * scale); ctx.lineTo(cx - 12 * scale, y + 62 * scale); ctx.lineTo(cx - 3 * scale, y + 62 * scale); ctx.lineTo(cx - 3 * scale, y + 88 * scale); ctx.lineTo(cx + 3 * scale, y + 88 * scale); ctx.lineTo(cx + 3 * scale, y + 62 * scale); ctx.lineTo(cx + 12 * scale, y + 62 * scale); ctx.closePath(); ctx.fill();
  ctx.textAlign = 'left';
}

function pickScaleLabel(map) {
  const size = map.getSize();
  const latlng1 = map.containerPointToLatLng([20, size.y - 40]);
  const latlng2 = map.containerPointToLatLng([150, size.y - 40]);
  const meters = latlng1.distanceTo(latlng2);
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
  const nice = steps.reduce((best, n) => (Math.abs(n - meters) < Math.abs(best - meters) ? n : best), steps[0]);
  return { label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, widthPx: Math.max(70, Math.min(180, Math.round((130 * nice) / meters))) };
}
function drawScaleBarCanvas(ctx, scene, scale) {
  if (scene.project.layout?.showScaleBar === false) return;
  const theme = getTheme(scene);
  const { scaleBar } = getOverlayMetrics(scene); const x = scaleBar.left * scale, y = scaleBar.top * scale, w = scaleBar.width * scale, h = scaleBar.height * scale, scaleState = pickScaleLabel(scene.map), barWidth = scaleState.widthPx * scale;
  drawPanelRect(ctx, x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.scaleFill, theme.panelBorder, scale);
  drawPanelAccentLeft(ctx, x, y, h, theme, scale);
  ctx.fillStyle = theme.scaleStroke; ctx.fillRect(x + 16 * scale, y + 18 * scale, barWidth / 2, 10 * scale); ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 16 * scale + barWidth / 2, y + 18 * scale, barWidth / 2, 10 * scale); ctx.strokeStyle = theme.scaleStroke; ctx.lineWidth = Math.max(1, scale); ctx.strokeRect(x + 16 * scale, y + 18 * scale, barWidth, 10 * scale);
  const footerFont = `${scene.project.layout?.fonts?.footer || 'Inter'}, Arial, sans-serif`;
  ctx.fillStyle = theme.bodyText; ctx.font = `${12 * scale}px ${footerFont}`; ctx.textBaseline = 'top'; ctx.fillText(scaleState.label, x + 16 * scale, y + 40 * scale);
}

function resolveReferenceBounds(bounds, insetMode) {
  const expand = insetMode === 'country' ? 7.2 : insetMode === 'regional_district' ? 2.15 : insetMode === 'secondary_zoom' ? 1.45 : 3.6;
  if (!bounds) return { minLng: -130, minLat: 20, maxLng: -60, maxLat: 62, label: insetMode === 'country' ? 'Country' : insetMode === 'regional_district' ? 'Regional' : insetMode === 'secondary_zoom' ? 'Secondary Zoom' : 'Province / State' };
  const cx = (bounds.minLng + bounds.maxLng) / 2; const cy = (bounds.minLat + bounds.maxLat) / 2;
  const halfW = Math.max(0.01, ((bounds.maxLng - bounds.minLng) / 2) * expand); const halfH = Math.max(0.01, ((bounds.maxLat - bounds.minLat) / 2) * expand);
  return { minLng: cx - halfW, minLat: cy - halfH, maxLng: cx + halfW, maxLat: cy + halfH, label: insetMode === 'country' ? 'Country' : insetMode === 'regional_district' ? 'Regional' : insetMode === 'secondary_zoom' ? 'Secondary Zoom' : 'Province / State' };
}
function normalizeInset(visibleBounds, referenceBounds) {
  if (!visibleBounds || !referenceBounds) return null;
  const width = referenceBounds.maxLng - referenceBounds.minLng || 1; const height = referenceBounds.maxLat - referenceBounds.minLat || 1; const pad = 10;
  return {
    x: pad + ((visibleBounds.minLng - referenceBounds.minLng) / width) * (100 - pad * 2),
    y: pad + ((referenceBounds.maxLat - visibleBounds.maxLat) / height) * (100 - pad * 2),
    w: ((visibleBounds.maxLng - visibleBounds.minLng) / width) * (100 - pad * 2),
    h: ((visibleBounds.maxLat - visibleBounds.minLat) / height) * (100 - pad * 2),
  };
}
function projectToCanvas(lng, lat, refBbox, x, y, w, h, pad) {
  const [minLng, minLat, maxLng, maxLat] = refBbox;
  const rngW = maxLng - minLng || 1, rngH = maxLat - minLat || 1;
  return [
    x + pad + ((lng - minLng) / rngW) * (w - pad * 2),
    (y + h - pad) - ((lat - minLat) / rngH) * (h - pad * 2),
  ];
}

function getAutoInsetRefBbox(region) {
  const [minLng, minLat, maxLng, maxLat] = region.bbox;
  const padFrac = 0.06;
  const dLng = (maxLng - minLng) * padFrac, dLat = (maxLat - minLat) * padFrac;
  return [minLng - dLng, minLat - dLat, maxLng + dLng, maxLat + dLat];
}

function drawAutoInsetCanvas(ctx, innerX, innerY, innerW, innerH, scale, region, visibleBounds) {
  const pad = 6 * scale;
  const refBbox = getAutoInsetRefBbox(region);

  // Background
  ctx.fillStyle = '#f0f4f8';
  ctx.fillRect(innerX, innerY, innerW, innerH);

  // Province/state silhouette
  ctx.fillStyle = '#dce8f5';
  ctx.strokeStyle = '#8aabcf';
  ctx.lineWidth = 0.8 * scale;
  region.coordinates.forEach(ring => {
    if (ring.length < 2) return;
    ctx.beginPath();
    ring.forEach(([lng, lat], i) => {
      const [px, py] = projectToCanvas(lng, lat, refBbox, innerX, innerY, innerW, innerH, pad);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  // Project location marker
  if (visibleBounds) {
    const [mx1, my1] = projectToCanvas(visibleBounds.minLng, visibleBounds.maxLat, refBbox, innerX, innerY, innerW, innerH, pad);
    const [mx2, my2] = projectToCanvas(visibleBounds.maxLng, visibleBounds.minLat, refBbox, innerX, innerY, innerW, innerH, pad);
    const rx = Math.min(mx1, mx2), ry = Math.min(my1, my2);
    const rw = Math.max(4 * scale, Math.abs(mx2 - mx1)), rh = Math.max(4 * scale, Math.abs(my2 - my1));
    ctx.fillStyle = 'rgba(96,165,250,0.25)';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.2 * scale;
    ctx.beginPath();
    ctx.rect(Math.max(innerX + pad, rx), Math.max(innerY + pad, ry), rw, rh);
    ctx.fill();
    ctx.stroke();
    const dotX = Math.max(innerX + pad + 3 * scale, Math.min(innerX + innerW - pad - 3 * scale, rx + rw / 2));
    const dotY = Math.max(innerY + pad + 3 * scale, Math.min(innerY + innerH - pad - 3 * scale, ry + rh / 2));
    ctx.beginPath();
    ctx.arc(dotX, dotY, 3.5 * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#1d4ed8';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2 * scale;
    ctx.fill();
    ctx.stroke();
  }
}

function autoInsetSvg(innerX, innerY, innerW, innerH, scale, region, visibleBounds) {
  const pad = 6 * scale;
  const refBbox = getAutoInsetRefBbox(region);
  const project = (lng, lat) => projectToCanvas(lng, lat, refBbox, innerX, innerY, innerW, innerH, pad);

  const paths = region.coordinates.map(ring => {
    if (ring.length < 2) return '';
    const pts = ring.map(([lng, lat]) => { const [px, py] = project(lng, lat); return `${px.toFixed(1)},${py.toFixed(1)}`; });
    return `<path d="M ${pts.join(' L ')} Z" fill="#dce8f5" stroke="#8aabcf" stroke-width="${0.8 * scale}" />`;
  }).join('');

  let markerSvg = '';
  if (visibleBounds) {
    const [mx1, my1] = project(visibleBounds.minLng, visibleBounds.maxLat);
    const [mx2, my2] = project(visibleBounds.maxLng, visibleBounds.minLat);
    const rx = Math.max(innerX + pad, Math.min(mx1, mx2));
    const ry = Math.max(innerY + pad, Math.min(my1, my2));
    const rw = Math.max(4 * scale, Math.abs(mx2 - mx1));
    const rh = Math.max(4 * scale, Math.abs(my2 - my1));
    const dotX = Math.max(innerX + pad + 3 * scale, Math.min(innerX + innerW - pad - 3 * scale, rx + rw / 2));
    const dotY = Math.max(innerY + pad + 3 * scale, Math.min(innerY + innerH - pad - 3 * scale, ry + rh / 2));
    markerSvg = `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="rgba(96,165,250,0.25)" stroke="#2563eb" stroke-width="${1.2 * scale}" /><circle cx="${dotX}" cy="${dotY}" r="${3.5 * scale}" fill="#1d4ed8" stroke="#ffffff" stroke-width="${1.2 * scale}" />`;
  }

  return `<rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" fill="#f0f4f8" />${paths}${markerSvg}`;
}

function drawInsetBackdropCanvas(ctx, x, y, w, h, scale) {
  const lg = ctx.createLinearGradient(x, y, x + w, y + h); lg.addColorStop(0, '#f8fafc'); lg.addColorStop(1, '#eef3f8');
  ctx.fillStyle = lg; drawRoundedRect(ctx, x, y, w, h, 8 * scale); ctx.fill(); ctx.strokeStyle = '#d3dce8'; ctx.stroke();
  const mapPoint = (px, py) => [x + (px / 100) * w, y + (py / 100) * h];
  const areas = [
    [[12,20],[20,12],[35,10],[45,16],[55,22],[60,30],[72,32],[82,34],[88,40],[88,52],[76,78],[62,82],[36,88],[22,82],[10,54],[8,30]],
    [[20,26],[28,20],[38,20],[45,24],[52,28],[57,32],[65,34],[70,36],[78,46],[76,58],[68,62],[46,72],[32,70],[18,64],[14,48],[14,34]],
  ];
  ['#eef3f8','#f4f7fa'].forEach((fill, idx) => {
    ctx.beginPath(); areas[idx].forEach((pt, i) => { const [px, py] = mapPoint(pt[0], pt[1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#c9d4df'; ctx.lineWidth = 0.8 * scale; ctx.stroke();
  });
  const roads = [
    [[14,62],[28,55],[45,56],[60,48],[82,36],[92,28]],
    [[22,15],[30,30],[33,48],[28,84]],
  ];
  ctx.strokeStyle = '#cfd8e3'; ctx.lineWidth = 1.4 * scale; roads.forEach((line) => { ctx.beginPath(); line.forEach((pt, i) => { const [px, py] = mapPoint(pt[0], pt[1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }); ctx.stroke(); });
  ctx.strokeStyle = '#b5d8f7'; ctx.lineWidth = 1.8 * scale; ctx.beginPath(); [[8,44],[18,36],[28,42],[38,36],[58,26],[70,36],[88,62],[95,56]].forEach((pt, i) => { const [px, py] = mapPoint(pt[0], pt[1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }); ctx.stroke();
}
async function drawInsetCanvas(ctx, scene, scale) {
  const zone = getOverlayMetrics(scene).inset; if (!zone || !zone.width || !zone.height) return; const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale;
  const theme = getTheme(scene);
  drawPanelRect(ctx, x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.insetFill, theme.insetBorder, scale);
  const { insetImage, insetMode, autoInsetRegion, insetTitle, insetLabel } = scene.project.layout || {};
  ctx.fillStyle = theme.insetTitle; ctx.font = `700 ${12 * scale}px Arial`; ctx.textBaseline = 'top'; ctx.fillText(insetTitle || 'Project Locator', x + 12 * scale, y + 10 * scale);
  const innerX = x + 10 * scale, innerY = y + 30 * scale, innerW = w - 20 * scale, innerH = h - 56 * scale;
  const customInset = insetMode === 'custom_image' && insetImage;
  if (customInset) {
    const img = await new Promise((resolve, reject) => { const el = new Image(); el.onload = () => resolve(el); el.onerror = reject; el.src = insetImage; }).catch(() => { _exportWarnings.push('inset image could not be embedded'); return null; });
    if (img) { ctx.save(); drawRoundedRect(ctx, innerX, innerY, innerW, innerH, 8 * scale); ctx.clip(); ctx.drawImage(img, innerX, innerY, innerW, innerH); ctx.restore(); }
    return;
  }
  const visible = (scene.project.layers || []).filter((layer) => layer.visible !== false && layer.geojson);
  const bounds = unionBounds(visible.map((layer) => geojsonBounds(layer.geojson)).filter(Boolean));
  if (autoInsetRegion) {
    drawAutoInsetCanvas(ctx, innerX, innerY, innerW, innerH, scale, autoInsetRegion, bounds);
    ctx.fillStyle = theme.insetMuted; ctx.font = `${11 * scale}px Arial`; ctx.textBaseline = 'alphabetic'; ctx.fillText(insetLabel || autoInsetRegion.name, x + 12 * scale, y + h - 10 * scale);
    return;
  }
  const ref = resolveReferenceBounds(bounds, insetMode); const marker = normalizeInset(bounds, ref);
  drawInsetBackdropCanvas(ctx, innerX, innerY, innerW, innerH, scale);
  if (marker) { const mx = Math.max(innerX + 8 * scale, innerX + (marker.x / 100) * innerW), my = Math.max(innerY + 8 * scale, innerY + (marker.y / 100) * innerH), mw = Math.max(8 * scale, Math.max(10 * scale, (marker.w / 100) * innerW)), mh = Math.max(8 * scale, Math.max(10 * scale, (marker.h / 100) * innerH)); ctx.fillStyle = 'rgba(96,165,250,0.16)'; drawRoundedRect(ctx, mx, my, mw, mh, 2 * scale); ctx.fill(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.5 * scale; ctx.stroke(); ctx.beginPath(); ctx.arc(Math.min(innerX + innerW - 8 * scale, Math.max(innerX + 8 * scale, mx + mw / 2)), Math.min(innerY + innerH - 8 * scale, Math.max(innerY + 8 * scale, my + mh / 2)), 3.2 * scale, 0, Math.PI * 2); ctx.fillStyle = '#0f2c56'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2 * scale; ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = theme.insetMuted; ctx.font = `${11 * scale}px Arial`; ctx.textBaseline = 'alphabetic'; ctx.fillText(insetLabel || ref.label, x + 12 * scale, y + h - 10 * scale);
}
function drawFooterCanvas(ctx, scene, scale) {
  const theme = getTheme(scene);
  const text = scene.project.layout?.footerText; const zone = getOverlayMetrics(scene).footer; if (!text || !zone || !zone.width || !zone.height) return; const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale;
  drawPanelRect(ctx, x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.footerFill, theme.panelBorder, scale);
  ctx.fillStyle = theme.footerText; ctx.font = `${12 * scale}px ${scene.project.layout?.fonts?.footer || 'Inter'}, Arial, sans-serif`; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 12 * scale, y + h / 2);
}

const CALLOUT_DIRECTIONS = [
  { dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
];
function placeCallouts(scene, scale) {
  const callouts = (scene.project.callouts || []).slice().sort((a, b) => (a.priority || 2) - (b.priority || 2));
  const placed = [];
  callouts.forEach((callout) => {
    if (!callout.anchor) return;
    const pt = scene.map.latLngToContainerPoint([callout.anchor.lat, callout.anchor.lng]);
    const { width, height } = estimateBox(callout);
    let left = pt.x + (callout.offset?.x || 0);
    let top = pt.y + (callout.offset?.y || 0);
    let candidate = { ...callout, left, top, width, height, anchorPx: { x: pt.x, y: pt.y } };
    if (callout.isManualPosition) {
      placed.push({ ...candidate, left: left * scale, top: top * scale, width: width * scale, height: height * scale, anchorPx: { x: pt.x * scale, y: pt.y * scale } });
      return;
    }
    let attempts = 0;
    while (placed.some((other) => intersectsCallout(candidate, other, 10)) && attempts < 40) {
      const dir = CALLOUT_DIRECTIONS[Math.floor(attempts / 10) % 4];
      const step = height * 0.7;
      top += dir.dy * step;
      left += dir.dx * step;
      candidate = { ...candidate, left, top };
      attempts++;
    }
    placed.push({ ...candidate, left: left * scale, top: top * scale, width: width * scale, height: height * scale, anchorPx: { x: pt.x * scale, y: pt.y * scale } });
  });
  return placed;
}
function fitText(ctx, text, maxWidth) {
  if (!text || ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

function drawCalloutsCanvas(ctx, scene, scale) {
  const calloutFont = `${scene.project.layout?.fonts?.callout || 'Inter'}, Arial, sans-serif`;
  placeCallouts(scene, scale).forEach((c) => {
    const theme = getTheme(scene);
    const radius = Math.max(0, (theme.panelRadius ?? 10) - 4) * scale;

    if (c.type === 'badge') {
      const badgeEp = leaderEndpoint(c.anchorPx, c);
      ctx.beginPath(); ctx.moveTo(c.anchorPx.x, c.anchorPx.y); ctx.lineTo(badgeEp.x, badgeEp.y);
      ctx.strokeStyle = c.style?.border || '#102640'; ctx.lineWidth = 1.4 * scale; ctx.setLineDash([]); ctx.stroke();
      const chipChars = (c.badgeValue || '').length;
      const chipW = Math.max(44 * scale, chipChars * 8 * scale + 20 * scale);
      const labelW = c.width - chipW;
      // Left chip
      drawRoundedRect(ctx, c.left, c.top, chipW, c.height, radius);
      ctx.fillStyle = c.badgeColor || '#d97706'; ctx.fill();
      // Right label
      drawRoundedRect(ctx, c.left + chipW, c.top, labelW, c.height, radius);
      ctx.fillStyle = c.style?.background || '#ffffff'; ctx.fill();
      // Anchor dot
      ctx.beginPath(); ctx.arc(c.anchorPx.x, c.anchorPx.y, 4 * scale, 0, Math.PI * 2);
      ctx.fillStyle = c.style?.border || '#102640'; ctx.fill();
      // Chip text
      ctx.textBaseline = 'middle'; ctx.font = `700 ${12 * scale}px ${calloutFont}`;
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
      ctx.fillText(fitText(ctx, c.badgeValue || '—', chipW - 8 * scale), c.left + chipW / 2, c.top + c.height / 2);
      // Label text
      ctx.fillStyle = c.style?.textColor || '#0f172a'; ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, c.text || '', labelW - 16 * scale), c.left + chipW + 8 * scale, c.top + c.height / 2);
      return;
    }

    if (c.type === 'leader' || c.type === 'boxed') {
      const ep = leaderEndpoint(c.anchorPx, c);
      ctx.beginPath(); ctx.moveTo(c.anchorPx.x, c.anchorPx.y); ctx.lineTo(ep.x, ep.y);
      ctx.strokeStyle = c.style?.border || '#102640'; ctx.lineWidth = 1.4 * scale; ctx.setLineDash(c.type === 'leader' ? [5 * scale, 3 * scale] : []); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (c.type !== 'plain') { drawRoundedRect(ctx, c.left, c.top, c.width, c.height, radius); ctx.fillStyle = c.style?.background || theme.calloutFill; ctx.fill(); ctx.strokeStyle = c.style?.border || theme.calloutBorder; ctx.lineWidth = 1 * scale; ctx.stroke(); }
    const textX = c.left + (c.type === 'plain' ? 0 : 10 * scale);
    const textY = c.top + (c.type === 'plain' ? 10 * scale : c.subtext ? c.height / 2 - 9 * scale : c.height / 2);
    const maxTextW = c.width - (c.type === 'plain' ? 0 : 20 * scale);
    ctx.fillStyle = c.style?.textColor || theme.calloutText; ctx.font = `700 ${12 * scale}px ${calloutFont}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(fitText(ctx, c.text || '', maxTextW), textX, textY);
    if (c.subtext) {
      ctx.fillStyle = c.style?.subtextColor || '#475569';
      ctx.font = `${10 * scale}px ${calloutFont}`;
      ctx.fillText(fitText(ctx, c.subtext, maxTextW), textX, textY + 16 * scale);
    }
  });
}

function annotationLabelFont(scene, scale) {
  return `700 ${12 * scale}px ${scene.project.layout?.fonts?.label || 'Inter'}, Arial, sans-serif`;
}

function markerIsShape(type) {
  return ['circle', 'square', 'triangle'].includes(type);
}

function markerIsVectorIcon(type) {
  return type in MARKER_ICON_PATHS;
}

function drawMarkerLabelCanvas(ctx, scene, marker, point, scale) {
  if (!marker.label) return;
  const labelX = point.x + (marker.size || 18) * scale * 0.5 + 8 * scale;
  const labelY = point.y;
  ctx.save();
  ctx.font = annotationLabelFont(scene, scale);
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(marker.label);
  const labelWidth = metrics.width + 16 * scale;
  const labelHeight = 22 * scale;
  drawRoundedRect(ctx, labelX, labelY - labelHeight / 2, labelWidth, labelHeight, 11 * scale);
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,23,42,0.12)';
  ctx.lineWidth = Math.max(1, scale * 0.8);
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.fillText(marker.label, labelX + 8 * scale, labelY);
  ctx.restore();
}

async function drawMarkersCanvas(ctx, scene, scale) {
  for (const marker of (scene.project.markers || [])) {
    const point = clonePoint(scene.map.latLngToContainerPoint([marker.lat, marker.lng]), scale);
    const size = (marker.size || 18) * scale;
    const color = marker.color || '#d97706';

    if (marker.type === 'maplabel') {
      const labelFont = scene.project.layout?.fonts?.label || 'Inter';
      ctx.save();
      ctx.globalAlpha = marker.opacity ?? 0.35;
      ctx.font = `${marker.bold !== false ? '700' : '400'} ${(marker.size || 28) * scale}px ${labelFont}, Arial, sans-serif`;
      ctx.fillStyle = marker.color || '#1e293b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (marker.rotation) {
        ctx.translate(point.x, point.y);
        ctx.rotate((marker.rotation * Math.PI) / 180);
        ctx.fillText((marker.label || '').toUpperCase(), 0, 0);
      } else {
        ctx.fillText((marker.label || '').toUpperCase(), point.x, point.y);
      }
      ctx.restore();
      continue;
    }

    if (markerIsVectorIcon(marker.type)) {
      // Render via SVG-to-image for crisp, consistent icon export
      await drawMarkerIconCanvas(ctx, marker.type, point.x, point.y, size, color);
    } else {
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2 * scale;

      if (marker.type === 'triangle') {
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.55);
        ctx.lineTo(-size * 0.5, size * 0.45);
        ctx.lineTo(size * 0.5, size * 0.45);
        ctx.closePath();
        ctx.fill();
      } else if (marker.type === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        // square (default fallback)
        ctx.beginPath();
        ctx.rect(-size / 2, -size / 2, size, size);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    drawMarkerLabelCanvas(ctx, scene, marker, point, scale);
  }
}


function ellipseLabelPlacement(center, width, height, rotationDeg, scale) {
  const rad = (rotationDeg * Math.PI) / 180;
  const localAnchor = { x: width * 0.34, y: -height * 0.2 };
  const anchorX = center.x + localAnchor.x * Math.cos(rad) - localAnchor.y * Math.sin(rad);
  const anchorY = center.y + localAnchor.x * Math.sin(rad) + localAnchor.y * Math.cos(rad);
  const labelX = anchorX + 18 * scale;
  const labelY = anchorY - 24 * scale;
  return { anchorX, anchorY, labelX, labelY };
}

function drawEllipseLabelCanvas(ctx, scene, ellipse, center, width, height, rotationDeg, scale) {
  if (!ellipse.label) return;
  const labelFont = scene.project.layout?.fonts?.label || 'Inter';
  const labelFontSize = (ellipse.labelFontSize || 11) * scale;
  const labelColor = ellipse.labelColor || ellipse.color || '#dc2626';
  const fontWeight = ellipse.labelBold !== false ? '700' : '400';

  if (ellipse.labelArc) {
    const r = width / 2;
    const angle = ((ellipse.labelAngle ?? 0) / 360) * Math.PI * 2 - Math.PI / 2;
    const textR = r + labelFontSize * 0.6 + 4 * scale;
    const tx = center.x + textR * Math.cos(angle);
    const ty = center.y + textR * Math.sin(angle);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = labelColor;
    ctx.font = `${fontWeight} ${labelFontSize}px ${labelFont}, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ellipse.label, 0, 0);
    ctx.restore();
    return;
  }

  const pos = ellipseLabelPlacement(center, width, height, rotationDeg, scale);
  const finalX = pos.labelX + (ellipse.labelOffsetX || 0) * scale;
  const finalY = pos.labelY + (ellipse.labelOffsetY || 0) * scale;
  ctx.save();
  ctx.strokeStyle = labelColor;
  ctx.lineWidth = Math.max(1, 1.4 * scale);
  ctx.setLineDash([5 * scale, 3 * scale]);
  ctx.beginPath();
  ctx.moveTo(pos.anchorX, pos.anchorY);
  ctx.lineTo(finalX, finalY + 10 * scale);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `${fontWeight} ${labelFontSize}px ${labelFont}, Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(ellipse.label).width;
  const labelWidth = textWidth + 16 * scale;
  const labelHeight = 20 * scale;
  drawRoundedRect(ctx, finalX, finalY, labelWidth, labelHeight, 10 * scale);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(15,23,42,0.12)';
  ctx.lineWidth = Math.max(1, scale * 0.8);
  ctx.stroke();
  ctx.fillStyle = labelColor;
  ctx.fillText(ellipse.label, finalX + 8 * scale, finalY + labelHeight / 2);
  ctx.restore();
}

function resolveEllipseDimensions(ellipse, map, scale) {
  const center = clonePoint(map.latLngToContainerPoint([ellipse.lat, ellipse.lng]), scale);
  if (ellipse.isRing && ellipse.radiusKm) {
    const northPt = clonePoint(map.latLngToContainerPoint([ellipse.lat + ellipse.radiusKm / 111.32, ellipse.lng]), scale);
    const pixelR = Math.max(4 * scale, Math.abs(center.y - northPt.y));
    return { center, width: pixelR * 2, height: pixelR * 2, rotation: 0 };
  }
  return { center, width: (ellipse.width || 90) * scale, height: (ellipse.height || 56) * scale, rotation: ellipse.rotation || 0 };
}

function chaikinExport(points, iterations = 3) {
  let pts = points;
  for (let i = 0; i < iterations; i++) {
    const next = [];
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j], b = pts[(j + 1) % pts.length];
      next.push({ lat: 0.75 * a.lat + 0.25 * b.lat, lng: 0.75 * a.lng + 0.25 * b.lng });
      next.push({ lat: 0.25 * a.lat + 0.75 * b.lat, lng: 0.25 * a.lng + 0.75 * b.lng });
    }
    pts = next;
  }
  return pts;
}

function drawEllipsesCanvas(ctx, scene, scale) {
  (scene.project.ellipses || []).forEach((ellipse) => {
    const { center, width, height, rotation } = resolveEllipseDimensions(ellipse, scene.map, scale);

    // Outside shade (evenodd) — drawn before the ring stroke
    if (ellipse.isRing && ellipse.outsideShade) {
      const r = width / 2;
      ctx.save();
      ctx.globalAlpha = ellipse.outsideShadeOpacity ?? 0.35;
      ctx.fillStyle = ellipse.outsideShadeColor || '#000000';
      ctx.beginPath();
      ctx.rect(0, 0, scene.width * scale, scene.height * scale);
      ctx.arc(center.x, center.y, r, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
    }

    const rotRad = (rotation * Math.PI) / 180;
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(rotRad);
    ctx.beginPath();
    ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.strokeStyle = ellipse.color || '#dc2626';
    ctx.lineWidth = 2 * scale;
    ctx.setLineDash(ellipse.dashed === false ? [] : [6 * scale, 4 * scale]);
    ctx.stroke();
    ctx.restore();
    const label = ellipse.isRing && !ellipse.label ? `${ellipse.radiusKm} km` : ellipse.label;
    drawEllipseLabelCanvas(ctx, scene, { ...ellipse, label }, center, width, height, rotation, scale);
  });
}

function drawPolygonsCanvas(ctx, scene, scale) {
  (scene.project.polygons || []).forEach((poly) => {
    if (!poly.points?.length) return;
    const rawPts = poly.smoothed ? chaikinExport(poly.points) : poly.points;
    const pts = rawPts.map(({ lat, lng }) => {
      const pt = scene.map.latLngToContainerPoint([lat, lng]);
      return { x: pt.x * scale, y: pt.y * scale };
    });
    if (!pts.length) return;

    // Outside shade (evenodd)
    if (poly.outsideShade) {
      ctx.save();
      ctx.globalAlpha = poly.outsideShadeOpacity ?? 0.35;
      ctx.fillStyle = poly.outsideShadeColor || '#000000';
      ctx.beginPath();
      ctx.rect(0, 0, scene.width * scale, scene.height * scale);
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill('evenodd');
      ctx.restore();
    }

    // Dashed outline
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.strokeStyle = poly.color || '#000000';
    ctx.lineWidth = (poly.strokeWidth ?? 2) * scale;
    ctx.setLineDash(poly.dashed === false ? [] : [10 * scale, 5 * scale]);
    ctx.stroke();
    ctx.restore();

    if (poly.label) {
      const fontSize = (poly.labelFontSize || 12) * scale;
      const fontWeight = poly.labelBold !== false ? '700' : '400';
      const color = poly.labelColor || poly.color || '#000000';
      if (poly.arcLabel) {
        const gap = ((poly.labelFontSize || 12) * 0.7 + 10) * scale;
        const pcx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const pcy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const expandedPts = pts.map((p) => {
          const dx = p.x - pcx, dy = p.y - pcy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          return { x: pcx + dx * (dist + gap) / dist, y: pcy + dy * (dist + gap) / dist };
        });
        const pos = getPointAtFraction(expandedPts, (poly.labelAngle || 0) / 360);
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(pos.angle * Math.PI / 180);
        ctx.font = `${fontWeight} ${fontSize}px Inter, Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3 * scale;
        ctx.strokeText(poly.label, 0, 0);
        ctx.fillStyle = color; ctx.fillText(poly.label, 0, 0);
        ctx.restore();
      } else {
        const minY = Math.min(...pts.map((p) => p.y));
        const midX = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
        const lx = midX + (poly.labelOffsetX || 0) * scale;
        const ly = minY - 18 * scale + (poly.labelOffsetY || 0) * scale;
        ctx.save();
        ctx.font = `${fontWeight} ${fontSize}px Inter, Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = color; ctx.fillText(poly.label, lx, ly);
        ctx.restore();
      }
    }
  });
}

export async function renderSceneToCanvas(scene, options = {}) {
  _exportWarnings = [];
  const scale = Number(options.pixelRatio || scene.project.layout?.exportSettings?.pixelRatio || 2);
  const canvas = document.createElement('canvas'); canvas.width = Math.round(scene.width * scale); canvas.height = Math.round(scene.height * scale); const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await drawTilesCanvas(ctx, scene, scale); drawRegionHighlightsCanvas(ctx, scene, scale); drawVectorsCanvas(ctx, scene, scale); drawEllipsesCanvas(ctx, scene, scale); drawPolygonsCanvas(ctx, scene, scale); await drawMarkersCanvas(ctx, scene, scale); drawCalloutsCanvas(ctx, scene, scale); drawTitleBlockCanvas(ctx, scene, scale); drawLegendCanvas(ctx, scene, scale); drawNorthArrowCanvas(ctx, scene, scale); await drawInsetCanvas(ctx, scene, scale); drawScaleBarCanvas(ctx, scene, scale); drawFooterCanvas(ctx, scene, scale); await drawLogoCanvas(ctx, scene, scale);
  if (!options.noWatermark) { ctx.save(); ctx.font = `bold ${9 * scale}px Arial, sans-serif`; ctx.fillStyle = 'rgba(100,116,139,0.72)'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.shadowColor = 'rgba(255,255,255,0.6)'; ctx.shadowBlur = 3 * scale; ctx.fillText('explorationmaps.com', canvas.width - 8 * scale, canvas.height - 5 * scale); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.restore(); }
  return canvas;
}

async function drawTilesCanvas(ctx, scene, scale) {
  const tiles = getTileImages(scene.container);
  for (const tile of tiles) {
    const img = await loadImage(tile.href, 'anonymous').catch(() => null);
    if (!img) continue;
    ctx.save(); ctx.globalAlpha = tile.opacity; ctx.drawImage(img, tile.x * scale, tile.y * scale, tile.width * scale, tile.height * scale); ctx.restore();
  }
}
function drawRegionHighlightsCanvas(ctx, scene, scale) {
  const highlights = scene.project.layout?.regionHighlights || [];
  if (!highlights.length) return;
  highlights.forEach(({ regionId, color, opacity }) => {
    const region = regionsNA.find((r) => r.id === regionId);
    if (!region) return;
    const rings = region.coordinates;
    ctx.save();
    ctx.globalAlpha = opacity ?? 0.45;
    ctx.fillStyle = color || '#ef4444';
    ctx.beginPath();
    rings.forEach((ring) => {
      ring.forEach(([lng, lat], i) => {
        const pt = scene.map.latLngToContainerPoint([lat, lng]);
        if (i === 0) ctx.moveTo(pt.x * scale, pt.y * scale);
        else ctx.lineTo(pt.x * scale, pt.y * scale);
      });
      ctx.closePath();
    });
    ctx.fill();
    ctx.restore();
  });
}

function drawVectorsCanvas(ctx, scene, scale) {
  (scene.project.layers || []).filter((layer) => layer.visible !== false && layer.geojson).forEach((layer) => {
    const lo = layer.style?.layerOpacity ?? 1;
    ctx.save(); ctx.globalAlpha = lo;
    featureCollectionFeatures(layer.geojson).forEach((feature) => drawCanvasGeometry(ctx, scene.map, feature, getTemplateStyle(scene.template, layer), scale));
    ctx.restore();
  });
}
async function drawLogoCanvas(ctx, scene, scale) {
  const logo = scene.project.layout?.logo; if (!logo) return;
  const zone = getOverlayMetrics(scene).logo; const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale, padding = 10 * scale;
  const theme = getTheme(scene);
  if (!scene.project.layout?.logoTransparent) drawPanelRect(ctx, x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.logoFill, theme.logoBorder, scale);
  const img = await new Promise((resolve, reject) => { const el = new Image(); el.onload = () => resolve(el); el.onerror = reject; el.src = logo; }).catch(() => { _exportWarnings.push('logo could not be embedded'); return null; });
  if (img) {
    // Aspect-fit: scale to fill available space preserving ratio, centered (mirrors SVG preserveAspectRatio="xMidYMid meet")
    const availW = w - padding * 2;
    const availH = h - padding * 2;
    const ratio = Math.min(availW / img.naturalWidth, availH / img.naturalHeight);
    const dw = img.naturalWidth * ratio;
    const dh = img.naturalHeight * ratio;
    const dx = x + padding + (availW - dw) / 2;
    const dy = y + padding + (availH - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }
}

async function renderBasemapImageSvg(scene, scale) {
  const width = Math.round(scene.width * scale);
  const height = Math.round(scene.height * scale);
  const tiles = getTileImages(scene.container);
  if (!tiles.length) return '';

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Load all tiles in parallel (much faster than sequential await)
  const images = await Promise.all(
    tiles.map((tile) => tile.href ? loadImage(tile.href, 'anonymous').catch(() => null) : Promise.resolve(null))
  );

  let anyDrawn = false;
  tiles.forEach((tile, i) => {
    const image = images[i];
    if (!image) return;
    ctx.save();
    ctx.globalAlpha = tile.opacity;
    ctx.drawImage(image, tile.x * scale, tile.y * scale, tile.width * scale, tile.height * scale);
    ctx.restore();
    anyDrawn = true;
  });

  if (!anyDrawn) return '';

  try {
    const pngDataUrl = canvas.toDataURL('image/png', 1.0);
    return `<image href="${escapeXml(pngDataUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" />`;
  } catch {
    _exportWarnings.push('basemap omitted from SVG (CORS restriction on tile server)');
    return '';
  }
}
function renderRegionHighlightsSvg(scene, scale) {
  const highlights = scene.project.layout?.regionHighlights || [];
  if (!highlights.length) return '';
  return highlights.map(({ regionId, color, opacity }) => {
    const region = regionsNA.find((r) => r.id === regionId);
    if (!region) return '';
    const pathData = region.coordinates.map((ring) => {
      const pts = ring.map(([lng, lat]) => {
        const pt = scene.map.latLngToContainerPoint([lat, lng]);
        return `${pt.x * scale},${pt.y * scale}`;
      });
      return `M${pts.join(' L')}Z`;
    }).join(' ');
    return `<path d="${pathData}" fill="${escapeXml(color || '#ef4444')}" fill-opacity="${opacity ?? 0.45}" stroke="none" />`;
  }).join('\n');
}

function renderVectorsSvg(scene, scale) {
  return (scene.project.layers || []).filter((layer) => layer.visible !== false && layer.geojson).map((layer) => {
    const lo = layer.style?.layerOpacity ?? 1;
    const paths = featureCollectionFeatures(layer.geojson).map((feature) => geometryToSvg(scene.map, feature, getTemplateStyle(scene.template, layer), scale)).join('\n');
    return lo < 1 ? `<g opacity="${lo}">${paths}</g>` : paths;
  }).join('\n');
}
function renderMarkerLabelSvg(scene, marker, point, scale) {
  if (!marker.label) return '';
  const labelX = point.x + (marker.size || 18) * scale * 0.5 + 8 * scale;
  const fontSize = 12 * scale;
  const estimatedWidth = marker.label.length * fontSize * 0.62 + 16 * scale;
  const labelHeight = 22 * scale;
  return `<g><rect x="${labelX}" y="${point.y - labelHeight / 2}" width="${estimatedWidth}" height="${labelHeight}" rx="${11 * scale}" fill="rgba(255,255,255,0.96)" stroke="rgba(15,23,42,0.12)" stroke-width="${Math.max(1, scale * 0.8)}" /><text x="${labelX + 8 * scale}" y="${point.y}" dominant-baseline="middle" fill="#0f172a" font-family="${escapeXml(scene.project.layout?.fonts?.label || 'Inter')}, Arial, sans-serif" font-size="${fontSize}" font-weight="700">${escapeXml(marker.label)}</text></g>`;
}
function renderMarkersSvg(scene, scale) {
  return (scene.project.markers || []).map((marker) => {
    const point = clonePoint(scene.map.latLngToContainerPoint([marker.lat, marker.lng]), scale);
    const size = (marker.size || 18) * scale;
    const color = safeColor(marker.color, '#d97706');

    if (marker.type === 'maplabel') {
      const labelFont = escapeXml(scene.project.layout?.fonts?.label || 'Inter');
      const rotate = marker.rotation ? ` transform="rotate(${marker.rotation}, ${point.x}, ${point.y})"` : '';
      return `<text x="${point.x}" y="${point.y}" text-anchor="middle" dominant-baseline="middle" fill="${safeColor(marker.color, '#1e293b')}" fill-opacity="${marker.opacity ?? 0.35}" font-size="${(marker.size || 28) * scale}" font-weight="${marker.bold !== false ? '700' : '400'}" font-family="${labelFont}, Arial, sans-serif" letter-spacing="${(marker.tracking ?? 0.12)}em"${rotate}>${escapeXml((marker.label || '').toUpperCase())}</text>`;
    }

    let symbol = '';
    if (markerIsVectorIcon(marker.type)) {
      // Use the shared SVG path data — same source as the editor, guaranteed consistent
      symbol = markerIconSvgFragment(marker.type, point.x, point.y, size, color);
    } else if (marker.type === 'triangle') {
      symbol = `<path d="M ${point.x} ${point.y - size * 0.55} L ${point.x - size * 0.5} ${point.y + size * 0.45} L ${point.x + size * 0.5} ${point.y + size * 0.45} Z" fill="${color}" />`;
    } else if (marker.type === 'circle') {
      symbol = `<circle cx="${point.x}" cy="${point.y}" r="${size / 2}" fill="${color}" stroke="${color}" stroke-width="${2 * scale}" />`;
    } else if (marker.type === 'square') {
      symbol = `<rect x="${point.x - size / 2}" y="${point.y - size / 2}" width="${size}" height="${size}" fill="${color}" stroke="${color}" stroke-width="${2 * scale}" />`;
    } else {
      // Fallback bullet
      symbol = `<circle cx="${point.x}" cy="${point.y}" r="${size / 2}" fill="${color}" />`;
    }
    return `<g>${symbol}${renderMarkerLabelSvg(scene, marker, point, scale)}</g>`;
  }).join('\n');
}
function renderPolygonsSvg(scene, scale) {
  function chaikinSvg(points, iterations = 3) {
    let pts = points;
    for (let i = 0; i < iterations; i++) {
      const next = [];
      for (let j = 0; j < pts.length; j++) {
        const a = pts[j], b = pts[(j + 1) % pts.length];
        next.push({ lat: 0.75 * a.lat + 0.25 * b.lat, lng: 0.75 * a.lng + 0.25 * b.lng });
        next.push({ lat: 0.25 * a.lat + 0.75 * b.lat, lng: 0.25 * a.lng + 0.75 * b.lng });
      }
      pts = next;
    }
    return pts;
  }
  const W = scene.width * scale, H = scene.height * scale;
  return (scene.project.polygons || []).map((poly) => {
    if (!poly.points?.length) return '';
    const rawPts = poly.smoothed ? chaikinSvg(poly.points) : poly.points;
    const pts = rawPts.map(({ lat, lng }) => {
      const pt = scene.map.latLngToContainerPoint([lat, lng]);
      return { x: pt.x * scale, y: pt.y * scale };
    });
    if (!pts.length) return '';
    const polyPath = `M ${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')} Z`;
    const dash = poly.dashed === false ? '' : ` stroke-dasharray="${10 * scale} ${5 * scale}"`;
    const color = safeColor(poly.color, '#000000');
    let shadeSvg = '';
    if (poly.outsideShade) {
      shadeSvg = `<path d="M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z ${polyPath}" fill="${escapeXml(poly.outsideShadeColor || '#000000')}" fill-opacity="${poly.outsideShadeOpacity ?? 0.35}" fill-rule="evenodd" stroke="none" />`;
    }
    let labelSvg = '';
    if (poly.label) {
      const minY = Math.min(...pts.map((p) => p.y));
      const midX = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
      const lx = midX + (poly.labelOffsetX || 0) * scale;
      const ly = minY - 18 * scale + (poly.labelOffsetY || 0) * scale;
      const fontSize = (poly.labelFontSize || 12) * scale;
      const fw = poly.labelBold !== false ? '700' : '400';
      const lc = escapeXml(poly.labelColor || poly.color || '#000000');
      labelSvg = `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="${lc}" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="${fw}">${escapeXml(poly.label)}</text>`;
    }
    return `<g>${shadeSvg}<path d="${polyPath}" fill="none" stroke="${color}" stroke-width="${(poly.strokeWidth ?? 2) * scale}"${dash} />${labelSvg}</g>`;
  }).join('\n');
}

function renderEllipsesSvg(scene, scale) {
  const labelFontFamily = escapeXml(scene.project.layout?.fonts?.label || 'Inter');
  return (scene.project.ellipses || []).map((ellipse) => {
    const { center, width, height, rotation } = resolveEllipseDimensions(ellipse, scene.map, scale);
    const effectiveLabel = ellipse.isRing && !ellipse.label ? `${ellipse.radiusKm} km` : ellipse.label;
    const dash = ellipse.dashed === false ? '' : ` stroke-dasharray="${6 * scale} ${4 * scale}"`;
    const color = safeColor(ellipse.color, '#dc2626');
    const labelColor = safeColor(ellipse.labelColor || ellipse.color, '#dc2626');
    const labelFontSize = (ellipse.labelFontSize || 11) * scale;
    const fontWeight = ellipse.labelBold !== false ? '700' : '400';

    let label = '';
    if (effectiveLabel) {
      if (ellipse.labelArc) {
        const r = width / 2;
        const textR = r + labelFontSize * 0.6 + 4 * scale;
        const cx = center.x, cy = center.y;
        const arcPath = `M ${cx} ${cy - textR} A ${textR} ${textR} 0 0 1 ${cx} ${cy + textR} A ${textR} ${textR} 0 0 1 ${cx} ${cy - textR}`;
        const offset = `${((ellipse.labelAngle ?? 0) / 360) * 100}%`;
        const pid = `svg-arc-${ellipse.id.replace(/[^a-zA-Z0-9]/g, '')}`;
        label = `<defs><path id="${pid}" d="${arcPath}" /></defs><text font-size="${labelFontSize}" font-weight="${fontWeight}" fill="${labelColor}" font-family="${labelFontFamily}, Arial, sans-serif"><textPath href="#${pid}" startOffset="${offset}" text-anchor="middle">${escapeXml(effectiveLabel)}</textPath></text>`;
      } else {
        const pos = ellipseLabelPlacement(center, width, height, rotation, scale);
        const finalX = pos.labelX + (ellipse.labelOffsetX || 0) * scale;
        const finalY = pos.labelY + (ellipse.labelOffsetY || 0) * scale;
        const labelWidth = effectiveLabel.length * labelFontSize * 0.62 + 16 * scale;
        label = `<g><line x1="${pos.anchorX}" y1="${pos.anchorY}" x2="${finalX}" y2="${finalY + 10 * scale}" stroke="${labelColor}" stroke-width="${Math.max(1, 1.4 * scale)}" stroke-dasharray="${5 * scale} ${3 * scale}" /><rect x="${finalX}" y="${finalY}" width="${labelWidth}" height="${20 * scale}" rx="${10 * scale}" fill="rgba(255,255,255,0.95)" stroke="rgba(15,23,42,0.12)" stroke-width="${Math.max(1, scale * 0.8)}" /><text x="${finalX + 8 * scale}" y="${finalY + 10 * scale}" dominant-baseline="middle" fill="${labelColor}" font-family="${labelFontFamily}, Arial, sans-serif" font-size="${labelFontSize}" font-weight="${fontWeight}">${escapeXml(effectiveLabel)}</text></g>`;
      }
    }
    let shadeSvg = '';
    if (ellipse.isRing && ellipse.outsideShade) {
      const W = scene.width * scale, H = scene.height * scale;
      const r = width / 2;
      const cx = center.x, cy = center.y;
      shadeSvg = `<path d="M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z M ${cx} ${cy} m ${-r} 0 a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0" fill="${escapeXml(ellipse.outsideShadeColor || '#000000')}" fill-opacity="${ellipse.outsideShadeOpacity ?? 0.35}" fill-rule="evenodd" stroke="none" />`;
    }
    return `<g>${shadeSvg}<g transform="rotate(${rotation} ${center.x} ${center.y})"><ellipse cx="${center.x}" cy="${center.y}" rx="${width / 2}" ry="${height / 2}" fill="none" stroke="${color}" stroke-width="${2 * scale}"${dash} /></g>${label}</g>`;
  }).join('\n');
}
function renderTitleSvg(scene, scale) {
  const theme = getTheme(scene);
  const layout = scene.project.layout || {};
  const { title } = getOverlayMetrics(scene);
  const x = title.left * scale, y = title.top * scale, w = title.width * scale, h = title.height * scale;
  const leftBar = theme.titleAccent && theme.titleAccentStyle === 'left';
  const accent = theme.titleAccent
    ? leftBar
      ? `<rect x="${x}" y="${y}" width="${6 * scale}" height="${h}" fill="${theme.titleAccent}" />`
      : `<rect x="${x}" y="${y}" width="${w}" height="${5 * scale}" fill="${theme.titleAccent}" />`
    : '';
  const textX = x + (leftBar ? 22 : 18) * scale;
  const topOff = (theme.titleAccent && !leftBar) ? 46 : 42;
  const metaItems = [layout.mapDate, layout.projectNumber, layout.mapScaleNote].filter(Boolean);
  const metaSvg = metaItems.map((item, i) =>
    `<text x="${x + w - 12 * scale}" y="${y + (topOff - 22 + i * 14) * scale}" text-anchor="end" fill="${theme.subtitleText}" font-family="Arial" font-size="${10 * scale}">${escapeXml(item)}</text>`
  ).join('');
  return `<g>${svgRect(x, y, w, h, (theme.titleRadius ?? theme.panelRadius ?? 10) * scale, theme.titleFill, theme.titleBorder, scale)}${accent}<text x="${textX}" y="${y + topOff * scale}" fill="${theme.titleText}" font-family="Arial" font-size="${26 * scale}" font-weight="700">${escapeXml(layout.title || 'Project Map')}</text><text x="${textX}" y="${y + (topOff + 22) * scale}" fill="${theme.subtitleText}" font-family="Arial" font-size="${14 * scale}">${escapeXml(layout.subtitle || '')}</text>${metaSvg}</g>`;
}
function svgPanelAccentLeft(x, y, h, theme, scale) {
  if (!theme.panelAccentLeft) return '';
  return `<rect x="${x}" y="${y}" width="${4 * scale}" height="${h}" fill="${theme.panelAccentLeft}" />`;
}
function renderLegendSvg(scene, scale) {
  const { legend } = getOverlayMetrics(scene); const items = scene.project.layout?.legendItems || []; if (!items.length) return '';
  const x = legend.left * scale, y = legend.top * scale, w = legend.width * scale, h = legend.height * scale;
  const theme = getTheme(scene);
  const lp = (theme.panelAccentLeft ? 20 : 16) * scale;
  const rows = items.map((item, index) => { const rowY = y + (40 + index * 24) * scale; return `${legendSwatchSvg(item, x + lp, rowY + 1 * scale, scale)}<text x="${x + lp + 30 * scale}" y="${rowY + 12 * scale}" fill="${theme.bodyText}" font-family="Arial" font-size="${13 * scale}">${escapeXml(item.label || 'Layer')}</text>`; }).join('\n');
  return `<g>${svgRect(x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.panelFill, theme.panelBorder, scale)}${svgPanelAccentLeft(x, y, h, theme, scale)}<text x="${x + lp}" y="${y + 24 * scale}" fill="${theme.panelTitle}" font-family="Arial" font-size="${15 * scale}" font-weight="700">${escapeXml(scene.project.layout?.legendTitle || 'Legend')}</text>${rows}</g>`;
}
function renderNorthArrowSvg(scene, scale) {
  if (scene.project.layout?.showNorthArrow === false) return '';
  const theme = getTheme(scene); const { northArrow } = getOverlayMetrics(scene); const x = northArrow.left * scale, y = northArrow.top * scale, w = northArrow.width * scale, h = northArrow.height * scale, cx = x + w / 2;
  return `<g>${svgRect(x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.northArrowFill, theme.panelBorder, scale)}${svgPanelAccentLeft(x, y, h, theme, scale)}<text x="${cx}" y="${y + 24 * scale}" text-anchor="middle" fill="${theme.northArrowText}" font-family="Arial" font-size="${14 * scale}" font-weight="700">N</text><path d="M ${cx} ${y + 28 * scale} L ${cx - 12 * scale} ${y + 62 * scale} L ${cx - 3 * scale} ${y + 62 * scale} L ${cx - 3 * scale} ${y + 88 * scale} L ${cx + 3 * scale} ${y + 88 * scale} L ${cx + 3 * scale} ${y + 62 * scale} L ${cx + 12 * scale} ${y + 62 * scale} Z" fill="${theme.northArrowText}" /></g>`;
}
function renderScaleBarSvg(scene, scale) {
  if (scene.project.layout?.showScaleBar === false) return '';
  const theme = getTheme(scene); const { scaleBar } = getOverlayMetrics(scene); const x = scaleBar.left * scale, y = scaleBar.top * scale, w = scaleBar.width * scale, h = scaleBar.height * scale, scaleState = pickScaleLabel(scene.map), barWidth = scaleState.widthPx * scale;
  return `<g>${svgRect(x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.scaleFill, theme.panelBorder, scale)}${svgPanelAccentLeft(x, y, h, theme, scale)}<rect x="${x + 16 * scale}" y="${y + 18 * scale}" width="${barWidth / 2}" height="${10 * scale}" fill="${theme.scaleStroke}" /><rect x="${x + 16 * scale + barWidth / 2}" y="${y + 18 * scale}" width="${barWidth / 2}" height="${10 * scale}" fill="#ffffff" stroke="${theme.scaleStroke}" stroke-width="${Math.max(1, scale)}" /><rect x="${x + 16 * scale}" y="${y + 18 * scale}" width="${barWidth}" height="${10 * scale}" fill="none" stroke="${theme.scaleStroke}" stroke-width="${Math.max(1, scale)}" /><text x="${x + 16 * scale}" y="${y + 48 * scale}" fill="${theme.bodyText}" font-family="Arial" font-size="${12 * scale}">${escapeXml(scaleState.label)}</text></g>`;
}
function renderFooterSvg(scene, scale) { const theme = getTheme(scene); const text = scene.project.layout?.footerText; const zone = getOverlayMetrics(scene).footer; if (!text || !zone || !zone.width || !zone.height) return ''; const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale; return `<g>${svgRect(x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.footerFill, theme.panelBorder, scale)}<text x="${x + 12 * scale}" y="${y + 25 * scale}" fill="${theme.footerText}" font-family="Arial" font-size="${12 * scale}">${escapeXml(text)}</text></g>`; }
function insetBackdropSvg(innerX, innerY, innerW, innerH, scale) {
  const px = (n) => n / 100;
  const path1 = `M ${innerX + px(12) * innerW} ${innerY + px(20) * innerH} C ${innerX + px(20) * innerW} ${innerY + px(12) * innerH}, ${innerX + px(35) * innerW} ${innerY + px(10) * innerH}, ${innerX + px(45) * innerW} ${innerY + px(16) * innerH} C ${innerX + px(55) * innerW} ${innerY + px(22) * innerH}, ${innerX + px(60) * innerW} ${innerY + px(30) * innerH}, ${innerX + px(72) * innerW} ${innerY + px(32) * innerH} C ${innerX + px(82) * innerW} ${innerY + px(34) * innerH}, ${innerX + px(88) * innerW} ${innerY + px(40) * innerH}, ${innerX + px(88) * innerW} ${innerY + px(52) * innerH} C ${innerX + px(88) * innerW} ${innerY + px(68) * innerH}, ${innerX + px(76) * innerW} ${innerY + px(78) * innerH}, ${innerX + px(62) * innerW} ${innerY + px(82) * innerH} C ${innerX + px(50) * innerW} ${innerY + px(86) * innerH}, ${innerX + px(36) * innerW} ${innerY + px(88) * innerH}, ${innerX + px(22) * innerW} ${innerY + px(82) * innerH} C ${innerX + px(12) * innerW} ${innerY + px(78) * innerH}, ${innerX + px(8) * innerW} ${innerY + px(68) * innerH}, ${innerX + px(10) * innerW} ${innerY + px(54) * innerH} C ${innerX + px(12) * innerW} ${innerY + px(42) * innerH}, ${innerX + px(8) * innerW} ${innerY + px(30) * innerH}, ${innerX + px(12) * innerW} ${innerY + px(20) * innerH} Z`;
  const path2 = `M ${innerX + px(20) * innerW} ${innerY + px(26) * innerH} C ${innerX + px(28) * innerW} ${innerY + px(20) * innerH}, ${innerX + px(38) * innerW} ${innerY + px(20) * innerH}, ${innerX + px(45) * innerW} ${innerY + px(24) * innerH} C ${innerX + px(52) * innerW} ${innerY + px(28) * innerH}, ${innerX + px(57) * innerW} ${innerY + px(32) * innerH}, ${innerX + px(65) * innerW} ${innerY + px(34) * innerH} C ${innerX + px(70) * innerW} ${innerY + px(36) * innerH}, ${innerX + px(76) * innerW} ${innerY + px(39) * innerH}, ${innerX + px(78) * innerW} ${innerY + px(46) * innerH} C ${innerX + px(80) * innerW} ${innerY + px(52) * innerH}, ${innerX + px(76) * innerW} ${innerY + px(58) * innerH}, ${innerX + px(68) * innerW} ${innerY + px(62) * innerH} C ${innerX + px(58) * innerW} ${innerY + px(68) * innerH}, ${innerX + px(46) * innerW} ${innerY + px(72) * innerH}, ${innerX + px(32) * innerW} ${innerY + px(70) * innerH} C ${innerX + px(24) * innerW} ${innerY + px(69) * innerH}, ${innerX + px(18) * innerW} ${innerY + px(64) * innerH}, ${innerX + px(16) * innerW} ${innerY + px(56) * innerH} C ${innerX + px(14) * innerW} ${innerY + px(48) * innerH}, ${innerX + px(14) * innerW} ${innerY + px(34) * innerH}, ${innerX + px(20) * innerW} ${innerY + px(26) * innerH} Z`;
  const roads = `<path d="M ${innerX + px(14) * innerW} ${innerY + px(62) * innerH} C ${innerX + px(28) * innerW} ${innerY + px(55) * innerH}, ${innerX + px(45) * innerW} ${innerY + px(56) * innerH}, ${innerX + px(60) * innerW} ${innerY + px(48) * innerH} S ${innerX + px(82) * innerW} ${innerY + px(36) * innerH}, ${innerX + px(92) * innerW} ${innerY + px(28) * innerH}" fill="none" stroke="#cfd8e3" stroke-width="${1.4 * scale}" stroke-linecap="round" /><path d="M ${innerX + px(22) * innerW} ${innerY + px(15) * innerH} C ${innerX + px(30) * innerW} ${innerY + px(30) * innerH}, ${innerX + px(33) * innerW} ${innerY + px(48) * innerH}, ${innerX + px(28) * innerW} ${innerY + px(84) * innerH}" fill="none" stroke="#d7e0ea" stroke-width="${1.4 * scale}" stroke-linecap="round" />`;
  const river = `<path d="M ${innerX + px(8) * innerW} ${innerY + px(44) * innerH} C ${innerX + px(18) * innerW} ${innerY + px(36) * innerH}, ${innerX + px(28) * innerW} ${innerY + px(42) * innerH}, ${innerX + px(38) * innerW} ${innerY + px(36) * innerH} S ${innerX + px(58) * innerW} ${innerY + px(26) * innerH}, ${innerX + px(70) * innerW} ${innerY + px(36) * innerH} S ${innerX + px(88) * innerW} ${innerY + px(62) * innerH}, ${innerX + px(95) * innerW} ${innerY + px(56) * innerH}" fill="none" stroke="#b5d8f7" stroke-width="${1.8 * scale}" stroke-linecap="round" />`;
  return `<defs><linearGradient id="locatorBg" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#f8fafc" /><stop offset="100%" stop-color="#eef3f8" /></linearGradient></defs><rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" fill="url(#locatorBg)" stroke="#d3dce8" rx="${8 * scale}" /><path d="${path1}" fill="#eef3f8" stroke="#c9d4df" stroke-width="${0.8 * scale}" /><path d="${path2}" fill="#f4f7fa" stroke="#c9d4df" stroke-width="${0.8 * scale}" />${roads}${river}`;
}
function renderInsetSvg(scene, scale) {
  const zone = getOverlayMetrics(scene).inset; if (!zone || !zone.width || !zone.height) return ''; 
  const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale, innerX = x + 10 * scale, innerY = y + 30 * scale, innerW = w - 20 * scale, innerH = h - 56 * scale;
  const { insetImage, insetMode, autoInsetRegion, insetTitle, insetLabel } = scene.project.layout || {};
  const customInset = insetMode === 'custom_image' && insetImage;
  const theme = getTheme(scene);
  const panelSvg = svgRect(x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.insetFill, theme.insetBorder, scale);
  const titleSvg = `<text x="${x + 12 * scale}" y="${y + 16 * scale}" fill="${theme.insetTitle}" font-family="Arial" font-size="${12 * scale}" font-weight="700">${escapeXml(insetTitle || 'Project Locator')}</text>`;
  if (customInset) {
    return `<g>${panelSvg}${titleSvg}<image href="${escapeXml(insetImage)}" x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" preserveAspectRatio="xMidYMid slice" /></g>`;
  }
  const visible = (scene.project.layers || []).filter((layer) => layer.visible !== false && layer.geojson);
  const bounds = unionBounds(visible.map((layer) => geojsonBounds(layer.geojson)).filter(Boolean));
  if (autoInsetRegion) {
    const innerSvg = autoInsetSvg(innerX, innerY, innerW, innerH, scale, autoInsetRegion, bounds);
    const labelSvg = `<text x="${x + 12 * scale}" y="${y + h - 10 * scale}" fill="${theme.insetMuted}" font-family="Arial" font-size="${11 * scale}">${escapeXml(insetLabel || autoInsetRegion.name)}</text>`;
    return `<g>${panelSvg}${titleSvg}${innerSvg}${labelSvg}</g>`;
  }
  const ref = resolveReferenceBounds(bounds, insetMode); const marker = normalizeInset(bounds, ref);
  const markerSvg = marker ? `<rect x="${Math.max(innerX + 8 * scale, innerX + (marker.x / 100) * innerW)}" y="${Math.max(innerY + 8 * scale, innerY + (marker.y / 100) * innerH)}" width="${Math.max(8 * scale, Math.max(10 * scale, (marker.w / 100) * innerW))}" height="${Math.max(8 * scale, Math.max(10 * scale, (marker.h / 100) * innerH))}" fill="rgba(96,165,250,0.16)" stroke="#2563eb" stroke-width="${1.5 * scale}" rx="${2 * scale}" /><circle cx="${Math.min(innerX + innerW - 8 * scale, Math.max(innerX + 8 * scale, innerX + (marker.x / 100) * innerW + Math.max(10 * scale, (marker.w / 100) * innerW) / 2))}" cy="${Math.min(innerY + innerH - 8 * scale, Math.max(innerY + 8 * scale, innerY + (marker.y / 100) * innerH + Math.max(10 * scale, (marker.h / 100) * innerH) / 2))}" r="${3.2 * scale}" fill="#0f2c56" stroke="#ffffff" stroke-width="${1.2 * scale}" />` : '';
  return `<g>${panelSvg}${titleSvg}${insetBackdropSvg(innerX, innerY, innerW, innerH, scale)}${markerSvg}<text x="${x + 12 * scale}" y="${y + h - 10 * scale}" fill="${theme.insetMuted}" font-family="Arial" font-size="${11 * scale}">${escapeXml(insetLabel || ref.label)}</text></g>`;
}
function renderLogoSvg(scene, scale) { const theme = getTheme(scene); const logo = scene.project.layout?.logo; if (!logo) return ''; const zone = getOverlayMetrics(scene).logo; if (!zone?.width || !zone?.height) return '';  const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale, padding = 10 * scale; return `<g>${svgRect(x, y, w, h, (theme.panelRadius ?? 10) * scale, theme.logoFill, theme.logoBorder, scale)}<image href="${escapeXml(logo)}" x="${x + padding}" y="${y + padding}" width="${w - padding * 2}" height="${h - padding * 2}" preserveAspectRatio="xMidYMid meet" /></g>`; }
function renderCalloutsSvg(scene, scale) {
  const calloutFont = `${scene.project.layout?.fonts?.callout || 'Inter'}, Arial, sans-serif`;
  return placeCallouts(scene, scale).map((c) => {
    const leaderColor = c.style?.border || '#102640';
    const dot = `<circle cx="${c.anchorPx.x}" cy="${c.anchorPx.y}" r="${4 * scale}" fill="${leaderColor}" />`;

    if (c.type === 'badge') {
      const chipChars = (c.badgeValue || '').length;
      const chipW = Math.max(44 * scale, chipChars * 8 * scale + 20 * scale);
      const labelW = c.width - chipW;
      const badgeSvgEp = leaderEndpoint(c.anchorPx, c);
      const midY = c.top + c.height / 2;
      const line = `<line x1="${c.anchorPx.x}" y1="${c.anchorPx.y}" x2="${badgeSvgEp.x}" y2="${badgeSvgEp.y}" stroke="${leaderColor}" stroke-width="${1.4 * scale}" />`;
      const chipRect = `<rect x="${c.left}" y="${c.top}" width="${chipW}" height="${c.height}" rx="${6 * scale}" fill="${c.badgeColor || '#d97706'}" />`;
      const labelRect = `<rect x="${c.left + chipW}" y="${c.top}" width="${labelW}" height="${c.height}" rx="${6 * scale}" fill="${c.style?.background || '#ffffff'}" />`;
      const chipText = `<text x="${c.left + chipW / 2}" y="${midY}" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-family="${calloutFont}" font-size="${12 * scale}" font-weight="700">${escapeXml(c.badgeValue || '—')}</text>`;
      const labelText = `<text x="${c.left + chipW + 8 * scale}" y="${midY}" dominant-baseline="middle" fill="${c.style?.textColor || '#0f172a'}" font-family="${calloutFont}" font-size="${12 * scale}" font-weight="600">${escapeXml(c.text || '')}</text>`;
      return `<g>${line}${dot}${chipRect}${labelRect}${chipText}${labelText}</g>`;
    }

    const svgEp = leaderEndpoint(c.anchorPx, c);
    const line = c.type === 'leader' || c.type === 'boxed' ? `<line x1="${c.anchorPx.x}" y1="${c.anchorPx.y}" x2="${svgEp.x}" y2="${svgEp.y}" stroke="${leaderColor}" stroke-width="${1.4 * scale}" ${c.type === 'leader' ? `stroke-dasharray="${5 * scale} ${3 * scale}"` : ''} />` : '';
    const boxFill = c.style?.background || 'rgba(255,255,255,0.97)';
    const boxStroke = c.style?.border || '#17304f';
    const box = c.type !== 'plain' ? `<rect x="${c.left}" y="${c.top}" width="${c.width}" height="${c.height}" rx="${6 * scale}" fill="${boxFill}" stroke="${boxStroke}" />` : '';
    const textFill = c.style?.textColor || '#102640';
    const textX = c.left + (c.type === 'plain' ? 0 : 10 * scale);
    const textY = c.top + (c.type === 'plain' ? 10 * scale : c.subtext ? c.height / 2 - 9 * scale : c.height / 2);
    const mainText = `<text x="${textX}" y="${textY}" dominant-baseline="middle" fill="${textFill}" font-family="${calloutFont}" font-size="${12 * scale}" font-weight="700">${escapeXml(c.text || '')}</text>`;
    const subtextEl = c.subtext ? `<text x="${textX}" y="${textY + 16 * scale}" dominant-baseline="middle" fill="${c.style?.subtextColor || '#475569'}" font-family="${calloutFont}" font-size="${10 * scale}">${escapeXml(c.subtext)}</text>` : '';
    return `<g>${line}${dot}${box}${mainText}${subtextEl}</g>`;
  }).join('\n');
}

export async function renderSceneToSvg(scene, options = {}) {
  _exportWarnings = [];
  const scale = Number(options.pixelRatio || scene.project.layout?.exportSettings?.pixelRatio || 2); const width = Math.round(scene.width * scale), height = Math.round(scene.height * scale);
  const basemapImage = await renderBasemapImageSvg(scene, scale);
  const watermark = options.noWatermark ? '' : `<text x="${width - 8}" y="${height - 5}" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="rgba(100,116,139,0.72)" text-anchor="end" paint-order="stroke" stroke="rgba(255,255,255,0.55)" stroke-width="2.5" stroke-linejoin="round">explorationmaps.com</text>`;
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff" />${basemapImage}${renderRegionHighlightsSvg(scene, scale)}${renderVectorsSvg(scene, scale)}${renderEllipsesSvg(scene, scale)}${renderPolygonsSvg(scene, scale)}${renderMarkersSvg(scene, scale)}${renderCalloutsSvg(scene, scale)}${renderTitleSvg(scene, scale)}${renderLegendSvg(scene, scale)}${renderNorthArrowSvg(scene, scale)}${renderInsetSvg(scene, scale)}${renderScaleBarSvg(scene, scale)}${renderFooterSvg(scene, scale)}${renderLogoSvg(scene, scale)}${watermark}</svg>`;
}
export function downloadCanvas(filename, canvas) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }, 'image/png', 1.0);
}
export function downloadSvg(filename, svgText) { downloadBlob(filename, new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })); }
