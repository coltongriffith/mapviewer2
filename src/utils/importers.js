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
    // KMZ is a ZIP; the main KML is conventionally doc.kml or the first .kml file
    const kmlFiles = Object.keys(zip.files).filter((f) => f.toLowerCase().endsWith(".kml"));
    const kmlName = kmlFiles.find((f) => f.toLowerCase() === "doc.kml") || kmlFiles[0];
    if (!kmlName) throw new Error("No .kml file found inside KMZ archive.");
    const text = await zip.files[kmlName].async("string");
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) throw new Error("KMZ contained an invalid KML file.");
    const fc = toGeoJSON.kml(doc);
    if (!fc?.features?.length) throw new Error("KMZ file contained no readable features.");
    return fc;
  }

  if (name.endsWith(".geojson") || name.endsWith(".json")) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") throw new Error("Invalid GeoJSON file.");
    return data;
  }

  if (name.endsWith(".shp")) {
    // Single .shp dropped without its companions — load geometry only
    const buffer = await file.arrayBuffer();
    const { default: shp } = await import('shpjs');
    const geoms = shp.parseShp(buffer);
    if (!geoms?.length) throw new Error("Shapefile contained no geometry.");
    return {
      type: "FeatureCollection",
      features: geoms.map((g) => ({ type: "Feature", geometry: g, properties: {} })),
    };
  }

  throw new Error("Unsupported file type. Use .zip (shapefile), .shp/.dbf (dropped together), .geojson, .json, .kml, or .kmz");
}

// --- Multi-file shapefile import (.shp + .dbf + optional .prj/.shx) ---

export async function loadShapefileSet(files) {
  const byExt = {};
  for (const f of files) {
    const ext = f.name.toLowerCase().split('.').pop();
    byExt[ext] = f;
  }
  if (!byExt.shp) throw new Error("No .shp file found. Drop all shapefile parts together (.shp, .dbf, .prj, .shx).");

  const { default: shp } = await import('shpjs');
  const shpBuf = await byExt.shp.arrayBuffer();
  const geoms = shp.parseShp(shpBuf);

  if (byExt.dbf) {
    const dbfBuf = await byExt.dbf.arrayBuffer();
    const rows = shp.parseDbf(dbfBuf);
    const result = shp.combine([geoms, rows]);
    if (!result?.features?.length) throw new Error("Shapefile contained no features.");
    return result;
  }

  // No .dbf — geometry only, no attributes
  if (!geoms?.length) throw new Error("Shapefile contained no geometry.");
  return {
    type: "FeatureCollection",
    features: geoms.map((g) => ({ type: "Feature", geometry: g, properties: {} })),
  };
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
  const lines = text.split(/\r?\n/);
  if (!lines.length) return { headers: [], rows: [] };
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delim).map((h) => h.trim().replace(/^["']|["']$/g, ''));
  const rows = [];
  const CHUNK = 2000;
  for (let i = 1; i < lines.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, lines.length);
    for (let j = i; j < end; j++) {
      const line = lines[j].trim();
      if (!line) continue;
      const parts = line.split(delim).map((v) => v.trim().replace(/^["']|["']$/g, ''));
      const row = {};
      headers.forEach((h, k) => { row[h] = parts[k] ?? ''; });
      rows.push(row);
    }
    if (i + CHUNK < lines.length) await new Promise((resolve) => setTimeout(resolve, 0));
  }
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
  return { type: 'FeatureCollection', features };
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
