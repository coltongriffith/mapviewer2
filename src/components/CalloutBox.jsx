import { useRef, useState } from 'react';
import ResizableDraggable from './ResizableDraggable';

export default function CalloutBox(props) {
  const { c, onChange, onDragStart, onDragEnd, selected, onSelect, snapElements, containerW, containerH } = props;
  const [editing, setEditing] = useState(false);
  const taRef = useRef(null);
  const lines = String(c.text || '').replace(/\\n/g, '\n').split('\n');
  const bw = c.w ?? Math.max(120, Math.max(...lines.map((l) => l.length)) * 7.5 + 24);
  const bh = c.h ?? lines.length * 18 + 14;

  return (
    <>
      <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1002 }} xmlns="http://www.w3.org/2000/svg">
        <line x1={c.pinX} y1={c.pinY} x2={c.boxX + bw / 2} y2={c.boxY + bh} stroke={c.borderColor} strokeWidth="1.5" strokeDasharray="5,3" />
        <circle cx={c.pinX} cy={c.pinY} r="7" fill={c.borderColor} style={{ pointerEvents: 'all', cursor: 'move' }} />
      </svg>
      <ResizableDraggable
        id={c.id}
        x={c.boxX}
        y={c.boxY}
        w={bw}
        h={bh}
        onMove={(p) => onChange({ boxX: p.x, boxY: p.y })}
        onResize={(p) => onChange({ boxX: p.x, boxY: p.y, w: p.w, h: p.h })}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        snapElements={snapElements}
        containerW={containerW}
        containerH={containerH}
        zIndex={selected ? 1010 : 1003}
      >
        <div
          style={{ width: '100%', height: '100%', background: c.bgColor || c.fillColor || '#fff', border: `1.5px solid ${c.borderColor}`, borderRadius: 3, boxSizing: 'border-box', overflow: 'hidden', cursor: 'move' }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(c.id);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
            setTimeout(() => taRef.current?.focus(), 0);
          }}
        >
          {editing ? (
            <textarea ref={taRef} value={c.text} onChange={(e) => onChange({ text: e.target.value })} onBlur={() => setEditing(false)} style={{ width: '100%', height: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: c.borderColor, fontSize: 12, fontFamily: 'Arial', padding: '6px 8px' }} />
          ) : (
            <div style={{ padding: '6px 8px', color: c.borderColor, fontSize: 12, fontFamily: 'Arial', fontWeight: 600, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden', height: '100%' }}>{String(c.text || '').replace(/\\n/g, '\n')}</div>
          )}
        </div>
      </ResizableDraggable>
    </>
  );
}
