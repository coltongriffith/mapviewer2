import proj4 from 'proj4';
import { ensureDef } from './build';

// Use the maker's existing column mappings. Never re-guess columns or strip
// unit suffixes: Cu_pct and Cu_ppm must remain different fields.
const number = value => {
  const text = String(value ?? '').trim();
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
};
const raw = (file, row, key) => file.cols?.[key] == null ? undefined : row[file.cols[key]];
const dip = (v, positiveDown) => positiveDown ? -Math.abs(v) : v;
export const unitOf = field => /(?:pct|percent|%)$/i.test(field) ? '%' : /(?:gpt|g_t|g\/t)$/i.test(field) ? 'g/t' : /ppm$/i.test(field) ? 'ppm' : /ppb$/i.test(field) ? 'ppb' : '';

// Form choices must remain available even when geographic setup is incomplete.
// Reading these labels does not transform or infer any coordinates or grades.
export function tourSetup({files=[],state={},project,appearance={}}) {
  const fields=[...new Set([...files.filter(f=>f.role==='assay').flatMap(f=>(f.grades||[]).map(g=>g.name)),...(project?.cols||[])])];
  const targets=new Set();
  for (const f of files.filter(f=>f.role==='collar')) {
    const col=f.header.findIndex(h=>/^(target|zone|prospect|area)$/i.test(h.trim()));
    if (col>=0) for (const row of f.rows) if (String(row[col]??'').trim()) targets.add(String(row[col]).trim());
  }
  const units=appearance.equivalent?{[appearance.equivalent.field]:appearance.equivalent.unit}:{};
  return {title:state.title||'Project',fields,targets:[...targets],units,grade:{field:state.valueCol,unit:units[state.valueCol]??(unitOf(state.valueLabel||'')||unitOf(state.valueCol||'')),bins:[...(state.bins||[])]}};
}

