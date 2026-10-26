// A thin client over supabase/migrations/20261103120000_release_packs.sql: a property's release pack, its
// approvals, and what the staleness check (shared/releasePack.js) compares them with. Loaded with the Release pack tab.

const TABLES = { collars: 'drill_collars', surveys: 'drill_surveys', assays: 'drill_assays', lithology: 'drill_lithology', alteration: 'drill_alteration', structure: 'drill_structure' };
const MESSAGES = [
  [/APPROVAL_STALE: (.*)/, (m) => `Not approved: ${m[1]}. The pack has been checked again; review it and approve.`],
  [/APPROVAL_INCOMPLETE: (.*)/, (m) => `Not approved: ${m[1]}.`],
  [/INVALID_RELEASE_PACK: (.*)/, (m) => `The pack was not saved: ${m[1]}.`],
  [/RELEASE_PACK_NOT_FOUND|row-level security|permission denied/i, 'You need editor access in this workspace to change or approve the release pack.'],
];
export const UNAVAILABLE = 'Release packs are not available on this site yet. Results tables, maps and 3D figures still export from their own tabs.';
export function packError(error) {
  if (['42P01', 'PGRST205', 'PGRST204'].includes(error?.code)) return Object.assign(new Error(UNAVAILABLE), { code: 'UNAVAILABLE' });
  const msg = String(error?.message || error || 'Something went wrong.');
  for (const [re, out] of MESSAGES) { const m = msg.match(re); if (m) return Object.assign(new Error(typeof out === 'function' ? out(m) : out), { code: msg.match(/^[A-Z_]{4,}/)?.[0] }); }
  return new Error(msg);
}

export function releasePackDb(sb) {
  if (!sb) throw new Error('Release packs need an Exploration Maps account, which is not available on this site right now.');
  const q = async (p) => { const { data, error } = await p; if (error) throw packError(error); return data; };
  return {
    /** { pack, approvals } (pack null before the first save; approvals newest first). */
    async load(propertyId) {
      const [packs, approvals] = await Promise.all([
        q(sb.from('release_packs').select('id, items, updated_at').eq('property_id', propertyId).limit(1)),
        q(sb.from('release_pack_approvals').select('*').eq('property_id', propertyId).order('approved_at', { ascending: false }).limit(20)),
      ]);
      return { pack: packs?.[0] || null, approvals: approvals || [] };
    },
    async save(propertyId, pack, items) {
      const rows = await q(pack ? sb.from('release_packs').update({ items }).eq('id', pack.id).select('id, items, updated_at')
        : sb.from('release_packs').insert({ property_id: propertyId, items }).select('id, items, updated_at'));
      if (!rows?.length) throw packError({ message: 'permission denied' });
      return rows[0];
    },
    async approve(request) {
      const rows = await q(sb.from('release_pack_approvals').insert(request).select('*'));
      return rows[0];
    },
    /** Complete live batch identities, not the summary's latest-50 history window.
     * UUID keyset paging is bounded; an excessive history fails closed rather than approving a subset.
     */
    async liveBatches(propertyId) {
      const out = [], pageSize = 500, max = 20000;
      let cursor = null;
      while (out.length <= max) {
        let request = sb.from('drill_import_batches').select('id, kind, filename, created_at, rolled_back_at, summary')
          .eq('property_id', propertyId).is('rolled_back_at', null).order('id').limit(pageSize);
        if (cursor) request = request.gt('id', cursor);
        const rows = await q(request) || [];
        for (const row of rows) {
          if (typeof row.id !== 'string' || (cursor && row.id <= cursor)) throw new Error('Could not verify the complete import history. Try again.');
          cursor = row.id;
          out.push(row);
        }
        if (out.length > max) throw new Error('This release pack has too many imports to verify safely. Contact support before approving it.');
        if (rows.length < pageSize) return out;
      }
    },
    /** The status of every batch an approval used, read directly (the property summary lists only the latest 50). */
    async batchStatus(ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += 100) {
        out.push(...(await q(sb.from('drill_import_batches').select('id, kind, filename, created_at, rolled_back_at').in('id', ids.slice(i, i + 100)))) || []);
      }
      return out;
    },
    /** The hole ids an import wrote (first 2,000 rows), for the diff in words. */
    async holes(batch) {
      const t = TABLES[batch.kind];
      if (!t) return [];
      const rows = await q(sb.from(t).select('hole_id').eq('batch_id', batch.id).order('hole_id').limit(2000));
      return [...new Set((rows || []).map((r) => r.hole_id))];
    },
    /** The latest published version of each 3D figure: { [figureId]: { versionId, version, label } }. */
    async latestVersions(figureIds) {
      if (!figureIds.length) return {};
      const rows = await q(sb.from('figure_versions').select('id, figure_id, version, label').eq('figure_kind', 'figure').in('figure_id', figureIds).order('version', { ascending: false }));
      const out = {};
      for (const r of rows || []) if (!out[r.figure_id]) out[r.figure_id] = { versionId: r.id, version: r.version, label: r.label };
      return out;
    },
  };
}
