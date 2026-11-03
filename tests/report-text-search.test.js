// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { library, canSearchReportText } from '../src/utils/propertyFiles.js';
import { searchReportText, REPORT_TEXT_MAX_BYTES } from '../src/utils/reportTextSearch.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encoder = new TextEncoder();
let bytes, rows, identity, calls, current, afterFetch, afterList;
const client = {
  auth: { getUser: async () => { calls.push('getUser'); return { data: { user: { id: identity } } }; } },
  rpc: async (fn, args) => { calls.push([fn,args]); afterList?.(); return { data: structuredClone(rows) }; },
  storage: { from: bucket => ({ createSignedUrl: async (path, expiry) => { calls.push(['sign',bucket,path,expiry]); return { data: { signedUrl:'https://private.example.test/read?token=synthetic' } }; } }) },
};
const row = (data, extra={}) => ({ id:'file-qa',name:'synthetic-report.md',kind:'document',version:2,path:'org/property/file/v2/qa.md',bytes:data.length,sha256:hash(data),...extra });
const snapshot = r => ({id:r.id,name:r.name,kind:r.kind,version:r.version,path:r.path,bytes:r.bytes,sha256:r.sha256});
const read = (file=snapshot(rows[0]), opts={}) => library(client).reportText('property',file,{userId:'viewer-qa',isCurrent:()=>current,...opts});
beforeEach(() => {
  bytes=encoder.encode('Synthetic report\nQA-17 is the supplied sample identifier.\n<img src=x onerror=alert(1)>\n');
  rows=[row(bytes)]; identity='viewer-qa'; calls=[]; current=true; afterFetch=null; afterList=null;
  vi.stubGlobal('fetch',vi.fn(async () => { afterFetch?.(); return new Response(bytes); }));
});
afterEach(()=>vi.unstubAllGlobals());

describe('literal report contents and snippets',()=>{
  it('matches contents, not filenames, with original line numbers and literal regex characters',()=>{
    expect(searchReportText('No occurrence here.','filename-only').total).toBe(0);
    const result=searchReportText('First\r\nUse [a-z]* literally\nOther [A-Z]* text','[a-z]*');
    expect(result.matches.map(h=>[h.line,h.match])).toEqual([[2,'[a-z]*'],[3,'[A-Z]*']]);
    expect(result.total).toBe(2);
  });
  it('bounds queries and snippet results without hiding the matching-line count',()=>{
    expect(()=>searchReportText('x',' ')).toThrow(/Enter text/);
    expect(()=>searchReportText('x','a'.repeat(201))).toThrow(/200/);
    const result=searchReportText(Array.from({length:60},()=>`${'a'.repeat(400)} TARGET ${'z'.repeat(400)}`).join('\n'),'target');
    expect(result).toMatchObject({total:60,capped:true}); expect(result.matches).toHaveLength(50);
    expect(result.matches[0].before.length).toBeLessThan(75); expect(result.matches[0].after.length).toBeLessThan(105);
  });
});

