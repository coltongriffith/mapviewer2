import { ROLE_LABELS } from '../projectState';

const BASE_ZONES = {
  title: { top: 18, left: 18, width: 480, height: 86 },
  legend: { top: 122, left: 18, width: 292, height: 120 },
  inset: { top: 18, right: 18, width: 244, height: 190 },
  northArrow: { top: 220, right: 18, width: 76, height: 104 },
  scaleBar: { bottom: 18, left: 18, width: 230, height: 64 },
  footer: { bottom: 18, left: 268, width: 460, height: 42 },
  logo: { bottom: 18, right: 18, width: 180, height: 84 },
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

function legendHeightFor(layout, itemCount) {
  const mode = layout?.legendMode || 'auto';
  const compact = mode === 'compact' || (mode === 'auto' && itemCount <= 2);
  if (!itemCount) return 0;
  if (compact) return Math.max(84, Math.min(160, 44 + itemCount * 26));
  return Math.max(110, Math.min(280, 54 + itemCount * 30));
}

export function resolveTemplateZones(template, layout, mapSize) {
  const width = mapSize?.width || 1600;
  const height = mapSize?.height || 1000;
  const legendCount = Math.max(0, layout?.legendItems?.length || 0);
  const legendHeight = legendHeightFor(layout, legendCount);
  const logoScale = Number(layout?.logoScale || 1);
  const logoWidth = Math.round(BASE_ZONES.logo.width * logoScale);
  const logoHeight = Math.round(BASE_ZONES.logo.height * logoScale);
  const insetSize = layout?.insetSize || 'medium';
  const insetEnabled = layout?.insetEnabled !== false;
  const insetScale = insetSize === 'small' ? 0.82 : insetSize === 'large' ? 1.22 : 1;
  const titleWidth = layout?.titleWidth === 'wide' ? 620 : 480;

  const insetWidth = Math.round(BASE_ZONES.inset.width * insetScale);
  const insetHeight = Math.round(BASE_ZONES.inset.height * insetScale);

  const zones = {
    ...BASE_ZONES,
    title: { ...BASE_ZONES.title, width: titleWidth },
    legend: { ...BASE_ZONES.legend, height: legendHeight },
    inset: insetEnabled
      ? { ...BASE_ZONES.inset, width: insetWidth, height: insetHeight }
      : { ...BASE_ZONES.inset, width: 0, height: 0 },
    footer: layout?.footerEnabled === false ? { ...BASE_ZONES.footer, width: 0, height: 0 } : { ...BASE_ZONES.footer },
    logo: { ...BASE_ZONES.logo, width: logoWidth, height: logoHeight },
  };

  return Object.fromEntries(
    Object.entries(zones).map(([key, zone]) => {
      const next = { ...zone };
      if (next.right != null && next.left == null && next.width != null) next.left = width - next.right - next.width;
      if (next.bottom != null && next.top == null && next.height != null) next.top = height - next.bottom - next.height;
      return [key, next];
    })
  );
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
      style: { stroke: '#7b1fa2', fill: '#7b1fa2', fillOpacity: 0, strokeWidth: 2 },
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
