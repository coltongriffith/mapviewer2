// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { library, guessKind, staleRefs, safeName, sha256Hex, formatBytes, libraryError } from '../src/utils/propertyFiles.js';

// src/utils/propertyFiles.js: kind guesses, the newer-version check the 3D
// maker uses, and the calls it makes to Supabase (storage first, then the RPC).

const ORG = 'org-1', PROP = 'prop-1';
const property = { id: PROP, org_id: ORG };
let calls, rpcResult, uploadError, listed;
const sb = {
  rpc: async (fn, args) => {
    calls.push({ rpc: fn, args });
    if (fn === 'list_property_files' && listed) return { data: listed, error: null };
    return rpcResult instanceof Error ? { data: null, error: { message: rpcResult.message } } : { data: rpcResult, error: null };
  },
  storage: {
    from: (bucket) => ({
      upload: async (path, body, opts) => { calls.push({ upload: [bucket, path, opts] }); return { error: uploadError }; },
      createSignedUrl: async (path, exp, opts) => { calls.push({ sign: [bucket, path, exp, opts] }); return { data: { signedUrl: `https://x/${path}` }, error: null }; },
      download: async (path) => { calls.push({ download: [bucket, path] }); return { data: new Blob(['HoleID,From,To']), error: null }; },
    }),
  },
  from: (table) => {
    const q = { table, ops: [] };
    calls.push(q);
    const chain = {
      update: (v) => { q.ops.push(['update', v]); return chain; },
      eq: (c, v) => { q.ops.push(['eq', c, v]); return chain; },
      select: async () => ({ data: q.ops.some(([op, , v]) => op === 'eq' && v === 'gone') ? [] : [{ id: 'f1' }], error: null }),
    };
    return chain;
  },
};
const lib = library(sb);
const file = (name, text, type = 'text/csv') => new File([text], name, { type });
const hex = (t) => createHash('sha256').update(t).digest('hex');

beforeEach(() => { calls = []; rpcResult = null; uploadError = null; listed = null; });

describe('helpers', () => {
  it('guesses the kind and drill role from the file name', () => {
    expect(guessKind('Rails_collars_2026.csv')).toEqual({ kind: 'drill', role: 'collars' });
    expect(guessKind('DDH surveys.txt')).toEqual({ kind: 'drill', role: 'surveys' });
    expect(guessKind('assay-results.xlsx')).toEqual({ kind: 'drill', role: 'assays' });
    expect(guessKind('lithology.csv')).toEqual({ kind: 'drill', role: 'lith' });
    expect(guessKind('ip_model.xyz')).toEqual({ kind: 'geophysics', role: null });
    expect(guessKind('mag-grid.tif')).toEqual({ kind: 'geophysics', role: null });
    expect(guessKind('claims.geojson')).toEqual({ kind: 'claims', role: null });
    expect(guessKind('Rails tenures.zip')).toEqual({ kind: 'claims', role: null });
    expect(guessKind('targets.kml')).toEqual({ kind: 'layer', role: null });
    expect(guessKind('roads.zip')).toEqual({ kind: 'layer', role: null });
    expect(guessKind('NI 43-101.pdf')).toEqual({ kind: 'document', role: null });
    expect(guessKind('holes.csv')).toEqual({ kind: 'drill', role: null });
    expect(guessKind('photo.jpg')).toEqual({ kind: 'other', role: null });
  });

  it('finds figure files whose library file has moved on', () => {
    const files = [{ id: 'a', version: 3 }, { id: 'b', version: 1 }];
    expect(staleRefs({ 'assays.csv': { libFileId: 'a', version: 2 }, 'collars.csv': { libFileId: 'b', version: 1 }, 'gone.csv': { libFileId: 'z', version: 1 } }, files))
      .toEqual([{ name: 'assays.csv', from: 2, file: files[0] }]);
    expect(staleRefs(null, files)).toEqual([]);
  });

  it('hashes, names and sizes like the database expects', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(hex('abc'));
    expect(safeName('../My assays (final).csv')).toBe('_My_assays_final_.csv');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(25 * 1048576)).toBe('25 MB');
  });

  it('words database errors plainly', () => {
    expect(libraryError({ message: 'ORG_READ_ONLY: viewers cannot upload data files' })).toMatchObject({ message: expect.stringMatching(/view-only/), code: 'ORG_READ_ONLY' });
    expect(libraryError({ message: 'VERSION_CONFLICT: x' }).message).toMatch(/Someone else uploaded/);
    expect(libraryError({ message: 'forbidden: only an owner or admin can delete a data file' }).message).toBe('Only an owner or admin can delete a data file.');
  });
});

