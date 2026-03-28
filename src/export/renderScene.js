import { escapeXml, downloadBlob } from '../utils/svg';
import { geojsonBounds, unionBounds } from '../utils/geometry';
import { resolveTemplateZones } from '../templates/technicalResultsTemplate';
import { getThemeTokens } from '../utils/themeTokens';

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
  return Array.from(container.querySelectorAll('.leaflet-tile-pane img.leaflet-tile'))
    .map((img) => {
      const rect = img.getBoundingClientRect();
      return {
        href: img.currentSrc || img.src,
        x: rect.left - rootRect.left,
        y: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
        opacity: Number.parseFloat(getComputedStyle(img).opacity || '1') || 1,
      };
    })
    .filter((tile) => tile.href && tile.width > 0 && tile.height > 0);
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
function setCanvasFill(ctx, style) { ctx.fillStyle = rgba(style.fill || style.markerFill || style.markerColor || '#111111', style.fillOpacity ?? 0.2); }
function drawCanvasGeometry(ctx, map, feature, style, scale) {
  const type = getLayerGeometryType(feature); const coords = feature?.geometry?.coordinates; if (!coords) return;
  if (type === 'Polygon') { ctx.beginPath(); coords.forEach((ring) => drawCanvasPath(ctx, projectRing(map, ring, scale), true)); setCanvasFill(ctx, style); ctx.fill('evenodd'); setCanvasStroke(ctx, style, scale); ctx.stroke(); return; }
  if (type === 'MultiPolygon') { ctx.beginPath(); coords.forEach((polygon) => polygon.forEach((ring) => drawCanvasPath(ctx, projectRing(map, ring, scale), true))); setCanvasFill(ctx, style); ctx.fill('evenodd'); setCanvasStroke(ctx, style, scale); ctx.stroke(); return; }
  if (type === 'LineString') { ctx.beginPath(); drawCanvasPath(ctx, projectLine(map, coords, scale), false); setCanvasStroke(ctx, style, scale); ctx.stroke(); return; }
  if (type === 'MultiLineString') { ctx.beginPath(); coords.forEach((line) => drawCanvasPath(ctx, projectLine(map, line, scale), false)); setCanvasStroke(ctx, style, scale); ctx.stroke(); return; }
  if (type === 'Point') { const pt = projectCoordinate(map, coords, scale); const radius = (style.markerSize ?? 8) * scale * 0.5; ctx.beginPath(); ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2); ctx.fillStyle = style.markerFill || style.markerColor || '#ffffff'; ctx.fill(); ctx.lineWidth = (style.strokeWidth ?? 1.5) * scale; ctx.strokeStyle = style.markerColor || style.stroke || '#111111'; ctx.stroke(); return; }
  if (type === 'MultiPoint') coords.forEach((coord) => drawCanvasGeometry(ctx, map, { geometry: { type: 'Point', coordinates: coord } }, style, scale));
}
function geometryToSvg(map, feature, style, scale) {
  const type = getLayerGeometryType(feature); const coords = feature?.geometry?.coordinates; if (!coords) return '';
  const stroke = style.stroke || style.markerColor || '#111111';
  const fill = style.fill || style.markerFill || style.markerColor || '#111111';
  const fillOpacity = style.fillOpacity ?? 0.2;
  const strokeWidth = (style.strokeWidth ?? 2) * scale;
  const dash = style.dashArray ? ` stroke-dasharray="${escapeXml(style.dashArray)}"` : '';
  if (type === 'Polygon') return `<path d="${coords.map((ring) => pathFromPoints(projectRing(map, ring, scale), true)).filter(Boolean).join(' ')}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} fill-rule="evenodd" />`;
  if (type === 'MultiPolygon') return `<path d="${coords.flatMap((polygon) => polygon.map((ring) => pathFromPoints(projectRing(map, ring, scale), true))).filter(Boolean).join(' ')}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} fill-rule="evenodd" />`;
  if (type === 'LineString') return `<path d="${pathFromPoints(projectLine(map, coords, scale), false)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} stroke-linecap="round" stroke-linejoin="round" />`;
  if (type === 'MultiLineString') return `<path d="${coords.map((line) => pathFromPoints(projectLine(map, line, scale), false)).filter(Boolean).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} stroke-linecap="round" stroke-linejoin="round" />`;
  if (type === 'Point') { const pt = projectCoordinate(map, coords, scale); const radius = (style.markerSize ?? 8) * scale * 0.5; return `<circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${style.markerFill || fill}" stroke="${style.markerColor || stroke}" stroke-width="${Math.max(scale, strokeWidth * 0.4).toFixed(2)}" />`; }
  if (type === 'MultiPoint') return coords.map((coord) => geometryToSvg(map, { geometry: { type: 'Point', coordinates: coord } }, style, scale)).join('');
  return '';
}
function getOverlayMetrics(scene) {
  return resolveTemplateZones(scene.template, scene.project.layout || {}, { width: scene.width, height: scene.height });
}
function drawRoundedRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function getTheme(scene) {
  return getThemeTokens(scene?.project?.layout?.themeId || 'modern_rounded');
}

