import React, { useMemo } from "react";
import { geojsonBounds, unionBounds } from "../utils/geometry";

function resolveReferenceBounds(bounds, insetMode) {
  if (!bounds) {
    return { minLng: -180, minLat: -90, maxLng: 180, maxLat: 90, label: "Locator" };
  }

  if (insetMode === "country") {
    return { minLng: -180, minLat: -90, maxLng: 180, maxLat: 90, label: "Country" };
  }

  const cx = (bounds.minLng + bounds.maxLng) / 2;
  const cy = (bounds.minLat + bounds.maxLat) / 2;
  const width = Math.max(0.4, bounds.maxLng - bounds.minLng);
  const height = Math.max(0.4, bounds.maxLat - bounds.minLat);
  const multiplier = insetMode === "secondary_zoom" ? 2.2 : insetMode === "regional_district" ? 5.5 : 10;
  return {
    minLng: cx - width * multiplier,
    maxLng: cx + width * multiplier,
    minLat: cy - height * multiplier,
    maxLat: cy + height * multiplier,
    label:
      insetMode === "secondary_zoom"
        ? "Secondary Zoom"
        : insetMode === "regional_district"
          ? "Regional District"
          : "Province / State",
  };
}

function normalize(bounds, ref) {
  if (!bounds || !ref) return null;
  const width = Math.max(1e-6, ref.maxLng - ref.minLng);
  const height = Math.max(1e-6, ref.maxLat - ref.minLat);
  return {
    x: ((bounds.minLng - ref.minLng) / width) * 100,
    y: (1 - (bounds.maxLat - ref.minLat) / height) * 100,
    w: ((bounds.maxLng - bounds.minLng) / width) * 100,
    h: ((bounds.maxLat - bounds.minLat) / height) * 100,
  };
}

export default function LocatorInset({ layers, insetMode, zone }) {
  const { visibleBounds, referenceBounds } = useMemo(() => {
    const active = layers.filter((layer) => layer.visible !== false && layer.geojson);
    const visibleBounds = unionBounds(active.map((layer) => geojsonBounds(layer.geojson)));
    return {
      visibleBounds,
      referenceBounds: resolveReferenceBounds(visibleBounds, insetMode),
    };
  }, [layers, insetMode]);

  const marker = normalize(visibleBounds, referenceBounds);

  return (
    <div className="template-card inset-card" style={zone}>
      <div className="inset-header">Locator</div>
      <svg viewBox="0 0 100 100" className="inset-svg" preserveAspectRatio="none">
        <rect x="0" y="0" width="100" height="100" rx="6" fill="#eef2f7" stroke="#c6d0dd" />
        {[20, 40, 60, 80].map((n) => (
          <g key={n}>
            <line x1={n} y1="0" x2={n} y2="100" stroke="#d7dfe9" strokeWidth="0.6" />
            <line x1="0" y1={n} x2="100" y2={n} stroke="#d7dfe9" strokeWidth="0.6" />
          </g>
        ))}
        {marker ? (
          <>
            <rect
              x={Math.max(2, marker.x)}
              y={Math.max(2, marker.y)}
              width={Math.max(4, marker.w)}
              height={Math.max(4, marker.h)}
              fill="rgba(96,165,250,0.20)"
              stroke="#2563eb"
              strokeWidth="1.4"
            />
            <circle
              cx={Math.min(96, Math.max(4, marker.x + marker.w / 2))}
              cy={Math.min(96, Math.max(4, marker.y + marker.h / 2))}
              r="2.7"
              fill="#0f172a"
            />
          </>
        ) : null}
      </svg>
      <div className="inset-mode-label">{referenceBounds.label}</div>
    </div>
  );
}
