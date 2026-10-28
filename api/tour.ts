import {createClient} from '@supabase/supabase-js';
import {handleMethods} from './_lib/guard.js';
import {renderHostedTour} from './_lib/tour-render';
import {MAX_TOUR_BYTES} from '../src/features/tour3d/package';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[0-9a-f]{32}$/;
const validInfo=(d:any)=>d===null||(d&&typeof d.id==='string'&&ID.test(d.id)&&Number.isInteger(d.revision)&&d.revision>0&&typeof d.updated_at==='string'&&Number.isFinite(Date.parse(d.updated_at)));
function clientForToken(token?:string){
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY;
  if(!url||!key)throw new Error('Not configured');
  // Never use the service role for these operations. RPCs run as the actual
  // signed-in user, or as anon for the deliberately public package read only.
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},...(token?{global:{headers:{Authorization:`Bearer ${token}`}}}:{})});
}
const unavailable='Hosted sharing is not enabled or temporarily unavailable. HTML download still works.';
export function createTourHandler(deps={clientForToken,render:renderHostedTour}){
  return async(req:any,res:any)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(handleMethods(req,res,['GET','POST']))return;
    const error=(status:number,message:string)=>res.status(status).json({error:message});
    const rpcError=(e:any)=>{
      if(['PGRST202','42883','42P01','PGRST204'].includes(e?.code))return error(503,unavailable);
      if(e?.code==='P0002'||/TOUR_NOT_FOUND/.test(e?.message||''))return error(404,'This saved figure is unavailable or you no longer have edit access.');
      if(/TOUR_STALE/.test(e?.message||''))return error(409,'The link changed. Refresh its status before publishing again.');
      if(/TOUR_RATE_LIMIT/.test(e?.message||'')){res.setHeader('Retry-After','10');return error(429,'Wait a few seconds before republishing.');}
      if(/TOUR_TOO_LARGE/.test(e?.message||''))return error(413,'This tour is too large for hosted sharing. Download the HTML instead.');
      if(/TOUR_INVALID/.test(e?.message||''))return error(400,'The tour package is invalid. Update the preview and try again.');
      if(e?.code==='42501')return error(403,'You do not have permission to publish this figure.');
      return error(503,unavailable);
    };
    try{
      const id=req.query?.id,projectQuery=req.query?.project;
      if(req.method==='GET'&&id!==undefined){
        if(typeof id!=='string'||!ID.test(id)||projectQuery!==undefined)return error(400,'Invalid tour link.');
        const {data,error:e}=await deps.clientForToken().rpc('get_3d_tour',{p_id:id});
        if(e)return rpcError(e);if(data===null)return error(404,'This tour was removed or is no longer available.');
        let rendered;try{rendered=deps.render(JSON.stringify(data));}catch{return error(503,'This published tour cannot be displayed.');}
        for(const [k,v] of Object.entries(rendered.headers))res.setHeader(k,v);
        return res.status(200).send(rendered.html);
      }
      const token=String(req.headers?.authorization||'').match(/^Bearer\s+(\S+)$/i)?.[1];
      if(!token)return error(401,'Sign in to manage tour sharing.');
      const sb=deps.clientForToken(token),auth=await sb.auth.getUser(token);
      if(auth.error||!auth.data?.user?.id)return error(401,'Your session is not valid. Sign in again.');
      res.setHeader('Vary','Authorization');
      if(req.method==='GET'){
        if(typeof projectQuery!=='string'||!UUID.test(projectQuery))return error(400,'Choose a saved 3D figure.');
        const {data,error:e}=await sb.rpc('get_3d_tour_info',{p_project:projectQuery});
        if(e)return rpcError(e);if(!validInfo(data))return error(503,unavailable);
        return res.status(200).json({tour:data});
      }
      if(Number(req.headers?.['content-length'])>MAX_TOUR_BYTES+2048)return error(413,'This tour is too large for hosted sharing.');
      let body=req.body;
      if(Buffer.isBuffer(body))body=body.toString('utf8');
      if(typeof body==='string'){
        if(Buffer.byteLength(body)>MAX_TOUR_BYTES+2048)return error(413,'This tour is too large for hosted sharing.');
        try{body=JSON.parse(body);}catch{return error(400,'Invalid JSON request.');}
      }
      if(!body||Array.isArray(body)||typeof body.project!=='string'||!UUID.test(body.project)||!['publish','revoke'].includes(body.action))return error(400,'Choose a saved 3D figure and sharing action.');
      if(body.action==='revoke'){
        const {data,error:e}=await sb.rpc('revoke_3d_tour',{p_project:body.project});
        if(e)return rpcError(e);if(typeof data!=='boolean')return error(503,unavailable);
        return res.status(200).json({revoked:data});
      }
      if(body.revision!==null&&(!Number.isInteger(body.revision)||body.revision<1))return error(400,'Refresh the link status before publishing.');
      let json:string;
      try{json=JSON.stringify(body.package);deps.render(json);}catch(e){return error(/size|too large/i.test(String((e as Error).message))?413:400,'This tour cannot be hosted. Update its preview or download HTML instead.');}
      const {data,error:e}=await sb.rpc('publish_3d_tour',{p_project:body.project,p_package:JSON.parse(json),p_expected_revision:body.revision});
      if(e)return rpcError(e);if(typeof data!=='string'||!ID.test(data))return error(503,unavailable);
      return res.status(200).json({id:data,revision:(body.revision??0)+1});
    }catch{return error(503,unavailable);}
  };
}
export default createTourHandler();