function drawPanelRect(ctx, x, y, w, h, radius, fill, border, scale) {
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = Math.max(1, scale);
  ctx.stroke();
}

function svgRect(x, y, w, h, r, fill, border, scale) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${border}" stroke-width="${Math.max(1, scale)}" />`;
}


function drawTitleBlockCanvas(ctx, scene, scale) {
  const theme = getTheme(scene);
  const { title } = getOverlayMetrics(scene); const x = title.left * scale, y = title.top * scale, w = title.width * scale, h = title.height * scale;
  drawPanelRect(ctx, x, y, w, h, (theme.titleRadius || theme.panelRadius || 10) * scale, theme.titleFill, theme.titleBorder, scale);
  if (theme.titleAccent) { ctx.fillStyle = theme.titleAccent; ctx.fillRect(x, y, w, 5 * scale); }
  ctx.fillStyle = theme.titleText; ctx.font = `700 ${26 * scale}px Arial`; ctx.textBaseline = 'top'; ctx.fillText(scene.project.layout?.title || 'Project Map', x + 18 * scale, y + (theme.titleAccent ? 20 : 16) * scale);
  ctx.fillStyle = theme.subtitleText; ctx.font = `${14 * scale}px Arial`; ctx.fillText(scene.project.layout?.subtitle || 'Technical results template', x + 18 * scale, y + (theme.titleAccent ? 56 : 52) * scale);
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
  const { legend } = getOverlayMetrics(scene); const items = scene.project.layout?.legendItems || []; if (!items.length || !legend?.width || !legend?.height) return;
  const x = legend.left * scale, y = legend.top * scale, w = legend.width * scale, h = legend.height * scale;
  drawPanelRect(ctx, x, y, w, h, (theme.panelRadius || 10) * scale, theme.panelFill, theme.panelBorder, scale);
  ctx.fillStyle = theme.panelTitle; ctx.font = `700 ${15 * scale}px Arial`; ctx.textBaseline = 'top'; ctx.fillText('Legend', x + 16 * scale, y + 14 * scale);
  let rowY = y + 40 * scale;
  groupLegendItems(items, scene.project.layout).forEach((group) => {
    if (group.heading) { ctx.fillStyle = theme.mutedText; ctx.font = `700 ${11 * scale}px Arial`; ctx.fillText(group.heading.toUpperCase(), x + 16 * scale, rowY); rowY += 18 * scale; }
    group.items.forEach((item) => {
      if (item.type === 'points') {
        ctx.beginPath(); ctx.arc(x + 24 * scale, rowY + 9 * scale, 5 * scale, 0, Math.PI * 2); ctx.fillStyle = item.style.markerFill || item.style.markerColor || '#ffffff'; ctx.fill(); ctx.strokeStyle = item.style.markerColor || '#111111'; ctx.lineWidth = Math.max(1, scale); ctx.stroke();
      } else {
        ctx.fillStyle = rgba(item.style.fill || '#93c5fd', item.style.fillOpacity ?? 0.22); ctx.fillRect(x + 16 * scale, rowY + 2 * scale, 18 * scale, 12 * scale); ctx.strokeStyle = item.style.stroke || '#3b82f6'; ctx.lineWidth = Math.max(1, scale); ctx.strokeRect(x + 16 * scale, rowY + 2 * scale, 18 * scale, 12 * scale);
      }
      ctx.fillStyle = theme.bodyText; ctx.font = `${13 * scale}px Arial`; ctx.textBaseline = 'middle'; ctx.fillText(item.label || 'Layer', x + 46 * scale, rowY + 9 * scale); rowY += 24 * scale;
    });
    rowY += 6 * scale;
  });
}

