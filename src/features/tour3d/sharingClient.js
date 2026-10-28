// Same-origin transport only. Session contents are a UI guard; the endpoint
// verifies the JWT and database RPCs enforce current owner/editor permission.
const ID=/^[0-9a-f]{32}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES=3*1024*1024;
const unavailable='Hosted sharing is not enabled or temporarily unavailable. HTML download still works.';
const changed=()=>Object.assign(new Error('The account or saved figure changed. Reopen tour sharing.'),{code:'CONTEXT_CHANGED'});
const validInfo=d=>d===null||(d&&typeof d.id==='string'&&ID.test(d.id)&&Number.isInteger(d.revision)&&d.revision>0&&typeof d.updated_at==='string'&&Number.isFinite(Date.parse(d.updated_at)));

export const hostedTourUrl=id=>{
  if(typeof id!=='string'||!ID.test(id))throw new Error('Invalid tour link.');
  return `https://www.explorationmaps.com/tour/${id}`;
};

export function createTourSharingClient({getContext,getSession,fetch:send=globalThis.fetch}){
  const start={...getContext()};let uid=null,closed=false;
  const pending=new Set();
  function check(){
    const now=getContext();
    if(closed||now.project!==start.project||now.epoch!==start.epoch||now.readOnly!==start.readOnly)throw changed();
    if(start.readOnly)throw new Error('This figure is read-only. Open its editable saved figure to manage sharing.');
    if(typeof start.project!=='string'||!UUID.test(start.project))throw new Error('Save this 3D figure to your account before sharing.');
  }
  async function session(){
    check();const s=await getSession();check();
    if(!s?.user?.id||!s.access_token){
      if(uid)throw changed();
      throw new Error('Sign in to manage tour sharing.');
    }
    if(uid&&s.user.id!==uid)throw changed();uid=s.user.id;return s;
  }
  async function request(action,body){
    const s=await session(),controller=new AbortController();pending.add(controller);
    try{
      const response=await send(action==='status'?`/api/tour?project=${encodeURIComponent(start.project)}`:'/api/tour',{
        method:action==='status'?'GET':'POST',cache:'no-store',credentials:'omit',signal:controller.signal,
        headers:{Authorization:`Bearer ${s.access_token}`,...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify({...body,project:start.project,action})}:{}),
      });
      const data=await response.json();await session();
      if(!response.ok){
        const messages={401:'Sign in again to manage tour sharing.',403:'You no longer have permission to share this figure.',404:'The saved figure is unavailable or you no longer have edit access.',409:'The link changed. Refresh its status before publishing again.',413:'This tour is too large for hosted sharing. Download HTML instead.',429:'Wait a few seconds before republishing.',503:unavailable};
        throw Object.assign(new Error(messages[response.status]||'Tour sharing failed. Try again; HTML download still works.'),{status:response.status});
      }
      if(action==='status'&&!validInfo(data?.tour))throw new Error(unavailable);
      if(action==='publish'&&(!data||typeof data.id!=='string'||!ID.test(data.id)||data.revision!==(body.revision??0)+1))throw new Error(unavailable);
      if(action==='revoke'&&typeof data?.revoked!=='boolean')throw new Error(unavailable);
      return action==='status'?data.tour:data;
    }catch(e){
      check();if(e.code==='CONTEXT_CHANGED'||e.status)throw e;
      // Do not expose arbitrary response bodies, URLs or bearer tokens.
      throw new Error(unavailable);
    }finally{pending.delete(controller);}
  }
  return {
    status:()=>request('status'),
    publish:(pkg,revision)=>{
      check();
      if(revision!==null&&(!Number.isInteger(revision)||revision<1))throw new Error('Refresh the link status before publishing.');
      if(new TextEncoder().encode(JSON.stringify(pkg)).byteLength>MAX_BYTES)throw new Error('This tour is too large for hosted sharing. Download HTML instead.');
      return request('publish',{package:pkg,revision});
    },
    revoke:()=>request('revoke',{}),
    close:()=>{closed=true;for(const c of pending)c.abort();pending.clear();},
  };
}
