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
