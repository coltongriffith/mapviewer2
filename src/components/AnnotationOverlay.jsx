import React, { useEffect, useMemo, useRef, useState } from 'react';

function markerGlyph(type) {
  if (type === 'pickaxe') return '⛏';
  if (type === 'shovel') return '⚒';
  return null;
}

function shapeClass(type) {
  return ['circle', 'square', 'triangle'].includes(type) ? type : 'icon';
}

function resolvePositions(items, map, kind) {
  if (!map) return [];
  return items.map((item) => {
    const pt = map.latLngToContainerPoint([item.lat, item.lng]);
    if (kind === 'ellipse') {
      return { ...item, left: pt.x - item.width / 2, top: pt.y - item.height / 2, x: pt.x, y: pt.y };
    }
    return { ...item, left: pt.x, top: pt.y, x: pt.x, y: pt.y };
  });
}

export default function AnnotationOverlay({
  map,
  markers,
  ellipses,
  selectedMarkerId,
  selectedEllipseId,
  onSelectMarker,
  onSelectEllipse,
  onMoveMarker,
  onMoveEllipse,
  labelFont,
}) {
  const [tick, setTick] = useState(0);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!map) return undefined;
    const rerender = () => setTick((v) => v + 1);
    map.on('move zoom zoomend moveend resize', rerender);
    return () => map.off('move zoom zoomend moveend resize', rerender);
  }, [map]);

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current || !map) return;
      const { startX, startY, id, kind, startPoint } = dragRef.current;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const nextPoint = { x: startPoint.x + dx, y: startPoint.y + dy };
      const ll = map.containerPointToLatLng([nextPoint.x, nextPoint.y]);
      if (kind === 'marker') onMoveMarker?.(id, { lat: ll.lat, lng: ll.lng });
      if (kind === 'ellipse') onMoveEllipse?.(id, { lat: ll.lat, lng: ll.lng });
    };
    const handleUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [map, onMoveEllipse, onMoveMarker]);

  const placedMarkers = useMemo(() => resolvePositions(markers, map, 'marker'), [markers, map, tick]);
  const placedEllipses = useMemo(() => resolvePositions(ellipses, map, 'ellipse'), [ellipses, map, tick]);

  return (
    <div className="annotation-overlay">
      {placedEllipses.map((ellipse) => (
        <div
          key={ellipse.id}
          className={`ellipse-annotation ${selectedEllipseId === ellipse.id ? 'selected' : ''}`}
          style={{
            left: ellipse.left,
            top: ellipse.top,
            width: ellipse.width,
            height: ellipse.height,
            borderColor: ellipse.color,
            borderStyle: ellipse.dashed === false ? 'solid' : 'dashed',
            transform: `rotate(${ellipse.rotation || 0}deg)`,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onSelectEllipse?.(ellipse.id);
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelectEllipse?.(ellipse.id);
            dragRef.current = { id: ellipse.id, kind: 'ellipse', startX: e.clientX, startY: e.clientY, startPoint: { x: ellipse.x, y: ellipse.y } };
          }}
        >
          {ellipse.label ? <div className="ellipse-annotation-label" style={{ fontFamily: labelFont || 'Inter, sans-serif' }}>{ellipse.label}</div> : null}
        </div>
      ))}

      {placedMarkers.map((marker) => {
        const glyph = markerGlyph(marker.type);
        return (
          <div
            key={marker.id}
            className={`free-marker ${selectedMarkerId === marker.id ? 'selected' : ''}`}
            style={{ left: marker.left, top: marker.top }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectMarker?.(marker.id);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelectMarker?.(marker.id);
              dragRef.current = { id: marker.id, kind: 'marker', startX: e.clientX, startY: e.clientY, startPoint: { x: marker.x, y: marker.y } };
            }}
          >
            <div
              className={`free-marker-symbol ${shapeClass(marker.type)}`}
              style={{ width: marker.size, height: marker.size, color: marker.color, borderColor: marker.color, background: marker.type === 'circle' || marker.type === 'square' || marker.type === 'triangle' ? marker.color : 'transparent' }}
            >
              {glyph}
            </div>
            {marker.label ? <div className="free-marker-label" style={{ fontFamily: labelFont || 'Inter, sans-serif' }}>{marker.label}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
