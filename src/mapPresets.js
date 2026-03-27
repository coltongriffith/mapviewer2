export const LAYER_PRESETS = {
  claim: {
    label: "Claims",
    style: {
      stroke: "#54a6ff",
      fill: "#54a6ff",
      fillOpacity: 0.22,
      strokeWidth: 2,
      markerColor: "#111111",
      markerSize: 10,
    },
  },
  peer: {
    label: "Peer Claims",
    style: {
      stroke: "#7f8ea3",
      fill: "#7f8ea3",
      fillOpacity: 0.18,
      strokeWidth: 2,
      markerColor: "#333333",
      markerSize: 10,
    },
  },
  target: {
    label: "Target Area",
    style: {
      stroke: "#ffffff",
      fill: "#ffffff",
      fillOpacity: 0.08,
      strokeWidth: 2,
      markerColor: "#111111",
      markerSize: 10,
      dashArray: "8,6",
    },
  },
  drillhole: {
    label: "Drillholes",
    style: {
      stroke: "#111111",
      fill: "#111111",
      fillOpacity: 1,
      strokeWidth: 1,
      markerColor: "#111111",
      markerSize: 12,
    },
  },
};

export function applyPresetToLayer(layer, presetKey) {
  const preset = LAYER_PRESETS[presetKey];
  if (!preset) return layer;

  return {
    ...layer,
    style: {
      ...(layer.style || {}),
      ...preset.style,
    },
  };
}
