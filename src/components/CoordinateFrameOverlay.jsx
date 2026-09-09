import React, { useEffect, useState } from 'react';
import { computeGridTicks, FRAME_FONT, FRAME_FONT_PX, FRAME_TICK_PX } from '../utils/coordinateFrame.js';

// The live coordinate frame on the editing stage and the shared page: white
// margins over the map's edges, the frame rule, and a UTM tick with its label
// on every edge. Redraws on every pan and zoom. The exporters draw the same
// ticks from the same computation (utils/coordinateFrame.js).
//
// Stacked above the callout and annotation overlays (510, 520): the margin is
// outside the map, and the exporters clip map content to the frame, so an
// annotation dragged into the margin must not paint over the ticks here
// either.
export default function CoordinateFrameOverlay({ map, frame, stage }) {
  const [, setV] = useState(0);
  useEffect(() => {
    if (!map) return undefined;
    const bump = () => setV((v) => v + 1);
    map.on('moveend zoomend resize', bump);
    return () => map.off('moveend zoomend resize', bump);
  }, [map]);

  if (!map || !frame || !stage) return null;
  const ticks = computeGridTicks(map, frame, 1);
  if (!ticks) return null;

  const W = stage.width, H = stage.height;
  const { left, top, right, bottom, area } = frame;
  const t = FRAME_TICK_PX;
  const text = { fontFamily: FRAME_FONT, fontSize: FRAME_FONT_PX, fill: '#000' };

  return (
    <svg
      className="coordinate-frame"
      width={W}
      height={H}
      style={{ position: 'absolute', top: 0, left: 0, width: W, height: H, pointerEvents: 'none', zIndex: 530 }}
      aria-hidden="true"
    >
      <rect x={area.left} y={area.top} width={area.right - area.left} height={top - area.top} fill="#fff" />
      <rect x={area.left} y={bottom} width={area.right - area.left} height={area.bottom - bottom} fill="#fff" />
      <rect x={area.left} y={top} width={left - area.left} height={bottom - top} fill="#fff" />
      <rect x={right} y={top} width={area.right - right} height={bottom - top} fill="#fff" />
      <rect x={left} y={top} width={right - left} height={bottom - top} fill="none" stroke="#000" strokeWidth={1.5} />
      {ticks.x.map(({ px, label }) => (
        <g key={`x${label}`}>
          <line x1={px} y1={top} x2={px} y2={top - t} stroke="#000" strokeWidth={1} />
          <line x1={px} y1={bottom} x2={px} y2={bottom + t} stroke="#000" strokeWidth={1} />
          <text x={px} y={top - t - 2} textAnchor="middle" {...text}>{label}</text>
          <text x={px} y={bottom + t + 2} textAnchor="middle" dominantBaseline="hanging" {...text}>{label}</text>
        </g>
      ))}
      {ticks.y.map(({ py, label }) => (
        <g key={`y${label}`}>
          <line x1={left} y1={py} x2={left - t} y2={py} stroke="#000" strokeWidth={1} />
          <line x1={right} y1={py} x2={right + t} y2={py} stroke="#000" strokeWidth={1} />
          <text textAnchor="middle" transform={`translate(${left - t - 2},${py}) rotate(-90)`} {...text}>{label}</text>
          <text textAnchor="middle" transform={`translate(${right + t + 2},${py}) rotate(90)`} {...text}>{label}</text>
        </g>
      ))}
    </svg>
  );
}
