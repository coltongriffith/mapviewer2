import { describe, it, expect, vi } from 'vitest';
import { direction, minCurvature, offsetAt, desurveyPath } from '../shared/desurvey.js';
import { toFiles, snapshotOf, newerSince, noticeText, pull, mixedCrs, init, check, reset, FILE_NAMES } from '../src/three-d/property-data.js';
import { matchCols, roleOf, refineRole } from '../src/three-d/roles.js';
import { parseCsv } from '../src/utils/drillDb.js';
import { parseDrillFilter, matchesDrillFilter } from './fixtures/drill-filter.js';

const close = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('minimum-curvature desurvey (shared/desurvey.js)', () => {
  it('matches the textbook inclination/azimuth formula (Applied Drilling Engineering, 8.1)', () => {
    // 3500 ft at 15° inclination, azimuth 20°; 3600 ft at 25°, 45°. Inclination from vertical is dip -(90 - I).
    const pts = minCurvature([{ d: 3500, az: 20, dip: -75 }, { d: 3600, az: 45, dip: -65 }]);
    const [a, b] = pts.slice(1);
    // Dogleg 12.95°, ratio factor 1.00428: ΔN 27.218, ΔE 19.451, ΔTVD 94.012 ft.
    close((b.beta * 180) / Math.PI, 12.95165, 1e-4);
    close(b.y - a.y, 27.21833, 1e-4);
    close(b.x - a.x, 19.45077, 1e-4);
    close(a.z - b.z, 94.01234, 1e-4);
  });

  it('builds a quarter circle exactly: vertical to horizontal over an arc of length L ends R across and R down', () => {
    const L = 100, R = (2 * L) / Math.PI;
    const pts = minCurvature([{ d: 0, az: 90, dip: -90 }, { d: L, az: 90, dip: 0 }]);
    close(pts[1].x, R); close(pts[1].z, -R); close(pts[1].y, 0);
    // Half-way round the arc: R(1 − cos 45°) across, R sin 45° down.
    const m = offsetAt(pts, L / 2);
    close(m.x, R * (1 - Math.SQRT1_2)); close(m.z, -R * Math.SQRT1_2);
  });

  it('runs straight in the first direction to the first station and in the last one past the end', () => {
    const t = direction(30, -60), pts = minCurvature([{ d: 50, az: 30, dip: -60 }]);
    const p = offsetAt(pts, 120);
    close(p.x, 120 * t[0]); close(p.y, 120 * t[1]); close(p.z, 120 * t[2]);
  });

  it('samples a path at the depths /3d draws a hole at: every 2 m and at the end', () => {
    const path = desurveyPath([{ d: 0, az: 0, dip: -90 }, { d: 7, az: 0, dip: -80 }], 7);
    expect(path.map((p) => p.d)).toEqual([0, 2, 4, 6, 7]);
    // Arc length is preserved: each 2 m step is a chord of at most 2 m.
    for (let i = 1; i < path.length; i++) expect(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z)).toBeLessThanOrEqual(path[i].d - path[i - 1].d + 1e-9);
  });
});

