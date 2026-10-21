// "Find claims" for Exploration Maps 3D: the 2D app's claim registries (shared/claimSearch.js, through the same
// /api/claims and /api/bc-claims proxies) searched by holder, claim number or name, or round the model, and
// added as area overlays (overlays.js) with role "claims": the project's in the brand accent, their neighbours
// grey (or, asked, in their holder's colour, a few holders at most), each with the registry's credit for the
// footer. Loaded by studio.js on the first click on Find claims or call of EM3D.findClaims.
import { searchClaims, claimsInBbox, bboxAround, toClaims, mergeClaims, splitClaims, ownersOf, claimsCredit, registryOf, claimContains } from '../../shared/claimSearch.js';

let H, S;
export function init(host) { H = host; S = host.S; }

export const JURISDICTIONS = [['bc', 'British Columbia'], ['on', 'Ontario'], ['sk', 'Saskatchewan'], ['mb', 'Manitoba'], ['nl', 'Newfoundland and Labrador'], ['yt', 'Yukon'], ['qc', 'Quebec']];
export const GREY = '#9aa3a5', HOLDER_COLOURS = ['#2a9d8f', '#457b9d', '#e9c46a', '#6a4c93', '#8ac926'];
const form = { province: 'bc', type: 'company', query: '', owner: '', byOwner: false, msg: '' };

// The block's footprint in latitude/longitude; null without a coordinate system.
function footprint() {
  const geo = H.geo(), G = H.G; if (!geo || !G) return null;
  const B = G.B; return [[B.x0, B.y0], [B.x1, B.y0], [B.x1, B.y1], [B.x0, B.y1]].map(([x, y]) => geo.fwd(x, y));
}
const claimsOf = (group) => S.overlays.filter((o) => o.role === 'claims' && (o.group || 'project') === group);
// An overlay's areas back to GeoJSON (overlays.js keeps them as { g: "A", c: rings, p }).
const asGeoJSON = (o) => ({ type: 'FeatureCollection', features: (o.data?.features || []).filter((f) => f.g === 'A').map((f) => ({ type: 'Feature', properties: f.p || {}, geometry: { type: 'Polygon', coordinates: f.c } })) });
// The claims in place of the group's overlays, keeping their style.
async function put(group, sets) {
  const old = claimsOf(group), keep = old[0] || {}, ids = [];
  for (const o of old) await H.api.removeOverlay(o.id);
  for (const s of sets) {
    if (!s.fc.features.length) continue;
    const r = await H.api.addOverlay({ name: s.name, data: { type: 'FeatureCollection', features: s.fc.features }, crs: 'EPSG:4326', kind: 'fill', role: 'claims', group, credit: s.credit, label: s.label, color: s.color ?? keep.color,
      opacity: keep.opacity ?? (group === 'project' ? 0.3 : 0.15), width: keep.width ?? (group === 'project' ? 2 : 1), inset: true });
    ids.push(...[r].flat());
  }
  return ids;
}

