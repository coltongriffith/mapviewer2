import React from 'react';
import { ROLE_LABELS } from '../projectState';

export default function LayerList({ layers, selectedLayerId, onSelect, onToggleVisible }) {
  return (
    <div className="layer-list">
      {layers.map((layer) => (
        <button
          type="button"
          key={layer.id}
          className={`layer-item ${selectedLayerId === layer.id ? 'active' : ''}`}
          onClick={() => onSelect?.(layer.id)}
        >
          <div className="layer-item-main">
            <div className="layer-name">{layer.displayName || layer.name || 'Layer'}</div>
            <div className="layer-role">{ROLE_LABELS[layer.role] || 'Layer'}</div>
            {layer.sourceName ? <div className="layer-source">{layer.sourceName}</div> : null}
          </div>
          <span
            className={`layer-visibility ${layer.visible === false ? 'off' : 'on'}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisible?.(layer.id);
            }}
          >
            {layer.visible === false ? 'Hidden' : 'Visible'}
          </span>
        </button>
      ))}
    </div>
  );
}
