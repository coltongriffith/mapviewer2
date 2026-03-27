import React from "react";

export default function LayerList({
  layers,
  selectedLayerId,
  onSelect,
  onToggleVisible,
}) {
  return (
    <div className="layer-list">
      {layers.map((layer) => (
        <div
          key={layer.id}
          className={`layer-item ${selectedLayerId === layer.id ? "active" : ""}`}
          onClick={() => onSelect?.(layer.id)}
        >
          <div className="layer-name">{layer.name || "Layer"}</div>
          <button
            className="btn layer-toggle"
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
