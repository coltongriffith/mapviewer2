import React, { useEffect, useMemo, useRef, useState } from 'react';

function intersects(a, b, padding = 10) {
  return !(a.left + a.width + padding < b.left || b.left + b.width + padding < a.left || a.top + a.height + padding < b.top || b.top + b.height + padding < a.top);
}

function estimateBox(callout) {
  const title = callout.text || '';
  const subtext = callout.subtext || '';
  const style = callout.style || {};
  const fontSize = style.fontSize || 12;
  const paddingX = style.paddingX || 10;
  const paddingY = style.paddingY || 8;
  const width = Math.max(136, Math.min(callout.boxWidth || 188, 320));
  const charsPerLine = Math.max(12, Math.floor((width - paddingX * 2) / Math.max(6, fontSize * 0.55)));
  const titleLines = Math.max(1, Math.ceil(title.length / charsPerLine));
  const subtextLines = subtext ? Math.max(1, Math.ceil(subtext.length / charsPerLine)) : 0;
  const titleHeight = titleLines * (fontSize + 3);
  const subtextHeight = subtextLines ? subtextLines * Math.max(11, fontSize - 1) + 6 : 0;
  const height = paddingY * 2 + titleHeight + subtextHeight;
  return { width, height };
}

function resolveCalloutBoxes(callouts, map) {
  if (!map) return [];
  const size = map.getSize();
  const placed = [];
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  callouts
    .slice()
    .sort((a, b) => (a.priority || 2) - (b.priority || 2))
    .forEach((callout) => {
      const anchor = callout.anchor;
      if (!anchor) return;
      const pt = map.latLngToContainerPoint([anchor.lat, anchor.lng]);
      const box = estimateBox(callout);
      let left = pt.x + (callout.offset?.x || 0);
      let top = pt.y + (callout.offset?.y || 0);
      left = clamp(left, 6, Math.max(6, size.x - box.width - 6));
      top = clamp(top, 6, Math.max(6, size.y - box.height - 6));
      let candidate = { ...callout, width: box.width, height: box.height, left, top, anchorPx: pt };

      if (!callout.isManualPosition) {
        let attempts = 0;
        while (placed.some((other) => intersects(candidate, other)) && attempts < 8) {
          top += 18;
          left += attempts % 2 === 0 ? 8 : -6;
          left = clamp(left, 6, Math.max(6, size.x - box.width - 6));
          top = clamp(top, 6, Math.max(6, size.y - box.height - 6));
          candidate = { ...candidate, top, left };
          attempts += 1;
        }
      }

      placed.push(candidate);
    });

  return placed;
}

export default function CalloutsOverlay({ map, callouts, selectedCalloutId, onSelect, onMove, onMoveAnchor, fontFamily }) {
  const [tick, setTick] = useState(0);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!map) return undefined;
    const rerender = () => setTick((value) => value + 1);
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

      if (payload.kind === 'anchor') {
        const nextX = Math.min(size.x - 6, Math.max(6, payload.startAnchor.x + dx));
        const nextY = Math.min(size.y - 6, Math.max(6, payload.startAnchor.y + dy));
        const ll = map.containerPointToLatLng([nextX, nextY]);
        onMoveAnchor?.(payload.id, { lat: ll.lat, lng: ll.lng });
        return;
      }

      const minOffsetX = -payload.anchorPx.x + 6;
      const maxOffsetX = size.x - payload.width - payload.anchorPx.x - 6;
      const minOffsetY = -payload.anchorPx.y + 6;
      const maxOffsetY = size.y - payload.height - payload.anchorPx.y - 6;
      const nextX = Math.min(maxOffsetX, Math.max(minOffsetX, payload.startOffset.x + dx));
      const nextY = Math.min(maxOffsetY, Math.max(minOffsetY, payload.startOffset.y + dy));
      onMove?.(payload.id, { x: nextX, y: nextY, isManualPosition: true });
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
  }, [map, onMove, onMoveAnchor]);

  const placed = useMemo(() => resolveCalloutBoxes(callouts, map), [callouts, map, tick]);

  return (
    <div className="callouts-overlay">
      <svg className="callout-leader-svg">
        {placed.map((callout) => {
          const style = callout.style || {};
          return (
            <React.Fragment key={`${callout.id}-leader`}>
              {(callout.type === 'leader' || callout.type === 'boxed') ? (
                <line
                  x1={callout.anchorPx.x}
                  y1={callout.anchorPx.y}
                  x2={callout.left + 10}
                  y2={callout.top + callout.height / 2}
                  stroke={style.border || '#102640'}
                  strokeWidth="1.4"
                  strokeDasharray={callout.type === 'leader' ? '5 3' : ''}
                />
              ) : null}
              <circle cx={callout.anchorPx.x} cy={callout.anchorPx.y} r="4" fill={style.border || '#102640'} />
            </React.Fragment>
          );
        })}
      </svg>
      {placed.map((callout) => {
        const style = callout.style || {};
        return (
          <React.Fragment key={callout.id}>
            <div
              className={`map-callout ${callout.type} ${selectedCalloutId === callout.id ? 'selected' : ''}`}
              style={{
                left: callout.left,
                top: callout.top,
                width: callout.width,
                minHeight: callout.height,
                fontFamily: fontFamily || 'Inter, sans-serif',
                background: callout.type === 'plain' ? 'transparent' : (style.background || '#ffffff'),
                borderColor: style.border || '#102640',
                color: style.textColor || '#0f172a',
                fontSize: style.fontSize || 12,
                padding: `${style.paddingY || 8}px ${style.paddingX || 10}px`,
              }}
              onClick={() => onSelect?.(callout.id)}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect?.(callout.id);
                dragRef.current = {
                  kind: 'box',
                  id: callout.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  startOffset: callout.offset || { x: 0, y: 0 },
                  anchorPx: callout.anchorPx,
                  width: callout.width,
                  height: callout.height,
                  pointerId: event.pointerId,
                };
              }}
            >
              <div className="map-callout-title">{callout.text}</div>
              {callout.subtext ? <div className="map-callout-subtext" style={{ color: style.subtextColor || '#475569' }}>{callout.subtext}</div> : null}
            </div>
            {selectedCalloutId === callout.id ? (
              <button
                type="button"
                className="callout-anchor-handle"
                style={{ left: callout.anchorPx.x - 7, top: callout.anchorPx.y - 7 }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  dragRef.current = {
                    kind: 'anchor',
                    id: callout.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    startAnchor: { x: callout.anchorPx.x, y: callout.anchorPx.y },
                    pointerId: event.pointerId,
                  };
                }}
                aria-label="Move callout anchor"
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
