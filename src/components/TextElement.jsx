import { useRef, useState } from 'react';
import ResizableDraggable from './ResizableDraggable';

export default function TextElement(props) {
  const { el, onChange, onDragStart, onDragEnd, selected, onSelect, snapElements, containerW, containerH } = props;
  const [editing, setEditing] = useState(false);
  const taRef = useRef(null);

  return (
    <ResizableDraggable
      id={el.id}
      x={el.x}
      y={el.y}
      w={el.w}
      h={el.h}
      onMove={(p) => onChange({ ...el, ...p })}
      onResize={(p) => onChange({ ...el, ...p })}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      snapElements={snapElements}
      containerW={containerW}
      containerH={containerH}
      zIndex={selected ? 1010 : 1001}
    >
      <div
        style={{ width: '100%', height: '100%', border: selected ? '1.5px dashed rgba(80,160,255,0.8)' : '1.5px dashed transparent' }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(el.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
          setTimeout(() => taRef.current?.focus(), 0);
        }}
      >
        {editing ? (
          <textarea
            ref={taRef}
            value={el.text}
            onChange={(e) => onChange({ ...el, text: e.target.value })}
            onBlur={() => setEditing(false)}
            style={{ width: '100%', height: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: el.color, fontSize: el.size, fontWeight: el.bold ? 'bold' : 'normal', fontFamily: 'Arial', lineHeight: 1.3, padding: 4 }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', color: el.color, fontSize: el.size, fontWeight: el.bold ? 'bold' : 'normal', fontFamily: 'Arial', lineHeight: 1.3, padding: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden' }}>{el.text}</div>
        )}
      </div>
    </ResizableDraggable>
  );
}
