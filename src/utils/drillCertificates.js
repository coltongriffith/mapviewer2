import { library } from './propertyFiles';

export const isCertificatePdf = (file) => /\.pdf$/i.test(file?.name || '');
export function certificateError(error) {
  if (['PGRST202', '42P01', '42883'].includes(error?.code)) return new Error('Certificate links are not available on this site yet. Assay imports still work.');
  if (/CERTIFICATE_NOT_FOUND|row-level security|permission denied/i.test(error?.message || '')) return new Error('That certificate or assay import is unavailable, or you do not have editor access. Refresh and try again.');
  return error instanceof Error ? error : new Error(error?.message || 'Could not save the certificate link.');
}

export function drillCertificates(sb) {
  const files = library(sb);
  const list = async (batchId) => {
    const { data, error } = await sb.rpc('drill_batch_certificates', { p_batch: batchId });
    if (error) throw certificateError(error);
    return data || [];
  };
  return {
    list,
    choices: async (propertyId) => (await files.list(propertyId)).filter(isCertificatePdf),
    async attach(batchId, fileId, version) {
      const { error } = await sb.from('drill_batch_files').insert({ batch_id: batchId, file_id: fileId, version });
      // Retrying a successful insert is safe; immutable unique tuple is the identity.
      if (error && error.code !== '23505') throw certificateError(error);
      if (error) {
        const existing = (await list(batchId)).find(row => row.file_id === fileId && row.version === version);
        if (!existing) throw new Error('The certificate link could not be verified. Refresh and try again.');
        if (existing.retracted_at) throw new Error('This certificate version was retracted from this import. Choose the correct certificate or a new version.');
      }
    },
    async retract(batchId, fileId, version, reason) {
      const { data, error } = await sb.from('drill_batch_files').update({ retraction_reason: reason }).eq('batch_id', batchId).eq('file_id', fileId).eq('version', version).select('file_id');
      if (error || !data?.length) throw certificateError(error || new Error('The certificate could not be retracted. Refresh and try again.'));
    },
    async upload(property, file) {
      if (!isCertificatePdf(file)) throw new Error('Choose a PDF lab certificate.');
      return files.upload({ property, file, kind: 'document' });
    },
    async download(batchId, fileId, version) {
      // Recheck live visibility before issuing a short-lived URL; never use a cached path.
      const link = (await list(batchId)).find((row) => row.file_id === fileId && row.version === version);
      if (!link?.storage_path) throw new Error('This certificate is no longer available in the property library.');
      return files.downloadUrl(link.storage_path, link.name);
    },
  };
}
