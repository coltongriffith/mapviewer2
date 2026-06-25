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
//   QC_CLAIMS_URL               — direct .zip URL; skips auto-discovery entirely
//   QC_CLAIMS_CKAN_QUERY        — Données Québec catalog search term (default below)
//   QC_CLAIMS_INDEX_URL         — fallback HTML listing page to scrape for a .zip link
//
// Discovery, in order:
//   1. QC_CLAIMS_URL, if set — skips everything else.
//   2. Données Québec's CKAN API (donneesquebec.ca), searched for QC_CLAIMS_CKAN_QUERY.
//      This is a stable JSON catalog API (not a scraped page), so it survives the
//      government site's own frontend changing.
//   3. Falls back to scraping QC_CLAIMS_INDEX_URL's HTML for a .zip link, in case the
//      CKAN search doesn't turn up the right dataset.
// Every step logs what it found, so a failed run's log always shows the real
// candidates/response and not just "didn't work" — if discovery can't pin the file,
// set QC_CLAIMS_URL to the direct .zip/.gpkg URL.

const FETCH_TIMEOUT_MS = 30_000;

import shp from 'shpjs';
import proj4 from 'proj4';

// Quebec Lambert (NAD83 / Quebec Lambert), the projection GESTIM exports in.
const QC_LAMBERT =
  '+proj=lcc +lat_1=60 +lat_2=46 +lat_0=44 +lon_0=-68.5 ' +
  '+x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const WGS84 = 'EPSG:4326';
const toWgs84 = proj4(QC_LAMBERT, WGS84);

// Where to look for the claims file. The exact zip URL on GESTIM's distribution
// site isn't documented and changes, so by default we scrape the index page for
// the right .zip link. Set QC_CLAIMS_URL (a GitHub secret) to a direct file URL
// to skip discovery entirely; set QC_CLAIMS_INDEX_URL to point discovery at a
// different listing page.
const SOURCE_URL = process.env.QC_CLAIMS_URL || '';
const CKAN_QUERY = process.env.QC_CLAIMS_CKAN_QUERY || 'titres miniers';
// The new documents-gestim.mines.gouv.qc.ca site is a client-rendered Angular app
// (no links in raw HTML), so default to the legacy ASP listing, which is
// server-rendered with real <a href> download links.
const INDEX_URL = process.env.QC_CLAIMS_INDEX_URL || 'https://gestim.mines.gouv.qc.ca/ftp/cartes/carte_quebec_eng.asp';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

// A real zip starts with the "PK" local-file/central-dir/empty-archive magic.
// This lets us reject HTML error pages before handing them to the shapefile
// parser (which otherwise dies with a cryptic "end of central directory" error).
function isZip(buf) {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/zip,application/octet-stream,text/html,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, ct, buf };
}

