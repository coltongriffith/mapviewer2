import React from 'react';
import { EXPORT_RATIOS } from '../constants';

const RATIO_ICONS = {
  landscape: (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="16" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  square: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  portrait: (
    <svg width="11" height="15" viewBox="0 0 11 15" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="9" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
};

export default function RatioSwitcher({ activeRatio, onRatioChange }) {
  return (
    <div className="ratio-switcher">
      <label className="ratio-switcher-label">Export Ratio</label>
      <div className="ratio-switcher-btns">
        {Object.values(EXPORT_RATIOS).map((r) => (
          <button
            key={r.id}
            type="button"
            className={`ratio-btn${activeRatio === r.id ? ' active' : ''}`}
            onClick={() => onRatioChange(activeRatio === r.id ? null : r.id)}
            title={`${r.label} (${r.description})`}
            aria-pressed={activeRatio === r.id}
          >
            {RATIO_ICONS[r.id]}
            <span className="ratio-btn-label">{r.label}</span>
            <span className="ratio-btn-desc">{r.description}</span>
          </button>
        ))}
      </div>
      {activeRatio && (
        <p className="ratio-switcher-hint">
          Map is constrained to {EXPORT_RATIOS[activeRatio].description}. Pan and zoom to frame your export, then click Export.
        </p>
      )}
    </div>
  );
}
