import { useState, useCallback } from 'react';
import proj4 from 'proj4';
import { loadGeoJSON } from '../utils/importers';

// BC Albers (EPSG:3005) — common projection for BC government shapefiles
proj4.defs('EPSG:3005', '+proj=aea +lat_0=45 +lon_0=-126 +lat_1=50 +lat_2=58.5 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs');

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

function needsReprojection(geojson) {
  const coord = sampleCoordinate(geojson);
  if (!coord) return false;
  // WGS84 bounds: lon [-180, 180], lat [-90, 90]
  // BC Albers easting is ~300,000–2,000,000; northing ~170,000–1,800,000
  return Math.abs(coord[0]) > 180 || Math.abs(coord[1]) > 90;
}

function reprojectCoord(coord) {
  if (!coord || coord.length < 2) return coord;
  const [x, y, ...rest] = coord;
  const [lon, lat] = proj4('EPSG:3005', 'WGS84', [x, y]);
  return [lon, lat, ...rest];
}

function reprojectCoordArray(coords, depth) {
  if (depth === 0) return reprojectCoord(coords);
  return coords.map(c => reprojectCoordArray(c, depth - 1));
}

function reprojectGeometry(geom) {
  if (!geom) return geom;
  const depthMap = { Point: 0, LineString: 1, MultiPoint: 1, Polygon: 2, MultiLineString: 2, MultiPolygon: 3 };
  const depth = depthMap[geom.type];
  if (depth == null) return geom;
  return { ...geom, coordinates: reprojectCoordArray(geom.coordinates, depth) };
}

function reprojectGeoJSON(geojson) {
  if (geojson.type === 'Feature') {
    return { ...geojson, geometry: reprojectGeometry(geojson.geometry) };
  }
  if (geojson.type === 'FeatureCollection') {
    return { ...geojson, features: geojson.features.map(f => ({ ...f, geometry: reprojectGeometry(f.geometry) })) };
  }
  return geojson;
}

export function useFileParser() {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);

  const parseFile = useCallback(async (file) => {
    setParsing(true);
    setError(null);
    try {
      const geojson = await loadGeoJSON(file);
      if (needsReprojection(geojson)) {
        return reprojectGeoJSON(geojson);
      }
      return geojson;
    } catch (e) {
      setError(e.message || 'Failed to parse file');
      return null;
    } finally {
      setParsing(false);
    }
  }, []);

  return { parseFile, parsing, error, setError };
}
