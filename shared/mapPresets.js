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

// Neutral roles: imports whose purpose the file name does not state, and
// sampling footprints (soil grids, survey extents) that must not read as a
// claim or anomaly. Mode presets leave their visibility alone.
roleStyleMap.sampling_extent = {
  stroke: "#475569",
  fill: "#94a3b8",
  fillOpacity: 0,
  strokeWidth: 1.4,
  markerColor: "#475569",
  markerFill: "#ffffff",
  markerSize: 8,
  dashArray: "4 3",
};
roleStyleMap.other = {
  stroke: "#2563eb",
  fill: "#93c5fd",
  fillOpacity: 0.2,
  strokeWidth: 1.8,
  markerColor: "#2563eb",
  markerFill: "#ffffff",
  markerSize: 8,
  dashArray: "",
};
export const NEUTRAL_ROLES = new Set(["sampling_extent", "other"]);

export function getRoleDefaultStyle(role) {
  return { ...(roleStyleMap[role] || roleStyleMap.claims) };
}

export function inferRoleFromLayer(layer) {
  const type = String(layer?.type || "").toLowerCase();
  const name = String(layer?.name || "").toLowerCase();
  const has = (re) => re.test(name);

  // Sampling footprints first: "soil grid extent" is neither a claim nor an
  // anomaly, even though older inference called every unnamed polygon a claim.
  if (type !== "points" && has(/sampl|soil|extent|footprint|survey|coverage/)) return "sampling_extent";
  if (type === "points") return "drillholes";
  if (has(/road|access/)) return "roads_access";
  if (has(/river|water|creek/)) return "rivers_water";
  if (has(/fault|structure/)) return "faults_structures";
  if (has(/anomal|mag(netics?)?(?![a-z])/)) return "anomalies";
  if (has(/target/)) return "target_areas";
  if (has(/label|town/)) return "labels";
  if (has(/claim|tenure|landholding|licen[cs]e|property|permit|concession|cells?(?![a-z])|mineral title/)) return "claims";
  // Nothing in the name says what this is: stay neutral rather than label it
  // "Project Claims". The user picks a role from the layer panel.
  return "other";
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
