import { escapeXml, downloadBlob } from "../utils/svg";

function clonePoint(point, scale = 1) {
  return {
    x: point.x * scale,
    y: point.y * scale,
  };
}

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function toLatLng(coord) {
  return { lat: coord[1], lng: coord[0] };
}

function featureCollectionFeatures(geojson) {
  if (!geojson) return [];
  if (geojson.type === "FeatureCollection") return geojson.features || [];
  if (geojson.type === "Feature") return [geojson];
  return [];
}

function getLayerGeometryType(feature) {
  return feature?.geometry?.type || "";
}

function getTemplateStyle(template, layer) {
  const base = template?.roleStyles?.[layer?.role] || template?.roleStyles?.other || {};
  return { ...base, ...(layer?.style || {}) };
}

function projectCoordinate(map, coord, scale) {
  const pt = map.latLngToContainerPoint(toLatLng(coord));
  return clonePoint(pt, scale);
}

function projectRing(map, ring, scale) {
  return ring
    .map((coord) => projectCoordinate(map, coord, scale))
    .filter(isFinitePoint);
}

function projectLine(map, coords, scale) {
  return coords
    .map((coord) => projectCoordinate(map, coord, scale))
    .filter(isFinitePoint);
}

function getTileImages(container) {
  const rootRect = container.getBoundingClientRect();
  return Array.from(container.querySelectorAll(".leaflet-tile-pane img.leaflet-tile"))
    .map((img) => {
      const rect = img.getBoundingClientRect();
      return {
        href: img.currentSrc || img.src,
        x: rect.left - rootRect.left,
        y: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
        opacity: Number.parseFloat(getComputedStyle(img).opacity || "1") || 1,
      };
    })
    .filter((tile) => tile.href && tile.width > 0 && tile.height > 0);
}

