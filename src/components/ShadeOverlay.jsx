import React, { useEffect, useMemo, useState } from 'react';

function chaikin(points, iterations = 3) {
  let pts = points;
  for (let i = 0; i < iterations; i++) {
    const next = [];
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j], b = pts[(j + 1) % pts.length];
      next.push({ lat: 0.75 * a.lat + 0.25 * b.lat, lng: 0.75 * a.lng + 0.25 * b.lng });
      next.push({ lat: 0.25 * a.lat + 0.75 * b.lat, lng: 0.25 * a.lng + 0.75 * b.lng });
    }
    pts = next;
  }
  return pts;
}

export default function ShadeOverlay({ map, ellipses, polygons }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!map) return undefined;
    const rerender = () => setTick((v) => v + 1);
    map.on('zoomend moveend resize', rerender);
    return () => map.off('zoomend moveend resize', rerender);
  }, [map]);

  const shadedEllipses = useMemo(() => {
    if (!map) return [];
    return (ellipses || [])
      .filter((e) => e.isRing && e.outsideShade)
      .map((e) => {
        const pt = map.latLngToContainerPoint([e.lat, e.lng]);
        let r;
        if (e.radiusKm) {
          const northPt = map.latLngToContainerPoint([e.lat + e.radiusKm / 111.32, e.lng]);
          r = Math.max(4, Math.abs(pt.y - northPt.y));
        } else {
          r = (e.width || 90) / 2;
        }
        return { ...e, cx: pt.x, cy: pt.y, r };
      });
  }, [ellipses, map, tick]);

  const shadedPolygons = useMemo(() => {
    if (!map) return [];
    return (polygons || [])
      .filter((poly) => poly.outsideShade && poly.points?.length >= 3)
      .map((poly) => {
        const rawPts = poly.smoothed ? chaikin(poly.points) : poly.points;
        const pts = rawPts.map(({ lat, lng }) => {
          const pt = map.latLngToContainerPoint([lat, lng]);
          return { x: pt.x, y: pt.y };
        });
        return { ...poly, pts };
      });
  }, [polygons, map, tick]);

  if (!shadedEllipses.length && !shadedPolygons.length) return null;

  const W = map?.getContainer()?.offsetWidth || 2000;
  const H = map?.getContainer()?.offsetHeight || 2000;

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {shadedEllipses.map((e) => (
        <path
          key={`shade-ring-${e.id}`}
          d={`M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z M ${e.cx} ${e.cy} m ${-e.r} 0 a ${e.r} ${e.r} 0 1 0 ${e.r * 2} 0 a ${e.r} ${e.r} 0 1 0 ${-e.r * 2} 0`}
          fill={e.outsideShadeColor || '#000000'}
          fillOpacity={e.outsideShadeOpacity ?? 0.35}
          fillRule="evenodd"
        />
      ))}
      {shadedPolygons.map((poly) => {
        const polyPath = `M ${poly.pts.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`;
        return (
          <path
            key={`shade-poly-${poly.id}`}
            d={`M 0 0 L ${W} 0 L ${W} ${H} L 0 ${H} Z ${polyPath}`}
            fill={poly.outsideShadeColor || '#000000'}
            fillOpacity={poly.outsideShadeOpacity ?? 0.35}
            fillRule="evenodd"
          />
        );
      })}
    </svg>
  );
}
