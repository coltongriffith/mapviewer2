import React, { useEffect, useState } from "react";
import { projectionLabel } from "../utils/coordinateFrame.js";
import { pickScaleBar } from "../utils/scaleBar.js";


export default function ScaleBar({ map, height, projection = false, projectionName = '' }) {
  const [state, setState] = useState({ label: "1 km", width: 100 });

  useEffect(() => {
    if (!map) return;

    const update = () => {
      const bar = pickScaleBar(map);
      setState({
        label: bar.label,
        half: bar.half,
        width: bar.widthPx,
        caption: projectionLabel({ projectionName }, map),
      });
    };

    update();
    map.on("moveend zoomend", update);
    return () => map.off("moveend zoomend", update);
  }, [map, projectionName]);

  return (
    <div className="scale-bar" style={height ? { minHeight: `${height}px` } : undefined}>
      <div className="scale-bar-track" style={{ width: state.width }}>
        <div className="scale-bar-fill" />
        <div className="scale-bar-fill light" />
      </div>
      <div className="scale-bar-label scale-bar-labels" style={{ width: state.width }}>
        <span>0</span><span>{state.half}</span><span>{state.label}</span>
      </div>
      {projection && <div className="scale-bar-caption">{state.caption || projectionLabel({ projectionName }, map)}</div>}
    </div>
  );
}
