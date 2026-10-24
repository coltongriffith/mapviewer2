// Read-only, historical evidence for ONE import's written rows, never a whole-job report.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = ['field_dup', 'coarse_dup', 'pulp_dup'];
export const QAQC_SNAPSHOT_MAX_ROWS = 5000;
export const QAQC_SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024;
export const QAQC_SNAPSHOT_MAX_CRM_PINS = 5000;
const PAGE = 250, CHUNK = 100;
const SAMPLE_FIELDS = 'id,property_id,batch_id,source_row,record,parent_version_id,superseded_by_batch';
const CRM_SAMPLE_FIELDS = `${SAMPLE_FIELDS},crm_version_ids`;
const CRM_FIELDS = 'id,property_id,batch_id,source_row,record,superseded_by_batch';
const BATCH_FIELDS = 'id,property_id,kind,request_hash,provenance,row_count,rows_written,created_at,rolled_back_at';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const compare = (a, b) => a.source_row - b.source_row || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const selected = (row, scope) => row.record.sample_type === scope.sampleType
  && row.record.lab_id === scope.labId && row.record.lab_batch_id === scope.labBatchId;
const selectedStandard = (row, scope) => row.record.sample_type === 'standard'
  && row.record.lab_id === scope.labId && row.record.lab_batch_id === scope.labBatchId
  && row.record.crm_id === scope.crmId && row.record.crm_revision === scope.crmRevision;
const matchingCrm = (row, scope) => row.record.crm_id === scope.crmId && row.record.revision === scope.crmRevision
  && row.record.element === scope.element && row.record.unit === scope.unit;
function fail(code, message) { throw Object.assign(new Error(message), { snapshotCode: code }); }
function validateScope(scope, discovery = false, crm = false) {
  if (!object(scope) || !UUID.test(scope.propertyId) || !UUID.test(scope.batchId)
    || (!discovery && ((!crm && !TYPES.includes(scope.sampleType))
    || !['labId', 'labBatchId', 'element', 'unit', ...(crm ? ['crmId', 'crmRevision'] : [])].every((key) => typeof scope[key] === 'string' && scope[key].trim() && scope[key].length <= 120)))) {
    throw new Error(crm ? 'Choose one property, sample import, laboratory/job, CRM/revision, element and exact unit.'
      : 'Choose one property, sample import, duplicate type, laboratory, lab job, element and unit.');
  }
  if (discovery) return { propertyId: scope.propertyId.toLowerCase(), batchId: scope.batchId.toLowerCase() };
  return { propertyId: scope.propertyId.toLowerCase(), batchId: scope.batchId.toLowerCase(),
    ...(crm ? { crmId: scope.crmId, crmRevision: scope.crmRevision } : { sampleType: scope.sampleType }),
    labId: scope.labId, labBatchId: scope.labBatchId, element: scope.element, unit: scope.unit };
}
function validRow(row, propertyId) {
  return object(row) && UUID.test(row.id) && row.id === row.id.toLowerCase()
    && row.property_id === propertyId && UUID.test(row.batch_id)
    && Number.isInteger(row.source_row) && row.source_row > 0 && row.source_row <= QAQC_SNAPSHOT_MAX_ROWS && object(row.record);
}
function immutableBatch(batch) {
  return JSON.stringify([batch.id, batch.property_id, batch.kind, batch.request_hash, batch.provenance, batch.row_count, batch.rows_written, batch.created_at]);
}

/**
 * No shared cache: discard the result when selection OR authenticated session changes.
 * isCurrent must cover that caller lifecycle; signal also aborts requests in flight.
 * Missing pinned rows are scientific exclusions. Failed reads are incomplete loads.
 */
export async function loadDuplicateSnapshot(client, selection, {
  signal, isCurrent = () => true, onProgress = () => {}, maxBytes = QAQC_SNAPSHOT_MAX_BYTES,
} = {}) {
  return loadSnapshot(client, selection, { signal, isCurrent, onProgress, maxBytes }, false);
}

/** Discover actual group choices from the same bounded, validated batch read. */
export async function discoverDuplicateGroups(client, selection, options = {}) {
  const snapshot = await loadSnapshot(client, selection, options, true);
  const groups = new Map();
  if (snapshot.complete) for (const row of snapshot.records) {
    const record = row.record;
    if (!TYPES.includes(record.sample_type)) continue;
    if (!['lab_id', 'lab_batch_id'].every(key => typeof record[key] === 'string' && record[key].trim() && record[key].length <= 120)
      || !object(record.values) || !object(record.units)) {
      return { ...snapshot, complete: false, groups: [], issues: [{ code: 'invalid_group', message: 'An imported duplicate has incomplete group metadata.' }] };
    }
    for (const element of Object.keys(record.values)) {
      const unit = record.units[element];
      if (!element.trim() || element.length > 120 || typeof unit !== 'string' || !unit.trim() || unit.length > 120) {
        return { ...snapshot, complete: false, groups: [], issues: [{ code: 'invalid_group', message: 'An imported duplicate has incomplete element or unit metadata.' }] };
      }
      const group = { ...snapshot.scope, sampleType: record.sample_type, labId: record.lab_id, labBatchId: record.lab_batch_id, element, unit };
      const key = JSON.stringify([group.sampleType, group.labId, group.labBatchId, element, unit]);
      if (!groups.has(key)) groups.set(key, group);
      if (groups.size > 4096) return { ...snapshot, complete: false, groups: [], issues: [{ code: 'group_limit', message: 'This import contains too many comparison groups. Use a smaller import to compare duplicates.' }] };
    }
  }
  return { ...snapshot, groups: [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, group]) => group) };
}

