import { escapeXml, downloadBlob } from "../utils/svg";
import { geojsonBounds, unionBounds } from "../utils/geometry";
import { placeFeatureLabels } from "../utils/labels";

function clonePoint(point, scale = 1) {
  return { x: point.x * scale, y: point.y * scale };
}
function isFinitePoint(point) { return Number.isFinite(point?.x) && Number.isFinite(point?.y); }
function toLatLng(coord) { return { lat: coord[1], lng: coord[0] }; }
function featureCollectionFeatures(geojson) {
  if (!geojson) return [];
  if (geojson.type === "FeatureCollection") return geojson.features || [];
  if (geojson.type === "Feature") return [geojson];
  return [];
}
function getLayerGeometryType(feature) { return feature?.geometry?.type || ""; }
function getTemplateStyle(template, layer) {
  const base = template?.roleStyles?.[layer?.role] || template?.roleStyles?.other || {};
  return { ...base, ...(layer?.style || {}) };
}
function projectCoordinate(map, coord, scale) { return clonePoint(map.latLngToContainerPoint(toLatLng(coord)), scale); }
function projectRing(map, ring, scale) { return ring.map((coord) => projectCoordinate(map, coord, scale)).filter(isFinitePoint); }
function projectLine(map, coords, scale) { return coords.map((coord) => projectCoordinate(map, coord, scale)).filter(isFinitePoint); }
function getTileImages(container) {
  const rootRect = container.getBoundingClientRect();
  return Array.from(container.querySelectorAll(".leaflet-tile-pane img.leaflet-tile"))
    .map((img) => {
      const rect = img.getBoundingClientRect();
      return { href: img.currentSrc || img.src, x: rect.left - rootRect.left, y: rect.top - rootRect.top, width: rect.width, height: rect.height, opacity: Number.parseFloat(getComputedStyle(img).opacity || "1") || 1 };
    })
    .filter((tile) => tile.href && tile.width > 0 && tile.height > 0);
}
function pathFromPoints(points, close = false) {
  if (!points.length) return "";
  const cmds = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let i = 1; i < points.length; i += 1) cmds.push(`L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`);
  if (close) cmds.push("Z");
  return cmds.join(" ");
}
function drawCanvasPath(ctx, points, close = false) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}
function rgba(hex, alpha = 1) {
  if (!hex) return `rgba(0,0,0,${alpha})`;
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.padEnd(6, "0").slice(0, 6);
  const int = Number.parseInt(normalized, 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}
function setCanvasStroke(ctx, style, scale) {
  ctx.strokeStyle = style.stroke || style.markerColor || "#111111";
  ctx.lineWidth = (style.strokeWidth ?? 2) * (scale >= 1 ? 1 : scale);
  ctx.setLineDash(style.dashArray ? style.dashArray.split(/[ ,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0) : []);
}
function setCanvasFill(ctx, style) { ctx.fillStyle = rgba(style.fill || style.markerFill || style.markerColor || "#111111", style.fillOpacity ?? 0.2); }
function drawCanvasGeometry(ctx, map, feature, style, scale) {
  const type = getLayerGeometryType(feature); const coords = feature?.geometry?.coordinates; if (!coords) return;
  if (type === "Polygon") { ctx.beginPath(); coords.forEach((ring) => drawCanvasPath(ctx, projectRing(map, ring, scale), true)); setCanvasFill(ctx, style); ctx.fill("evenodd"); setCanvasStroke(ctx, style, scale); ctx.stroke(); return; }
  if (type === "MultiPolygon") { ctx.beginPath(); coords.forEach((polygon) => polygon.forEach((ring) => drawCanvasPath(ctx, projectRing(map, ring, scale), true))); setCanvasFill(ctx, style); ctx.fill("evenodd"); setCanvasStroke(ctx, style, scale); ctx.stroke(); return; }
  if (type === "LineString") { ctx.beginPath(); drawCanvasPath(ctx, projectLine(map, coords, scale), false); setCanvasStroke(ctx, style, scale); ctx.stroke(); return; }
  if (type === "MultiLineString") { ctx.beginPath(); coords.forEach((line) => drawCanvasPath(ctx, projectLine(map, line, scale), false)); setCanvasStroke(ctx, style, scale); ctx.stroke(); return; }
  if (type === "Point") { const pt = projectCoordinate(map, coords, scale); const radius = (style.markerSize ?? 8) * scale * 0.5; ctx.beginPath(); ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2); ctx.fillStyle = style.markerFill || style.markerColor || "#ffffff"; ctx.fill(); ctx.lineWidth = (style.strokeWidth ?? 1.5) * scale; ctx.strokeStyle = style.markerColor || style.stroke || "#111111"; ctx.stroke(); return; }
  if (type === "MultiPoint") coords.forEach((coord) => drawCanvasGeometry(ctx, map, { geometry: { type: "Point", coordinates: coord } }, style, scale));
}
function geometryToSvg(map, feature, style, scale) {
  const type = getLayerGeometryType(feature); const coords = feature?.geometry?.coordinates; if (!coords) return "";
  const stroke = style.stroke || style.markerColor || "#111111";
  const fill = style.fill || style.markerFill || style.markerColor || "#111111";
  const fillOpacity = style.fillOpacity ?? 0.2;
  const strokeWidth = (style.strokeWidth ?? 2) * scale;
  const dash = style.dashArray ? ` stroke-dasharray="${escapeXml(style.dashArray)}"` : "";
  if (type === "Polygon") return `<path d="${coords.map((ring) => pathFromPoints(projectRing(map, ring, scale), true)).filter(Boolean).join(" ")}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} fill-rule="evenodd" />`;
  if (type === "MultiPolygon") return `<path d="${coords.flatMap((polygon) => polygon.map((ring) => pathFromPoints(projectRing(map, ring, scale), true))).filter(Boolean).join(" ")}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} fill-rule="evenodd" />`;
  if (type === "LineString") return `<path d="${pathFromPoints(projectLine(map, coords, scale), false)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} stroke-linecap="round" stroke-linejoin="round" />`;
  if (type === "MultiLineString") return `<path d="${coords.map((line) => pathFromPoints(projectLine(map, line, scale), false)).filter(Boolean).join(" ")}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} stroke-linecap="round" stroke-linejoin="round" />`;
  if (type === "Point") { const pt = projectCoordinate(map, coords, scale); const radius = (style.markerSize ?? 8) * scale * 0.5; return `<circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${style.markerFill || fill}" stroke="${style.markerColor || stroke}" stroke-width="${Math.max(scale, strokeWidth * 0.4).toFixed(2)}" />`; }
  if (type === "MultiPoint") return coords.map((coord) => geometryToSvg(map, { geometry: { type: "Point", coordinates: coord } }, style, scale)).join("");
  return "";
}
function getOverlayMetrics(scene) {
  const t = scene.template; return { title: t.zones.title, legend: t.zones.legend, northArrow: t.zones.northArrow, inset: t.zones.inset, scaleBar: t.zones.scaleBar, footer: t.zones.footer, logo: t.zones.logo };
}
function drawRoundedRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawTitleBlockCanvas(ctx, scene, scale) {
  const { title } = getOverlayMetrics(scene); const x = title.left * scale, y = title.top * scale, w = title.width * scale, h = title.height * scale;
  drawRoundedRect(ctx, x, y, w, h, 12 * scale); ctx.fillStyle = "rgba(10, 31, 66, 0.96)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 1 * scale; ctx.stroke();
  ctx.fillStyle = "#ffffff"; ctx.font = `700 ${26 * scale}px Arial`; ctx.textBaseline = "top"; ctx.fillText(scene.project.layout?.title || "Project Map", x + 18 * scale, y + 16 * scale);
  ctx.fillStyle = "rgba(255,255,255,0.86)"; ctx.font = `${14 * scale}px Arial`; ctx.fillText(scene.project.layout?.subtitle || "Technical results template", x + 18 * scale, y + 52 * scale);
}
function legendSwatchSvg(item, x, y, scale) {
  const style = item.style || {};
  if (item.type === "points") return `<circle cx="${(x + 8 * scale).toFixed(2)}" cy="${(y + 8 * scale).toFixed(2)}" r="${(5 * scale).toFixed(2)}" fill="${style.markerFill || style.markerColor || "#ffffff"}" stroke="${style.markerColor || "#111111"}" stroke-width="${Math.max(1, scale).toFixed(2)}" />`;
  return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(18 * scale).toFixed(2)}" height="${(12 * scale).toFixed(2)}" fill="${style.fill || "#72a0ff"}" fill-opacity="${style.fillOpacity ?? 0.2}" stroke="${style.stroke || "#3957aa"}" stroke-width="${Math.max(1, scale).toFixed(2)}" rx="2" />`;
}
function drawLegendCanvas(ctx, scene, scale) {
  const { legend } = getOverlayMetrics(scene); const items = scene.project.layout?.legendItems || []; if (!items.length) return;
  const x = legend.left * scale, y = legend.top * scale, w = legend.width * scale, h = legend.height * scale;
  drawRoundedRect(ctx, x, y, w, h, 10 * scale); ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fill(); ctx.strokeStyle = "rgba(18,30,48,0.18)"; ctx.lineWidth = 1 * scale; ctx.stroke();
  ctx.fillStyle = "#132033"; ctx.font = `700 ${15 * scale}px Arial`; ctx.textBaseline = "top"; ctx.fillText("Legend", x + 16 * scale, y + 14 * scale);
  ctx.font = `${13 * scale}px Arial`; let rowY = y + 42 * scale;
  items.forEach((item) => { const style = item.style || {}; if (item.type === "points") { ctx.beginPath(); ctx.arc(x + 24 * scale, rowY + 8 * scale, 5 * scale, 0, Math.PI * 2); ctx.fillStyle = style.markerFill || style.markerColor || "#ffffff"; ctx.fill(); ctx.lineWidth = Math.max(1, scale); ctx.strokeStyle = style.markerColor || "#111111"; ctx.stroke(); } else { ctx.fillStyle = rgba(style.fill || "#72a0ff", style.fillOpacity ?? 0.2); ctx.fillRect(x + 16 * scale, rowY + 2 * scale, 18 * scale, 12 * scale); ctx.strokeStyle = style.stroke || "#3957aa"; ctx.lineWidth = Math.max(1, scale); ctx.strokeRect(x + 16 * scale, rowY + 2 * scale, 18 * scale, 12 * scale);} ctx.fillStyle = "#1d2b3d"; ctx.fillText(item.label || "Layer", x + 46 * scale, rowY); rowY += 24 * scale; });
}
function drawNorthArrowCanvas(ctx, scene, scale) {
  const { northArrow } = getOverlayMetrics(scene); const x = northArrow.left * scale, y = northArrow.top * scale, w = northArrow.width * scale, h = northArrow.height * scale;
  drawRoundedRect(ctx, x, y, w, h, 10 * scale); ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.fill(); ctx.strokeStyle = "rgba(18,30,48,0.18)"; ctx.lineWidth = 1 * scale; ctx.stroke();
  ctx.fillStyle = "#122033"; ctx.font = `700 ${14 * scale}px Arial`; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("N", x + w / 2, y + 10 * scale);
  ctx.beginPath(); ctx.moveTo(x + w / 2, y + 24 * scale); ctx.lineTo(x + w / 2 - 12 * scale, y + 58 * scale); ctx.lineTo(x + w / 2 - 3 * scale, y + 58 * scale); ctx.lineTo(x + w / 2 - 3 * scale, y + 84 * scale); ctx.lineTo(x + w / 2 + 3 * scale, y + 84 * scale); ctx.lineTo(x + w / 2 + 3 * scale, y + 58 * scale); ctx.lineTo(x + w / 2 + 12 * scale, y + 58 * scale); ctx.closePath(); ctx.fill(); ctx.textAlign = "left";
}
function pickScaleLabel(map) {
  const size = map.getSize(); const y = size.y - 40; const meters = map.containerPointToLatLng([20, y]).distanceTo(map.containerPointToLatLng([150, y]));
  const candidates = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
  const nice = candidates.reduce((best, n) => (Math.abs(n - meters) < Math.abs(best - meters) ? n : best), candidates[0]);
  return { label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, widthPx: Math.max(60, Math.min(180, Math.round((130 * nice) / meters))) };
}
function drawScaleBarCanvas(ctx, scene, scale) {
  const { scaleBar } = getOverlayMetrics(scene); const x = scaleBar.left * scale, y = scaleBar.top * scale, w = scaleBar.width * scale, h = scaleBar.height * scale; const scaleState = pickScaleLabel(scene.map); const barWidth = scaleState.widthPx * scale;
  drawRoundedRect(ctx, x, y, w, h, 10 * scale); ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.fill(); ctx.strokeStyle = "rgba(18,30,48,0.18)"; ctx.lineWidth = 1 * scale; ctx.stroke();
  ctx.fillStyle = "#122033"; ctx.fillRect(x + 16 * scale, y + 18 * scale, barWidth / 2, 10 * scale); ctx.fillStyle = "#ffffff"; ctx.fillRect(x + 16 * scale + barWidth / 2, y + 18 * scale, barWidth / 2, 10 * scale); ctx.strokeStyle = "#122033"; ctx.strokeRect(x + 16 * scale, y + 18 * scale, barWidth, 10 * scale);
  ctx.fillStyle = "#1d2b3d"; ctx.font = `${12 * scale}px Arial`; ctx.textBaseline = "top"; ctx.fillText(scaleState.label, x + 16 * scale, y + 36 * scale);
}
async function loadImage(src) { return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => resolve(img); img.onerror = () => reject(new Error(`Failed to load image: ${src}`)); img.src = src; }); }
async function drawTilesCanvas(ctx, scene, scale) { for (const tile of getTileImages(scene.container)) { const img = await loadImage(tile.href); ctx.globalAlpha = tile.opacity; ctx.drawImage(img, tile.x * scale, tile.y * scale, tile.width * scale, tile.height * scale); } ctx.globalAlpha = 1; }
function drawVectorsCanvas(ctx, scene, scale) { (scene.project.layers || []).forEach((layer) => { if (layer.visible === false || !layer.geojson) return; const style = getTemplateStyle(scene.template, layer); featureCollectionFeatures(layer.geojson).forEach((feature) => drawCanvasGeometry(ctx, scene.map, feature, style, scale)); }); }
async function drawLogoCanvas(ctx, scene, scale) {
  const logo = scene.project.layout?.logo; if (!logo) return; const zone = getOverlayMetrics(scene).logo; const img = await loadImage(logo); const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale;
  drawRoundedRect(ctx, x, y, w, h, 10 * scale); ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.fill(); ctx.strokeStyle = "rgba(18,30,48,0.18)"; ctx.lineWidth = 1 * scale; ctx.stroke();
  const padding = 10 * scale, innerW = w - padding * 2, innerH = h - padding * 2, ratio = Math.min(innerW / img.width, innerH / img.height); const drawW = img.width * ratio, drawH = img.height * ratio;
  ctx.drawImage(img, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
}
function resolveReferenceBounds(bounds, insetMode) {
  if (!bounds) return { minLng: -180, minLat: -90, maxLng: 180, maxLat: 90, label: "Locator" };
  if (insetMode === "country") return { minLng: -180, minLat: -90, maxLng: 180, maxLat: 90, label: "Country" };
  const cx = (bounds.minLng + bounds.maxLng) / 2, cy = (bounds.minLat + bounds.maxLat) / 2; const width = Math.max(0.4, bounds.maxLng - bounds.minLng), height = Math.max(0.4, bounds.maxLat - bounds.minLat); const m = insetMode === "secondary_zoom" ? 2.2 : insetMode === "regional_district" ? 5.5 : 10;
  return { minLng: cx - width * m, maxLng: cx + width * m, minLat: cy - height * m, maxLat: cy + height * m, label: insetMode === "secondary_zoom" ? "Secondary Zoom" : insetMode === "regional_district" ? "Regional District" : "Province / State" };
}
function normalizeInset(bounds, ref) {
  if (!bounds || !ref) return null; const width = Math.max(1e-6, ref.maxLng - ref.minLng), height = Math.max(1e-6, ref.maxLat - ref.minLat);
  return { x: ((bounds.minLng - ref.minLng) / width) * 100, y: (1 - (bounds.maxLat - ref.minLat) / height) * 100, w: ((bounds.maxLng - bounds.minLng) / width) * 100, h: ((bounds.maxLat - bounds.minLat) / height) * 100 };
}
function drawInsetCanvas(ctx, scene, scale) {
  const zone = getOverlayMetrics(scene).inset; if (!zone) return; const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale;
  drawRoundedRect(ctx, x, y, w, h, 10 * scale); ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.fill(); ctx.strokeStyle = "rgba(18,30,48,0.18)"; ctx.lineWidth = 1 * scale; ctx.stroke();
  ctx.fillStyle = "#132033"; ctx.font = `700 ${12 * scale}px Arial`; ctx.fillText("Locator", x + 12 * scale, y + 16 * scale);
  const innerX = x + 10 * scale, innerY = y + 28 * scale, innerW = w - 20 * scale, innerH = h - 48 * scale;
  ctx.fillStyle = "#eef2f7"; ctx.fillRect(innerX, innerY, innerW, innerH); ctx.strokeStyle = "#c6d0dd"; ctx.strokeRect(innerX, innerY, innerW, innerH);
  ctx.strokeStyle = "#d7dfe9"; ctx.lineWidth = Math.max(0.5, scale * 0.6); [0.2,0.4,0.6,0.8].forEach((p)=>{ctx.beginPath(); ctx.moveTo(innerX + innerW*p, innerY); ctx.lineTo(innerX + innerW*p, innerY + innerH); ctx.stroke(); ctx.beginPath(); ctx.moveTo(innerX, innerY + innerH*p); ctx.lineTo(innerX + innerW, innerY + innerH*p); ctx.stroke();});
  const visible = (scene.project.layers || []).filter((layer)=>layer.visible!==false && layer.geojson); const bounds = unionBounds(visible.map((layer)=>geojsonBounds(layer.geojson))); const ref = resolveReferenceBounds(bounds, scene.project.layout?.insetMode); const marker = normalizeInset(bounds, ref);
  if (marker) { const mx = innerX + (marker.x/100)*innerW, my = innerY + (marker.y/100)*innerH, mw = Math.max(8*scale, (marker.w/100)*innerW), mh = Math.max(8*scale, (marker.h/100)*innerH); ctx.fillStyle = "rgba(96,165,250,0.2)"; ctx.fillRect(mx, my, mw, mh); ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.4*scale; ctx.strokeRect(mx,my,mw,mh); ctx.beginPath(); ctx.arc(mx + mw/2, my + mh/2, 2.7*scale, 0, Math.PI*2); ctx.fillStyle = "#0f172a"; ctx.fill(); }
  ctx.fillStyle = "#526172"; ctx.font = `${11 * scale}px Arial`; ctx.fillText(ref.label, x + 12*scale, y + h - 10*scale);
}
function drawFooterCanvas(ctx, scene, scale) {
  const text = scene.project.layout?.footerText; const zone = getOverlayMetrics(scene).footer; if (!text || !zone) return; const x = zone.left * scale, y = zone.top * scale, w = zone.width * scale, h = zone.height * scale;
  drawRoundedRect(ctx, x, y, w, h, 10 * scale); ctx.fillStyle = "rgba(255,255,255,0.93)"; ctx.fill(); ctx.strokeStyle = "rgba(18,30,48,0.18)"; ctx.lineWidth = 1 * scale; ctx.stroke();
  ctx.fillStyle = "#334155"; ctx.font = `${12 * scale}px Arial`; ctx.textBaseline = "middle"; ctx.fillText(text, x + 12*scale, y + h/2);
}
function drawFeatureLabelCanvas(ctx, label, scale) {
  if (label.type === "boxed") {
    ctx.beginPath();
    ctx.moveTo(label.anchorPx.x, label.anchorPx.y);
    ctx.lineTo(label.left + 10 * scale, label.top + label.height / 2);
    ctx.strokeStyle = "#122033";
    ctx.lineWidth = 1.2 * scale;
    ctx.stroke();
    drawRoundedRect(ctx, label.left, label.top, label.width, label.height, 7 * scale);
    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.fill();
    ctx.strokeStyle = "rgba(18,32,51,0.24)";
    ctx.lineWidth = 1 * scale;
    ctx.stroke();
    ctx.fillStyle = "#122033";
    ctx.font = `700 ${11 * scale}px Arial`;
    ctx.textBaseline = "middle";
    ctx.fillText(label.text || "", label.left + 10 * scale, label.top + label.height / 2);
    return;
  }

  if (label.type === "tag") {
    drawRoundedRect(ctx, label.left, label.top, label.width, label.height, 999 * scale);
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.fill();
    ctx.strokeStyle = "rgba(18,32,51,0.55)";
    ctx.lineWidth = 1 * scale;
    ctx.stroke();
    ctx.fillStyle = "#122033";
    ctx.font = `700 ${10.5 * scale}px Arial`;
    ctx.textBaseline = "middle";
    ctx.fillText(label.text || "", label.left + 10 * scale, label.top + label.height / 2);
    return;
  }

  ctx.strokeStyle = "rgba(255,255,255,0.96)";
  ctx.lineWidth = 3.2 * scale;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeText(label.text || "", label.left, label.top + label.height - 2 * scale);
  ctx.fillStyle = "#0f172a";
  ctx.font = `700 ${12 * scale}px Arial`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(label.text || "", label.left, label.top + label.height - 2 * scale);
}

function drawFeatureLabelsCanvas(ctx, scene, scale) {
  const labels = placeFeatureLabels(scene.project.labels || [], scene.map);
  labels.forEach((label) => {
    drawFeatureLabelCanvas(ctx, {
      ...label,
      left: label.left * scale,
      top: label.top * scale,
      width: label.width * scale,
      height: label.height * scale,
      anchorPx: { x: label.anchorPx.x * scale, y: label.anchorPx.y * scale },
    }, scale);
  });
}

function renderFeatureLabelsSvg(scene, scale) {
  return placeFeatureLabels(scene.project.labels || [], scene.map).map((label) => {
    const left = label.left * scale;
    const top = label.top * scale;
    const width = label.width * scale;
    const height = label.height * scale;
    const anchorX = label.anchorPx.x * scale;
    const anchorY = label.anchorPx.y * scale;
    if (label.type === "boxed") {
      return `<g><line x1="${anchorX}" y1="${anchorY}" x2="${left + 10 * scale}" y2="${top + height / 2}" stroke="#122033" stroke-width="${1.2 * scale}" /><rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${7 * scale}" fill="rgba(255,255,255,0.98)" stroke="rgba(18,32,51,0.24)" /><text x="${left + 10 * scale}" y="${top + height / 2 + 4 * scale}" fill="#122033" font-family="Arial" font-size="${11 * scale}" font-weight="700">${escapeXml(label.text || "")}</text></g>`;
    }
    if (label.type === "tag") {
      return `<g><rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${12 * scale}" fill="rgba(255,255,255,0.96)" stroke="rgba(18,32,51,0.55)" /><text x="${left + 10 * scale}" y="${top + height / 2 + 4 * scale}" fill="#122033" font-family="Arial" font-size="${10.5 * scale}" font-weight="700">${escapeXml(label.text || "")}</text></g>`;
    }
    return `<g><text x="${left}" y="${top + height - 2 * scale}" fill="none" stroke="rgba(255,255,255,0.96)" stroke-width="${3.2 * scale}" stroke-linejoin="round" font-family="Arial" font-size="${12 * scale}" font-weight="700">${escapeXml(label.text || "")}</text><text x="${left}" y="${top + height - 2 * scale}" fill="#0f172a" font-family="Arial" font-size="${12 * scale}" font-weight="700">${escapeXml(label.text || "")}</text></g>`;
  }).join("\n");
}

function placeCallouts(scene, scale) {
  const callouts = (scene.project.callouts || []).slice().sort((a,b)=>(a.priority||2)-(b.priority||2)); const placed=[];
  callouts.forEach((callout)=>{ if(!callout.anchor) return; const pt = scene.map.latLngToContainerPoint([callout.anchor.lat, callout.anchor.lng]); let left = pt.x + (callout.offset?.x||0); let top = pt.y + (callout.offset?.y||0); const width = callout.type === "boxed" ? 180 : 132; const height = callout.type === "boxed" ? 54 : 28; placed.forEach((other)=>{ const ox = left < other.left+other.width+8 && left+width+8>other.left; const oy = top < other.top+other.height+8 && top+height+8>other.top; if (ox && oy) top = other.top + other.height + 10;}); placed.push({...callout, left:left*scale, top:top*scale, width:width*scale, height:height*scale, anchorPx:{x:pt.x*scale,y:pt.y*scale}}); });
  return placed;
}
function drawCalloutsCanvas(ctx, scene, scale) {
  placeCallouts(scene, scale).forEach((c)=>{ if (c.type === "leader" || c.type === "boxed") { ctx.beginPath(); ctx.moveTo(c.anchorPx.x, c.anchorPx.y); ctx.lineTo(c.left + 10*scale, c.top + c.height/2); ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 1.5*scale; ctx.setLineDash(c.type === "leader" ? [4*scale,3*scale] : []); ctx.stroke(); }
    ctx.setLineDash([]); if (c.type !== "plain") { drawRoundedRect(ctx,c.left,c.top,c.width,c.height,8*scale); ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fill(); ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 1*scale; ctx.stroke(); }
    ctx.fillStyle = "#0f172a"; ctx.font = `700 ${12*scale}px Arial`; ctx.textBaseline = "top"; ctx.fillText(c.text || "", c.left + (c.type === "plain" ? 0 : 8*scale), c.top + (c.type === "plain" ? 0 : 7*scale)); });
}
export async function renderSceneToCanvas(scene, options = {}) {
  const scale = Number(options.pixelRatio || scene.project.layout?.exportSettings?.pixelRatio || 2); const canvas = document.createElement("canvas"); canvas.width = Math.round(scene.width * scale); canvas.height = Math.round(scene.height * scale); const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f3f5f7"; ctx.fillRect(0,0,canvas.width,canvas.height);
  await drawTilesCanvas(ctx, scene, scale); drawVectorsCanvas(ctx, scene, scale); drawFeatureLabelsCanvas(ctx, scene, scale); drawCalloutsCanvas(ctx, scene, scale); drawTitleBlockCanvas(ctx, scene, scale); drawLegendCanvas(ctx, scene, scale); drawNorthArrowCanvas(ctx, scene, scale); drawInsetCanvas(ctx, scene, scale); drawScaleBarCanvas(ctx, scene, scale); drawFooterCanvas(ctx, scene, scale); await drawLogoCanvas(ctx, scene, scale);
  return canvas;
}
function renderTileImagesSvg(scene, scale) { return getTileImages(scene.container).map((tile)=>`<image href="${escapeXml(tile.href)}" x="${(tile.x * scale).toFixed(2)}" y="${(tile.y * scale).toFixed(2)}" width="${(tile.width * scale).toFixed(2)}" height="${(tile.height * scale).toFixed(2)}" opacity="${tile.opacity}" preserveAspectRatio="none" />`).join("\n"); }
function renderVectorsSvg(scene, scale) { return (scene.project.layers || []).filter((layer)=>layer.visible!==false && layer.geojson).map((layer)=>featureCollectionFeatures(layer.geojson).map((feature)=>geometryToSvg(scene.map, feature, getTemplateStyle(scene.template, layer), scale)).join("\n")).join("\n"); }
function renderTitleSvg(scene, scale) { const { title } = getOverlayMetrics(scene); const x = title.left*scale, y = title.top*scale, w = title.width*scale, h = title.height*scale; return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${12*scale}" fill="rgba(10,31,66,0.96)" stroke="rgba(255,255,255,0.15)" /><text x="${x + 18*scale}" y="${y + 42*scale}" fill="#ffffff" font-family="Arial" font-size="${26*scale}" font-weight="700">${escapeXml(scene.project.layout?.title || "Project Map")}</text><text x="${x + 18*scale}" y="${y + 66*scale}" fill="rgba(255,255,255,0.86)" font-family="Arial" font-size="${14*scale}">${escapeXml(scene.project.layout?.subtitle || "Technical results template")}</text></g>`; }
function renderLegendSvg(scene, scale) { const { legend } = getOverlayMetrics(scene); const items = scene.project.layout?.legendItems || []; if (!items.length) return ""; const x = legend.left*scale, y=legend.top*scale, w=legend.width*scale, h=legend.height*scale; const rows = items.map((item,index)=>{ const rowY = y + (42 + index*24) * scale; return `${legendSwatchSvg(item, x + 16*scale, rowY + 2*scale, scale)}<text x="${x + 46*scale}" y="${rowY + 12*scale}" fill="#1d2b3d" font-family="Arial" font-size="${13*scale}">${escapeXml(item.label || "Layer")}</text>`;}).join("\n"); return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10*scale}" fill="rgba(255,255,255,0.96)" stroke="rgba(18,30,48,0.18)" /><text x="${x + 16*scale}" y="${y + 28*scale}" fill="#132033" font-family="Arial" font-size="${15*scale}" font-weight="700">Legend</text>${rows}</g>`; }
function renderNorthArrowSvg(scene, scale) { const { northArrow } = getOverlayMetrics(scene); const x=northArrow.left*scale,y=northArrow.top*scale,w=northArrow.width*scale,h=northArrow.height*scale,cx=x+w/2; return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10*scale}" fill="rgba(255,255,255,0.95)" stroke="rgba(18,30,48,0.18)" /><text x="${cx}" y="${y + 24*scale}" text-anchor="middle" fill="#122033" font-family="Arial" font-size="${14*scale}" font-weight="700">N</text><path d="M ${cx} ${y + 24*scale} L ${cx - 12*scale} ${y + 58*scale} L ${cx - 3*scale} ${y + 58*scale} L ${cx - 3*scale} ${y + 84*scale} L ${cx + 3*scale} ${y + 84*scale} L ${cx + 3*scale} ${y + 58*scale} L ${cx + 12*scale} ${y + 58*scale} Z" fill="#122033" /></g>`; }
function renderScaleBarSvg(scene, scale) { const { scaleBar } = getOverlayMetrics(scene); const x=scaleBar.left*scale,y=scaleBar.top*scale,w=scaleBar.width*scale,h=scaleBar.height*scale, scaleState=pickScaleLabel(scene.map), barWidth=scaleState.widthPx*scale; return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10*scale}" fill="rgba(255,255,255,0.95)" stroke="rgba(18,30,48,0.18)" /><rect x="${x + 16*scale}" y="${y + 18*scale}" width="${barWidth/2}" height="${10*scale}" fill="#122033" /><rect x="${x + 16*scale + barWidth/2}" y="${y + 18*scale}" width="${barWidth/2}" height="${10*scale}" fill="#ffffff" stroke="#122033" stroke-width="${Math.max(1,scale)}" /><rect x="${x + 16*scale}" y="${y + 18*scale}" width="${barWidth}" height="${10*scale}" fill="none" stroke="#122033" stroke-width="${Math.max(1,scale)}" /><text x="${x + 16*scale}" y="${y + 48*scale}" fill="#1d2b3d" font-family="Arial" font-size="${12*scale}">${escapeXml(scaleState.label)}</text></g>`; }
function renderFooterSvg(scene, scale) { const text = scene.project.layout?.footerText; const zone = getOverlayMetrics(scene).footer; if (!text || !zone) return ""; const x=zone.left*scale,y=zone.top*scale,w=zone.width*scale,h=zone.height*scale; return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10*scale}" fill="rgba(255,255,255,0.93)" stroke="rgba(18,30,48,0.18)" /><text x="${x + 12*scale}" y="${y + 25*scale}" fill="#334155" font-family="Arial" font-size="${12*scale}">${escapeXml(text)}</text></g>`; }
function renderInsetSvg(scene, scale) {
  const zone = getOverlayMetrics(scene).inset; if (!zone) return ""; const x=zone.left*scale,y=zone.top*scale,w=zone.width*scale,h=zone.height*scale, innerX=x+10*scale, innerY=y+28*scale, innerW=w-20*scale, innerH=h-48*scale;
  const visible = (scene.project.layers || []).filter((layer)=>layer.visible!==false && layer.geojson); const bounds = unionBounds(visible.map((layer)=>geojsonBounds(layer.geojson))); const ref = resolveReferenceBounds(bounds, scene.project.layout?.insetMode); const marker = normalizeInset(bounds, ref);
  const grid = [20,40,60,80].map((n)=>`<g><line x1="${innerX + (n/100)*innerW}" y1="${innerY}" x2="${innerX + (n/100)*innerW}" y2="${innerY + innerH}" stroke="#d7dfe9" stroke-width="${Math.max(0.5,scale*0.6)}" /><line x1="${innerX}" y1="${innerY + (n/100)*innerH}" x2="${innerX + innerW}" y2="${innerY + (n/100)*innerH}" stroke="#d7dfe9" stroke-width="${Math.max(0.5,scale*0.6)}" /></g>`).join("");
  const markerSvg = marker ? `<rect x="${innerX + (marker.x/100)*innerW}" y="${innerY + (marker.y/100)*innerH}" width="${Math.max(8*scale,(marker.w/100)*innerW)}" height="${Math.max(8*scale,(marker.h/100)*innerH)}" fill="rgba(96,165,250,0.20)" stroke="#2563eb" stroke-width="${1.4*scale}" /><circle cx="${innerX + (marker.x/100)*innerW + Math.max(8*scale,(marker.w/100)*innerW)/2}" cy="${innerY + (marker.y/100)*innerH + Math.max(8*scale,(marker.h/100)*innerH)/2}" r="${2.7*scale}" fill="#0f172a" />` : "";
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10*scale}" fill="rgba(255,255,255,0.95)" stroke="rgba(18,30,48,0.18)" /><text x="${x + 12*scale}" y="${y + 16*scale}" fill="#132033" font-family="Arial" font-size="${12*scale}" font-weight="700">Locator</text><rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" fill="#eef2f7" stroke="#c6d0dd" />${grid}${markerSvg}<text x="${x + 12*scale}" y="${y + h - 10*scale}" fill="#526172" font-family="Arial" font-size="${11*scale}">${escapeXml(ref.label)}</text></g>`;
}
function renderLogoSvg(scene, scale) { const logo=scene.project.layout?.logo; if(!logo) return ""; const zone=getOverlayMetrics(scene).logo; const x=zone.left*scale,y=zone.top*scale,w=zone.width*scale,h=zone.height*scale,padding=10*scale; return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10*scale}" fill="rgba(255,255,255,0.95)" stroke="rgba(18,30,48,0.18)" /><image href="${escapeXml(logo)}" x="${x + padding}" y="${y + padding}" width="${w - padding*2}" height="${h - padding*2}" preserveAspectRatio="xMidYMid meet" /></g>`; }
function renderCalloutsSvg(scene, scale) { return placeCallouts(scene, scale).map((c)=>{ const line = c.type === "leader" || c.type === "boxed" ? `<line x1="${c.anchorPx.x}" y1="${c.anchorPx.y}" x2="${c.left + 10*scale}" y2="${c.top + c.height/2}" stroke="#0f172a" stroke-width="${1.5*scale}" ${c.type === "leader" ? `stroke-dasharray="${4*scale} ${3*scale}"` : ""} />` : ""; const box = c.type !== "plain" ? `<rect x="${c.left}" y="${c.top}" width="${c.width}" height="${c.height}" rx="${8*scale}" fill="rgba(255,255,255,0.96)" stroke="#0f172a" />` : ""; return `<g>${line}${box}<text x="${c.left + (c.type === "plain" ? 0 : 8*scale)}" y="${c.top + (c.type === "plain" ? 12*scale : 18*scale)}" fill="#0f172a" font-family="Arial" font-size="${12*scale}" font-weight="700">${escapeXml(c.text || "")}</text></g>`; }).join("\n"); }
export function renderSceneToSvg(scene, options = {}) {
  const scale = Number(options.pixelRatio || scene.project.layout?.exportSettings?.pixelRatio || 2); const width=Math.round(scene.width*scale), height=Math.round(scene.height*scale);
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f3f5f7" />${renderTileImagesSvg(scene, scale)}${renderVectorsSvg(scene, scale)}${renderFeatureLabelsSvg(scene, scale)}${renderCalloutsSvg(scene, scale)}${renderTitleSvg(scene, scale)}${renderLegendSvg(scene, scale)}${renderNorthArrowSvg(scene, scale)}${renderInsetSvg(scene, scale)}${renderScaleBarSvg(scene, scale)}${renderFooterSvg(scene, scale)}${renderLogoSvg(scene, scale)}</svg>`;
}
export function downloadCanvas(filename, canvas) { const link=document.createElement("a"); link.download=filename; link.href=canvas.toDataURL("image/png",1.0); link.click(); }
export function downloadSvg(filename, svgText) { downloadBlob(filename, new Blob([svgText], { type: "image/svg+xml;charset=utf-8" })); }
