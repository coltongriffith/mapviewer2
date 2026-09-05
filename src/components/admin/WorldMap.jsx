import React, { useMemo, useRef, useState } from 'react';
import { geoOrthographic, geoPath, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
import landTopo from 'world-atlas/land-110m.json';
const LAND_FEATURE = feature(landTopo, landTopo.objects.land);
const GRATICULE = geoGraticule10();

// Orthographic (3D sphere) projection of a lon/lat point. Returns null when the
// point is on the far side of the globe (not visible from the current rotation).
const GLOBE_TILT = 16; // degrees — slight downward tilt for a nicer view of land
function projectOrtho(lon, lat, rotationDeg, R) {
  const lambda = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const lambda0 = (rotationDeg * Math.PI) / 180;
  const phi0 = (GLOBE_TILT * Math.PI) / 180;
  const cosc = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda - lambda0);
  if (cosc < -0.03) return null; // back of the sphere
  const x = R * Math.cos(phi) * Math.sin(lambda - lambda0);
  const y = R * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lambda - lambda0));
  return { x, y, depth: Math.max(0, cosc) };
}

export default function WorldMap({ locations }) {
  const R = 100;
  const [rotation, setRotation] = useState(-110);
  const [hoverIdx, setHoverIdx] = useState(null);
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);

  const pings = useMemo(
    () => (locations || []).filter((l) => l.lat != null && l.lng != null),
    [locations]
  );

  // Cluster pings that round to the same ~10km grid cell (multiple tabs/visitors
  // in the same city) into a single marker with a count, instead of stacking
  // identical dots on top of each other.
  const clusters = useMemo(() => {
    const byKey = new Map();
    for (const l of pings) {
      const key = `${l.lat.toFixed(1)},${l.lng.toFixed(1)}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        if (!existing.city && l.city) existing.city = l.city;
        if (!existing.region && l.region) existing.region = l.region;
      } else {
        byKey.set(key, { lat: l.lat, lng: l.lng, city: l.city, region: l.region, country: l.country, count: 1 });
      }
    }
    return [...byKey.values()];
  }, [pings]);

  // Real orthographic projection (d3-geo handles antimeridian wrap and
  // back-of-sphere clipping correctly, which the old manual dot-cloud couldn't).
  const pathGen = useMemo(() => {
    const projection = geoOrthographic()
      .rotate([-rotation, -GLOBE_TILT])
      .clipAngle(90)
      .scale(R)
      .translate([0, 0]);
    return geoPath(projection);
  }, [rotation]);

  const landPath = useMemo(() => pathGen(LAND_FEATURE), [pathGen]);
  const graticulePath = useMemo(() => pathGen(GRATICULE), [pathGen]);

  const pingPoints = useMemo(() => {
    const out = [];
    clusters.forEach((l, i) => {
      const p = projectOrtho(l.lng, l.lat, rotation, R);
      if (p) out.push({ ...p, city: l.city, region: l.region, country: l.country, count: l.count, key: i });
    });
    return out;
  }, [clusters, rotation]);

  function onPointerDown(e) {
    draggingRef.current = true;
    lastXRef.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    setRotation((r) => r + dx * 0.5);
  }
  function onPointerUp() {
    draggingRef.current = false;
  }

  const hovered = hoverIdx != null ? pingPoints.find((p) => p.key === hoverIdx) : null;

  return (
    <div>
      <div className="adm-globe-header">
        <span className="adm-globe-live-dot" />
        {pings.length} located active tab{pings.length === 1 ? '' : 's'}
      </div>
      <div
        className="adm-globe-wrap"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg viewBox={`${-R - 12} ${-R - 12} ${2 * R + 24} ${2 * R + 24}`} className="adm-globe-svg">
          <defs>
            <radialGradient id="admGlobeShade" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#3c5157" />
              <stop offset="60%" stopColor="#1d2c31" />
              <stop offset="100%" stopColor="#0b1417" />
            </radialGradient>
            <radialGradient id="admGlobeAtmo" cx="50%" cy="50%" r="50%">
              <stop offset="78%" stopColor="#8fa3a8" stopOpacity="0" />
              <stop offset="92%" stopColor="#8fa3a8" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#8fa3a8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="0" cy="0" r={R + 8} fill="url(#admGlobeAtmo)" />
          <circle cx="0" cy="0" r={R} fill="url(#admGlobeShade)" className="adm-globe-sphere" />
          {graticulePath && <path d={graticulePath} className="adm-globe-grid" />}
          {landPath && <path d={landPath} className="adm-globe-land" />}
          {pingPoints.map((p) => {
            const r = Math.min(4.5, 1.8 + Math.log2(p.count + 1));
            return (
              <g
                key={p.key}
                style={{ opacity: Math.max(0.4, p.depth), cursor: 'pointer' }}
                onPointerEnter={() => setHoverIdx(p.key)}
                onPointerLeave={() => setHoverIdx((cur) => (cur === p.key ? null : cur))}
              >
                <circle cx={p.x} cy={p.y} r={r + 1.6} className="adm-globe-ping-halo" />
                <circle cx={p.x} cy={p.y} r={r} className="adm-globe-ping" />
                {p.count > 1 && (
                  <text x={p.x} y={p.y + 2.6} textAnchor="middle" className="adm-globe-ping-count">{p.count}</text>
                )}
              </g>
            );
          })}
          <circle cx="0" cy="0" r={R} fill="none" className="adm-globe-rim" />
        </svg>
        {hovered && (
          <div
            className="adm-globe-tooltip"
            style={{
              left: `calc(50% + ${(hovered.x / R) * 50}%)`,
              top: `calc(50% + ${(hovered.y / R) * 50}%)`,
            }}
          >
            <strong>{[hovered.city, hovered.region].filter(Boolean).join(', ') || 'Unknown location'}</strong>
            <span>{hovered.country || ''}</span>
            <span className="adm-globe-tooltip-count">{hovered.count} active {hovered.count === 1 ? 'tab' : 'tabs'}</span>
          </div>
        )}
        {pings.length === 0 && <div className="adm-globe-empty">No located active tabs</div>}
      </div>
      {clusters.length > 0 && (
        <div className="adm-worldmap-legend">
          {clusters
            .slice()
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
            .map((l, i) => (
              <span key={i} className="adm-worldmap-loc">
                <span className="adm-donut-dot" />
                {[l.city, l.region, l.country].filter(Boolean).join(', ') || 'Unknown'}
                {l.count > 1 && <span className="adm-worldmap-loc-count">×{l.count}</span>}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