function pathFromPoints(points, close = false) {
  if (!points.length) return "";
  const first = points[0];
  const cmds = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`];
  for (let i = 1; i < points.length; i += 1) {
    cmds.push(`L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`);
  }
  if (close) cmds.push("Z");
  return cmds.join(" ");
}

function drawCanvasPath(ctx, points, close = false) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  if (close) ctx.closePath();
}

function rgba(hex, alpha = 1) {
  if (!hex) return `rgba(0,0,0,${alpha})`;
  const value = hex.replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((c) => c + c).join("")
    : value.padEnd(6, "0").slice(0, 6);
  const int = Number.parseInt(normalized, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function setCanvasStroke(ctx, style) {
  ctx.strokeStyle = style.stroke || style.markerColor || "#111111";
  ctx.lineWidth = style.strokeWidth ?? 2;
  ctx.setLineDash(
    style.dashArray
      ? style.dashArray
          .split(/[ ,]+/)
          .map((part) => Number(part))
          .filter((n) => Number.isFinite(n) && n > 0)
      : []
  );
}

function setCanvasFill(ctx, style) {
  ctx.fillStyle = rgba(style.fill || style.markerFill || style.markerColor || "#111111", style.fillOpacity ?? 0.2);
}

function drawCanvasGeometry(ctx, map, feature, style, scale) {
  const type = getLayerGeometryType(feature);
  const coords = feature?.geometry?.coordinates;
  if (!coords) return;

  if (type === "Polygon") {
    ctx.beginPath();
    coords.forEach((ring) => drawCanvasPath(ctx, projectRing(map, ring, scale), true));
    setCanvasFill(ctx, style);
    ctx.fill("evenodd");
    setCanvasStroke(ctx, style);
    ctx.stroke();
    return;
  }

  if (type === "MultiPolygon") {
    ctx.beginPath();
    coords.forEach((polygon) => polygon.forEach((ring) => drawCanvasPath(ctx, projectRing(map, ring, scale), true)));
    setCanvasFill(ctx, style);
    ctx.fill("evenodd");
    setCanvasStroke(ctx, style);
    ctx.stroke();
    return;
  }

  if (type === "LineString") {
    ctx.beginPath();
    drawCanvasPath(ctx, projectLine(map, coords, scale), false);
    setCanvasStroke(ctx, style);
    ctx.stroke();
    return;
  }

  if (type === "MultiLineString") {
    ctx.beginPath();
    coords.forEach((line) => drawCanvasPath(ctx, projectLine(map, line, scale), false));
    setCanvasStroke(ctx, style);
    ctx.stroke();
    return;
  }

  if (type === "Point") {
    const pt = projectCoordinate(map, coords, scale);
    const radius = (style.markerSize ?? 8) * scale * 0.5;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = style.markerFill || style.markerColor || "#111111";
    ctx.fill();
    ctx.lineWidth = (style.strokeWidth ?? 1.5) * scale;
    ctx.strokeStyle = style.markerColor || "#111111";
    ctx.stroke();
    return;
  }

  if (type === "MultiPoint") {
    coords.forEach((coord) => drawCanvasGeometry(ctx, map, { geometry: { type: "Point", coordinates: coord } }, style, scale));
  }
}

function geometryToSvg(map, feature, style, scale) {
  const type = getLayerGeometryType(feature);
  const coords = feature?.geometry?.coordinates;
  if (!coords) return "";

  const stroke = style.stroke || style.markerColor || "#111111";
  const fill = style.fill || style.markerFill || style.markerColor || "#111111";
  const fillOpacity = style.fillOpacity ?? 0.2;
  const strokeWidth = (style.strokeWidth ?? 2) * scale;
  const dash = style.dashArray ? ` stroke-dasharray="${escapeXml(style.dashArray)}"` : "";

  if (type === "Polygon") {
    const d = coords.map((ring) => pathFromPoints(projectRing(map, ring, scale), true)).filter(Boolean).join(" ");
    return `<path d="${d}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} fill-rule="evenodd" />`;
  }

  if (type === "MultiPolygon") {
    const d = coords
      .flatMap((polygon) => polygon.map((ring) => pathFromPoints(projectRing(map, ring, scale), true)))
      .filter(Boolean)
      .join(" ");
    return `<path d="${d}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} fill-rule="evenodd" />`;
  }

  if (type === "LineString") {
    const d = pathFromPoints(projectLine(map, coords, scale), false);
    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} stroke-linecap="round" stroke-linejoin="round" />`;
  }

  if (type === "MultiLineString") {
    const d = coords.map((line) => pathFromPoints(projectLine(map, line, scale), false)).filter(Boolean).join(" ");
    return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} stroke-linecap="round" stroke-linejoin="round" />`;
  }

  if (type === "Point") {
    const pt = projectCoordinate(map, coords, scale);
    const radius = (style.markerSize ?? 8) * scale * 0.5;
    return `<circle cx="${pt.x.toFixed(2)}" cy="${pt.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${fill}" stroke="${stroke}" stroke-width="${Math.max(scale, strokeWidth * 0.4).toFixed(2)}" />`;
  }

  if (type === "MultiPoint") {
    return coords
      .map((coord) => geometryToSvg(map, { geometry: { type: "Point", coordinates: coord } }, style, scale))
      .join("");
  }

  return "";
}

