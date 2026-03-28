const roleStyleMap = {
  claims: {
    stroke: "rgba(28,85,210,0.88)",
    fill: "rgba(22,65,185)",
    fillOpacity: 0.52,
    strokeWidth: 2,
    markerColor: "#1646b9",
    markerFill: "#ffffff",
    markerSize: 12,
    dashArray: "",
  },
  adjacent_claims: {
    stroke: "rgba(90,90,90,0.45)",
    fill: "rgba(180,180,180)",
    fillOpacity: 0.10,
    strokeWidth: 1.2,
    markerColor: "#5a5a5a",
    markerFill: "#e0e0e0",
    markerSize: 10,
    dashArray: "5 4",
  },
  drillholes: {
    stroke: "#1B3A6B",
    fill: "#E03030",
    fillOpacity: 1,
    strokeWidth: 1.5,
    markerColor: "#1B3A6B",
    markerFill: "#E03030",
    markerSize: 10,
    dashArray: "",
  },
  drillholes_completed: {
    stroke: "#1B3A6B",
    fill: "#8B5CF6",
    fillOpacity: 1,
    strokeWidth: 1.5,
    markerColor: "#1B3A6B",
    markerFill: "#8B5CF6",
    markerSize: 10,
    dashArray: "",
  },
  target_areas: {
    stroke: "#f59e0b",
    fill: "#fbbf24",
    fillOpacity: 0.18,
    strokeWidth: 2.2,
    markerColor: "#b45309",
    markerFill: "#fef3c7",
    markerSize: 12,
    dashArray: "8 5",
  },
  anomalies: {
    stroke: "#a21caf",
    fill: "#d946ef",
    fillOpacity: 0.2,
    strokeWidth: 2.2,
    markerColor: "#86198f",
    markerFill: "#fae8ff",
    markerSize: 12,
    dashArray: "",
  },
  faults_structures: {
    stroke: "#374151",
    fill: "#374151",
    fillOpacity: 0,
    strokeWidth: 1.8,
    markerColor: "#374151",
    markerFill: "#ffffff",
    markerSize: 10,
    dashArray: "6 4",
  },
  roads_access: {
    stroke: "#7c5e43",
    fill: "#7c5e43",
    fillOpacity: 0,
    strokeWidth: 1.8,
    markerColor: "#7c5e43",
    markerFill: "#ffffff",
    markerSize: 10,
    dashArray: "",
  },
  rivers_water: {
    stroke: "#0ea5e9",
    fill: "#7dd3fc",
    fillOpacity: 0.16,
    strokeWidth: 1.8,
    markerColor: "#0284c7",
    markerFill: "#e0f2fe",
    markerSize: 10,
    dashArray: "",
  },
  labels: {
    stroke: "#0f172a",
    fill: "#0f172a",
    fillOpacity: 0,
    strokeWidth: 1,
    markerColor: "#0f172a",
    markerFill: "#ffffff",
    markerSize: 8,
    dashArray: "",
  },
};

export const LAYER_PRESETS = Object.fromEntries(
  Object.entries(roleStyleMap).map(([key, style]) => [key, { label: key, style }])
);

export function getRoleDefaultStyle(role) {
  return { ...(roleStyleMap[role] || roleStyleMap.claims) };
}

export function inferRoleFromLayer(layer) {
  const type = String(layer?.type || "").toLowerCase();
  const name = String(layer?.name || "").toLowerCase();

  if (type === "points") {
    if (name.includes("complet") || name.includes("historic") || name.includes("old")) return "drillholes_completed";
    return "drillholes";
  }
  if (name.includes("adjacent") || name.includes("neighbor") || name.includes("competitor")) return "adjacent_claims";
  if (name.includes("road") || name.includes("access")) return "roads_access";
  if (name.includes("river") || name.includes("water") || name.includes("creek")) return "rivers_water";
  if (name.includes("fault") || name.includes("structure")) return "faults_structures";
  if (name.includes("anomaly") || name.includes("mag")) return "anomalies";
  if (name.includes("target")) return "target_areas";
  if (name.includes("label") || name.includes("town")) return "labels";
  return "claims";
}

export function applyRoleToLayer(layer, role) {
  return {
    ...layer,
    role,
    style: {
      ...getRoleDefaultStyle(role),
      ...(layer.style || {}),
    },
  };
}
