import {createTourSharingClient,hostedTourUrl} from './sharingClient';

async function accountServices(){
  const account=await import('../../three-d/account-core');
  const sb=await account.client();
  return {
    getContext:account.tourSharingContext,
    getSession:async()=>{const {data,error}=await sb.auth.getSession();if(error)throw error;return data.session;},
    subscribe:callback=>sb.auth.onAuthStateChange(event=>{if(event!=='TOKEN_REFRESHED'&&event!=='INITIAL_SESSION')callback();}).data.subscription,
  };
}

export function mountTourSharing(host,{getPackage,services=accountServices}){
  host.innerHTML='<details><summary>Share a hosted tour</summary><p class="muted">Publishing makes this tour’s included claims, drilling and envelopes accessible to anyone with the link. Changes in the model do not update the link until you republish.</p><button class="btn tour-share-check" type="button">Check sharing availability</button><p class="tour-share-status" role="status"></p><label><span><input class="tour-share-consent" type="checkbox"> I want to make the preview data accessible through a public link</span></label><button class="btn tour-share-publish" type="button" disabled>Publish preview</button><div class="tour-share-link" hidden><label>Public tour link<input readonly></label><a target="_blank" rel="noopener noreferrer">Open published tour</a><label>Embed code<textarea readonly rows="3"></textarea></label><button class="btn tour-share-revoke" type="button">Revoke link</button></div></details>';
  const $=s=>host.querySelector(s),check=$('.tour-share-check'),publish=$('.tour-share-publish'),revoke=$('.tour-share-revoke'),consent=$('input[type=checkbox]'),status=$('[role=status]'),link=$('.tour-share-link');
  let client=null,subscription=null,info=null,ready=false,busy=false,closed=false,invalid=false;
  const controls=()=>{check.disabled=busy||invalid;publish.disabled=busy||!ready||invalid||!consent.checked||!getPackage();revoke.disabled=busy||!info||invalid;publish.textContent=info?'Republish preview':'Publish preview';};
  function display(){
    link.hidden=!info;
    if(info){const url=hostedTourUrl(info.id);$('input[readonly]').value=url;$('a').href=url;$('textarea').value=`<iframe src="${url}" title="3D project tour" width="100%" height="640" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy"></iframe>`;}
    else{$('input[readonly]').value='';$('a').removeAttribute('href');$('textarea').value='';}
    controls();
  }
  function invalidate(){
    if(closed)return;invalid=true;ready=false;info=null;consent.checked=false;client?.close();display();status.textContent='The account or saved figure changed. Reopen the Tour dialog to manage sharing.';
  }
  async function connect(){
    if(client)return;
    const s=await services();if(closed)return;
    client=createTourSharingClient(s);subscription=s.subscribe?.(invalidate);
  }
  async function run(task){
    if(busy||closed||invalid)return;busy=true;controls();
    try{await connect();if(closed||invalid)return;await task();}
    catch(e){if(closed)return;if(e.code==='CONTEXT_CHANGED'||[401,403,404].includes(e.status))invalidate();else{if(e.status===409)ready=false;status.textContent=e.message||'Sharing unavailable. HTML download still works.';}}
    finally{busy=false;if(!closed)controls();}
  }
  check.onclick=()=>run(async()=>{info=await client.status();if(closed||invalid)return;ready=true;display();status.textContent=info?'A published tour is available. Republish to replace it with this preview.':'No active link. Update the preview, then publish when ready.';});
  publish.onclick=()=>run(async()=>{
    const pkg=getPackage();if(!pkg||!consent.checked)throw new Error('Update the preview and confirm public sharing first.');
    const result=await client.publish(pkg,info?.revision??null);if(closed||invalid)return;
    info={id:result.id,revision:result.revision};consent.checked=false;display();status.textContent='Tour published. Anyone with the link can view this version until you revoke it.';
  });
  revoke.onclick=()=>run(async()=>{await client.revoke();if(closed||invalid)return;info=null;consent.checked=false;display();status.textContent='Link revoked. Publishing again creates a new link.';});
  consent.onchange=controls;
  display();
  return {refresh:controls,close:()=>{closed=true;client?.close();subscription?.unsubscribe();}};
}
