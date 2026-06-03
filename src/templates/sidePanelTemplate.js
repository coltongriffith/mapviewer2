import { ROLE_LABELS, POINT_ROLES } from '../projectState';

const SIDEBAR_FRAC = 0.28;

function legendHeightFor(layout, itemCount, groupCount) {
  const lfs = layout?.legendFontScale ?? 1;
  const rowH = Math.round(28 * lfs);
  const groupPx = groupCount * 18;
  return Math.max(60, Math.min(400, 44 + itemCount * rowH + groupPx));
}

export const sidePanelTemplate = {
  id: 'side_panel',
  label: 'Technical',
  sidebarFrac: SIDEBAR_FRAC,
  frame: { margin: 0, panelRadius: 0 },
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
    regional_claims: {
      basemap: 'terrain', insetMode: 'country', framing: 'regional',
      visibleRoles: ['claims', 'roads_access', 'rivers_water', 'labels'],
      referenceOverlays: { context: false, labels: true, rail: false },
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
  const margin = 16;
  const innerW = sbW - margin * 2;
  const gap = 10;

  // --- Element heights ---
  const resolvedItems = legendItems || layout?.legendItems || [];
  const itemCount = resolvedItems.length;
  const groupCount = new Set(resolvedItems.map(i => i.group).filter(Boolean)).size;
  const legendHeight = layout?.legendHeightPx != null
    ? Math.max(60, Math.min(H - 320, layout.legendHeightPx))
    : legendHeightFor(layout, itemCount, groupCount);

  const titleHeight = Math.max(72, Math.min(180, layout?.titleHeightPx ?? 108));
  const logoScale = Math.max(0.7, Math.min(1.2, Number(layout?.logoScale || 1)));
  const logoH = layout?.logo ? (layout?.logoHeightPx ? Math.max(20, Math.min(160, layout.logoHeightPx)) : Math.round(52 * logoScale)) : 0;
  const logoW = layout?.logoWidthPx ? Math.max(40, Math.min(innerW, layout.logoWidthPx)) : Math.min(innerW, Math.round(innerW * 0.75));
  const naH = layout?.northArrowHeightPx ?? 72;
  const naW = Math.round(naH * 0.9);
  const scaleBarH = 48;

  // Inset: full inner width, height = 22% of canvas or user-set
  const insetEnabled = layout?.insetEnabled !== false;
  const insetH = layout?.insetHeightPx
    ? Math.max(80, Math.min(300, layout.insetHeightPx))
    : Math.round(H * 0.22);
  const insetW = innerW;

  const sp = layout?.sidePanelPositions || {};

  // --- Stack from TOP in configurable order ---
  const order = layout?.sidePanelOrder || ['inset', 'legend', 'logo'];
  let insetZone = { top: 0, left: 0, width: 0, height: 0 };
  let legendZone = { top: margin, left: sbLeft + margin, width: innerW, height: legendHeight };
  let logoZone = { top: 0, left: 0, width: 0, height: 0 };

  let stackY = margin;
  for (const id of order) {
    if (id === 'inset') {
      if (!insetEnabled) continue;
      insetZone = { top: stackY, left: sbLeft + margin, width: insetW, height: insetH };
      stackY += insetH + gap;
    } else if (id === 'legend') {
      legendZone = { top: stackY, left: sbLeft + margin, width: innerW, height: legendHeight };
      stackY += legendHeight + gap;
    } else if (id === 'logo') {
      if (!layout?.logo) continue;
      logoZone = { top: stackY, left: sbLeft + margin, width: logoW, height: logoH };
      stackY += logoH + gap;
    }
  }

  // --- Stack from BOTTOM ---
  let bottomY = H - margin;

  const footerH = 22;
  const footerZone = layout?.footerEnabled && layout?.footerText
    ? { top: bottomY - footerH, left: sbLeft + margin, width: innerW, height: footerH }
    : { top: 0, left: 0, width: 0, height: 0 };
  if (layout?.footerEnabled && layout?.footerText) bottomY -= footerH + 6;

  let titleZone = { top: bottomY - titleHeight, left: sbLeft + margin, width: innerW, height: titleHeight };
  if (sp.title?.top != null) titleZone = { ...titleZone, top: sp.title.top };

  // North arrow and scale bar live on the MAP area (left portion), not in the sidebar
  const mapW = sbLeft;
  const scaleBarW = layout?.scaleBarWidthPx || 160;
  const scaleBarActualH = layout?.scaleBarHeightPx ?? 48;

  let northArrowZone = {
    top: H - margin - naH,
    left: mapW - margin - naW,
    width: naW,
    height: naH,
  };
  if (sp.northArrow?.top != null) northArrowZone = { ...northArrowZone, top: sp.northArrow.top };
  if (sp.northArrow?.left != null) northArrowZone = { ...northArrowZone, left: sp.northArrow.left };

  let scaleBarZone = {
    top: H - margin - scaleBarActualH,
    left: margin,
    width: scaleBarW,
    height: scaleBarActualH,
  };
  if (sp.scaleBar?.top != null) scaleBarZone = { ...scaleBarZone, top: sp.scaleBar.top };
  if (sp.scaleBar?.left != null) scaleBarZone = { ...scaleBarZone, left: sp.scaleBar.left };

  // Sidebar background — full height right panel
  const sidebarZone = { top: 0, left: sbLeft, width: sbW, height: H };

  return {
    sidebar: sidebarZone,
    inset: insetZone,
    legend: legendZone,
    logo: logoZone,
    northArrow: northArrowZone,
    scaleBar: scaleBarZone,
    title: titleZone,
    footer: footerZone,
  };
}

// ─── Map area slot system (for north arrow / scale bar) ─────────────────────

/** Map area slots: [xFrac, yFrac] within the left (map) portion of the canvas */
export const MAP_SLOT_DEFS = {
  'map-tl': [0.03, 0.04],
  'map-tc': [0.40, 0.04],
  'map-tr': [0.76, 0.04],
  'map-bl': [0.03, 0.88],
  'map-bc': [0.40, 0.88],
  'map-br': [0.76, 0.88],
};

/** Returns pixel {left, top} for each map slot. mapAreaW = sbLeft. */
export function mapSlotPositions(mapAreaW, mapH) {
  return Object.fromEntries(
    Object.entries(MAP_SLOT_DEFS).map(([key, [xf, yf]]) => [
      key,
      { left: Math.round(xf * mapAreaW), top: Math.round(yf * mapH) },
    ])
  );
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
