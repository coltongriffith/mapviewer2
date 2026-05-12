import { ROLE_LABELS, POINT_ROLES } from '../projectState';

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
  label: 'NI 43-101 Technical',
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
      basemap: 'topo',
      insetMode: 'country',
      framing: 'access',
      visibleRoles: ['claims', 'roads_access', 'rivers_water', 'labels'],
      referenceOverlays: { context: false, labels: true, rail: true },
    },
  },
};

function legendHeightFor(layout, itemCount, groupCount = 0) {
  const mode = layout?.legendMode || 'auto';
  const compact = mode === 'compact' || (mode === 'auto' && itemCount <= 2);
  if (!itemCount) return 0;
  const groupPx = groupCount * 22;
  if (compact) return Math.max(84, Math.min(360, 42 + itemCount * 24 + groupPx));
  return Math.max(110, Math.min(360, 52 + itemCount * 28 + groupPx));
}

function clampZone(zone, safe, width, height) {
  const next = { ...zone };
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
  const groupCount = new Set(resolvedLegendItems.map((item) => item.group).filter(Boolean)).size;
  const legendHeight = layout?.legendHeightPx != null
    ? Math.max(60, Math.min(500, layout.legendHeightPx))
    : legendHeightFor(layout, legendCount, groupCount);
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

  const insetCorner = layout?.insetCorner || 'tr';
  const northArrowCorner = layout?.northArrowCorner || 'br';
  const scaleBarCorner = layout?.scaleBarCorner || 'bl';
  const legendCorner = layout?.legendCorner || 'bl';
  const logoCorner = layout?.logoCorner || 'tl';

  const vOffset = { tl: 0, tr: 0, bl: 0, br: 0 };

  function anchorAt(corner) {
    switch (corner) {
      case 'tr': return { top: safe.top + vOffset.tr, right: safe.right };
      case 'bl': return { bottom: safe.bottom + vOffset.bl, left: safe.left };
      case 'br': return { bottom: safe.bottom + vOffset.br, right: safe.right };
      case 'tl': default: return { top: safe.top + vOffset.tl, left: safe.left };
    }
  }

  const logoW = layout?.logoWidthPx ? Math.max(40, Math.min(400, layout.logoWidthPx)) : 168;
  const logoH = layout?.logoHeightPx ? Math.max(20, Math.min(300, layout.logoHeightPx)) : 74;
  const logoZone = clampZone({ ...anchorAt(logoCorner), width: logoW, height: logoH }, safe, width, height);
  if (layout?.logo) vOffset[logoCorner] += logoH + 10;

  const insetZone = layout?.insetEnabled === false
    ? { top: safe.top, left: width - safe.right, width: 0, height: 0 }
    : clampZone({ ...anchorAt(insetCorner), width: insetWidth, height: insetHeight }, safe, width, height);
  if (layout?.insetEnabled !== false) vOffset[insetCorner] += insetHeight + 10;

  const northArrowZone = clampZone({ ...anchorAt(northArrowCorner), width: 74, height: 100 }, safe, width, height);
  vOffset[northArrowCorner] += 100 + 10;

  const scaleBarZone = layout?.showScaleBar === false
    ? { left: 0, top: 0, width: 0, height: 0 }
    : clampZone({ ...anchorAt(scaleBarCorner), width: 180, height: 60 }, safe, width, height);
  if (layout?.showScaleBar !== false) vOffset[scaleBarCorner] += 60 + 8;

  const legendZone = clampZone({ ...anchorAt(legendCorner), width: legendWidth, height: legendHeight }, safe, width, height);

  return {
    title: { left: 0, top: 0, width: 0, height: 0 },
    logo: logoZone,
    footer: { left: 0, top: 0, width: 0, height: 0 },
    scaleBar: scaleBarZone,
    inset: insetZone,
    northArrow: northArrowZone,
    legend: legendZone,
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
    if (ov.markerShape) seen.add(ov.markerShape);
  }
  return [...seen];
}

export function buildLegendItemsNI43101(template, layers, layout = {}) {
  const visible = layers.filter((layer) => layer.visible !== false && layer.legend?.enabled !== false);
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
