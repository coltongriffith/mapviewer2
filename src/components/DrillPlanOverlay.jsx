import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { planLayout, mapView } from '../utils/drillPlan.js';
import { Prim } from './StudioCard.jsx';
import { STUDIO_SHADOW } from '../utils/studioCards.js';
import { screenScale } from '../utils/stageScale.js';

// The drill plan (project.drillPlan) on the editor stage and the shared map page, drawn from the primitives the
// PNG and SVG exporters paint (utils/drillPlan.js). Two layers, stacked as the exporters paint them: the traces,
// bars, collars and pills over the map but under the panels (z 400) and annotations, and the tags and cards over
// the annotations. In the editor (onChange) the tags, cards and the
// highlight's star can be dragged, or moved with the arrow keys once focused.

const LABEL = { card: 'Results card', hl: 'Highlight card', star: 'Highlight star' };
const labelOf = (k) => LABEL[k] || (k.startsWith('tag:') ? `Interval tag ${k.slice(4)}` : 'Common pad tag');

function useMapTick(map) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!map) return undefined;
    const bump = () => setTick((t) => t + 1);
    map.on('move zoomend resize viewreset', bump);
    return () => map.off('move zoomend resize viewreset', bump);
  }, [map]);
}

function Layer({ prims, size, id, z, children }) {
  return (
    <svg className="drill-plan-layer" width={size.x} height={size.y} viewBox={`0 0 ${size.x} ${size.y}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none', zIndex: z }}>
      <defs>
        <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy={STUDIO_SHADOW.dy} stdDeviation={STUDIO_SHADOW.blur / 2} floodColor="#101820" floodOpacity="0.2" />
        </filter>
      </defs>
      {prims.map((p, i) => <Prim key={i} p={p} shadowId={`${id}-shadow`} clipId={`${id}-clip-${i}`} />)}
      {children}
    </svg>
  );
}

export default function DrillPlanOverlay({ map, plan, zones, layout, onChange }) {
  const id = `drill-plan-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  useMapTick(map);
  const [drag, setDrag] = useState(null); // { key, dx, dy } while dragging
  const dragRef = useRef(null);
  const size = map?.getSize?.() || { x: 0, y: 0 };
  const view = map && size.x ? mapView(map, size.x, size.y, zones, layout) : null;
  // While dragging, the dragged item's offset is the pointer's; everything else stays laid out as it was.
  const shown = useMemo(() => (drag ? { ...plan, pos: { ...(plan.pos || {}), [drag.key]: { dx: drag.dx, dy: drag.dy } } } : plan), [plan, drag]);
  if (!view) return null;
  const { base, over, targets } = planLayout(shown, view);

  // Moving the star moves the highlight (and its card with it); moving a card or tag keeps its offset.
  const commit = (k, dx, dy, anchor) => {
    if (k === 'star') {
      const ll = map.containerPointToLatLng([anchor[0] + dx, anchor[1] + dy]);
      onChange({ highlight: { ...plan.highlight, at: { lat: +ll.lat.toFixed(7), lng: +ll.lng.toFixed(7) } } });
    } else onChange({ pos: { ...(plan.pos || {}), [k]: { dx: Math.round(dx), dy: Math.round(dy) } } });
  };
  const start = (t) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const sc = screenScale(map.getContainer()), base0 = t.key === 'star' ? [0, 0] : [t.box[0] - t.anchor[0], t.box[1] - t.anchor[1]];
    dragRef.current = { key: t.key, x: e.clientX, y: e.clientY, sc, base0, anchor: t.anchor, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    const d = dragRef.current; if (!d || e.pointerId !== d.pointerId) return;
    if (d.key !== 'star') setDrag({ key: d.key, dx: d.base0[0] + (e.clientX - d.x) / d.sc, dy: d.base0[1] + (e.clientY - d.y) / d.sc });
  };
  const end = (e) => {
    const d = dragRef.current; if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null; setDrag(null);
    const dx = d.base0[0] + (e.clientX - d.x) / d.sc, dy = d.base0[1] + (e.clientY - d.y) / d.sc;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 1) commit(d.key, dx, dy, d.anchor);
  };
  const nudge = (t) => (e) => {
    const step = e.shiftKey ? 16 : 4, m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!m) return;
    e.preventDefault();
    const b0 = t.key === 'star' ? [0, 0] : [t.box[0] - t.anchor[0], t.box[1] - t.anchor[1]];
    commit(t.key, b0[0] + m[0], b0[1] + m[1], t.anchor);
  };

  return (
    <>
      <Layer prims={base} size={size} id={`${id}-base`} z={300} />
      <Layer prims={over} size={size} id={`${id}-over`} z={515}>
        {onChange && targets.map((t) => (
          <rect
            key={t.key} className="drill-plan-target" data-key={t.key} role="button" tabIndex={0} aria-label={`${labelOf(t.key)}: drag or use the arrow keys to move`}
            x={t.box[0]} y={t.box[1]} width={t.box[2] - t.box[0]} height={t.box[3] - t.box[1]} fill="transparent"
            style={{ pointerEvents: 'all', cursor: 'move', outline: 'none' }}
            onPointerDown={start(t)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={nudge(t)}
          />
        ))}
      </Layer>
    </>
  );
}
