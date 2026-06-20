/**
 * Per-style sample projects for the 6 landing-page gallery cards.
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
  cornerRadius: 10,
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

  // Target Generation — priority anomaly zones over the claim block
  target: {
    title: TITLE, subtitle: 'Target Generation',
    layout: brand({ basemap: 'light', mode: 'target_anomaly', footerEnabled: true, footerText: FOOTER,
      exportSettings: { filename: 'cedar-ridge-targets', pixelRatio: 2 } }),
    layers: [
      claimsLayer({ stroke: TEAL_DARK, fill: TEAL, fillOpacity: 0.18, strokeWidth: 1.5 }),
      targetsLayer(),
      collarsLayer(9),
    ],
    callouts: auroraCallouts,
  },

  // Regional Context — property location in the district on terrain
  regional: {
    title: TITLE, subtitle: 'Regional Location',
    layout: brand({ basemap: 'terrain', mode: 'project_overview', compositionPreset: 'regional',
      footerEnabled: true, footerText: FOOTER, insetTitle: 'Province',
      exportSettings: { filename: 'cedar-ridge-regional', pixelRatio: 2 } }),
    layers: [claimsLayer({ stroke: TEAL_DARK, fill: TEAL, fillOpacity: 0.28, strokeWidth: 2.5 }, 'Cedar Ridge Property')],
    callouts: null,
  },

  // Infrastructure — access roads & power corridor
  infrastructure: {
    title: TITLE, subtitle: 'Access & Infrastructure',
    layout: brand({ basemap: 'light', mode: 'access_location', footerEnabled: true, footerText: FOOTER,
      exportSettings: { filename: 'cedar-ridge-infrastructure', pixelRatio: 2 } }),
    layers: [
      claimsLayer({ stroke: TEAL_DARK, fill: TEAL, fillOpacity: 0.14, strokeWidth: 1.5 }),
      { data: auroraRoads, name: 'Access Roads.geojson', role: 'roads_access', displayName: 'Access & Power',
        style: { stroke: GOLD, strokeWidth: 3 }, legend: { enabled: true, label: 'Access & Power' } },
      collarsLayer(8),
    ],
    callouts: null,
  },

  // Dark Satellite — high-contrast full investor view on imagery
  dark: {
    title: TITLE, subtitle: 'Satellite Overview',
    layout: brand({ basemap: 'satellite', mode: 'project_overview', footerEnabled: false,
      exportSettings: { filename: 'cedar-ridge-satellite', pixelRatio: 2 } }),
    layers: [claimsLayer({ fillOpacity: 0.5 }), targetsLayer(), collarsLayer(11)],
    callouts: auroraCallouts,
  },
};
