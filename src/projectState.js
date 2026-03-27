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
  project_overview: 'Project Overview',
  regional_claims: 'Regional Claims',
  drill_plan: 'Drill Plan',
  target_anomaly: 'Target / Anomaly',
  access_location: 'Access / Location',
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
};

export function createInitialProjectState() {
  return {
    layers: [],
    layout: {
      title: 'Project Map',
      subtitle: 'Technical Results',
      basemap: 'light',
      templateId: 'technical_results_v2',
      mode: 'project_overview',
      insetMode: 'province_state',
      primaryLayerId: null,
      frameVersion: 0,
      logo: null,
      logoScale: 1,
      insetImage: null,
      legendItems: [],
      footerText: '',
      exportSettings: {
        pixelRatio: 2,
        filename: 'mapviewer-export',
      },
    },
    callouts: [],
  };
}
