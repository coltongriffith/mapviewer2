import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GEOPHYS_NUMERIC_POLICY as POLICY, geophysFilePolicy, finiteGeophysNumber, readPoints, geophysReadNote } from '../src/three-d/geophys-points.js';
import { matchCols, roleOf, refineRole, parseXYZ, isXYZ } from '../src/three-d/roles.js';

const cols = { east: 0, north: 1, elev: 2, value: 3 };
const strict = (rows, extra = {}) => ({ name: 'synthetic-ip.csv', header: ['X','Y','Z','Chargeability'], rows, cols, geophysNumericPolicy: POLICY, ...extra });
// Execute the real standalone CSV/addFiles/getProject functions rather than a
// second parser. Browser acceptance additionally exercises the full studio.
const studio = readFileSync('src/three-d/studio.js', 'utf8');
const csvSource = studio.slice(studio.indexOf('function parseCSV('), studio.indexOf('\nconst norm ='));
const addSource = studio.slice(studio.indexOf('function addFiles('), studio.indexOf('\nconst num ='));
const saveSource = studio.slice(studio.indexOf('function getProject()'), studio.indexOf('// A short fingerprint'));
function imports() {
  const make = new Function('geophysFilePolicy', 'isXYZ', 'parseXYZ', 'matchCols', 'roleOf', 'refineRole', `
    let files = [], S = {}, G = null, usingSample = false;
    const refresh = {secSet:false}, toPlain = x => x;
    const isOverlay = () => false, parseOBJ = () => ({}), gradeCols = () => [];
    ${csvSource}\n${addSource}\n${saveSource}
    return {add:addFiles, files:() => files, save:getProject};
  `);
  return make(geophysFilePolicy, isXYZ, parseXYZ, matchCols, roleOf, refineRole);
}

describe('versioned geophysics numbers', () => {
  it('accepts only complete finite signed decimal/scientific tokens', () => {
    for (const value of ['0', '-1', '+.25', '1.', ' 2e-3 ', '2E+4', 12]) expect(finiteGeophysNumber(value)).toBe(true);
    for (const value of ['', ' ', '<0.05', '>2', '≤1', '1,000', '12tail', '0x10', '1e', '1e999', Infinity, NaN, true, [1], null]) expect(finiteGeophysNumber(value)).toBe(false);
  });
  it('excludes malformed coordinates and qualified/malformed values without changing raw evidence', () => {
    const file = strict([
      ['500000','5500000','100','12.5'], ['500010','5500010','100','12tail'],
      ['500020','5500020','100','1,000'], ['500030oops','5500030','100','20'],
      ['500040','5500040','100','<0.05'], ['500050','5500050','100','1e999'],
      ['500060','5500060','','10'], ['500070','5500070','100','-9999'],
    ]);
    const before = structuredClone(file), result = readPoints([file]);
    expect([...result.v]).toEqual([12.5,-9999]); // no invented vendor sentinel rule
    expect(result.diagnostics).toMatchObject({submitted:8,accepted:2,excluded:6,reasons:{'invalid-value':2,'invalid-coordinate':1,'qualified-value':1,'nonfinite-value':1,'missing-coordinate':1}});
    expect(file).toEqual(before);
    expect(geophysReadNote(result)).toContain('2 of 8 points accepted; 6 excluded');
  });
  it('retains old prefix parsing only for unset legacy files, including mixed projects', () => {
    const rows = [['500000oops','5500000','100','1,000']];
    const legacy = strict(rows); delete legacy.geophysNumericPolicy;
    const result = readPoints([legacy, strict(rows)]);
    expect([...result.x]).toEqual([500000]); expect([...result.v]).toEqual([1]);
    expect(result.diagnostics).toMatchObject({submitted:2,accepted:1,excluded:1,legacyFiles:1});
    expect(result.diagnostics.files.map(f => [f.policy,f.accepted,f.excluded])).toEqual([['legacy-prefix',1,0],[POLICY,0,1]]);
    expect(geophysReadNote(result)).toContain('Legacy numeric interpretation retained');
  });
  it('fails closed for an unsupported saved policy and discloses all-invalid data', () => {
    const result = readPoints([strict([['1','2','3','4']],{geophysNumericPolicy:'future-policy'})]);
    expect(result.n).toBe(0);
    expect(result.diagnostics.reasons).toEqual({'unsupported-policy':1});
    expect(geophysReadNote(result)).toContain('0 of 1 points accepted; 1 excluded (1 unsupported numeric policy)');
  });
  it('rejects ragged rows so XYZ comma separators cannot silently shift mapped columns', () => {
    const result = readPoints([strict([['1','2','3','4','extra']])]);
    expect(result.n).toBe(0); expect(result.diagnostics.reasons).toEqual({'row-width':1});
  });
});

