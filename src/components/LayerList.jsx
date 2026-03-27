export default function LayerList({ layers, selectedLayerId, onSelect, onToggleVisible }) {
  return (
    <div className="layer-list">
      {layers.map((layer) => (
        <button
          key={layer.id}
          className={`layer-item ${selectedLayerId === layer.id ? 'active' : ''}`}
          type="button"
          onClick={() => onSelect(layer.id)}
        >
          <div>
            <div className="layer-name">{layer.displayName || layer.legend?.label || layer.name}</div>
            <div className="layer-role">{layer.sourceName || layer.name}</div>
            <div className="layer-role secondary">{layer.role?.replaceAll('_', ' ')}</div>
          </div>
          <span
            className={`layer-visibility ${layer.visible === false ? 'off' : 'on'}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisible(layer.id);
            }}
          >
            {layer.visible === false ? 'Hidden' : 'Visible'}
          </span>
        </button>
      ))}
    </div>
  );
}