// EM3D.findClaims: { query, type: "company" | "number" | "name", province, owner, numbers, around, pad, byOwner,
// inset }. A search's claims are the project's (only those of owner, when given); around: true finds every claim
// round the block (pad: its size again on each side, by default half) and splits them into the project's (held
// by owner, or the numbers given; else the holder of the claim under the block, or of the project's claims
// already on the figure) and the neighbours. The inset turns to the claim map unless inset: false.
export async function find(o = {}) {
  const province = String(o.province || form.province || 'bc').toLowerCase(), type = o.type || 'company', credit = claimsCredit(province), registry = registryOf(province);
  if (!JURISDICTIONS.some(([v]) => v === province) && !/^us-[a-z]{2}$/.test(province)) throw new Error(`province must be one of ${JURISDICTIONS.map(([v]) => v).join(', ')} (or a us- state).`);
  let fc, project, neighbours = null;
  const numbers = (Array.isArray(o.numbers) ? o.numbers : String(o.numbers || '').split(/[\s,;]+/)).filter(Boolean);
  if (o.around) {
    const ll = footprint(); if (!ll) throw new Error('Set the coordinate system first (step 1): claims around the model are found by where it is.');
    fc = toClaims(await claimsInBbox(bboxAround(ll, o.pad ?? 0.5), province));
    const c = ll.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]), had = claimsOf('project').flatMap((x) => asGeoJSON(x).features);
    const owner = o.owner ?? (numbers.length ? null : had.find((f) => f.properties.owner)?.properties.owner || fc.features.find((f) => claimContains(f, c))?.properties.owner);
    ({ project, neighbours } = splitClaims(fc, { owner, numbers: [...numbers, ...had.map((f) => f.properties.number)] }));
    project = mergeClaims({ features: had }, project);
  } else {
    const q = String(o.query ?? '').trim(); if (!q) throw new Error('findClaims needs a query (a holder, claim numbers or a claim name), or around: true.');
    if (!['company', 'number', 'name'].includes(type)) throw new Error('type must be "company" (the holder), "number" (claim numbers, several at once) or "name".');
    const terms = type === 'number' ? q.split(/[\s,;]+/).filter(Boolean).slice(0, 20) : [q];
    fc = mergeClaims(...await Promise.all(terms.map((t) => searchClaims(t, type, province))));
    project = o.owner ? splitClaims(fc, { owner: o.owner }).project : fc;
  }
  const owners = ownersOf(project), who = owners.length === 1 && owners[0].owner !== 'Unknown' ? owners[0].owner : '';
  const ids = await put('project', [{ name: `Project claims${who ? ` (${who})` : ''}`.slice(0, 80), label: 'Project claims', fc: project, credit, color: S.accent }]);
  if (neighbours) {
    const top = o.byOwner ? ownersOf(neighbours).filter((x) => x.owner !== 'Unknown').slice(0, HOLDER_COLOURS.length) : [], by = new Map(top.map((x, i) => [x.owner, HOLDER_COLOURS[i]]));
    const sets = top.map((x) => ({ name: `Claims of ${x.owner}`.slice(0, 80), label: x.owner, color: by.get(x.owner), fc: { features: neighbours.features.filter((f) => f.properties.owner === x.owner) }, credit }));
    sets.push({ name: top.length ? 'Other claims' : 'Neighbouring claims', label: top.length ? 'Other claims' : 'Neighbouring claims', color: GREY, fc: { features: neighbours.features.filter((f) => !by.has(f.properties.owner)) }, credit });
    ids.push(...await put('neighbours', sets));
  }
  if (o.inset !== false && (ids.length || claimsOf('project').length)) await H.setStyle({ insetStyle: 'claims' });
  const r = { registry, province, found: fc.features.length, project: project.features.length, neighbours: neighbours?.features.length ?? 0, owners: ownersOf(fc).slice(0, 12), overlays: ids, credit };
  H.status(r.found ? `${registry}: ${r.project} project ${r.project === 1 ? 'claim' : 'claims'}${neighbours ? ` and ${r.neighbours} neighbouring` : ''} added.` : `${registry}: no claims found.`);
  return r;
}

// The panel under Map overlays.
export function renderUI(el) {
  if (!el) return;
  const esc = H.esc, opt = (k, list) => list.map(([v, t]) => `<option value="${esc(v)}" ${form[k] === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
  el.innerHTML = `<div class="grid2">
      <label class="field"><span>Jurisdiction</span><select data-cf="province">${opt('province', JURISDICTIONS)}</select></label>
      <label class="field"><span>Search by</span><select data-cf="type">${opt('type', [['company', 'Holder'], ['number', 'Claim numbers'], ['name', 'Claim name']])}</select></label>
      <label class="field" style="grid-column:1/-1"><span>Holder, claim numbers or name</span><input type="text" data-cf="query" value="${esc(form.query)}" placeholder="e.g. Example Resources, or 1012345, 1012346" maxlength="200"></label>
      <label class="field" style="grid-column:1/-1"><span>Project holder, for claims around the model (else the holder under the block)</span><input type="text" data-cf="owner" value="${esc(form.owner)}" maxlength="120"></label>
    </div>
    <label class="check" style="margin-top:6px"><input type="checkbox" data-cf="byOwner" ${form.byOwner ? 'checked' : ''}>Neighbours in their holder's colour</label>
    <div class="row" style="margin-top:6px"><button class="btn" type="button" data-cx="search">Search</button><button class="btn" type="button" data-cx="around">Claims around the model</button></div>
    <p class="muted" data-cmsg style="margin-top:6px">${esc(form.msg || (H.geo() ? 'Project claims in the brand colour, neighbours grey; the inset becomes the claim map.' : 'Set the coordinate system first (step 1) to place claims.'))}</p>`;
  el.querySelectorAll('[data-cf]').forEach((c) => c.addEventListener('change', () => { form[c.dataset.cf] = c.type === 'checkbox' ? c.checked : c.value; }));
  const say = (t) => { form.msg = t; const p = el.querySelector('[data-cmsg]'); if (p) p.textContent = t; };
  el.querySelectorAll('[data-cx]').forEach((b) => b.addEventListener('click', async () => {
    const around = b.dataset.cx === 'around';
    if (!H.geo()) { say('Set the coordinate system first (step 1).'); return; }
    if (!around && !form.query.trim()) { say('Type a holder, claim numbers or a claim name.'); return; }
    say('Searching the registry…');
    try {
      const r = await H.api.findClaims(around ? { around, province: form.province, owner: form.owner.trim() || undefined, byOwner: form.byOwner } : { query: form.query, type: form.type, province: form.province });
      say(r.found ? `${r.project} project and ${r.neighbours} neighbouring claims from ${r.registry}. Holders: ${r.owners.slice(0, 4).map((x) => `${x.owner} (${x.count})`).join(', ')}.` : `No claims found in ${r.registry}.`);
    } catch (e) { say(e.message); }
  }));
}
