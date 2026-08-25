export const ROLE_LABELS = {
  claims: 'Claims',
  drillholes: 'Drillholes',
  rock_samples: 'Rock Samples',
  soil_samples: 'Soil Samples',
  target_areas: 'Target Areas',
  anomalies: 'Anomalies',
  faults_structures: 'Faults / Structures',
  roads_access: 'Roads / Access',
  rivers_water: 'Rivers / Water',
  labels: 'Labels',
};

export const POINT_ROLES = new Set([
  'drillholes',
  'rock_samples',
  'soil_samples',
]);

export const TEMPLATE_MODES = {
  project_overview: 'Regional Location Map',
  regional_claims:  'Claims Map',
  drill_plan:       'Drill Results Map',
  target_anomaly:   'Target Generation Map',
  access_location:  'Infrastructure Map',
};

export const COMPOSITION_PRESETS = {
  tight: 'Tight',
  balanced: 'Balanced',
  regional: 'Regional',
  access: 'Access',
};

export const INSET_MODES = {
  province_state: 'Province / State',
  country: 'Country',
  regional_district: 'Regional',
  secondary_zoom: 'Secondary Zoom',
  satellite_locator: 'Satellite Locator',
  custom_image: 'Uploaded Inset',
};

export const CALLOUT_TYPES = {
  plain: 'Plain Label',
  leader: 'Leader Label',
  boxed: 'Boxed Annotation',
  badge: 'Badge Label',
};


/**
 * The one decision a user actually makes about a map.
 *
 * Template, mode and design theme were three separate selectors describing
 * overlapping things; picking a map type sets all three at once. Every value
 * below is an id that already existed, so a project saved through this
 * selector is indistinguishable from one saved through the individual
 * controls — which remain available under Customize design.
 */
export const MAP_TYPES = {
  investor: {
    label: 'Investor / presentation map',
    note: 'Property in district context for decks and news releases.',
    templateId: 'technical_results_v2', mode: 'project_overview', themeId: 'investor_clean',
  },
  claims: {
    label: 'Claims and tenure map',
    note: 'Claim blocks and ownership over regional context.',
    templateId: 'technical_results_v2', mode: 'regional_claims', themeId: 'investor_clean',
  },
  drill: {
    label: 'Drill results map',
    note: 'Collars and intercepts with a technical data rail.',
    templateId: 'side_panel', mode: 'drill_plan', themeId: 'technical_sharp',
  },
  infrastructure: {
    label: 'Infrastructure and access map',
    note: 'Roads, rail, power and the route to the property.',
    templateId: 'technical_results_v2', mode: 'access_location', themeId: 'investor_clean',
  },
  ni_43101: {
    label: 'NI 43-101 figure',
    note: 'Coordinate frame and technical title block for a report.',
    templateId: 'ni_43101_technical', mode: 'project_overview', themeId: 'ni_43101',
  },
};

/** Which map type a stored layout corresponds to, or 'custom' if none. */
export function mapTypeOf(layout) {
  const templateId = layout?.templateId || 'technical_results_v2';
  const themeId = layout?.themeId || 'investor_clean';
  const mode = layout?.mode || 'project_overview';
  const hit = Object.entries(MAP_TYPES).find(([, t]) =>
    t.templateId === templateId && t.mode === mode && t.themeId === themeId);
  return hit ? hit[0] : 'custom';
}

export const TEMPLATE_THEMES = {
  investor_clean:  'Clean',
  technical_sharp: 'Technical',
  modern_dark:     'Dark',
  warm_terrain:    'Warm',
};

export const FONT_OPTIONS = {
  Inter: 'Inter',
  Roboto: 'Roboto',
  'Open Sans': 'Open Sans',
  Montserrat: 'Montserrat',
  Lato: 'Lato',
};

export function createInitialProjectState() {
  return {
    layers: [],
    layout: {
      title: 'Project Map',
      subtitle: 'Technical Results',
      basemap: 'light',
      blankBg: '#ffffff',
      templateId: 'technical_results_v2',
      themeId: 'investor_clean',
      mode: 'project_overview',
      compositionPreset: 'balanced',
      insetMode: 'province_state',
      insetEnabled: true,
      insetSize: 'medium',
      primaryLayerId: null,
      frameVersion: 0,
      logo: null,
      logoScale: 1,
      insetImage: null,
      autoInsetRegion: null,
      insetTitle: 'Project Locator',
      insetLabel: '',
      legendItems: [],
      legendMode: 'auto',
      titleWidth: 'standard',
      footerText: '',
      footerEnabled: true,
      showNorthArrow: true,
      showScaleBar: true,
      regionHighlights: [],
      legendTitle: 'Legend',
      mapDate: '',
      projectNumber: '',
      mapScaleNote: '',
      referenceOverlays: {
        context: false,
        labels: false,
        rail: false,
      },
      referenceOpacity: 0.65,
      zoomPercent: 100,
      zoomDelta: 0,
      accentColor: null,
      titleBgColor: null,
      titleFgColor: null,
      panelBgColor: null,
      panelFgColor: null,
      logoCorner: 'tl',
      legendCorner: 'bl',
      insetCorner: 'tr',
      titleCorner: 'tl',
      scaleBarCorner: 'bl',
      northArrowCorner: 'br',
      cornerOrder: ['title', 'logo', 'inset', 'northArrow', 'scaleBar', 'legend'],
      cornerLayout: null,
      sidePanelPositions: {},
      sidePanelOrder: ['logo', 'title', 'legend', 'inset'],
      sidePanelGrid: ['logo', 'title', 'legend', 'inset', 'footer'],
      scaleBarHeightPx: 48,
      insetRegionFill: null,
      insetRegionStroke: null,
      insetBgFill: null,
      insetMarkerColor: null,
      northArrowHeightPx: 100,
      northArrowStyle: 'classic',
      // The compass and the scale bar read fine straight on the map. Boxing
      // them turns two small marks into two more floating cards; the panel is
      // still one checkbox away under Customize design → Panel boxes.
      northArrowTransparent: true,
      scaleBarTransparent: true,
      cornerRadius: null,
      insetAspectRatio: null,
      safeMargins: { top: 18, right: 18, bottom: 18, left: 18 },
      markerDefaults: { type: 'circle', color: '#d97706', size: 18, label: '' },
      zoneDefaults: { width: 90, height: 56, rotation: -18, color: '#dc2626', dashed: true, label: '' },
      fonts: {
        title: 'Inter',
        legend: 'Inter',
        callout: 'Inter',
        label: 'Inter',
        footer: 'Inter',
      },
      legendFontScale: 1,
      titleFontScale: 1,
      titleSize: 'standard',
      titleHeightPx: 92,
      titleWidthPx: 520,
      titleTransparent: false,
      legendWidth: 'standard',
      legendWidthPx: 300,
      legendHeightPx: null,
      legendTransparent: false,
      logoWidthPx: 168,
      logoHeightPx: 74,
      // The logo belongs to the title block, not to a box of its own: with the
      // two on one row, a panel around the mark is what made them read as two
      // unrelated cards. Reversible under Customize design → Panel boxes.
      logoTransparent: true,
      insetWidthPx: 244,
      insetHeightPx: 190,
      exportSettings: {
        pixelRatio: 2,
        filename: 'exploration-maps-export',
      },
    },
    callouts: [],
    markers: [],
    ellipses: [],
    polygons: [],
    distanceLines: [],
    ratioMapStates: {},
    mapView: null,
    // Nearby-claims overlay (province registry search by radius). Stored on the
    // project so it persists with saves/drafts like every other map element.
    areaClaims: null,
  };
}
