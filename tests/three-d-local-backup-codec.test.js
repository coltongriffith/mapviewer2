// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';
import { encodeBackup, decodeBackup, validateBackupProject, MAX_BACKUP_BYTES } from '../src/three-d/local-backup-codec.js';
const project = () => ({
  v: 1,
  app: 'Exploration Maps 3D',
  settings: {
    title: 'Synthetic α地質',
    vex: 1,
    surf: 1,
    traceWidth: 1.4,
    bins: [0.1, 0.2],
    format: 'slide',
    view: '3d',
    logo: null
  },
  camera: {
    azimuth: 45,
    plunge: 20,
    zoom: 100,
    pan: [1, 2, 3]
  },
  usingSample: false,
  secSet: false,
  files: [{
    name: 'QA.csv',
    text: '\uFEFFHoleID,X,Y,Z,Au\r\n"QA-α",1,2,3,"<0.01"\r\n',
    role: 'collar',
    cols: {
      id: 0,
      east: 1,
      north: 2,
      elev: 3
    }
  }]
});
const envelope = p => ({
  format: 'exploration-maps-project',
  version: 1,
  kind: '3d',
  producerRevision: 'test',
  createdAt: '2026-11-03T00:00:00Z',
  name: 'Synthetic QA',
  project: p
});
const bytes = x => new TextEncoder().encode(typeof x === 'string' ? x : JSON.stringify(x));
const reject = (p, code) => expect(encodeBackup(p)).rejects.toMatchObject({
  code
});
describe('lossless bounded 3D local backup codec', () => {
  it('roundtrips raw scientific text, manual maps, camera and mixed policy absence/string/null', async () => {
    const p = project();
    p.files = [undefined, 'finite-decimal-v1', 'future-policy', null].map((policy, i) => ({
      ...p.files[0],
      name: `QA-${i}.csv`,
      ...(policy === undefined ? {} : {
        geophysNumericPolicy: policy
      })
    }));
    const e = await encodeBackup(p, {
      name: 'QA — α',
      producerRevision: 'fixture'
    });
    const d = await decodeBackup(e.bytes);
    expect(d.project).toEqual(p);
    expect(d.project.files[0]).not.toHaveProperty('geophysNumericPolicy');
    expect(e.filename).toMatch(/\.emap-project\.json$/);
    expect(d.name).toBe('QA — α');
  });
  it('accepts the actual source-derived fictional sample and source initial settings without executing the app', async () => {
    const src = readFileSync(resolve('src/three-d/studio.js'), 'utf8');
    const code = src.slice(src.indexOf('function mulberry32('), src.indexOf('// 3. Project state'));
    const state = src.slice(src.indexOf('const S = {'), src.indexOf('const BIN_COLORS'));
    const ext = src.indexOf('Object.assign(S, {\n  geology:');
    const settings = src.slice(ext, src.indexOf('\nconst EXT =', ext));
    const result = JSON.parse(JSON.stringify(runInNewContext(code + '\n' + state + '\n' + settings + '\n({files:sampleFiles(),settings:S})')));
    const p = {
      ...project(),
      ...result,
      usingSample: true
    };
    expect((await decodeBackup((await encodeBackup(p)).bytes)).project).toEqual(p);
  });
  it.each(['{"version":2,"version":1}', '{"version":2,"\\u0076ersion":1}'])('rejects duplicate and escaped-equivalent keys before project construction', async text => {
    await expect(decodeBackup(bytes(text))).rejects.toMatchObject({
      code: 'duplicate-key'
    });
  });
  it.each(['{', '[1,]', '{"a":01}', '{"a":true false}', '"unterminated'])('rejects malformed JSON %s', async text => {
    await expect(decodeBackup(bytes(text))).rejects.toBeInstanceOf(Error);
  });
  it('rejects excessive bytes before UTF8 decoding and invalid UTF8', async () => {
    expect(MAX_BACKUP_BYTES).toBe(8388608);
    await expect(decodeBackup(new Uint8Array(MAX_BACKUP_BYTES + 1))).rejects.toMatchObject({
      code: 'size'
    });
    await expect(decodeBackup(new Uint8Array([0xc3, 0x28]))).rejects.toMatchObject({
      code: 'utf8'
    });
  });
  it('rejects deep syntax, escaped lone surrogates and prototype keys', async () => {
    await expect(decodeBackup(bytes('['.repeat(1000) + 'null' + ']'.repeat(1000)))).rejects.toMatchObject({
      code: 'complexity'
    });
    const e = envelope(project());
    e.name = '\ud800';
    await expect(decodeBackup(bytes(e))).rejects.toMatchObject({
      code: 'unicode'
    });
    await expect(decodeBackup(bytes('{"__proto__":{}}'))).rejects.toMatchObject({
      code: 'unsafe-field'
    });
  });
  it('rejects nonfinite scientific settings, unknown fields, credentials and unsupported policy objects without mutation', async () => {
    const p = project();
    p.settings.vex = Infinity;
    await reject(p, 'number');
    p.settings.vex = 1;
    p.settings.futureRequired = true;
    await reject(p, 'fields');
    delete p.settings.futureRequired;
    p.settings.tags = {
      status: {
        access_token: 'private'
      }
    };
    await reject(p, 'unsafe-field');
    delete p.settings.tags;
    p.files[0].geophysNumericPolicy = {
      future: true
    };
    const before = structuredClone(p);
    await reject(p, 'policy');
    expect(p).toEqual(before);
  });
  it('rejects row, column, cell and OBJ allocation bombs before any app parser', async () => {
    const p = project();
    p.files[0].text = 'x\n'.repeat(100002);
    await reject(p, 'source-rows');
    p.files[0].text = ','.repeat(129);
    await reject(p, 'source-columns');
    p.files[0].text = Array(4000).fill(Array(127).fill('x').join(',')).join('\n');
    await reject(p, 'source-cells');
    p.files = [{
      name: 'bomb.obj',
      text: 'v 1 2 3\n'.repeat(25001),
      role: 'mesh'
    }];
    await reject(p, 'mesh-complexity');
    p.files[0].text = 'f 1 2 3 4 5 6 7 8 9';
    await reject(p, 'mesh-complexity');
  });
  it('preserves quotes/multiline fields while counting cell bounds', async () => {
    const p = project();
    p.files[0].cols = {
      hole: 0
    };
    p.files[0].text = 'HoleID,Note\r\nQA,"one,two\nthree"\r\n';
    expect((await decodeBackup((await encodeBackup(p)).bytes)).project.files[0].text).toBe(p.files[0].text);
  });
  it('refuses huge renderer-critical settings instead of silently clamping science', async () => {
    const p = project();
    p.settings.vex = 1e9;
    await reject(p, 'setting-range');
    p.settings.vex = 1;
    p.settings.format = '100000x100000';
    await reject(p, 'setting-enum');
    p.settings.format = 'slide';
    p.settings.geology = {
      smooth: 1e9
    };
    await reject(p, 'setting-range');
  });
  it('rejects arbitrary nested image locations and remote/blob/SVG logo sources without fetching', async () => {
    for (const url of ['https://private.test/read?token=secret', 'blob:qa', 'data:image/svg+xml;base64,PHN2Zy8+']) {
      const p = project();
      p.settings.logo = {
        $image: url
      };
      await reject(p, 'image-format');
    }
    const p = project();
    p.settings.tags = {
      highlight: {
        QA: {
          $image: 'data:image/png;base64,AAAA'
        }
      }
    };
    await reject(p, 'tag-map');
  });
  it('retains inert URLs in scientific raw text, labels and provenance and recomputes provider summaries', async () => {
    const p = project();
    p.files[0].text += 'https://descriptive.example/report\n';
    p.settings.mapInfo = {
      sources: 'https://descriptive.example/source'
    };
    p.settings.terrain = 'satellite';
    p.settings.terrainSource = 'dem';
    p.settings.crs = 'EPSG:4326';
    p.settings.libRefs = {
      'QA.csv': {
        libFileId: 'descriptive-only',
        version: 1
      }
    };
    const summary = await validateBackupProject(p);
    expect(summary.externalDependencies.map(x => x.kind)).toEqual(['dem', 'imagery']);
    expect(summary.sourceReferences).toEqual([{
      kind: 'library',
      path: 'settings.libRefs'
    }]);
    expect(p.settings.mapInfo.sources).toContain('https://');
  });
  it('retains a branded figure with an inline PNG logo and explicitly reports embedded dimensions', async () => {
    const p = project();
    p.settings.logo = {
      $image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='
    };
    p.settings.brandStyle = {
      brandKitId: 'qa-kit',
      brandRevision: '2026-11-03',
      mode: 'style',
      style: {
        version: 1,
        type: {
          title: {
            family: 'Inter',
            weight: 700,
            size: 1.2
          }
        },
        logo: {
          assetRef: 'figure:logo',
          placement: 'tr'
        }
      },
      fonts: {
        sans: 'Inter'
      }
    };
    const e = await encodeBackup(p);
    expect(e.summary.dependencies.embeddedImages[0]).toMatchObject({
      path: 'settings.logo',
      mime: 'image/png',
      width: 1,
      height: 1
    });
    expect((await decodeBackup(e.bytes)).project.settings.logo).toEqual(p.settings.logo);
  });
  it('rejects tiny files that request extreme drill geometry and cumulative path allocations', async () => {
    const p = project();
    p.files = [{
      name: 'QA-collars.csv',
      role: 'collar',
      cols: {
        hole: 0,
        east: 1,
        north: 2,
        elev: 3,
        depth: 4
      },
      text: 'HoleID,X,Y,Z,Depth\nQA,1,2,3,1e200'
    }];
    await reject(p, 'trajectory-depth');
    p.files[0].text = 'HoleID,X,Y,Z,Depth\n' + Array.from({
      length: 11
    }, (_, i) => `QA${i},1,2,3,20000`).join('\n');
    await reject(p, 'trajectory-complexity');
    p.files[0].text = 'HoleID,X,Y,Z,Depth\nQA,1e200,2,3,100';
    await reject(p, 'geometry-range');
  });
  it('rejects malformed header-only raster bytes and unknown advanced settings without deleting fields', async () => {
    const p = project();
    p.settings.logo = {
      $image: 'data:image/png;base64,AAAA'
    };
    await reject(p, 'image-signature');
    p.settings.logo = null;
    p.settings.shapes = [{
      id: 'QA',
      type: 'future'
    }];
    const before = structuredClone(p);
    await reject(p, 'unsupported-geometry-settings');
    expect(p).toEqual(before);
  });
  it('rejects sparse arrays and accessor properties before serialization side effects', async () => {
    const p = project();
    p.settings.labels = Array(1000000);
    await reject(p, 'complexity');
    delete p.settings.labels;
    let read = false;
    Object.defineProperty(p.settings, 'title', {
      get() {
        read = true;
        return 'unsafe';
      },
      enumerable: true
    });
    await reject(p, 'plain-data');
    expect(read).toBe(false);
  });
  it('accepts the exact encoded byte bound with bounded logical rows', async () => {
    const p = project();
    p.files = [{
      name: 'QA-notes.csv',
      role: 'unknown',
      cols: {},
      text: 'Note\n' + ('x'.repeat(833) + '\n').repeat(10000)
    }];
    const e = envelope(p);
    const current = bytes(e).byteLength;
    p.files[0].text += 'x'.repeat(MAX_BACKUP_BYTES - current);
    const input = bytes(envelope(p));
    expect(input.byteLength).toBe(MAX_BACKUP_BYTES);
    expect((await decodeBackup(input)).project.files[0].text).toBe(p.files[0].text);
  });
  it.each(['qa.xyz', 'qa.dat', 'qa.csv'])('bounds geometric depth in manually mapped XYZ and whitespace-sniffed %s', async name => {
    const cases = [['collar', {
      hole: 0,
      east: 1,
      north: 2,
      elev: 3,
      depth: 4
    }, 'HoleID X Y Z Depth\nQA 1 2 3 1e200'], ['survey', {
      hole: 0,
      depth: 1,
      az: 2,
      dip: 3
    }, 'HoleID Depth Azimuth Dip\nQA 1e200 45 -60'], ['assay', {
      hole: 0,
      from: 1,
      to: 2
    }, 'HoleID From To\nQA 0 1e200']];
    for (const [role, cols, text] of cases) {
      const p = project();
      p.files = [{
        name,
        role,
        cols,
        text
      }];
      await reject(p, 'trajectory-depth');
    }
  });
  it('uses shared comment-sniff XYZ semantics and skips CSV blank rows before auto header detection', async () => {
    const p = project();
    p.files = [{
      name: 'qa.csv',
      text: '/ HoleID X Y Z Depth\n101 1 2 3 1e200'
    }];
    await reject(p, 'trajectory-depth');
    p.files = [{
      name: 'qa.csv',
      text: '\nHoleID,X,Y,Z,Depth\nQA,1,2,3,1e200'
    }];
    await reject(p, 'trajectory-depth');
  });
  it('retains valid XYZ geophysics data, manual mappings and qualifiers exactly', async () => {
    const p = project();
    p.files = [{
      name: 'qa.xyz',
      role: 'geophys',
      cols: {
        east: 0,
        north: 1,
        elev: 2,
        value: 3
      },
      text: 'X Y Z Value\n1 2 3 <0.01\n4 5 6 12tail\n',
      geophysNumericPolicy: 'finite-decimal-v1'
    }];
    expect((await decodeBackup((await encodeBackup(p)).bytes)).project).toEqual(p);
  });
  it('enforces three grade shells while preserving valid explicit geology faces and geophysics lines', async () => {
    const p = project();
    p.settings.shell = {
      shells: Array.from({
        length: 4
      }, (_, i) => ({
        cutoff: i + 1,
        color: null,
        label: null
      }))
    };
    await reject(p, 'shell-count');
    p.settings.shell.shells = p.settings.shell.shells.slice(0, 3);
    p.settings.geology = {
      faces: ['N', 'E']
    };
    p.settings.geophys = {
      faces: ['S', 'W'],
      lines: ['L1', {
        id: 'QA',
        from: [1, 2],
        to: [3, 4]
      }]
    };
    expect((await decodeBackup((await encodeBackup(p)).bytes)).project).toEqual(p);
  });
  it('rejects oversized wall and ordinary label text before native canvas allocation', async () => {
    const p = project();
    p.settings.wallLabels = [{
      id: 'W1',
      text: 'x\n'.repeat(100000),
      face: 'N',
      u: .5,
      v: .5,
      size: 'normal'
    }];
    await reject(p, 'rendered-text');
    p.settings.wallLabels[0].text = 'x'.repeat(121);
    await reject(p, 'label-text');
    p.settings.wallLabels = [{
      id: 'W1',
      text: 'Supplied QA heading',
      face: 'N',
      u: .5,
      v: .5,
      size: 'heading',
      scale: 1,
      rotation: 0,
      color: null
    }];
    p.settings.labels = [{
      id: 'L1',
      text: 'QA stat',
      size: 'title',
      x: .5,
      y: .5,
      arrow: false,
      ax: null,
      ay: null,
      kind: 'stat',
      rows: ['Supplied only']
    }];
    expect((await decodeBackup((await encodeBackup(p)).bytes)).project).toEqual(p);
    p.settings.labels[0].text = 'x'.repeat(201);
    await reject(p, 'label-text');
  });
  it('rejects manual/published callout depth bombs and excessive aggregate ribbon spans', async () => {
    for (const key of ['coOverrides', 'pubOverrides']) {
      const p = project();
      p.settings[key] = {
        QA: {
          show: true,
          at: [0, 1e200]
        }
      };
      await reject(p, 'callout-interval');
      p.settings[key] = Object.fromEntries(Array.from({
        length: 11
      }, (_, i) => ['QA' + i, {
        show: true,
        at: [0, 20000]
      }]));
      await reject(p, 'callout-complexity');
    }
    const p = project();
    p.settings.coOverrides = {
      QA: {
        show: true,
        placement: 'beside',
        x: .3,
        y: .4,
        at: [0, 100, 20, 40],
        line1: 'Supplied wording'
      }
    };
    expect((await decodeBackup((await encodeBackup(p)).bytes)).project).toEqual(p);
  });
  it('rejects unsafe restored-role mismatch and raw assay/published interval bombs', async () => {
    const p = project();
    p.files = [{
      name: 'qa.csv',
      role: 'mesh',
      text: 'HoleID,X,Y,Z,Depth\nQA,1,2,3,1e200'
    }];
    await reject(p, 'file-role');
    for (const role of ['assay', 'published']) {
      p.files = [{
        name: 'qa.csv',
        role,
        cols: {
          hole: 0,
          from: 1,
          to: 2
        },
        text: 'HoleID,From,To\nQA,-1e200,10'
      }];
      await reject(p, 'trajectory-depth');
      p.files[0].text = 'HoleID,From,To\n' + Array.from({
        length: 11
      }, (_, i) => `QA${i},0,20000`).join('\n');
      await reject(p, 'interval-complexity');
    }
  });
  it('bounds geology category allocation from both saved legend and raw supplied codes', async () => {
    const p = project();
    p.settings.geology = {
      legend: Array.from({
        length: 33
      }, (_, i) => ({
        code: 'C' + i,
        name: 'QA',
        color: '#123456'
      }))
    };
    await reject(p, 'geology-categories');
    p.settings.geology = {
      legend: [{
        code: 'C0',
        name: 'QA',
        color: '#123456'
      }]
    };
    p.files.push({
      name: 'qa-lithology.csv',
      role: 'litho',
      cols: {
        hole: 0,
        from: 1,
        to: 2,
        code: 3
      },
      text: 'HoleID,From,To,Code\n' + Array.from({
        length: 33
      }, (_, i) => `QA,${i},${i + 1},C${i}`).join('\n')
    });
    await reject(p, 'geology-categories');
    p.files[1].text = 'HoleID,From,To,Code\nQA,0,1,C1';
    expect((await decodeBackup((await encodeBackup(p)).bytes)).project).toEqual(p);
  });
  it.each(['auto', 'all'])('bounds derived geophysics curtains for %s without rewriting source data', async mode => {
    const p = project();
    p.settings.geophys = {
      mode: 'curtain',
      lines: mode
    };
    p.files = [{
      name: 'qa-geophys.xyz',
      role: 'geophys',
      cols: {
        east: 0,
        north: 1,
        elev: 2,
        value: 3,
        line: 4
      },
      text: 'X Y Z Value Line\n' + Array.from({
        length: 17
      }, (_, i) => [0, 1, 2].map(j => `${i} ${j} 100 10 L${i}`).join('\n')).join('\n')
    }];
    const before = structuredClone(p);
    await reject(p, 'geophys-lines');
    expect(p).toEqual(before);
    p.settings.geophys.mode = 'faces';
    expect((await decodeBackup((await encodeBackup(p)).bytes)).project).toEqual(p);
  });
  it.each(['/Line/', ' Line-ID ', '#Line#'])('shares actual role aliases for derived curtain header %s', async header => {
    const p = project();
    p.settings.geophys = {
      mode: 'curtain',
      lines: 'all'
    };
    p.files = [{
      name: 'qa.csv',
      text: `X,Y,Z,Value,${header}\n` + Array.from({
        length: 17
      }, (_, i) => [0, 1, 2].map(j => `${i},${j},100,10,L${i}`).join('\n')).join('\n')
    }];
    await reject(p, 'geophys-lines');
  });
  it.each(['/LithCode/', ' Lith-Code ', '(Code)'])('shares actual role aliases for derived lithology header %s', async header => {
    const p = project();
    p.settings.geology = {
      legend: []
    };
    p.files = [{
      name: 'qa-lithology.csv',
      text: `HoleID,From,To,${header}\n` + Array.from({
        length: 33
      }, (_, i) => `QA,${i},${i + 1},C${i}`).join('\n')
    }];
    await reject(p, 'geology-categories');
  });
  it('refuses unknown restored roles before their native auto-collar fallback can allocate geometry', async () => {
    const p = project();
    p.files = [{
      name: 'qa.csv',
      role: 'litho-model',
      text: 'HoleID,X,Y,Z,Depth\nQA,1,2,3,1e200'
    }];
    await reject(p, 'file-role');
  });
  it('rejects equivalent component-count bombs on encode and decode before native interval expansion', async () => {
    const p = project();
    p.settings.eq = {
      base: 'Cu',
      baseCol: 'Cu',
      baseUnit: '%',
      basePrice: 1,
      baseRecovery: 90,
      metals: Object.fromEntries(Array.from({
        length: 5000
      }, (_, i) => ['X' + i, {
        col: 'Au',
        unit: '%',
        price: 1,
        recovery: 90
      }]))
    };
    await reject(p, 'equivalent-components');
    await expect(decodeBackup(bytes(envelope(p)))).rejects.toMatchObject({
      code: 'equivalent-components'
    });
  });
  it('bounds equivalent component times native-valid assay intervals independently of row and trajectory bounds', async () => {
    const p = project();
    p.settings.eq = {
      base: 'Cu',
      baseCol: 'Cu',
      baseUnit: '%',
      basePrice: 1,
      baseRecovery: 90,
      metals: Object.fromEntries(Array.from({
        length: 16
      }, (_, i) => ['X' + i, {
        col: 'Au',
        unit: 'g/t',
        price: 1,
        recovery: 90
      }]))
    };
    p.files.push({
      name: 'qa-assays.csv',
      role: 'assay',
      cols: {
        hole: 0,
        from: 1,
        to: 2
      },
      text: 'HoleID,From,To,Cu,Au\n' + 'QA,0,1,1,1\n'.repeat(25001)
    });
    await reject(p, 'equivalent-work');
    await expect(decodeBackup(bytes(envelope(p)))).rejects.toMatchObject({
      code: 'equivalent-work'
    });
    p.files[1].text = p.files[1].text.replaceAll('QA,0,1,1,1', 'QA,<0,<1,1,1');
    await reject(p, 'equivalent-work');
  });
  it('preserves valid multi-metal assumptions exactly while refusing invalid units, recoveries and nonfinite factors', async () => {
    const p = project();
    p.settings.eq = {
      base: 'Cu',
      baseCol: 'Cu_pct',
      baseUnit: '%',
      basePrice: 4.25,
      baseRecovery: 88,
      metals: {
        Au: {
          col: 'Au_gpt',
          unit: 'g/t',
          price: 2500,
          recovery: 90
        },
        Ag: {
          col: 'Ag_ppm',
          unit: 'ppm',
          price: 25,
          recovery: 85
        }
      }
    };
    expect((await decodeBackup((await encodeBackup(p)).bytes)).project.settings.eq).toEqual(p.settings.eq);
    p.settings.eq.metals.Au.unit = 'vendor-units';
    await reject(p, 'equivalent-factors');
    p.settings.eq.metals.Au.unit = 'g/t';
    p.settings.eq.metals.Au.recovery = 101;
    await reject(p, 'equivalent-assumptions');
    p.settings.eq.metals.Au.recovery = 90;
    p.settings.eq.basePrice = Number.MIN_VALUE;
    await reject(p, 'equivalent-factors');
  });
  it('preserves native manual geology colour flags true, false and absence exactly', async () => {
    for (const flag of [true, false, undefined]) {
      const p = project();
      const entry = {
        code: 'QA',
        name: 'Supplied unit',
        color: '#123456',
        show: true,
        order: 0,
        ...(flag === undefined ? {} : {
          colorSet: flag
        })
      };
      p.settings.geology = {
        legend: [entry]
      };
      const restored = (await decodeBackup((await encodeBackup(p)).bytes)).project.settings.geology.legend[0];
      expect(restored).toEqual(entry);
      expect(Object.hasOwn(restored, 'colorSet')).toBe(flag !== undefined);
    }
  });
  it.each([null, 1, 'true', {}, []])('rejects malformed native geology colorSet %j', async flag => {
    const p = project();
    p.settings.geology = {
      legend: [{
        code: 'QA',
        color: '#123456',
        colorSet: flag
      }]
    };
    await reject(p, 'geology-color-flag');
    await expect(decodeBackup(bytes(envelope(p)))).rejects.toMatchObject({
      code: 'geology-color-flag'
    });
  });
  it('rejects aggregate CR-only record expansion across sixteen bounded-size files', async () => {
    const p = project();
    p.files = Array.from({
      length: 16
    }, (_, index) => ({
      name: `QA-${index}.csv`,
      role: 'unknown',
      cols: {},
      text: '"A,B"\r' + 'x\r'.repeat(30000)
    }));
    await reject(p, 'source-rows');
    await expect(decodeBackup(bytes(envelope(p)))).rejects.toMatchObject({
      code: 'source-rows'
    });
  });
  it.each(['\r', '\n', '\r\n'])('counts native record ending %j once while preserving multicolumn quoted data', async ending => {
    const p = project();
    p.files = [{
      name: 'QA.csv',
      role: 'unknown',
      cols: {},
      text: 'A,B' + ending + ('"x,y","quote""d"' + ending).repeat(60000)
    }];
    expect((await decodeBackup((await encodeBackup(p)).bytes)).project.files).toEqual(p.files);
  });
  it('preserves embedded quoted CR and CRLF characters and doubled quotes without resetting cells', async () => {
    const p = project();
    p.files = [{
      name: 'QA.csv',
      role: 'unknown',
      cols: {},
      text: 'A,B\rQA,"one\rtwo\r\nthree""quoted"\r'
    }];
    expect((await decodeBackup((await encodeBackup(p)).bytes)).project.files).toEqual(p.files);
    p.files[0].text = 'A,B\rQA,"' + 'x\r'.repeat(32769) + '"\r';
    await reject(p, 'source-cell');
  });
  it('uses native first-LF delimiter frequency across an entire CR-only file', async () => {
    const p = project();
    p.files = [{
      name: 'QA.csv',
      role: 'unknown',
      cols: {
        value: 1
      },
      text: 'A;B\r"x,y,z";"ok"\r'
    }];
    // Native counts comma and semicolon twice, retaining comma on the tie.
    // Its header therefore has one column; first-CR sniffing would differ.
    await reject(p, 'columns');
  });
});
