import React from "react";
import { getRoleDefaultStyle } from "../mapPresets";

const DASH_OPTIONS = [
  { label: "Solid", value: "" },
  { label: "Dashed", value: "8 5" },
  { label: "Fine Dash", value: "4 3" },
  { label: "Dotted", value: "2 3" },
];

export default function LayerStyleEditor({ layer, onChange }) {
  if (!layer) return null;

  const style = layer.style || {};
  const isPoint = layer.type === "points";

  const set = (patch) => onChange(patch);

  const resetToDefaults = () => {
    onChange(getRoleDefaultStyle(layer.role));
  };

  return (
    <div className="style-editor">
      <div className="style-editor-header">
        <span className="control-label">Style</span>
        <button className="secondary-btn reset-btn" type="button" onClick={resetToDefaults}>
          Reset
        </button>
      </div>

      {isPoint ? (
        <>
          <div className="color-pair-row">
            <div className="color-row">
              <label>Marker Fill</label>
              <input
                type="color"
                value={style.markerFill || "#ffffff"}
                onChange={(e) => set({ markerFill: e.target.value })}
              />
            </div>
            <div className="color-row">
              <label>Marker Outline</label>
              <input
                type="color"
                value={style.markerColor || "#2563eb"}
                onChange={(e) => set({ markerColor: e.target.value })}
              />
            </div>
          </div>
          <div className="control-row">
            <div className="slider-label-row">
              <label>Marker Size</label>
              <span className="range-value">{style.markerSize ?? 12}px</span>
            </div>
            <input
              type="range"
              min="4"
              max="24"
              step="1"
              value={style.markerSize ?? 12}
              onChange={(e) => set({ markerSize: Number(e.target.value) })}
            />
          </div>
          <div className="control-row">
            <div className="slider-label-row">
              <label>Outline Width</label>
              <span className="range-value">{style.strokeWidth ?? 1.6}px</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="6"
              step="0.5"
              value={style.strokeWidth ?? 1.6}
              onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
            />
          </div>
        </>
      ) : (
        <>
          <div className="color-pair-row">
            <div className="color-row">
              <label>Fill</label>
              <input
                type="color"
                value={style.fill || "#93c5fd"}
                onChange={(e) => set({ fill: e.target.value })}
              />
            </div>
            <div className="color-row">
              <label>Stroke</label>
              <input
                type="color"
                value={style.stroke || "#60a5fa"}
                onChange={(e) => set({ stroke: e.target.value })}
              />
            </div>
          </div>
          <div className="control-row">
            <div className="slider-label-row">
              <label>Fill Opacity</label>
              <span className="range-value">{Math.round((style.fillOpacity ?? 0.24) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={style.fillOpacity ?? 0.24}
              onChange={(e) => set({ fillOpacity: Number(e.target.value) })}
            />
          </div>
          <div className="control-row">
            <div className="slider-label-row">
              <label>Stroke Width</label>
              <span className="range-value">{style.strokeWidth ?? 2}px</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="6"
              step="0.5"
              value={style.strokeWidth ?? 2}
              onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
            />
          </div>
          <div className="control-row">
            <label>Dash Pattern</label>
            <select
              value={style.dashArray ?? ""}
              onChange={(e) => set({ dashArray: e.target.value })}
            >
              {DASH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}