function drawNorthArrowCanvas(ctx, scene, scale) {
  const theme = getTheme(scene);
  const { northArrow } = getOverlayMetrics(scene); const x = northArrow.left * scale, y = northArrow.top * scale, w = northArrow.width * scale, h = northArrow.height * scale, cx = x + w / 2;
  drawPanelRect(ctx, x, y, w, h, (theme.panelRadius || 10) * scale, theme.northArrowFill, theme.panelBorder, scale);
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
  const theme = getTheme(scene);
  const { scaleBar } = getOverlayMetrics(scene); const x = scaleBar.left * scale, y = scaleBar.top * scale, w = scaleBar.width * scale, h = scaleBar.height * scale, scaleState = pickScaleLabel(scene.map), barWidth = scaleState.widthPx * scale;
  drawPanelRect(ctx, x, y, w, h, (theme.panelRadius || 10) * scale, theme.scaleFill, theme.panelBorder, scale);
  ctx.fillStyle = theme.scaleStroke; ctx.fillRect(x + 16 * scale, y + 18 * scale, barWidth / 2, 10 * scale); ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 16 * scale + barWidth / 2, y + 18 * scale, barWidth / 2, 10 * scale); ctx.strokeStyle = theme.scaleStroke; ctx.lineWidth = Math.max(1, scale); ctx.strokeRect(x + 16 * scale, y + 18 * scale, barWidth, 10 * scale);
  ctx.fillStyle = theme.bodyText; ctx.font = `${12 * scale}px Arial`; ctx.textBaseline = 'top'; ctx.fillText(scaleState.label, x + 16 * scale, y + 40 * scale);
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
  drawPanelRect(ctx, x, y, w, h, (theme.panelRadius || 10) * scale, theme.insetFill, theme.insetBorder, scale);
  ctx.fillStyle = theme.insetTitle; ctx.font = `700 ${12 * scale}px Arial`; ctx.textBaseline = 'top'; ctx.fillText('Project Locator', x + 12 * scale, y + 10 * scale);
  const innerX = x + 10 * scale, innerY = y + 30 * scale, innerW = w - 20 * scale, innerH = h - 56 * scale;
  const customInset = scene.project.layout?.insetMode === 'custom_image' && scene.project.layout?.insetImage;
  if (customInset) {
    const img = await new Promise((resolve, reject) => { const el = new Image(); el.onload = () => resolve(el); el.onerror = reject; el.src = scene.project.layout.insetImage; }).catch(() => null);
    if (img) { ctx.save(); drawRoundedRect(ctx, innerX, innerY, innerW, innerH, 8 * scale); ctx.clip(); ctx.drawImage(img, innerX, innerY, innerW, innerH); ctx.restore(); }
    ctx.fillStyle = theme.insetMuted; ctx.font = `${11 * scale}px Arial`; ctx.textBaseline = 'alphabetic'; ctx.fillText('Uploaded Inset', x + 12 * scale, y + h - 10 * scale);
    return;
  }
  const visible = (scene.project.layers || []).filter((layer) => layer.visible !== false && layer.geojson); const bounds = unionBounds(visible.map((layer) => geojsonBounds(layer.geojson)).filter(Boolean)); const ref = resolveReferenceBounds(bounds, scene.project.layout?.insetMode); const marker = normalizeInset(bounds, ref);
  drawInsetBackdropCanvas(ctx, innerX, innerY, innerW, innerH, scale);
  if (marker) { const mx = Math.max(innerX + 8 * scale, innerX + (marker.x / 100) * innerW), my = Math.max(innerY + 8 * scale, innerY + (marker.y / 100) * innerH), mw = Math.max(8 * scale, Math.max(10 * scale, (marker.w / 100) * innerW)), mh = Math.max(8 * scale, Math.max(10 * scale, (marker.h / 100) * innerH)); ctx.fillStyle = 'rgba(96,165,250,0.16)'; drawRoundedRect(ctx, mx, my, mw, mh, 2 * scale); ctx.fill(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.5 * scale; ctx.stroke(); ctx.beginPath(); ctx.arc(Math.min(innerX + innerW - 8 * scale, Math.max(innerX + 8 * scale, mx + mw / 2)), Math.min(innerY + innerH - 8 * scale, Math.max(innerY + 8 * scale, my + mh / 2)), 3.2 * scale, 0, Math.PI * 2); ctx.fillStyle = '#0f2c56'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2 * scale; ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = theme.insetMuted; ctx.font = `${11 * scale}px Arial`; ctx.textBaseline = 'alphabetic'; ctx.fillText(ref.label, x + 12 * scale, y + h - 10 * scale);
}
function drawFooterCanvas(ctx, scene, scale) {
  const theme = getTheme(scene);
  const text = scene.project.layout?.footerText; const zone = getOverlayMetrics(scene).footer; if (!text || !zone) return; const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale;
  drawPanelRect(ctx, x, y, w, h, (theme.panelRadius || 10) * scale, theme.footerFill, theme.panelBorder, scale);
  ctx.fillStyle = theme.footerText; ctx.font = `${12 * scale}px Arial`; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 12 * scale, y + h / 2);
}

