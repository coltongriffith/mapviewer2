import * as toGeoJSON from "@tmcw/togeojson";

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB

// Column name synonyms for CSV drillhole detection
const COL_SYNONYMS = {
  x:  ['easting', 'x', 'lon', 'longitude', 'long', 'east', 'utm_e', 'utm_easting'],
  y:  ['northing', 'y', 'lat', 'latitude', 'north', 'utm_n', 'utm_northing'],
  id: ['holeid', 'hole_id', 'hole', 'drillhole', 'dhid', 'bhid', 'id', 'name', 'collar'],
  elev: ['elevation', 'elev', 'z', 'rl', 'depth', 'total_depth', 'alt', 'altitude'],
  azimuth: ['azimuth', 'azi', 'az', 'bearing'],
  dip: ['dip', 'inclination', 'incl'],
};

export async function loadGeoJSON(file) {
  if (!file) throw new Error("No file provided.");
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum is 50 MB.`);
  }

  const name = file.name.toLowerCase();

  if (name.endsWith(".zip")) {
    const buffer = await file.arrayBuffer();
    const { default: shp } = await import('shpjs');
    const result = await shp(buffer);
    if (Array.isArray(result)) {
      return {
        type: "FeatureCollection",
        features: result.flatMap((item) => {
          if (item?.type === "FeatureCollection") return item.features || [];
          if (item?.type === "Feature") return [item];
          return [];
        }),
      };
    }
    if (result?.type === "FeatureCollection" || result?.type === "Feature") return result;
    throw new Error("ZIP imported, but no valid shapefile data was found.");
  }

  if (name.endsWith(".kml")) {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) throw new Error("Invalid KML file — could not parse XML.");
    const fc = toGeoJSON.kml(doc);
    if (!fc?.features?.length) throw new Error("KML file contained no readable features.");
    return fc;
  }

  if (name.endsWith(".kmz")) {
    const buffer = await file.arrayBuffer();
    let zip;
    try {
      const { default: JSZip } = await import('jszip');
      zip = await JSZip.loadAsync(buffer);
    } catch {
      throw new Error("Could not open KMZ file — it may be corrupt.");
    }
    // Archive sanity limits: KMZ is attacker-suppliable, so bound the entry
    // count, reject path-traversal names, and cap the uncompressed KML size
    // (decompression-bomb guard) before parsing anything.
    const entryNames = Object.keys(zip.files);
    if (entryNames.length > 500) throw new Error("KMZ archive has too many files (max 500).");
    if (entryNames.some((f) => f.includes("..") || f.startsWith("/") || /^[a-zA-Z]:/.test(f))) {
      throw new Error("KMZ archive contains suspicious file paths and was rejected.");
    }
    // KMZ is a ZIP; the main KML is conventionally doc.kml or the first .kml file
    const kmlFiles = entryNames.filter((f) => f.toLowerCase().endsWith(".kml"));
    const kmlName = kmlFiles.find((f) => f.toLowerCase() === "doc.kml") || kmlFiles[0];
    if (!kmlName) throw new Error("No .kml file found inside KMZ archive.");
    const declaredSize = zip.files[kmlName]._data?.uncompressedSize;
    if (declaredSize && declaredSize > 100 * 1024 * 1024) {
      throw new Error("KMZ contains an unreasonably large KML (over 100 MB uncompressed).");
    }
    const text = await zip.files[kmlName].async("string");
    if (text.length > 100 * 1024 * 1024) {
      throw new Error("KMZ contains an unreasonably large KML (over 100 MB uncompressed).");
    }
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) throw new Error("KMZ contained an invalid KML file.");
    const fc = toGeoJSON.kml(doc);
    if (!fc?.features?.length) throw new Error("KMZ file contained no readable features.");
    return fc;
  }

  if (name.endsWith(".geojson") || name.endsWith(".json")) {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON — the file could not be parsed.");
    }
    return validateGeoJSON(data);
  }

  if (name.endsWith(".shp")) {
    // Single .shp dropped without its companions — load geometry only
    const buffer = await file.arrayBuffer();
    const { default: shp } = await import('shpjs');
    const geoms = shp.parseShp(buffer);
    if (!geoms?.length) throw new Error("Shapefile contained no geometry.");
    const fc = {
      type: "FeatureCollection",
      features: geoms.map((g) => ({ type: "Feature", geometry: g, properties: {} })),
    };
    if (!coordsLookLikeLonLat(fc)) {
      throw new Error("This shapefile's coordinates look projected (e.g. UTM metres), and no .prj file was included. Drop the .prj alongside the .shp so the projection can be converted to lat/long.");
    }
    return fc;
  }

  throw new Error("Unsupported file type. Use .zip (shapefile), .shp/.dbf (dropped together), .geojson, .json, .kml, or .kmz");
}

// --- Multi-file shapefile import (.shp + .dbf + optional .prj/.shx) ---

export async function loadShapefileSet(files) {
  const base = (n) => n.replace(/\.[^.]+$/, '').toLowerCase();
  const byExt = {};
  for (const f of files) {
    const ext = f.name.toLowerCase().split('.').pop();
    byExt[ext] = f;
  }
  if (!byExt.shp) throw new Error("No .shp file found. Drop all shapefile parts together (.shp, .dbf, .prj, .shx).");

  // Companion files must belong to the same shapefile: matching basenames.
  const shpBase = base(byExt.shp.name);
  for (const ext of ['dbf', 'prj', 'shx']) {
    if (byExt[ext] && base(byExt[ext].name) !== shpBase) {
      throw new Error(`Shapefile parts don't match: "${byExt[ext].name}" belongs to a different shapefile than "${byExt.shp.name}". Drop one shapefile's parts at a time.`);
    }
  }

  const { default: shp } = await import('shpjs');
  const shpBuf = await byExt.shp.arrayBuffer();
  const geoms = shp.parseShp(shpBuf);

  let fc;
  if (byExt.dbf) {
    const dbfBuf = await byExt.dbf.arrayBuffer();
    const rows = shp.parseDbf(dbfBuf);
    fc = shp.combine([geoms, rows]);
    if (!fc?.features?.length) throw new Error("Shapefile contained no features.");
  } else {
    // No .dbf — geometry only, no attributes
    if (!geoms?.length) throw new Error("Shapefile contained no geometry.");
    fc = {
      type: "FeatureCollection",
      features: geoms.map((g) => ({ type: "Feature", geometry: g, properties: {} })),
    };
  }

  // Projection handling: the .prj declares the source CRS. Geographic WGS84
  // (and near-identical NAD83) pass through; projected CRSs are reprojected
  // to WGS84 with proj4. A projected file WITHOUT a .prj is rejected with a
  // useful error rather than silently plotted at metre coordinates.
  const prjText = byExt.prj ? (await byExt.prj.text()).trim() : null;
  return applyShapefileProjection(fc, prjText);
}

// Exported for tests. Reprojects a FeatureCollection according to .prj WKT.
export async function applyShapefileProjection(fc, prjText) {
  if (prjText) {
    if (isGeographicWgs84(prjText)) return fc;   // already lat/long
    let converter;
    try {
      const { default: proj4 } = await import('proj4');
      converter = proj4(prjText, 'EPSG:4326');
    } catch {
      throw new Error("This shapefile's .prj projection isn't supported. Re-export it in WGS84 (EPSG:4326) — most GIS tools and mapshaper.org can do this.");
    }
    return reprojectGeoJSON(fc, (xy) => converter.forward(xy));
  }
  // No .prj: accept only if the coordinates already look like lon/lat.
  if (!coordsLookLikeLonLat(fc)) {
    throw new Error("This shapefile's coordinates look projected (e.g. UTM metres), but no .prj file was included so the projection is unknown. Include the .prj, or re-export the file in WGS84 lat/long.");
  }
  return fc;
}

// GEOGCS roots (WGS84 / NAD83) are already latitude/longitude — no transform.
function isGeographicWgs84(wkt) {
  const head = wkt.slice(0, 20).toUpperCase();
  if (head.startsWith('PROJCS')) return false;
  return /^GEOGCS/i.test(wkt.trim()) && /WGS[_\s]?19?84|NAD[_\s]?19?83/i.test(wkt);
}

// Structure-preserving coordinate transform; never mutates the source.
function reprojectGeoJSON(fc, transform) {
  const mapCoords = (coords) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = transform([coords[0], coords[1]]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('Projection produced invalid coordinates — the .prj may not match this data.');
      }
      return coords.length > 2 ? [x, y, ...coords.slice(2)] : [x, y];
    }
    return coords.map(mapCoords);
  };
  return {
    ...fc,
    features: (fc.features || []).map((f) => ({
      ...f,
      geometry: f.geometry ? { ...f.geometry, coordinates: mapCoords(f.geometry.coordinates) } : f.geometry,
    })),
  };
}

// Sample up to 50 coordinate pairs; true when all are plausible lon/lat.
function coordsLookLikeLonLat(fc) {
  const sample = [];
  const visit = (coords) => {
    if (sample.length >= 50) return;
    if (typeof coords[0] === 'number') { sample.push(coords); return; }
    for (const c of coords) visit(c);
  };
  for (const f of fc.features || []) {
    if (f.geometry?.coordinates) visit(f.geometry.coordinates);
    if (sample.length >= 50) break;
  }
  if (!sample.length) return true; // nothing to judge
  return sample.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
}

// ── GeoJSON validation ──────────────────────────────────────────────────────

const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);

function validGeometry(g) {
  if (g === null) return true; // null geometry is legal GeoJSON
  if (!g || typeof g !== 'object' || !GEOMETRY_TYPES.has(g.type)) return false;
  if (g.type === 'GeometryCollection') {
    return Array.isArray(g.geometries) && g.geometries.every(validGeometry);
  }
  if (!Array.isArray(g.coordinates)) return false;
  // Spot-check the first coordinate leaf: must bottom out in numbers.
  let leaf = g.coordinates;
  let depth = 0;
  while (Array.isArray(leaf) && depth < 6) { leaf = leaf[0]; depth += 1; }
  if (g.coordinates.length === 0) return g.type !== 'Point'; // empty multi-geoms are tolerable
  return typeof leaf === 'number' && Number.isFinite(leaf);
}

// Exported for tests. Accepts FeatureCollection / Feature / bare geometry and
// always returns a FeatureCollection; throws a clear error on anything else.
export function validateGeoJSON(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid GeoJSON file.');
  if (data.type === 'FeatureCollection') {
    if (!Array.isArray(data.features)) throw new Error('Invalid GeoJSON: FeatureCollection has no features array.');
    const bad = data.features.find((f) => !f || f.type !== 'Feature' || !validGeometry(f.geometry ?? null));
    if (bad) throw new Error('Invalid GeoJSON: a feature has a malformed or unrecognized geometry.');
    return data;
  }
  if (data.type === 'Feature') {
    if (!validGeometry(data.geometry ?? null)) throw new Error('Invalid GeoJSON: malformed geometry.');
    return { type: 'FeatureCollection', features: [data] };
  }
  if (GEOMETRY_TYPES.has(data.type)) {
    if (!validGeometry(data)) throw new Error('Invalid GeoJSON: malformed geometry.');
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: data, properties: {} }] };
  }
  throw new Error(`Not a recognized GeoJSON file (root type "${data.type ?? 'missing'}").`);
}

// --- CSV drillhole import ---

function detectColumn(headers, role) {
  const synonyms = COL_SYNONYMS[role] || [];
  const h = headers.map((v) => v.toLowerCase().trim().replace(/[\s-]/g, '_'));
  let idx = synonyms.reduce((found, syn) => found >= 0 ? found : h.indexOf(syn), -1);
  if (idx >= 0) return idx;
  // Loose match for real-world headers ("Latitude (DD)", "lon_wgs84",
  // "utm_easting_m") — exact-only sent too many clean files to the manual
  // mapper. Substring matching only for tokens >=3 chars so 'x'/'y' can't
  // false-positive inside unrelated names.
  idx = h.findIndex((name) => synonyms.some((syn) =>
    syn.length >= 3 && (name.startsWith(syn) || name.includes(`_${syn}`) || name.includes(`${syn}_`))
  ));
  return idx;
}

// Do the values in these two columns look like WGS84 lon/lat (what the map
// expects)? Guards against silently plotting UTM metres at absurd coordinates.
function valuesLookLikeLonLat(rows, xHeader, yHeader) {
  const sample = [];
  for (const row of rows) {
    const x = parseFloat(row[xHeader]);
    const y = parseFloat(row[yHeader]);
    if (!isNaN(x) && !isNaN(y)) sample.push([x, y]);
    if (sample.length >= 50) break;
  }
  if (!sample.length) return false;
  return sample.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
}

async function parseCsvText(text) {
  // RFC 4180-compliant parsing (quoted commas, escaped quotes, blank fields,
  // CRLF/LF, multiline quoted fields). Delimiter auto-detected from comma,
  // tab, and semicolon so the existing TSV/semicolon workflows keep working.
  const { default: Papa } = await import('papaparse');
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; // strip UTF-8 BOM
  const parsed = Papa.parse(clean, {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', '\t', ';'],
    transformHeader: (h) => h.trim(),
  });
  const headers = (parsed.meta?.fields || []).filter((h) => h != null);
  const rows = (parsed.data || []).map((row) => {
    const out = {};
    for (const h of headers) out[h] = typeof row[h] === 'string' ? row[h].trim() : (row[h] ?? '');
    return out;
  });
  return { headers, rows };
}

export function csvToGeoJSON(rows, mapping) {
  // mapping: { x: headerName, y: headerName, id?: headerName, elev?: headerName, ... }
  const features = [];
  for (const row of rows) {
    const xVal = parseFloat(row[mapping.x]);
    const yVal = parseFloat(row[mapping.y]);
    if (isNaN(xVal) || isNaN(yVal)) continue;
    const props = { ...row };
    if (mapping.id) props._holeid = row[mapping.id] || '';
    const label = mapping.id ? (row[mapping.id] || '') : '';
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [xVal, yVal] },
      properties: { ...props, label },
    });
  }
  if (!features.length) throw new Error("No valid coordinate rows found in CSV.");
  const skippedRows = rows.length - features.length;
  return { type: 'FeatureCollection', features, ...(skippedRows > 0 ? { meta: { skippedRows } } : {}) };
}

export async function loadCSV(file) {
  if (!file) throw new Error("No file provided.");
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum is 50 MB.`);
  }

  const text = await file.text();
  const { headers, rows } = await parseCsvText(text);
  if (!headers.length) throw new Error("CSV file appears to be empty.");

  const xIdx = detectColumn(headers, 'x');
  const yIdx = detectColumn(headers, 'y');
  const idIdx = detectColumn(headers, 'id');
  const elevIdx = detectColumn(headers, 'elev');
  const guesses = {
    ...(xIdx >= 0 ? { x: headers[xIdx] } : {}),
    ...(yIdx >= 0 ? { y: headers[yIdx] } : {}),
    ...(idIdx >= 0 ? { id: headers[idIdx] } : {}),
    ...(elevIdx >= 0 ? { elev: headers[elevIdx] } : {}),
  };

  // Both coordinate columns found AND the values are in lon/lat range →
  // import with zero questions asked.
  if (xIdx >= 0 && yIdx >= 0) {
    if (valuesLookLikeLonLat(rows, headers[xIdx], headers[yIdx])) {
      return csvToGeoJSON(rows, guesses);
    }
    // Headers matched but values look projected (UTM metres etc.) — importing
    // would scatter points at nonsense coordinates. Ask, with an explanation.
    return {
      needsMapping: true, headers, rows, guesses,
      hint: 'These coordinates look like projected values (e.g. UTM metres), not latitude/longitude. Exploration Maps needs WGS84 lat/long — convert the file at mapshaper.org, or pick different columns if the file has lat/long ones.',
    };
  }

  // Headers didn't identify a coordinate pair — scan values for one plausible
  // lon/lat pair to pre-select in the mapper.
  if (!guesses.x || !guesses.y) {
    const numericCols = headers.filter((hd) => {
      let seen = 0;
      for (const row of rows) {
        const v = row[hd];
        if (v === '' || v == null) continue;
        if (isNaN(parseFloat(v))) return false;
        if (++seen >= 20) break;
      }
      return seen > 0;
    });
    const latCands = numericCols.filter((hd) => rows.slice(0, 50).every((r) => r[hd] === '' || Math.abs(parseFloat(r[hd])) <= 90));
    const lonCands = numericCols.filter((hd) => !latCands.includes(hd) && rows.slice(0, 50).every((r) => r[hd] === '' || Math.abs(parseFloat(r[hd])) <= 180));
    if (!guesses.y && latCands.length === 1) guesses.y = latCands[0];
    if (!guesses.x && lonCands.length === 1) guesses.x = lonCands[0];
  }

  // Needs user confirmation — pre-populated with our best guesses.
  return { needsMapping: true, headers, rows, guesses };
}
