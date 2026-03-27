import React, { useEffect, useMemo, useState } from "react";

function resolveCalloutBoxes(callouts, map) {
  if (!map) return [];
  const placed = [];

  callouts
    .slice()
    .sort((a, b) => (a.priority || 2) - (b.priority || 2))
    .forEach((callout) => {
      const anchor = callout.anchor;
      if (!anchor) return;
      const pt = map.latLngToContainerPoint([anchor.lat, anchor.lng]);
      let left = pt.x + (callout.offset?.x || 0);
      let top = pt.y + (callout.offset?.y || 0);
      const width = callout.type === "boxed" ? 180 : 132;
      const height = callout.type === "boxed" ? 54 : 28;

      for (const other of placed) {
        const overlapX = left < other.left + other.width + 8 && left + width + 8 > other.left;
        const overlapY = top < other.top + other.height + 8 && top + height + 8 > other.top;
        if (overlapX && overlapY) {
          top = other.top + other.height + 10;
        }
      }

      placed.push({
        ...callout,
        width,
        height,
        left,
        top,
        anchorPx: pt,
      });
    });

  return placed;
}

export default function CalloutsOverlay({ map, callouts }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!map) return undefined;
    const rerender = () => setTick((v) => v + 1);
    map.on("move zoom zoomend moveend resize", rerender);
    return () => map.off("move zoom zoomend moveend resize", rerender);
  }, [map]);

  const placed = useMemo(() => resolveCalloutBoxes(callouts, map), [callouts, map, tick]);

  return (
    <div className="callouts-overlay">
      {placed.map((callout) => (
        <React.Fragment key={callout.id}>
          {callout.type === "leader" || callout.type === "boxed" ? (
            <svg className="callout-leader-svg">
              <line
                x1={callout.anchorPx.x}
                y1={callout.anchorPx.y}
                x2={callout.left + 10}
                y2={callout.top + callout.height / 2}
                stroke="#0f172a"
                strokeWidth="1.5"
                strokeDasharray={callout.type === "leader" ? "4 3" : ""}
              />
            </svg>
          ) : null}
          <div
            className={`map-callout ${callout.type}`}
            style={{ left: callout.left, top: callout.top, width: callout.width, minHeight: callout.height }}
          >
            {callout.text}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
