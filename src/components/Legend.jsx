import React, { useState } from "react";

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

function EditableLabel({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        style={{
          font: "inherit",
          fontSize: "inherit",
          border: "none",
          background: "transparent",
          outline: "1px solid #3b82f6",
          borderRadius: 2,
          padding: "0 2px",
          width: "100%",
          minWidth: 40,
        }}
      />
    );
  }

  return (
    <span
      title="Click to rename"
      style={{ cursor: "text" }}
      onClick={() => { setDraft(value); setEditing(true); }}
    >
      {value}
    </span>
  );
}

export default function Legend({ items, onLabelChange }) {
  if (!items?.length) return null;
  return (
    <div className="legend-box template-panel">
      <div className="legend-title">Legend</div>
      {items.map((item) => (
        <div className="legend-row" key={item.id}>
          <Symbol item={item} />
          {onLabelChange ? (
            <EditableLabel value={item.label} onSave={(val) => onLabelChange(item.id, val)} />
          ) : (
            <span>{item.label}</span>
          )}
        </div>
      ))}
    </div>
  );
}
