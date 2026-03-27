import { ROLE_LABELS } from "../projectState";

export const technicalResultsTemplate = {
  id: "technical_results_v1",
  label: "Technical Results v1",
  zones: {
    title: { top: 18, left: 18, width: 440 },
    northArrow: { top: 128, left: 18 },
    inset: { top: 18, right: 18, width: 230, height: 180 },
    legend: { bottom: 18, left: 18, width: 280 },
    scaleBar: { bottom: 18, left: "50%", transform: "translateX(-50%)" },
    logo: { bottom: 18, right: 18, width: 180, height: 84 },
    calloutBounds: { top: 80, right: 20, bottom: 120, left: 20 },
  },
  roleOrder: [
    "claims",
    "highlight_zone",
    "anomaly",
    "geophysics",
    "drill_traces",
    "drillholes",
    "other",
  ],
  roleStyles: {
    claims: {
      stroke: "#222",
      fill: "#c7c7c7",
      fillOpacity: 0.02,
      strokeWidth: 2,
      dashArray: "",
    },
    anomaly: {
      stroke: "#0f5772",
      fill: "#2fabc8",
      fillOpacity: 0.28,
      strokeWidth: 2,
      dashArray: "",
    },
    drillholes: {
      markerColor: "#111111",
      markerFill: "#f5f5f5",
      markerSize: 6,
      strokeWidth: 1.5,
    },
    drill_traces: {
      stroke: "#2d2d2d",
      fill: "#2d2d2d",
      fillOpacity: 0,
      strokeWidth: 1.5,
      dashArray: "4 3",
    },
    geophysics: {
      stroke: "#4d677f",
      fill: "#98b1c9",
      fillOpacity: 0.24,
      strokeWidth: 1.2,
      dashArray: "",
    },
    highlight_zone: {
      stroke: "#4e237a",
      fill: "#8652bf",
      fillOpacity: 0.24,
      strokeWidth: 2,
      dashArray: "",
    },
    other: {
      stroke: "#3957aa",
      fill: "#72a0ff",
      fillOpacity: 0.2,
      strokeWidth: 2,
      dashArray: "",
    },
  },
  calloutStyle: {
    background: "rgba(255,255,255,0.95)",
    border: "1px solid #1f1f1f",
    text: "#111111",
    accent: "#145f97",
  },
};

export function buildLegendItems(template, layers) {
  const visible = layers.filter((layer) => layer.visible !== false && layer.legendEnabled !== false);
  const byRole = new Map((template.roleOrder || []).map((role, idx) => [role, idx]));

  return visible
    .slice()
    .sort((a, b) => (byRole.get(a.role) ?? 999) - (byRole.get(b.role) ?? 999))
    .map((layer) => ({
      id: layer.id,
      role: layer.role,
      label: layer.legendLabel || layer.name || ROLE_LABELS[layer.role] || "Layer",
      type: layer.type,
      style: layer.style,
    }));
}