export function studioInput({ files, state, project, provisional = [], appearance = {}, envelopeSources = [] }) {
  if (!state.crs) throw new Error('Set the collar coordinate system in step 1 before making a tour.');
  ensureDef(state.crs);
  const collars = [], surveys = [], assays = [], fields = new Set(), warnings = [];
  let censored = 0;
  for (const f of files) for (const row of f.rows || []) {
    const holeId = String(raw(f, row, 'hole') ?? '').trim();
    if (!holeId) continue;
    if (f.role === 'collar') {
      const ll = f.cols?.east == null || f.cols?.north == null;
      if (ll && state.crs !== 'EPSG:4326') throw new Error('Longitude/latitude collars need EPSG:4326.');
      const targetCol = f.header.findIndex(h => /^(target|zone|prospect|area)$/i.test(h.trim()));
      collars.push({ holeId, x: number(raw(f,row,ll?'lon':'east')), y: number(raw(f,row,ll?'lat':'north')),
        z: number(raw(f,row,'elev')), azimuth: number(raw(f,row,'az')), dip: dip(number(raw(f,row,'dip')),project?.posDown),
        depth: number(raw(f,row,'depth')), target: targetCol < 0 ? undefined : row[targetCol]?.trim() || undefined,
        provisional: provisional.includes(holeId) });
    }
    if (f.role === 'survey') surveys.push({ holeId, depth: number(raw(f,row,'depth')), azimuth: number(raw(f,row,'az')), dip: dip(number(raw(f,row,'dip')),project?.posDown) });
    if (f.role === 'assay') {
      const values = {};
      for (const g of f.grades || []) {
        fields.add(g.name);
        const v = number(row[g.i]);
        if (/^[<>]/.test(String(row[g.i] ?? '').trim())) censored++;
        values[g.name] = Number.isFinite(v) ? v : null;
      }
      assays.push({ holeId, from: number(raw(f,row,'from')), to: number(raw(f,row,'to')), values });
    }
  }
  if (censored) warnings.push(censored + ' censored assay values are excluded from grade colouring; detection limits are not treated as measured grades.');
  const merged = new Map();
  for (const a of assays) {
    const key = JSON.stringify([a.holeId,a.from,a.to]), old = merged.get(key);
    if (old) {
      for (const [field,v] of Object.entries(a.values)) {
        if (Object.prototype.hasOwnProperty.call(old.values,field) && old.values[field] !== v) throw new Error(a.holeId+': conflicting assays for '+field+' at '+a.from+'–'+a.to+' m.');
        old.values[field] = v;
      }
    } else merged.set(key,{...a,values:{...a.values}});
  }
  if (!assays.length || !fields.size) throw new Error('Add mapped collar and assay tables in step 1 before making a tour.');
  // Reuse maker-calculated fields, never recompute an equivalent recipe here.
  for (const field of project?.cols||[]) if (!fields.has(field)) {
    fields.add(field);
    for (const h of project.holes||[]) for (const it of h.ints||[]) {
      const key=JSON.stringify([h.id,it.from,it.to]);
      if (!merged.has(key)) merged.set(key,{holeId:h.id,from:it.from,to:it.to,values:{}});
      merged.get(key).values[field]=Number.isFinite(it.vals?.[field])?it.vals[field]:null;
    }
  }
  const claims = { type: 'FeatureCollection', features: [] };
  for (const o of state.overlays || []) {
    if (o.role !== 'claims' || (o.group && o.group !== 'project')) continue;
    const crs = o.crs || state.crs;
    if (!o.crs && project?.latlon) throw new Error('Set an explicit coordinate system on the claims overlay before making a tour.');
    ensureDef(crs);
    for (const f of o.data?.features || []) {
      if (f.g !== 'A') continue;
      const coordinates = f.c.map(r => r.map(([x,y]) => crs === 'EPSG:4326' ? [x,y] : proj4(crs,'EPSG:4326',[x,y])));
      claims.features.push({ type: 'Feature', properties: { ...f.p }, style:{color:o.color||'#b35a2c'}, geometry: { type: 'Polygon', coordinates } });
    }
  }
  if (!claims.features.length) warnings.push('No project claim boundaries loaded. This tour shows drilling and terrain only.');
  // Reuse the figure's actual desurvey, including property minimum-curvature
  // paths. Remove any display-only surface shift, not the measured elevation.
  const paths = {};
  let adjusted=0;
  for (const h of project?.holes || []) {
    const c = collars.find(c=>c.holeId === h.id);
    if (!c || !h.path?.length || !Number.isFinite(c.z)) continue;
    if(appearance.modelPlacement && Number.isFinite(h.c?.z) && Math.abs(h.c.z-c.z)>.1){c.z=h.c.z;adjusted++;}
    paths[h.id] = h.path.map(p=>{
      const ll = project.latlon;
      const xy = ll ? [ll.lon0+p.x/(Math.cos(ll.lat0*Math.PI/180)*111320),ll.lat0+p.y/110540] : [p.x,p.y];
      return {depth:p.d,x:xy[0],y:xy[1],z:c.z+p.z-h.path[0].z};
    });
  }
  if(adjusted)warnings.push(adjusted+' collar(s) retain the model’s surface-adjusted display placement. Original source elevations are unchanged.');
  const envelopes=envelopeSources.map(s=>{
    const nested=Array.isArray(s.positions[0]),n=nested?s.positions.length:s.positions.length/3;
    if (!Number.isInteger(n)||n>200000||s.indices.length>1500000) throw new Error('The model envelope is too large for a tour. Simplify its source geometry first.');
    const vertices=[];
    for(let i=0;i<n;i++){
      const p=nested?s.positions[i]:[s.positions[i*3],s.positions[i*3+1],s.positions[i*3+2]];
      let x=p[0]+s.origin[0],y=p[1]+s.origin[1];const z=p[2]+s.origin[2],ll=project?.latlon;
      if(ll){x=ll.lon0+x/(Math.cos(ll.lat0*Math.PI/180)*111320);y=ll.lat0+y/110540;}
      vertices.push(x,y,z);
    }
    if(s.kind==='estimated')warnings.push(s.name+': reused exploratory model envelope; not a geological boundary or mineral resource.');
    else warnings.push('Included model shape: '+s.name+' (source geometry unchanged).');
    return {name:s.name,vertices,indices:Array.from(s.indices),color:s.color,opacity:s.opacity,kind:s.kind};
  });
  return { title: state.title || 'Project', crs: state.crs, claims, collars, surveys, assays: [...merged.values()],envelopes,appearance,
    paths,
    fields: [...fields], warnings, grade: { field: state.valueCol, unit: unitOf(state.valueLabel||'')||unitOf(state.valueCol||''), bins: [...state.bins],colors:appearance.gradeColors,includeBelow:!!appearance.gradeColors?.length,displayCutoff:appearance.displayCutoff },
    claimsLegend: 'Project claims' };
}
