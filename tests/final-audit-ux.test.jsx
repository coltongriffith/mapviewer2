import React, { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import UploadPanel, { groupUploadFiles } from '../src/components/UploadPanel.jsx';
import AddClaimsModal from '../src/components/AddClaimsModal.jsx';
vi.mock('../src/components/RegistrySearch', () => ({ default: () => <input aria-label="Registry search" /> }));
const file = (name) => new File(['synthetic'], name);
afterEach(() => vi.restoreAllMocks());
describe('ordered upload selection', () => {
  it('keeps every independent file and paired source set in first selection order', () => {
    const files = ['first.geojson','claims.dbf','grid.pgw','claims.shp','second.kml','grid.png','claims.prj','last.csv'].map(file);
    const groups = groupUploadFiles(files);
    expect(groups.map((g) => g.kind)).toEqual(['file','shapefile','raster','file','file']);
    expect(groups.map((g) => g.files.map((f) => f.name))).toEqual([['first.geojson'],['claims.dbf','claims.shp','claims.prj'],['grid.pgw','grid.png'],['second.kml'],['last.csv']]);
    expect(groups.flatMap((g) => g.files)).toHaveLength(files.length);
    expect(groups[1].files[1]).toBe(files[3]);
  });
  it('refuses duplicate or ambiguous sources before beginning a partial import', () => {
    expect(() => groupUploadFiles(['A.geojson','a.geojson'].map(file))).toThrow(/same name/);
    expect(() => groupUploadFiles(['grid.png','grid.jpg','grid.wld'].map(file))).toThrow(/matching/);
    expect(() => groupUploadFiles(['grid.png','grid.pgw','grid.wld'].map(file))).toThrow(/matching/);
  });
  it.each(['picker','drop'])('passes all five selected files once through the %s path', async (method) => {
    const onUploadFile = vi.fn(), onUploadFiles = vi.fn();
    function Harness() { const ref = useRef(); return <UploadPanel inputRef={ref} onUploadFile={onUploadFile} onUploadFiles={onUploadFiles} />; }
    const { container } = render(<Harness />); const files = Array.from({length:5}, (_, i) => file(`layer-${i}.geojson`));
    if (method === 'picker') fireEvent.change(container.querySelector('input[type=file]'), { target: { files } });
    else fireEvent.drop(screen.getByRole('button', { name: /^Upload shapefile/ }), { dataTransfer: { files } });
    await waitFor(() => expect(onUploadFiles).toHaveBeenCalledExactlyOnceWith(files));
    expect(onUploadFile).not.toHaveBeenCalled();
  });
});
describe('claims keyboard dialog', () => {
  it('has a changing accessible name, traps focus, and returns focus on Escape', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width:100, height:30, top:0, left:0, right:100, bottom:30 });
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
    function Harness() { const [open,setOpen]=useState(false); return <><button onClick={()=>setOpen(true)}>Add claims</button>{open && <AddClaimsModal onClose={()=>setOpen(false)} onImport={()=>{}} />}</>; }
    render(<Harness />); const invoker = screen.getByRole('button', {name:'Add claims'}); invoker.focus(); fireEvent.click(invoker);
    const dialog=screen.getByRole('dialog', {name:'Add Claims'}); expect(dialog.contains(document.activeElement)).toBe(true);
    const buttons=dialog.querySelectorAll('button'); buttons[buttons.length-1].focus(); fireEvent.keyDown(document,{key:'Tab'}); expect(document.activeElement).toBe(buttons[0]);
    fireEvent.click(screen.getByRole('button',{name:/Search Claims Registry/}));
    expect(screen.getByRole('dialog',{name:'Claims Registry Search'})).toBeTruthy();
    fireEvent.keyDown(document,{key:'Escape'}); await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(()=>expect(document.activeElement).toBe(invoker));
  });
});
it('explicitly associates all seven native 3D range labels with their sliders', () => {
  const html=readFileSync('3d/index.html','utf8'); const doc=new DOMParser().parseFromString(html,'text/html');
  for(const id of ['cam-az','cam-pl','cam-zoom','vex','trace-w','surf','sec-az']) {
    const input=doc.getElementById(id); expect(input.type).toBe('range');
    const label=doc.querySelector(`label[for="${id}"]`); expect(label.control).toBe(input); expect([...input.labels]).toContain(label);
  }
});