function getOverlayMetrics(scene) {
  const template = scene.template;
  const width = scene.width;
  const height = scene.height;
  const margin = template.frame?.margin ?? 20;
  return {
    width,
    height,
    margin,
    title: template.zones.title,
    legend: template.zones.legend,
    northArrow: template.zones.northArrow,
    scaleBar: template.zones.scaleBar,
    logo: template.zones.logo,
  };
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTitleBlockCanvas(ctx, scene, scale) {
  const { title } = getOverlayMetrics(scene);
  const x = title.left * scale;
  const y = title.top * scale;
  const w = title.width * scale;
  const h = title.height * scale;
  drawRoundedRect(ctx, x, y, w, h, 12 * scale);
  ctx.fillStyle = "rgba(10, 31, 66, 0.96)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1 * scale;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = `${700 * scale >= 700 ? '700' : '700'} ${26 * scale}px Arial`;
  ctx.textBaseline = "top";
  ctx.fillText(scene.project.layout?.title || "Project Map", x + 18 * scale, y + 16 * scale);

  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.font = `${14 * scale}px Arial`;
  ctx.fillText(scene.project.layout?.subtitle || "Technical results template", x + 18 * scale, y + 52 * scale);
}

function legendSwatchSvg(item, x, y, scale) {
  const style = item.style || {};
  if (item.type === "points") {
    return `<circle cx="${(x + 8 * scale).toFixed(2)}" cy="${(y + 8 * scale).toFixed(2)}" r="${(5 * scale).toFixed(2)}" fill="${style.markerFill || style.markerColor || "#111111"}" stroke="${style.markerColor || "#111111"}" stroke-width="${Math.max(1, scale).toFixed(2)}" />`;
  }
  return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(18 * scale).toFixed(2)}" height="${(12 * scale).toFixed(2)}" fill="${style.fill || "#72a0ff"}" fill-opacity="${style.fillOpacity ?? 0.2}" stroke="${style.stroke || "#3957aa"}" stroke-width="${Math.max(1, scale).toFixed(2)}" rx="2" />`;
}

function drawLegendCanvas(ctx, scene, scale) {
  const { legend } = getOverlayMetrics(scene);
  const items = scene.project.layout?.legendItems || [];
  if (!items.length) return;

  const x = legend.left * scale;
  const y = legend.top * scale;
  const w = legend.width * scale;
  const h = legend.height * scale;

  drawRoundedRect(ctx, x, y, w, h, 10 * scale);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fill();
  ctx.strokeStyle = "rgba(18,30,48,0.18)";
  ctx.lineWidth = 1 * scale;
  ctx.stroke();

  ctx.fillStyle = "#132033";
  ctx.font = `700 ${15 * scale}px Arial`;
  ctx.textBaseline = "top";
  ctx.fillText("Legend", x + 16 * scale, y + 14 * scale);

  ctx.font = `${13 * scale}px Arial`;
  let rowY = y + 42 * scale;
  items.forEach((item) => {
    const style = item.style || {};
    if (item.type === "points") {
      ctx.beginPath();
      ctx.arc(x + 24 * scale, rowY + 8 * scale, 5 * scale, 0, Math.PI * 2);
      ctx.fillStyle = style.markerFill || style.markerColor || "#111111";
      ctx.fill();
      ctx.lineWidth = Math.max(1, scale);
      ctx.strokeStyle = style.markerColor || "#111111";
      ctx.stroke();
    } else {
      ctx.fillStyle = rgba(style.fill || "#72a0ff", style.fillOpacity ?? 0.2);
      ctx.fillRect(x + 16 * scale, rowY + 2 * scale, 18 * scale, 12 * scale);
      ctx.strokeStyle = style.stroke || "#3957aa";
      ctx.lineWidth = Math.max(1, scale);
      ctx.strokeRect(x + 16 * scale, rowY + 2 * scale, 18 * scale, 12 * scale);
    }

    ctx.fillStyle = "#1d2b3d";
    ctx.fillText(item.label || "Layer", x + 46 * scale, rowY);
    rowY += 24 * scale;
  });
}

