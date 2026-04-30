export const ROLE_LABELS = {
  claims: 'Claims',
  drillholes: 'Drillholes',
  target_areas: 'Target Areas',
  anomalies: 'Anomalies',
  faults_structures: 'Faults / Structures',
  roads_access: 'Roads / Access',
  rivers_water: 'Rivers / Water',
  labels: 'Labels',
};

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
  custom_image: 'Uploaded Inset',
};

export const CALLOUT_TYPES = {
  plain: 'Plain Label',
  leader: 'Leader Label',
  boxed: 'Boxed Annotation',
  badge: 'Badge Label',
};


export const TEMPLATE_THEMES = {
  investor_clean:      'Investor — Navy & White',
  technical_sharp:     'Technical — Sharp Borders',
  modern_dark:         'Modern — Dark Indigo',
  warm_terrain:        'Terrain — Earthy & Warm',
  midnight_blueprint:  'Blueprint — Midnight Cyan',
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
      titleSize: 'standard',
      legendWidth: 'standard',
      exportSettings: {
        pixelRatio: 2,
        filename: 'mapviewer-export',
      },
    },
    callouts: [],
    markers: [],
    ellipses: [],
    ratioMapStates: {},
  };
}
