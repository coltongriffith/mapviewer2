import React, { useEffect, useMemo, useState } from 'react';

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
      const width = callout.type === 'drill_result' ? 210 : callout.type === 'phase1_target' ? 192 : callout.type === 'boxed' ? 188 : callout.type === 'leader' ? 146 : 136;
      const height = callout.type === 'drill_result' ? 58 : callout.type === 'phase1_target' ? 48 : callout.type === 'boxed' ? 42 : 24;
      let left = pt.x + (callout.offset?.x || 0);
      let top = pt.y + (callout.offset?.y || 0);
      let candidate = { ...callout, width, height, left, top, anchorPx: pt };

      let attempts = 0;
      while (placed.some((other) => intersects(candidate, other)) && attempts < 8) {
        top += 18;
        left += attempts % 2 === 0 ? 8 : -6;
        candidate = { ...candidate, top, left };
        attempts += 1;
      }

      if (!placed.some((other) => intersects(candidate, other, 2))) {
        placed.push(candidate);
      }
    });

  return placed;
}

export default function CalloutsOverlay({ map, callouts }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!map) return undefined;
    const rerender = () => setTick((value) => value + 1);
    map.on('move zoom zoomend moveend resize', rerender);
    return () => map.off('move zoom zoomend moveend resize', rerender);
  }, [map]);

  const placed = useMemo(() => resolveCalloutBoxes(callouts, map), [callouts, map, tick]);

  return (
    <div className="callouts-overlay">
      {placed.map((callout) => {
        const isDrillResult = callout.type === 'drill_result';
        const isPhase1 = callout.type === 'phase1_target';
        const hasLeader = callout.type === 'leader' || callout.type === 'boxed' || isDrillResult;
        const leaderColor = isDrillResult ? 'rgba(200,168,75,0.7)' : '#102640';
        const leaderDash = (callout.type === 'leader' || isDrillResult) ? '4 3' : '';

        return (
          <React.Fragment key={callout.id}>
            {hasLeader ? (
              <svg className="callout-leader-svg">
                <line
                  x1={callout.anchorPx.x}
                  y1={callout.anchorPx.y}
                  x2={callout.left + 10}
                  y2={callout.top + callout.height / 2}
                  stroke={leaderColor}
                  strokeWidth="1"
                  strokeDasharray={leaderDash}
                />
              </svg>
            ) : null}
            <div
              className={`map-callout ${callout.type.replace('_', '-')}`}
              style={{ left: callout.left, top: callout.top, width: callout.width, minHeight: callout.height }}
            >
              {isDrillResult ? (
                <>
                  <div className="drill-result-header">
                    <div className="drill-result-diamond" />
                    <div className="drill-result-holeid">{callout.holeId || callout.text}</div>
                  </div>
                  {callout.result ? <div className="drill-result-value">{callout.result}</div> : null}
                  {callout.incl ? (
                    <div className="drill-result-incl">
                      incl. <span>{callout.incl}</span>
                    </div>
                  ) : null}
                  {!callout.result && !callout.holeId ? <span>{callout.text}</span> : null}
                </>
              ) : isPhase1 ? (
                <>
                  <div className="phase1-header">{callout.header || 'Phase 1 Target Area'}</div>
                  <div className="phase1-body">
                    <div className="phase1-dot" />
                    <div className="phase1-text">{callout.text}</div>
                  </div>
                </>
              ) : callout.type === 'town_label' ? (
                <>
                  <span className="town-label-dot" />
                  <span>{callout.text}</span>
                </>
              ) : (
                <span>{callout.text}</span>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
