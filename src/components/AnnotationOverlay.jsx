import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MarkerSvgIcon, MARKER_ICON_PATHS } from '../utils/markerIcons.jsx';

function shapeClass(type) {
  return ['circle', 'square', 'triangle'].includes(type) ? type : 'icon';
}

function isVectorIcon(type) {
  return type in MARKER_ICON_PATHS;
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
      let w = item.width, h = item.height;
      if (item.isRing && item.radiusKm) {
        const northPt = map.latLngToContainerPoint([item.lat + item.radiusKm / 111.32, item.lng]);
        const pixelR = Math.max(4, Math.abs(pt.y - northPt.y));
        w = pixelR * 2; h = pixelR * 2;
      }
      return { ...item, width: w, height: h, left: pt.x - w / 2, top: pt.y - h / 2, x: pt.x, y: pt.y };
    }
    return { ...item, left: pt.x, top: pt.y, x: pt.x, y: pt.y };
  });
}

function chaikin(points, iterations = 3) {
  let pts = points;
  for (let i = 0; i < iterations; i++) {
    const next = [];
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j], b = pts[(j + 1) % pts.length];
      next.push({ lat: 0.75 * a.lat + 0.25 * b.lat, lng: 0.75 * a.lng + 0.25 * b.lng });
      next.push({ lat: 0.25 * a.lat + 0.75 * b.lat, lng: 0.25 * a.lng + 0.75 * b.lng });
    }
    pts = next;
  }
  return pts;
}

