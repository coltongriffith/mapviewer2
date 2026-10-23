import { it, expect, vi } from 'vitest';
import { certificateError, drillCertificates } from '../src/utils/drillCertificates';

it('recognizes missing migrations without hiding other failures',()=>{
  expect(certificateError({code:'PGRST202',message:'missing function'}).message).toContain('Assay imports still work');
  expect(certificateError({message:'Network timeout'}).message).toBe('Network timeout');
});
it('rechecks pinned visible version before signing, and refuses soft-deleted paths',async()=>{
  const sign = vi.fn().mockResolvedValue({data:{signedUrl:'https://signed.test'}});
  const sb = { rpc:vi.fn().mockResolvedValue({data:[{file_id:'f',version:1,name:'lab.pdf',storage_path:'v1/path'}]}),storage:{from:()=>({createSignedUrl:sign})}};
  const api=drillCertificates(sb);
  expect(await api.download('b','f',1)).toBe('https://signed.test');
  expect(sign).toHaveBeenCalledWith('v1/path',300,{download:'lab.pdf'});
  sb.rpc.mockResolvedValue({data:[{file_id:'f',version:1,name:'lab.pdf',storage_path:null}]});
  await expect(api.download('b','f',1)).rejects.toThrow('no longer available');
  expect(sign).toHaveBeenCalledOnce();
});
it('does not report a retracted duplicate as successfully attached',async()=>{
  const sb={rpc:vi.fn().mockResolvedValue({data:[{file_id:'f',version:1,retracted_at:'now'}]}),from:()=>({insert:async()=>({error:{code:'23505'}})})};
  await expect(drillCertificates(sb).attach('b','f',1)).rejects.toThrow('was retracted');
  sb.rpc.mockResolvedValue({data:[]});
  await expect(drillCertificates(sb).attach('b','f',1)).rejects.toThrow('could not be verified');
  sb.rpc.mockResolvedValue({data:[{file_id:'f',version:1,retracted_at:null}]});
  await expect(drillCertificates(sb).attach('b','f',1)).resolves.toBeUndefined();
});
