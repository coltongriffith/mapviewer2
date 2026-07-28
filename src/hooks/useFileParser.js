import { useState, useCallback } from 'react';
import proj4 from 'proj4';
import { loadGeoJSON } from '../utils/importers';

// Coordinate reference systems we can convert FROM, once the user tells us
// which one their file uses.
//
// We deliberately do NOT guess. The previous behaviour assumed any coordinate
// outside lon/lat range was BC Albers and silently reprojected it — so a UTM,
// Web Mercator, or state-plane file produced a plausible-looking map in the
// wrong place. In a mineral exploration product a confidently wrong location
// is worse than a refused import (audit P0-11).
proj4.defs('EPSG:3005', '+proj=aea +lat_0=45 +lon_0=-126 +lat_1=50 +lat_2=58.5 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs');
proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs');
// NAD83 UTM zones covering Canada and the continental US (7N–22N).
for (let zone = 7; zone <= 22; zone += 1) {
  proj4.defs(`EPSG:${26900 + zone}`, `+proj=utm +zone=${zone} +datum=NAD83 +units=m +no_defs`);
}
// WGS84 UTM zones (north), same coverage.
for (let zone = 7; zone <= 22; zone += 1) {
  proj4.defs(`EPSG:${32600 + zone}`, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
}

export const SUPPORTED_CRS = [
  { code: 'EPSG:4326', label: 'WGS84 longitude/latitude (EPSG:4326)', projected: false },
  { code: 'EPSG:3005', label: 'BC Albers (EPSG:3005)', projected: true },
  { code: 'EPSG:3857', label: 'Web Mercator (EPSG:3857)', projected: true },
  ...Array.from({ length: 16 }, (_, i) => {
    const zone = i + 7;
    return { code: `EPSG:${26900 + zone}`, label: `NAD83 / UTM zone ${zone}N (EPSG:${26900 + zone})`, projected: true };
  }),
  ...Array.from({ length: 16 }, (_, i) => {
    const zone = i + 7;
    return { code: `EPSG:${32600 + zone}`, label: `WGS84 / UTM zone ${zone}N (EPSG:${32600 + zone})`, projected: true };
  }),
];

function sampleCoordinate(geojson) {
  const features = geojson?.features || (geojson?.type === 'Feature' ? [geojson] : []);
  for (const f of features) {
    const coords = flattenCoords(f?.geometry);
    if (coords) return coords;
  }
  return null;
}

function flattenCoords(geom) {
  if (!geom) return null;
  const { type, coordinates } = geom;
  if (type === 'Point') return coordinates;
  if (type === 'LineString' || type === 'MultiPoint') return coordinates[0];
  if (type === 'Polygon' || type === 'MultiLineString') return coordinates[0]?.[0];
  if (type === 'MultiPolygon') return coordinates[0]?.[0]?.[0];
  return null;
}

/** True when coordinates fall outside lon/lat bounds, i.e. some projected CRS. */
export function isProjected(geojson) {
  const coord = sampleCoordinate(geojson);
  if (!coord) return false;
  return Math.abs(coord[0]) > 180 || Math.abs(coord[1]) > 90;
}

/**
 * Read an EPSG code from a GeoJSON `crs` member or a shapefile `.prj` that the
 * importer attached. Returns null when nothing trustworthy is present — the
 * caller must then ask the user rather than assume.
 */
export function detectCRS(geojson) {
  // GeoJSON named CRS (pre-RFC7946 but still common from GIS exports).
  const name = geojson?.crs?.properties?.name;
  if (typeof name === 'string') {
    const m = name.match(/(?:EPSG|epsg)[:]{1,2}(\d{4,6})/);
    if (m) {
      const code = `EPSG:${m[1]}`;
      if (SUPPORTED_CRS.some((c) => c.code === code)) return code;
      // A named CRS we cannot convert is still information: surface it so the
      // caller can name it in the error instead of guessing.
      return code;
    }
    if (/CRS84|WGS[ _]?84/i.test(name)) return 'EPSG:4326';
  }
  // Attached .prj text, when the shapefile importer provides it.
  const prj = geojson?.__prj;
  if (typeof prj === 'string' && prj) {
    const auth = prj.match(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"(\d+)"\s*\]\s*\]\s*$/);
    if (auth) return `EPSG:${auth[1]}`;
    if (/Albers/i.test(prj) && /British_Columbia|BC_Albers/i.test(prj)) return 'EPSG:3005';
    const utm = prj.match(/UTM[_ ]zone[_ ](\d{1,2})N/i);
    if (utm) {
      const zone = Number(utm[1]);
      // WKT spells the datum several ways: NAD83, NAD_1983, D_North_American_1983.
      if (/NAD[_ ]?(?:19)?83|North[_ ]American[_ ]1983/i.test(prj)) return `EPSG:${26900 + zone}`;
      if (/WGS[_ ]?(?:19)?84/i.test(prj)) return `EPSG:${32600 + zone}`;
    }
    if (/Mercator_Auxiliary_Sphere|Web_Mercator/i.test(prj)) return 'EPSG:3857';
    if (/GEOGCS/i.test(prj) && !/PROJCS/i.test(prj)) return 'EPSG:4326';
  }
  return null;
}

