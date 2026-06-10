import React from 'react';

const fg = 'var(--north-fg, #122033)';
const fill = 'var(--north-fill, rgba(255,255,255,0.95))';

// Classic 8-point compass rose (original design)
function Classic({ w, h, cx, cy, R, Re, rn, r45, nx, ny, sx, sy, ex, ey, wx, wy, ne, se, sw, nw }) {
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      <path d={`M ${nx} ${ny} L ${ne[0]} ${ne[1]} L ${cx} ${cy} L ${nw[0]} ${nw[1]} Z`} fill={fg} />
      <path d={`M ${sx} ${sy} L ${sw[0]} ${sw[1]} L ${cx} ${cy} L ${se[0]} ${se[1]} Z`} fill={fg} fillOpacity="0.55" />
      <path d={`M ${ex} ${ey} L ${se[0]} ${se[1]} L ${cx} ${cy} L ${ne[0]} ${ne[1]} Z`} fill={fg} fillOpacity="0.35" />
      <path d={`M ${wx} ${wy} L ${nw[0]} ${nw[1]} L ${cx} ${cy} L ${sw[0]} ${sw[1]} Z`} fill={fg} fillOpacity="0.35" />
      <circle cx={cx} cy={cy} r={R + rn * 0.5} fill="none" stroke={fg} strokeOpacity="0.2" strokeWidth={h * 0.012} />
      <circle cx={cx} cy={cy} r={h * 0.044} fill={fill} stroke={fg} strokeWidth={h * 0.018} />
      <text x={cx} y={h * 0.14} textAnchor="middle" dominantBaseline="middle" fill={fg} fontFamily="Arial, sans-serif" fontSize={h * 0.16} fontWeight="700">N</text>
    </svg>
  );
}

// Simple arrow — clean minimal style
function Arrow({ w, h, cx, cy, R }) {
  const tipY = cy - R;
  const baseY = cy + R * 0.55;
  const arrowW = R * 0.38;
  const notchY = cy + R * 0.1;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {/* North half — filled */}
      <path d={`M ${cx} ${tipY} L ${cx + arrowW} ${notchY} L ${cx} ${cy - R * 0.04} L ${cx - arrowW} ${notchY} Z`} fill={fg} />
      {/* South half — outline */}
      <path d={`M ${cx} ${cy - R * 0.04} L ${cx + arrowW} ${notchY} L ${cx + arrowW * 0.6} ${baseY} L ${cx - arrowW * 0.6} ${baseY} L ${cx - arrowW} ${notchY} Z`} fill={fill} stroke={fg} strokeWidth={h * 0.022} strokeLinejoin="round" />
      <circle cx={cx} cy={cy - R * 0.04} r={R * 0.09} fill={fill} stroke={fg} strokeWidth={h * 0.022} />
      <text x={cx} y={h * 0.93} textAnchor="middle" dominantBaseline="middle" fill={fg} fontFamily="Arial, sans-serif" fontSize={h * 0.15} fontWeight="700" letterSpacing="0.05em">N</text>
    </svg>
  );
}

