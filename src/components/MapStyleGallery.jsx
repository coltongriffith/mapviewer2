import React from 'react';
import { MAP_TYPES, TEMPLATE_THEMES } from '../projectState';
import { getThemeTokens } from '../utils/themeTokens';

// Finished-map exports from public/gallery, one per map type, so a card shows
// the kind of map it makes rather than describing it.
const CARD_TEXT = {
  investor: { name: 'Investor', sub: 'Property in district context', thumb: '/gallery/regional.webp' },
  claims: { name: 'Property & Neighbours', sub: 'Claims & tenure · your data and brand', thumb: '/gallery/claims.webp' },
  drill: { name: 'Drill results', sub: 'Collars and intercepts', thumb: '/gallery/drill-results.webp' },
  infrastructure: { name: 'Infrastructure', sub: 'Roads, power and access', thumb: '/gallery/infrastructure.webp' },
  ni_43101: { name: 'NI 43-101 figure', sub: 'Coordinate frame, title block', thumb: '/gallery/target.webp' },
};

/**
 * One card per map type. A card applies template + mode + theme together,
 * exactly as the old "Map type" dropdown did; "Custom" is shown as selected
 * whenever those three no longer match a preset.
 */
export default function MapStyleGallery({ value, onSelect, onCustom }) {
  return (
    <div className="style-cards" role="radiogroup" aria-label="Map style">
      {Object.entries(MAP_TYPES).map(([id, t]) => {
        const text = CARD_TEXT[id] || { name: t.label, sub: '' };
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            className={`style-card${value === id ? ' is-on' : ''}`}
            title={t.note}
            onClick={() => onSelect(id)}
          >
            {text.thumb
              ? <img className="style-card-thumb" src={text.thumb} alt="" loading="lazy" draggable={false} />
              : <span className="style-card-thumb style-card-thumb--blank" aria-hidden="true" />}
            <span className="style-card-name">{text.name}</span>
            {text.sub && <span className="style-card-sub">{text.sub}</span>}
          </button>
        );
      })}
      <button
        type="button"
        role="radio"
        aria-checked={value === 'custom'}
        className={`style-card${value === 'custom' ? ' is-on' : ''}`}
        title="Template, mode and theme set individually"
        onClick={onCustom}
      >
        <span className="style-card-thumb style-card-thumb--blank" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
          </svg>
        </span>
        <span className="style-card-name">Custom</span>
        <span className="style-card-sub">Pick template and mode</span>
      </button>
    </div>
  );
}

/**
 * Theme swatches drawn from the same tokens the map and the export use, so a
 * swatch cannot show one look while the theme renders another.
 */
export function ThemePicker({ value, onChange }) {
  return (
    <div className="theme-chips" role="radiogroup" aria-label="Theme">
      {Object.entries(TEMPLATE_THEMES).map(([id, label]) => {
        const tk = getThemeTokens(id);
        const radius = Math.min(4, Number(tk.panelRadius) || 0);
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            className={`theme-chip${value === id ? ' is-on' : ''}`}
            onClick={() => onChange(id)}
          >
            <span
              className="theme-chip-swatch"
              aria-hidden="true"
              style={{ background: tk.panelFill, borderColor: tk.panelBorder, borderRadius: radius }}
            >
              <span style={{ background: tk.titleFill, borderBottom: tk.titleAccent ? `2px solid ${tk.titleAccent}` : 'none' }} />
              <i style={{ background: tk.bodyText }} />
              <i style={{ background: tk.bodyText, width: '40%' }} />
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
