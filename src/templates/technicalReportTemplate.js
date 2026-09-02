import { ROLE_LABELS, POINT_ROLES } from '../projectState';
import { hasVisibleFeatures } from '../utils/featureIdentity.js';
import { getCornerLayout } from '../utils/cornerLayout';

const STRIP_H = 72;
const TICK_MARGIN = 28;

const ROLE_GROUPS = {
  claims: 'Property',
  target_areas: 'Targets',
  anomalies: 'Targets',
  drillholes: 'Drilling',
  faults_structures: 'Reference',
  roads_access: 'Infrastructure',
  rivers_water: 'Infrastructure',
  labels: 'Reference',
};

export const technicalReportTemplate = {
  id: 'ni_43101_technical',
  label: 'NI 43-101',
  frame: {
    margin: 0,
    panelRadius: 0,
  },
  zones: {},
  roleOrder: [
    'claims',
    'target_areas',
    'anomalies',
    'faults_structures',
    'roads_access',
    'rivers_water',
    'drillholes',
    'labels',
  ],
  roleGroups: ROLE_GROUPS,
  roleStyles: {
    claims: {
      stroke: '#1a3a8f',
      fill: '#4a6fd4',
      fillOpacity: 0.12,
      strokeWidth: 1.8,
      dashArray: '',
    },
    drillholes: {
      markerColor: '#cc2200',
      markerFill: '#ffffff',
      markerSize: 10,
      markerShape: 'circle',
      strokeWidth: 1.4,
    },
    target_areas: {
      stroke: '#cc2200',
      fill: '#cc2200',
      fillOpacity: 0.10,
      strokeWidth: 1.6,
      dashArray: '8 4',
    },
    anomalies: {
      stroke: '#8b00a0',
      fill: '#b030c0',
      fillOpacity: 0.14,
      strokeWidth: 1.6,
      dashArray: '6 3',
    },
    faults_structures: {
      stroke: '#000000',
      fill: '#000000',
      fillOpacity: 0,
      strokeWidth: 1.6,
      dashArray: '10 4',
    },
    roads_access: {
      stroke: '#6b4c2a',
      fill: '#6b4c2a',
      fillOpacity: 0,
      strokeWidth: 1.4,
      dashArray: '',
    },
    rivers_water: {
      stroke: '#1464a0',
      fill: '#4a90c0',
      fillOpacity: 0.18,
      strokeWidth: 1.4,
      dashArray: '',
    },
    labels: {
      stroke: '#000000',
      fill: '#000000',
      fillOpacity: 0,
      strokeWidth: 0.8,
    },
    other: {
      stroke: '#1a3a8f',
      fill: '#4a6fd4',
      fillOpacity: 0.14,
      strokeWidth: 1.6,
    },
  },
  modePresets: {
    project_overview: {
      basemap: 'satellite',
      insetMode: 'province_state',
      framing: 'balanced',
      visibleRoles: ['claims', 'drillholes', 'target_areas', 'anomalies', 'roads_access', 'rivers_water'],
      referenceOverlays: { context: false, labels: false, rail: false },
    },
    regional_claims: {
      basemap: 'light',
      insetMode: 'country',
      framing: 'regional',
      visibleRoles: ['claims', 'roads_access', 'rivers_water', 'labels'],
      referenceOverlays: { context: false, labels: true, rail: false },
    },
    drill_plan: {
      basemap: 'light',
      insetMode: 'secondary_zoom',
      framing: 'tight',
      visibleRoles: ['claims', 'drillholes', 'target_areas', 'roads_access'],
      referenceOverlays: { context: false, labels: true, rail: false },
    },
    target_anomaly: {
      basemap: 'satellite',
      insetMode: 'regional_district',
      framing: 'tight',
      visibleRoles: ['claims', 'target_areas', 'anomalies', 'faults_structures', 'drillholes'],
      referenceOverlays: { context: false, labels: false, rail: false },
    },
    access_location: {
      basemap: 'terrain',
      insetMode: 'country',
      framing: 'access',
      visibleRoles: ['claims', 'roads_access', 'rivers_water', 'labels'],
      referenceOverlays: { context: false, labels: true, rail: true },
    },
  },
};

function legendHeightFor(layout, itemCount) {
  const mode = layout?.legendMode || 'auto';
  const compact = mode === 'compact' || (mode === 'auto' && itemCount <= 2);
  if (!itemCount) return 0;
  // No group allowance: nothing renders legend group headings — not the stage
  // (renderLegendGroups returns a single unheaded group) and not either
  // exporter. Reserving a row per group padded every legend panel with dead
  // space in the preview and in the export alike. If headings come back, the
  // allowance comes back with them.
  if (compact) return Math.max(84, Math.min(360, 42 + itemCount * 24));
  return Math.max(110, Math.min(360, 52 + itemCount * 28));
}

