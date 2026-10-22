// Panel parts, fetched with the first data (the page is drawn first): the file list with each file's type and
// columns, and the data checks (step 1); the Layout step's controls, the metal-equivalent builder's form (the
// calculation and EM3D.setEquivalent stay in studio.js), the text and wall label lists (their EM3D methods
// stay in studio.js); and the figure sizes (Export). Each takes the host (studio.js host()).
import { METAL_DEFAULTS, priceUnit, eqFactors, eqFormula } from './metal-eq.js';

const $ = (id) => document.getElementById(id);
let H = null; // the host (studio.js)

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
export function renderChecks({ getChecks, project, esc, setProvisional }) { // the host
  const el = $('checks'), C = getChecks(), open = el.querySelector('details')?.open;
  if (!C) { el.innerHTML = '<p class="muted">Add files to check them.</p>'; return; }
  const c = C.counts;
  el.innerHTML = `<div class="summary">${[[c.holes, 'holes'], [c.holesPlaced, 'placed'], [c.assaysLoaded, 'assays loaded'], [c.assaysPlaced, 'assays placed'], [c.intervalsShown, 'intervals shown']].map(([n, t]) => `<span class="pill">${n.toLocaleString()} ${t}</span>`).join('')}</div>`
    + (C.problems.length ? `<ul class="checks">${C.problems.map((p) => `<li>${esc(p.message)}</li>`).join('')}</ul>` : '<p class="muted" style="margin-top:6px">No problems found.</p>')
    + (project.holes?.length ? `<details${open ? ' open' : ''}><summary>Provisional positions (${C.provisionalHoles.length})</summary><p class="muted">Ticked holes draw dashed and fainter, with a legend row. Read from a collar status or flags column; change any here.</p>
      <div class="prov-list">${project.holes.map((h) => `<label class="check"><input type="checkbox" data-prov="${esc(h.id)}" ${h.prov ? 'checked' : ''}>${esc(h.id)}</label>`).join('')}</div></details>` : '');
  el.querySelectorAll('[data-prov]').forEach((cb) => cb.addEventListener('change', () => setProvisional(cb.dataset.prov, cb.checked)));
}