// A property's current rows as Supabase returns them.
const ROWS = {
  collars: [
    { hole_id: 'RL-001', x: 412310.5, y: 6421790.2, z: 1346.1, crs: 'EPSG:32610', azimuth: 45, dip: -60, depth: 300, status: null, planned: false },
    { hole_id: 'RL-002, west', x: 412410.5, y: 6421690.2, z: null, crs: 'EPSG:32610', azimuth: null, dip: -90, depth: 150, status: 'Assays pending', planned: false },
    { hole_id: 'RL-P1', x: 412500, y: 6421600, z: 1300, crs: 'EPSG:32610', azimuth: 0, dip: -55, depth: 400, status: null, planned: true },
  ],
  surveys: [{ hole_id: 'RL-001', depth_m: 0, azimuth: 45, dip: -60 }, { hole_id: 'RL-001', depth_m: 150, azimuth: 50, dip: -58 }],
  assays: [
    { hole_id: 'RL-001', from_m: 0, to_m: 2, values: { Cu: 0.12, Au: 0.05 }, units: { Cu: '%', Au: 'g/t' } },
    { hole_id: 'RL-001', from_m: 2, to_m: 4, values: { Cu: 0.31, Au: 0.12 }, units: { Cu: '%', Au: 'g/t' } },
    { hole_id: 'RL-002, west', from_m: 0, to_m: 3, values: { Cu: 0.2, Au: 15 }, units: { Cu: '%', Au: 'ppb' } },
  ],
  lithology: [{ hole_id: 'RL-001', from_m: 0, to_m: 20, code: 'OVB', description: 'Overburden' }, { hole_id: 'RL-001', from_m: 20, to_m: 300, code: null, description: 'Porphyry' }],
};
const BATCHES = [
  { id: 'b3', kind: 'assays', created_at: '2026-10-20T10:00:00.000Z', rolled_back_at: null, summary: { new: 3 }, mapping: { elements: [{ name: 'Cu' }, { name: 'Au' }] } },
  { id: 'b2', kind: 'surveys', created_at: '2026-10-19T10:00:00.000Z', rolled_back_at: null, summary: { new: 2 } },
  { id: 'b1', kind: 'collars', created_at: '2026-10-18T10:00:00.000Z', rolled_back_at: null, summary: { new: 3 } },
];
// What the editor makes of a file (studio.js addFiles: the column matcher and role refinement of roles.js).
async function asEditor(f) {
  const { header, rows } = await parseCsv(f.text), entry = { header, rows, cols: matchCols(header) };
  return { ...entry, role: refineRole(entry, roleOf(entry.cols, f.name), f.name) };
}

describe('property drill rows to the editor\'s files', () => {
  it('writes one CSV per kind that the editor reads with the right role and columns', async () => {
    const files = toFiles(ROWS, BATCHES);
    expect(files.map((f) => f.name)).toEqual([FILE_NAMES.collars, FILE_NAMES.surveys, FILE_NAMES.assays, FILE_NAMES.lithology]);
    const [c, s, a, l] = await Promise.all(files.map(asEditor));
    expect([c.role, s.role, a.role, l.role]).toEqual(['collar', 'survey', 'assay', 'litho']);
    expect(c.cols).toMatchObject({ hole: 0, east: 1, north: 2, elev: 3, az: 4, dip: 5, depth: 6 });
    expect(c.rows[1]).toEqual(['RL-002, west', '412410.5', '6421690.2', '', '', '-90', '150', 'Assays pending']); // quoted, blanks stay blank
    expect(c.rows[2][7]).toBe('Planned'); // the editor's planned-hole test reads the status
    expect(s.cols).toMatchObject({ hole: 0, depth: 1, az: 2, dip: 3 });
    expect(l.cols).toMatchObject({ hole: 0, from: 1, to: 2, code: 3, desc: 4 });
    expect(l.rows[1].slice(3)).toEqual(['Porphyry', 'Porphyry']); // no code: the description stands in
  });

  it('keeps the imported element order and never mixes units in one column', async () => {
    const a = await asEditor(toFiles(ROWS, BATCHES).find((f) => f.name === FILE_NAMES.assays));
    expect(a.header).toEqual(['HoleID', 'From', 'To', 'Cu_pct', 'Au_gpt', 'Au_ppb']);
    expect(a.rows.find((r) => r[0] === 'RL-002, west')).toEqual(['RL-002, west', '0', '3', '0.2', '', '15']);
  });

  it('puts each grade column\'s first value in the first rows, where the editor looks for grades', async () => {
    const assays = Array.from({ length: 400 }, (_, i) => ({ hole_id: `H${String(i).padStart(3, '0')}`, from_m: 0, to_m: 1, values: i === 399 ? { Mo: 0.01 } : { Cu: 0.1 }, units: i === 399 ? { Mo: '%' } : { Cu: '%' } }));
    const a = await asEditor(toFiles({ assays }).find((f) => f.name === FILE_NAMES.assays));
    expect(a.rows.slice(0, 2).map((r) => r[0])).toEqual(['H000', 'H399']);
    expect(a.rows).toHaveLength(400);
  });

  it('reads collars stored in latitude/longitude as such', () => {
    const f = toFiles({ collars: [{ hole_id: 'A', x: -120.5, y: 50.2, crs: 'EPSG:4326', planned: false }] })[0];
    expect(f.text.split('\n')[0]).toBe('HoleID,Longitude,Latitude,Elevation,Azimuth,Dip,Depth,Status');
  });
});