function clampZone(zone, safe, width, height) {
  const next = { ...zone };
  next.width = Math.min(next.width, width - safe.left - safe.right);
  next.height = Math.min(next.height, height - safe.top - safe.bottom);
  if (next.right != null && next.left == null) next.left = width - next.right - next.width;
  if (next.bottom != null && next.top == null) next.top = height - next.bottom - next.height;
  next.left = Math.max(safe.left, Math.min(width - safe.right - next.width, next.left));
  next.top = Math.max(safe.top, Math.min(height - safe.bottom - next.height, next.top));
  return next;
}

export function resolveNI43101Zones(template, layout, mapSize, legendItems) {
  const width = mapSize?.width || 1600;
  const height = mapSize?.height || 1000;

  const stripPos = layout?.titleStripPosition || 'bottom';
  const mapFrameTop = TICK_MARGIN + (stripPos === 'top' ? STRIP_H : 0);
  const mapFrameBottom = height - TICK_MARGIN - (stripPos === 'bottom' ? STRIP_H : 0);
  const mapFrameLeft = TICK_MARGIN;
  const mapFrameRight = width - TICK_MARGIN;

  // Safe margins are relative to the inset map frame
  const safe = { top: mapFrameTop + 16, bottom: height - mapFrameBottom + 16, left: mapFrameLeft + 16, right: width - mapFrameRight + 16 };

  const resolvedLegendItems = legendItems || layout?.legendItems || [];
  const legendCount = resolvedLegendItems.length;
  const legendHeight = layout?.legendHeightPx != null
    ? Math.max(60, Math.min(500, layout.legendHeightPx))
    : legendHeightFor(layout, legendCount);
  const legendWidth = Math.max(180, Math.min(480, layout?.legendWidthPx ?? 300));

  const insetScale = Math.max(0.8, Math.min(1.2, Number(layout?.insetScale || 1)));
  const insetSize = layout?.insetSize || 'medium';
  const insetScaleBase = insetSize === 'small' ? 0.86 : insetSize === 'large' ? 1.16 : 1;
  const insetWidth = layout?.insetWidthPx
    ? Math.max(100, Math.min(600, layout.insetWidthPx))
    : Math.round(244 * insetScale * insetScaleBase);
  const insetHeight = layout?.insetHeightPx
    ? Math.max(80, Math.min(500, layout.insetHeightPx))
    : (layout?.insetMode === 'custom_image' && layout?.insetAspectRatio)
      ? Math.round(insetWidth / layout.insetAspectRatio)
      : Math.round(190 * insetScale * insetScaleBase);

  const vOffset = { tl: 0, tr: 0, bl: 0, br: 0 };

  const logoW = layout?.logoWidthPx ? Math.max(40, Math.min(400, layout.logoWidthPx)) : 168;
  const logoH = layout?.logoHeightPx ? Math.max(20, Math.min(300, layout.logoHeightPx)) : 74;
  const naH = layout?.northArrowHeightPx ?? 100;
  const naW = Math.round(naH * 0.90);

  function sizeOf(id) {
    switch (id) {
      case 'logo':       return [logoW, logoH];
      case 'inset':      return layout?.insetEnabled === false ? [0, 0] : [insetWidth, insetHeight];
      case 'northArrow': return [naW, naH];
      case 'scaleBar':   return layout?.showScaleBar === false ? [0, 0] : [180, 60];
      case 'legend':     return [legendWidth, legendHeight];
      default:           return [0, 0];
    }
  }

  // Override cornerLayout for NI: only these elements apply (no title)
  const rawCl = getCornerLayout(layout);
  // Strip title from NI layout (it lives in the fixed strip, not a corner)
  const cl = {};
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    cl[corner] = (rawCl[corner] || []).map((row) => row.filter((id) => id !== 'title')).filter((row) => row.length > 0);
  }

  const zones = {};
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const rows = cl[corner] || [];
    for (const row of rows) {
      let rowH = 0;
      let hCursor = 0;
      for (const id of row) {
        const [w, h] = sizeOf(id);
        if (w === 0 && h === 0) { zones[id] = { top: 0, left: 0, width: 0, height: 0 }; continue; }
        let anchor;
        if (corner === 'tl') anchor = { top: safe.top + vOffset.tl, left: safe.left + hCursor };
        else if (corner === 'tr') anchor = { top: safe.top + vOffset.tr, right: safe.right + hCursor };
        else if (corner === 'bl') anchor = { bottom: safe.bottom + vOffset.bl, left: safe.left + hCursor };
        else anchor = { bottom: safe.bottom + vOffset.br, right: safe.right + hCursor };
        zones[id] = clampZone({ ...anchor, width: w, height: h }, safe, width, height);
        hCursor += w + 8;
        rowH = Math.max(rowH, h);
      }
      vOffset[corner] += rowH + 10;
    }
  }

  for (const id of ['logo', 'inset', 'northArrow', 'scaleBar', 'legend']) {
    if (!zones[id]) zones[id] = { top: 0, left: 0, width: 0, height: 0 };
  }

  return {
    title: { left: 0, top: 0, width: 0, height: 0 },
    logo: zones.logo,
    footer: { left: 0, top: 0, width: 0, height: 0 },
    scaleBar: zones.scaleBar,
    inset: zones.inset,
    northArrow: zones.northArrow,
    legend: zones.legend,
  };
}

