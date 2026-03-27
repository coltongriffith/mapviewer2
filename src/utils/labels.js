import { featureCollectionFeatures, featureCenter, geojsonCenter } from "./geometry";

const PREFERRED_KEYS = [
  "label",
  "name",
  "hole_id",
  "holeid",
  "hole",
  "id",
  "prospect",
  "target",
  "station",
  "town",
  "city",
  "highway",
  "road",
  "rail",
];

function toTitleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function cleanCandidate(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length > 42) return "";
  if (/^\d+(?:\.\d+)?$/.test(text)) return "";
  return toTitleCase(text);
}

export function inferFeatureLabelText(feature, layer, index = 0) {
  const props = feature?.properties || {};
  for (const key of PREFERRED_KEYS) {
    if (props[key] != null) {
      const candidate = cleanCandidate(props[key]);
      if (candidate) return candidate;
    }
    const foundKey = Object.keys(props).find((name) => name.toLowerCase() === key);
    if (foundKey && props[foundKey] != null) {
      const candidate = cleanCandidate(props[foundKey]);
      if (candidate) return candidate;
    }
  }

  const role = layer?.role || "claims";
  if (role === "drillholes") return `DH-${String(index + 1).padStart(2, "0")}`;
  if (role === "target_areas") return `Target ${index + 1}`;
  if (role === "roads_access") return index === 0 ? (layer?.legend?.label || layer?.name || "Road Access") : `Access ${index + 1}`;
  if (role === "rivers_water") return index === 0 ? (layer?.legend?.label || layer?.name || "Water") : `Water ${index + 1}`;
  return index === 0 ? (layer?.legend?.label || layer?.name || "Label") : `${layer?.legend?.label || layer?.name || "Label"} ${index + 1}`;
}

export function defaultLabelTypeForRole(role) {
  if (role === "drillholes") return "tag";
  if (role === "target_areas") return "boxed";
  if (role === "roads_access" || role === "rivers_water") return "plain";
  return "boxed";
}

export function buildLabelsForLayer(layer, options = {}) {
  if (!layer?.geojson) return [];
  const features = featureCollectionFeatures(layer.geojson);
  if (!features.length) {
    const center = geojsonCenter(layer.geojson);
    if (!center) return [];
    return [{
      id: crypto.randomUUID(),
      layerId: layer.id,
      text: layer.legend?.label || layer.name || "Label",
      type: defaultLabelTypeForRole(layer.role),
      priority: layer.role === "drillholes" ? 1 : 2,
      anchor: center,
      offset: { x: 10, y: -12 },
    }];
  }

  const maxLabels = options.maxLabels ?? (layer.role === "drillholes" ? 20 : 8);
  const points = features.slice(0, maxLabels).map((feature, index) => {
    const anchor = featureCenter(feature);
    if (!anchor) return null;
    return {
      id: crypto.randomUUID(),
      layerId: layer.id,
      text: inferFeatureLabelText(feature, layer, index),
      type: defaultLabelTypeForRole(layer.role),
      priority: layer.role === "drillholes" ? 1 : layer.role === "target_areas" ? 1 : 2,
      anchor,
      offset: {
        x: layer.role === "drillholes" ? 12 : 10,
        y: layer.role === "drillholes" ? -14 - ((index % 3) * 10) : -10,
      },
    };
  }).filter(Boolean);

  if (layer.type !== "points" && points.length > 1) return [points[0]];
  return points;
}

export function estimateLabelBox(label) {
  const text = String(label?.text || "");
  const baseWidth = Math.max(54, Math.min(220, 14 + text.length * 7.2));
  if (label?.type === "boxed") return { width: Math.max(120, baseWidth + 18), height: 32 };
  if (label?.type === "tag") return { width: Math.max(70, baseWidth), height: 24 };
  return { width: Math.max(42, baseWidth - 10), height: 18 };
}

function overlaps(a, b, gap = 8) {
  return a.left < b.left + b.width + gap && a.left + a.width + gap > b.left && a.top < b.top + b.height + gap && a.top + a.height + gap > b.top;
}

export function placeFeatureLabels(labels, map, options = {}) {
  if (!map) return [];
  const mapSize = map.getSize?.() || { x: options.width || 1600, y: options.height || 1000 };
  const placed = [];
  labels
    .slice()
    .sort((a, b) => (a.priority || 2) - (b.priority || 2))
    .forEach((label) => {
      if (!label?.anchor) return;
      const anchorPx = map.latLngToContainerPoint([label.anchor.lat, label.anchor.lng]);
      const box = estimateLabelBox(label);
      let left = anchorPx.x + (label.offset?.x || 0);
      let top = anchorPx.y + (label.offset?.y || 0) - box.height / 2;

      for (let i = 0; i < 10; i += 1) {
        const hit = placed.find((other) => overlaps({ left, top, ...box }, other));
        if (!hit) break;
        top = hit.top + hit.height + 6;
      }

      left = Math.max(8, Math.min(left, mapSize.x - box.width - 8));
      top = Math.max(8, Math.min(top, mapSize.y - box.height - 8));

      placed.push({
        ...label,
        ...box,
        left,
        top,
        anchorPx,
      });
    });

  return placed;
}
