export const ROLE_LABELS = {
  claims: "Claims",
  highlight_zone: "Highlight Zone",
  anomaly: "Anomaly",
  geophysics: "Geophysics",
  drill_traces: "Drill Traces",
  drillholes: "Drillholes",
  other: "Other",
};

export function createInitialProjectState() {
  return {
    layers: [],
    layout: {
      title: "Project Map",
      subtitle: "Technical results template",
      basemap: "light",
      templateId: "technical_results_v1",
      logo: null,
      legendItems: [],
      exportSettings: {
        pixelRatio: 2,
        filename: "mapviewer-export",
      },
    },
  };
}
