import React, { useEffect, useMemo, useRef, useState } from 'react';
import { resolveCalloutBoxes, leaderEndpoint } from '../utils/calloutLayout';
import { computeSnap } from '../utils/layout';

export default function CalloutsOverlay({ map, callouts, selectedCalloutId, onSelect, onMove, onUpdate, fontFamily }) {
  const [tick, setTick] = useState(0);
  const [editingField, setEditingField] = useState(null);
  const [snapGuides, setSnapGuides] = useState([]);
  const dragRef = useRef(null);

  useEffect(() => { setEditingField(null); }, [selectedCalloutId]);

  useEffect(() => {
    if (!map) return undefined;
    const rerender = () => setTick((value) => value + 1);
    map.on('zoomend moveend resize', rerender);
    return () => map.off('zoomend moveend resize', rerender);
  }, [map]);

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current) return;
      const { startX, startY, startOffset, startWidth, startAbsX, startAbsY, boxW, boxH, snapEls, containerW, containerH, id, kind, pointerId } = dragRef.current;
      if (pointerId != null && event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;

      if (kind === 'resize') {
        const newWidth = Math.max(100, Math.min(400, Math.round(startWidth + dx)));
        onUpdate?.(id, { boxWidth: newWidth });
        return;
      }

      const dy = event.clientY - startY;
      const newAbsX = startAbsX + dx;
      const newAbsY = startAbsY + dy;
      const snap = computeSnap(newAbsX, newAbsY, boxW, boxH, snapEls, containerW, containerH, id);
      const snapDx = snap.x - newAbsX;
      const snapDy = snap.y - newAbsY;
      setSnapGuides(snap.guides);
      onMove?.(id, { x: startOffset.x + dx + snapDx, y: startOffset.y + dy + snapDy, isManualPosition: true });
    };

    const handleUp = (event) => {
      if (dragRef.current?.pointerId != null && event.pointerId !== dragRef.current.pointerId) return;
      dragRef.current = null;
      setSnapGuides([]);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [onMove, onUpdate]);

  const placed = useMemo(() => resolveCalloutBoxes(callouts, map), [callouts, map, tick]);

  return (
    <div className="callouts-overlay">
      {snapGuides.map((g, i) => (
        <div key={i} style={{ position: 'absolute', pointerEvents: 'none', zIndex: 9999, background: 'rgba(80,180,255,0.7)', ...(g.type === 'v' ? { left: g.pos, top: 0, width: 1, height: '100%' } : { top: g.pos, left: 0, height: 1, width: '100%' }) }} />
      ))}
      <svg className="callout-leader-svg">
        {placed.map((callout) => {
          const style = callout.style || {};
          return (
            <React.Fragment key={`${callout.id}-leader`}>
              {(callout.type === 'leader' || callout.type === 'boxed') ? (() => {
                const ep = leaderEndpoint(callout.anchorPx, callout);
                return (
                  <line
                    x1={callout.anchorPx.x}
                    y1={callout.anchorPx.y}
                    x2={ep.x}
                    y2={ep.y}
                    stroke={style.border || '#102640'}
                    strokeWidth="1.4"
                    strokeDasharray={callout.type === 'leader' ? '5 3' : ''}
                  />
                );
              })() : null}
            </React.Fragment>
          );
        })}
      </svg>
      {placed.map((callout) => {
        const style = callout.style || {};
        return (
          <div
            key={callout.id}
            className={`map-callout ${callout.type} ${selectedCalloutId === callout.id ? 'selected' : ''}`}
            style={{
              position: 'absolute',
              left: callout.left,
              top: callout.top,
              width: callout.width,
              minHeight: callout.height,
              fontFamily: `${fontFamily || 'Inter'}, Arial, Helvetica, sans-serif`,
              ...(callout.type === 'badge' ? {
                background: 'transparent',
                padding: 0,
                overflow: 'hidden',
                borderColor: 'transparent',
              } : {
                background: callout.type === 'plain' ? 'transparent' : (style.background || '#ffffff'),
                borderColor: style.border || '#102640',
                color: style.textColor || '#0f172a',
                fontSize: style.fontSize || 12,
                textAlign: style.textAlign || 'left',
                padding: `${style.paddingY || 8}px ${style.paddingX ?? Math.max(4, Math.min(10, (callout.width || 160) * 0.06))}px`,
              }),
            }}
            onClick={() => onSelect?.(callout.id)}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect?.(callout.id);
              const size = map?.getSize() || { x: 1200, y: 800 };
              dragRef.current = {
                id: callout.id,
                startX: event.clientX,
                startY: event.clientY,
                startOffset: callout.offset || { x: 0, y: 0 },
                startAbsX: callout.left,
                startAbsY: callout.top,
                boxW: callout.width || 160,
                boxH: callout.height || 40,
                snapEls: placed
                  .filter((c) => c.id !== callout.id)
                  .map((c) => ({ id: c.id, x: c.left, y: c.top, w: c.width || 160, h: c.height || 40 })),
                containerW: size.x,
                containerH: size.y,
                pointerId: event.pointerId,
              };
            }}
          >
            {callout.type === 'badge' ? (
              <div className="badge-callout" style={{ fontFamily: `${fontFamily || 'Inter'}, Arial, Helvetica, sans-serif`, fontSize: style.fontSize || 12 }}>
                <div className="badge-chip" style={{ background: callout.badgeColor || '#d97706' }}>
                  {callout.badgeValue || '—'}
                </div>
                <div className="badge-label" style={{ background: style.background || '#ffffff', color: style.textColor || '#0f172a' }}>
                  {callout.text}
                </div>
              </div>
            ) : (
              <>
                {editingField?.id === callout.id && editingField?.field === 'text' ? (
                  <input
                    autoFocus
                    defaultValue={callout.text}
                    className="map-callout-title-input"
                    onBlur={(e) => { onUpdate?.(callout.id, { text: e.target.value }); setEditingField(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingField(null); }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div
                    className="map-callout-title"
                    style={{ cursor: selectedCalloutId === callout.id ? 'text' : 'default' }}
                    onClick={(e) => { if (selectedCalloutId === callout.id) { e.stopPropagation(); setEditingField({ id: callout.id, field: 'text' }); } }}
                  >
                    {callout.text}
                  </div>
                )}
                {callout.subtext ? (
                  editingField?.id === callout.id && editingField?.field === 'subtext' ? (
                    <input
                      autoFocus
                      defaultValue={callout.subtext}
                      className="map-callout-subtext-input"
                      style={{ color: style.subtextColor || '#475569' }}
                      onBlur={(e) => { onUpdate?.(callout.id, { subtext: e.target.value }); setEditingField(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingField(null); }}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div
                      className="map-callout-subtext"
                      style={{ color: style.subtextColor || '#475569', cursor: selectedCalloutId === callout.id ? 'text' : 'default' }}
                      onClick={(e) => { if (selectedCalloutId === callout.id) { e.stopPropagation(); setEditingField({ id: callout.id, field: 'subtext' }); } }}
                    >
                      {callout.subtext}
                    </div>
                  )
                ) : null}
              </>
            )}
            {selectedCalloutId === callout.id && (
              <div
                className="callout-resize-handle"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dragRef.current = {
                    id: callout.id,
                    kind: 'resize',
                    startX: e.clientX,
                    startWidth: callout.width,
                    pointerId: e.pointerId,
                  };
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
