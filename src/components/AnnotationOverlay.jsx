import React, { useEffect, useMemo, useRef, useState } from 'react';

function markerGlyph(type) {
  if (type === 'pickaxe') return '⛏';
  if (type === 'shovel') return '⚒';
  return null;
}

function shapeClass(type) {
  return ['circle', 'square', 'triangle'].includes(type) ? type : 'icon';
}


function ellipseLabelPlacement(ellipse) {
  const anchorX = ellipse.x + ellipse.width * 0.34;
  const anchorY = ellipse.y - ellipse.height * 0.24;
  const labelX = anchorX + 16;
  const labelY = anchorY - 24;
  return { anchorX, anchorY, labelX, labelY };
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
      const { startX, startY, id, kind, startPoint, pointerId } = dragRef.current;
      if (pointerId != null && event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const nextPoint = { x: startPoint.x + dx, y: startPoint.y + dy };
      const ll = map.containerPointToLatLng([nextPoint.x, nextPoint.y]);
      if (kind === 'marker') onMoveMarker?.(id, { lat: ll.lat, lng: ll.lng });
      if (kind === 'ellipse') onMoveEllipse?.(id, { lat: ll.lat, lng: ll.lng });
    };
    const handleUp = (event) => {
      if (dragRef.current?.pointerId != null && event.pointerId !== dragRef.current.pointerId) return;
      dragRef.current = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
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
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelectEllipse?.(ellipse.id);
            dragRef.current = { id: ellipse.id, kind: 'ellipse', startX: e.clientX, startY: e.clientY, startPoint: { x: ellipse.x, y: ellipse.y }, pointerId: e.pointerId };
          }}
        >
          {null}
        </div>
      ))}

      <svg className="annotation-leader-svg" aria-hidden="true">
        {placedEllipses.filter((ellipse) => ellipse.label).map((ellipse) => {
          const pos = ellipseLabelPlacement(ellipse);
          return (
            <g key={`ellipse-label-${ellipse.id}`}>
              <line
                x1={pos.anchorX}
                y1={pos.anchorY}
                x2={pos.labelX}
                y2={pos.labelY + 10}
                stroke={ellipse.color || '#dc2626'}
                strokeWidth={1.5}
                strokeDasharray="5 3"
              />
            </g>
          );
        })}
      </svg>

      {placedEllipses.filter((ellipse) => ellipse.label).map((ellipse) => {
        const pos = ellipseLabelPlacement(ellipse);
        return (
          <div
            key={`ellipse-tag-${ellipse.id}`}
            className="ellipse-annotation-label with-leader"
            style={{ left: pos.labelX, top: pos.labelY, fontFamily: labelFont || 'Inter, sans-serif' }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectEllipse?.(ellipse.id);
            }}
          >
            {ellipse.label}
          </div>
        );
      })}

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
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelectMarker?.(marker.id);
              dragRef.current = { id: marker.id, kind: 'marker', startX: e.clientX, startY: e.clientY, startPoint: { x: marker.x, y: marker.y }, pointerId: e.pointerId };
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
