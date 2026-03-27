import ResizableDraggable from './ResizableDraggable';

export default function CanvasImageOverlay({ ov, onChange, onDragStart, onDragEnd, selected, onSelect, snapElements, containerW, containerH }) {
  return (
    <ResizableDraggable
      id={ov.id}
      x={ov.px}
      y={ov.py}
      w={ov.pw}
      h={ov.ph}
      onMove={(p) => onChange({ px: p.x, py: p.y })}
      onResize={(p) => onChange({ px: p.x, py: p.y, pw: p.w, ph: p.h })}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      snapElements={snapElements}
      containerW={containerW}
      containerH={containerH}
      zIndex={selected ? 1010 : 1000}
    >
      <div style={{ width: '100%', height: '100%', border: selected ? '1.5px dashed rgba(80,160,255,0.8)' : 'none' }} onClick={(e) => { e.stopPropagation(); onSelect(ov.id); }}>
        <img src={ov.src} alt={ov.name} style={{ width: '100%', height: '100%', objectFit: 'fill', opacity: ov.opacity, display: 'block', pointerEvents: 'none' }} />
      </div>
    </ResizableDraggable>
  );
}
