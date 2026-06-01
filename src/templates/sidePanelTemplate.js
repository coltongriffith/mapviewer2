import { ROLE_LABELS, POINT_ROLES } from '../projectState';

const SIDEBAR_FRAC = 0.28;

function legendHeightFor(layout, itemCount, groupCount) {
  const lfs = layout?.legendFontScale ?? 1;
  const rowH = Math.round(28 * lfs);
  const groupPx = groupCount * 18;
  return Math.max(80, Math.min(500, 44 + itemCount * rowH + groupPx));
}

export const sidePanelTemplate = {
  id: 'side_panel',
  label: 'Side Panel',
  sidebarFrac: SIDEBAR_FRAC,
  frame: { margin: 18, panelRadius: 0 },
  zones: {},
  roleOrder: [
    'claims', 'target_areas', 'anomalies', 'faults_structures',
    'roads_access', 'rivers_water', 'drillholes', 'labels',
  ],
  roleGroups: {
    claims: 'Property', target_areas: 'Targets', anomalies: 'Targets',
    drillholes: 'Drilling', faults_structures: 'Reference',
    roads_access: 'Infrastructure', rivers_water: 'Infrastructure', labels: 'Reference',
  },
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
      basemap: 'satellite', insetMode: 'province_state', framing: 'balanced',
      visibleRoles: ['claims', 'drillholes', 'target_areas', 'anomalies', 'roads_access'],
      referenceOverlays: { context: false, labels: false, rail: false },
    },
    drill_plan: {
      basemap: 'light', insetMode: 'secondary_zoom', framing: 'tight',
      visibleRoles: ['claims', 'drillholes', 'target_areas', 'roads_access'],
      referenceOverlays: { context: false, labels: true, rail: false },
    },
  },
};

export function resolveSidePanelZones(template, layout, mapSize, legendItems) {
  const W = mapSize?.width || 1600;
  const H = mapSize?.height || 1000;
  const sbLeft = Math.round(W * (1 - SIDEBAR_FRAC));
  const sbW = W - sbLeft;
  const margin = 18;
  const innerW = sbW - margin * 2;

  const resolvedItems = legendItems || layout?.legendItems || [];
  const itemCount = resolvedItems.length;
  const groupCount = new Set(resolvedItems.map(i => i.group).filter(Boolean)).size;
  const legendHeight = layout?.legendHeightPx != null
    ? Math.max(60, Math.min(H - 260, layout.legendHeightPx))
    : legendHeightFor(layout, itemCount, groupCount);
  const legendWidth = innerW;

  const titleHeight = Math.max(60, Math.min(160, layout?.titleHeightPx ?? 92));
  const logoScale = Math.max(0.7, Math.min(1.2, Number(layout?.logoScale || 1)));
  const logoH = layout?.logoHeightPx ? Math.max(20, Math.min(200, layout.logoHeightPx)) : Math.round(56 * logoScale);
  const logoW = layout?.logoWidthPx ? Math.max(40, Math.min(innerW, layout.logoWidthPx)) : Math.min(innerW, Math.round(168 * logoScale));

  const naH = layout?.northArrowHeightPx ?? 80;
  const naW = Math.round(naH * 0.9);
  const scaleBarH = 52;
  const scaleBarW = innerW - naW - 8;

  // Stack top→bottom with margin gaps
  let y = margin;

  const titleZone = { top: y, left: sbLeft + margin, width: innerW, height: titleHeight };
  y += titleHeight + 12;

  const logoZone = layout?.logo
    ? { top: y, left: sbLeft + margin, width: logoW, height: logoH }
    : { top: y, left: sbLeft + margin, width: 0, height: 0 };
  if (layout?.logo) y += logoH + 12;

  const legendZone = { top: y, left: sbLeft + margin, width: legendWidth, height: legendHeight };
  y += legendHeight + 12;

  // North arrow + scale bar at bottom, above margin
  const bottomY = H - margin - Math.max(naH, scaleBarH);
  const northArrowZone = { top: bottomY + (Math.max(naH, scaleBarH) - naH) / 2, left: sbLeft + margin, width: naW, height: naH };
  const scaleBarZone = { top: bottomY, left: sbLeft + margin + naW + 8, width: Math.max(60, scaleBarW), height: scaleBarH };

  // Footer: just above north arrow
  const footerZone = y < bottomY - 24
    ? { top: bottomY - 30, left: sbLeft + margin, width: innerW, height: 26 }
    : { top: 0, left: 0, width: 0, height: 0 };

  // Inset: stays on map area, lower-left
  const insetW = layout?.insetWidthPx ? Math.max(100, Math.min(400, layout.insetWidthPx)) : 220;
  const insetH = layout?.insetHeightPx ? Math.max(80, Math.min(320, layout.insetHeightPx)) : 170;
  const insetZone = layout?.insetEnabled === false
    ? { top: 0, left: 0, width: 0, height: 0 }
    : { top: H - margin - insetH, left: margin, width: insetW, height: insetH };

  // Sidebar background zone — full height right panel
  const sidebarZone = { top: 0, left: sbLeft, width: sbW, height: H };

  return {
    sidebar: sidebarZone,
    title: titleZone,
    logo: logoZone,
    legend: legendZone,
    northArrow: northArrowZone,
    scaleBar: scaleBarZone,
    footer: footerZone,
    inset: insetZone,
  };
}

export function buildSidePanelLegendItems(layers, layout) {
  const items = [];
  for (const layer of (layers || [])) {
    if (!layer.visible || !layer.geojson) continue;
    if (layer.legend?.enabled === false) continue;
    const label = layer.legend?.label || layer.displayName || layer.name;
    const baseStyle = sidePanelTemplate.roleStyles?.[layer.role] || sidePanelTemplate.roleStyles?.other || {};
    const style = { ...baseStyle, ...(layer.style || {}) };
    items.push({ id: layer.id, label, type: layer.type, role: layer.role, style });
  }
  return items;
}
