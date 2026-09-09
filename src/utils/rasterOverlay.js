// Georeferenced images and custom tile services as map layers.
//
// A geophysics grid — the magnetics image every target map is read against —
// arrives as a picture with a world file, or as a picture and four corner
// coordinates. Neither had a way in: uploads were vector only, and the only
// advice was to trace anomaly outlines in another program. This puts the
// picture itself under the claims, and a published tile or WMS service beside
// the built-in reference overlays.
//
// No React and no Leaflet imports. The editor map draws these with Leaflet,
// the exporters draw them from the same bounds, and the placement dialog
// only needs the maths.

export const RASTER_ACCEPT = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
export const WORLD_FILE_ACCEPT = ['.pgw', '.jgw', '.jpgw', '.gfw', '.wld', '.tfw', '.pngw', '.jpegw'];
export const MAX_RASTER_BYTES = 8 * 1024 * 1024;
// Stored inside the project (compressed local storage, cloud row), so the
// image is resampled to this long edge before it is kept.
export const MAX_RASTER_EDGE = 2048;

export function isRasterName(name) {
  const n = String(name || '').toLowerCase();
  return RASTER_ACCEPT.some((ext) => n.endsWith(ext));
}

export function isWorldFileName(name) {
  const n = String(name || '').toLowerCase();
  return WORLD_FILE_ACCEPT.some((ext) => n.endsWith(ext));
}

function stem(name) {
  return String(name || '').toLowerCase().replace(/\.[^.]+$/, '');
}

/** The world file dropped beside an image, matched on the file stem. */
export function worldFileFor(imageName, files) {
  const s = stem(imageName);
  return (files || []).find((f) => isWorldFileName(f.name) && stem(f.name) === s) || null;
}

/**
 * The six lines of an ESRI world file: x-scale, y-skew, x-skew, y-scale (the
 * negative of the pixel height), then the CENTRE of the top-left pixel.
 */
export function parseWorldFile(text) {
  const nums = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(Number);
  if (nums.length < 6 || nums.slice(0, 6).some((n) => !Number.isFinite(n))) return null;
  const [a, d, b, e, c, f] = nums;
  // A degenerate transform (zero area) is not a placement. A rotation puts
  // zeros on the diagonal and is fine.
  if (a * e - b * d === 0) return null;
  return { a, d, b, e, c, f };
}

/**
 * Axis-aligned bounds of an image under a world file, in the file's own
 * coordinates. A rotated world file is honoured by taking the bounding box of
 * the four corners: the picture is placed in that box, so a rotated grid is
 * approximated, not warped.
 */
export function boundsFromWorldFile(wf, width, height) {
  if (!wf || !(width > 0) || !(height > 0)) return null;
  const corner = (px, py) => ({ x: wf.a * px + wf.b * py + wf.c, y: wf.d * px + wf.e * py + wf.f });
  // The world file names the centre of the top-left pixel; edges are half a
  // pixel out from there.
  const pts = [corner(-0.5, -0.5), corner(width - 0.5, -0.5), corner(-0.5, height - 0.5), corner(width - 0.5, height - 0.5)];
  return {
    west: Math.min(...pts.map((p) => p.x)),
    east: Math.max(...pts.map((p) => p.x)),
    south: Math.min(...pts.map((p) => p.y)),
    north: Math.max(...pts.map((p) => p.y)),
  };
}

export function looksLikeLatLng(bounds) {
  if (!bounds) return false;
  const { west, east, south, north } = bounds;
  return Math.abs(west) <= 180 && Math.abs(east) <= 180 && Math.abs(south) <= 90 && Math.abs(north) <= 90;
}

export function utmProjString(zone, hemisphere = 'N', datum = 'NAD83') {
  const z = Math.max(1, Math.min(60, Math.round(Number(zone) || 1)));
  return `+proj=utm +zone=${z}${hemisphere === 'S' ? ' +south' : ''} +datum=${datum === 'WGS84' ? 'WGS84' : 'NAD83'} +units=m +no_defs`;
}

/**
 * Bounds in some projection → WGS84 bounds, as the bounding box of the four
 * reprojected corners. `crs` is 'EPSG:4326' (no-op), an EPSG code, or a proj
 * string. proj4 is loaded on demand: the shapefile importer is the only other
 * caller, and neither belongs in the editor's first load.
 */