describe('actual private-library report read',()=>{
  it('lets an existing viewer read only the selected current version and retains hash provenance',async()=>{
    const report=await read();
    expect(report.text).toContain('QA-17'); expect(report.source).toEqual(snapshot(rows[0]));
    expect(calls.filter(c=>c==='getUser')).toHaveLength(2);
    expect(calls.filter(c=>Array.isArray(c)&&c[0]==='list_property_files')).toEqual([['list_property_files',{p_property:'property'}],['list_property_files',{p_property:'property'}]]);
    expect(calls).toContainEqual(['sign','property-files',rows[0].path,60]);
    expect(fetch.mock.calls[0][1]).toMatchObject({cache:'no-store',credentials:'omit',redirect:'error'});
    expect(report).not.toHaveProperty('signedUrl');
  });
  it('only offers Markdown and explicitly document-classified text, not CSV/PDF/Word',async()=>{
    expect(canSearchReportText(rows[0])).toBe(true);
    expect(canSearchReportText({...rows[0],name:'qa.txt'})).toBe(true);
    for(const [name,kind] of [['qa.txt','drill'],['qa.pdf','document'],['qa.docx','document'],['qa.csv','document']]) {
      const file=snapshot({...rows[0],name,kind});
      expect(canSearchReportText(file)).toBe(false);
      await expect(read(file)).rejects.toThrow(/\.md and \.txt/);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses oversized/unknown-hash metadata before signing or downloading',async()=>{
    await expect(read({...snapshot(rows[0]),bytes:REPORT_TEXT_MAX_BYTES+1})).rejects.toThrow(/2 MiB/);
    await expect(read({...snapshot(rows[0]),sha256:null})).rejects.toThrow(/changed/);
    expect(fetch).not.toHaveBeenCalled(); expect(calls.filter(c=>Array.isArray(c)&&c[0]==='sign')).toHaveLength(0);
  });
  it('cancels oversized streams even when recorded metadata is falsely small',async()=>{
    const cancel=vi.fn(); let sent=false;
    vi.mocked(fetch).mockImplementation(async()=>new Response(new ReadableStream({pull(controller){if(!sent){sent=true;controller.enqueue(new Uint8Array(REPORT_TEXT_MAX_BYTES+1));}},cancel})));
    await expect(read()).rejects.toThrow(/size changed|limit/); expect(cancel).toHaveBeenCalled();
  });
  it('rejects excessive Content-Length without consuming body chunks',async()=>{
    const cancel=vi.fn(); let reads=0;
    vi.mocked(fetch).mockImplementation(async()=>new Response(new ReadableStream({pull(){reads++;},cancel}),{headers:{'content-length':String(REPORT_TEXT_MAX_BYTES+1)}}));
    await expect(read()).rejects.toThrow(/size changed|limit/); expect(cancel).toHaveBeenCalled(); expect(reads).toBeLessThanOrEqual(1);
  });
  it('rejects actual size/hash mismatches, invalid UTF-8 and binary control bytes',async()=>{
    for (const data of [encoder.encode('short'),encoder.encode('x'.repeat(bytes.length))]) {
      vi.mocked(fetch).mockResolvedValue(new Response(data));
      await expect(read()).rejects.toThrow(/recorded size|recorded hash/);
    }
    for (const [data,message] of [[Uint8Array.of(255),/UTF-8/],[Uint8Array.of(65,0,66),/binary control/]]) {
      rows=[row(data)]; vi.mocked(fetch).mockResolvedValue(new Response(data));
      await expect(read()).rejects.toThrow(message);
    }
  });
  it('never falls back to an unbounded read when streaming is unavailable',async()=>{
    vi.mocked(fetch).mockResolvedValue({ok:true,body:null});
    await expect(read()).rejects.toThrow(/current access/);
  });
  it('does not expose signed URLs, tokens or arbitrary transport/server details in errors',async()=>{
    vi.mocked(fetch).mockRejectedValue(new Error('Private bytes or https://private.example.test/read?token=secret-token'));
    await expect(read()).rejects.toThrow('The report could not be searched. Reopen its current version and try again.');
    try { await read(); } catch(error) { expect(error.message).not.toMatch(/secret-token|https:|Private bytes/); }
  });
  it('fails on account/request changes before and after the asynchronous read',async()=>{
    identity='other-user'; await expect(read()).rejects.toThrow(/changed/); expect(fetch).not.toHaveBeenCalled();
    identity='viewer-qa'; afterFetch=()=>{identity='other-user';}; await expect(read()).rejects.toThrow(/changed/);
    identity='viewer-qa'; afterFetch=()=>{current=false;}; await expect(read()).rejects.toThrow(/changed/);
  });
  it('refuses stale, deleted or newly versioned files both before and after fetching',async()=>{
    const file=snapshot(rows[0]); rows=[]; await expect(read(file)).rejects.toThrow(/changed/); expect(fetch).not.toHaveBeenCalled();
    for (const change of [()=>{rows=[];},()=>{rows=[{...rows[0],version:3,path:'org/property/file/v3/qa.md'}];}]) {
      rows=[row(bytes)]; afterFetch=change; await expect(read(file)).rejects.toThrow(/changed/);
    }
  });
});
