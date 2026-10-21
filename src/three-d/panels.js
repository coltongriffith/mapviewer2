// Panel parts loaded when first shown: the metal-equivalent builder's form (step 3, "Metal equivalent"; the
// calculation and EM3D.setEquivalent stay in studio.js) and the data checks list (step 1).
import { METAL_DEFAULTS, priceUnit, eqFactors, eqFormula } from './metal-eq.js';

const $ = (id) => document.getElementById(id);
let H = null; // { S, metalCols, unitOf, setEquivalent, status, esc } from studio.js

function eqForm() {
  const metals = {};
  $('eq-rows').querySelectorAll('[data-eqm]').forEach((r) => { if (r.querySelector('input[type=checkbox]').checked) metals[r.dataset.eqm] = { price: +r.querySelector('[data-p]').value, recovery: +r.querySelector('[data-r]').value }; });
  return { base: $('eq-base').value, basePrice: +$('eq-bprice').value, baseRecovery: +$('eq-brec').value, metals };
}
function eqPreview() {
  try {
    const f = eqForm(), present = H.metalCols(), unitOf = H.unitOf, ms = Object.entries(f.metals).map(([metal, m]) => ({ metal, unit: unitOf(present.get(metal)), ...m }));
    $('eq-formula').textContent = ms.length ? eqFormula(f.base, eqFactors({ metal: f.base, unit: unitOf(present.get(f.base)), price: f.basePrice, recovery: f.baseRecovery }, ms)) : 'Tick at least one other metal.';
  } catch (e) { $('eq-formula').textContent = e.message; }
}
export function renderEq(host, baseOverride) {
  H = host; const { S, metalCols, esc } = H;
  const present = metalCols(), e = S.eq, box = $('eq-body');
  if (present.size < 2) { box.innerHTML = '<p class="muted">Needs at least two metal columns in the assays (for example Cu and Au).</p>'; return; }
  const base = baseOverride || (e?.base && present.has(e.base) ? e.base : present.has('Cu') ? 'Cu' : [...present.keys()][0]), same = e?.base === base;
  const val = (m, k, d) => (e?.metals?.[m]?.[k] ?? d);
  box.innerHTML = `<div class="grid2"><label class="field" style="grid-column:1/-1"><span>Base metal</span><select id="eq-base">${[...present.keys()].map((m) => `<option ${m === base ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    <label class="field"><span>${base} US$/${priceUnit(base)}</span><input type="number" id="eq-bprice" step="any" min="0" value="${esc(same ? e.basePrice : METAL_DEFAULTS[base] ?? '')}"></label>
    <label class="field"><span>${base} recovery %</span><input type="number" id="eq-brec" min="1" max="100" value="${esc(same ? e.baseRecovery : 90)}"></label></div>
    <div id="eq-rows">${[...present.keys()].filter((m) => m !== base).map((m) => `<div class="eq-row" data-eqm="${m}"><label class="check"><input type="checkbox" ${(e ? !!e.metals[m] : !!METAL_DEFAULTS[m]) ? 'checked' : ''}>${m}</label>
      <label class="field"><span>US$/${priceUnit(m)}</span><input type="number" data-p step="any" min="0" value="${esc(val(m, 'price', METAL_DEFAULTS[m] ?? ''))}"></label><label class="field"><span>Recovery %</span><input type="number" data-r min="1" max="100" value="${esc(val(m, 'recovery', 90))}"></label></div>`).join('')}</div>
    <p class="mono" id="eq-formula"></p>
    <div class="row"><button class="btn" type="button" id="eq-apply">${e ? 'Update' : 'Add'} ${base}Eq_calc</button>${e ? '<button class="btn" type="button" id="eq-remove">Remove</button>' : ''}</div>`;
  $('eq-base').addEventListener('change', () => renderEq(H, $('eq-base').value));
  box.querySelectorAll('input').forEach((i) => i.addEventListener('input', eqPreview));
  $('eq-apply').addEventListener('click', () => { try { H.setEquivalent(eqForm()); } catch (err) { H.status(err.message); } });
  $('eq-remove')?.addEventListener('click', () => H.setEquivalent(null));
  eqPreview();
}

// The data checks: counts, problems and the provisional-position ticks (EM3D.setProvisional).
export function renderChecks({ getChecks, project, esc, setProvisional }) {
  const el = $('checks'), C = getChecks(), open = el.querySelector('details')?.open;
  if (!C) { el.innerHTML = '<p class="muted">Add files to check them.</p>'; return; }
  const c = C.counts;
  el.innerHTML = `<div class="summary">${[[c.holes, 'holes'], [c.holesPlaced, 'placed'], [c.assaysLoaded, 'assays loaded'], [c.assaysPlaced, 'assays placed'], [c.intervalsShown, 'intervals shown']].map(([n, t]) => `<span class="pill">${n.toLocaleString()} ${t}</span>`).join('')}</div>`
    + (C.problems.length ? `<ul class="checks">${C.problems.map((p) => `<li>${esc(p.message)}</li>`).join('')}</ul>` : '<p class="muted" style="margin-top:6px">No problems found.</p>')
    + (project.holes?.length ? `<details${open ? ' open' : ''}><summary>Provisional positions (${C.provisionalHoles.length})</summary><p class="muted">Ticked holes draw dashed and fainter, with a legend row. Read from a collar status or flags column; change any here.</p>
      <div class="prov-list">${project.holes.map((h) => `<label class="check"><input type="checkbox" data-prov="${esc(h.id)}" ${h.prov ? 'checked' : ''}>${esc(h.id)}</label>`).join('')}</div></details>` : '');
  el.querySelectorAll('[data-prov]').forEach((cb) => cb.addEventListener('change', () => setProvisional(cb.dataset.prov, cb.checked)));
}