function intersectsCallout(a, b, padding = 10) { return !(a.left + a.width + padding < b.left || b.left + b.width + padding < a.left || a.top + a.height + padding < b.top || b.top + b.height + padding < a.top); }
function placeCallouts(scene, scale) {
  const callouts = (scene.project.callouts || []).slice().sort((a, b) => (a.priority || 2) - (b.priority || 2)); const placed = [];
  callouts.forEach((callout) => {
    if (!callout.anchor) return;
    const pt = scene.map.latLngToContainerPoint([callout.anchor.lat, callout.anchor.lng]);
    const width = callout.type === 'boxed' ? 188 : callout.type === 'leader' ? 146 : 136; const height = callout.type === 'boxed' ? 42 : 24;
    let left = pt.x + (callout.offset?.x || 0); let top = pt.y + (callout.offset?.y || 0); let candidate = { ...callout, left, top, width, height, anchorPx: { x: pt.x, y: pt.y } }; let attempts = 0;
    while (placed.some((other) => intersectsCallout(candidate, other, 10)) && attempts < 8) { top += 18; left += attempts % 2 === 0 ? 8 : -6; candidate = { ...candidate, left, top }; attempts += 1; }
    if (!placed.some((other) => intersectsCallout(candidate, other, 2))) placed.push({ ...candidate, left: left * scale, top: top * scale, width: width * scale, height: height * scale, anchorPx: { x: pt.x * scale, y: pt.y * scale } });
  });
  return placed;
}
function drawCalloutsCanvas(ctx, scene, scale) {
  placeCallouts(scene, scale).forEach((c) => {
    if (c.type === 'leader' || c.type === 'boxed') { ctx.beginPath(); ctx.moveTo(c.anchorPx.x, c.anchorPx.y); ctx.lineTo(c.left + 10 * scale, c.top + c.height / 2); ctx.strokeStyle = '#102640'; ctx.lineWidth = 1.4 * scale; ctx.setLineDash(c.type === 'leader' ? [5 * scale, 3 * scale] : []); ctx.stroke(); }
    ctx.setLineDash([]);
    const theme = getTheme(scene);
    if (c.type !== 'plain') { drawRoundedRect(ctx, c.left, c.top, c.width, c.height, Math.max(3, (theme.panelRadius || 10) - 4) * scale); ctx.fillStyle = theme.calloutFill; ctx.fill(); ctx.strokeStyle = theme.calloutBorder; ctx.lineWidth = 1 * scale; ctx.stroke(); }
    ctx.fillStyle = theme.calloutText; ctx.font = `700 ${12 * scale}px Arial`; ctx.textBaseline = 'middle'; ctx.fillText(c.text || '', c.left + (c.type === 'plain' ? 0 : 10 * scale), c.top + (c.type === 'plain' ? 10 * scale : c.height / 2));
  });
}

