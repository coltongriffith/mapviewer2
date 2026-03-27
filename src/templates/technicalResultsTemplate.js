import { ROLE_LABELS } from '../projectState';

export const technicalResultsTemplate = {
  id: 'technical_results_v2',
  label: 'Technical Results v2',
  frame: {
    margin: 18,
    panelRadius: 12,
  },
  zones: {
    title: { top: 18, left: 18, width: 470, height: 88 },
    legend: { top: 122, left: 18, width: 292, height: 236 },
    northArrow: { top: 18, right: 18, width: 76, height: 104 },
    inset: { top: 142, right: 18, width: 228, height: 184 },
    scaleBar: { bottom: 18, left: 18, width: 230, height: 64 },
    footer: { bottom: 18, left: 268, width: 420, height: 42 },
    logo: { bottom: 18, right: 18, width: 170, height: 80 },
  },
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
    },
    regional_claims: {
      basemap: 'light',
      insetMode: 'country',
      framing: 'regional',
      visibleRoles: ['claims', 'roads_access', 'rivers_water', 'labels'],
    },
    drill_plan: {
      basemap: 'light',
      insetMode: 'secondary_zoom',
      framing: 'tight',
      visibleRoles: ['claims', 'drillholes', 'target_areas', 'roads_access'],
    },
    target_anomaly: {
      basemap: 'satellite',
      insetMode: 'regional_district',
      framing: 'tight',
      visibleRoles: ['claims', 'target_areas', 'anomalies', 'faults_structures', 'drillholes'],
    },
    access_location: {
      basemap: 'topo',
      insetMode: 'country',
      framing: 'regional',
      visibleRoles: ['claims', 'roads_access', 'rivers_water', 'labels'],
    },
  },
};

export function buildLegendItems(template, layers) {
  const visible = layers.filter((layer) => layer.visible !== false && layer.legend?.enabled !== false);
  const byRole = new Map((template.roleOrder || []).map((role, idx) => [role, idx]));

  return visible
    .slice()
    .sort((a, b) => (byRole.get(a.role) ?? 999) - (byRole.get(b.role) ?? 999))
    .map((layer) => ({
      id: layer.id,
      role: layer.role,
      label: layer.displayName || layer.legend?.label || layer.name || ROLE_LABELS[layer.role] || 'Layer',
      type: layer.type,
      style: {
        ...(template.roleStyles?.[layer.role] || template.roleStyles?.other || {}),
        ...(layer.style || {}),
      },
    }));
}
