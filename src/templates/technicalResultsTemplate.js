import { ROLE_LABELS } from "../projectState";

export const technicalResultsTemplate = {
  id: "technical_results_v1",
  label: "Technical Results v1",
  frame: {
    margin: 18,
    panelRadius: 10,
  },
  zones: {
    title: { top: 18, left: 18, width: 460, height: 88 },
    legend: { top: 122, left: 18, width: 280, height: 220 },
    northArrow: { top: 18, right: 18, left: null, width: 72, height: 104 },
    scaleBar: { bottom: 18, left: 18, top: null, width: 220, height: 64 },
    logo: { bottom: 18, right: 18, left: null, top: null, width: 170, height: 80 },
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
      stroke: "#111827",
      fill: "#cfd6e4",
      fillOpacity: 0.08,
      strokeWidth: 2.2,
      dashArray: "",
    },
    anomaly: {
      stroke: "#0f5a79",
      fill: "#2fa6c3",
      fillOpacity: 0.28,
      strokeWidth: 2,
      dashArray: "",
    },
    drillholes: {
      markerColor: "#111827",
      markerFill: "#ffffff",
      markerSize: 10,
      strokeWidth: 1.8,
    },
    drill_traces: {
      stroke: "#2d3748",
      fill: "#2d3748",
      fillOpacity: 0,
      strokeWidth: 1.6,
      dashArray: "5 4",
    },
    geophysics: {
      stroke: "#61758a",
      fill: "#9ab1c4",
      fillOpacity: 0.22,
      strokeWidth: 1.4,
      dashArray: "",
    },
    highlight_zone: {
      stroke: "#5b2b8a",
      fill: "#8a57c5",
      fillOpacity: 0.24,
      strokeWidth: 2,
      dashArray: "",
    },
    other: {
      stroke: "#305ea8",
      fill: "#74a0f6",
      fillOpacity: 0.2,
      strokeWidth: 2,
      dashArray: "",
    },
  },
};

export function buildLegendItems(template, layers) {
  const visible = layers.filter((layer) => layer.visible !== false && layer.legend?.enabled !== false);
  const byRole = new Map((template.roleOrder || []).map((role, idx) => [role, idx]));

  return visible
    .slice()
    .sort((a, b) => (byRole.get(a.role) ?? 999) - (byRole.get(b.role) ?? 999))
    .map((layer) => ({
      id: layer.id,
      role: layer.role,
      label: layer.legend?.label || layer.name || ROLE_LABELS[layer.role] || "Layer",
      type: layer.type,
      style: {
        ...(template.roleStyles?.[layer.role] || template.roleStyles?.other || {}),
        ...(layer.style || {}),
      },
    }));
}