function drawNorthArrowCanvas(ctx, scene, scale) {
  const { northArrow } = getOverlayMetrics(scene);
  const x = northArrow.left * scale;
  const y = northArrow.top * scale;
  const w = northArrow.width * scale;
  const h = northArrow.height * scale;

  drawRoundedRect(ctx, x, y, w, h, 10 * scale);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  ctx.strokeStyle = "rgba(18,30,48,0.18)";
  ctx.lineWidth = 1 * scale;
  ctx.stroke();

  ctx.fillStyle = "#122033";
  ctx.font = `700 ${14 * scale}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("N", x + w / 2, y + 10 * scale);

  ctx.beginPath();
  ctx.moveTo(x + w / 2, y + 24 * scale);
  ctx.lineTo(x + w / 2 - 12 * scale, y + 58 * scale);
  ctx.lineTo(x + w / 2 - 3 * scale, y + 58 * scale);
  ctx.lineTo(x + w / 2 - 3 * scale, y + 84 * scale);
  ctx.lineTo(x + w / 2 + 3 * scale, y + 84 * scale);
  ctx.lineTo(x + w / 2 + 3 * scale, y + 58 * scale);
  ctx.lineTo(x + w / 2 + 12 * scale, y + 58 * scale);
  ctx.closePath();
  ctx.fillStyle = "#122033";
  ctx.fill();
  ctx.textAlign = "left";
}

function pickScaleLabel(map) {
  const size = map.getSize();
  const y = size.y - 40;
  const x1 = 20;
  const x2 = 150;
  const meters = map.containerPointToLatLng([x1, y]).distanceTo(map.containerPointToLatLng([x2, y]));
  const candidates = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
  const nice = candidates.reduce((best, n) => (Math.abs(n - meters) < Math.abs(best - meters) ? n : best), candidates[0]);
  const widthPx = Math.max(60, Math.min(180, Math.round((130 * nice) / meters)));
  return {
    label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m`,
    widthPx,
  };
}

