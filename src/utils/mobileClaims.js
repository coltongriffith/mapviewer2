// What the phone claims viewer shows, worked out from the claim layers the
// registry search or a company page put on the map. No React and no Leaflet,
// so the rules (which date is "soon", which claims frame the map, what a
// handed-off copy of the map looks like) are unit-testable on their own.

import { claimProperty, claimNumber, claimHolder, claimCentroid } from '../../shared/claimData.js';
import { US_STATES, isUsJurisdiction } from './jurisdictions.js';

const DAY_MS = 86_400_000;

const PROVINCES = {
  bc: { label: 'British Columbia', registry: 'Mineral Titles Online', url: 'https://www.mtonline.gov.bc.ca/mtov/home' },
  on: { label: 'Ontario', registry: 'MLAS', url: 'https://www.lioapplications.lrc.gov.on.ca/MLAS/Index.html?viewer=MLAS.MLAS&locale=en-CA' },
  sk: { label: 'Saskatchewan', registry: 'MARS', url: null },
  mb: { label: 'Manitoba', registry: 'Mineral Dispositions', url: null },
  nl: { label: 'Newfoundland & Labrador', registry: 'GeoAtlas', url: 'https://geoatlas.gov.nl.ca/Default.htm' },
  yt: { label: 'Yukon', registry: 'Yukon mining recorder', url: 'https://yukon.ca/en/mining' },
  qc: { label: 'Quebec', registry: 'GESTIM', url: 'https://gestim.mines.gouv.qc.ca/' },
};
const BLM = { registry: 'BLM MLRS', url: 'https://reports.blm.gov/report/MLRS/103/Mining-Claims-Customer-Info-Report' };

// Province or state code → label, registry name and the registry's public
// page (null when it has no page a reader can verify a claim on).
export function registryFor(code) {
  const key = String(code || '').toLowerCase();
  if (PROVINCES[key]) return { code: key, ...PROVINCES[key] };
  if (isUsJurisdiction(key)) {
    const state = US_STATES.find((s) => s.value === key);
    return { code: key, label: state?.label || key.slice(3).toUpperCase(), ...BLM };
  }
  return null;
}

// Registry dates arrive as 2027-04-11, 2027-04-11T00:00:00Z or epoch ms.
export function isoDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const d = new Date(value > 1e10 ? value : value * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function daysUntil(date, now = new Date()) {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / DAY_MS);
}

// "soon" is the amber "due within a year" on the map; "urgent" is the last
// 90 days of it, called out in the claim's details.
export function expiryBand(days) {
  if (days == null) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= 90) return 'urgent';
  if (days <= 365) return 'soon';
  return 'later';
}

export function daysLeftText(days) {
  if (days == null) return '';
  if (days < 0) return days === -1 ? 'expired yesterday' : `expired ${-days} days ago`;
  if (days === 0) return 'due today';
  if (days === 1) return '1 day left';
  if (days <= 365) return `${days} days left`;
  const years = days / 365;
  return `${years < 10 ? years.toFixed(1) : Math.round(years)} years left`;
}