// Données Québec (donneesquebec.ca) runs on CKAN, which exposes a stable JSON
// search API — unlike GESTIM's own distribution page, which turned out to be a
// client-rendered Angular app shell with no links in the raw HTML. Search the
// catalog for the query term and pick the most promising SHP/GPKG resource.
async function discoverViaCkan(query) {
  const apiUrl = `https://www.donneesquebec.ca/recherche/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=10`;
  console.log(`Searching Données Québec catalog for "${query}" …`);
  let json;
  try {
    const r = await fetch(apiUrl, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await r.text();
    console.log(`  CKAN HTTP ${r.status}, ${text.length} bytes`);
    if (!r.ok) { console.log('  ' + text.slice(0, 800)); return null; }
    json = JSON.parse(text);
  } catch (e) {
    console.log(`  CKAN search failed: ${e.message}`);
    return null;
  }
  const packages = json?.result?.results || [];
  console.log(`  found ${packages.length} dataset(s): ${packages.map((p) => p.name).join(', ')}`);

  const candidates = [];
  for (const pkg of packages) {
    for (const res of pkg.resources || []) {
      console.log(`    - [${pkg.name}] "${res.name}" format=${res.format} url=${res.url}`);
      if (/^(shp|shapefile|gpkg|geopackage)$/i.test(res.format || '')) {
        candidates.push(res);
      }
    }
  }
  if (!candidates.length) {
    console.log('  no SHP/GPKG resources found in the matching datasets.');
    return null;
  }
  const preferred =
    candidates.find((r) => /titre|claim|droit/i.test(`${r.name} ${r.url}`)) || candidates[0];
  console.log(`  selected: ${preferred.url}`);
  return preferred.url;
}

// Scrape the GESTIM distribution index for the claims/titres .zip link. The
// exact filename isn't documented and changes, so we resolve it at run time and
// log everything we find — if discovery can't pin it, the log shows the user
// (and me) exactly what the page returned so QC_CLAIMS_URL can be set directly.
async function discoverZipUrl(indexUrl) {
  console.log(`Discovering claims file from index page ${indexUrl} …`);
  const { res, ct, buf } = await fetchBuffer(indexUrl);
  const html = buf.toString('utf8');
  console.log(`  index HTTP ${res.status}, content-type "${ct}", ${buf.length} bytes`);

  // Collect every href/src on the page (resolved to absolute), so a single run
  // reveals the real download structure even if the files aren't plain .zip.
  const raw = [...html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const abs = [...new Set(raw)]
    .map((l) => { try { return new URL(l, indexUrl).href; } catch { return null; } })
    .filter(Boolean);

  // Downloadable data files we know how to (or might) handle.
  const dataLinks = abs.filter((u) => /\.(zip|gpkg|exe)(\?|$)/i.test(u));
  if (dataLinks.length) {
    console.log(`  found ${dataLinks.length} data link(s):`);
    dataLinks.forEach((u) => console.log(`    - ${u}`));
  } else {
    console.log(`  no .zip/.gpkg/.exe links found. All ${abs.length} link(s) on the page:`);
    abs.slice(0, 60).forEach((u) => console.log(`    - ${u}`));
    if (abs.length > 60) console.log(`    … (${abs.length - 60} more)`);
    console.log('  First 800 chars of the response:');
    console.log('  ' + html.slice(0, 800).replace(/\n/g, '\n  '));
    return null;
  }

  // shpjs only handles zips; ignore .exe/.gpkg for selection (logged above so we
  // can still see them and pin one via QC_CLAIMS_URL if needed).
  const zips = dataLinks.filter((u) => /\.zip(\?|$)/i.test(u));
  if (!zips.length) {
    console.log('  data links exist but none are .zip — set QC_CLAIMS_URL to the right one above.');
    return null;
  }
  const preferred = zips.find((u) => /titre|claim|mini|droit/i.test(u)) || zips[0];
  console.log(`  selected: ${preferred}`);
  return preferred;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.');
  }

  const sourceUrl =
    SOURCE_URL ||
    (await discoverViaCkan(CKAN_QUERY)) ||
    (await discoverZipUrl(INDEX_URL));
  if (!sourceUrl) {
    throw new Error(
      'Could not auto-discover the claims file via either Données Québec or the GESTIM index. ' +
      'Inspect the dumps above, then set the QC_CLAIMS_URL secret to the direct .zip/.gpkg URL.'
    );
  }

  console.log(`Downloading Quebec claims from ${sourceUrl} …`);
  const { res, ct, buf } = await fetchBuffer(sourceUrl);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} (content-type "${ct}")`);
  if (!isZip(buf)) {
    console.log(`Response is not a zip (content-type "${ct}", ${buf.length} bytes). First 800 chars:`);
    console.log('  ' + buf.toString('utf8').slice(0, 800).replace(/\n/g, '\n  '));
    throw new Error('Downloaded file is not a zip — the source URL returned an error/HTML page. See the dump above and set QC_CLAIMS_URL.');
  }
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
