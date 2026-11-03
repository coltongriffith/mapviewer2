export const REPORT_TEXT_MAX_BYTES = 2 * 1024 * 1024;
export const REPORT_TEXT_MAX_MATCHES = 50;
class ReportTextError extends Error {}
const failure = message => new ReportTextError(message);
export const safeReportTextMessage = error => error instanceof ReportTextError ? error.message : 'The report could not be searched. Reopen its current version and try again.';
const stale = () => failure('This file or account changed. Reopen the current file to search it.');
const supported = (f) => f?.kind === 'document' && /\.(md|txt)$/i.test(f.name || '');
const fields = ['id', 'name', 'kind', 'version', 'path', 'bytes', 'sha256'];
const same = (a, b) => a && fields.every(key => a[key] === b[key]);

export function searchReportText(text, value) {
  const query = String(value || '').trim();
  if (!query || query.length > 200) throw failure('Enter text to find, up to 200 characters.');
  const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
  const matches = []; let total = 0;
  text.split(/\r\n|\n|\r/).forEach((line, index) => {
    const match = literal.exec(line);
    if (!match) return;
    total++;
    if (matches.length === REPORT_TEXT_MAX_MATCHES) return;
    const start = Math.max(0, match.index - 70), end = Math.min(line.length, match.index + match[0].length + 100);
    matches.push({ line: index + 1, before: (start ? '…' : '') + line.slice(start, match.index),
      match: match[0], after: line.slice(match.index + match[0].length, end) + (end < line.length ? '…' : '') });
  });
  return { query, matches, total, capped: total > matches.length };
}

/** On-demand private text read. No persistent index or content storage. */
export async function readPropertyReportText(...args) {
  try { return await readProtectedReportText(...args); }
  catch (error) { throw failure(safeReportTextMessage(error)); }
}
async function readProtectedReportText({ client, list, store, hash }, file, { userId, signal, isCurrent = () => true } = {}) {
  const expected = Object.fromEntries(fields.map(key => [key, file?.[key]]));
  const check = () => { if (signal?.aborted || !isCurrent()) throw stale(); };
  const user = async () => {
    check();
    const { data, error } = await client.auth.getUser();
    check();
    if (error || !userId || data?.user?.id !== userId) throw stale();
  };
  const currentFile = async () => {
    check(); const found = (await list()).filter(f => f.id === expected.id); check();
    if (found.length !== 1 || !same(found[0], expected)) throw stale();
  };
  check();
  if (!supported(expected)) throw failure('Text search supports document .md and .txt files only. PDF and Word content are not searched.');
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || expected.bytes > REPORT_TEXT_MAX_BYTES) throw failure('Text search supports files up to 2 MiB. Download this file to search it separately.');
  if (!Number.isSafeInteger(expected.version) || expected.version < 1 || !/^[a-f0-9]{64}$/i.test(expected.sha256 || '')) throw stale();
  await user(); await currentFile();
  const { data, error } = await store.createSignedUrl(expected.path, 60);
  check();
  if (error || !data?.signedUrl) throw failure('The report could not be read with your current access.');
  const url = new URL(data.signedUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw failure('The report could not be read securely.');
  const response = await fetch(url, { signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  if (!response.ok || !response.body?.getReader) {
    await response.body?.cancel().catch(() => {});
    throw failure('The report could not be read with your current access.');
  }
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    check();
    const length = response.headers.get('content-length');
    if (length !== null && (!Number.isSafeInteger(Number(length)) || Number(length) < 0 || Number(length) > REPORT_TEXT_MAX_BYTES || Number(length) > expected.bytes)) throw failure('The report size changed or exceeds the text-search limit.');
    while (true) {
      check(); const part = await reader.read(); check();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > REPORT_TEXT_MAX_BYTES || bytes > expected.bytes) throw failure('The report size changed or exceeds the text-search limit.');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (bytes !== expected.bytes) throw failure('The report does not match its recorded size. Reopen its current version.');
  const raw = new Uint8Array(bytes); let offset = 0;
  chunks.forEach(chunk => { raw.set(chunk, offset); offset += chunk.byteLength; });
  if ((await hash(raw.buffer)).toLowerCase() !== expected.sha256.toLowerCase()) throw failure('The report does not match its recorded hash. Reopen its current version.');
  check();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw failure('Text search needs a UTF-8 text report. Download this file to inspect it separately.'); }
  // eslint-disable-next-line no-control-regex -- Binary control bytes are rejected, never rendered as report text.
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw failure('This file contains binary control bytes and cannot be searched as text.');
  await currentFile(); await user(); check();
  return { text, source: expected };
}
