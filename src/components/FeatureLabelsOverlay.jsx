import React, { useEffect, useMemo, useState } from "react";
import { placeFeatureLabels } from "../utils/labels";

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
            style={{ left: label.left, top: label.top, minWidth: label.width, minHeight: label.height }}
          >
            {label.text}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
