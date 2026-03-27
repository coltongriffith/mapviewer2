import React, { useEffect, useState } from "react";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const STEPS = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000];

export default function ScaleBar({ map }) {
  const [state, setState] = useState({ label: "1 km", width: 100 });

  useEffect(() => {
    if (!map) return;

    const update = () => {
      const size = map.getSize();
      const latlng1 = map.containerPointToLatLng([20, size.y - 40]);
      const latlng2 = map.containerPointToLatLng([150, size.y - 40]);
      const meters = latlng1.distanceTo(latlng2);
      const nice = STEPS.reduce((best, n) =>
        Math.abs(n - meters) < Math.abs(best - meters) ? n : best,
      STEPS[0]);

      setState({
        label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m`,
        width: clamp(Math.round((130 * nice) / meters), 70, 220),
      });
    };

    update();
    map.on("moveend zoomend resize", update);
    return () => map.off("moveend zoomend resize", update);
  }, [map]);

  return (
    <div className="scale-bar">
      <div className="scale-bar-track" style={{ width: state.width }} />
      <div className="scale-bar-label">{state.label}</div>
    </div>
  );
}
