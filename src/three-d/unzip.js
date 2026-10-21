// Exploration Maps 3D: a .zip of drill files, unpacked in the browser. Its CSV, TXT and OBJ files load as if
// dropped one by one; folders, Mac resource forks, READMEs and anything else are skipped. Loaded by
// studio.js with the first ZIP (a drop, the file picker or EM3D.addZip).
// GeoJSON and KML files are map overlays; a shapefile (.shp with its .dbf and .prj) becomes one GeoJSON file.
import { unzipSync } from 'fflate';
import { shpToGeoJSON } from './shp.js';

const DATA_FILE = /\.(csv|txt|obj|xyz|dat|geojson|json|kml)$/i, SHP_PART = /\.(shp|dbf|prj)$/i; // xyz, dat: EXT hook (Geosoft XYZ geophysics)
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
export function unzipDataFiles(buffer) {
  let total = 0;
  const entries = unzipSync(new Uint8Array(buffer), {
    filter: (f) => {
      const keep = (DATA_FILE.test(f.name) || SHP_PART.test(f.name)) && !/(^|\/)(__MACOSX|\.)/.test(f.name) && !/(^|\/)readme[^/]*$/i.test(f.name);
      if (keep) total += f.originalSize;
      if (total > MAX_ZIP_BYTES) throw new Error('That ZIP unpacks to more than 200 MB. Send the drill files on their own.');
      return keep;
    },
  });
  const decoder = new TextDecoder(), all = Object.entries(entries), part = (base, ext) => all.find(([p]) => p.toLowerCase() === `${base}.${ext}`)?.[1];
  const shps = all.filter(([p]) => /\.shp$/i.test(p)).map(([p, bytes]) => {
    const base = p.slice(0, -4).toLowerCase(), buf = (b) => b && b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), prj = part(base, 'prj');
    return { name: `${p.split('/').pop().slice(0, -4)}.geojson`, text: JSON.stringify(shpToGeoJSON(buf(bytes), buf(part(base, 'dbf')), prj && decoder.decode(prj))) };
  });
  return all.filter(([p]) => DATA_FILE.test(p)).map(([path, bytes]) => ({ name: path.split('/').pop(), text: decoder.decode(bytes) })).concat(shps);
}
// For assistants (EM3D.addZip): a ZIP as a data URL, base64 string or ArrayBuffer.
export function zipFiles(zip) {
  let buf = zip;
  if (typeof zip === 'string') {
    const b64 = zip.replace(/^data:[^,]*,/, ''), bin = atob(b64);
    buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  }
  return unzipDataFiles(buf instanceof Uint8Array ? buf.buffer : buf);
}
