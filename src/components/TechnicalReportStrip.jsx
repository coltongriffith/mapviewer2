import React from 'react';
import { technicalStripPlan } from '../utils/technicalStripLayout.js';

export default function TechnicalReportStrip({ layout, fields, width, height }) {
  const plan = technicalStripPlan(layout, fields, width);
  const y = layout.titleStripPosition === 'top' ? 0 : height - plan.height;
  return <svg role="img" aria-label="Technical report title block" style={{ position: 'absolute', left: 0, top: y, zIndex: 410, pointerEvents: 'none' }} width={width} height={plan.height} viewBox={`0 0 ${width} ${plan.height}`}>
    <rect x=".75" y=".75" width={Math.max(0, width - 1.5)} height={plan.height - 1.5} fill="#fff" stroke="#000" strokeWidth="1.5" />
    {plan.dividers.map((x) => <line key={x} x1={x} x2={x} y1="0" y2={plan.height} stroke="#000" />)}
    {plan.cells.flatMap((cell, index) => cell.lines.map((line, n) => <text key={`${index}-${n}`} x={line.x} y={line.y} fontSize={line.fontSize} fontFamily={line.family} fontWeight={line.bold ? 700 : 400} fontStyle={line.italic ? 'italic' : 'normal'} fill="#000">{line.text}</text>))}
  </svg>;
}