// The file list (step 1): each file's type and column choices.
export function renderFiles(host) {
  H = host; const { S, esc, ROLE_LABEL, ROLE_FIELDS, FIELD_LABEL, gradeCols, refresh } = H, files = H.files(), PR = H.PR, list = $('file-list');
  if (!files.length) { list.innerHTML = '<p class="muted">No files yet.</p>'; return; }
  list.innerHTML = '';
  files.forEach((f, fi) => {
    const div = document.createElement('div'); div.className = 'file';
    const roles = ['collar', 'survey', 'assay', 'topo', 'mesh', 'litho', 'lithlegend', 'geophys', 'published', 'overlay', 'unknown']; // EXT hook: litho, lithlegend, geophys, published, overlay
    let html = `<div class="file-head"><span class="name" title="${esc(f.name)}">${esc(f.name)}</span>
      <select data-role="${fi}" aria-label="File type for ${esc(f.name)}">${roles.map((r) => `<option value="${r}" ${r === f.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></div>`;
    if (f.role === 'mesh') html += `<span class="muted">${f.mesh.v.length.toLocaleString()} vertices · ${(f.mesh.f.length / 3).toLocaleString()} triangles</span>`;
    else if (!f.header.length) html += '<span class="muted">Drawn on the terrain. Restyle it in Layout, Map overlays.</span>';
    else {
      html += `<span class="muted">${f.rows.length.toLocaleString()} rows</span>`;
      const fields = ROLE_FIELDS[f.role] || [];
      if (fields.length) {
        html += '<div class="maps">' + fields.map((k) => `<label for="m-${fi}-${k}">${FIELD_LABEL[k]}</label><select id="m-${fi}-${k}" data-map="${fi}" data-key="${k}"><option value="">—</option>${f.header.map((h, i) => `<option value="${i}" ${f.cols[k] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`).join('') + '</div>';
        const req = { collar: ['hole', 'east', 'north'], survey: ['hole', 'depth'], assay: ['hole', 'from', 'to'], topo: ['east', 'north', 'elev'], litho: ['hole', 'from', 'to', 'code'], lithlegend: ['code', 'desc'], geophys: ['east', 'north', 'elev', 'value'], published: ['resultId', 'hole', 'from', 'to'] }[f.role] || [];
        const miss = req.filter((k) => f.cols[k] === undefined);
        if (miss.length) html += `<span class="bad">Pick a column for ${miss.map((k) => FIELD_LABEL[k]).join(', ')}.</span>`;
        if (f.role === 'published' && PR && !miss.length) html += PR.fileNote(f, esc);
        if (f.role === 'overlay') html += '<span class="muted">One point per row, at the easting and northing (or latitude and longitude), drawn on the terrain. Restyle it in Layout, Map overlays.</span>';
        if (f.role === 'assay') html += f.grades.length ? `<span class="muted">Grade columns: ${f.grades.map((g) => esc(g.name)).join(', ')}</span>` : '<span class="bad">No numeric grade columns found.</span>';
      } else if (f.role === 'unknown') html += `<span class="warn">${f.hint ? 'Published results? Choose that type to use them.' : 'Choose what this file holds.'}</span>`;
    }
    div.innerHTML = html; list.appendChild(div);
  });
  list.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', () => {
    const f = H.files()[+s.dataset.role]; f.role = s.value; if (f.role === 'assay') f.grades = gradeCols(f.header, f.cols, f.rows);
    if (f.role === 'published') S.calloutMode = 'published'; // a release table, chosen by hand: the callouts come from it
    refresh();
  }));
  list.querySelectorAll('[data-map]').forEach((s) => s.addEventListener('change', () => {
    const f = H.files()[+s.dataset.map]; if (s.value === '') delete f.cols[s.dataset.key]; else f.cols[s.dataset.key] = +s.value;
    if (f.role === 'assay') f.grades = gradeCols(f.header, f.cols, f.rows); refresh();
  }));
}
// The Layout step's controls, from the settings.
export function renderStyle(host) {
  H = host; const { S, esc, BIN_COLORS, setStyle, pad3, labelFor, G, project, meshName, restyle, schedulePublish } = H;
  const sel = $('value-col'); sel.innerHTML = (project?.cols || []).map((c) => `<option ${c === S.valueCol ? 'selected' : ''}>${esc(c)}</option>`).join('') || '<option>—</option>';
  $('value-label').value = S.valueLabel;
  $('bins').innerHTML = S.bins.map((b, i) => `<label class="field"><i style="background:${BIN_COLORS[i + 1]}"></i><input type="number" step="any" data-bin="${i}" value="${esc(b)}" aria-label="Lower limit of colour ${i + 1}"></label>`).join('');
  $('bins').querySelectorAll('[data-bin]').forEach((inp) => inp.addEventListener('change', () => { const b = S.bins.slice(); b[+inp.dataset.bin] = parseFloat(inp.value) || 0; setStyle({ bins: b }); }));
  $('co-cut').value = S.coCut; $('co-incl').value = S.coIncl; $('co-count').value = S.coCount; $('co-min').value = S.coMin;
  $('sec-az').value = S.secAz; $('sec-az-out').textContent = `${pad3(S.secAz)}°`; $('sec-w').value = S.secW;
  $('opt-walls').checked = S.walls; $('opt-ids').checked = S.ids; $('opt-inset').checked = S.inset; $('opt-ribbons').checked = S.ribbons;
  $('opt-pending').checked = S.pendingLabels; $('opt-pending-none').checked = S.pendingNoAssays; $('opt-elev').checked = S.elevTicks;
  $('value-col2').innerHTML = '<option value="">None</option>' + (project?.cols || []).filter((c) => c !== S.valueCol).map((c) => `<option ${c === S.valueCol2 ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('terrain').value = S.terrain; $('terrain-src').value = S.terrainSource; $('block-style').value = S.blockStyle; $('collar-fit').value = S.collarFit; $('vex').value = S.vex; $('vex-out').textContent = `${S.vex}×`;
  $('trace-w').value = Math.round(S.traceWidth * 100); $('trace-out').textContent = `${S.traceWidth.toFixed(1)}×`;
  $('surf').value = Math.round(S.surf * 100); $('surf-out').textContent = `${Math.round(S.surf * 100)}%`;
  // The grade column as one-click choices, the display cut-off's quick values, the shell and the
  // metal-equivalent builder.
  $('metric-chips').innerHTML = (project?.cols || []).map((c) => `<button type="button" class="chip" data-col="${esc(c)}" aria-pressed="${c === S.valueCol}" title="${esc(c)}">${esc(labelFor(c))}</button>`).join('');
  $('metric-chips').querySelectorAll('[data-col]').forEach((b) => b.addEventListener('click', () => setStyle({ valueCol: b.dataset.col })));
  const dc = S.displayCutoff;
  $('dcut-btns').innerHTML = [null, ...H.dcutChoices()].map((v) => `<button type="button" class="chip" data-dcut="${v ?? ''}" aria-pressed="${v === dc}">${v === null ? 'All' : v}</button>`).join('');
  $('dcut-btns').querySelectorAll('[data-dcut]').forEach((b) => b.addEventListener('click', () => setStyle({ displayCutoff: b.dataset.dcut === '' ? null : +b.dataset.dcut })));
  if (document.activeElement?.id !== 'dcut') $('dcut').value = dc ?? '';
  H.renderShellUI(); H.renderEq(); H.renderExtUI(); H.renderLegendUI(); // EXT hook
  $('co-place').value = S.coPlacement; $('block-margin').value = S.blockMargin ?? ''; $('block-margin').placeholder = 'auto';
  document.querySelectorAll('[data-bx]').forEach((i) => { const k = i.dataset.bx; i.value = S.blockExtent?.[k] ?? ''; i.placeholder = G ? Math.round(G.B[k]) : ''; });
  const ml = $('mesh-list'); ml.innerHTML = '';
  (project?.meshF || []).forEach((f) => { const st = S.meshes[f.name]; if (!st) return;
    const d = document.createElement('label'); d.className = 'mesh';
    d.innerHTML = `<input type="checkbox" ${st.show ? 'checked' : ''} aria-label="Show ${esc(f.name)}"><span>${esc(meshName(f.name))}</span><input type="color" value="${esc(st.color)}" aria-label="Colour of ${esc(f.name)}">`;
    const [cb, , cp] = d.children; cb.addEventListener('change', () => { st.show = cb.checked; restyle(); schedulePublish(); }); cp.addEventListener('input', () => { st.color = cp.value; restyle(); schedulePublish(); });
    ml.appendChild(d); });
}
export function renderSizes(host) {
  H = host; const { S, FORMATS, setFigureSize } = H;
  $('sizes').innerHTML = Object.entries(FORMATS).map(([k, f]) => `<label><input type="radio" name="size" value="${k}" ${k === S.format ? 'checked' : ''}><span><b>${f.label}</b><br><span class="muted">${f.use}</span></span><small>${f.w} × ${f.h}</small></label>`).join('');
  $('sizes').querySelectorAll('input').forEach((r) => r.addEventListener('change', () => setFigureSize(r.value)));
}
export function renderLabelList(host) {
  H = host; const { S, esc, updateLabel, removeLabel, status } = H;
  const el = $('label-list');
  el.innerHTML = S.labels.map((L) => `<div class="label-row"><input type="text" data-lt="${esc(L.id)}" value="${esc(L.text)}" aria-label="Text of label ${esc(L.id)}">`
    + `<label class="check"><input type="checkbox" data-la="${esc(L.id)}" ${L.arrow ? 'checked' : ''}>Arrow</label>`
    + `<button class="btn" type="button" data-ld="${esc(L.id)}" aria-label="Delete label ${esc(L.text)}">Delete</button></div>`).join('');
  el.querySelectorAll('[data-lt]').forEach((i) => i.addEventListener('change', () => { try { updateLabel(i.dataset.lt, { text: i.value }); } catch (e) { status(e.message); } }));
  el.querySelectorAll('[data-la]').forEach((i) => i.addEventListener('change', () => updateLabel(i.dataset.la, { arrow: i.checked })));
  el.querySelectorAll('[data-ld]').forEach((b) => b.addEventListener('click', () => removeLabel(b.dataset.ld)));
}
export function renderWallLabelList(host) {
  H = host; const { S, esc, updateWallLabel, removeWallLabel, status } = H;
  const el = $('wall-list'), faces = ['N', 'S', 'E', 'W'];
  // A heading's lines (block.js) edit in a box of their own lines.
  el.innerHTML = S.wallLabels.map((L) => `<div class="label-row">${L.text.includes('\n') ? `<textarea rows="2" data-wt="${esc(L.id)}" aria-label="Text of wall label ${esc(L.id)}">${esc(L.text)}</textarea>` : `<input type="text" data-wt="${esc(L.id)}" value="${esc(L.text)}" aria-label="Text of wall label ${esc(L.id)}">`}`
    + `<select data-wf="${esc(L.id)}" aria-label="Face of ${esc(L.text)}">${faces.map((f) => `<option ${f === L.face ? 'selected' : ''}>${f}</option>`).join('')}</select>`
    + (S.geology.legend.length ? `<select data-wu="${esc(L.id)}" aria-label="Unit colour of ${esc(L.text)}"><option value="">No unit</option>${S.geology.legend.map((e) => `<option value="${esc(e.code)}" ${e.code === L.unit ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>` : '') // EXT hook
    + `<button class="btn" type="button" data-wd="${esc(L.id)}" aria-label="Delete wall label ${esc(L.text)}">Delete</button></div>`).join('');
  el.querySelectorAll('[data-wt]').forEach((i) => i.addEventListener('change', () => { try { updateWallLabel(i.dataset.wt, { text: i.value }); } catch (e) { status(e.message); } }));
  el.querySelectorAll('[data-wf]').forEach((i) => i.addEventListener('change', () => updateWallLabel(i.dataset.wf, { face: i.value })));
  el.querySelectorAll('[data-wu]').forEach((i) => i.addEventListener('change', () => updateWallLabel(i.dataset.wu, { unit: i.value || null }))); // EXT hook
  el.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () => removeWallLabel(b.dataset.wd)));
}
