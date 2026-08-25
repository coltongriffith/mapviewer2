import React from 'react';
import { northArrowShapes, NORTH_ARROW_FONT } from '../utils/northArrowGeometry';

const FG = 'var(--north-fg, #142126)';
const BG = 'var(--north-fill, rgba(255,255,255,0.95))';

const paint = (token) => (token === 'bg' ? BG : token === 'fg' ? FG : token || 'none');

/**
 * One primitive from northArrowShapes as an SVG element.
 *
 * Text carries an explicit alphabetic baseline rather than dominant-baseline:
 * the canvas exporter and Illustrator both handle the alphabetic baseline
 * identically, which dominant-baseline cannot be relied on to do.
 */
function Shape({ shape }) {
  switch (shape.kind) {
    case 'polygon':
      return (
        <polygon
          points={shape.points.map(([x, y]) => `${x},${y}`).join(' ')}
          fill={paint(shape.fill)}
          fillOpacity={shape.opacity ?? 1}
          stroke={shape.stroke ? paint(shape.stroke) : undefined}
          strokeWidth={shape.stroke ? shape.strokeWidth : undefined}
          strokeLinejoin="round"
        />
      );
    case 'circle':
      return (
        <circle
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          fill={shape.fill ? paint(shape.fill) : 'none'}
          stroke={shape.stroke ? paint(shape.stroke) : undefined}
          strokeWidth={shape.stroke ? shape.strokeWidth : undefined}
          strokeOpacity={shape.opacity ?? 1}
        />
      );
    case 'line':
      return (
        <line
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          stroke={paint(shape.stroke)}
          strokeWidth={shape.strokeWidth}
          strokeOpacity={shape.opacity ?? 1}
        />
      );
    case 'text':
      return (
        <text
          x={shape.x}
          y={shape.y}
          textAnchor={shape.anchor}
          fill={FG}
          fontFamily={NORTH_ARROW_FONT}
          fontSize={shape.size}
          fontWeight={shape.weight}
        >
          {shape.value}
        </text>
      );
    default:
      return null;
  }
}

export const NORTH_ARROW_STYLES = [
  { key: 'classic',    label: 'Compass Rose' },
  { key: 'arrow',      label: 'Simple Arrow' },
  { key: 'decorative', label: 'Decorative'   },
  { key: 'surveyor',   label: 'Surveyor'     },
];

export default function NorthArrow({ scale = 100, style: arrowStyle = 'classic' }) {
  const h = scale;
  const w = Math.round(h * 0.9);
  const shapes = northArrowShapes(arrowStyle, w, h);

  return (
    <div className="template-card north-arrow-card">
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block' }}
      >
        {shapes.map((shape, i) => <Shape key={i} shape={shape} />)}
      </svg>
    </div>
  );
}