describe('the figure\'s snapshot and newer imports', () => {
  const ref = snapshotOf({ propertyId: 'p1', propertyName: 'Rails' }, BATCHES, ROWS);
  it('records the property, the newest import and the counts', () => {
    expect(ref).toEqual({ kind: 'property', propertyId: 'p1', propertyName: 'Rails', latestBatchId: 'b3', latestAt: '2026-10-20T10:00:00.000Z', holes: 3, assays: 3, crs: 'EPSG:32610' });
  });
  it('finds nothing newer in the same batches', () => {
    expect(newerSince(ref, BATCHES)).toBeNull();
  });
  it('counts new holes and new or changed assays in later imports, not in rolled-back ones', () => {
    const later = [
      { id: 'b6', kind: 'assays', created_at: '2026-10-22T09:00:00.000Z', rolled_back_at: '2026-10-22T09:30:00.000Z', summary: { new: 999 } },
      { id: 'b5', kind: 'assays', created_at: '2026-10-21T12:00:00.000Z', rolled_back_at: null, summary: { new: 40, changed: 2, unchanged: 100 } },
      { id: 'b4', kind: 'collars', created_at: '2026-10-21T11:00:00.000Z', rolled_back_at: null, summary: { new: 2, changed: 1 } },
      ...BATCHES,
    ];
    const d = newerSince(ref, later);
    expect(d).toEqual({ imports: 2, holes: 2, assays: 42, rolledBack: 0 });
    expect(noticeText(d)).toBe('New drill data since this figure (2 new holes, 42 assays)');
  });
  it('notices a roll-back of an import the figure has', () => {
    const d = newerSince(ref, BATCHES.map((b) => (b.id === 'b3' ? { ...b, rolled_back_at: '2026-10-21T08:00:00.000Z' } : b)));
    expect(d).toEqual({ imports: 0, holes: 0, assays: 0, rolledBack: 1 });
    expect(noticeText(d)).toBe('Drill data changed since this figure (1 import rolled back)');
    expect(noticeText({ imports: 1, holes: 1, assays: 1, rolledBack: 0 })).toBe('New drill data since this figure (1 new hole, 1 assay)');
  });
});

