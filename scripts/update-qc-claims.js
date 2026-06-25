// Weekly loader for Quebec mining claims.
//
// Quebec publishes its full mineral-titles ("titres miniers") dataset as a free
// public shapefile, refreshed every Monday. Unlike the other provinces there is
// no live attribute-query API to hit on demand, so we download that file once a
// week (shpjs reprojects it to WGS84 via the bundled .prj) and load it into
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

// NOTE: shpjs already reprojects geometry to WGS84 itself when the zip contains a
// .prj file (see node_modules/shpjs/lib/parseShp.js: makeParseCoord runs every
// coordinate through trans.inverse()). So we must NOT reproject again here — doing
// so double-transforms the coordinates into garbage. We only round them to trim
// the stored jsonb size.

// GESTIM's real public distribution host, discovered by introspecting the Angular
// app's JS bundle. The province-wide ACTIVE-titles shapefile lives at this stable
// URL — that's exactly the set we want (every active mining title, searchable by
// holder), and it's far smaller than the "ALL" file (which also carries expired
// titles we'd filter out anyway). Set QC_CLAIMS_URL to override.
const DEFAULT_SHAPE_URL =
  'https://diffusion.mern.gouv.qc.ca/Public/GESTIM/telechargements/Province_shape/TITRES_ACTIFS_ACTIVE_TITLES.zip';
const SOURCE_URL = process.env.QC_CLAIMS_URL || DEFAULT_SHAPE_URL;

