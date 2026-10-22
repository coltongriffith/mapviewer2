import React from 'react';

// The basemap wash (layout.wash, drawn by utils/geoStyle.js): a white (or any colour) veil over the imagery and
// an edge vignette, under the Style tab's basemap picker. Also the small controls GeoStyleControls uses.

export function Range({ id, label, value, min, max, step = 1, unit = '', onChange }) {
  return (
    <div className="control-row inline-2">
      <div>
        <label htmlFor={id}>{label}</label>
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
      <div className="range-value">{unit === '%' ? `${Math.round(value * 100)}%` : `${value}${unit}`}</div>
    </div>
  );
}
export function Check({ label, checked, onChange, disabled }) {
  return (
    <label className="toggle-row">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
export function Pick({ id, label, value, options, onChange }) {
  return (
    <div className="control-row">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

export default function WashControls({ layout, updateLayout }) {
  const w = layout.wash || {};
  const set = (patch) => {
    const next = { amount: 0, vignette: 0, color: '#ffffff', ...w, ...patch };
    updateLayout({ wash: next.amount > 0 || next.vignette > 0 ? next : null });
  };
  return (
    <div className="control-grid wash-controls" data-testid="wash-controls">
      <Range id="f-wash-amount" label="Wash over the basemap" value={w.amount || 0} min={0} max={0.8} step={0.05} unit="%" onChange={(v) => set({ amount: v })} />
      <Range id="f-wash-vignette" label="Edge vignette" value={w.vignette || 0} min={0} max={1} step={0.05} unit="%" onChange={(v) => set({ vignette: v })} />
      {(w.amount > 0 || w.vignette > 0) && (
        <div className="control-row inline-2">
          <label htmlFor="f-wash-color">Wash colour</label>
          <input id="f-wash-color" type="color" value={w.color || '#ffffff'} onChange={(e) => set({ color: e.target.value })} />
        </div>
      )}
    </div>
  );
}
