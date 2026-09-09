/**
 * Per-style sample projects for the landing-page gallery cards.
 *
 * Each card loads a real, distinct demo built from the Cedar Ridge
 * ("Aurora Ridge Minerals") geometry — configured to match the map type the
 * card advertises — instead of all six loading the same generic data. This
 * mirrors how the before/after compare loads the full investor map, and uses
 * the Aurora Ridge Minerals branding throughout for consistency.
 *
 * A recipe lists the layers to add (each referencing a real GeoJSON dataset,
 * with the role/styling/legend to apply), the callouts to place, and the
 * layout (basemap, mode, accent, title block, inset, etc.).
 */
import {
  auroraClaims,
  auroraDrillholes,
  auroraTargets,
  auroraCallouts,
  auroraRoads,
  auroraSoils,
  auroraGeology,
  auroraNeighbours,
  auroraTown,
  auroraHighway,
} from './auroraDemo.js';

// Aurora Ridge Minerals palette
const TEAL = '#117a68';        // claims fill
const TEAL_DARK = '#0b3533';   // title block / collar ring
const GOLD = '#c8a84b';        // accent
const TARGET_GOLD = '#d4a72c'; // target outlines
const TITLE = 'Cedar Ridge Project';
const FOOTER = 'Aurora Ridge Minerals Corp. | Cedar Ridge Project, BC';

// Brand defaults shared by every gallery demo.
const brand = (extra = {}) => ({
  accentColor: GOLD,
  titleBgColor: TEAL_DARK,
  titleFgColor: '#ffffff',
  insetEnabled: true,
  insetMode: 'province_state',
  insetTitle: 'Location Map',
  legendTitle: 'Legend',
  northArrowStyle: 'arrow',
  cornerRadius: 3,
  ...extra,
});

const claimsLayer = (style, label = 'Claims') => ({
  data: auroraClaims, name: 'Claims.geojson', role: 'claims', displayName: label,
  style: { stroke: '#ffffff', fill: TEAL, fillOpacity: 0.5, strokeWidth: 2.5, dissolve: true, ...style },
  legend: { enabled: true, label },
});
const collarsLayer = (size = 12) => ({
  data: auroraDrillholes, name: 'Drill Collars.geojson', role: 'drillholes', displayName: 'Drill Collars',
  style: { markerColor: TEAL_DARK, markerFill: '#ffffff', markerSize: size },
  legend: { enabled: true, label: 'Drill Collars' },
});
const targetsLayer = () => ({
  data: auroraTargets, name: 'Target Areas.geojson', role: 'target_areas', displayName: 'Target Areas',
  style: { stroke: TARGET_GOLD, fill: TARGET_GOLD, fillOpacity: 0, strokeWidth: 2.5, dashArray: '8 6' },
  legend: { enabled: true, label: 'Target Areas' },
});

const boxed = (text, subtext, anchor, offset, boxWidth = 168) => ({
  text, subtext, type: 'boxed', priority: 1, anchor, offset, boxWidth,
  style: { background: '#ffffff', border: TEAL_DARK, textColor: TEAL_DARK, subtextColor: '#13554f', fontSize: 13, paddingX: 12, paddingY: 9, arrowhead: true },
});
// The soil grid classed the way a geochemist reads it: four ranges, warmer
// and larger as copper climbs.
const soilsLayer = () => ({
  data: auroraSoils, name: 'Soil Samples.geojson', role: 'soil_samples', displayName: 'Soil Samples (Cu ppm)',
  style: { markerColor: '#7c2d12', markerFill: '#fde047', markerSize: 6, strokeWidth: 0.8 },
  legend: { enabled: true, label: 'Soil Samples (Cu ppm)', group: 'Geochemistry' },
  classification: {
    field: 'Cu_ppm', mode: 'graduated',
    classes: [
      { max: 50, color: '#fde047', size: 5, label: '' },
      { max: 100, color: '#f59e0b', size: 7, label: '' },
      { max: 200, color: '#ef4444', size: 9, label: '' },
      { max: null, color: '#7e22ce', size: 12, label: '' },
    ],
  },
});
const geologyLayer = () => ({
  data: auroraGeology, name: 'Bedrock Geology.geojson', role: 'other', displayName: 'Bedrock Geology',
  style: { stroke: '#4b5563', fillOpacity: 0.55, strokeWidth: 0.8 },
  legend: { enabled: true, label: 'Bedrock Geology', group: 'Geology' },
  classification: {
    field: 'Unit', mode: 'categorical',
    classes: [
      { value: 'Bowser Lake Group sediments', color: '#c7d2fe', size: 10, label: '' },
      { value: 'Hazelton Group volcanics', color: '#a7f3d0', size: 10, label: '' },
      { value: 'Stuhini Group volcaniclastics', color: '#fde68a', size: 10, label: '' },
      { value: 'Stikine assemblage', color: '#fbcfe8', size: 10, label: '' },
      { value: 'Granodiorite intrusion', color: '#fca5a5', size: 10, label: '' },
    ],
  },
});
// Untested strike to the southwest of Target C: the bracket a target map
// carries to say "there is more of this".
const strikeBracket = {
  p1: { lat: 55.4289, lng: -127.2364 }, p2: { lat: 55.4222, lng: -127.2586 },
  style: 'bracket', color: TEAL_DARK, units: 'km', label: 'Untested strike >1.5 km',
};

