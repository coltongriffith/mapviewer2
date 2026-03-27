import React from "react";

function Symbol({ item }) {
  if (item.type === "points") {
    return (
      <span
        className="legend-symbol"
        style={{
          width: 12,
          height: 12,
          borderRadius: "999px",
          border: `1.5px solid ${item.style?.markerColor || "#111"}`,
          background: item.style?.markerFill || "#fff",
        }}
      />
    );
  }

  if (item.type === "line") {
    return (
      <span
        className="legend-symbol"
        style={{
          width: 18,
          height: 0,
          borderTop: `${item.style?.strokeWidth || 2}px solid ${item.style?.stroke || "#333"}`,
          opacity: 0.9,
        }}
      />
    );
  }

  return (
    <span
      className="legend-symbol"
      style={{
        width: 16,
        height: 10,
        border: `1.5px solid ${item.style?.stroke || "#333"}`,
        background: item.style?.fill || "#85a9e2",
        opacity: item.style?.fillOpacity ?? 0.8,
      }}
    />
  );
}

export default function Legend({ items }) {
  if (!items?.length) return null;
  return (
    <div className="legend-box template-panel">
      <div className="legend-title">Legend</div>
      {items.map((item) => (
        <div className="legend-row" key={item.id}>
          <Symbol item={item} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