/** Exact historical CRM candidates for one written standard population. */
export async function loadCrmSnapshot(client, selection, options = {}) {
  return loadSnapshot(client, selection, options, false, true);
}

/** Discover populated standard tuples, without fetching or interpreting definitions. */
export async function discoverCrmGroups(client, selection, options = {}) {
  const snapshot = await loadSnapshot(client, selection, options, true, true);
  const groups = new Map();
  if (snapshot.complete) for (const row of snapshot.records) {
    const record = row.record;
    if (record.sample_type !== 'standard') continue;
    if (!['lab_id', 'lab_batch_id', 'crm_id', 'crm_revision'].every(key => typeof record[key] === 'string' && record[key].trim() && record[key].length <= 120)
      || !object(record.values) || !object(record.units)) {
      return { ...snapshot, complete: false, groups: [], issues: [{ code: 'invalid_group', message: 'An imported standard has incomplete CRM group metadata.' }] };
    }
    for (const element of Object.keys(record.values)) {
      const unit = record.units[element];
      if (!element.trim() || element.length > 120 || typeof unit !== 'string' || !unit.trim() || unit.length > 120) {
        return { ...snapshot, complete: false, groups: [], issues: [{ code: 'invalid_group', message: 'An imported standard has incomplete element or unit metadata.' }] };
      }
      const group = { ...snapshot.scope, labId: record.lab_id, labBatchId: record.lab_batch_id,
        crmId: record.crm_id, crmRevision: record.crm_revision, element, unit };
      const key = JSON.stringify([group.labId, group.labBatchId, group.crmId, group.crmRevision, element, unit]);
      if (!groups.has(key)) groups.set(key, group);
      if (groups.size > 4096) return { ...snapshot, complete: false, groups: [], issues: [{ code: 'group_limit', message: 'This import contains too many CRM groups. Use a smaller import to compare standards.' }] };
    }
  }
  return { ...snapshot, groups: [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, group]) => group) };
}

