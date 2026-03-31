import React, { useEffect, useMemo, useRef, useState } from 'react';

function intersects(a, b, padding = 10) {
  return !(a.left + a.width + padding < b.left || b.left + b.width + padding < a.left || a.top + a.height + padding < b.top || b.top + b.height + padding < a.top);
}

function resolveCalloutBoxes(callouts, map) {
  if (!map) return [];
  const placed = [];

  callouts
    .slice()
    .sort((a, b) => (a.priority || 2) - (b.priority || 2))
    .forEach((callout) => {
      const anchor = callout.anchor;
      if (!anchor) return;
      const pt = map.latLngToContainerPoint([anchor.lat, anchor.lng]);
      const width = callout.type === 'boxed' ? 188 : callout.type === 'leader' ? 146 : 136;
      const height = callout.type === 'boxed' ? 42 : 24;
      let left = pt.x + (callout.offset?.x || 0);
      let top = pt.y + (callout.offset?.y || 0);
      let candidate = { ...callout, width, height, left, top, anchorPx: pt };

      if (callout.isManualPosition) {
        placed.push(candidate);
        return;
      }

      let attempts = 0;
      while (placed.some((other) => intersects(candidate, other)) && attempts < 8) {
        top += 18;
        left += attempts % 2 === 0 ? 8 : -6;
        candidate = { ...candidate, top, left };
        attempts += 1;
      }

      placed.push(candidate);
    });

  return placed;
}

export default function CalloutsOverlay({ map, callouts, selectedCalloutId, onSelect, onMove, fontFamily }) {
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
      if (!dragRef.current) return;
      const { startX, startY, startOffset, id } = dragRef.current;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      onMove?.(id, { x: startOffset.x + dx, y: startOffset.y + dy, isManualPosition: true });
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
  }, [onMove]);

  const placed = useMemo(() => resolveCalloutBoxes(callouts, map), [callouts, map, tick]);

  return (
    <div className="callouts-overlay">
      {placed.map((callout) => (
        <React.Fragment key={callout.id}>
          <svg className="callout-leader-svg">
            {(callout.type === 'leader' || callout.type === 'boxed') ? (
              <line
                x1={callout.anchorPx.x}
                y1={callout.anchorPx.y}
                x2={callout.left + 10}
                y2={callout.top + callout.height / 2}
                stroke="#102640"
                strokeWidth="1.4"
                strokeDasharray={callout.type === 'leader' ? '5 3' : ''}
              />
            ) : null}
            <circle cx={callout.anchorPx.x} cy={callout.anchorPx.y} r="4" fill="#102640" />
          </svg>
          <div
            className={`map-callout ${callout.type} ${selectedCalloutId === callout.id ? 'selected' : ''}`}
            style={{ left: callout.left, top: callout.top, width: callout.width, minHeight: callout.height, fontFamily: fontFamily || 'Inter, sans-serif' }}
            onClick={() => onSelect?.(callout.id)}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect?.(callout.id);
              dragRef.current = {
                id: callout.id,
                startX: event.clientX,
                startY: event.clientY,
                startOffset: callout.offset || { x: 0, y: 0 },
              };
            }}
          >
            <span>{callout.text}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
