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

  throw new Error("Unsupported file type. Use .zip (shapefile), .geojson, .json, .kml, or .kmz");
}

// --- CSV drillhole import ---

function detectColumn(headers, role) {
  const synonyms = COL_SYNONYMS[role] || [];
  const h = headers.map((v) => v.toLowerCase().trim().replace(/[\s-]/g, '_'));
  const idx = synonyms.reduce((found, syn) => found >= 0 ? found : h.indexOf(syn), -1);
  return idx;
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

  // If both coordinate columns were found unambiguously, convert now
  if (xIdx >= 0 && yIdx >= 0) {
    const idIdx = detectColumn(headers, 'id');
    const elevIdx = detectColumn(headers, 'elev');
    const mapping = {
      x: headers[xIdx],
      y: headers[yIdx],
      ...(idIdx >= 0 ? { id: headers[idIdx] } : {}),
      ...(elevIdx >= 0 ? { elev: headers[elevIdx] } : {}),
    };
    return csvToGeoJSON(rows, mapping);
  }

  // Needs user to map columns
  return { needsMapping: true, headers, rows };
}