// Decorative — double ring with cardinal points
function Decorative({ w, h, cx, cy, R, Re, rn, r45, nx, ny, sx, sy, ex, ey, wx, wy, ne, se, sw, nw }) {
  const Ro = R * 1.22;
  const tickLen = R * 0.1;
  const cardinals = [
    { label: 'N', x: cx, y: cy - Ro - tickLen * 2.2, anchor: 'middle', baseline: 'auto' },
    { label: 'S', x: cx, y: cy + Ro + tickLen * 3.2, anchor: 'middle', baseline: 'auto' },
    { label: 'E', x: cx + Ro + tickLen * 2.8, y: cy + h * 0.025, anchor: 'middle', baseline: 'middle' },
    { label: 'W', x: cx - Ro - tickLen * 2.8, y: cy + h * 0.025, anchor: 'middle', baseline: 'middle' },
  ];
  const ticks = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h * 1.12}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {/* Outer ring */}
      <circle cx={cx} cy={cy * 1.06} r={Ro} fill="none" stroke={fg} strokeOpacity="0.18" strokeWidth={h * 0.014} />
      <circle cx={cx} cy={cy * 1.06} r={Ro - h * 0.028} fill="none" stroke={fg} strokeOpacity="0.1" strokeWidth={h * 0.006} />
      {/* Tick marks */}
      {ticks.map((deg) => {
        const rad = (deg - 90) * Math.PI / 180;
        const len = deg % 90 === 0 ? tickLen * 1.6 : tickLen;
        const x1 = cx + (Ro - len) * Math.cos(rad);
        const y1 = cy * 1.06 + (Ro - len) * Math.sin(rad);
        const x2 = cx + Ro * Math.cos(rad);
        const y2 = cy * 1.06 + Ro * Math.sin(rad);
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={fg} strokeOpacity={deg % 90 === 0 ? 0.5 : 0.25} strokeWidth={deg % 90 === 0 ? h * 0.016 : h * 0.008} />;
      })}
      {/* Arrow points */}
      <path d={`M ${cx} ${cy * 1.06 - R} L ${ne[0]} ${ne[1] + cy * 0.06} L ${cx} ${cy * 1.06} L ${nw[0]} ${nw[1] + cy * 0.06} Z`} fill={fg} />
      <path d={`M ${cx} ${cy * 1.06 + R} L ${sw[0]} ${sw[1] + cy * 0.06} L ${cx} ${cy * 1.06} L ${se[0]} ${se[1] + cy * 0.06} Z`} fill={fg} fillOpacity="0.4" />
      <path d={`M ${ex} ${cy * 1.06} L ${se[0]} ${se[1] + cy * 0.06} L ${cx} ${cy * 1.06} L ${ne[0]} ${ne[1] + cy * 0.06} Z`} fill={fg} fillOpacity="0.25" />
      <path d={`M ${wx} ${cy * 1.06} L ${nw[0]} ${nw[1] + cy * 0.06} L ${cx} ${cy * 1.06} L ${sw[0]} ${sw[1] + cy * 0.06} Z`} fill={fg} fillOpacity="0.25" />
      <circle cx={cx} cy={cy * 1.06} r={h * 0.05} fill={fill} stroke={fg} strokeWidth={h * 0.018} />
      {/* Cardinal labels */}
      {cardinals.map(({ label, x, y, anchor, baseline }) => (
        <text key={label} x={x} y={y} textAnchor={anchor} dominantBaseline={baseline} fill={fg}
          fontFamily="Arial, sans-serif" fontSize={h * 0.12} fontWeight="700">
          {label}
        </text>
      ))}
    </svg>
  );
}

// Crosshair / surveyor style
function Surveyor({ w, h, cx, cy, R }) {
  const r2 = R * 0.55;
  const tick = R * 0.18;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={fg} strokeWidth={h * 0.025} strokeOpacity="0.22" />
      <circle cx={cx} cy={cy} r={r2} fill="none" stroke={fg} strokeWidth={h * 0.015} strokeOpacity="0.15" />
      {/* Crosshair lines */}
      <line x1={cx} y1={cy - R - tick} x2={cx} y2={cy + R + tick} stroke={fg} strokeWidth={h * 0.02} strokeOpacity="0.3" />
      <line x1={cx - R - tick} y1={cy} x2={cx + R + tick} y2={cy} stroke={fg} strokeWidth={h * 0.02} strokeOpacity="0.3" />
      {/* North triangle */}
      <polygon points={`${cx},${cy - R * 1.01} ${cx - R * 0.22},${cy - r2 * 0.3} ${cx + R * 0.22},${cy - r2 * 0.3}`} fill={fg} />
      {/* South triangle outline */}
      <polygon points={`${cx},${cy + R * 1.01} ${cx - R * 0.22},${cy + r2 * 0.3} ${cx + R * 0.22},${cy + r2 * 0.3}`} fill={fill} stroke={fg} strokeWidth={h * 0.02} />
      <circle cx={cx} cy={cy} r={R * 0.1} fill={fg} />
      <text x={cx} y={h * 0.09} textAnchor="middle" dominantBaseline="middle" fill={fg} fontFamily="Arial, sans-serif" fontSize={h * 0.14} fontWeight="800" letterSpacing="0.06em">N</text>
    </svg>
  );
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
  const cx = w / 2;
  const cy = h * 0.56;
  const R = h * 0.27;
  const Re = R * 0.71;
  const rn = h * 0.09;
  const r45 = rn * 0.707;
  const nx = cx; const ny = cy - R;
  const sx = cx; const sy = cy + R;
  const ex = cx + Re; const ey = cy;
  const wx = cx - Re; const wy = cy;
  const ne = [cx + r45, cy - r45];
  const se = [cx + r45, cy + r45];
  const sw = [cx - r45, cy + r45];
  const nw = [cx - r45, cy - r45];

  const shared = { w, h, cx, cy, R, Re, rn, r45, nx, ny, sx, sy, ex, ey, wx, wy, ne, se, sw, nw };

  return (
    <div className="template-card north-arrow-card">
      {arrowStyle === 'arrow'      && <Arrow {...shared} />}
      {arrowStyle === 'decorative' && <Decorative {...shared} />}
      {arrowStyle === 'surveyor'   && <Surveyor {...shared} />}
      {(arrowStyle === 'classic' || !arrowStyle) && <Classic {...shared} />}
    </div>
  );
}
