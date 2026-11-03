import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,it,expect,vi } from 'vitest';
import PropertyPage from '../src/components/workspace/PropertyPage.jsx';

const { lib, auth }=vi.hoisted(()=>({lib:{list:vi.fn(),reportText:vi.fn()},auth:{user:{id:'viewer-qa'}}}));
vi.mock('../src/lib/supabase',()=>({supabase:{}}));
vi.mock('../src/hooks/useAuth.jsx',()=>({useAuth:()=>auth}));
vi.mock('../src/utils/propertyFiles',async original=>({...await original(),library:()=>lib}));
vi.mock('../src/utils/workspace',async original=>({...await original(),resolveProperty:async()=>({property:{id:'property-qa',org_id:'org-qa',slug:'qa',name:'Synthetic property',commodities:[]},org:{id:'org-qa',slug:'qa'}}),setActiveWorkspaceId:vi.fn()}));
vi.mock('../src/components/workspace/shared',()=>({
  useWorkspaces:()=>({list:[{id:'org-qa',role:'viewer',slug:'qa',name:'Synthetic workspace'}],loading:false}),
  WorkspaceHeader:({children})=><header>{children}</header>,RoleBadge:()=>null,StatusBadge:()=>null,ErrorNote:({error})=>error?<p role="alert">{error}</p>:null,
  PropertyForm:()=>null,ActivityFeed:()=>null,
}));
const files=[['report.md','document'],['report.txt','document'],['assays.txt','drill'],['report.pdf','document'],['report.docx','document']].map(([name,kind],i)=>({id:`file-${i}`,name,kind,version:1,bytes:100,sha256:'a'.repeat(64),path:`org/property/file-${i}/v1/qa`}));
beforeEach(()=>{
  vi.clearAllMocks();auth.user={id:'viewer-qa'};window.history.replaceState({},'', '/?tab=data');
  lib.list.mockResolvedValue(files);
  lib.reportText.mockImplementation(async(_id,file)=>({text:'Supplied QA-17 report contents.',source:file}));
});
it('offers a contextual content action to existing viewers for text documents only, with no edits or automatic read',async()=>{
  const user=userEvent.setup();
  render(<PropertyPage slug="qa" orgSlug="qa"/>);
  await screen.findByRole('table',{name:'Data files'});
  expect(screen.getByRole('button',{name:'Find in report text: report.md'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Find in report text: report.txt'})).toBeVisible();
  for(const name of ['assays.txt','report.pdf','report.docx'])expect(screen.queryByRole('button',{name:`Find in report text: ${name}`})).toBeNull();
  expect(screen.queryByRole('button',{name:'+ Add a file'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Delete report.md'})).toBeNull();
  expect(lib.reportText).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'Find in report text: report.md'}));
  await screen.findByRole('form',{name:'Search report contents'});
  expect(lib.reportText).not.toHaveBeenCalled();
  await user.type(screen.getByRole('searchbox',{name:'Text to find'}),'QA-17');
  expect(screen.getByRole('searchbox',{name:'Text to find'})).toHaveValue('QA-17');
  expect(screen.getByRole('button',{name:'Find in text'})).toBeEnabled();
  await user.click(screen.getByRole('button',{name:'Find in text'}));
  expect(await screen.findByRole('status',{}, {timeout:5000})).toHaveTextContent('1 matching line');
  expect(lib.reportText.mock.calls[0][0]).toBe('property-qa');
  expect(lib.reportText.mock.calls[0][2].userId).toBe('viewer-qa');
});
