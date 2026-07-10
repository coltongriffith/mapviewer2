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

// ── Copper Butte (fictional Arizona porphyry project) ───────────────────────
// Small inline dataset for the copper_butte demo: three adjacent claim blocks,
// five collars, an access road, and a powerline in the Sonoran desert SW of
// Phoenix. Kept tiny on purpose — it only needs to look credible at map scale.

const cbPoly = (name, coords) => ({
  type: 'Feature',
  properties: { ClaimID: name, Owner: 'Copper Butte Mining Corp.' },
  geometry: { type: 'Polygon', coordinates: [coords] },
});

const copperClaims = {
  type: 'FeatureCollection',
  features: [
    cbPoly('CB-1', [
      [-112.660, 33.070], [-112.630, 33.070], [-112.630, 33.096],
      [-112.660, 33.096], [-112.660, 33.070],
    ]),
    cbPoly('CB-2', [
      [-112.630, 33.070], [-112.600, 33.070], [-112.600, 33.096],
      [-112.630, 33.096], [-112.630, 33.070],
    ]),
    cbPoly('CB-3', [
      [-112.646, 33.096], [-112.610, 33.096], [-112.610, 33.119],
      [-112.646, 33.119], [-112.646, 33.096],
    ]),
  ],
};

const copperCollars = {
  type: 'FeatureCollection',
  features: [
    { id: 'CB-24-01', c: [-112.641, 33.083], r: '288 m @ 0.44% Cu' },
    { id: 'CB-24-02', c: [-112.622, 33.088], r: '196 m @ 0.38% Cu' },
    { id: 'CB-24-03', c: [-112.633, 33.094], r: '412 m @ 0.61% Cu' },
    { id: 'CB-24-04', c: [-112.628, 33.104], r: '154 m @ 0.29% Cu' },
    { id: 'CB-24-05', c: [-112.615, 33.078], r: '233 m @ 0.51% Cu' },
  ].map((h) => ({
    type: 'Feature',
    properties: { HoleID: h.id, result: h.r, Status: 'Complete' },
    geometry: { type: 'Point', coordinates: h.c },
  })),
};

