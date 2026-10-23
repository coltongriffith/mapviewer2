// Deterministic invented positions for local scale measurements only.
const holeId = (n) => `SYNTHETIC-${String(n + 1).padStart(4, '0')}`;
export const scaleCounts = (holes) => ({ collars: holes, surveys: holes * 10, assays: holes * 100 });
export const scaleRow = {
  collars: (i) => ({ hole_id: holeId(i), x: 500000 + (i % 50) * 20, y: 5500000 + Math.floor(i / 50) * 20, z: 1000, crs: 'EPSG:32610', azimuth: 90, dip: -60, depth: 200 }),
  surveys: (i) => ({ hole_id: holeId(Math.floor(i / 10)), depth_m: (i % 10) * 20, azimuth: 90 + (i % 10), dip: -60 }),
  assays: (i) => ({ hole_id: holeId(Math.floor(i / 100)), from_m: (i % 100) * 2, to_m: (i % 100) * 2 + 2, values: { Au: ((i % 10) + 1) / 10 }, units: { Au: 'g/t' }, sample_id: `SYN-${i}` }),
};
