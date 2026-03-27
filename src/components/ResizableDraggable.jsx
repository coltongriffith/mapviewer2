import { useCallback, useState } from 'react';
import { computeSnap } from '../utils/layout';

export default function ResizableDraggable({
  id,
  x,
  y,
  w,
  h,
  minW = 60,
  minH = 30,
  onMove,
  onResize,
  onDragStart,
  onDragEnd,
  children,
  className = '',
  zIndex = 1001,
  snapElements = [],
  containerW = 1200,
  containerH = 800,
}) {
  const [snapGuides, setSnapGuides] = useState([]);

  const startDrag = useCallback((e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onDragStart?.();
    const ox = e.clientX - x;
    const oy = e.clientY - y;

    const mv = (ev) => {
      let nx = ev.clientX - ox;
      let ny = ev.clientY - oy;
      const snap = computeSnap(nx, ny, w, h, snapElements, containerW, containerH, id);
      nx = snap.x;
      ny = snap.y;
      setSnapGuides(snap.guides);
      onMove?.({ x: nx, y: ny });
    };

    const up = () => {
      setSnapGuides([]);
      onDragEnd?.();
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
    };

    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }, [containerH, containerW, h, id, onDragEnd, onDragStart, onMove, snapElements, w, x, y]);

  const startResize = useCallback((e, dir) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = x;
    const oy = y;
    const ow = w;
    const oh = h;

    const mv = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      let nx = ox;
      let ny = oy;
      let nw = ow;
      let nh = oh;

      if (dir.includes('e')) nw = Math.max(minW, ow + dx);
      if (dir.includes('s')) nh = Math.max(minH, oh + dy);
      if (dir.includes('w')) {
        nw = Math.max(minW, ow - dx);
        nx = ox + ow - nw;
      }
      if (dir.includes('n')) {
        nh = Math.max(minH, oh - dy);
        ny = oy + oh - nh;
      }

      onResize?.({ x: nx, y: ny, w: nw, h: nh });
    };

    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
    };

    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }, [h, minH, minW, onResize, w, x, y]);

  const handlePos = {
    n: { top: -4, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' },
    ne: { top: -4, right: -4, cursor: 'ne-resize' },
    e: { top: '50%', right: -4, transform: 'translateY(-50%)', cursor: 'e-resize' },
    se: { bottom: -4, right: -4, cursor: 'se-resize' },
    s: { bottom: -4, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' },
    sw: { bottom: -4, left: -4, cursor: 'sw-resize' },
    w: { top: '50%', left: -4, transform: 'translateY(-50%)', cursor: 'w-resize' },
    nw: { top: -4, left: -4, cursor: 'nw-resize' },
  };

  return (
    <>
      {snapGuides.map((g, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: 9999,
            background: 'rgba(80,180,255,0.7)',
            ...(g.type === 'v'
              ? { left: g.pos, top: 0, width: 1, height: '100%' }
              : { top: g.pos, left: 0, height: 1, width: '100%' }),
          }}
        />
      ))}
      <div
        className={`rdrag ${className}`}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: w,
          height: h,
          zIndex,
          userSelect: 'none',
          cursor: 'move',
          boxSizing: 'border-box',
        }}
        onMouseDown={startDrag}
      >
        {children}
        {Object.entries(handlePos).map(([dir, pos]) => (
          <div
            key={dir}
            onMouseDown={(e) => startResize(e, dir)}
            style={{
              position: 'absolute',
              width: 8,
              height: 8,
              background: 'rgba(80,160,255,0.9)',
              border: '1px solid #fff',
              borderRadius: 2,
              zIndex: 10,
              ...pos,
            }}
          />
        ))}
      </div>
    </>
  );
}
