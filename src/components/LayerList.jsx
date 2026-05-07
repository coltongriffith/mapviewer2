import React from 'react';
import { ROLE_LABELS } from '../projectState';

export default function LayerList({ layers, selectedLayerId, onSelect, onToggleVisible, onRemove }) {
  return (
    <div className="layer-list">
      {layers.map((layer) => (
        <div
          key={layer.id}
          className={`layer-item ${selectedLayerId === layer.id ? 'active' : ''}`}
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
          <div className="layer-item-main">
            <div className="layer-name">{layer.displayName || layer.name || 'Layer'}</div>
            <div className="layer-role">{ROLE_LABELS[layer.role] || 'Layer'}</div>
            {layer.sourceName ? <div className="layer-source">{layer.sourceName}</div> : null}
          </div>
          <button
            type="button"
            className={`layer-visibility ${layer.visible === false ? 'off' : 'on'}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisible?.(layer.id);
            }}
            aria-pressed={layer.visible !== false}
            aria-label={`${layer.displayName || layer.name || 'Layer'} visibility`}
          >
            {layer.visible === false ? 'Hidden' : 'Visible'}
          </button>
          <button
            type="button"
            className="layer-remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove?.(layer.id);
            }}
            aria-label={`Remove ${layer.displayName || layer.name || 'Layer'}`}
            title="Remove layer"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