// A Supabase client over in-memory tables: filters, order and range as PostgREST, at most 1,000 rows a request.
function fakeSb(db, onRead = () => {}) {
  const reads = [];
  return {
    reads,
    from(table) {
      const q = { table, eq: {}, is: {}, range: null, limit: null, order: [], filters: [] };
      const api = {
        select: () => api, order: (k) => { q.order.push(k); return api; },
        eq: (k, v) => { q.eq[k] = v; return api; }, is: (k, v) => { q.is[k] = v; return api; },
        gt: (k, v) => { q.filters.push(parseDrillFilter(`${k}.gt.${v}`)); return api; },
        gte: (k, v) => { q.filters.push(parseDrillFilter(`${k}.gte.${v}`)); return api; },
        or: (v) => { q.filters.push(parseDrillFilter(`or(${v})`)); return api; },
        limit: (n) => { q.limit = n; return api; }, range: (a, b) => { q.range = [a, b]; return api; },
        then(res, rej) {
          reads.push(q); onRead(q);
          let rows = (db[table] || []).filter((r) => Object.entries(q.eq).every(([k, v]) => r[k] === v) && Object.keys(q.is).every((k) => r[k] == null));
          rows = rows.filter((r) => q.filters.every((f) => matchesDrillFilter(r, f))).sort((a, b) => {
            for (const k of q.order) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return 0;
          });
          if (q.range) rows = rows.slice(q.range[0], Math.min(q.range[1] + 1, q.range[0] + 1000));
          if (q.limit) rows = rows.slice(0, q.limit);
          return Promise.resolve({ data: structuredClone(rows), error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
}

describe('reading a property\'s drill database', () => {
  const big = () => {
    const P = 'p1', collars = [], assays = [];
    for (let h = 0; h < 250; h++) {
      collars.push({ property_id: P, superseded_by_batch: null, hole_id: `H${h}`, x: 1000 + h, y: 2000, z: 100, crs: null, azimuth: 0, dip: -60, depth: 400, status: null, planned: false });
      for (let i = 0; i < 200; i++) assays.push({ property_id: P, superseded_by_batch: null, hole_id: `H${h}`, from_m: 2 * i, to_m: 2 * i + 2, values: { Cu: (i % 10) / 10 }, units: { Cu: '%' } });
    }
    assays.push({ ...assays[0], superseded_by_batch: 'old', values: { Cu: 9 } }); // history is never read
    return { drill_collars: collars, drill_assays: assays, drill_import_batches: [{ property_id: P, ...BATCHES[0] }] };
  };

  it('pages 50,000 assays in chunks of 1,000 and keeps only current rows', async () => {
    const db = big(), sb = fakeSb(db), seen = [];
    const t0 = performance.now();
    const { files, ref, rows } = await pull(sb, { id: 'p1', name: 'Rails' }, (n) => seen.push(n.assays || 0));
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(rows.assays).toHaveLength(50000);
    expect(rows.assays.some((r) => r.values.Cu === 9)).toBe(false);
    const pages = sb.reads.filter((q) => q.table === 'drill_assays');
    expect(pages).toHaveLength(51); // 50 full pages and the empty one that ends it
    expect(pages.every((q) => q.range === null && q.limit === 1000 && q.eq.property_id === 'p1' && 'superseded_by_batch' in q.is)).toBe(true);
    expect(pages.slice(1).every((q) => q.filters.length === 2)).toBe(true);
    expect(Math.max(...seen)).toBe(50000);
    expect(ref).toMatchObject({ holes: 250, assays: 50000, latestBatchId: 'b3' });
    expect(files.find((f) => f.name === FILE_NAMES.assays).text.split('\n')).toHaveLength(50002); // header, rows, final newline
  });

  it('reads again when an import lands while the pages are read, so the figure never mixes versions', async () => {
    const db = big();
    let landed = false, assayPages = 0;
    const sb = fakeSb(db, (q) => {
      if (!landed && q.table === 'drill_assays' && ++assayPages === 11) {
        landed = true;
        db.drill_import_batches.unshift({ property_id: 'p1', id: 'b9', kind: 'collars', created_at: '2026-10-21T10:00:00.000Z', rolled_back_at: null, summary: { new: 1 } });
      }
    });
    const { ref } = await pull(sb, { id: 'p1', name: 'Rails' });
    expect(ref.latestBatchId).toBe('b9');
    expect(sb.reads.filter((q) => q.table === 'drill_import_batches')).toHaveLength(4);
  });
});

describe('collars in more than one coordinate system', () => {
  it('are fine when they share one (or none is given)', () => {
    expect(mixedCrs(ROWS.collars)).toBeNull();
    expect(mixedCrs([{ crs: null }, { crs: null }])).toBeNull();
  });
  it('are refused, naming each system and its count, before anything is written', async () => {
    const collars = [{ crs: 'EPSG:32610' }, { crs: 'EPSG:32610' }, { crs: 'EPSG:4326' }, { crs: null }];
    expect(mixedCrs(collars, 'Rails')).toBe('Rails\'s collars are in more than one coordinate system (EPSG:32610: 2 collars, EPSG:4326: 1 collar, no coordinate system: 1 collar). Re-import them in one on the property page, then load again.');
    const base = { property_id: 'p1', superseded_by_batch: null, x: 1, y: 2, planned: false };
    const sb = fakeSb({ drill_collars: [{ ...base, hole_id: 'A', crs: 'EPSG:32610' }, { ...base, hole_id: 'B', crs: 'EPSG:4326' }], drill_import_batches: [] });
    await expect(pull(sb, { id: 'p1', name: 'Rails' })).rejects.toThrow(/^Rails's collars are in more than one coordinate system \(EPSG:32610: 1 collar, EPSG:4326: 1 collar\)/);
  });
});

describe('the newer-data notice belongs to the figure it was shown for', () => {
  const ref = snapshotOf({ propertyId: 'p1', propertyName: 'Rails' }, BATCHES, ROWS);
  const newer = { property_id: 'p1', id: 'b9', kind: 'collars', created_at: '2026-10-21T10:00:00.000Z', rolled_back_at: null, summary: { new: 1 } };
  const base = { property_id: 'p1', superseded_by_batch: null };
  const db = { drill_import_batches: [newer, ...BATCHES.map((b) => ({ ...b, property_id: 'p1' }))], drill_collars: ROWS.collars.map((r) => ({ ...base, ...r })) };
  let fig, source, slow = null;
  const sb = fakeSb(db, () => slow?.());
  const E = { getState: () => ({ drillSource: source }), getProject: () => ({ v: 1, settings: { drillSource: source }, files: [{ name: 'other.csv', text: 'x' }] }), loadProject: vi.fn(async () => {}) };
  document.body.innerHTML = ['drill-pick', 'drill-body', 'drill-add', 'drill-notice-text'].map((id) => `<div id="${id}"></div>`).join('')
    + '<div id="drill-notice" hidden></div><button id="drill-update"></button><button id="drill-dismiss"></button>';
  window.EM3D = E;
  init({ client: async () => sb, current: () => fig, say: () => {}, listHomes: async () => ({ properties: [] }) });
  const notice = () => document.getElementById('drill-notice');
  const open = async (id, src) => { fig = { id }; source = src; reset(); await check(); };
  const clickUpdate = async () => { document.getElementById('drill-update').click(); await vi.waitFor(() => expect(document.getElementById('drill-update').disabled).toBe(false)); };

  it('is shown for the figure with newer data, and gone when another figure opens', async () => {
    await open('fig1', ref);
    expect(notice().hidden).toBe(false);
    await open('fig2', null);
    expect(notice().hidden).toBe(true);
    await clickUpdate();
    expect(E.loadProject).not.toHaveBeenCalled();
  });

  it('never applies to another figure, even one opened without the account knowing', async () => {
    await open('fig1', ref);
    fig = { id: 'fig2' }; // e.g. EM3D.loadProject straight after the notice showed
    await clickUpdate();
    expect(E.loadProject).not.toHaveBeenCalled();
    expect(notice().hidden).toBe(true);
  });

  it('is dropped when another figure opens while Update reads the property', async () => {
    await open('fig1', ref);
    slow = () => { slow = null; fig = { id: 'fig2' }; source = { ...ref, propertyId: 'p2' }; };
    await clickUpdate();
    expect(E.loadProject).not.toHaveBeenCalled();
  });

  it('updates the figure it was shown for', async () => {
    await open('fig1', ref);
    await clickUpdate();
    expect(E.loadProject).toHaveBeenCalledTimes(1);
    const p = E.loadProject.mock.calls[0][0];
    expect(p.settings.drillSource).toMatchObject({ propertyId: 'p1', latestBatchId: 'b9' });
    expect(p.files.map((f) => f.name)).toEqual(['other.csv', FILE_NAMES.collars]);
    expect(notice().hidden).toBe(true);
  });
});
