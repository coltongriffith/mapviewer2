import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
import QaqcImporter from '../src/components/workspace/QaqcImporter';
import QaqcPanel from '../src/components/workspace/QaqcPanel';
const { api } = vi.hoisted(() => ({api:{importQaqc:vi.fn(),listQaqcRecords:vi.fn(),listQaqcBatches:vi.fn(),rollbackQaqc:vi.fn()}}));
vi.mock('../src/utils/drillQaqcDb',async original=>({...(await original()),...api}));
vi.mock('../src/utils/propertyFiles',()=>({sha256Hex:async()=> 'a'.repeat(64)}));
vi.mock('../src/lib/supabase',()=>({supabase:null}));
const counts={ok:true,new:1,changed:0,unchanged:0};
beforeEach(()=>{vi.resetAllMocks(); api.importQaqc.mockResolvedValue(counts); api.listQaqcRecords.mockResolvedValue({rows:[],next:null}); api.listQaqcBatches.mockResolvedValue({rows:[],next:null});});
async function file() {
  fireEvent.change(screen.getByLabelText('QA/QC data file'),{target:{files:[{name:'synthetic.csv',size:70,arrayBuffer:async()=>new ArrayBuffer(0),text:async()=> 'lab_id,lab_batch_id,sample_id,sample_type,Au\nLab,Job,00001,routine,0.005'}]}});
  await screen.findByRole('form',{name:'Map QA/QC columns'});
  fireEvent.click(screen.getByRole('checkbox',{name:'Au',exact:true}));
  fireEvent.change(screen.getByLabelText('Unit for Au'),{target:{value:'g/t'}});
}
it('invalidates reviewed preview when units change and reuses one UUID after uncertain commit',async()=>{
  const saved=vi.fn(); render(<QaqcImporter client={{}} propertyId="prop" onSaved={saved} />); await file();
  fireEvent.click(screen.getByRole('button',{name:'Check QA/QC import'})); await screen.findByRole('button',{name:'Commit QA/QC import'});
  fireEvent.change(screen.getByLabelText('Unit for Au'),{target:{value:'ppm'}});
  expect(screen.queryByRole('button',{name:'Commit QA/QC import'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Check QA/QC import'})); await screen.findByRole('button',{name:'Commit QA/QC import'});
  api.importQaqc.mockRejectedValueOnce(new Error('Network outcome unknown')).mockResolvedValueOnce({...counts,committed:true,replayed:true});
  fireEvent.click(screen.getByRole('button',{name:'Commit QA/QC import'})); await screen.findByText('Network outcome unknown');
  const first=api.importQaqc.mock.calls.at(-1)[4];
  fireEvent.click(screen.getByRole('button',{name:'Commit QA/QC import'})); await screen.findByText('Previous import confirmed: 1 new, 0 changed, 0 unchanged.');
  expect(api.importQaqc.mock.calls.at(-1)[4].batchId).toBe(first.batchId); expect(first.batchId).toBeTruthy();
  expect(api.importQaqc.mock.calls.at(-1)[3][0]).toMatchObject({sample_id:'00001',units:{Au:'ppm'},raw_values:{Au:'0.005'}});
  expect(saved).toHaveBeenCalledOnce();
});
it('does not report an already rolled-back retry as a successful import',async()=>{
  const saved=vi.fn(); render(<QaqcImporter client={{}} propertyId="prop" onSaved={saved} />); await file();
  fireEvent.click(screen.getByRole('button',{name:'Check QA/QC import'})); await screen.findByRole('button',{name:'Commit QA/QC import'});
  api.importQaqc.mockResolvedValue({...counts,committed:true,replayed:true,rolled_back:true});
  fireEvent.click(screen.getByRole('button',{name:'Commit QA/QC import'}));
  await screen.findByText(/No records were restored/); expect(saved).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Check QA/QC import'})).toBeTruthy();
});
it('leaves old property responses behind and never carries a reviewed import into the next property',async()=>{
  const client={}; const ui=render(<QaqcPanel client={client} property={{id:'old'}} perms={{edit:true}} />);
  await screen.findByRole('button',{name:'Import QA/QC CSV or Excel'}); await file();
  let resolve; api.importQaqc.mockReturnValue(new Promise(r=>{resolve=r;}));
  fireEvent.click(screen.getByRole('button',{name:'Check QA/QC import'}));
  ui.rerender(<QaqcPanel client={client} property={{id:'new'}} perms={{edit:true}} />);
  await act(async()=>resolve(counts));
  await screen.findByRole('button',{name:'Import QA/QC CSV or Excel'});
  expect(screen.queryByRole('button',{name:'Commit QA/QC import'})).toBeNull();
  expect(api.importQaqc.mock.calls[0][1]).toBe('old');
});
it('is read only for viewers and displays unavailable migration without import controls',async()=>{
  const ui=render(<QaqcPanel client={{}} property={{id:'viewer'}} perms={{edit:false}} />);
  await screen.findByText('No QA/QC imports yet.');
  expect(screen.queryByRole('button',{name:'Import QA/QC CSV or Excel'})).toBeNull();
  api.listQaqcRecords.mockRejectedValue({code:'PGRST205',message:'missing'});
  ui.rerender(<QaqcPanel client={{}} property={{id:'missing'}} perms={{edit:true}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Existing drill imports still work');
  expect(screen.queryByRole('button',{name:'Import QA/QC CSV or Excel'})).toBeNull();
});
it('keeps a confirmed import message when the subsequent register refresh fails',async()=>{
  render(<QaqcPanel client={{}} property={{id:'prop'}} perms={{edit:true}} />);
  await screen.findByRole('button',{name:'Import QA/QC CSV or Excel'}); await file();
  fireEvent.click(screen.getByRole('button',{name:'Check QA/QC import'})); await screen.findByRole('button',{name:'Commit QA/QC import'});
  api.importQaqc.mockResolvedValue({...counts,committed:true}); api.listQaqcRecords.mockRejectedValue(new Error('Refresh offline'));
  fireEvent.click(screen.getByRole('button',{name:'Commit QA/QC import'}));
  await screen.findByText('Imported: 1 new, 0 changed, 0 unchanged.');
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh offline');
  await waitFor(()=>expect(screen.getByRole('button',{name:'Import QA/QC CSV or Excel'})).toBeEnabled());
});
