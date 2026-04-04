const roleStyleMap = {
  claims: {
    stroke: "#60a5fa",
    fill: "#93c5fd",
    fillOpacity: 0.24,
    strokeWidth: 2,
    markerColor: "#2563eb",
    markerFill: "#ffffff",
    markerSize: 12,
    dashArray: "",
  },
  drillholes: {
    stroke: "#1f2937",
    fill: "#ffffff",
    fillOpacity: 1,
    strokeWidth: 1.6,
    markerColor: "#1f2937",
    markerFill: "#ffffff",
    markerSize: 12,
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

  if (type === "points") return "drillholes";
  if (name.includes("road") || name.includes("access")) return "roads_access";
  if (name.includes("river") || name.includes("water") || name.includes("creek")) return "rivers_water";
  if (name.includes("fault") || name.includes("structure")) return "faults_structures";
  if (name.includes("anomaly") || name.includes("mag")) return "anomalies";
  if (name.includes("target")) return "target_areas";
  if (name.includes("label") || name.includes("town")) return "labels";
  return "claims";
}

// Color palette for multiple claims layers — index 0 = primary, 1 = secondary, etc.
const CLAIMS_PALETTE = [
  { stroke: '#60a5fa', fill: '#93c5fd', fillOpacity: 0.22 },   // primary blue
  { stroke: '#f59e0b', fill: '#fcd34d', fillOpacity: 0.20 },   // secondary amber
  { stroke: '#14b8a6', fill: '#5eead4', fillOpacity: 0.18 },   // tertiary teal
  { stroke: '#a855f7', fill: '#d8b4fe', fillOpacity: 0.18 },   // quaternary purple
  { stroke: '#ef4444', fill: '#fca5a5', fillOpacity: 0.18 },   // quinary red
];

export function applyRoleToLayer(layer, role, existingClaimsCount = 0) {
  const base = getRoleDefaultStyle(role);
  // For claims, cycle through the contrast palette based on how many claims layers already exist
  const roleStyle = (role === 'claims' && existingClaimsCount > 0)
    ? { ...base, ...CLAIMS_PALETTE[existingClaimsCount % CLAIMS_PALETTE.length] }
    : base;
  return {
    ...layer,
    role,
    // claimsIndex stored so user can identify which palette slot this layer uses
    ...(role === 'claims' ? { claimsIndex: existingClaimsCount } : {}),
    style: {
      ...roleStyle,
      ...(layer.style || {}),
    },
  };
}
