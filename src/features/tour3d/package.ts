import type { TourPackage } from './types';

// Boundary for future hosted publishing: accept data, never uploaded HTML.
// Keep this independent of the renderer and DB so both upload and read can check it.
// Leave room for the trusted viewer under the Function's 4.5 MB response cap.
export const MAX_TOUR_BYTES = 3 * 1024 * 1024;
export function parseTourPackage(json: string): TourPackage {
  const fail = (field: string): never => { throw new Error('Invalid tour package: '+field); };
  if (typeof json !== 'string' || json.length > MAX_TOUR_BYTES || new TextEncoder().encode(json).length > MAX_TOUR_BYTES) fail('size');
  let data: unknown;
  try { data = JSON.parse(json); } catch { return fail('JSON'); }
  const object = (x: any, keys: string[], field: string) => {
    if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(k=>!keys.includes(k))) fail(field);
    return x;
  };
  const array = (x: any, min: number, max: number, field: string): any[] => {
    if (!Array.isArray(x) || x.length < min || x.length > max) fail(field);
    return x;
  };
  const number = (x: any, min: number, max: number, field: string) => {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) fail(field);
    return x as number;
  };
  const integer = (x: any, min: number, max: number, field: string) => {
    if (!Number.isInteger(number(x,min,max,field))) fail(field);
  };
  const text = (x: any, max: number, field: string) => { if (typeof x !== 'string' || x.length > max) fail(field); };
  const bool = (x: any, field: string) => { if (typeof x !== 'boolean') fail(field); };
  const colour = (x:any,field:string) => { if(typeof x!=='string'||!/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(x))fail(field); };
  let vertices = 0;
  const coordinates = (x: any, dimension: number, min: number, field: string) => {
    const points = array(x,min*dimension,3000000,field);
    if (points.length % dimension || (vertices += points.length/dimension) > 1000000) fail('geometry budget');
    points.forEach(p=>number(p,-1000000,1000000,field));
  };
  const d = object(data,['v','holes','runs','claims','fpoly','collars','terrain','config','meta','envelopes'],'root');
  if (d.v !== 1) fail('version');
  const holes = array(d.holes,1,5000,'holes');
  holes.forEach(h=>{
    object(h,['n','yr','pv','sm','p'],'hole'); text(h.n,256,'hole name');
    if (h.yr != null) integer(h.yr,0,9999,'year');
    bool(h.pv,'provisional');bool(h.sm,'target');coordinates(h.p,3,2,'hole path');
  });
  const config = object(d.config,['title','tag','tabs','legend','bins','labels','imagery','traceColor','primary','accent','claimColors'],'config');
  for(const k of ['traceColor','primary','accent'])if(config[k]!=null)colour(config[k],k);
  text(config.title,500,'title');text(config.tag,500,'tag');
  array(config.tabs,3,3,'tabs').forEach(t=>array(t,2,2,'tab').forEach(s=>text(s,500,'tab text')));
  const legend = object(config.legend,['claims','holes','grade'],'legend');
  ['claims','holes','grade'].forEach(k=>text(legend[k],500,'legend'));
  const bins = array(config.bins,1,8,'bins');
  bins.forEach(b=>{
    array(b,2,2,'bin');text(b[0],128,'bin label');
    colour(b[1],'bin colour');
  });
  // Hosted viewers must not fetch arbitrary URLs supplied by an uploaded package.
  if (config.imagery != null && config.imagery !== 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}') fail('imagery source');
  array(config.labels,0,10000,'labels').forEach(l=>{
    object(l,['t','x','z','fp','views','below'],'label');text(l.t,500,'label text');
    for (const k of ['x','z']) if (l[k] != null) number(l[k],-1000000,1000000,'label position');
    for (const k of ['fp','below']) if (l[k] != null) bool(l[k],'label option');
    array(l.views,1,3,'label views').forEach(v=>integer(v,0,2,'label view'));
  });
  array(d.runs,0,200000,'runs').forEach(r=>{
    array(r,3,3,'run');integer(r[0],0,holes.length-1,'run hole');coordinates(r[1],3,2,'run path');integer(r[2],0,bins.length-1,'run bin');
  });
  for (const k of ['claims','fpoly']) array(d[k],0,10000,k).forEach(r=>coordinates(r,2,3,k));
  if(config.claimColors!=null)array(config.claimColors,d.claims.length,d.claims.length,'claim colours').forEach(c=>colour(c,'claim colour'));
  let meshVertices=0,triangles=0;
  for(const e of array(d.envelopes??[],0,32,'envelopes')){
    object(e,['name','vertices','indices','color','opacity','kind'],'envelope');text(e.name,500,'envelope name');
    coordinates(e.vertices,3,3,'envelope vertices');meshVertices+=e.vertices.length/3;
    if(meshVertices>200000)fail('envelope vertex budget');
    if(e.vertices.some((p:number)=>Math.abs(p)>200000))fail('envelope extent');
    const indices=array(e.indices,3,1500000,'envelope indices');triangles+=indices.length/3;
    if(indices.length%3||triangles>500000)fail('envelope triangle budget');
    indices.forEach(i=>integer(i,0,e.vertices.length/3-1,'envelope index'));
    colour(e.color,'envelope colour');number(e.opacity,0,1,'envelope opacity');
    if(!['supplied','estimated'].includes(e.kind))fail('envelope source');
  }
  array(d.collars,holes.length,holes.length,'collars').forEach(c=>{
    array(c,4,4,'collar');c.slice(0,3).forEach((p:any)=>number(p,-1000000,1000000,'collar position'));integer(c[3],0,1,'collar target');
  });
  const targets=d.collars.filter((c:any)=>c[3]===1);
  if (!targets.length || !holes.some((h:any)=>h.sm)) fail('target bounds');
  const t = object(d.terrain,['utm','corners','step','demZoom','imgZoom','detailZoom','detailR'],'terrain');
  array(t.utm,4,4,'extent').forEach(p=>number(p,-1000000,1000000,'extent'));
  const width=t.utm[2]-t.utm[0],height=t.utm[3]-t.utm[1];
  if (width <= 0 || height <= 0 || width > 200000 || height > 200000) fail('extent');
  if (d.collars.some((c:any)=>c[0]<t.utm[0]-1 || c[0]>t.utm[2]+1 || c[2]<t.utm[1]-1 || c[2]>t.utm[3]+1)) fail('collar extent');
  number(t.step,1,10000,'terrain step');
  const nx=Math.round(width/t.step)+1,nz=Math.round(height/t.step)+1;
  if (nx<2 || nz<2 || nx*nz > 250000 || nx*nz*holes.length > 50000000) fail('terrain budget');
  if (Math.round(4096*height/width)<1 || Math.round(4096*height/width)>8192) fail('imagery canvas budget');
  array(t.corners,4,4,'corners').forEach(c=>{array(c,2,2,'corner');number(c[0],-180,180,'longitude');number(c[1],-85,85,'latitude');});
  integer(t.demZoom,9,14,'DEM zoom');integer(t.imgZoom,9,16,'imagery zoom');integer(t.detailZoom,9,16,'detail zoom');number(t.detailR,1,2500,'detail radius');
  // Bounding coordinates alone do not bound tile work: an extreme zoom or
  // contradictory geographic corners could otherwise schedule millions of images.
  const lon=t.corners.map((c:any)=>c[0]),lat=t.corners.map((c:any)=>c[1]);
  const mercatorY=(a:number)=>{const r=a*Math.PI/180;return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2;};
  const [sw,,nw,ne]=t.corners;
  const determinant=(ne[0]-nw[0])*(mercatorY(sw[1])-mercatorY(nw[1]))-(sw[0]-nw[0])*(mercatorY(ne[1])-mercatorY(nw[1]));
  if (Math.abs(determinant)<1e-12) fail('degenerate imagery projection');
  for (const z of [t.demZoom,t.imgZoom]) {
    const n=2**z;
    const nx=Math.floor((Math.max(...lon)+180)/360*n)-Math.floor((Math.min(...lon)+180)/360*n)+1;
    const ny=Math.floor(mercatorY(Math.min(...lat))*n)-Math.floor(mercatorY(Math.max(...lat))*n)+1;
    if (nx*ny > 512) fail('tile budget');
  }
  // Match the viewer's actual bilinear extrapolation around the target collar
  // box. Metres-per-pixel estimates miss malicious or inconsistent corners.
  const cx=(Math.min(...targets.map((c:any)=>c[0]))+Math.max(...targets.map((c:any)=>c[0])))/2;
  const cz=(Math.min(...targets.map((c:any)=>c[2]))+Math.max(...targets.map((c:any)=>c[2])))/2;
  const detail=[];
  for (const x of [cx-t.detailR,cx+t.detailR]) for (const z of [cz-t.detailR,cz+t.detailR]) {
    const u=(x-t.utm[0])/width,v=1-(z-t.utm[1])/height;
    const p=[0,1].map(k=>(1-u)*(1-v)*t.corners[0][k]+u*(1-v)*t.corners[1][k]+(1-u)*v*t.corners[2][k]+u*v*t.corners[3][k]);
    number(p[0],-180,180,'detail longitude');number(p[1],-85,85,'detail latitude');detail.push(p);
  }
  const dn=2**t.detailZoom,dx=detail.map(p=>(p[0]+180)/360*dn),dy=detail.map(p=>mercatorY(p[1])*dn);
  if ((Math.floor(Math.max(...dx))-Math.floor(Math.min(...dx))+1)*(Math.floor(Math.max(...dy))-Math.floor(Math.min(...dy))+1)>1024) fail('detail tile budget');
  const m=object(d.meta,['origin','crs','holes','built','warnings'],'metadata');
  array(m.origin,3,3,'origin').forEach(p=>number(p,-100000000,100000000,'origin'));text(m.crs,2048,'CRS');
  if (m.holes !== holes.length) fail('hole count');
  text(m.built,64,'built date');if (!Number.isFinite(Date.parse(m.built))) fail('built date');
  array(m.warnings,0,10000,'warnings').forEach(w=>text(w,1000,'warning'));
  return d as TourPackage;
}
