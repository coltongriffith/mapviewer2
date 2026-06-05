import React from 'react';

export default function NorthArrow({ scale = 100 }) {
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
  const fg = 'var(--north-fg, #122033)';
  return (
    <div className="template-card north-arrow-card">
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
        <path d={`M ${nx} ${ny} L ${ne[0]} ${ne[1]} L ${cx} ${cy} L ${nw[0]} ${nw[1]} Z`} fill={fg} />
        <path d={`M ${sx} ${sy} L ${sw[0]} ${sw[1]} L ${cx} ${cy} L ${se[0]} ${se[1]} Z`} fill={fg} fillOpacity="0.55" />
        <path d={`M ${ex} ${ey} L ${se[0]} ${se[1]} L ${cx} ${cy} L ${ne[0]} ${ne[1]} Z`} fill={fg} fillOpacity="0.35" />
        <path d={`M ${wx} ${wy} L ${nw[0]} ${nw[1]} L ${cx} ${cy} L ${sw[0]} ${sw[1]} Z`} fill={fg} fillOpacity="0.35" />
        <circle cx={cx} cy={cy} r={R + rn * 0.5} fill="none" stroke={fg} strokeOpacity="0.2" strokeWidth={h * 0.012} />
        <circle cx={cx} cy={cy} r={h * 0.044} fill="var(--north-fill, rgba(255,255,255,0.95))" stroke={fg} strokeWidth={h * 0.018} />
        <text x={cx} y={h * 0.14} textAnchor="middle" dominantBaseline="middle" fill={fg} fontFamily="Arial, sans-serif" fontSize={h * 0.16} fontWeight="700">N</text>
      </svg>
    </div>
  );
}