export async function reprojectBounds(bounds, crs) {
  if (!bounds) return null;
  if (!crs || crs === 'EPSG:4326' || crs === 'WGS84') return { ...bounds };
  const { default: proj4 } = await import('proj4');
  const to = proj4(crs, 'EPSG:4326');
  const pts = [[bounds.west, bounds.south], [bounds.east, bounds.south], [bounds.west, bounds.north], [bounds.east, bounds.north]]
    .map(([x, y]) => to.forward([x, y]));
  return {
    west: Math.min(...pts.map((p) => p[0])),
    east: Math.max(...pts.map((p) => p[0])),
    south: Math.min(...pts.map((p) => p[1])),
    north: Math.max(...pts.map((p) => p[1])),
  };
}

export function validBounds(b) {
  return !!b && [b.west, b.east, b.south, b.north].every(Number.isFinite)
    && b.east > b.west && b.north > b.south
    && Math.abs(b.west) <= 180 && Math.abs(b.east) <= 180 && Math.abs(b.south) <= 90 && Math.abs(b.north) <= 90;
}

/** Leaflet's [[south, west], [north, east]]. */
export function leafletBounds(b) {
  return [[b.south, b.west], [b.north, b.east]];
}

/**
 * Read an image file into a data URL no larger than MAX_RASTER_EDGE on its
 * long edge. PNG keeps its transparency (a geophysics grid rarely covers the
 * whole property); anything else becomes JPEG.
 */
export async function loadRasterImage(file, maxEdge = MAX_RASTER_EDGE) {
  if (!file) throw new Error('No image provided.');
  if (file.size > MAX_RASTER_BYTES) {
    throw new Error(`Image too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum is ${MAX_RASTER_BYTES / 1024 / 1024} MB.`);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read the image.'));
      el.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!(w > 0 && h > 0)) throw new Error('Could not read the image.');
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
    const png = /png|gif|webp/i.test(file.type) || /\.(png|gif|webp)$/i.test(file.name);
    const dataUri = png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88);
    return { dataUri, width: cw, height: ch, sourceWidth: w, sourceHeight: h, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A raster as a project layer: no features, so every vector path skips it. */
export function rasterLayer({ id, name, dataUri, width, height, bounds, opacity = 0.85 }) {
  const baseName = String(name || 'Image').replace(/\.[^.]+$/, '');
  return {
    id,
    name: baseName,
    displayName: baseName,
    sourceName: name,
    dataSource: 'raster',
    type: 'raster',
    role: 'anomalies',
    visible: true,
    // Mode presets hide roles they do not list; a raster the user placed by
    // hand must never vanish on a mode change.
    userStyled: true,
    geojson: null,
    legend: { enabled: false },
    raster: { dataUri, width, height, bounds, opacity },
  };
}

export function isXyzTemplate(url) {
  return /\{z\}/.test(url) && /\{x\}/.test(url) && /\{y\}/.test(url);
}

/** Reject anything that is not an https tile template or WMS endpoint. */
export function validateTileSource({ kind, url }) {
  const u = String(url || '').trim();
  if (!/^https:\/\//i.test(u)) return 'The URL must start with https://';
  if (kind === 'xyz' && !isXyzTemplate(u)) return 'A tile URL needs {z}, {x} and {y} placeholders, e.g. …/tiles/{z}/{x}/{y}.png';
  if (/[?&](api[-_]?key|access[-_]?token|key)=/i.test(u)) return 'Do not put an API key in the URL: it would be saved with the map and shared with it.';
  return '';
}

export function tileLayer({ id, name, kind, url, layers, attribution, opacity = 0.8 }) {
  const label = String(name || '').trim() || (kind === 'wms' ? 'WMS layer' : 'Tile layer');
  return {
    id,
    name: label,
    displayName: label,
    sourceName: url,
    dataSource: 'tiles',
    type: 'tiles',
    role: 'anomalies',
    visible: true,
    userStyled: true,
    geojson: null,
    legend: { enabled: false },
    tiles: {
      kind: kind === 'wms' ? 'wms' : 'xyz',
      url: String(url).trim(),
      ...(kind === 'wms' ? { wms: { layers: String(layers || '').trim(), format: 'image/png', transparent: true } } : {}),
      attribution: String(attribution || '').trim(),
      opacity,
    },
  };
}

/** Credit lines for the exported margin: one per custom tile service used. */
export function tileLayerCredits(layers) {
  return (layers || [])
    .filter((l) => l?.type === 'tiles' && l.visible !== false)
    .map((l) => {
      const who = l.tiles?.attribution;
      let host = '';
      try { host = new URL(l.tiles.url).host; } catch { host = ''; }
      return `${l.displayName || l.name}: ${who || host}`;
    })
    .filter(Boolean);
}
