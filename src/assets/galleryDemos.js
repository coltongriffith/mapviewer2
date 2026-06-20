/**
 * Per-style sample projects for the 6 landing-page gallery cards.
 *
 * Each card now loads a real, distinct demo built from the Cedar Ridge
 * ("Aurora Ridge Minerals") geometry — configured to match the map type the
 * card advertises — instead of all six loading the same generic data. This
 * mirrors how the before/after compare loads the full investor map.
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
} from './auroraDemo.js';

const TITLE = 'Cedar Ridge Project';
const DARK_TITLE_BG = '#0b1f3a';

export const GALLERY_DEMOS = {
  // Drill Results — collars & intercepts on satellite imagery
  drill_plan: {
    title: TITLE,
    subtitle: 'Drill Results — 2024 Program',
    layout: {
      basemap: 'satellite', mode: 'drill_plan', accentColor: '#2563eb',
      titleBgColor: DARK_TITLE_BG, titleFgColor: '#ffffff',
      insetEnabled: true, insetMode: 'province_state', insetTitle: 'Location Map',
      footerEnabled: false, northArrowStyle: 'arrow', cornerRadius: 10,
      exportSettings: { filename: 'cedar-ridge-drill-results', pixelRatio: 2 },
    },
    layers: [
      { data: auroraClaims, name: 'Claims.geojson', role: 'claims', displayName: 'Claims',
        style: { stroke: '#cfe0ff', fill: '#1d4ed8', fillOpacity: 0.18, strokeWidth: 2, dissolve: true },
        legend: { enabled: true, label: 'Claims' } },
      { data: auroraDrillholes, name: 'Drill Collars.geojson', role: 'drillholes', displayName: 'Drill Collars',
        style: { markerColor: '#0b1f3a', markerFill: '#ffffff', markerSize: 12 },
        legend: { enabled: true, label: 'Drill Collars' } },
    ],
    callouts: auroraCallouts,
  },

  // Claims Package — land position on a clean light basemap
  claims: {
    title: TITLE,
    subtitle: 'Claims & Land Position',
    layout: {
      basemap: 'light', mode: 'regional_claims', accentColor: '#16a34a',
      titleBgColor: null, titleFgColor: null,
      insetEnabled: true, insetMode: 'province_state', insetTitle: 'Land Position',
      footerEnabled: true, northArrowStyle: 'classic', cornerRadius: 8,
      exportSettings: { filename: 'cedar-ridge-claims', pixelRatio: 2 },
    },
    layers: [
      { data: auroraClaims, name: 'Claims.geojson', role: 'claims', displayName: 'Mineral Claims',
        style: { stroke: '#15803d', fill: '#16a34a', fillOpacity: 0.16, strokeWidth: 2.5, dissolve: true },
        legend: { enabled: true, label: 'Mineral Claims' } },
    ],
    callouts: null,
  },

  // Target Generation — priority anomaly zones over the claim block
  target: {
    title: TITLE,
    subtitle: 'Target Generation',
    layout: {
      basemap: 'light', mode: 'target_anomaly', accentColor: '#dc2626',
      titleBgColor: null, titleFgColor: null,
      insetEnabled: true, insetMode: 'province_state', insetTitle: 'Location Map',
      footerEnabled: true, northArrowStyle: 'classic', cornerRadius: 8,
      exportSettings: { filename: 'cedar-ridge-targets', pixelRatio: 2 },
    },
    layers: [
      { data: auroraClaims, name: 'Claims.geojson', role: 'claims', displayName: 'Claims',
        style: { stroke: '#94a3b8', fill: '#cbd5e1', fillOpacity: 0.18, strokeWidth: 1.5, dissolve: true },
        legend: { enabled: true, label: 'Claims' } },
      { data: auroraTargets, name: 'Target Areas.geojson', role: 'target_areas', displayName: 'Target Areas',
        style: { stroke: '#dc2626', fill: '#dc2626', fillOpacity: 0.12, strokeWidth: 2.5, dashArray: '8 6' },
        legend: { enabled: true, label: 'Priority Targets' } },
      { data: auroraDrillholes, name: 'Drill Collars.geojson', role: 'drillholes', displayName: 'Drill Collars',
        style: { markerColor: '#7f1d1d', markerFill: '#ffffff', markerSize: 9 },
        legend: { enabled: true, label: 'Drill Collars' } },
    ],
    callouts: auroraCallouts,
  },

  // Regional Context — property location in the district on terrain
  regional: {
    title: TITLE,
    subtitle: 'Regional Location',
    layout: {
      basemap: 'terrain', mode: 'project_overview', accentColor: '#b87333',
      titleBgColor: null, titleFgColor: null,
      insetEnabled: true, insetMode: 'province_state', insetTitle: 'Province',
      compositionPreset: 'regional', footerEnabled: true, northArrowStyle: 'classic', cornerRadius: 8,
      exportSettings: { filename: 'cedar-ridge-regional', pixelRatio: 2 },
    },
    layers: [
      { data: auroraClaims, name: 'Claims.geojson', role: 'claims', displayName: 'Property',
        style: { stroke: '#b87333', fill: '#b87333', fillOpacity: 0.15, strokeWidth: 2.5, dissolve: true },
        legend: { enabled: true, label: 'Cedar Ridge Property' } },
    ],
    callouts: null,
  },

  // Infrastructure — access roads & power corridor
  infrastructure: {
    title: TITLE,
    subtitle: 'Access & Infrastructure',
    layout: {
      basemap: 'light', mode: 'access_location', accentColor: '#7c3aed',
      titleBgColor: null, titleFgColor: null,
      insetEnabled: true, insetMode: 'province_state', insetTitle: 'Location Map',
      footerEnabled: true, northArrowStyle: 'classic', cornerRadius: 8,
      exportSettings: { filename: 'cedar-ridge-infrastructure', pixelRatio: 2 },
    },
    layers: [
      { data: auroraClaims, name: 'Claims.geojson', role: 'claims', displayName: 'Claims',
        style: { stroke: '#7c3aed', fill: '#7c3aed', fillOpacity: 0.10, strokeWidth: 1.5, dissolve: true },
        legend: { enabled: true, label: 'Claims' } },
      { data: auroraRoads, name: 'Access Roads.geojson', role: 'roads_access', displayName: 'Access & Power',
        style: { stroke: '#7c3aed', strokeWidth: 3, dashArray: '2 0' },
        legend: { enabled: true, label: 'Access & Power' } },
      { data: auroraDrillholes, name: 'Drill Collars.geojson', role: 'drillholes', displayName: 'Drill Collars',
        style: { markerColor: '#4c1d95', markerFill: '#ffffff', markerSize: 8 },
        legend: { enabled: true, label: 'Drill Collars' } },
    ],
    callouts: null,
  },

  // Dark Satellite — high-contrast full investor view on imagery
  dark: {
    title: TITLE,
    subtitle: 'Satellite Overview',
    layout: {
      basemap: 'satellite', mode: 'project_overview', accentColor: '#38bdf8',
      titleBgColor: DARK_TITLE_BG, titleFgColor: '#ffffff',
      insetEnabled: true, insetMode: 'province_state', insetTitle: 'Location Map',
      footerEnabled: false, northArrowStyle: 'arrow', cornerRadius: 10,
      exportSettings: { filename: 'cedar-ridge-satellite', pixelRatio: 2 },
    },
    layers: [
      { data: auroraClaims, name: 'Claims.geojson', role: 'claims', displayName: 'Claims',
        style: { stroke: '#ffffff', fill: '#38bdf8', fillOpacity: 0.20, strokeWidth: 2.5, dissolve: true },
        legend: { enabled: true, label: 'Claims' } },
      { data: auroraTargets, name: 'Target Areas.geojson', role: 'target_areas', displayName: 'Target Areas',
        style: { stroke: '#fde047', fill: '#fde047', fillOpacity: 0, strokeWidth: 2.5, dashArray: '8 6' },
        legend: { enabled: true, label: 'Target Areas' } },
      { data: auroraDrillholes, name: 'Drill Collars.geojson', role: 'drillholes', displayName: 'Drill Collars',
        style: { markerColor: '#0b1f3a', markerFill: '#38bdf8', markerSize: 11 },
        legend: { enabled: true, label: 'Drill Collars' } },
    ],
    callouts: auroraCallouts,
  },
};
