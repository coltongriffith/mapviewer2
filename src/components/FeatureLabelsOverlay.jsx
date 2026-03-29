import React, { useEffect, useMemo, useState } from "react";
import { placeFeatureLabels } from "../utils/labels";

function LabelContent({ text }) {
  const lines = String(text || "").split(/\n| - /).slice(0, 2);
  return (
    <>
      <span style={{ fontWeight: 700, display: "block", lineHeight: 1.2 }}>{lines[0]}</span>
      {lines[1] ? (
        <span style={{ fontSize: "0.75em", color: "#666", display: "block", lineHeight: 1.2, marginTop: 1 }}>
          {lines[1]}
        </span>
      ) : null}
    </>
  );
}

export default function FeatureLabelsOverlay({ map, labels }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!map) return undefined;
    const rerender = () => setTick((v) => v + 1);
    map.on("move zoom zoomend moveend resize", rerender);
    return () => map.off("move zoom zoomend moveend resize", rerender);
  }, [map]);

  const placed = useMemo(() => placeFeatureLabels(labels || [], map), [labels, map, tick]);

  return (
    <div className="feature-labels-overlay">
      {placed.map((label) => (
        <React.Fragment key={label.id}>
          {label.type === "boxed" ? (
            <svg className="feature-label-line-svg">
              <line
                x1={label.anchorPx.x}
                y1={label.anchorPx.y}
                x2={label.left + 10}
                y2={label.top + label.height / 2}
                stroke="#122033"
                strokeWidth="1.2"
              />
            </svg>
          ) : null}
          <div
            className={`feature-label ${label.type}`}
            style={{
              left: label.left,
              top: label.top,
              minWidth: label.width,
              minHeight: label.height,
              textShadow: "0 1px 3px rgba(255,255,255,0.85)",
            }}
          >
            <LabelContent text={label.text} />
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
