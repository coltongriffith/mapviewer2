import React, { useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { daysRemaining, urgencyBand, formatDaysRemaining, formatGovernmentDate } from '../../utils/tenureDates';
import { esc } from '../../utils/claimInfo';

// The portfolio map.
//
// This is an OPERATIONAL view, not the map editor. It answers "where are the
// claims that need attention" and nothing else — no styling, no annotations,
// no export. Presentation is the editor's job, and duplicating it here would
// give users two half-products instead of one good one. The "Open in
// Exploration Maps" action is the handoff.
//
// Colour AND pattern AND label: the fill carries the urgency colour, a hatch
// pattern distinguishes the two most urgent bands for anyone who cannot
// separate red from orange, and the table beside it states the band in words.
// Nothing here is the only way to learn a claim's status.

const BASEMAP = {
  // Same tiles as the editor's default, so the two views look like one product.
  url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
  attribution: '&copy; OpenStreetMap &copy; CARTO',
};
const LABELS = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';

// British Columbia, when there is nothing to fit to.
const BC_CENTER = [54.5, -125.0];
const BC_ZOOM = 5;

export const COLOUR_BY = [
  { value: 'urgency', label: 'Days until good-to-date' },
  { value: 'status', label: 'Claim status' },
  { value: 'owner', label: 'Registered owner' },
  { value: 'project', label: 'Internal project' },
  { value: 'decision', label: 'Maintenance decision' },
  { value: 'change', label: 'Recent change' },
];

// A qualitative palette for the categorical modes. Chosen to stay
// distinguishable against the light basemap and from each other.
const CATEGORY_COLOURS = [
  '#2563eb', '#7c3aed', '#0891b2', '#65a30d', '#ca8a04',
  '#dc2626', '#db2777', '#0f766e', '#4338ca', '#a16207',
];

function categoryKey(row, mode) {
  switch (mode) {
    case 'status': return row.tenure.status || 'Not published';
    case 'owner': return row.owners?.[0]?.owner_name || 'Not published';
    case 'project': return row.internalProjectName || 'No project';
    case 'decision': return row.maintenanceDecision || 'UNDECIDED';
    default: return '';
  }
}

/**
 * Fill colour and hatch flag for a row under the current colour-by mode.
 * Returned together so the caller never has to re-derive one from the other.
 */
function styleFor(row, mode, categoryIndex, now, changesByTenure) {
  if (mode === 'urgency') {
    const band = urgencyBand(daysRemaining(row.tenure.good_to_date, now), row.tenure.status);
    // Hatch the two bands that mean "act now", so urgency survives greyscale
    // printing and red/orange colour blindness.
    return { colour: band.color, hatch: band.id === 'critical' || band.id === 'expired' };
  }
  if (mode === 'change') {
    const change = changesByTenure.get(row.tenure.id);
    if (!change) return { colour: '#94a3b8', hatch: false };
    return {
      colour: change.severity === 'critical' ? '#dc2626' : '#d97706',
      hatch: change.severity === 'critical',
    };
  }
  const key = categoryKey(row, mode);
  const idx = categoryIndex.get(key) ?? 0;
  return { colour: CATEGORY_COLOURS[idx % CATEGORY_COLOURS.length], hatch: false };
}

function popupHtml(row, now) {
  const t = row.tenure;
  const days = daysRemaining(t.good_to_date, now);
  const band = urgencyBand(days, t.status);
  const owners = row.owners?.length
    ? row.owners.map((o) => esc(o.owner_name)).join('; ')
    : '<em>Not published in the B.C. source</em>';
  return `
    <div class="tm-popup">
      <strong>${esc(t.tenure_name || 'Unnamed claim')}</strong><br/>
      <span class="tm-popup-number">Tenure ${esc(t.tenure_number)}</span>
      <div class="tm-popup-row">${owners}</div>
      <div class="tm-popup-row">Good-to-date: <b>${esc(formatGovernmentDate(t.good_to_date))}</b></div>
      <div class="tm-popup-row" style="color:${band.color}">
        ${band.icon} ${esc(formatDaysRemaining(days))} — ${esc(band.label)}
      </div>
      <div class="tm-popup-hint">Click the row in the table for full details and actions.</div>
    </div>`;
}

export default function TenureMap({
  rows,
  now = new Date(),
  colourBy = 'urgency',
  selectedTenureId,
  onSelect,
  changesByTenure = new Map(),
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  // Fit the map to the portfolio once, not on every re-render — otherwise a
  // user who zoomed into one claim gets thrown back out whenever anything
  // upstream re-renders.
  const fittedRef = useRef(false);

  // Stable colour assignment per category, so a claim does not change colour
  // when an unrelated one is filtered out.
  const categoryIndex = useMemo(() => {
    const keys = [...new Set(rows.map((r) => categoryKey(r, colourBy)).filter(Boolean))].sort();
    return new Map(keys.map((k, i) => [k, i]));
  }, [rows, colourBy]);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return undefined;
    const map = L.map(containerRef.current, {
      center: BC_CENTER,
      zoom: BC_ZOOM,
      // Keyboard panning/zooming on, so the map is not a pointer-only island.
      keyboard: true,
    });
    L.tileLayer(BASEMAP.url, { attribution: BASEMAP.attribution, maxZoom: 19 }).addTo(map);
    L.tileLayer(LABELS, { attribution: '', maxZoom: 19, opacity: 0.9 }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }

    const group = L.featureGroup();
    for (const row of rows) {
      const geometry = row.tenure.geometry;
      if (!geometry) continue;
      const { colour, hatch } = styleFor(row, colourBy, categoryIndex, now, changesByTenure);
      const selected = selectedTenureId === row.tenure.id;

      const layer = L.geoJSON({ type: 'Feature', properties: {}, geometry }, {
        style: {
          color: selected ? '#0f172a' : colour,
          weight: selected ? 3 : 1.5,
          opacity: 1,
          fillColor: colour,
          fillOpacity: hatch ? 0.55 : 0.35,
          // Dashed outline is the second, non-colour channel for "act now".
          dashArray: hatch ? '5,3' : undefined,
        },
      });
      layer.bindTooltip(
        `${row.tenure.tenure_number} — ${row.tenure.tenure_name || 'Unnamed'}`,
        { sticky: true },
      );
      layer.bindPopup(popupHtml(row, now));
      layer.on('click', () => onSelect?.(row));
      layer.addTo(group);
    }

    if (rows.length) {
      group.addTo(map);
      layerRef.current = group;
      if (!fittedRef.current) {
        const bounds = group.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
        fittedRef.current = true;
      }
    }
  }, [rows, colourBy, categoryIndex, selectedTenureId, now, onSelect, changesByTenure]);

  // Re-fit when the portfolio itself changes (a different set of claims), but
  // not when the user is merely filtering within one.
  const portfolioKey = rows.map((r) => r.tenure.id).sort().join(',');
  useEffect(() => { fittedRef.current = false; }, [portfolioKey]);

  const withoutGeometry = rows.filter((r) => !r.tenure.geometry).length;

  return (
    <div className="tm-map-wrap">
      <div ref={containerRef} className="tm-map" role="application" aria-label="Map of monitored B.C. mineral tenures" />
      {/* The map is never the only route to this information. */}
      <p className="tm-map-alt">
        The claim table below lists every monitored tenure with its good-to-date,
        days remaining and urgency in text form.
      </p>
      {withoutGeometry > 0 && (
        <p className="tm-map-warning">
          {withoutGeometry} monitored {withoutGeometry === 1 ? 'claim has' : 'claims have'} no
          boundary in the current dataset and {withoutGeometry === 1 ? 'is' : 'are'} not drawn here.
          {' '}They are still listed in the table.
        </p>
      )}
    </div>
  );
}
