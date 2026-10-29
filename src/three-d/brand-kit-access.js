// Read-only owned kits. Never trust a cached session as authorization, and never
// let a response from the previous account populate a new account's picker.
const failure = (code, message) => Object.assign(new Error(message), { code });
export async function readOwnedBrandKits(sb, { id, isCurrent = () => true } = {}) {
  const verified = async () => {
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user?.id) throw failure('SIGNED_OUT', 'Sign in to load your brand kits.');
    return data.user.id;
  };
  const owner = await verified();
  if (!isCurrent()) throw failure('STALE', 'Account changed. Load your brand kits again.');
  let query = sb.from('templates').select('*').eq('user_id', owner).order('created_at', { ascending: true });
  if (id) query = query.eq('id', id);
  const { data, error } = await query;
  if (error) throw error;
  if (!isCurrent() || await verified() !== owner || !isCurrent()) throw failure('STALE', 'Account changed. Load your brand kits again.');
  if (!Array.isArray(data)) throw failure('INVALID_RESPONSE', 'Could not load your brand kits.');
  return { owner, kits: data.filter((row) => row?.user_id === owner && typeof row.id === 'string' && (!id || row.id === id)).map((row) => ({
    id: row.id, name: String(row.name || 'Untitled brand kit').slice(0, 160),
    config: structuredClone(row.config || {}), updated_at: row.updated_at || row.created_at || null,
  })) };
}