function drawScaleBarCanvas(ctx, scene, scale) {
  const { scaleBar } = getOverlayMetrics(scene);
  const x = scaleBar.left * scale;
  const y = scaleBar.top * scale;
  const w = scaleBar.width * scale;
  const h = scaleBar.height * scale;
  const scaleState = pickScaleLabel(scene.map);
  const barWidth = scaleState.widthPx * scale;

  drawRoundedRect(ctx, x, y, w, h, 10 * scale);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  ctx.strokeStyle = "rgba(18,30,48,0.18)";
  ctx.lineWidth = 1 * scale;
  ctx.stroke();

  const barX = x + 16 * scale;
  const barY = y + 18 * scale;
  ctx.fillStyle = "#122033";
  ctx.fillRect(barX, barY, barWidth / 2, 10 * scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(barX + barWidth / 2, barY, barWidth / 2, 10 * scale);
  ctx.strokeStyle = "#122033";
  ctx.strokeRect(barX, barY, barWidth, 10 * scale);

  ctx.fillStyle = "#1d2b3d";
  ctx.font = `${12 * scale}px Arial`;
  ctx.textBaseline = "top";
  ctx.fillText(scaleState.label, x + 16 * scale, y + 36 * scale);
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

async function drawTilesCanvas(ctx, scene, scale) {
  const tiles = getTileImages(scene.container);
  for (const tile of tiles) {
    const img = await loadImage(tile.href);
    ctx.globalAlpha = tile.opacity;
    ctx.drawImage(img, tile.x * scale, tile.y * scale, tile.width * scale, tile.height * scale);
  }
  ctx.globalAlpha = 1;
}

function drawVectorsCanvas(ctx, scene, scale) {
  const template = scene.template;
  (scene.project.layers || []).forEach((layer) => {
    if (layer.visible === false || !layer.geojson) return;
    const style = getTemplateStyle(template, layer);
    featureCollectionFeatures(layer.geojson).forEach((feature) => {
      drawCanvasGeometry(ctx, scene.map, feature, style, scale);
    });
  });
}

async function drawLogoCanvas(ctx, scene, scale) {
  const logo = scene.project.layout?.logo;
  if (!logo) return;
  const zone = getOverlayMetrics(scene).logo;
  const img = await loadImage(logo);
  const x = zone.left * scale;
  const y = zone.top * scale;
  const w = zone.width * scale;
  const h = zone.height * scale;
  drawRoundedRect(ctx, x, y, w, h, 10 * scale);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  ctx.strokeStyle = "rgba(18,30,48,0.18)";
  ctx.lineWidth = 1 * scale;
  ctx.stroke();

  const padding = 10 * scale;
  const innerW = w - padding * 2;
  const innerH = h - padding * 2;
  const ratio = Math.min(innerW / img.width, innerH / img.height);
  const drawW = img.width * ratio;
  const drawH = img.height * ratio;
  const drawX = x + (w - drawW) / 2;
  const drawY = y + (h - drawH) / 2;
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
}

export async function renderSceneToCanvas(scene, options = {}) {
  const scale = Number(options.pixelRatio || scene.project.layout?.exportSettings?.pixelRatio || 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(scene.width * scale);
  canvas.height = Math.round(scene.height * scale);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f3f5f7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await drawTilesCanvas(ctx, scene, scale);
  drawVectorsCanvas(ctx, scene, scale);
  drawTitleBlockCanvas(ctx, scene, scale);
  drawLegendCanvas(ctx, scene, scale);
  drawNorthArrowCanvas(ctx, scene, scale);
  drawScaleBarCanvas(ctx, scene, scale);
  await drawLogoCanvas(ctx, scene, scale);

  return canvas;
}

function renderTileImagesSvg(scene, scale) {
  return getTileImages(scene.container)
    .map(
      (tile) =>
        `<image href="${escapeXml(tile.href)}" x="${(tile.x * scale).toFixed(2)}" y="${(tile.y * scale).toFixed(2)}" width="${(tile.width * scale).toFixed(2)}" height="${(tile.height * scale).toFixed(2)}" opacity="${tile.opacity}" preserveAspectRatio="none" />`
    )
    .join("\n");
}

function renderVectorsSvg(scene, scale) {
  const template = scene.template;
  return (scene.project.layers || [])
    .filter((layer) => layer.visible !== false && layer.geojson)
    .map((layer) => {
      const style = getTemplateStyle(template, layer);
      return featureCollectionFeatures(layer.geojson)
        .map((feature) => geometryToSvg(scene.map, feature, style, scale))
        .join("\n");
    })
    .join("\n");
}

function renderTitleSvg(scene, scale) {
  const { title } = getOverlayMetrics(scene);
  const x = title.left * scale;
  const y = title.top * scale;
  const w = title.width * scale;
  const h = title.height * scale;
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${12 * scale}" fill="rgba(10,31,66,0.96)" stroke="rgba(255,255,255,0.15)" />
      <text x="${x + 18 * scale}" y="${y + 42 * scale}" fill="#ffffff" font-family="Arial" font-size="${26 * scale}" font-weight="700">${escapeXml(scene.project.layout?.title || "Project Map")}</text>
      <text x="${x + 18 * scale}" y="${y + 66 * scale}" fill="rgba(255,255,255,0.86)" font-family="Arial" font-size="${14 * scale}">${escapeXml(scene.project.layout?.subtitle || "Technical results template")}</text>
    </g>`;
}

function renderLegendSvg(scene, scale) {
  const { legend } = getOverlayMetrics(scene);
  const items = scene.project.layout?.legendItems || [];
  if (!items.length) return "";
  const x = legend.left * scale;
  const y = legend.top * scale;
  const w = legend.width * scale;
  const h = legend.height * scale;
  const rows = items
    .map((item, index) => {
      const rowY = y + (42 + index * 24) * scale;
      return `
        ${legendSwatchSvg(item, x + 16 * scale, rowY + 2 * scale, scale)}
        <text x="${x + 46 * scale}" y="${rowY + 12 * scale}" fill="#1d2b3d" font-family="Arial" font-size="${13 * scale}">${escapeXml(item.label || "Layer")}</text>`;
    })
    .join("\n");

  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10 * scale}" fill="rgba(255,255,255,0.96)" stroke="rgba(18,30,48,0.18)" />
      <text x="${x + 16 * scale}" y="${y + 28 * scale}" fill="#132033" font-family="Arial" font-size="${15 * scale}" font-weight="700">Legend</text>
      ${rows}
    </g>`;
}

function renderNorthArrowSvg(scene, scale) {
  const { northArrow } = getOverlayMetrics(scene);
  const x = northArrow.left * scale;
  const y = northArrow.top * scale;
  const w = northArrow.width * scale;
  const h = northArrow.height * scale;
  const cx = x + w / 2;
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10 * scale}" fill="rgba(255,255,255,0.95)" stroke="rgba(18,30,48,0.18)" />
      <text x="${cx}" y="${y + 24 * scale}" text-anchor="middle" fill="#122033" font-family="Arial" font-size="${14 * scale}" font-weight="700">N</text>
      <path d="M ${cx} ${y + 24 * scale} L ${cx - 12 * scale} ${y + 58 * scale} L ${cx - 3 * scale} ${y + 58 * scale} L ${cx - 3 * scale} ${y + 84 * scale} L ${cx + 3 * scale} ${y + 84 * scale} L ${cx + 3 * scale} ${y + 58 * scale} L ${cx + 12 * scale} ${y + 58 * scale} Z" fill="#122033" />
    </g>`;
}

function renderScaleBarSvg(scene, scale) {
  const { scaleBar } = getOverlayMetrics(scene);
  const x = scaleBar.left * scale;
  const y = scaleBar.top * scale;
  const w = scaleBar.width * scale;
  const h = scaleBar.height * scale;
  const scaleState = pickScaleLabel(scene.map);
  const barWidth = scaleState.widthPx * scale;
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10 * scale}" fill="rgba(255,255,255,0.95)" stroke="rgba(18,30,48,0.18)" />
      <rect x="${x + 16 * scale}" y="${y + 18 * scale}" width="${barWidth / 2}" height="${10 * scale}" fill="#122033" />
      <rect x="${x + 16 * scale + barWidth / 2}" y="${y + 18 * scale}" width="${barWidth / 2}" height="${10 * scale}" fill="#ffffff" stroke="#122033" stroke-width="${Math.max(1, scale)}" />
      <rect x="${x + 16 * scale}" y="${y + 18 * scale}" width="${barWidth}" height="${10 * scale}" fill="none" stroke="#122033" stroke-width="${Math.max(1, scale)}" />
      <text x="${x + 16 * scale}" y="${y + 48 * scale}" fill="#1d2b3d" font-family="Arial" font-size="${12 * scale}">${escapeXml(scaleState.label)}</text>
    </g>`;
}

function renderLogoSvg(scene, scale) {
  const logo = scene.project.layout?.logo;
  if (!logo) return "";
  const zone = getOverlayMetrics(scene).logo;
  const x = zone.left * scale;
  const y = zone.top * scale;
  const w = zone.width * scale;
  const h = zone.height * scale;
  const padding = 10 * scale;
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${10 * scale}" fill="rgba(255,255,255,0.95)" stroke="rgba(18,30,48,0.18)" />
      <image href="${escapeXml(logo)}" x="${x + padding}" y="${y + padding}" width="${w - padding * 2}" height="${h - padding * 2}" preserveAspectRatio="xMidYMid meet" />
    </g>`;
}

export function renderSceneToSvg(scene, options = {}) {
  const scale = Number(options.pixelRatio || scene.project.layout?.exportSettings?.pixelRatio || 2);
  const width = Math.round(scene.width * scale);
  const height = Math.round(scene.height * scale);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f3f5f7" />
  ${renderTileImagesSvg(scene, scale)}
  ${renderVectorsSvg(scene, scale)}
  ${renderTitleSvg(scene, scale)}
  ${renderLegendSvg(scene, scale)}
  ${renderNorthArrowSvg(scene, scale)}
  ${renderScaleBarSvg(scene, scale)}
  ${renderLogoSvg(scene, scale)}
</svg>`;
}

export function downloadCanvas(filename, canvas) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png", 1.0);
  link.click();
}

export function downloadSvg(filename, svgText) {
  downloadBlob(filename, new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));
}