const copperRoads = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { Name: 'Mine Access Road', Type: 'Road' },
      geometry: { type: 'LineString', coordinates: [
        [-112.695, 33.052], [-112.672, 33.061], [-112.655, 33.074], [-112.641, 33.083],
      ] } },
    { type: 'Feature', properties: { Name: 'Powerline Corridor', Type: 'Powerline' },
      geometry: { type: 'LineString', coordinates: [
        [-112.700, 33.108], [-112.668, 33.104], [-112.640, 33.100], [-112.606, 33.092],
      ] } },
  ],
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

  // Regional Context — property location in the district: zoomed out so the
  // claim block reads as a small feature within a wider district, with the
  // district road network for context.
  regional: {
    title: TITLE, subtitle: 'Regional Location',
    layout: brand({ basemap: 'terrain', mode: 'project_overview', compositionPreset: 'regional',
      footerEnabled: true, footerText: FOOTER, insetTitle: 'Province', zoomPadFrac: 1.3,
      exportSettings: { filename: 'cedar-ridge-regional', pixelRatio: 2 } }),
    layers: [
      { data: auroraRoads, name: 'District Roads.geojson', role: 'roads_access', displayName: 'District Roads',
        style: { stroke: '#7a6a4a', strokeWidth: 2 }, legend: { enabled: true, label: 'District Roads' } },
      claimsLayer({ stroke: TEAL_DARK, fill: TEAL, fillOpacity: 0.35, strokeWidth: 2.5 }, 'Cedar Ridge Property'),
    ],
    callouts: [{
      text: 'Cedar Ridge Property', subtext: 'Claim Block', type: 'leader', priority: 1,
      anchor: { lat: 55.45, lng: -127.2 }, offset: { x: 130, y: -90 }, boxWidth: 170,
      style: { background: '#ffffff', border: '#0b3533', textColor: '#0b3533', subtextColor: '#13554f', fontSize: 13, paddingX: 12, paddingY: 9 },
    }],
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

  // Minimal Technical — the SAME Cedar Ridge data as the demos above, restyled
  // with the minimal_tech theme. Exists to teach that theme choice transforms
  // a map as much as the data does. Deliberately no brand color overrides:
  // titleBgColor/accentColor would beat the theme tokens (App.jsx themeTokens
  // memo), so the theme must supply every panel/title color itself.
  aurora_minimal: {
    title: TITLE, subtitle: 'Technical Figure — Minimal Style',
    layout: {
      themeId: 'minimal_tech',
      templateId: 'technical_results_v2',
      basemap: 'light', mode: 'drill_plan', footerEnabled: true, footerText: FOOTER,
      insetEnabled: true, insetMode: 'province_state', insetTitle: 'Location',
      legendTitle: 'Legend', northArrowStyle: 'arrow', cornerRadius: 0,
      exportSettings: { filename: 'cedar-ridge-minimal', pixelRatio: 2 },
    },
    layers: [
      claimsLayer({ stroke: '#334155', fill: '#94a3b8', fillOpacity: 0.14, strokeWidth: 1.5 }, 'Mineral Claims'),
      { data: auroraTargets, name: 'Target Areas.geojson', role: 'target_areas', displayName: 'Target Areas',
        style: { stroke: '#3b82f6', fill: '#3b82f6', fillOpacity: 0, strokeWidth: 1.5, dashArray: '6 5' },
        legend: { enabled: true, label: 'Target Areas' } },
      { data: auroraDrillholes, name: 'Drill Collars.geojson', role: 'drillholes', displayName: 'Drill Collars',
        style: { markerColor: '#111827', markerFill: '#ffffff', markerSize: 9 },
        legend: { enabled: true, label: 'Drill Collars' } },
    ],
    callouts: null,
  },

  // Copper Butte — a different project entirely: fictional porphyry-copper
  // property in the Arizona desert, side-panel template, bold_modern theme.
  // Breaks the Cedar Ridge monopoly so the gallery proves the tool handles
  // other geographies, commodities, and layouts. logo: null drops the Aurora
  // logo that loadGalleryDemo applies by default — wrong brand here.
  copper_butte: {
    title: 'Copper Butte Project', subtitle: 'Porphyry Copper — Arizona, USA',
    layout: {
      themeId: 'bold_modern',
      templateId: 'side_panel',
      // side_panel needs its grid defaults when set via layout (mirrors the
      // template-picker onChange in App.jsx).
      sidePanelPositions: {},
      sidePanelGrid: ['inset', 'legend', 'logo', 'title', 'footer'],
      insetHeightPx: null, legendHeightPx: null, titleHeightPx: 108,
      logo: null,
      basemap: 'satellite', mode: 'project_overview',
      footerEnabled: true, footerText: 'Copper Butte Mining Corp. | Maricopa County, Arizona',
      insetEnabled: true, insetMode: 'province_state', insetTitle: 'Location',
      legendTitle: 'Legend', northArrowStyle: 'arrow',
      exportSettings: { filename: 'copper-butte-overview', pixelRatio: 2 },
    },
    layers: [
      { data: copperClaims, name: 'Claims.geojson', role: 'claims', displayName: 'Unpatented Claims',
        style: { stroke: '#fbbf24', fill: '#b45309', fillOpacity: 0.32, strokeWidth: 2 },
        legend: { enabled: true, label: 'Unpatented Claims' } },
      { data: copperRoads, name: 'Access.geojson', role: 'roads_access', displayName: 'Access',
        style: { stroke: '#e2e8f0', strokeWidth: 2.5, byType: { Powerline: { stroke: '#2dd4bf', strokeWidth: 2, dashArray: '2 5' } } },
        legend: { enabled: true, label: 'Access Road', extra: [{ label: 'Powerline', stroke: '#2dd4bf', dashArray: '2 5' }] } },
      { data: copperCollars, name: 'Drill Collars.geojson', role: 'drillholes', displayName: 'Drill Collars',
        style: { markerColor: '#fbbf24', markerFill: '#1c1917', markerSize: 11 },
        legend: { enabled: true, label: 'Drill Collars' } },
    ],
    callouts: [{
      text: 'CB-24-03: 412 m @ 0.61% Cu', subtext: 'incl. 88 m @ 1.04% Cu', type: 'leader', priority: 1,
      anchor: { lat: 33.094, lng: -112.633 }, offset: { x: 120, y: -85 }, boxWidth: 190,
      style: { background: '#090b0f', border: '#2dd4bf', textColor: '#f8fafc', subtextColor: '#5eead4', fontSize: 13, paddingX: 12, paddingY: 9 },
    }],
  },
};
