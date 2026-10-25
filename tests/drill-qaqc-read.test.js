import { it, expect, vi } from 'vitest';
import { listQaqcRecords, listQaqcBatches, qaqcError } from '../src/utils/drillQaqcDb';
const id = i => `00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
function mock(data) {
  const query={then:(resolve)=>Promise.resolve({data}).then(resolve)};
  for(const name of ['select','eq','is','order','limit','gt','or']) query[name]=vi.fn(()=>query);
  return {query,client:{from:vi.fn(()=>query)}};
}
it('bounds current records and passes cursor values unquoted to standalone gt',async()=>{
  const {query,client}=mock(Array.from({length:26},(_,i)=>({id:id(i+1)})));
  const page=await listQaqcRecords(client,'property','samples',id(0));
  expect(page.rows).toHaveLength(25); expect(page.next).toBe(id(25));
  expect(query.limit).toHaveBeenCalledWith(26); expect(query.eq).toHaveBeenCalledWith('property_id','property');
  expect(query.is).toHaveBeenCalledWith('superseded_by_batch',null); expect(query.gt).toHaveBeenCalledWith('id',id(0));
  await expect(listQaqcRecords(client,'property','samples','x,or')).rejects.toThrow('cursor');
});
it('pages history with timestamp plus id and rejects unsafe cursors',async()=>{
  const {query,client}=mock([]), cursor={id:id(1),created_at:'2026-10-23T12:00:00+00:00'};
  expect(await listQaqcBatches(client,'property',cursor)).toEqual({rows:[],next:null});
  expect(query.or).toHaveBeenCalledWith(`created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt."${cursor.id}")`);
  await expect(listQaqcBatches(client,'property',{...cursor,created_at:'bad"'})).rejects.toThrow('cursor');
});
it('maps row diagnostics to physical source lines and explains prerequisites',()=>{
  expect(qaqcError(new Error('INVALID_ROW 2: invalid sample_type'),[2,7])).toBe('Line 7: invalid sample_type');
  expect(qaqcError(new Error('CRM_NOT_FOUND'))).toContain('revision, element and unit');
  expect(qaqcError(new Error('BATCH_DEPENDENCY'))).toContain('dependent import first');
});