function reprojectCoord(coord, from) {
  if (!coord || coord.length < 2) return coord;
  const [x, y, ...rest] = coord;
  const [lon, lat] = proj4(from, 'WGS84', [x, y]);
  return [lon, lat, ...rest];
}

function reprojectCoordArray(coords, depth, from) {
  if (depth === 0) return reprojectCoord(coords, from);
  return coords.map((c) => reprojectCoordArray(c, depth - 1, from));
}

function reprojectGeometry(geom, from) {
  if (!geom) return geom;
  const depthMap = { Point: 0, LineString: 1, MultiPoint: 1, Polygon: 2, MultiLineString: 2, MultiPolygon: 3 };
  const depth = depthMap[geom.type];
  if (depth == null) return geom;
  return { ...geom, coordinates: reprojectCoordArray(geom.coordinates, depth, from) };
}

export function reprojectGeoJSON(geojson, from) {
  if (!from || from === 'EPSG:4326') return geojson;
  if (geojson.type === 'Feature') {
    return { ...geojson, geometry: reprojectGeometry(geojson.geometry, from) };
  }
  if (geojson.type === 'FeatureCollection') {
    return { ...geojson, features: geojson.features.map((f) => ({ ...f, geometry: reprojectGeometry(f.geometry, from) })) };
  }
  return geojson;
}

/**
 * Sanity-check the RESULT of a conversion. A wrong CRS usually lands the data
 * far outside any plausible position, so bounds are a cheap last line of
 * defence before the layer is committed.
 */
export function boundsLookSane(geojson) {
  const coord = sampleCoordinate(geojson);
  if (!coord) return true;
  const [lon, lat] = coord;
  return Number.isFinite(lon) && Number.isFinite(lat)
    && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

export function useFileParser() {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  // Set when a projected file arrives with no trustworthy CRS: the caller
  // shows a picker and calls parseFile again with an explicit `crs`.
  const [needsCRS, setNeedsCRS] = useState(null); // { geojson } | null

  const parseFile = useCallback(async (file, { crs } = {}) => {
    setParsing(true);
    setError(null);
    setNeedsCRS(null);
    try {
      const geojson = await loadGeoJSON(file);

      if (!isProjected(geojson)) return geojson; // already lon/lat

      // Explicit user choice wins; otherwise use a trustworthy declaration.
      const from = crs || detectCRS(geojson);
      if (!from) {
        // NO GUESSING. Hand back to the caller to ask which CRS this is.
        setNeedsCRS({ geojson });
        setError('This file uses projected coordinates but does not say which coordinate system. Choose one to continue.');
        return null;
      }
      if (!SUPPORTED_CRS.some((c) => c.code === from)) {
        setError(`This file uses ${from}, which isn't supported yet. Re-export it as WGS84 longitude/latitude (EPSG:4326) and try again.`);
        return null;
      }

      const out = reprojectGeoJSON(geojson, from);
      if (!boundsLookSane(out)) {
        setError(`Converting from ${from} produced coordinates outside the world. That usually means the file is in a different coordinate system — check the source and try again.`);
        return null;
      }
      // Record provenance so the layer (and exports) can state how it was placed.
      out.__crs = { from, converted: true };
      return out;
    } catch (e) {
      setError(e.message || 'Failed to parse file');
      return null;
    } finally {
      setParsing(false);
    }
  }, []);

  return { parseFile, parsing, error, setError, needsCRS, setNeedsCRS };
}