const SHAPE_DISPLAY = {
  circle: 'Circle', triangle_down: 'Tri ▼', triangle: 'Tri ▲',
  square: 'Square', diamond: 'Diamond', cross: 'Cross',
  drillhole: 'DH Pin', star: 'Star',
};

function distinctShapesForLayer(layer) {
  const def = layer.style?.markerShape || 'circle';
  const seen = new Set([def]);
  for (const ov of Object.values(layer.featureOverrides || {})) {
    // A removed point's marker shape is not on the map, so it must not earn a
    // swatch of its own.
    if (ov.markerShape && !ov.hidden) seen.add(ov.markerShape);
  }
  return [...seen];
}

export function buildLegendItemsNI43101(template, layers, _layout = {}) {
  // A layer whose every shape has been removed contributes nothing to the map,
  // so it must not contribute a legend entry either — an entry for an absent
  // layer tells the reader that data is on the page when it is not, and the
  // trim panel explicitly promises removed shapes are out of the legend.
  const visible = layers.filter((layer) => layer.visible !== false
    && layer.legend?.enabled !== false
    && hasVisibleFeatures(layer));
  const byRole = new Map((template.roleOrder || []).map((role, idx) => [role, idx]));

  return visible
    .slice()
    .sort((a, b) => (byRole.get(a.role) ?? 999) - (byRole.get(b.role) ?? 999))
    .flatMap((layer) => {
      const baseStyle = {
        ...(template.roleStyles?.[layer.role] || template.roleStyles?.other || {}),
        ...(layer.style || {}),
      };
      const baseLabel = layer.displayName || layer.legend?.label || layer.name || ROLE_LABELS[layer.role] || 'Layer';
      const isPoint = POINT_ROLES.has(layer.role) || layer.type === 'points';

      if (isPoint) {
        const shapes = distinctShapesForLayer(layer);
        return shapes.map((shape) => ({
          id: shapes.length === 1 ? layer.id : `${layer.id}::${shape}`,
          role: layer.role,
          group: template.roleGroups?.[layer.role] || 'Map Data',
          label: layer.legend?.shapeLabels?.[shape]
            || (shapes.length === 1 ? baseLabel : `${baseLabel} (${SHAPE_DISPLAY[shape] || shape})`),
          type: 'points',
          markerShape: shape,
          style: { ...baseStyle, markerShape: shape },
        }));
      }

      return [{
        id: layer.id,
        role: layer.role,
        group: template.roleGroups?.[layer.role] || 'Map Data',
        label: baseLabel,
        type: layer.type,
        style: baseStyle,
      }];
    });
}

/**
 * The one place that decides what the NI 43-101 title block says.
 *
 * Three renderers draw this strip — the editing stage, the canvas exporter and
 * the SVG exporter — and each used to read `layout` directly. That is how the
 * TITLE cell ended up empty on a map that plainly had a title: switching to
 * this template cleared `stripTitle`, and nothing fell back to the project's
 * own title. Resolving the fields here means the preview and both exports
 * cannot disagree.
 *
 * Nothing here writes to the project. A blank strip field means "use the
 * project's value"; typing into the strip field still overrides it.
 *
 * @param {object} layout   project.layout
 * @param {object} ctx      { scaleText, projectionText, now } — values only the
 *                          caller can compute (map scale, UTM zone, today).
 */
export function resolveTitleStripFields(layout = {}, ctx = {}) {
  const { scaleText = '', projectionText = '', now = new Date() } = ctx;

  // A figure that has not been signed off says so. An em dash reads as
  // "intentionally blank", which is the opposite of what an unfilled
  // qualified-person or figure number means in a technical report.
  const MISSING = 'NOT SET';

  const isoDate = () => {
    try { return now.toISOString().slice(0, 10); } catch { return ''; }
  };

  return {
    title: layout.stripTitle || layout.title || '',
    subtitle: layout.stripSubtitle || layout.subtitle || '',
    scale: layout.manualScaleDenom
      ? `1:${Number(String(layout.manualScaleDenom).replace(/[^0-9]/g, '')).toLocaleString('en-US')}`
      : (scaleText || MISSING),
    projection: layout.projectionName || projectionText || 'WGS84',
    qpName: layout.qpName || MISSING,
    qpCredentials: layout.qpCredentials || '',
    companyName: layout.companyName || '',
    figureNumber: layout.figureNumber || MISSING,
    figureRevision: layout.figureRevision || `Rev. ${MISSING}`,
    // A report figure is dated. When the project has not been given one, the
    // date it was produced is the honest answer — and it is never written back
    // to the project, so setting Map Date still wins.
    date: layout.mapDate || isoDate(),
    missing: {
      scale: !layout.manualScaleDenom && !scaleText,
      qpName: !layout.qpName,
      figureNumber: !layout.figureNumber,
      figureRevision: !layout.figureRevision,
      date: !layout.mapDate,
    },
  };
}