// "BRIXTON METALS CORPORATION" → "Brixton Metals Corporation". Mixed-case
// names are left as the registry wrote them.
export function displayName(name) {
  const text = String(name || '').trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/(^|[\s\-/(&.])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function areaOf(feature) {
  const ha = claimProperty(feature, 'AREA_IN_HECTARES', 'AREA_HECTARES', 'AREA_HA', 'area_hectares', 'area_ha');
  if (ha != null && Number.isFinite(Number(ha))) return Number(ha);
  const sqm = claimProperty(feature, 'FEATURE_AREA_SQM');
  return sqm != null && Number.isFinite(Number(sqm)) ? Number(sqm) / 10000 : null;
}

// One flat record per claim across every layer the viewer shows.
export function normalizeClaims(layers, now = new Date()) {
  const out = [];
  for (const layer of layers || []) {
    const layerCode = layer?.provenance?.province || null;
    (layer?.geojson?.features || []).forEach((feature, index) => {
      if (!feature?.geometry) return;
      const number = claimNumber(feature) ?? claimProperty(feature, 'claim_id', 'TENURE_NUMBER');
      const goodTo = isoDate(claimProperty(feature, 'GOOD_TO_DATE', 'good_to_date', 'EXPIRY_DATE', 'expiration_date'));
      const days = daysUntil(goodTo, now);
      const registry = registryFor(claimProperty(feature, 'province', 'PROVINCE') || layerCode);
      out.push({
        key: `${layer.id}:${number ?? index}`,
        layerId: layer.id,
        number: number == null ? null : String(number),
        name: claimProperty(feature, 'CLAIM_NAME', 'CSE_NAME', 'claim_name', 'name') || null,
        holder: claimHolder(feature),
        areaHa: areaOf(feature),
        status: claimProperty(feature, 'STATUS', 'TENURE_STATUS', 'status'),
        type: claimProperty(feature, 'TITLE_TYPE_DESCRIPTION', 'CLAIM_TYPE', 'TENURE_TYPE', 'title_type'),
        goodTo,
        days,
        band: expiryBand(days),
        registry,
        centroid: claimCentroid(feature),
        feature,
      });
    });
  }
  return out;
}

// Claims more than about a degree apart are different properties. Fitting the
// map to a company's ground in two provinces shows a continent with a dot on
// it, so the map opens on the group holding the most claims and says how many
// sit elsewhere.
export function claimGroups(claims, cellDeg = 1.5) {
  const cells = new Map();
  claims.forEach((c) => {
    if (!c.centroid) return;
    const key = `${Math.floor(c.centroid.lng / cellDeg)}:${Math.floor(c.centroid.lat / cellDeg)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(c);
  });
  const seen = new Set();
  const groups = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    const members = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const key = queue.shift();
      members.push(...cells.get(key));
      const [x, y] = key.split(':').map(Number);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const next = `${x + dx}:${y + dy}`;
          if (cells.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
    }
    groups.push(members);
  }
  return groups.sort((a, b) => b.length - a.length);
}

export function summarize(claims) {
  const dated = claims.filter((c) => c.days != null && c.days >= 0).sort((a, b) => a.days - b.days);
  const labels = [...new Set(claims.map((c) => c.registry?.label).filter(Boolean))];
  return {
    count: claims.length,
    totalHa: claims.reduce((n, c) => n + (c.areaHa || 0), 0),
    earliest: dated[0] || null,
    expired: claims.filter((c) => c.band === 'expired').length,
    places: labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(' and '),
  };
}

// The holder every claim shares, if they share one.
export function commonHolder(claims) {
  const holders = new Set(claims.map((c) => c.holder).filter(Boolean));
  return holders.size === 1 ? displayName([...holders][0]) : null;
}

const DEFAULT_TITLES = new Set(['Project Map']);
const DEFAULT_SUBTITLES = new Set(['Technical Results', 'Claims, drillholes, and targets']);

// The map a phone hands on (share link, desktop hand-off, PNG): only the
// claims the viewer shows, framed where the reader left the phone map, on a
// landscape page. The phone's own editor stage is portrait and narrow; a PNG
// framed on it is not one anybody would put in a deck.
export function handoffProject(project, { layerIds, view, title, subtitle, insetRegion = null }) {
  const keep = new Set(layerIds);
  const layout = project.layout || {};
  const layers = (project.layers || []).filter((l) => keep.has(l.id));
  const { ratioMapStates, ...rest } = project;
  return {
    ...rest,
    layers,
    layout: {
      ...layout,
      exportRatio: layout.exportRatio || 'landscape',
      ...(title && (!layout.title || DEFAULT_TITLES.has(layout.title)) ? { title } : {}),
      ...(subtitle && (!layout.subtitle || DEFAULT_SUBTITLES.has(layout.subtitle)) ? { subtitle } : {}),
      primaryLayerId: keep.has(layout.primaryLayerId) ? layout.primaryLayerId : layers[0]?.id || null,
      // The locator names the province the page shows, not the middle of
      // every claim (BC plus Ontario ground is "Saskatchewan").
      ...(insetRegion ? { autoInsetRegion: insetRegion } : {}),
    },
    ...(view ? { mapView: { center: view.center, zoom: view.zoom, screenW: view.width, screenH: view.height } } : {}),
  };
}
