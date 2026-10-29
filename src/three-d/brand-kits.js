// Loaded only by the explicit Brand action; no kit reads or Supabase startup
// for anonymous visitors who never open the picker. Reuses the existing client.
import { client } from './account-core.js';
import { readOwnedBrandKits } from './brand-kit-access.js';
import { styleFromKitConfig } from '../../shared/brandKit.js';
import { figureSignature } from './save-state.js';

export function createBrandKitPicker({ getClient = client, api = window.EM3D, doc = document } = {}) {
  const load = doc.getElementById('brand-kits-load'), select = doc.getElementById('brand-kits-select');
  const apply = doc.getElementById('brand-kits-apply'), note = doc.getElementById('brand-kits-note'), choices = doc.getElementById('brand-kits-choices');
  let epoch = 0, rows = [], owner = null, sbPromise, authWired = false;
  const say = (text) => { note.textContent = text; };
  const clear = (text) => { epoch++; rows = []; owner = null; select.replaceChildren(); select.disabled = false; choices.hidden = true; apply.disabled = true; load.disabled = false; if (text) say(text); };
  const errorText = (error) => {
    if (error?.code === 'SIGNED_OUT') return 'Sign in using My 3D maps, then load your brand kits. Your figure is unchanged.';
    if (error?.code === 'STALE') return 'Your account or figure changed. Load your brand kits again.';
    if (['42P01', 'PGRST205', 'NOT_CONFIGURED'].includes(error?.code)) return 'Saved brand kits are not available on this site yet. Your figure is unchanged.';
    return 'Could not load or apply that brand kit. Try again. Your figure is unchanged.';
  };
  const connection = () => (sbPromise ||= Promise.resolve().then(getClient).then((sb) => {
    if (!authWired) {
      sb.auth.onAuthStateChange((event) => {
        if (event !== 'TOKEN_REFRESHED' && event !== 'INITIAL_SESSION') clear('Your sign-in changed. Load your brand kits again.');
      });
      authWired = true;
    }
    return sb;
  }).catch((error) => { sbPromise = null; throw error; }));
  async function refresh() {
    clear(); const token = epoch; load.disabled = true; say('Loading your brand kits…');
    try {
      const sb = await connection();
      const result = await readOwnedBrandKits(sb, { isCurrent: () => token === epoch });
      if (token !== epoch) return;
      owner = result.owner; rows = result.kits;
      select.replaceChildren(...rows.map((row) => { const option = doc.createElement('option'); option.value = row.id; option.textContent = row.name; return option; }));
      choices.hidden = !rows.length; apply.disabled = !rows.length;
      say(rows.length ? 'Choose a kit, then Apply. Nothing changes until you apply it.' : 'No saved brand kits in this account. Save a kit in the 2D Brand Kit Studio, then reload here.');
    } catch (error) { if (token === epoch) clear(errorText(error)); }
    finally { if (token === epoch) load.disabled = false; }
  }
  async function applySelected() {
    const id = select.value;
    if (!rows.some((row) => row.id === id) || !owner) return;
    const token = ++epoch, expectedOwner = owner, before = figureSignature(api.getProject(), api.filesDigest());
    const current = () => token === epoch && figureSignature(api.getProject(), api.filesDigest()) === before;
    apply.disabled = true; load.disabled = true; select.disabled = true; say('Applying brand kit…');
    try {
      const sb = await connection(), result = await readOwnedBrandKits(sb, { id, isCurrent: current });
      if (!current() || result.owner !== expectedOwner) throw Object.assign(new Error(), { code: 'STALE' });
      const kit = result.kits[0];
      if (!kit) throw new Error('Kit no longer available');
      let allowed = true;
      await api.setFigureStyle(styleFromKitConfig(kit.config), { brandKitId: kit.id, brandRevision: kit.updated_at, isCurrent: () => (allowed = current()) });
      if (token === epoch) say(allowed ? `Applied “${kit.name}”.` : 'The figure changed while applying. Choose Apply again when ready.');
    } catch (error) { if (token === epoch) clear(errorText(error)); }
    finally { if (token === epoch) { apply.disabled = !rows.length; load.disabled = false; select.disabled = false; } }
  }
  apply.addEventListener('click', applySelected);
  doc.defaultView?.addEventListener('em3d:figure-loading', () => clear('The figure changed. Load your brand kits again.'));
  return { refresh, clear };
}

let picker;
export const open = () => { picker ||= createBrandKitPicker(); return picker.refresh(); };