export default function AnnotationOverlay({
  map,
  markers,
  ellipses,
  polygons,
  pendingPolygon,
  selectedMarkerId,
  selectedEllipseId,
  selectedPolygonId,
  onSelectMarker,
  onSelectEllipse,
  onSelectPolygon,
  onMoveMarker,
  onMoveEllipse,
  onMoveLabelOffset,
  onMoveEllipseLabelOffset,
  onMoveEllipseLabelAngle,
  onMovePolygonLabel,
  labelFont,
}) {
  const [tick, setTick] = useState(0);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!map) return undefined;
    const rerender = () => setTick((v) => v + 1);
    map.on('zoomend moveend resize', rerender);
    return () => map.off('zoomend moveend resize', rerender);
  }, [map]);

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current || !map) return;
      const { startX, startY, id, kind, startPoint, pointerId } = dragRef.current;
      if (pointerId != null && event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (kind === 'label') {
        onMoveLabelOffset?.(id, { x: startPoint.x + dx, y: startPoint.y + dy });
        return;
      }
      if (kind === 'ellipse-label') {
        onMoveEllipseLabelOffset?.(id, { x: startPoint.x + dx, y: startPoint.y + dy });
        return;
      }
      if (kind === 'polygon-label-arc') {
        const mapRect = map.getContainer().getBoundingClientRect();
        const mx = event.clientX - mapRect.left;
        const my = event.clientY - mapRect.top;
        const ax = mx - startPoint.x;
        const ay = my - startPoint.y;
        let angle = Math.atan2(ax, -ay) * 180 / Math.PI;
        angle = ((angle % 360) + 360) % 360;
        onMovePolygonLabel?.(id, { angle: Math.round(angle) });
        return;
      }
      if (kind === 'polygon-label') {
        onMovePolygonLabel?.(id, { x: startPoint.x + dx, y: startPoint.y + dy });
        return;
      }
      if (kind === 'ellipse-label-arc') {
        const mapRect = map.getContainer().getBoundingClientRect();
        const mx = event.clientX - mapRect.left;
        const my = event.clientY - mapRect.top;
        const ax = mx - startPoint.x;
        const ay = my - startPoint.y;
        let angle = Math.atan2(ax, -ay) * 180 / Math.PI;
        angle = ((angle % 360) + 360) % 360;
        onMoveEllipseLabelAngle?.(id, Math.round(angle));
        return;
      }

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
  }, [map, onMoveEllipse, onMoveMarker, onMoveLabelOffset, onMoveEllipseLabelOffset, onMoveEllipseLabelAngle]);

  const placedMarkers = useMemo(() => resolvePositions(markers, map, 'marker'), [markers, map, tick]);
  const placedEllipses = useMemo(() => resolvePositions(ellipses, map, 'ellipse'), [ellipses, map, tick]);

  // Polygon screen points (computed fresh on each tick/zoom/pan)
  const polygonScreenPts = useMemo(() => {
    if (!map) return [];
    return (polygons || []).map((poly) => {
      const rawPts = poly.smoothed ? chaikin(poly.points || []) : (poly.points || []);
      return rawPts.map(({ lat, lng }) => {
        const pt = map.latLngToContainerPoint([lat, lng]);
        return { x: pt.x, y: pt.y };
      });
    });
  }, [polygons, map, tick]);

  const pendingScreenPts = useMemo(() => {
    if (!map || !pendingPolygon?.length) return [];
    return pendingPolygon.map(({ lat, lng }) => {
      const pt = map.latLngToContainerPoint([lat, lng]);
      return { x: pt.x, y: pt.y };
    });
  }, [pendingPolygon, map, tick]);

  return (
    <div className="annotation-overlay">
      {/* Non-ring ellipses as divs */}
      {placedEllipses.filter((e) => !e.isRing).map((ellipse) => (
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
          onClick={(e) => { e.stopPropagation(); onSelectEllipse?.(ellipse.id); }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelectEllipse?.(ellipse.id);
            dragRef.current = { id: ellipse.id, kind: 'ellipse', startX: e.clientX, startY: e.clientY, startPoint: { x: ellipse.x, y: ellipse.y }, pointerId: e.pointerId };
          }}
        />
      ))}

      <svg className="annotation-leader-svg" style={{ pointerEvents: 'none' }}>
        {/* Polygon boundaries */}
        {(polygons || []).map((poly, idx) => {
          const pts = polygonScreenPts[idx];
          if (!pts || pts.length < 2) return null;
          const d = `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`;
          const isSelected = selectedPolygonId === poly.id;
          return (
            <g key={`poly-${poly.id}`} style={{ pointerEvents: 'auto' }}>
              {isSelected && <path d={d} fill="none" stroke="rgba(59,130,246,0.5)" strokeWidth={5} style={{ pointerEvents: 'none' }} />}
              <path
                d={d}
                fill="none"
                stroke={poly.color || '#000000'}
                strokeWidth={poly.strokeWidth ?? 2}
                strokeDasharray={poly.dashed === false ? 'none' : '10 5'}
                style={{ pointerEvents: 'none' }}
              />
              {/* Wide invisible hit area */}
              <path
                d={d}
                fill="transparent"
                stroke="transparent"
                strokeWidth={18}
                style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                onClick={(e) => { e.stopPropagation(); onSelectPolygon?.(poly.id); }}
              />
              {poly.arcLabel && poly.label && (() => {
                const pts = polygonScreenPts[idx];
                if (!pts || pts.length < 2) return null;
                const arcD = `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`;
                const arcOffset = `${((poly.labelAngle || 0) / 360) * 100}%`;
                const labelFontSize = poly.labelFontSize || 13;
                const labelColor = poly.labelColor || poly.color || '#000000';
                const pathId = `poly-arc-path-${poly.id}`;
                const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
                const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
                return (
                  <>
                    <defs><path id={pathId} d={arcD} /></defs>
                    <text
                      fontSize={labelFontSize}
                      fontWeight={poly.labelBold !== false ? '700' : '400'}
                      fill={labelColor}
                      fontFamily={labelFont || 'Inter, sans-serif'}
                      style={{ pointerEvents: 'auto', cursor: 'move', userSelect: 'none' }}
                      onClick={(e) => { e.stopPropagation(); onSelectPolygon?.(poly.id); }}
                      onPointerDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        onSelectPolygon?.(poly.id);
                        dragRef.current = {
                          id: poly.id, kind: 'polygon-label-arc',
                          startX: e.clientX, startY: e.clientY,
                          startPoint: { x: cx, y: cy },
                          pointerId: e.pointerId,
                        };
                      }}
                    >
                      <textPath href={`#${pathId}`} startOffset={arcOffset} textAnchor="middle">
                        {poly.label}
                      </textPath>
                    </text>
                  </>
                );
              })()}
            </g>
          );
        })}

        {/* Pending polygon (in-progress drawing) */}
        {pendingScreenPts.length > 0 && (() => {
          const d = pendingScreenPts.length === 1
            ? ''
            : `M ${pendingScreenPts.map((p) => `${p.x} ${p.y}`).join(' L ')}`;
          const first = pendingScreenPts[0];
          return (
            <g style={{ pointerEvents: 'none' }}>
              {d && <path d={d} fill="none" stroke="#3b82f6" strokeWidth={2} strokeDasharray="8 4" />}
              {/* First point close-target circle */}
              <circle cx={first.x} cy={first.y} r={8} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth={1.5} />
              {pendingScreenPts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3} fill="#3b82f6" />
              ))}
            </g>
          );
        })()}

        {/* Distance rings */}
        {placedEllipses.filter((e) => e.isRing).map((ellipse) => {
          const r = ellipse.width / 2;
          const isSelected = selectedEllipseId === ellipse.id;
          const displayLabel = ellipse.label || `${ellipse.radiusKm} km`;
          const labelFontSize = ellipse.labelFontSize || 11;
          const labelColor = ellipse.labelColor || ellipse.color || '#dc2626';

          // Arc text path: full clockwise circle starting at top
          const arcPath = `M ${ellipse.x} ${ellipse.y - r} A ${r} ${r} 0 0 1 ${ellipse.x} ${ellipse.y + r} A ${r} ${r} 0 0 1 ${ellipse.x} ${ellipse.y - r}`;
          const arcOffset = `${((ellipse.labelAngle || 0) / 360) * 100}%`;

          return (
            <g key={`ring-${ellipse.id}`} style={{ pointerEvents: 'auto' }}>
              <defs>
                <path id={`ring-arc-${ellipse.id}`} d={arcPath} />
              </defs>
              {/* Wide invisible hit area */}
              <circle
                cx={ellipse.x} cy={ellipse.y} r={r}
                fill="none" stroke="transparent" strokeWidth={16}
                style={{ cursor: 'move', pointerEvents: 'stroke' }}
                onClick={(e) => { e.stopPropagation(); onSelectEllipse?.(ellipse.id); }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectEllipse?.(ellipse.id);
                  dragRef.current = { id: ellipse.id, kind: 'ellipse', startX: e.clientX, startY: e.clientY, startPoint: { x: ellipse.x, y: ellipse.y }, pointerId: e.pointerId };
                }}
              />
              {/* Visible ring */}
              <circle
                cx={ellipse.x} cy={ellipse.y} r={r}
                fill="none"
                stroke={ellipse.color || '#dc2626'}
                strokeWidth={isSelected ? 2.5 : 2}
                strokeDasharray={ellipse.dashed === false ? 'none' : '10 5'}
                style={{ pointerEvents: 'none' }}
              />
              {isSelected && (
                <circle cx={ellipse.x} cy={ellipse.y} r={r} fill="none" stroke="rgba(59,130,246,0.5)" strokeWidth={4} style={{ pointerEvents: 'none' }} />
              )}

              {/* Arc label */}
              {ellipse.labelArc && (() => {
                const textR = r + labelFontSize * 0.6 + 4;
                const arcPathOuter = `M ${ellipse.x} ${ellipse.y - textR} A ${textR} ${textR} 0 0 1 ${ellipse.x} ${ellipse.y + textR} A ${textR} ${textR} 0 0 1 ${ellipse.x} ${ellipse.y - textR}`;
                return (
                  <>
                    <defs>
                      <path id={`ring-arc-outer-${ellipse.id}`} d={arcPathOuter} />
                    </defs>
                    <text
                      fontSize={labelFontSize}
                      fontWeight={ellipse.labelBold !== false ? '700' : '400'}
                      fill={labelColor}
                      fontFamily={labelFont || 'Inter, sans-serif'}
                      style={{ pointerEvents: 'auto', cursor: 'move', userSelect: 'none' }}
                      onClick={(e) => { e.stopPropagation(); onSelectEllipse?.(ellipse.id); }}
                      onPointerDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        onSelectEllipse?.(ellipse.id);
                        dragRef.current = { id: ellipse.id, kind: 'ellipse-label-arc', startX: e.clientX, startY: e.clientY, startPoint: { x: ellipse.x, y: ellipse.y }, pointerId: e.pointerId };
                      }}
                    >
                      <textPath href={`#ring-arc-outer-${ellipse.id}`} startOffset={arcOffset} textAnchor="middle">
                        {displayLabel}
                      </textPath>
                    </text>
                  </>
                );
              })()}

              {/* Leader line for non-arc label */}
              {!ellipse.labelArc && (() => {
                const pos = ellipseLabelPlacement(ellipse);
                const finalX = pos.labelX + (ellipse.labelOffsetX || 0);
                const finalY = pos.labelY + (ellipse.labelOffsetY || 0);
                return (
                  <line
                    x1={pos.anchorX} y1={pos.anchorY}
                    x2={finalX} y2={finalY + 10}
                    stroke={ellipse.color || '#dc2626'}
                    strokeWidth={1.5} strokeDasharray="5 3"
                    style={{ pointerEvents: 'none' }}
                  />
                );
              })()}
            </g>
          );
        })}

        {/* Leader lines for non-ring ellipses */}
        {placedEllipses.filter((ellipse) => !ellipse.isRing && ellipse.label).map((ellipse) => {
          const pos = ellipseLabelPlacement(ellipse);
          const finalX = pos.labelX + (ellipse.labelOffsetX || 0);
          const finalY = pos.labelY + (ellipse.labelOffsetY || 0);
          return (
            <g key={`ellipse-label-${ellipse.id}`}>
              <line
                x1={pos.anchorX} y1={pos.anchorY}
                x2={finalX} y2={finalY + 10}
                stroke={ellipse.color || '#dc2626'}
                strokeWidth={1.5} strokeDasharray="5 3"
              />
            </g>
          );
        })}

        {/* Map-wide region text labels */}
        {placedMarkers.filter((m) => m.type === 'maplabel').map((m) => (
          <text
            key={`maplabel-${m.id}`}
            x={m.x} y={m.y}
            textAnchor="middle" dominantBaseline="middle"
            fill={m.color || '#1e293b'}
            fillOpacity={m.opacity ?? 0.35}
            fontSize={m.size || 28}
            fontWeight={m.bold !== false ? '700' : '400'}
            fontFamily={labelFont || 'Inter, sans-serif'}
            letterSpacing={`${(m.tracking ?? 0.12)}em`}
            transform={m.rotation ? `rotate(${m.rotation}, ${m.x}, ${m.y})` : undefined}
            style={{ pointerEvents: 'auto', cursor: 'move', userSelect: 'none', textTransform: 'uppercase' }}
            onClick={(e) => { e.stopPropagation(); onSelectMarker?.(m.id); }}
            onPointerDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              onSelectMarker?.(m.id);
              dragRef.current = { id: m.id, kind: 'marker', startX: e.clientX, startY: e.clientY, startPoint: { x: m.x, y: m.y }, pointerId: e.pointerId };
            }}
          >
            {(m.label || '').toUpperCase()}
          </text>
        ))}
      </svg>

      {/* Ellipse labels (non-arc, draggable) */}
      {placedEllipses.filter((ellipse) => (ellipse.label || ellipse.isRing) && !ellipse.labelArc).map((ellipse) => {
        const displayLabel = ellipse.label || (ellipse.isRing ? `${ellipse.radiusKm} km` : null);
        if (!displayLabel) return null;
        const pos = ellipseLabelPlacement(ellipse);
        const finalX = pos.labelX + (ellipse.labelOffsetX || 0);
        const finalY = pos.labelY + (ellipse.labelOffsetY || 0);
        return (
          <div
            key={`ellipse-tag-${ellipse.id}`}
            className="ellipse-annotation-label with-leader"
            style={{
              left: finalX,
              top: finalY,
              fontFamily: labelFont || 'Inter, sans-serif',
              fontSize: ellipse.labelFontSize || 11,
              fontWeight: ellipse.labelBold !== false ? '700' : '400',
              color: ellipse.labelColor || ellipse.color || '#dc2626',
              cursor: 'move',
              pointerEvents: 'auto',
            }}
            onClick={(e) => { e.stopPropagation(); onSelectEllipse?.(ellipse.id); }}
            onPointerDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              onSelectEllipse?.(ellipse.id);
              dragRef.current = {
                id: ellipse.id, kind: 'ellipse-label',
                startX: e.clientX, startY: e.clientY,
                startPoint: { x: ellipse.labelOffsetX || 0, y: ellipse.labelOffsetY || 0 },
                pointerId: e.pointerId,
              };
            }}
          >
            {displayLabel}
          </div>
        );
      })}

      {/* Polygon labels (draggable) */}
      {(polygons || []).filter((poly) => poly.label && !poly.arcLabel).map((poly, idx) => {
        const pts = polygonScreenPts[idx];
        if (!pts || !pts.length) return null;
        // Position at top of bounding box
        const minY = Math.min(...pts.map((p) => p.y));
        const midX = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
        const baseX = midX + (poly.labelOffsetX || 0);
        const baseY = minY - 18 + (poly.labelOffsetY || 0);
        return (
          <div
            key={`poly-label-${poly.id}`}
            className="ellipse-annotation-label"
            style={{
              left: baseX,
              top: baseY,
              transform: 'translateX(-50%)',
              fontFamily: labelFont || 'Inter, sans-serif',
              fontSize: poly.labelFontSize || 12,
              fontWeight: poly.labelBold !== false ? '700' : '400',
              color: poly.labelColor || poly.color || '#000000',
              cursor: 'move',
              pointerEvents: 'auto',
              whiteSpace: 'nowrap',
            }}
            onClick={(e) => { e.stopPropagation(); onSelectPolygon?.(poly.id); }}
            onPointerDown={(e) => {
              e.preventDefault(); e.stopPropagation();
              onSelectPolygon?.(poly.id);
              dragRef.current = {
                id: poly.id, kind: 'polygon-label',
                startX: e.clientX, startY: e.clientY,
                startPoint: { x: poly.labelOffsetX || 0, y: poly.labelOffsetY || 0 },
                pointerId: e.pointerId,
              };
            }}
          >
            {poly.label}
          </div>
        );
      })}

      {placedMarkers.filter((m) => m.type !== 'maplabel').map((marker) => {
        const size = marker.size || 22;
        const color = marker.color || '#d97706';
        const labelOffsetX = marker.labelOffsetX ?? (size / 2 + 6);
        const labelOffsetY = marker.labelOffsetY ?? -(size / 2);

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
            {isVectorIcon(marker.type) ? (
              <MarkerSvgIcon type={marker.type} size={size} color={color} />
            ) : (
              <div
                className={`free-marker-symbol ${shapeClass(marker.type)}`}
                style={{
                  width: size,
                  height: size,
                  color,
                  borderColor: color,
                  background: ['circle', 'square', 'triangle'].includes(marker.type) ? color : 'transparent',
                }}
              />
            )}

            {marker.label ? (
              <div
                className="free-marker-label"
                style={{
                  fontFamily: labelFont || 'Inter, sans-serif',
                  position: 'absolute',
                  left: labelOffsetX,
                  top: labelOffsetY,
                  whiteSpace: 'nowrap',
                  cursor: 'move',
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dragRef.current = {
                    id: marker.id,
                    kind: 'label',
                    startX: e.clientX,
                    startY: e.clientY,
                    startPoint: { x: labelOffsetX, y: labelOffsetY },
                    pointerId: e.pointerId,
                  };
                }}
              >
                {marker.label}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