export async function renderSceneToCanvas(scene, options = {}) {
  const scale = Number(options.pixelRatio || scene.project.layout?.exportSettings?.pixelRatio || 2);
  const canvas = document.createElement('canvas'); canvas.width = Math.round(scene.width * scale); canvas.height = Math.round(scene.height * scale); const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f3f5f7'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await drawTilesCanvas(ctx, scene, scale); drawVectorsCanvas(ctx, scene, scale); drawCalloutsCanvas(ctx, scene, scale); drawTitleBlockCanvas(ctx, scene, scale); drawLegendCanvas(ctx, scene, scale); drawNorthArrowCanvas(ctx, scene, scale); await drawInsetCanvas(ctx, scene, scale); drawScaleBarCanvas(ctx, scene, scale); drawFooterCanvas(ctx, scene, scale); await drawLogoCanvas(ctx, scene, scale);
  return canvas;
}

async function drawTilesCanvas(ctx, scene, scale) {
  const tiles = getTileImages(scene.container);
  for (const tile of tiles) {
    const img = await new Promise((resolve, reject) => {
      const el = new Image(); el.crossOrigin = 'anonymous'; el.onload = () => resolve(el); el.onerror = reject; el.src = tile.href;
    }).catch(() => null);
    if (!img) continue;
    ctx.save(); ctx.globalAlpha = tile.opacity; ctx.drawImage(img, tile.x * scale, tile.y * scale, tile.width * scale, tile.height * scale); ctx.restore();
  }
}
function drawVectorsCanvas(ctx, scene, scale) { (scene.project.layers || []).filter((layer) => layer.visible !== false && layer.geojson).forEach((layer) => featureCollectionFeatures(layer.geojson).forEach((feature) => drawCanvasGeometry(ctx, scene.map, feature, getTemplateStyle(scene.template, layer), scale))); }
async function drawLogoCanvas(ctx, scene, scale) {
  const logo = scene.project.layout?.logo; if (!logo) return;
  const zone = getOverlayMetrics(scene).logo; const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale, padding = 10 * scale;
  const theme = getTheme(scene);
  drawPanelRect(ctx, x, y, w, h, (theme.panelRadius || 10) * scale, theme.logoFill, theme.logoBorder, scale);
  const img = await new Promise((resolve, reject) => { const el = new Image(); el.onload = () => resolve(el); el.onerror = reject; el.src = logo; }).catch(() => null);
  if (img) ctx.drawImage(img, x + padding, y + padding, w - padding * 2, h - padding * 2);
}