describe('actual fresh-import and saved-file policy wiring', () => {
  it('stamps actual CSV imports, reads mixed rows, and serializes strict policy with exact raw text', () => {
    const api = imports();
    const text = 'X,Y,Z,Chargeability\n500000,5500000,100,12.5\n500010,5500010,100,"1,000"\n500020,5500020,100,<0.05\n';
    api.add([{name:'synthetic-ip.csv',text}]);
    const file = api.files()[0];
    expect(file.role).toBe('geophys'); expect(file.geophysNumericPolicy).toBe(POLICY);
    expect(file.header).toEqual(['X','Y','Z','Chargeability']);
    expect(readPoints([file]).diagnostics).toMatchObject({accepted:1,excluded:2});
    const saved = JSON.parse(JSON.stringify(api.save()));
    expect(saved.files[0]).toMatchObject({text, geophysNumericPolicy:POLICY});
    const restored = imports(); restored.add(saved.files,true);
    expect(readPoints(restored.files()).diagnostics).toMatchObject({accepted:1,excluded:2,legacyFiles:0});
  });
  it('stamps actual XYZ imports and keeps line IDs, valid values, missing flags and raw text', () => {
    const api = imports();
    const text = '/ Synthetic QA\n/ X Y Z CHG\nLine QA-1\n0 100 50 12.5\n25 100 50 *\n50 100 50 1,000\n75 100 50 >10\n100 100 50 2e1\n';
    api.add([{name:'synthetic-ip.xyz',text}]);
    const file = api.files()[0], result = readPoints([file]);
    expect(file.text).toBe(text); expect(file.role).toBe('geophys');
    expect([...result.v]).toEqual([12.5,20]); expect(result.lines).toEqual(['QA-1']);
    expect(result.diagnostics).toMatchObject({submitted:5,accepted:2,excluded:3,reasons:{'missing-value':1,'row-width':1,'qualified-value':1}});
  });
  it('keeps fresh unknown/remapped files strict and restored unset files legacy', () => {
    const api = imports(); const text = 'X,Y,Z,Unrecognized\n1,2,3,4tail';
    api.add([{name:'synthetic.csv',text}]);
    const fresh = api.files()[0]; expect(fresh.geophysNumericPolicy).toBe(POLICY);
    fresh.role = 'geophys'; fresh.cols.value = 3;
    expect(readPoints([fresh]).n).toBe(0);
    const restored = imports(); restored.add([{name:'synthetic.csv',text}],true);
    const legacy = restored.files()[0]; legacy.role='geophys'; legacy.cols.value=3;
    expect(legacy.geophysNumericPolicy).toBeUndefined(); expect([...readPoints([legacy]).v]).toEqual([4]);
    expect(restored.save().files[0]).not.toHaveProperty('geophysNumericPolicy');
  });
  it('recognizes named geophysics with entirely invalid values for exclusion disclosure, not numeric guessing', () => {
    const api = imports(); api.add([{name:'synthetic.csv',text:'X,Y,Z,Chargeability\n1,2,3,12tail\n4,5,6,<2'}]);
    expect(api.files()[0].role).toBe('geophys');
    expect(readPoints(api.files()).diagnostics).toMatchObject({submitted:2,accepted:0,excluded:2});
    const fallback = {header:['X','Y','Z','Other'],rows:[['1','2','3','12tail']],cols:{east:0,north:1,elev:2},geophysNumericPolicy:POLICY};
    expect(refineRole(fallback,'topo','ip.csv')).toBe('topo');
  });
  it('preserves unknown restored policy without silently upgrading it', () => {
    const api = imports(); api.add([{name:'synthetic.csv',text:'X,Y,Z,Value\n1,2,3,4',geophysNumericPolicy:'future-policy'}],true);
    const file=api.files()[0]; file.cols.value=3; file.role='geophys';
    expect(api.save().files[0].geophysNumericPolicy).toBe('future-policy');
    expect(readPoints([file]).diagnostics.reasons).toEqual({'unsupported-policy':1});
  });
  it('prefers an existing numeric geophysics field over preceding descriptive Model text', () => {
    const api=imports(); api.add([{name:'synthetic.csv',text:'X,Y,Z,Model,Resistivity\n1,2,3,inversion_A,125'}]);
    const file=api.files()[0];
    expect(file.cols.value).toBe(4); expect([...readPoints([file]).v]).toEqual([125]);
  });
  it('normalizes malformed restored markers before source/cache fingerprints can serialize them', () => {
    const cyclic = {}; cyclic.self = cyclic;
    for (const marker of [cyclic, { invalid: true }, 'x'.repeat(81), null, false, 1]) {
      const api=imports(); api.add([{name:'synthetic.csv',text:'X,Y,Z,Value\n1,2,3,4',geophysNumericPolicy:marker}],true);
      const file=api.files()[0]; file.cols.value=3; file.role='geophys';
      expect(file.geophysNumericPolicy).toBeNull();
      expect(() => JSON.stringify(api.save())).not.toThrow();
      expect(readPoints([file]).diagnostics.reasons).toEqual({'unsupported-policy':1});
    }
    expect(geophysFilePolicy({},true)).toBeUndefined();
    expect(geophysFilePolicy({geophysNumericPolicy:'future-policy'},true)).toBe('future-policy');
  });
});
