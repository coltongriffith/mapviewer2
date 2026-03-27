import React from "react";

export default function LayerList({ layers, selectedLayerId, onSelect, onToggleVisible }) {
  return (
    <div className="layer-list">
      {layers.map((layer) => (
        <div
          key={layer.id}
          className={`layer-item ${selectedLayerId === layer.id ? "active" : ""}`}
          onClick={() => onSelect?.(layer.id)}
        >
          <div className="layer-name">
            <strong>{layer.name || "Layer"}</strong>
            <div className="layer-meta">{layer.role || "other"}</div>
          </div>
          <button
            className="btn layer-toggle"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisible?.(layer.id);
            }}
          >
            {layer.visible === false ? "Off" : "On"}
          </button>
        </div>
      ))}
    </div>
  );
}
