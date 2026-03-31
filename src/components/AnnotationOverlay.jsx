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
      const payload = dragRef.current;
      if (payload.pointerId != null && event.pointerId !== payload.pointerId) return;

      const dx = event.clientX - payload.startX;
      const dy = event.clientY - payload.startY;
      const size = map.getSize();

      if (payload.kind === 'marker') {
        const nextPoint = {
          x: Math.min(size.x - 6, Math.max(6, payload.startPoint.x + dx)),
          y: Math.min(size.y - 6, Math.max(6, payload.startPoint.y + dy)),
        };
        const ll = map.containerPointToLatLng([nextPoint.x, nextPoint.y]);
        onMoveMarker?.(payload.id, { lat: ll.lat, lng: ll.lng });
        return;
      }

      if (payload.kind === 'ellipse') {
        const nextPoint = {
          x: Math.min(size.x - 12, Math.max(12, payload.startPoint.x + dx)),
          y: Math.min(size.y - 12, Math.max(12, payload.startPoint.y + dy)),
        };
        const ll = map.containerPointToLatLng([nextPoint.x, nextPoint.y]);
        onMoveEllipse?.(payload.id, { lat: ll.lat, lng: ll.lng });
        return;
      }

      if (payload.kind === 'ellipseLabel') {
        onMoveEllipse?.(payload.id, {
          labelOffsetX: Math.max(-140, Math.min(140, payload.startOffset.x + dx)),
          labelOffsetY: Math.max(-140, Math.min(140, payload.startOffset.y + dy)),
        });
        return;
      }

      if (payload.kind === 'ellipseResize') {
        onMoveEllipse?.(payload.id, {
          width: Math.max(30, Math.min(360, payload.startSize.width + dx)),
          height: Math.max(30, Math.min(360, payload.startSize.height + dy)),
        });
        return;
      }

      if (payload.kind === 'ellipseRotate') {
        const angle = Math.atan2(event.clientY - payload.centerClientY, event.clientX - payload.centerClientX) * (180 / Math.PI);
        onMoveEllipse?.(payload.id, { rotation: angle + 90 });
      }
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
      {placedEllipses.map((ellipse) => {
        const labelOffsetX = ellipse.labelOffsetX || 0;
        const labelOffsetY = ellipse.labelOffsetY || 0;
        return (
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
            {ellipse.label ? (
              <div
                className="ellipse-annotation-label movable"
                style={{ fontFamily: labelFont || 'Inter, sans-serif', transform: `translate(${labelOffsetX}px, ${labelOffsetY}px)` }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectEllipse?.(ellipse.id);
                  dragRef.current = {
                    id: ellipse.id,
                    kind: 'ellipseLabel',
                    startX: e.clientX,
                    startY: e.clientY,
                    startOffset: { x: labelOffsetX, y: labelOffsetY },
                    pointerId: e.pointerId,
                  };
                }}
              >
                {ellipse.label}
              </div>
            ) : null}
            {selectedEllipseId === ellipse.id ? (
              <>
                <button
                  type="button"
                  className="ellipse-handle resize"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dragRef.current = {
                      id: ellipse.id,
                      kind: 'ellipseResize',
                      startX: e.clientX,
                      startY: e.clientY,
                      startSize: { width: ellipse.width, height: ellipse.height },
                      pointerId: e.pointerId,
                    };
                  }}
                  aria-label="Resize highlight area"
                />
                <button
                  type="button"
                  className="ellipse-handle rotate"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dragRef.current = {
                      id: ellipse.id,
                      kind: 'ellipseRotate',
                      centerClientX: e.clientX - (ellipse.width / 2),
                      centerClientY: e.clientY + 28,
                      pointerId: e.pointerId,
                    };
                  }}
                  aria-label="Rotate highlight area"
                />
              </>
            ) : null}
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
              style={{
                width: marker.size,
                height: marker.size,
                '--marker-size': `${marker.size}px`,
                color: marker.color,
                borderColor: marker.color,
                background: marker.type === 'circle' || marker.type === 'square' || marker.type === 'triangle' ? marker.color : 'transparent',
              }}
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
