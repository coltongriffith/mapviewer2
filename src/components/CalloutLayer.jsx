import React from "react";

function styleFor(callout, template) {
  const s = template.calloutStyle;
  const dx = callout.offset?.x || 0;
  const dy = callout.offset?.y || 0;
  return {
    left: `calc(${callout.anchor.x}% + ${dx}px)`,
    top: `calc(${callout.anchor.y}% + ${dy}px)`,
    background: s.background,
    color: s.text,
    border: `${callout.hero ? 2 : 1}px solid ${callout.hero ? s.accent : "#222"}`,
  };
}

export default function CalloutLayer({ callouts, template, onNudge }) {
  return (
    <>
      {callouts.map((callout) => {
        const dx = callout.offset?.x || 0;
        const dy = callout.offset?.y || 0;
        return (
          <div key={callout.id} className="callout" style={styleFor(callout, template)}>
            <svg className="callout-leader" width="120" height="80" viewBox="0 0 120 80">
              <line x1="20" y1="20" x2={60 - dx * 0.25} y2={50 - dy * 0.25} stroke="#333" strokeWidth="1.2" />
            </svg>
            <div className="callout-text">{callout.text}</div>
            <div className="callout-controls">
              <button onClick={() => onNudge(callout.id, -10, 0)}>◀</button>
              <button onClick={() => onNudge(callout.id, 10, 0)}>▶</button>
              <button onClick={() => onNudge(callout.id, 0, -10)}>▲</button>
              <button onClick={() => onNudge(callout.id, 0, 10)}>▼</button>
            </div>
          </div>
        );
      })}
    </>
  );
}
