/**
 * Goldridge Property — demonstration project.
 *
 * A compact, self-contained exploration map showing mineral claims polygons
 * and drillhole point data in northern British Columbia (~55°N, 128°W).
 * Used as the built-in demo when no project is loaded.
 */

const CLAIMS_ID = 'demo-layer-claims';
const DRILLS_ID = 'demo-layer-drills';

const claimsGeoJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'GR-C01', tenure: 'BC-2441234', area_ha: 412 },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-128.10, 55.12], [-127.92, 55.12], [-127.92, 55.22], [-128.10, 55.22], [-128.10, 55.12],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'GR-C02', tenure: 'BC-2441235', area_ha: 280 },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-127.92, 55.10], [-127.76, 55.10], [-127.76, 55.20], [-127.92, 55.20], [-127.92, 55.10],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'GR-C03', tenure: 'BC-2441240', area_ha: 196 },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-128.10, 54.98], [-127.90, 54.98], [-127.90, 55.11], [-128.10, 55.11], [-128.10, 54.98],
        ]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'GR-C04 — Target Zone', tenure: 'BC-2441252', area_ha: 88 },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-127.88, 55.13], [-127.78, 55.13], [-127.78, 55.19], [-127.88, 55.19], [-127.88, 55.13],
        ]],
      },
    },
  ],
};

const drillholesGeoJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'GR-001', depth: 142, au_gpt: 2.4, status: 'completed' },
      geometry: { type: 'Point', coordinates: [-128.03, 55.17] },
    },
    {
      type: 'Feature',
      properties: { name: 'GR-002', depth: 188, au_gpt: 4.7, status: 'completed' },
      geometry: { type: 'Point', coordinates: [-127.99, 55.15] },
    },
    {
      type: 'Feature',
      properties: { name: 'GR-003', depth: 210, au_gpt: 1.1, status: 'completed' },
      geometry: { type: 'Point', coordinates: [-127.96, 55.18] },
    },
    {
      type: 'Feature',
      properties: { name: 'GR-004', depth: 164, au_gpt: 6.2, status: 'completed' },
      geometry: { type: 'Point', coordinates: [-127.83, 55.16] },
    },
    {
      type: 'Feature',
      properties: { name: 'GR-005', depth: 96, au_gpt: 3.8, status: 'completed' },
      geometry: { type: 'Point', coordinates: [-127.85, 55.14] },
    },
    {
      type: 'Feature',
      properties: { name: 'GR-006', depth: 0, au_gpt: null, status: 'planned' },
      geometry: { type: 'Point', coordinates: [-127.81, 55.17] },
    },
  ],
};

export const demoProject = {
  layers: [
    {
      id: CLAIMS_ID,
      name: 'Goldridge_Claims',
      sourceName: 'goldridge_claims.geojson',
      displayName: 'Mineral Claims',
      type: 'geojson',
      visible: true,
      role: 'claims',
      geojson: claimsGeoJSON,
      userStyled: false,
      style: {
        stroke: '#2563eb',
        fill: '#3b82f6',
        fillOpacity: 0.18,
        strokeWidth: 2,
      },
      legend: { enabled: true, label: 'Mineral Claims' },
    },
    {
      id: DRILLS_ID,
      name: 'Goldridge_Drillholes',
      sourceName: 'goldridge_drillholes.geojson',
      displayName: 'Drillholes',
      type: 'points',
      visible: true,
      role: 'drillholes',
      geojson: drillholesGeoJSON,
      userStyled: false,
      style: {
        markerColor: '#111111',
        markerFill: '#ffffff',
        markerSize: 10,
        strokeWidth: 1.5,
      },
      legend: { enabled: true, label: 'Drillholes' },
    },
  ],
  layout: {
    title: 'Goldridge Property',
    subtitle: 'Mineral Claims & Drill Results — Northern BC',
    basemap: 'light',
    templateId: 'technical_results_v2',
    themeId: 'modern_rounded',
    mode: 'drill_plan',
    compositionPreset: 'balanced',
    insetMode: 'province_state',
    insetEnabled: true,
    insetSize: 'medium',
    primaryLayerId: CLAIMS_ID,
    frameVersion: 1,
    logo: null,
    logoScale: 1,
    insetImage: null,
    legendItems: [],
    legendMode: 'auto',
    titleWidth: 'standard',
    footerText: 'Demo data only — not for investment purposes.',
    footerEnabled: true,
    referenceOverlays: { context: false, labels: true, rail: false },
    referenceOpacity: 0.65,
    zoomPercent: 100,
    safeMargins: { top: 18, right: 18, bottom: 18, left: 18 },
    markerDefaults: { type: 'circle', color: '#d97706', size: 18, label: '' },
    zoneDefaults: { width: 90, height: 56, rotation: -18, color: '#dc2626', dashed: true, label: '' },
    fonts: { title: 'Inter', legend: 'Inter', callout: 'Inter', label: 'Inter', footer: 'Inter' },
    exportSettings: { pixelRatio: 2, filename: 'goldridge-demo' },
  },
  callouts: [
    {
      id: 'demo-callout-1',
      text: 'GR-004: 6.2 g/t Au',
      subtext: '164m depth — high-grade intercept',
      type: 'leader',
      priority: 1,
      anchor: [-127.83, 55.16],
      offset: { x: 40, y: -30 },
      featureId: null,
      layerId: DRILLS_ID,
      style: {},
      boxWidth: 188,
      isManualPosition: false,
    },
    {
      id: 'demo-callout-2',
      text: 'Target Zone C04',
      subtext: 'Priority drill target for 2025 program',
      type: 'boxed',
      priority: 1,
      anchor: [-127.83, 55.16],
      offset: { x: 40, y: 30 },
      featureId: null,
      layerId: CLAIMS_ID,
      style: {},
      boxWidth: 188,
      isManualPosition: false,
    },
  ],
  markers: [],
  ellipses: [
    {
      id: 'demo-ellipse-1',
      center: [-127.83, 55.16],
      width: 110,
      height: 70,
      rotation: -12,
      color: '#dc2626',
      dashed: true,
      label: 'Target',
    },
  ],
};