// Fallback discovery, only used if the known URL above ever stops being a valid zip.
const CKAN_QUERY = process.env.QC_CLAIMS_CKAN_QUERY || 'titres miniers';
// The new Angular distribution site has no links in raw HTML (client-rendered), so
// discovery introspects its JS bundle for download URLs — see scrapeAngularBundle.
const INDEX_URL = process.env.QC_CLAIMS_INDEX_URL || 'https://documents-gestim.mines.gouv.qc.ca/cartes';
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
// Mapped to GESTIM's real shapefile schema (confirmed from a live run's
// "First feature attribute keys" log):
//   TIT_NO      title number              DET_NOM   holder (détenteur) name
//   STI_DES_*   title status description  TIT_DAT_EX expiry date
//   TIT_SUPRF   title area (hectares)     TT_DES_*   title-type description
// English (_AN) variants are preferred for display where both exist.
const FIELD_CANDIDATES = {
  tag_number:    ['TIT_NO', 'POL_NO_SEQ'],
  owner_name:    ['DET_NOM', 'DET_LIST', 'DET_NUMER'],
  status:        ['STI_DES_AN', 'STI_DES_FR', 'STI_CODE'],
  good_to_date:  ['TIT_DAT_EX'],
  area_hectares: ['TIT_SUPRF', 'POL_SUPRF'],
  title_type:    ['TT_DES_AN', 'TT_DES_FR', 'TT_CODE'],
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

// Round every coordinate in a GeoJSON geometry (shpjs has already reprojected it
// to WGS84). Rounding to COORD_PRECISION (~0.1 m) trims the stored jsonb size.
function roundGeometry(geom) {
  if (!geom || !geom.coordinates) return null;
  const mapPos = (pos) => [round(pos[0]), round(pos[1])];
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

// Download a URL and return its bytes only if they're a real zip; otherwise log
// what came back (status, content-type, a snippet) and return null so the caller
// can fall back to discovery.
async function tryDownloadZip(url) {
  console.log(`Downloading Quebec claims from ${url} …`);
  let res, ct, buf;
  try {
    ({ res, ct, buf } = await fetchBuffer(url));
  } catch (e) {
    console.log(`  download failed: ${e.message}`);
    return null;
  }
  if (!res.ok) {
    console.log(`  HTTP ${res.status} (content-type "${ct}", ${buf.length} bytes)`);
    return null;
  }
  if (!isZip(buf)) {
    console.log(`  not a zip (content-type "${ct}", ${buf.length} bytes). First 300 chars:`);
    console.log('  ' + buf.toString('utf8').slice(0, 300).replace(/\n/g, '\n  '));
    return null;
  }
  return buf;
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

function absUrls(rawLinks, baseUrl) {
  return [...new Set(rawLinks)]
    .map((l) => { try { return new URL(l, baseUrl).href; } catch { return null; } })
    .filter(Boolean);
}

// documents-gestim.mines.gouv.qc.ca serves a client-rendered Angular app — the
// index.html itself has no download links, only <script src> tags for its JS
// bundles. Those bundles have the app's real API routes/asset URLs baked in at
// build time, so fetching and grepping them is a one-shot way to find the real
// backend without guessing more page URLs by hand.
const MAX_BUNDLES_TO_SCAN = 8;

async function scrapeAngularBundle(html, baseUrl) {
  const allScriptSrcs = absUrls(
    [...html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
    baseUrl
  ).filter((u) => /\.js(\?|$)/i.test(u));
  if (!allScriptSrcs.length) {
    console.log('  no <script src> bundles found on the page either.');
    return null;
  }
  const scriptSrcs = allScriptSrcs.slice(0, MAX_BUNDLES_TO_SCAN);
  console.log(
    `  inspecting ${scriptSrcs.length} JS bundle(s) for API/zip references` +
    (allScriptSrcs.length > scriptSrcs.length ? ` (capped from ${allScriptSrcs.length})` : '') + ' …'
  );

  let combined = '';
  for (const src of scriptSrcs) {
    try {
      const { res, buf } = await fetchBuffer(src);
      console.log(`    - ${src} → HTTP ${res.status}, ${buf.length} bytes`);
      if (res.ok) combined += buf.toString('utf8') + '\n';
    } catch (e) {
      console.log(`    - ${src} → failed: ${e.message}`);
    }
  }

  const zipLiterals = [...new Set(
    [...combined.matchAll(/["'`]([^"'`]*\.zip)["'`]/gi)].map((m) => m[1])
  )];
  const apiPaths = [...new Set(
    [...combined.matchAll(/["'`](\/[a-zA-Z0-9_\-./]*\/(?:api|recherche|telechargement|download)[a-zA-Z0-9_\-./]*)["'`]/gi)].map((m) => m[1])
  )];

  if (zipLiterals.length) {
    console.log(`  found ${zipLiterals.length} .zip string literal(s) in the bundles:`);
    zipLiterals.slice(0, 30).forEach((u) => console.log(`    - ${u}`));
  }
  if (apiPaths.length) {
    console.log(`  found ${apiPaths.length} candidate API path(s) in the bundles:`);
    apiPaths.slice(0, 30).forEach((u) => console.log(`    - ${u}`));
  }
  if (!zipLiterals.length && !apiPaths.length) {
    console.log('  no .zip literals or API paths found in the bundles.');
    return null;
  }

  const zipUrls = absUrls(zipLiterals, baseUrl);
  if (zipUrls.length) {
    const preferred = zipUrls.find((u) => /titre|claim|mini|droit/i.test(u)) || zipUrls[0];
    console.log(`  selected: ${preferred}`);
    return preferred;
  }
  console.log('  no direct .zip URL — the app likely fetches its file list from the API path(s) above.');
  console.log('  set QC_CLAIMS_URL once the right download URL is confirmed.');
  return null;
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
  const abs = absUrls([...html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]), indexUrl);

  // Downloadable data files we know how to (or might) handle.
  const dataLinks = abs.filter((u) => /\.(zip|gpkg|exe)(\?|$)/i.test(u));
  if (dataLinks.length) {
    console.log(`  found ${dataLinks.length} data link(s):`);
    dataLinks.forEach((u) => console.log(`    - ${u}`));
  } else {
    console.log(`  no .zip/.gpkg/.exe links found directly on the page (${abs.length} total link(s)).`);
    return await scrapeAngularBundle(html, indexUrl);
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

  // Try the known URL first; only if it stops being a valid zip do we fall back to
  // (slower, noisier) auto-discovery — so a moved/renamed file self-heals instead
  // of failing the run.
  let sourceUrl = SOURCE_URL;
  let buf = await tryDownloadZip(sourceUrl);
  if (!buf) {
    console.log('Known URL did not return a valid zip; falling back to auto-discovery …');
    sourceUrl = (await discoverViaCkan(CKAN_QUERY)) || (await discoverZipUrl(INDEX_URL));
    if (!sourceUrl) {
      throw new Error(
        'Could not find the claims file at the known URL or via discovery. ' +
        'Inspect the dumps above, then set the QC_CLAIMS_URL secret to the direct .zip URL.'
      );
    }
    buf = await tryDownloadZip(sourceUrl);
    if (!buf) throw new Error(`Discovered URL ${sourceUrl} did not return a valid zip either.`);
  }
  console.log(`Downloaded ${(buf.length / 1e6).toFixed(1)} MB from ${sourceUrl}. Parsing shapefile …`);

  // shpjs accepts a zip buffer and returns GeoJSON (one FeatureCollection, or an
  // array of them if the zip holds multiple layers).
  const parsed = await shp(buf);
  buf = null; // release the ~100 MB zip buffer before we balloon into row objects
  const collections = Array.isArray(parsed) ? parsed : [parsed];
  let total = 0;
  for (const c of collections) total += (c.features || []).length;
  console.log(`Parsed ${total} features.`);
  const firstProps = collections.find((c) => c.features && c.features.length)?.features[0]?.properties;
  if (firstProps) {
    console.log('First feature attribute keys:', Object.keys(firstProps).join(', '));
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  let skippedNoGeom = 0;
  // The source file is GESTIM's pre-filtered ACTIVE-titles export, so we keep every
  // title (status is stored for display only — we don't re-filter on it, which would
  // risk dropping everything if a status string doesn't match an expected pattern).
  // Consume features destructively (null each slot as we go) so the GC can reclaim
  // the parsed geometry during this loop instead of holding the full parse *and*
  // the full row set in memory at once — the province-wide file is large enough
  // that keeping both blows the heap.
  for (const c of collections) {
    const feats = c.features || [];
    for (let i = 0; i < feats.length; i++) {
      const f = feats[i];
      feats[i] = null;
      if (!f) continue;
      const props = f.properties || {};
      const geometry = roundGeometry(f.geometry);
      if (!geometry) { skippedNoGeom++; continue; }
      const area = pick(props, FIELD_CANDIDATES.area_hectares);
      rows.push({
        tag_number: pick(props, FIELD_CANDIDATES.tag_number)?.toString() ?? null,
        owner_name: pick(props, FIELD_CANDIDATES.owner_name)?.toString() ?? null,
        status: pick(props, FIELD_CANDIDATES.status)?.toString() ?? null,
        good_to_date: toIsoDate(pick(props, FIELD_CANDIDATES.good_to_date)),
        area_hectares: area != null && Number.isFinite(Number(area)) ? Number(area) : null,
        title_type: pick(props, FIELD_CANDIDATES.title_type)?.toString() ?? null,
        geometry,
        source_updated_at: today,
      });
    }
  }
  console.log(`Prepared ${rows.length} claims (skipped ${skippedNoGeom} without geometry).`);
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
