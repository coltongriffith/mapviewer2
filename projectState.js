export const LAYER_ROLES = [
  "claims",
  "anomaly",
  "drillholes",
  "drill_traces",
  "geophysics",
  "highlight_zone",
  "other",
];

export const ROLE_LABELS = {
  claims: "Claims",
  anomaly: "Anomaly",
  drillholes: "Drillholes",
  drill_traces: "Drill traces",
  geophysics: "Geophysics",
  highlight_zone: "Highlight zone",
  other: "Other",
};

export function createInitialProjectState() {
  return {
    template: "technical_results_v1",
    layers: [],
    layout: {
      title: "Technical Results Map",
      subtitle: "Exploration Figure",
      logo: null,
      insetEnabled: true,
      basemap: "topo",
      legendItems: [],
    },
    annotations: {
      callouts: [],
    },
    exportSettings: {
      filename: "map-export",
      pixelRatio: 3,
    },
  };
}
