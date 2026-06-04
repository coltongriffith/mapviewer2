import React, { useEffect, useState } from "react";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const STEPS = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 500000, 1000000];
const TARGET = 120;

export default function ScaleBar({ map, height }) {
  const [state, setState] = useState({ label: "1 km", width: 100 });

  useEffect(() => {
    if (!map) return;

    const update = () => {
      const size = map.getSize();
      const cy = size.y / 2;
      const latlng1 = map.containerPointToLatLng([0, cy]);
      const latlng2 = map.containerPointToLatLng([200, cy]);
      const metersPerPx = latlng1.distanceTo(latlng2) / 200;
      const nice = STEPS.reduce((best, n) =>
        Math.abs(n / metersPerPx - TARGET) < Math.abs(best / metersPerPx - TARGET) ? n : best,
      STEPS[0]);

      setState({
        label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m`,
        width: clamp(Math.round(nice / metersPerPx), 40, 220),
      });
    };

    update();
    map.on("moveend zoomend", update);
    return () => map.off("moveend zoomend", update);
  }, [map]);

  return (
    <div className="scale-bar" style={height ? { minHeight: `${height}px` } : undefined}>
      <div className="scale-bar-track" style={{ width: state.width }} />
      <div className="scale-bar-label">{state.label}</div>
    </div>
  );
}
