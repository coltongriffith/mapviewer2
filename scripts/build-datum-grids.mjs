// Rebuilds public/grids/*.gsb (standard little-endian NTv2) from the PROJ CDN
// GeoTIFF grids, so the app reads them with proj4.nadgrid and no GeoTIFF
// decoder. Values are copied unchanged (float32 arc-seconds); one file per
// top-level NTv2 grid, so a property loads only the region it needs.
//   npm i --no-save geotiff@2.1.3
//   curl -O https://cdn.proj.org/ca_nrc_ntv2_0.tif -O https://cdn.proj.org/us_noaa_conus.tif -O https://cdn.proj.org/us_noaa_alaska.tif
//   node scripts/build-datum-grids.mjs <folder with the .tif files>
// Then copy the printed sha256 values into DATUM_GRIDS in src/utils/datumConvert.js.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromArrayBuffer } from 'geotiff';

const OUT = new URL('../public/grids/', import.meta.url);
const CLRK66 = [6378206.4, 6356583.8], GRS80 = [6378137, 6356752.314140356];
const SOURCES = [
  ['ca_nrc_ntv2_0.tif', { CAwest: 'ca_nrc_ntv2_0_west', CAeast: 'ca_nrc_ntv2_0_east', CAnorth: 'ca_nrc_ntv2_0_north', CAarctic: 'ca_nrc_ntv2_0_arctic' }],
  ['us_noaa_conus.tif', { '': 'us_noaa_conus' }],
  ['us_noaa_alaska.tif', { '': 'us_noaa_alaska' }],
];
const text = (s) => Buffer.from(s.padEnd(8).slice(0, 8), 'latin1');
const rec = (key, kind, value) => {
  const b = Buffer.alloc(16); text(key).copy(b, 0);
  if (kind === 'i') b.writeInt32LE(value, 8); else if (kind === 'd') b.writeDoubleLE(value, 8); else text(value).copy(b, 8);
  return b;
};
const meta = (md, key) => (md || '').match(new RegExp(`name="${key}">([^<]*)<`))?.[1] || '';

async function grids(file) {
  const buf = readFileSync(file);
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const out = [];
  for (let i = 0; i < await tiff.getImageCount(); i++) {
    const im = await tiff.getImage(i), fd = im.fileDirectory;
    if (im.getGeoKeys().GTRasterTypeGeoKey !== 2) throw new Error(`${file}: expected PixelIsPoint`);
    if (!/positive_value" sample="1">east/.test((await tiff.getImage(0)).fileDirectory.GDAL_METADATA)) throw new Error(`${file}: longitude offsets not east-positive`);
    const [dx, dy] = fd.ModelPixelScale, [, , , west, north] = fd.ModelTiepoint;
    const w = im.getWidth(), h = im.getHeight(), bands = await im.readRasters();
    out.push({ name: meta(fd.GDAL_METADATA, 'grid_name'), parent: meta(fd.GDAL_METADATA, 'parent_grid_name'), w, h, dx, dy, west, north, bands });
  }
  return out;
}

function ntv2(subgrids) {
  const parts = [rec('NUM_OREC', 'i', 11), rec('NUM_SREC', 'i', 11), rec('NUM_FILE', 'i', subgrids.length), rec('GS_TYPE', 's', 'SECONDS'),
    rec('VERSION', 's', 'NTv2.0'), rec('SYSTEM_F', 's', 'NAD27'), rec('SYSTEM_T', 's', 'NAD83'),
    rec('MAJOR_F', 'd', CLRK66[0]), rec('MINOR_F', 'd', CLRK66[1]), rec('MAJOR_T', 'd', GRS80[0]), rec('MINOR_T', 'd', GRS80[1])];
  subgrids.forEach((g, k) => {
    const s = (deg) => Math.round(deg * 3600 * 1e6) / 1e6;
    parts.push(rec('SUB_NAME', 's', g.name || `GRID${k}`), rec('PARENT', 's', g.parent || 'NONE'), rec('CREATED', 's', ''), rec('UPDATED', 's', ''),
      rec('S_LAT', 'd', s(g.north - (g.h - 1) * g.dy)), rec('N_LAT', 'd', s(g.north)),
      rec('E_LONG', 'd', -s(g.west + (g.w - 1) * g.dx)), rec('W_LONG', 'd', -s(g.west)),
      rec('LAT_INC', 'd', s(g.dy)), rec('LONG_INC', 'd', s(g.dx)), rec('GS_COUNT', 'i', g.w * g.h));
    const nodes = Buffer.alloc(g.w * g.h * 16); let o = 0;
    // NTv2 order: south row first, east to west; longitude shift positive west.
    for (let r = g.h - 1; r >= 0; r--) for (let c = g.w - 1; c >= 0; c--) {
      const i = r * g.w + c;
      nodes.writeFloatLE(g.bands[0][i], o); nodes.writeFloatLE(-g.bands[1][i], o + 4);
      nodes.writeFloatLE(g.bands[2]?.[i] ?? -1, o + 8); nodes.writeFloatLE(g.bands[3]?.[i] ?? -1, o + 12); o += 16;
    }
    parts.push(nodes);
  });
  parts.push(rec('END', 'd', 3.33e32));
  return Buffer.concat(parts);
}

mkdirSync(OUT, { recursive: true });
for (const [file, names] of SOURCES) {
  const all = await grids(join(process.argv[2] || '.', file));
  const root = (g) => { let r = g; while (r.parent) r = all.find((x) => x.name === r.parent); return r.name; };
  for (const [top, name] of Object.entries(names)) {
    const bytes = ntv2(all.filter((g) => !top || root(g) === top)); // parents before children, as written by PROJ
    writeFileSync(new URL(`${name}.gsb`, OUT), bytes);
    console.log(name, bytes.length, createHash('sha256').update(bytes).digest('hex'));
  }
}