describe('library client', () => {
  it('lists a property\'s files', async () => {
    rpcResult = [{ id: 'f1', name: 'assays.csv', kind: 'drill', role: 'assays', version: 2, path: 'p/v2/assays.csv', bytes: 10, sha256: 'h', uploaded_at: '2026-10-20T00:00:00Z', uploaded_by_email: 'geo@star.test' }];
    expect(await lib.list(PROP)).toEqual([expect.objectContaining({ id: 'f1', version: 2, by: 'geo@star.test', updatedAt: '2026-10-20T00:00:00Z', path: 'p/v2/assays.csv' })]);
    expect(calls[0]).toEqual({ rpc: 'list_property_files', args: { p_property: PROP } });
  });

  it('uploads a new file to v1 of a fresh folder, then records it', async () => {
    rpcResult = { file_id: 'ignored-by-test', version: 1, unchanged: false };
    const r = await lib.upload({ property, file: file('Rails collars.csv', 'HoleID,E,N') });
    expect(r).toEqual({ fileId: 'ignored-by-test', version: 1, unchanged: false });
    const [up, rec] = calls;
    const [bucket, path, opts] = up.upload;
    expect(bucket).toBe('property-files');
    expect(path).toMatch(new RegExp(`^${ORG}/${PROP}/[0-9a-f-]{36}/v1/[0-9a-f]{8}-Rails_collars.csv$`));
    expect(opts).toEqual({ upsert: false, contentType: 'text/csv' });
    expect(rec).toEqual({ rpc: 'add_property_file_version', args: {
      p_property: PROP, p_file: path.split('/')[2], p_name: 'Rails collars.csv', p_kind: 'drill', p_role: 'collars',
      p_path: path, p_bytes: 10, p_sha256: hex('HoleID,E,N'), p_note: null } });
  });

  it('uploads a new version into the next folder of the current version, keeping the file\'s name', async () => {
    rpcResult = { file_id: 'f1', version: 4, unchanged: false };
    // This page listed v2; someone has since uploaded v3.
    listed = [{ id: 'f1', name: 'assays.csv', version: 3, sha256: hex('v3'), path: 'x' }];
    const existing = { id: 'f1', name: 'assays.csv', version: 2, sha256: hex('old') };
    await lib.upload({ property, file: file('assays-v4.csv', 'new'), existing, note: 'Batch 7' });
    const up = calls.find((c) => c.upload), rec = calls.find((c) => c.rpc === 'add_property_file_version');
    expect(up.upload[1]).toMatch(new RegExp(`^${ORG}/${PROP}/f1/v4/[0-9a-f]{8}-assays-v4.csv$`));
    expect(rec.args).toMatchObject({ p_file: 'f1', p_name: 'assays.csv', p_path: up.upload[1], p_note: 'Batch 7' });
  });

  it('skips an upload identical to the current version, checked against a fresh listing', async () => {
    listed = [{ id: 'f1', name: 'assays.csv', version: 3, sha256: hex('same'), path: 'x' }];
    const existing = { id: 'f1', name: 'assays.csv', version: 2, sha256: hex('older') };
    expect(await lib.upload({ property, file: file('assays.csv', 'same'), existing })).toEqual({ fileId: 'f1', version: 3, unchanged: true });
    expect(calls.some((c) => c.upload)).toBe(false);
    // Identical to the version this page saw, but not to the current one: a new version.
    listed = [{ id: 'f1', name: 'assays.csv', version: 3, sha256: hex('v3'), path: 'x' }];
    rpcResult = { file_id: 'f1', version: 4, unchanged: false };
    expect((await lib.upload({ property, file: file('assays.csv', 'older'), existing })).version).toBe(4);
  });

  it('refuses files over 100 MB before uploading, and reports a failed upload', async () => {
    const big = { name: 'huge.zip', size: 100 * 1024 * 1024 + 1, arrayBuffer: () => { throw new Error('read'); } };
    await expect(lib.upload({ property, file: big })).rejects.toThrow(/larger than 100 MB/);
    uploadError = { message: 'new row violates row-level security policy' };
    await expect(lib.upload({ property, file: file('a.csv', 'x') })).rejects.toThrow(/do not have permission/);
    expect(calls.some((c) => c.rpc)).toBe(false);
    // Another upload's object is never adopted as this one's.
    uploadError = { message: 'The resource already exists' };
    await expect(lib.upload({ property, file: file('a.csv', 'x') })).rejects.toThrow();
    expect(calls.some((c) => c.rpc === 'add_property_file_version')).toBe(false);
  });

  it('signs downloads, reads text and soft-deletes', async () => {
    expect(await lib.downloadUrl('o/p/f/v1/a.csv', 'a.csv')).toBe('https://x/o/p/f/v1/a.csv');
    expect(calls[0].sign).toEqual(['property-files', 'o/p/f/v1/a.csv', 300, { download: 'a.csv' }]);
    expect(await lib.text('o/p/f/v1/a.csv')).toBe('HoleID,From,To');
    await lib.remove('f1');
    expect(calls.at(-1)).toMatchObject({ table: 'property_files', ops: [['update', { deleted_at: expect.any(String) }], ['eq', 'id', 'f1']] });
    await expect(lib.remove('gone')).rejects.toThrow(/not found/);
  });
});
