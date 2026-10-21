// Exploration Maps 3D: a .zip of drill files, unpacked in the browser. Its CSV, TXT and OBJ files load as if
// dropped one by one; folders, Mac resource forks, READMEs and anything else are skipped. Loaded by
// studio.js with the first ZIP (a drop, the file picker or EM3D.addZip).
import { unzipSync } from 'fflate';

const DATA_FILE = /\.(csv|txt|obj|xyz|dat)$/i; // xyz, dat: EXT hook (Geosoft XYZ geophysics)
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
export function unzipDataFiles(buffer) {
  let total = 0;
  const entries = unzipSync(new Uint8Array(buffer), {
    filter: (f) => {
      const keep = DATA_FILE.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name) && !/(^|\/)readme[^/]*$/i.test(f.name);
      if (keep) total += f.originalSize;
      if (total > MAX_ZIP_BYTES) throw new Error('That ZIP unpacks to more than 200 MB. Send the drill files on their own.');
      return keep;
    },
  });
  const decoder = new TextDecoder();
  return Object.entries(entries).map(([path, bytes]) => ({ name: path.split('/').pop(), text: decoder.decode(bytes) }));
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