async function loadSnapshot(client, selection, {
  signal, isCurrent = () => true, onProgress = () => {}, maxBytes = QAQC_SNAPSHOT_MAX_BYTES,
} = {}, discovery = false, crm = false) {
  const scope = validateScope(selection, discovery, crm);
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > QAQC_SNAPSHOT_MAX_BYTES) throw new Error('Invalid snapshot byte limit.');
  const records = [], parents = [], issues = [];
  const inPopulation = crm ? selectedStandard : selected;
  let initial = null, refreshed = null, bytes = 0, requested = [], referenceReadsComplete = false;
  const guard = () => {
    if (signal?.aborted || !isCurrent()) throw Object.assign(new Error('Snapshot load cancelled.'), { name: 'AbortError' });
  };
  const read = async (query) => {
    guard();
    let result;
    try { result = await (signal ? query.abortSignal(signal) : query); }
    catch { guard(); fail('read_failed', 'Could not finish reading the selected snapshot.'); }
    guard();
    if (result.error) fail(['42P01', 'PGRST205'].includes(result.error.code) ? 'unavailable' : 'read_failed', 'Could not finish reading the selected snapshot.');
    if (!Array.isArray(result.data)) fail('invalid_response', 'The snapshot response was not a row list.');
    bytes += new TextEncoder().encode(JSON.stringify(result.data)).length;
    if (bytes > maxBytes) fail('byte_limit', 'This snapshot exceeds the bounded reading limit.');
    return result.data;
  };
  const batch = async () => {
    const rows = await read(client.from('drill_qaqc_batches').select(BATCH_FIELDS)
      .eq('property_id', scope.propertyId).eq('id', scope.batchId).limit(2));
    if (rows.length !== 1) fail('batch_unavailable', 'The selected import is unavailable.');
    const row = rows[0];
    if (row.id !== scope.batchId || row.property_id !== scope.propertyId || row.kind !== 'samples'
      || !Number.isInteger(row.row_count) || row.row_count < 1 || row.row_count > QAQC_SNAPSHOT_MAX_ROWS
      || !Number.isInteger(row.rows_written) || row.rows_written < 1 || row.rows_written > row.row_count
      || typeof row.request_hash !== 'string' || !row.request_hash || !object(row.provenance)) {
      fail('invalid_batch', 'The selected import does not have valid written-row metadata.');
    }
    return row;
  };
  guard();
  try {
    initial = await batch();
    let cursor = null;
    const seen = new Set();
    while (true) {
      let query = client.from('drill_qaqc_samples').select(crm ? CRM_SAMPLE_FIELDS : SAMPLE_FIELDS)
        .eq('property_id', scope.propertyId).eq('batch_id', scope.batchId)
        .order('source_row', { ascending: true }).order('id', { ascending: true }).limit(PAGE);
      if (cursor) query = query.or(`source_row.gt.${cursor.source_row},and(source_row.eq.${cursor.source_row},id.gt."${cursor.id}")`);
      const page = await read(query);
      if (!page.length) break; // A short page can reflect a lower server cap, so keep paging.
      if (page.length > PAGE) fail('invalid_response', 'The service exceeded the requested page size.');
      for (const row of page) {
        if (!validRow(row, scope.propertyId) || row.batch_id !== scope.batchId || row.source_row > initial.row_count
          || seen.has(row.id) || (cursor && compare(row, cursor) <= 0)) fail('invalid_cursor', 'The snapshot contains invalid, repeated or out-of-scope rows.');
        if (records.length >= initial.rows_written) fail('count_mismatch', 'The snapshot does not match the import written-row count.');
        records.push(row); seen.add(row.id); cursor = row;
      }
      onProgress({ phase: 'records', loaded: records.length, expected: initial.rows_written }); guard();
    }
    if (records.length !== initial.rows_written) fail('count_mismatch', 'The snapshot does not match the import written-row count.');
    if (!discovery) {
      const pins = new Set();
      for (const row of records.filter(row => inPopulation(row, scope))) {
        const candidates = crm ? (Array.isArray(row.crm_version_ids) ? row.crm_version_ids : []) : [row.parent_version_id];
        for (const id of candidates) if (typeof id === 'string' && UUID.test(id)) {
          pins.add(id);
          if (crm && pins.size > QAQC_SNAPSHOT_MAX_CRM_PINS) fail('pin_limit', 'This import references more than 5,000 CRM candidates. Use a smaller import to compare standards.');
        }
      }
      requested = [...pins].sort();
    }
    for (let start = 0; start < requested.length; start += CHUNK) {
      const ids = requested.slice(start, start + CHUNK), allowed = new Set(ids);
      let last = null;
      while (true) {
        let query = client.from(crm ? 'drill_crm_values' : 'drill_qaqc_samples').select(crm ? CRM_FIELDS : SAMPLE_FIELDS)
          .eq('property_id', scope.propertyId).in('id', ids).order('id', { ascending: true }).limit(CHUNK);
        if (crm) query = query.eq('record->>crm_id', scope.crmId).eq('record->>revision', scope.crmRevision)
          .eq('record->>element', scope.element).eq('record->>unit', scope.unit);
        if (last) query = query.gt('id', last); // Standalone SDK filter takes the raw UUID.
        const page = await read(query);
        if (!page.length) break;
        if (page.length > CHUNK) fail('invalid_response', 'The service exceeded the requested reference page size.');
        for (const row of page) {
          if (!validRow(row, scope.propertyId) || !allowed.has(row.id) || (last && row.id <= last)
            || (crm && !matchingCrm(row, scope))) fail('invalid_reference', 'The snapshot contains invalid or out-of-scope references.');
          parents.push(row); last = row.id;
        }
        onProgress({ phase: crm ? 'crms' : 'parents', loaded: parents.length, expected: requested.length }); guard();
      }
    }
    referenceReadsComplete = !discovery;
    refreshed = await batch();
    if (immutableBatch(initial) !== immutableBatch(refreshed)) fail('batch_changed', 'The import metadata changed while the snapshot was loading.');
  } catch (error) {
    guard();
    if (!error.snapshotCode) throw error;
    issues.push({ code: error.snapshotCode, message: error.message });
  }
  guard();
  const found = new Set(parents.map((row) => row.id));
  // A failed reference request cannot establish which individual UUIDs are absent.
  const missingParentIds = referenceReadsComplete ? requested.filter((id) => !found.has(id)) : [];
  return {
    scope, records, ...(crm ? { crms: parents } : { parents, missingParentIds }), complete: issues.length === 0, issues,
    manifest: {
      version: 1, scope: { ...scope }, population: 'written_import_rows', currentStateClaimed: false,
      retrievedAt: new Date().toISOString(), statusRefreshed: Boolean(refreshed), referenceReadsComplete,
      requestHash: initial?.request_hash ?? null, provenance: initial?.provenance ?? null,
      submittedCount: initial?.row_count ?? null, expectedWrittenCount: initial?.rows_written ?? null,
      loadedWrittenCount: records.length, selectedCount: discovery ? null : records.filter((row) => inPopulation(row, scope)).length,
      rolledBackAt: refreshed?.rolled_back_at ?? initial?.rolled_back_at ?? null,
      recordIds: records.map((row) => row.id),
      ...(crm ? { requestedCrmIds: requested, crmIds: parents.map(row => row.id),
        // A candidate not returned by this exact tuple filter is not necessarily missing:
        // multi-element standards pin other tuples. Per-standard resolution is statistical.
        unresolvedCandidateIds: [...missingParentIds] }
        : { requestedParentIds: requested, parentIds: parents.map((row) => row.id), missingParentIds: [...missingParentIds] }),
      bytesRead: bytes,
    },
  };
}
