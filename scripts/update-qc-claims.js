// Weekly loader for Quebec mining claims.
//
// Quebec publishes its full mineral-titles ("titres miniers") dataset as a free
// public shapefile, refreshed every Monday. Unlike the other provinces there is
// no live attribute-query API to hit on demand, so we download that file once a
// week, reproject it from Quebec Lambert (EPSG:32198) to WGS84, and load it into
// the `qc_claims` Supabase table. The /api/claims function then searches that
// table for the `qc` province.
//
// Run locally:   node scripts/update-qc-claims.js
// Run in CI:      see .github/workflows/update-qc-claims.yml (weekly cron)
//
// Required env vars:
//   SUPABASE_URL                — your project URL (https://xxxx.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY   — service-role key (bypasses RLS for the bulk load)
// Optional:
//   QC_CLAIMS_URL               — override the source shapefile (.zip) URL
//
// NOTE: QC_CLAIMS_URL must point at the current Quebec claims shapefile zip.
// The default below is the documented GESTIM "Québec minier" claims export; if
// the ministry moves it, set QC_CLAIMS_URL in the workflow/secret rather than
// editing this file. The loader logs the field names it sees on the first
// feature so you can confirm the attribute mapping after a run.

import shp from 'shpjs';
import proj4 from 'proj4';

// Quebec Lambert (NAD83 / Quebec Lambert), the projection GESTIM exports in.
const QC_LAMBERT =
  '+proj=lcc +lat_1=60 +lat_2=46 +lat_0=44 +lon_0=-68.5 ' +
  '+x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const WGS84 = 'EPSG:4326';
const toWgs84 = proj4(QC_LAMBERT, WGS84);

const SOURCE_URL =
  process.env.QC_CLAIMS_URL ||
  'https://documents-gestim.mines.gouv.qc.ca/cartes/Titres_miniers.zip';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BATCH_SIZE = 1000;          // rows per insert request
const COORD_PRECISION = 6;        // ~0.1 m; trims jsonb size considerably

// Candidate source field names (GESTIM French names, with a few fallbacks).
// The first one present on a feature wins — mirrors the resilient field
// resolution the live-API provinces use in api/claims.js.
const FIELD_CANDIDATES = {
  tag_number:    ['NO_TITRE', 'NO_CLAIM', 'NUMERO', 'NO_TITRE_M', 'CLAIM_NO'],
  owner_name:    ['TITULAIRE', 'NOM_TITULA', 'NOM', 'DETENTEUR', 'NOM_DETENT'],
  status:        ['STATUT', 'STATUT_TIT', 'ETAT'],
  good_to_date:  ['DATE_EXPIR', 'DATE_FIN', 'DATE_EXP', 'EXPIRATION'],
  area_hectares: ['SUPERFICIE', 'SUPERF_HA', 'HECTARES', 'AREA_HA'],
  title_type:    ['TYPE_TITRE', 'TYPE', 'TYPE_TITR'],
};

function pick(props, candidates) {
  for (const name of candidates) {
    if (props[name] != null && props[name] !== '') return props[name];
  }
  // Case-insensitive second pass (shapefile drivers vary on casing).
  const lowerMap = Object.keys(props).reduce((m, k) => ((m[k.toLowerCase()] = k), m), {});
  for (const name of candidates) {
    const hit = lowerMap[name.toLowerCase()];
    if (hit && props[hit] != null && props[hit] !== '') return props[hit];
  }
  return null;
}

function toIsoDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 1e10) return new Date(v).toISOString().slice(0, 10);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function round(n) {
  const f = 10 ** COORD_PRECISION;
  return Math.round(n * f) / f;
}

// Reproject every coordinate in a GeoJSON geometry from Quebec Lambert to WGS84.
function reprojectGeometry(geom) {
  if (!geom || !geom.coordinates) return null;
  const mapPos = (pos) => {
    const [x, y] = toWgs84.forward([pos[0], pos[1]]);
    return [round(x), round(y)];
  };
  const walk = (coords, depth) =>
    depth === 0 ? mapPos(coords) : coords.map((c) => walk(c, depth - 1));
  const depthByType = {
    Point: 0, MultiPoint: 1, LineString: 1,
    MultiLineString: 2, Polygon: 2, MultiPolygon: 3,
  };
  const depth = depthByType[geom.type];
  if (depth == null) return null;
  return { type: geom.type, coordinates: walk(geom.coordinates, depth) };
}

function isActive(status) {
  if (!status) return true; // keep when status is unknown rather than dropping data
  return /actif|active|valide|valid|en\s*vigueur/i.test(String(status));
}

async function supabaseFetch(path, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Supabase ${init?.method || 'GET'} ${path} → ${r.status}: ${body.slice(0, 300)}`);
  }
  return r;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.');
  }

  console.log(`Downloading Quebec claims from ${SOURCE_URL} …`);
  const res = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/octet-stream,application/zip,*/*',
    },
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`Downloaded ${(buf.length / 1e6).toFixed(1)} MB. Parsing shapefile …`);

  // shpjs accepts a zip buffer and returns GeoJSON (one FeatureCollection, or an
  // array of them if the zip holds multiple layers).
  const parsed = await shp(buf);
  const collections = Array.isArray(parsed) ? parsed : [parsed];
  const allFeatures = collections.flatMap((c) => c.features || []);
  console.log(`Parsed ${allFeatures.length} features.`);
  if (allFeatures[0]) {
    console.log('First feature attribute keys:', Object.keys(allFeatures[0].properties || {}).join(', '));
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  let skippedInactive = 0;
  let skippedNoGeom = 0;
  for (const f of allFeatures) {
    const props = f.properties || {};
    const status = pick(props, FIELD_CANDIDATES.status);
    if (!isActive(status)) { skippedInactive++; continue; }
    const geometry = reprojectGeometry(f.geometry);
    if (!geometry) { skippedNoGeom++; continue; }
    const area = pick(props, FIELD_CANDIDATES.area_hectares);
    rows.push({
      tag_number: pick(props, FIELD_CANDIDATES.tag_number)?.toString() ?? null,
      owner_name: pick(props, FIELD_CANDIDATES.owner_name)?.toString() ?? null,
      status: status?.toString() ?? null,
      good_to_date: toIsoDate(pick(props, FIELD_CANDIDATES.good_to_date)),
      area_hectares: area != null && Number.isFinite(Number(area)) ? Number(area) : null,
      title_type: pick(props, FIELD_CANDIDATES.title_type)?.toString() ?? null,
      geometry,
      source_updated_at: today,
    });
  }
  console.log(
    `Prepared ${rows.length} active claims ` +
    `(skipped ${skippedInactive} inactive, ${skippedNoGeom} without geometry).`
  );
  if (!rows.length) throw new Error('No rows to load — aborting before clearing the table.');

  // Replace the table contents. Delete first, then insert in batches. We only
  // clear once we know we have fresh rows in hand (guard above), so a failed
  // download never wipes the existing data.
  console.log('Clearing existing rows …');
  await supabaseFetch('qc_claims?id=gte.0', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

  console.log(`Inserting ${rows.length} rows in batches of ${BATCH_SIZE} …`);
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await supabaseFetch('qc_claims', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(batch),
    });
    process.stdout.write(`  ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}\r`);
  }
  console.log(`\nDone. Loaded ${rows.length} Quebec claims (source date ${today}).`);
}

main().catch((e) => {
  console.error('update-qc-claims failed:', e.message);
  process.exit(1);
});
