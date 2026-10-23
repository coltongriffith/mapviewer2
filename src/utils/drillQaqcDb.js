// Additive QA/QC register. The server validates every scientific value and
// permission; this adapter deliberately does not infer sample types or units.
export async function importQaqc(client, propertyId, kind, rows, {
  provenance = {}, dryRun = true, batchId = null,
} = {}) {
  if (!['samples', 'crms'].includes(kind)) throw new Error('Choose samples or crms.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new Error('Import 1 to 5,000 QA/QC rows at a time.');
  if (!dryRun && !batchId) throw new Error('A stable batch ID is required to retry a commit safely.');
  const { data, error } = await client.rpc('drill_qaqc_import', {
    p_property: propertyId, p_kind: kind, p_rows: rows,
    p_provenance: provenance, p_dry_run: dryRun, p_batch: batchId,
  });
  if (error) throw error;
  return data;
}

export async function rollbackQaqc(client, batchId) {
  const { data, error } = await client.rpc('drill_qaqc_rollback', { p_batch: batchId });
  if (error) throw error;
  return data;
}

export const QAQC_PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function qaqcError(error, lines = []) {
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code)) return 'QA/QC is not available on this site yet. Existing drill imports still work.';
  const message = String(error?.message || error || 'Could not load QA/QC.');
  const row = message.match(/INVALID_ROW (\d+): (.*)/);
  if (row) return `Line ${lines[Number(row[1]) - 1] || row[1]}: ${row[2]}`;
  const messages = [
    ['PARENT_NOT_FOUND', 'Import the routine parent first, using the same laboratory and lab job.'],
    ['PARENT_IN_SAME_IMPORT', 'Import routine parents separately before their duplicates.'],
    ['CRM_NOT_FOUND', 'Import the CRM definition first. Its revision, element and unit must match exactly.'],
    ['CRM_REVISION_IMMUTABLE', 'This CRM revision already exists with different values. Use a new revision.'],
    ['BATCH_DEPENDENCY', 'A later import depends on this one. Roll back the dependent import first.'],
    ['BATCH_ID_REUSED', 'This attempt ID belongs to different data. Check the import again before retrying.'],
    ['ORG_READ_ONLY', 'You need editor access to import or roll back QA/QC data.'],
    ['QAQC_PROPERTY_FULL', 'This property has reached the QA/QC history limit.'],
    ['DB_HEADROOM', 'There is not enough database capacity for this import.'],
  ];
  return messages.find(([code]) => message.includes(code))?.[1] || message;
}

/** Active records only. UUID keyset pagination remains stable across insertions. */
export async function listQaqcRecords(client, propertyId, kind, cursor = null) {
  if (!['samples', 'crms'].includes(kind)) throw new Error('Choose samples or crms.');
  if (cursor && !UUID.test(cursor)) throw new Error('Invalid QA/QC page cursor.');
  let query = client.from(kind === 'samples' ? 'drill_qaqc_samples' : 'drill_crm_values')
    .select(`id,batch_id,source_row,record${kind === 'samples' ? ',parent_version_id,crm_version_ids' : ''}`).eq('property_id', propertyId).is('superseded_by_batch', null)
    .order('id', { ascending: true }).limit(QAQC_PAGE_SIZE + 1);
  if (cursor) query = query.gt('id', cursor);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []).slice(0, QAQC_PAGE_SIZE);
  return { rows, next: data?.length > QAQC_PAGE_SIZE ? rows.at(-1).id : null };
}

/** Newest imports first, using timestamp plus UUID as a deterministic tie-breaker. */
export async function listQaqcBatches(client, propertyId, cursor = null) {
  let query = client.from('drill_qaqc_batches').select('id,kind,provenance,row_count,rows_written,summary,created_at,rolled_back_at,depends_on')
    .eq('property_id', propertyId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(QAQC_PAGE_SIZE + 1);
  if (cursor) {
    if (!UUID.test(cursor.id) || !/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(cursor.created_at)) throw new Error('Invalid QA/QC history cursor.');
    query = query.or(`created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt."${cursor.id}")`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []).slice(0, QAQC_PAGE_SIZE), last = rows.at(-1);
  return { rows, next: data?.length > QAQC_PAGE_SIZE ? { id: last.id, created_at: last.created_at } : null };
}
