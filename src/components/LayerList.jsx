import React from 'react';
import { ROLE_LABELS } from '../projectState';

/** The colour the layer actually draws with, so the row identifies itself. */
function LayerSwatch({ layer }) {
  const style = layer.style || {};
  const stroke = style.stroke || style.markerColor || '#5f6e72';
  const isPoint = layer.type === 'points' || !!style.markerColor;
  if (isPoint) {
    return (
      <span
        className="layer-swatch layer-swatch--point"
        style={{ borderColor: stroke, background: style.markerFill || '#ffffff' }}
        aria-hidden="true"
      />
    );
  }
  const fill = style.fill || stroke;
  const opacity = style.fillOpacity ?? 0.25;
  return (
    <span
      className="layer-swatch"
      style={{
        borderColor: stroke,
        borderStyle: style.dashArray ? 'dashed' : 'solid',
        background: opacity > 0 ? fill : 'transparent',
        opacity: opacity > 0 ? Math.max(0.35, Math.min(1, opacity + 0.35)) : 1,
      }}
      aria-hidden="true"
    />
  );
}

export default function LayerList({ layers, selectedLayerId, onSelect, onToggleVisible, onRemove }) {
  return (
    <div className="layer-list">
      {layers.map((layer) => {
        const name = layer.displayName || layer.name || 'Layer';
        const hidden = layer.visible === false;
        return (
          <div
            key={layer.id}
            className={`layer-item ${selectedLayerId === layer.id ? 'active' : ''}${hidden ? ' layer-item--hidden' : ''}`}
            onClick={() => onSelect?.(layer.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(layer.id);
              }
            }}
          >
            {/* Visibility reads as an eye, not a word: it is the control people
                hit most, and a text pill on every row made the list shout. The
                accessible name and aria-pressed state are unchanged. */}
            <button
              type="button"
              className="layer-visibility"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisible?.(layer.id);
              }}
              aria-pressed={!hidden}
              aria-label={`${name} visibility`}
              title={hidden ? 'Show layer' : 'Hide layer'}
            >
              {hidden ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M3 3l18 18" strokeLinecap="round" />
                  <path d="M10.6 6.2A9.6 9.6 0 0112 6c6.2 0 10 6 10 6a17 17 0 01-3.3 3.9M6.5 8.1A17 17 0 002 12s3.8 6 10 6a9.7 9.7 0 004-.85" />
                  <path d="M9.9 9.9a3 3 0 004.2 4.2" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6z" />
                  <circle cx="12" cy="12" r="2.6" />
                </svg>
              )}
            </button>
            <LayerSwatch layer={layer} />
            <div className="layer-item-main">
              <div className="layer-name">{name}</div>
              <div className="layer-role">
                {ROLE_LABELS[layer.role] || 'Layer'}
                {layer.sourceName ? <span className="layer-source">· {layer.sourceName}</span> : null}
              </div>
            </div>
            <button
              type="button"
              className="layer-remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove?.(layer.id);
              }}
              aria-label={`Remove ${name}`}
              title="Remove layer"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
