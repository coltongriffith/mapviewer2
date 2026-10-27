import template from './tour-template.html?raw';
import three from '../../../node_modules/three/build/three.min.js?raw';
import { buildTourPackage } from './build';
import { exportTourHtml, downloadTour } from './export';
import { studioInput, unitOf } from './studioInput';
import './studio.css';

export function makeTour(snapshot, options = {}) {
  const input = studioInput(snapshot);
  const pkg = buildTourPackage({ ...input, ...options });
  pkg.meta.warnings.unshift(...input.warnings);
  return { html: exportTourHtml(pkg, template, three), package: pkg };
}

export function openTour(getSnapshot) {
  document.getElementById('tour3d-dialog')?.close();
  const dialog = document.createElement('dialog');
  dialog.id = 'tour3d-dialog'; dialog.className = 'acct-dialog tour3d-dialog';
  dialog.setAttribute('aria-labelledby','tour3d-title');
  // All values from the project are assigned through DOM properties below.
  dialog.innerHTML = '<h2 id="tour3d-title">3D Tour</h2><div class="tour3d-grid"><form><label>Title<input name="title" maxlength="160" required></label><label>Grade field<select name="field"></select></label><label>Grade unit<input name="unit" maxlength="20"></label><label>Grade bins (comma separated)<input name="bins" required></label><label>Target<select name="target"></select></label><details><summary>Labels and footprint</summary><label>Claims legend<input name="legend" maxlength="120"></label><label><span><input name="footprint" type="checkbox"> Include generalized footprint</span></label><p class="muted">The footprint is an illustrative outline of selected intercepts, not a geological boundary or resource estimate.</p><label>Footprint threshold<input name="threshold" type="number" step="any"></label><label>Extra labels (one per line: HoleID: Label)<textarea name="labels" rows="2"></textarea></label></details><p class="muted">Includes all loaded project claims and holes, including items hidden in the figure.</p><button class="btn" type="submit">Update preview</button><p class="muted">Terrain and imagery load online. If unavailable, the tour shows an approximate surface. Downloads include the viewer and project data; they still need a connection for terrain and imagery.</p><p class="muted">Hosted publishing will be available after its storage and access controls are activated.</p></form><div><iframe title="3D Tour preview" sandbox="allow-scripts"></iframe><p class="tour3d-status" role="status"></p><ul class="tour3d-warnings"></ul><button class="btn primary tour3d-download" type="button" disabled>Download tour (HTML)</button><button class="btn tour3d-close" type="button">Close</button></div></div>';
  const form = dialog.querySelector('form'), el = name => form.elements.namedItem(name);
  const status = dialog.querySelector('[role=status]'), frame = dialog.querySelector('iframe');
  const download = dialog.querySelector('.tour3d-download');
  let result = null, sourceSignature = null;
  const fail = error => { status.textContent = error.message || 'The tour could not be built.'; result = null; download.disabled = true; };
  try {
    const input = studioInput(getSnapshot());
    el('title').value = input.title; el('legend').value = input.claimsLegend;
    for (const field of input.fields) el('field').add(new Option(field,field));
    el('field').value = input.fields.includes(input.grade.field) ? input.grade.field : input.fields[0];
    el('unit').value = unitOf(el('field').value);
    el('bins').value = el('field').value === input.grade.field ? input.grade.bins.join(', ') : '';
    el('threshold').value = input.grade.bins[1] ?? input.grade.bins[0];
    el('target').add(new Option('All drilling',''));
    for (const target of [...new Set(input.collars.map(c=>c.target).filter(Boolean))]) el('target').add(new Option(target,target));
  } catch (e) { fail(e); }
  const update = () => {
    try {
      const snapshot = getSnapshot();
      const labels = el('labels').value.split('\n').filter(s=>s.trim()).map(line => {
        const at = line.indexOf(':');
        if (at < 1 || !line.slice(at+1).trim()) throw new Error('Enter each label as HoleID: Label.');
        const holeId = line.slice(0,at).trim();
        if (!studioInput(snapshot).collars.some(c=>c.holeId === holeId)) throw new Error('Label hole not found: '+holeId);
        return { holeId, text: line.slice(at+1).trim().slice(0,100) };
      });
      const bins = el('bins').value.split(',').map(v=>v.trim() === '' ? NaN : Number(v));
      result = makeTour(snapshot,{ title: el('title').value.trim(), grade: {field:el('field').value,unit:el('unit').value.trim(),bins},
        mainTarget: el('target').value, claimsLegend: el('legend').value.trim(), labels,
        footprintEnabled: el('footprint').checked, footprintThreshold: el('threshold').value === '' ? undefined : Number(el('threshold').value) });
      sourceSignature = snapshot.signature;
      frame.srcdoc = result.html;
      const list = dialog.querySelector('.tour3d-warnings'); list.replaceChildren();
      for (const warning of result.package.meta.warnings) { const li = document.createElement('li'); li.textContent = warning; list.append(li); }
      status.textContent = result.package.holes.length+' holes · '+result.package.runs.length+' grade runs. Preview updated.';
      download.disabled = false;
    } catch (e) { fail(e); }
  };
  form.addEventListener('submit', e=>{e.preventDefault();update();});
  form.addEventListener('input', ()=>{result=null;download.disabled=true;status.textContent='Settings changed. Update the preview before downloading.';});
  el('field').addEventListener('change',()=>{el('unit').value=unitOf(el('field').value);el('bins').value='';});
  download.addEventListener('click',()=>{
    if (getSnapshot().signature !== sourceSignature) { changed(); return; }
    if(result) downloadTour(result.html,(el('title').value.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'project')+'-3d-tour.html');
  });
  dialog.querySelector('.tour3d-close').onclick = ()=>dialog.close();
  const changed = ()=>{
    if (getSnapshot().signature === sourceSignature) return;
    result=null;download.disabled=true;status.textContent='Project data changed. Update the preview before downloading.';
  };
  window.addEventListener('em3d:change',changed);
  dialog.addEventListener('close',()=>{window.removeEventListener('em3d:change',changed);frame.srcdoc='';dialog.remove();},{once:true});
  document.body.append(dialog);dialog.showModal();
  if (!status.textContent) update();
  return dialog;
}