function renderTileImagesSvg(scene, scale) { return getTileImages(scene.container).map((tile) => `<image href="${escapeXml(tile.href)}" x="${(tile.x * scale).toFixed(2)}" y="${(tile.y * scale).toFixed(2)}" width="${(tile.width * scale).toFixed(2)}" height="${(tile.height * scale).toFixed(2)}" opacity="${tile.opacity}" preserveAspectRatio="none" />`).join('\n'); }
function renderVectorsSvg(scene, scale) { return (scene.project.layers || []).filter((layer) => layer.visible !== false && layer.geojson).map((layer) => featureCollectionFeatures(layer.geojson).map((feature) => geometryToSvg(scene.map, feature, getTemplateStyle(scene.template, layer), scale)).join('\n')).join('\n'); }
function renderTitleSvg(scene, scale) { const theme = getTheme(scene); const { title } = getOverlayMetrics(scene); const x = title.left * scale, y = title.top * scale, w = title.width * scale, h = title.height * scale; const accent = theme.titleAccent ? `<rect x="${x}" y="${y}" width="${w}" height="${5 * scale}" fill="${theme.titleAccent}" />` : ''; return `<g>${svgRect(x, y, w, h, (theme.titleRadius || theme.panelRadius || 10) * scale, theme.titleFill, theme.titleBorder, scale)}${accent}<text x="${x + 18 * scale}" y="${y + (theme.titleAccent ? 46 : 42) * scale}" fill="${theme.titleText}" font-family="Arial" font-size="${26 * scale}" font-weight="700">${escapeXml(scene.project.layout?.title || 'Project Map')}</text><text x="${x + 18 * scale}" y="${y + (theme.titleAccent ? 70 : 66) * scale}" fill="${theme.subtitleText}" font-family="Arial" font-size="${14 * scale}">${escapeXml(scene.project.layout?.subtitle || 'Technical results template')}</text></g>`; }
function renderLegendSvg(scene, scale) {
  const { legend } = getOverlayMetrics(scene); const items = scene.project.layout?.legendItems || []; if (!items.length) return '';
  const x = legend.left * scale, y = legend.top * scale, w = legend.width * scale, h = legend.height * scale;
  const rows = items.map((item, index) => { const rowY = y + (40 + index * 24) * scale; return `${legendSwatchSvg(item, x + 16 * scale, rowY + 1 * scale, scale)}<text x="${x + 46 * scale}" y="${rowY + 12 * scale}" fill="#1d2b3d" font-family="Arial" font-size="${13 * scale}">${escapeXml(item.label || 'Layer')}</text>`; }).join('\n');
  const theme = getTheme(scene); return `<g>${svgRect(x, y, w, h, (theme.panelRadius || 10) * scale, theme.panelFill, theme.panelBorder, scale)}<text x="${x + 16 * scale}" y="${y + 24 * scale}" fill="${theme.panelTitle}" font-family="Arial" font-size="${15 * scale}" font-weight="700">Legend</text>${rows.replaceAll('#1d2b3d', theme.bodyText)}</g>`;
}
function renderNorthArrowSvg(scene, scale) { const theme = getTheme(scene); const { northArrow } = getOverlayMetrics(scene); const x = northArrow.left * scale, y = northArrow.top * scale, w = northArrow.width * scale, h = northArrow.height * scale, cx = x + w / 2; return `<g>${svgRect(x, y, w, h, (theme.panelRadius || 10) * scale, theme.northArrowFill, theme.panelBorder, scale)}<text x="${cx}" y="${y + 24 * scale}" text-anchor="middle" fill="${theme.northArrowText}" font-family="Arial" font-size="${14 * scale}" font-weight="700">N</text><path d="M ${cx} ${y + 28 * scale} L ${cx - 12 * scale} ${y + 62 * scale} L ${cx - 3 * scale} ${y + 62 * scale} L ${cx - 3 * scale} ${y + 88 * scale} L ${cx + 3 * scale} ${y + 88 * scale} L ${cx + 3 * scale} ${y + 62 * scale} L ${cx + 12 * scale} ${y + 62 * scale} Z" fill="${theme.northArrowText}" /></g>`; }
function renderScaleBarSvg(scene, scale) { const theme = getTheme(scene); const { scaleBar } = getOverlayMetrics(scene); const x = scaleBar.left * scale, y = scaleBar.top * scale, w = scaleBar.width * scale, h = scaleBar.height * scale, scaleState = pickScaleLabel(scene.map), barWidth = scaleState.widthPx * scale; return `<g>${svgRect(x, y, w, h, (theme.panelRadius || 10) * scale, theme.scaleFill, theme.panelBorder, scale)}<rect x="${x + 16 * scale}" y="${y + 18 * scale}" width="${barWidth / 2}" height="${10 * scale}" fill="${theme.scaleStroke}" /><rect x="${x + 16 * scale + barWidth / 2}" y="${y + 18 * scale}" width="${barWidth / 2}" height="${10 * scale}" fill="#ffffff" stroke="${theme.scaleStroke}" stroke-width="${Math.max(1, scale)}" /><rect x="${x + 16 * scale}" y="${y + 18 * scale}" width="${barWidth}" height="${10 * scale}" fill="none" stroke="${theme.scaleStroke}" stroke-width="${Math.max(1, scale)}" /><text x="${x + 16 * scale}" y="${y + 48 * scale}" fill="${theme.bodyText}" font-family="Arial" font-size="${12 * scale}">${escapeXml(scaleState.label)}</text></g>`; }
function renderFooterSvg(scene, scale) { const theme = getTheme(scene); const text = scene.project.layout?.footerText; const zone = getOverlayMetrics(scene).footer; if (!text || !zone) return ''; const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale; return `<g>${svgRect(x, y, w, h, (theme.panelRadius || 10) * scale, theme.footerFill, theme.panelBorder, scale)}<text x="${x + 12 * scale}" y="${y + 25 * scale}" fill="${theme.footerText}" font-family="Arial" font-size="${12 * scale}">${escapeXml(text)}</text></g>`; }
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
  const customInset = scene.project.layout?.insetMode === 'custom_image' && scene.project.layout?.insetImage;
  if (customInset) {
    const theme = getTheme(scene); return `<g>${svgRect(x, y, w, h, (theme.panelRadius || 10) * scale, theme.insetFill, theme.insetBorder, scale)}<text x="${x + 12 * scale}" y="${y + 16 * scale}" fill="${theme.insetTitle}" font-family="Arial" font-size="${12 * scale}" font-weight="700">Project Locator</text><image href="${escapeXml(scene.project.layout.insetImage)}" x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" preserveAspectRatio="xMidYMid slice" /><text x="${x + 12 * scale}" y="${y + h - 10 * scale}" fill="${theme.insetMuted}" font-family="Arial" font-size="${11 * scale}">Uploaded Inset</text></g>`;
  }
  const visible = (scene.project.layers || []).filter((layer) => layer.visible !== false && layer.geojson); const bounds = unionBounds(visible.map((layer) => geojsonBounds(layer.geojson)).filter(Boolean)); const ref = resolveReferenceBounds(bounds, scene.project.layout?.insetMode); const marker = normalizeInset(bounds, ref);
  const markerSvg = marker ? `<rect x="${Math.max(innerX + 8 * scale, innerX + (marker.x / 100) * innerW)}" y="${Math.max(innerY + 8 * scale, innerY + (marker.y / 100) * innerH)}" width="${Math.max(8 * scale, Math.max(10 * scale, (marker.w / 100) * innerW))}" height="${Math.max(8 * scale, Math.max(10 * scale, (marker.h / 100) * innerH))}" fill="rgba(96,165,250,0.16)" stroke="#2563eb" stroke-width="${1.5 * scale}" rx="${2 * scale}" /><circle cx="${Math.min(innerX + innerW - 8 * scale, Math.max(innerX + 8 * scale, innerX + (marker.x / 100) * innerW + Math.max(10 * scale, (marker.w / 100) * innerW) / 2))}" cy="${Math.min(innerY + innerH - 8 * scale, Math.max(innerY + 8 * scale, innerY + (marker.y / 100) * innerH + Math.max(10 * scale, (marker.h / 100) * innerH) / 2))}" r="${3.2 * scale}" fill="#0f2c56" stroke="#ffffff" stroke-width="${1.2 * scale}" />` : '';
  const theme = getTheme(scene); return `<g>${svgRect(x, y, w, h, (theme.panelRadius || 10) * scale, theme.insetFill, theme.insetBorder, scale)}<text x="${x + 12 * scale}" y="${y + 16 * scale}" fill="${theme.insetTitle}" font-family="Arial" font-size="${12 * scale}" font-weight="700">Project Locator</text>${insetBackdropSvg(innerX, innerY, innerW, innerH, scale)}${markerSvg}<text x="${x + 12 * scale}" y="${y + h - 10 * scale}" fill="${theme.insetMuted}" font-family="Arial" font-size="${11 * scale}">${escapeXml(ref.label)}</text></g>`;
}
function renderLogoSvg(scene, scale) { const theme = getTheme(scene); const logo = scene.project.layout?.logo; if (!logo) return ''; const zone = getOverlayMetrics(scene).logo; if (!zone?.width || !zone?.height) return '';  const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale, padding = 10 * scale; return `<g>${svgRect(x, y, w, h, (theme.panelRadius || 10) * scale, theme.logoFill, theme.logoBorder, scale)}<image href="${escapeXml(logo)}" x="${x + padding}" y="${y + padding}" width="${w - padding * 2}" height="${h - padding * 2}" preserveAspectRatio="xMidYMid meet" /></g>`; }
function renderCalloutsSvg(scene, scale) { return placeCallouts(scene, scale).map((c) => { const line = c.type === 'leader' || c.type === 'boxed' ? `<line x1="${c.anchorPx.x}" y1="${c.anchorPx.y}" x2="${c.left + 10 * scale}" y2="${c.top + c.height / 2}" stroke="#102640" stroke-width="${1.4 * scale}" ${c.type === 'leader' ? `stroke-dasharray="${5 * scale} ${3 * scale}"` : ''} />` : ''; const box = c.type !== 'plain' ? `<rect x="${c.left}" y="${c.top}" width="${c.width}" height="${c.height}" rx="${6 * scale}" fill="rgba(255,255,255,0.97)" stroke="#17304f" />` : ''; return `<g>${line}${box}<text x="${c.left + (c.type === 'plain' ? 0 : 10 * scale)}" y="${c.top + (c.type === 'plain' ? 10 * scale : c.height / 2)}" dominant-baseline="middle" fill="#102640" font-family="Arial" font-size="${12 * scale}" font-weight="700">${escapeXml(c.text || '')}</text></g>`; }).join('\n'); }

export function renderSceneToSvg(scene, options = {}) {
  const scale = Number(options.pixelRatio || scene.project.layout?.exportSettings?.pixelRatio || 2); const width = Math.round(scene.width * scale), height = Math.round(scene.height * scale);
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f3f5f7" />${renderTileImagesSvg(scene, scale)}${renderVectorsSvg(scene, scale)}${renderCalloutsSvg(scene, scale)}${renderTitleSvg(scene, scale)}${renderLegendSvg(scene, scale)}${renderNorthArrowSvg(scene, scale)}${renderInsetSvg(scene, scale)}${renderScaleBarSvg(scene, scale)}${renderFooterSvg(scene, scale)}${renderLogoSvg(scene, scale)}</svg>`;
}
export function downloadCanvas(filename, canvas) { const link = document.createElement('a'); link.download = filename; link.href = canvas.toDataURL('image/png', 1.0); link.click(); }
export function downloadSvg(filename, svgText) { downloadBlob(filename, new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })); }