export const GALLERY_DEMOS = {
  // Drill Results — collars & intercepts on satellite imagery
  drill_plan: {
    title: TITLE, subtitle: 'Drill Results — 2024 Program',
    layout: brand({ basemap: 'satellite', mode: 'drill_plan', footerEnabled: false,
      exportSettings: { filename: 'cedar-ridge-drill-results', pixelRatio: 2 } }),
    layers: [claimsLayer({ fillOpacity: 0.42 }), collarsLayer(12)],
    callouts: auroraCallouts,
  },

  // Claims Package — land position on a clean light basemap
  claims: {
    title: TITLE, subtitle: 'Claims & Land Position',
    layout: brand({ basemap: 'light', mode: 'regional_claims', footerEnabled: true, footerText: FOOTER,
      insetTitle: 'Land Position', exportSettings: { filename: 'cedar-ridge-claims', pixelRatio: 2 } }),
    layers: [claimsLayer({ stroke: TEAL_DARK, fillOpacity: 0.3 }, 'Mineral Claims')],
    callouts: null,
  },

  // Target Generation — classed soil copper on hillshade, drill traces, a
  // UTM frame, grouped legend and boxed intercept callouts: the technical
  // target map from a results release.
  target: {
    title: TITLE, subtitle: 'Target Generation — Soil Geochemistry & Drilling',
    layout: brand({ basemap: 'hillshade', mode: 'target_anomaly', footerEnabled: true, footerText: FOOTER,
      showCoordinateFrame: true, showProjectionLabel: true, projectionName: 'NAD83 / UTM Zone 9N',
      legendGrouped: true, legendTitle: 'Legend',
      exportSettings: { filename: 'cedar-ridge-targets', pixelRatio: 2 } }),
    layers: [
      claimsLayer({ stroke: TEAL_DARK, fill: TEAL, fillOpacity: 0.1, strokeWidth: 1.6 }),
      soilsLayer(),
      targetsLayer(),
      collarsLayer(9),
    ],
    callouts: [
      boxed('Target A', 'CR-24-03: 14.0 m @ 2.36 g/t Au\nOpen along strike', { lat: 55.464373, lng: -127.241183 }, { x: -200, y: -150 }, 230),
      boxed('Target B', 'CR-24-07: 9.0 m @ 2.45 g/t Au\n22.5 m @ 0.61% Cu', { lat: 55.457186, lng: -127.161985 }, { x: 170, y: -90 }, 230),
      boxed('Target C', 'CR-24-11: 22.0 m @ 0.81% Cu\nUntested to the SW', { lat: 55.429339, lng: -127.214256 }, { x: 230, y: 70 }, 230),
    ],
    distanceLines: [strikeBracket],
  },

  // Bedrock Geology — one polygon file coloured by unit, the claims and
  // targets over it, on a light base with the UTM frame.
  geology: {
    title: TITLE, subtitle: 'Bedrock Geology & Target Areas',
    layout: brand({ basemap: 'light', mode: 'project_overview', footerEnabled: true, footerText: FOOTER,
      showCoordinateFrame: true, showProjectionLabel: true, projectionName: 'NAD83 / UTM Zone 9N',
      legendGrouped: true, legendTitle: 'Legend',
      exportSettings: { filename: 'cedar-ridge-geology', pixelRatio: 2 } }),
    layers: [
      claimsLayer({ stroke: TEAL_DARK, fill: TEAL, fillOpacity: 0, strokeWidth: 2.2 }, 'Claim Boundary'),
      geologyLayer(),
      targetsLayer(),
      collarsLayer(8),
    ],
    callouts: [
      boxed('Granodiorite stock', 'Cu-Au porphyry host\nunder Target B', { lat: 55.4599, lng: -127.168 }, { x: 140, y: -80 }, 180),
    ],
  },

  // Regional Context — the property small inside its district: neighbouring
  // operators' ground, the highway and town, district roads, with the frame
  // padded out past the claim block.
  regional: {
    title: TITLE, subtitle: 'Regional Location',
    layout: brand({ basemap: 'terrain', mode: 'project_overview', compositionPreset: 'regional',
      footerEnabled: true, footerText: FOOTER, insetTitle: 'Province', zoomPadFrac: 1.4, showHighwaysLegend: false,
      showCoordinateFrame: true, showProjectionLabel: true, projectionName: 'NAD83 / UTM Zone 9N',
      exportSettings: { filename: 'cedar-ridge-regional', pixelRatio: 2 } }),
    layers: [
      { data: auroraNeighbours, name: 'Neighbouring Claims.geojson', role: 'other', displayName: 'Neighbouring Claims',
        style: { stroke: '#6b7280', fill: '#9ca3af', fillOpacity: 0.22, strokeWidth: 1.5, dashArray: '6 4' },
        legend: { enabled: true, label: 'Neighbouring Claims' } },
      { data: auroraHighway, name: 'Highway.geojson', role: 'roads_access', displayName: 'Highway 16',
        style: { stroke: '#b91c1c', strokeWidth: 3.5 }, legend: { enabled: true, label: 'Highway 16' } },
      { data: auroraRoads, name: 'District Roads.geojson', role: 'roads_access', displayName: 'District Roads',
        style: { stroke: '#7a6a4a', strokeWidth: 2 }, legend: { enabled: true, label: 'District Roads' } },
      { data: auroraTown, name: 'Town.geojson', role: 'labels', displayName: 'Town',
        style: { markerColor: '#111827', markerFill: '#111827', markerSize: 9, markerShape: 'square' },
        legend: { enabled: true, label: 'Town' } },
      claimsLayer({ stroke: TEAL_DARK, fill: TEAL, fillOpacity: 0.55, strokeWidth: 2.5 }, 'Cedar Ridge Property'),
    ],
    callouts: [
      boxed('Cedar Ridge Property', 'Aurora Ridge Minerals\n2,940 ha, 100% owned', { lat: 55.4837, lng: -127.2 }, { x: -20, y: -110 }, 200),
      boxed('Kispiox Gold Property', 'Kispiox Gold Corp.', { lat: 55.4859, lng: -127.0654 }, { x: 40, y: -90 }, 190),
      boxed('Skeena West Claims', 'Skeena West Resources', { lat: 55.4073, lng: -127.3465 }, { x: -40, y: 110 }, 190),
      boxed('Bulkley Silver Property', 'Bulkley Silver Ltd.', { lat: 55.3647, lng: -127.1168 }, { x: -60, y: 100 }, 200),
      boxed('Hazelton', 'Highway 16 · 14 km by road', { lat: 55.3557, lng: -127.0496 }, { x: 120, y: 60 }, 190),
    ],
  },

  // Infrastructure — access roads vs. the separate power corridor, each
  // styled distinctly so the two line types in the description are
  // actually visually distinguishable, with a small in-image legend.
  infrastructure: {
    title: TITLE, subtitle: 'Access & Infrastructure',
    layout: brand({ basemap: 'light', mode: 'access_location', footerEnabled: true, footerText: FOOTER,
      exportSettings: { filename: 'cedar-ridge-infrastructure', pixelRatio: 2 } }),
    layers: [
      claimsLayer({ stroke: TEAL_DARK, fill: TEAL, fillOpacity: 0.14, strokeWidth: 1.5 }),
      { data: auroraRoads, name: 'Access Roads.geojson', role: 'roads_access', displayName: 'Access Roads',
        style: { stroke: GOLD, strokeWidth: 3, byType: { Powerline: { stroke: '#6b6f76', strokeWidth: 2.5, dashArray: '2 5' } } },
        legend: { enabled: true, label: 'Access Roads', extra: [{ label: 'Powerline Corridor', stroke: '#6b6f76', dashArray: '2 5' }] } },
      collarsLayer(8),
    ],
    callouts: null,
  },

  // Dark Satellite — the app's actual "Dark" basemap (near-black, high
  // contrast), not the regular daytime satellite imagery.
  dark: {
    title: TITLE, subtitle: 'Dark Basemap Overview',
    layout: brand({ basemap: 'dark', mode: 'project_overview', footerEnabled: false,
      exportSettings: { filename: 'cedar-ridge-dark', pixelRatio: 2 } }),
    layers: [claimsLayer({ fillOpacity: 0.5 }), targetsLayer(), collarsLayer(11)],
    callouts: auroraCallouts,
  },
};
