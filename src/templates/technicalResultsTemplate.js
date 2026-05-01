import { ROLE_LABELS } from '../projectState';

const BASE_ZONES = {
  title: { top: 22, left: 22, width: 520, height: 92 },
  logo: { top: 126, left: 22, width: 168, height: 74 },
  inset: { top: 22, right: 22, width: 244, height: 190 },
  legend: { bottom: 102, left: 22, width: 300, height: 168 },
  scaleBar: { bottom: 22, left: 22, width: 230, height: 64 },
  northArrow: { bottom: 22, right: 22, width: 74, height: 100 },
  footer: { bottom: 22, left: 270, width: 440, height: 42 },
};

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

export const technicalResultsTemplate = {
  id: 'technical_results_v2',
  label: 'Technical Results v2',
  frame: {
    margin: 18,
    panelRadius: 12,
  },
  zones: BASE_ZONES,
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
    claims: { stroke: '#60a5fa', fill: '#93c5fd', fillOpacity: 0.22, strokeWidth: 2 },
    drillholes: { markerColor: '#1f2937', markerFill: '#ffffff', markerSize: 12, strokeWidth: 1.8 },
    target_areas: { stroke: '#f59e0b', fill: '#fbbf24', fillOpacity: 0.16, strokeWidth: 2.2, dashArray: '8 5' },
    anomalies: { stroke: '#a21caf', fill: '#d946ef', fillOpacity: 0.18, strokeWidth: 2.1 },
    faults_structures: { stroke: '#374151', fill: '#374151', fillOpacity: 0, strokeWidth: 1.8, dashArray: '6 4' },
    roads_access: { stroke: '#7c5e43', fill: '#7c5e43', fillOpacity: 0, strokeWidth: 1.8 },
    rivers_water: { stroke: '#0ea5e9', fill: '#7dd3fc', fillOpacity: 0.16, strokeWidth: 1.8 },
    labels: { stroke: '#0f172a', fill: '#0f172a', fillOpacity: 0, strokeWidth: 1 },
    other: { stroke: '#2563eb', fill: '#93c5fd', fillOpacity: 0.2, strokeWidth: 1.8 },
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

function intersects(a, b) {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

export function resolveTemplateZones(template, layout, mapSize, legendItems) {
  const width = mapSize?.width || 1600;
  const height = mapSize?.height || 1000;
  const safe = { top: 22, right: 22, bottom: 22, left: 22, ...(layout?.safeMargins || {}) };
  const titleWidth = layout?.titleWidthPx
    ? Math.max(300, Math.min(800, layout.titleWidthPx))
    : Math.max(420, Math.min(Math.round(width * 0.42), layout?.titleWidth === 'wide' ? 620 : 560));
  const titleHeight = Math.max(60, Math.min(180, layout?.titleHeightPx ?? 92));

  const resolvedLegendItems = legendItems || layout?.legendItems || [];
  const legendCount = resolvedLegendItems.length;
  const groupCount = new Set(resolvedLegendItems.map((item) => item.group).filter(Boolean)).size;
  const legendHeight = layout?.legendHeightPx != null
    ? Math.max(60, Math.min(500, layout.legendHeightPx))
    : legendHeightFor(layout, legendCount, groupCount);
  const legendWidth = Math.max(180, Math.min(480, layout?.legendWidthPx ?? 300));
  const logoScale = Math.max(0.7, Math.min(1.2, Number(layout?.logoScale || 1)));
  const insetScale = Math.max(0.8, Math.min(1.2, Number(layout?.insetScale || 1)));
  const insetSize = layout?.insetSize || 'medium';
  const insetScaleBase = insetSize === 'small' ? 0.86 : insetSize === 'large' ? 1.16 : 1;

  const insetWidth = layout?.insetWidthPx
    ? Math.max(100, Math.min(600, layout.insetWidthPx))
    : Math.round(BASE_ZONES.inset.width * insetScale * insetScaleBase);
  const insetHeight = layout?.insetHeightPx
    ? Math.max(80, Math.min(500, layout.insetHeightPx))
    : (layout?.insetMode === 'custom_image' && layout?.insetAspectRatio)
      ? Math.round(insetWidth / layout.insetAspectRatio)
      : Math.round(BASE_ZONES.inset.height * insetScale * insetScaleBase);

  const titleCorner    = layout?.titleCorner     || 'tl';
  const logoCorner     = layout?.logoCorner      || 'tl';
  const insetCorner    = layout?.insetCorner     || 'tr';
  const northArrowCorner = layout?.northArrowCorner || 'br';
  const scaleBarCorner = layout?.scaleBarCorner  || 'bl';
  const legendCorner   = layout?.legendCorner    || 'bl';

  // Stacking accumulator — tracks space consumed at each corner (offset from that edge)
  const vOffset = { tl: 0, tr: 0, bl: 0, br: 0 };

  function anchorAt(corner) {
    switch (corner) {
      case 'tr': return { top: safe.top + vOffset.tr, right: safe.right };
      case 'bl': return { bottom: safe.bottom + vOffset.bl, left: safe.left };
      case 'br': return { bottom: safe.bottom + vOffset.br, right: safe.right };
      case 'tl': default: return { top: safe.top + vOffset.tl, left: safe.left };
    }
  }

  // Placement order: title → logo → inset → north arrow → scale bar → legend
  const titleZone = clampZone({ ...anchorAt(titleCorner), width: titleWidth, height: titleHeight }, safe, width, height);
  vOffset[titleCorner] += titleHeight + 10;

  const logoW = layout?.logoWidthPx ? Math.max(40, Math.min(400, layout.logoWidthPx)) : Math.round(BASE_ZONES.logo.width * logoScale);
  const logoH = layout?.logoHeightPx ? Math.max(20, Math.min(300, layout.logoHeightPx)) : Math.round(BASE_ZONES.logo.height * logoScale);
  const logoZone = clampZone({ ...anchorAt(logoCorner), width: logoW, height: logoH }, safe, width, height);
  vOffset[logoCorner] += logoH + 10;

  const insetZone = layout?.insetEnabled === false
    ? { top: safe.top, left: width - safe.right, width: 0, height: 0 }
    : clampZone({ ...anchorAt(insetCorner), width: insetWidth, height: insetHeight }, safe, width, height);
  if (layout?.insetEnabled !== false) vOffset[insetCorner] += insetHeight + 10;

  const northArrowZone = clampZone({ ...anchorAt(northArrowCorner), width: BASE_ZONES.northArrow.width, height: BASE_ZONES.northArrow.height }, safe, width, height);
  vOffset[northArrowCorner] += BASE_ZONES.northArrow.height + 10;

  const scaleBarZone = clampZone({ ...anchorAt(scaleBarCorner), width: BASE_ZONES.scaleBar.width, height: BASE_ZONES.scaleBar.height }, safe, width, height);
  vOffset[scaleBarCorner] += BASE_ZONES.scaleBar.height + 10;

  const legendZone = clampZone({ ...anchorAt(legendCorner), width: legendWidth, height: legendHeight }, safe, width, height);

  // Footer: bottom-center strip, hidden if it collides with anything below
  const footerZone = clampZone({ bottom: safe.bottom, left: BASE_ZONES.footer.left, width: BASE_ZONES.footer.width, height: BASE_ZONES.footer.height }, safe, width, height);
  if (intersects(legendZone, footerZone) || intersects(scaleBarZone, footerZone) || intersects(northArrowZone, footerZone)) {
    footerZone.width = 0;
    footerZone.height = 0;
  }

  return {
    title: titleZone,
    logo: logoZone,
    inset: insetZone,
    scaleBar: scaleBarZone,
    legend: legendZone,
    northArrow: northArrowZone,
    footer: footerZone,
  };
}

function buildOverlayLegendItems(layout) {
  const items = [];
  if (layout?.referenceOverlays?.rail) {
    items.push({
      id: 'overlay-rail',
      role: 'roads_access',
      group: 'Infrastructure',
      label: 'Railway Network',
      type: 'line',
      style: { stroke: '#b04020', fill: '#b04020', fillOpacity: 0, strokeWidth: 2 },
    });
  }
  if (layout?.referenceOverlays?.labels) {
    items.push({
      id: 'overlay-labels',
      role: 'labels',
      group: 'Reference',
      label: 'Reference Labels',
      type: 'line',
      style: { stroke: '#64748b', fill: '#64748b', fillOpacity: 0, strokeWidth: 1.4 },
    });
  }
  return items;
}

export function buildLegendItems(template, layers, layout = {}) {
  const visible = layers.filter((layer) => layer.visible !== false && layer.legend?.enabled !== false);
  const byRole = new Map((template.roleOrder || []).map((role, idx) => [role, idx]));

  const layerItems = visible
    .slice()
    .sort((a, b) => (byRole.get(a.role) ?? 999) - (byRole.get(b.role) ?? 999))
    .map((layer) => ({
      id: layer.id,
      role: layer.role,
      group: template.roleGroups?.[layer.role] || 'Map Data',
      label: layer.displayName || layer.legend?.label || layer.name || ROLE_LABELS[layer.role] || 'Layer',
      type: layer.type,
      style: {
        ...(template.roleStyles?.[layer.role] || template.roleStyles?.other || {}),
        ...(layer.style || {}),
      },
    }));

  return [...layerItems, ...buildOverlayLegendItems(layout)];
}
