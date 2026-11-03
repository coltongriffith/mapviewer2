import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe,it,expect,vi } from 'vitest';
import ReportTextSearch from '../src/components/workspace/ReportTextSearch.jsx';

const file={id:'qa',name:'filename-only.md',kind:'document',version:2,sha256:'a'.repeat(64)};
const props=(lib,extra={})=>({file,propertyId:'property-qa',userId:'viewer-qa',lib,isCurrent:()=>true,onClose:vi.fn(),...extra});
async function submit(query='QA-17') {
  fireEvent.change(screen.getByRole('searchbox',{name:'Text to find'}),{target:{value:query}});
  fireEvent.click(screen.getByRole('button',{name:'Find in text'}));
}
describe('contextual report content search',()=>{
  it('keeps the submitted query fixed while reading and allows edits after completion',async()=>{
    let finish; const lib={reportText:vi.fn(()=>new Promise(resolve=>{finish=resolve;}))};
    render(<ReportTextSearch {...props(lib)}/>); await submit();
    const input=screen.getByRole('searchbox',{name:'Text to find'});
    expect(input).toBeDisabled(); expect(input).toHaveValue('QA-17');
    expect(screen.getByRole('button',{name:'Close text search'})).toBeEnabled();
    await act(async()=>finish({text:'QA-17 supplied identifier',source:file}));
    expect(input).toBeEnabled(); expect(screen.getByRole('status')).toHaveTextContent('1 matching line');
    fireEvent.change(input,{target:{value:'other'}});
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('reads only after explicit search and renders malicious report content as inert text',async()=>{
    const lib={reportText:vi.fn(async()=>({text:'Header\n<img src=x onerror=alert(1)> QA-17 <script>bad()</script>',source:file}))};
    const {container}=render(<ReportTextSearch {...props(lib)}/>);
    expect(lib.reportText).not.toHaveBeenCalled();
    await submit(); await screen.findByRole('status');
    expect(screen.getByText('Line 2:')).toBeVisible();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img,script')).toBeNull();
    expect(container.textContent).toContain(file.sha256); expect(container.textContent).toContain('v2');
  });
  it('shows no results for a filename match absent from the actual report text',async()=>{
    const lib={reportText:vi.fn(async()=>({text:'Unrelated report contents.',source:file}))};
    render(<ReportTextSearch {...props(lib)}/>); await submit('filename-only');
    expect(await screen.findByRole('status')).toHaveTextContent('No matching lines in this report.');
  });
  it('keeps arbitrary read exceptions and signed tokens out of the rendered error',async()=>{
    const lib={reportText:vi.fn(async()=>{throw new Error('https://private.example/read?token=secret-token private report bytes');})};
    const {container}=render(<ReportTextSearch {...props(lib)}/>); await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('The report could not be searched.');
    expect(container.textContent).not.toMatch(/secret-token|https:|private report bytes/);
  });
  it('does not commit a late result after account/property/file context changes',async()=>{
    let finish; const lib={reportText:vi.fn(()=>new Promise(resolve=>{finish=resolve;}))};
    const {rerender}=render(<ReportTextSearch {...props(lib)}/>); await submit();
    rerender(<ReportTextSearch {...props(lib,{userId:'other-user',propertyId:'other-property',file:{...file,version:3}})}/>);
    await act(async()=>finish({text:'Private QA-17 old result',source:file}));
    expect(screen.queryByRole('status')).toBeNull(); expect(screen.queryByText(/Private QA-17/)).toBeNull();
  });
  it('aborts the local request and suppresses late content when the search closes',async()=>{
    let finish,signal; const lib={reportText:vi.fn((_p,_f,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});})};
    const {unmount}=render(<ReportTextSearch {...props(lib)}/>); await submit(); unmount();
    expect(signal.aborted).toBe(true); await act(async()=>finish({text:'Old QA-17',source:file}));
  });
  it('suppresses stale completion on a same-account reload without a context prop change',async()=>{
    let finish,current=true; const lib={reportText:vi.fn(()=>new Promise(resolve=>{finish=resolve;}))};
    render(<ReportTextSearch {...props(lib,{isCurrent:()=>current})}/>); await submit(); current=false;
    await act(async()=>finish({text:'Old QA-17',source:file}));
    await waitFor(()=>expect(screen.queryByRole('status')).toBeNull());
  });
});
