import { describe,it,expect,vi } from 'vitest';
import { assertActiveSource,validateRows,publishRows,sourceDate } from '../scripts/update-qc-claims.js';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const row={tag_number:'123',status:'Active',geometry:{type:'Polygon',coordinates:[[[-70,50],[-70.1,50],[-70.1,50.1],[-70,50]]]}};
describe('Quebec import safeguards',()=>{
  it('rejects all-title archives and unrelated hosts',()=>{
    expect(()=>assertActiveSource('https://diffusion.mern.gouv.qc.ca/public/GESTIM/TITRES_TITLES_ALL.zip')).toThrow();
    expect(()=>assertActiveSource('https://example.com/TITRES_ACTIFS_ACTIVE_TITLES.zip')).toThrow();
  });
  it('rejects historical statuses and misplaced coordinates without removing rows silently',()=>{
    expect(()=>validateRows([{...row,status:'Expired'}],{minRows:1})).toThrow(/Non-active/);
    expect(()=>validateRows([{...row,geometry:{type:'Polygon',coordinates:[[[500000,6000000]]]}}],{minRows:1})).toThrow(/Coordinates/);
    expect(sourceDate('invalid')).toBeNull();expect(sourceDate('2026-09-15')).toBe('2026-09-15');
  });
  it('never publishes a partial upload and only aborts staging on failure',async()=>{
    const rpc=vi.fn(async name=>{if(name==='begin_qc_import')return 'run';if(name==='stage_qc_import_batch')throw Error('network');return true;});
    await expect(publishRows(Array(100000).fill(row),rpc)).rejects.toThrow('network');
    expect(rpc.mock.calls.map(c=>c[0])).toEqual(['begin_qc_import','stage_qc_import_batch','abort_qc_import']);
  });
  it('SQL publication preserves live data for null/incomplete/invalid imports, and commits complete imports',async()=>{
    const db=new PGlite();
    try{
      // PostGIS is not bundled in PGlite. Stub only spatial predicates; transaction,
      // staging validation, privileges and rollback run in real PostgreSQL.
      await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
        create table qc_claims(id bigint generated always as identity,tag_number text,owner_name text,status text,good_to_date date,area_hectares numeric,title_type text,geometry jsonb,source_updated_at date,geom jsonb generated always as(geometry) stored);
        create function st_makeenvelope(float8,float8,float8,float8,integer) returns jsonb language sql as $$select '{}'::jsonb$$;
        create function st_coveredby(jsonb,jsonb) returns boolean language sql as $$select coalesce($1->>'invalid','false')<>'true'$$;
        create function truncate_qc_claims() returns void language sql as $$truncate qc_claims$$;
        insert into qc_claims(tag_number,status,geometry) values('old','Active','{}');`);
      await db.exec(readFileSync('supabase/migrations/20260915160235_repair_qc_atomic_import.sql','utf8'));
      await db.exec(readFileSync('supabase/migrations/20260915160808_qc_import_continue_identity.sql','utf8'));
      // Match production: the importer can use the table/sequence but owns neither.
      await db.exec('grant all on qc_claims to service_role; grant usage,select on sequence qc_claims_id_seq to service_role; set role service_role;');
      await expect(db.query('select publish_qc_import(null)')).rejects.toThrow(/Stale/);
      const {rows:[{id}]}=await db.query('select begin_qc_import(100000) as id');
      await expect(db.query('select publish_qc_import($1)',[id])).rejects.toThrow(/Incomplete/);
      await expect(db.query('select stage_qc_import_batch($1,0,$2)',[id,JSON.stringify(Array(1000).fill({...row,status:'Expired'}))])).rejects.toThrow(/non-active/);
      const batch=JSON.stringify(Array(1000).fill({...row,geometry:{...row.geometry,invalid:true}}));
      await db.query('insert into qc_import_batches select $1,i,$2::jsonb from generate_series(0,99) i',[id,batch]);
      await expect(db.query('select publish_qc_import($1)',[id])).rejects.toThrow(/validation failed/);
      expect((await db.query('select tag_number from qc_claims')).rows).toEqual([{tag_number:'old'}]);
      await db.query('update qc_import_batches set rows=$1::jsonb',[JSON.stringify(Array(1000).fill(row))]);
      expect((await db.query('select publish_qc_import($1) as count',[id])).rows[0].count).toBe(100000);
      expect((await db.query('select count(*)::int as count from qc_import_batches')).rows[0].count).toBe(0);
      expect((await db.query("select has_function_privilege('anon','public.publish_qc_import(uuid)','execute') as allowed")).rows[0].allowed).toBe(false);
      await expect(db.query('select begin_qc_import(200000)')).rejects.toThrow(/20 percent/);
    }finally{await db.close();}
  },60000);
});

