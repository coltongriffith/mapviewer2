import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
import BatchCertificates from '../src/components/workspace/BatchCertificates';
const { api } = vi.hoisted(() => ({api:{list:vi.fn(),choices:vi.fn(),attach:vi.fn(),upload:vi.fn(),retract:vi.fn(),download:vi.fn()}}));
vi.mock('../src/utils/drillCertificates',()=>({drillCertificates:()=>api}));
const file = {id:'file',file_id:'file',name:'Lab.pdf',version:1,storage_path:'original/v1/lab.pdf'};
beforeEach(()=>{ vi.resetAllMocks(); api.list.mockResolvedValue([]); api.choices.mockResolvedValue([file]); });
async function setup(edit = true, rolled = false) {
  render(<BatchCertificates client={{}} property={{id:'property'}} batch={{id:'batch',filename:'assays.csv',rolled_back_at:rolled}} canEdit={edit} />);
  fireEvent.click(screen.getByRole('button',{name:'Lab certificates'}));
}
it('links the chosen version only after a successful write',async()=>{
  await setup(); await screen.findByLabelText('Certificate PDF');
  fireEvent.change(screen.getByLabelText('Certificate PDF'),{target:{value:'file'}});
  api.list.mockResolvedValue([file]);
  fireEvent.click(screen.getByRole('button',{name:'Link certificate'}));
  await screen.findByText('Certificate linked to this assay import.');
  expect(api.attach).toHaveBeenCalledWith('batch','file',1);
  expect(screen.getByRole('button',{name:'Lab.pdf · v1'})).toBeTruthy();
});
it('explains partial upload success and leaves the uploaded PDF selectable for retry',async()=>{
  await setup(); await screen.findByLabelText('Certificate PDF');
  api.upload.mockResolvedValue({fileId:'file',version:1}); api.attach.mockRejectedValue(new Error('Network error'));
  fireEvent.change(screen.getByLabelText('Upload lab certificate'),{target:{files:[new File(['pdf'],'Lab.pdf',{type:'application/pdf'})]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('was saved in the property library, but was not linked');
  expect(screen.queryByText('Certificate linked to this assay import.')).toBeNull();
  expect(screen.getByLabelText('Certificate PDF').value).toBe('file');
});
it('gracefully isolates unavailable migration from import UI',async()=>{
  api.list.mockRejectedValue(new Error('Certificate links are not available on this site yet. Assay imports still work.'));
  await setup(); expect(await screen.findByRole('alert')).toHaveTextContent('Assay imports still work');
  expect(screen.queryByRole('button',{name:'Link certificate'})).toBeNull();
});
it('distinguishes a saved link from a failed list refresh',async()=>{
  await setup(); await screen.findByLabelText('Certificate PDF');
  fireEvent.change(screen.getByLabelText('Certificate PDF'),{target:{value:'file'}});
  api.list.mockRejectedValue(new Error('Offline'));
  fireEvent.click(screen.getByRole('button',{name:'Link certificate'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('The link was saved, but the list could not refresh');
  expect(screen.getByText('Certificate linked to this assay import.')).toBeTruthy();
});
it('shows pinned unavailable history and no mutation controls for viewers',async()=>{
  api.list.mockResolvedValue([{...file,storage_path:null}]); await setup(false);
  await screen.findByText('Lab.pdf · v1 (unavailable)');
  expect(screen.queryByRole('button',{name:'Retract link'})).toBeNull();
  expect(screen.queryByLabelText('Certificate PDF')).toBeNull();
});
it('retracts with a reason while preserving history even after batch rollback',async()=>{
  api.list.mockResolvedValue([file]); await setup(true,true);
  fireEvent.click(await screen.findByRole('button',{name:'Retract link'}));
  expect(screen.queryByLabelText('Certificate PDF')).toBeNull();
  fireEvent.change(screen.getByLabelText('Why retract Lab.pdf?'),{target:{value:'Wrong lab job'}});
  api.list.mockResolvedValue([{...file,retracted_at:'now',retraction_reason:'Wrong lab job'}]);
  fireEvent.click(screen.getByRole('button',{name:'Confirm retraction'}));
  await waitFor(()=>expect(api.retract).toHaveBeenCalledWith('batch','file',1,'Wrong lab job'));
  await screen.findByText('· Retracted: Wrong lab job');
});
