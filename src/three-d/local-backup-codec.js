import { STYLE_FONTS, validateFigureStyle } from '../../shared/figureStyle.js';
import { matchCols, roleOf, refineRole, isXYZ, parseXYZ } from './roles.js';
import { pubCols } from './published-results.js';
import { eqFactors } from '../../shared/metalEq.js';
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const BACKUP_LIMITS = {
  depth: 16,
  nodes: 50000,
  entries: 10000,
  files: 100,
  tokens: 200000,
  imageBytes: 3 * 1024 * 1024,
  imagePixels: 4194304,
  allPixels: 8388608
};
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'access_token', 'refresh_token', 'service_role', 'authorization', 'password', 'secret', 'signedURL', 'signedUrl']);
const rejectBackup = code => {
  const e = new Error(`This local backup is unsupported or invalid (${code}). Your current figure has not changed.`);
  e.code = code;
  throw e;
};
const isPlainObject = x => x && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const validateKeys = (x, allowed) => {
  if (!isPlainObject(x) || Object.keys(x).some(k => !allowed.includes(k))) rejectBackup('fields');
};
const validateString = x => {
  if (typeof x !== 'string') rejectBackup('text');
  for (let i = 0; i < x.length; i++) {
    const c = x.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = x.charCodeAt(++i);
      if (!(n >= 0xdc00 && n <= 0xdfff)) rejectBackup('unicode');
    } else if (c >= 0xdc00 && c <= 0xdfff) rejectBackup('unicode');
  }
};
const validateArray = (x, fn) => {
  if (!Array.isArray(x)) rejectBackup('array');
  x.forEach(fn);
};
const validateFiniteNumber = x => {
  if (typeof x !== 'number' || !Number.isFinite(x)) rejectBackup('number');
};
// Structural grammar is checked before constructing the project object. Object
// keys are decoded independently so escaped equivalents cannot hide duplicates.
function validateJsonGrammar(text) {
  let i = 0,
    nodes = 0,
    tokens = 0;
  const ws = () => {
    while (/[\x20\t\r\n]/.test(text[i] || '!')) i++;
  };
  const token = () => {
    if (++tokens > BACKUP_LIMITS.tokens) rejectBackup('complexity');
  };
  const quoted = () => {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '"') {
        let s;
        try {
          s = JSON.parse(text.slice(start, i));
        } catch {
          rejectBackup('json');
        }
        validateString(s);
        return s;
      }
      if (c === '\\') {
        const c2 = text[i++];
        if (c2 === 'u') {
          if (!/^[\da-f]{4}$/i.test(text.slice(i, i + 4))) rejectBackup('json');
          i += 4;
        } else if (!'"\\/bfnrt'.includes(c2)) rejectBackup('json');
      } else if (c.charCodeAt(0) < 32) rejectBackup('json');
    }
    rejectBackup('json');
  };
  const value = depth => {
    ws();
    token();
    if (++nodes > BACKUP_LIMITS.nodes || depth > BACKUP_LIMITS.depth) rejectBackup('complexity');
    const c = text[i];
    if (c === '"') {
      quoted();
      return;
    }
    if (c === '{' || c === '[') {
      i++;
      const end = c === '{' ? '}' : ']',
        seen = new Set();
      let count = 0;
      ws();
      if (text[i] === end) {
        i++;
        return;
      }
      while (i < text.length) {
        if (++count > BACKUP_LIMITS.entries) rejectBackup('complexity');
        if (c === '{') {
          ws();
          if (text[i] !== '"') rejectBackup('json');
          const key = quoted();
          token();
          if (seen.has(key)) rejectBackup('duplicate-key');
          seen.add(key);
          if (FORBIDDEN_KEYS.has(key)) rejectBackup('unsafe-field');
          ws();
          if (text[i++] !== ':') rejectBackup('json');
        }
        value(depth + 1);
        ws();
        if (text[i] === end) {
          i++;
          return;
        }
        if (text[i++] !== ',') rejectBackup('json');
      }
      rejectBackup('json');
    }
    const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!m) rejectBackup('json');
    i += m[0].length;
  };
  value(0);
  ws();
  if (i !== text.length) rejectBackup('json');
}
function validatePlainData(root) {
  let nodes = 0,
    totalChars = 0;
  const walk = (x, depth) => {
    if (++nodes > BACKUP_LIMITS.nodes || depth > BACKUP_LIMITS.depth) rejectBackup('complexity');
    if (typeof x === 'string') {
      validateString(x);
      totalChars += x.length;
      if (totalChars > MAX_BACKUP_BYTES) rejectBackup('size');
      return;
    }
    if (typeof x === 'number') {
      validateFiniteNumber(x);
      return;
    }
    if (x === null || typeof x === 'boolean') return;
    if (!Array.isArray(x) && !isPlainObject(x)) rejectBackup('plain-data');
    if (Array.isArray(x) && (x.length > BACKUP_LIMITS.entries || Object.keys(x).length !== x.length)) rejectBackup('complexity');
    if (Object.values(Object.getOwnPropertyDescriptors(x)).some(d => d.get || d.set)) rejectBackup('plain-data');
    const pairs = Object.entries(x);
    if (pairs.length > BACKUP_LIMITS.entries) rejectBackup('complexity');
    for (const [k, v] of pairs) {
      validateString(k);
      if (FORBIDDEN_KEYS.has(k)) rejectBackup('unsafe-field');
      if (v === undefined && !Array.isArray(x)) continue;
      walk(v, depth + 1);
    }
  };
  walk(root, 0);
}
const fieldNames = words => words.split(' ');
const TEXT = fieldNames('title subtitle valueLabel terrain terrainSource collarFit blockStyle calloutMode coPlacement projection primary accent company footnote format view insetStyle');
const BOOL = fieldNames('walls ids inset ribbons pendingLabels pendingNoAssays elevTicks grid lockView autoLabels dropShadow credit histograms');
const NUM = fieldNames('coCount coMin coCut coIncl secAz secW surf traceWidth vex');
const NULLNUM = fieldNames('displayCutoff blockMargin secActive');
const NULLTEXT = fieldNames('valueCol valueCol2 crs');
const RECORDS = {
  scene: 'sunAz sunAlt shadow ao haze theme edge',
  imagery: 'saturation contrast warmth relief',
  mapInfo: 'use what project date sources',
  geophys: 'mode lines ramp log min max opacity faces search width property label unit note',
  crew: 'on at scale heading',
  shell: 'enabled cutoff opacity color search cell throughTerrain shading shells ramp',
  geology: 'enabled title faces opacity strength hidden anisotropy search smooth texture section legend images note contacts labels clean fits blend fade fadeDir dash labelStyle',
  tags: 'at style status fadePrevious newLabel prevLabel plannedLabel groups autoGroup groupRadius emphasis highlight highlightNew idMode showId showTag hideRows pending',
  legend: 'merge pos',
  block: 'furniture traces brackets page info hist units surface fadeBottom colors ticks ends pad legend inclFrom scale scaleNote',
  eq: 'base baseCol baseUnit basePrice baseRecovery metals'
};
const EXTRA = fieldNames('logo meshes labels wallLabels section sections holesShown blockExtent provisional pubOverrides coOverrides libRefs drillSource brandStyle designVersion designOptIn bins overlays shapes');
const supportedRoles = fieldNames('collar survey assay topo mesh litho lithlegend geophys overlay published unknown');
const validateRecordKeys = (value, allowed) => {
  validateKeys(value, fieldNames(allowed));
};
const RECORD_TYPES = {
  scene: {
    n: 'sunAz sunAlt shadow ao haze',
    s: 'theme edge'
  },
  imagery: {
    n: 'saturation contrast warmth relief'
  },
  mapInfo: {
    s: 'use what project date sources'
  },
  geophys: {
    s: 'mode ramp property label unit note',
    n: 'min max opacity search width',
    b: 'log'
  },
  crew: {
    s: 'at',
    n: 'scale heading',
    b: 'on'
  },
  shell: {
    n: 'cutoff opacity search cell',
    s: 'color shading ramp',
    b: 'enabled throughTerrain'
  },
  geology: {
    s: 'title hidden note fadeDir labelStyle',
    n: 'opacity strength anisotropy search smooth blend fade',
    b: 'enabled texture section contacts labels clean dash'
  },
  tags: {
    s: 'at style newLabel prevLabel plannedLabel emphasis idMode pending',
    n: 'groupRadius',
    b: 'fadePrevious autoGroup highlightNew'
  },
  legend: {
    s: 'merge'
  },
  block: {
    s: 'traces brackets page info units surface ticks scale scaleNote',
    n: 'fadeBottom',
    b: 'furniture ends inclFrom'
  },
  eq: {
    s: 'base baseCol baseUnit',
    n: 'basePrice baseRecovery'
  }
};
function validateSettings(s) {
  validateKeys(s, [...TEXT, ...BOOL, ...NUM, ...NULLNUM, ...NULLTEXT, ...Object.keys(RECORDS), ...EXTRA]);
  // Rendered text has its own expansion budget. Raw scientific files are not
  // visited here, and image bytes are validated by the explicit image boundary.
  let renderedCharacters = 0;
  const renderedText = (value, path = 'settings') => {
    if (typeof value === 'string') {
      if (path === 'settings.logo.$image' || /^settings\.geology\.images\.(N|E|S|W|section)$/.test(path)) return;
      if (value.length > 4096 || (renderedCharacters += value.length) > 32768) rejectBackup('rendered-text');
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) renderedText(child, path + '.' + key);
    }
  };
  renderedText(s);
  for (const [k, v] of Object.entries(s)) {
    if (TEXT.includes(k)) validateString(v);else if (BOOL.includes(k)) {
      if (typeof v !== 'boolean') rejectBackup('boolean');
    } else if (NUM.includes(k)) validateFiniteNumber(v);else if (NULLTEXT.includes(k)) {
      if (v !== null) validateString(v);
    } else if (NULLNUM.includes(k)) {
      if (v !== null && (k === 'secActive' ? typeof v !== 'string' : typeof v !== 'number')) rejectBackup('setting-type');
    } else if (RECORDS[k] && v !== null) validateRecordKeys(v, RECORDS[k]);
  }
  for (const [settingName, types] of Object.entries(RECORD_TYPES)) {
    const record = s[settingName];
    if (!record) continue;
    for (const [type, names] of Object.entries(types)) {
      for (const name of fieldNames(names)) {
        const value = record[name];
        if (value === undefined || value === null) continue;
        if (type === 'n') {
          validateFiniteNumber(value);
        } else if (type === 's') {
          validateString(value);
        } else if (typeof value !== 'boolean') {
          rejectBackup('boolean');
        }
      }
    }
  }
  if (s.tags) {
    for (const [k, type] of [['status', 'string'], ['highlight', 'string'], ['showId', 'boolean'], ['showTag', 'boolean']]) if (s.tags[k]) {
      if (!isPlainObject(s.tags[k])) rejectBackup('tag-map');
      for (const v of Object.values(s.tags[k])) if (v !== null && typeof v !== type) rejectBackup('tag-map');
    }
    if (s.tags.groups) validateArray(s.tags.groups, g => validateArray(g, validateString));
    if (s.tags.hideRows) validateArray(s.tags.hideRows, validateString);
  }
  if (s.legend?.pos) {
    validateKeys(s.legend.pos, ['main', 'lithology', 'geophys']);
    for (const v of Object.values(s.legend.pos)) {
      if (v !== null && typeof v !== 'string') {
        validateKeys(v, ['x', 'y']);
        validateFiniteNumber(v.x);
        validateFiniteNumber(v.y);
      }
    }
  }
  if (s.block?.colors) {
    if (!isPlainObject(s.block.colors)) rejectBackup('block-colors');
    Object.values(s.block.colors).forEach(validateString);
  }
  if (s.block?.legend) {
    validateKeys(s.block.legend, fieldNames('assay geology holes bracket'));
    Object.values(s.block.legend).forEach(v => {
      if (v !== null) validateString(v);
    });
  }
  if (s.geology?.fits) {
    validateKeys(s.geology.fits, fieldNames('N E S W section'));
    for (const f of Object.values(s.geology.fits)) {
      validateKeys(f, ['points']);
      validateArray(f.points, p => {
        validateKeys(p, fieldNames('px d z hole depth'));
        if (!Array.isArray(p.px) || p.px.length !== 2) rejectBackup('image-fit');
        p.px.forEach(validateFiniteNumber);
        for (const k of ['d', 'z', 'depth']) if (p[k] !== undefined) validateFiniteNumber(p[k]);
        if (p.hole !== undefined) validateString(p.hole);
      });
    }
  }
  if (s.blockExtent !== undefined && s.blockExtent !== null) {
    validateKeys(s.blockExtent, fieldNames('x0 x1 y0 y1 z0'));
    Object.values(s.blockExtent).forEach(validateFiniteNumber);
  }
  if (s.designVersion !== undefined && (!Number.isInteger(s.designVersion) || s.designVersion < 1 || s.designVersion > 5)) rejectBackup('design-version');
  for (const k of ['bins', 'designOptIn']) if (s[k] !== undefined) validateArray(s[k], k === 'bins' ? validateFiniteNumber : validateString);
  for (const k of ['overlays', 'shapes']) if (s[k] !== undefined && s[k].length) rejectBackup('unsupported-geometry-settings');
  for (const k of ['meshes', 'provisional', 'pubOverrides', 'coOverrides', 'libRefs']) if (s[k] !== undefined && !isPlainObject(s[k])) rejectBackup('setting-object');
  let overrideSteps = 0;
  for (const field of ['coOverrides', 'pubOverrides']) {
    for (const override of Object.values(s[field] || {})) {
      validateRecordKeys(override, 'show line1 line2 incl heading placement x y dx dy at at2');
      for (const key of ['show', 'incl']) if (override[key] !== undefined && typeof override[key] !== 'boolean') rejectBackup('callout-flag');
      for (const key of ['line1', 'line2', 'heading']) if (override[key] !== undefined) validateString(override[key]);
      for (const key of ['x', 'y', 'dx', 'dy']) if (override[key] !== undefined) validateFiniteNumber(override[key]);
      for (const key of ['at', 'at2']) {
        const intervals = override[key];
        if (intervals === undefined) continue;
        if (!Array.isArray(intervals) || ![2, 4].includes(intervals.length)) rejectBackup('callout-interval');
        for (let index = 0; index < intervals.length; index += 2) {
          const from = intervals[index],
            to = intervals[index + 1];
          validateFiniteNumber(from);
          validateFiniteNumber(to);
          if (from < 0 || to < from || to > 20000) rejectBackup('callout-interval');
          overrideSteps += Math.max(1, Math.ceil((to - from) / 2));
          if (overrideSteps > 100000) rejectBackup('callout-complexity');
        }
      }
    }
  }
  for (const m of Object.values(s.meshes || {})) validateRecordKeys(m, 'color show opacity');
  for (const m of Object.values(s.libRefs || {})) validateRecordKeys(m, 'libFileId version');
  if (s.drillSource) {
    validateRecordKeys(s.drillSource, 'kind propertyId propertyName latestBatchId latestAt holes assays crs geologySource geologyIntervals resultsRecipe');
    if (s.drillSource.resultsRecipe) validateRecordKeys(s.drillSource.resultsRecipe, 'name version fileName id recipe source');
  }
  const labelIds = new Set();
  const textField = (value, max) => {
    validateString(value);
    if (!value.trim() || value.length > max) rejectBackup('label-text');
  };
  const finiteRange = (value, min, max) => {
    validateFiniteNumber(value);
    if (value < min || value > max) rejectBackup('label-range');
  };
  const labelId = (label, prefix) => {
    validateString(label.id);
    if (label.id.length > 100 || labelIds.has(prefix + label.id)) rejectBackup('label-id');
    labelIds.add(prefix + label.id);
  };
  if (s.labels !== undefined) {
    if (!Array.isArray(s.labels) || s.labels.length > 200) rejectBackup('label-count');
    validateArray(s.labels, label => {
      validateRecordKeys(label, 'id text size x y arrow ax ay aw color rotation pinned kind rows');
      labelId(label, 'label:');
      textField(label.text, 200);
      if (!['title', 'normal'].includes(label.size)) rejectBackup('label-size');
      for (const key of ['x', 'y']) finiteRange(label[key], 0, 1);
      for (const key of ['ax', 'ay']) if (label[key] !== undefined && label[key] !== null) finiteRange(label[key], 0, 1);
      if (label.arrow !== undefined && typeof label.arrow !== 'boolean') rejectBackup('label-arrow');
      if (label.pinned !== undefined && typeof label.pinned !== 'boolean') rejectBackup('label-pinned');
      if (label.aw !== undefined && label.aw !== null) {
        if (!Array.isArray(label.aw) || label.aw.length !== 3) rejectBackup('label-anchor');
        label.aw.forEach(validateFiniteNumber);
      }
      if (label.kind !== undefined && label.kind !== 'stat') rejectBackup('label-kind');
      if (label.rows !== undefined) {
        if (!Array.isArray(label.rows) || label.rows.length > 12) rejectBackup('label-rows');
        label.rows.forEach(row => textField(row, 120));
      }
    });
  }
  if (s.wallLabels !== undefined) {
    if (!Array.isArray(s.wallLabels) || s.wallLabels.length > 8) rejectBackup('wall-label-count');
    validateArray(s.wallLabels, label => {
      validateRecordKeys(label, 'id text face u v size scale rotation color unit');
      labelId(label, 'wall:');
      textField(label.text, 120);
      if (!['N', 'E', 'S', 'W'].includes(label.face)) rejectBackup('wall-label-face');
      if (!['title', 'normal', 'heading'].includes(label.size)) rejectBackup('wall-label-size');
      for (const key of ['u', 'v']) finiteRange(label[key], 0, 1);
      if (label.scale !== undefined) finiteRange(label.scale, 0.4, 3);
      if (label.rotation !== undefined) finiteRange(label.rotation, -90, 90);
      if (label.color !== undefined && label.color !== null && !/^#[0-9a-f]{6}$/i.test(label.color)) rejectBackup('wall-label-color');
      if (label.unit !== undefined && label.unit !== null) validateString(label.unit);
    });
  }
  if (s.holesShown !== undefined && s.holesShown !== null) validateArray(s.holesShown, validateString);
  const point = p => {
    validateKeys(p, ['x', 'y']);
    validateFiniteNumber(p.x);
    validateFiniteNumber(p.y);
  };
  if (s.section !== undefined && s.section !== null) {
    validateRecordKeys(s.section, 'holes a b');
    if (s.section.holes) validateArray(s.section.holes, validateString);
    if (s.section.a) {
      point(s.section.a);
      point(s.section.b);
    }
  }
  if (s.sections !== undefined && s.sections !== null) validateArray(s.sections, e => {
    validateRecordKeys(e, 'id name az width a b holes fence opacity');
    if (e.a) {
      point(e.a);
      point(e.b);
    }
    if (e.holes) validateArray(e.holes, validateString);
  });
  if (s.eq) {
    if (!isPlainObject(s.eq.metals)) rejectBackup('metal-settings');
    const components = Object.entries(s.eq.metals);
    if (!components.length || components.length > 16) rejectBackup('equivalent-components');
    validateString(s.eq.base);
    validateString(s.eq.baseCol);
    if (!s.eq.base.trim() || !s.eq.baseCol.trim()) rejectBackup('metal-settings');
    const priceAndRecovery = (price, recovery) => {
      validateFiniteNumber(price);
      validateFiniteNumber(recovery);
      if (!(price > 0) || !(recovery > 0 && recovery <= 100)) rejectBackup('equivalent-assumptions');
    };
    priceAndRecovery(s.eq.basePrice, s.eq.baseRecovery);
    const metals = components.map(([metal, component]) => {
      validateRecordKeys(component, 'col unit price recovery');
      validateString(component.col);
      if (!metal.trim() || metal.length > 80 || !component.col.trim()) rejectBackup('metal-settings');
      if (component.unit !== undefined && component.unit !== null) validateString(component.unit);
      priceAndRecovery(component.price, component.recovery);
      return {
        metal,
        unit: component.unit,
        price: component.price,
        recovery: component.recovery
      };
    });
    // Use native pure unit/factor semantics, but never write the derived
    // factors or a normalized recipe back into the supplied scientific data.
    try {
      const factors = eqFactors({
        metal: s.eq.base,
        unit: s.eq.baseUnit,
        price: s.eq.basePrice,
        recovery: s.eq.baseRecovery
      }, metals);
      if (factors.some(component => !Number.isFinite(component.factor) || component.factor <= 0)) rejectBackup('equivalent-factors');
    } catch {
      rejectBackup('equivalent-factors');
    }
  }
  if (s.block?.hist) validateRecordKeys(s.block.hist, 'side scale halo length palette style width');
  if (s.shell?.shells) {
    if (!Array.isArray(s.shell.shells) || s.shell.shells.length > 3) rejectBackup('shell-count');
    validateArray(s.shell.shells, shell => {
      validateRecordKeys(shell, 'cutoff color label');
      validateFiniteNumber(shell.cutoff);
      if (shell.cutoff <= 0 || shell.cutoff > 1e9) rejectBackup('shell-cutoff');
      if (shell.color !== undefined && shell.color !== null && !/^#[0-9a-f]{6}$/i.test(shell.color)) rejectBackup('shell-color');
      if (shell.label !== undefined && shell.label !== null) validateString(shell.label);
    });
  }
  for (const [record, named] of [[s.geology, ['far', 'near', 'all']], [s.geophys, ['far', 'all']]]) {
    const faces = record?.faces;
    if (faces === undefined) continue;
    if (Array.isArray(faces)) {
      if (faces.length > 4 || faces.some(face => !['N', 'E', 'S', 'W'].includes(face))) rejectBackup('faces');
    } else if (!named.includes(faces)) rejectBackup('faces');
  }
  if (s.geophys?.lines !== undefined) {
    const lines = s.geophys.lines;
    if (Array.isArray(lines)) {
      if (lines.length > 16) rejectBackup('geophys-lines');
      for (const line of lines) {
        if (typeof line === 'string' || typeof line === 'number') continue;
        validateRecordKeys(line, 'id from to x0 y0 x1 y1');
        if (line.id !== undefined) validateString(line.id);
        if (line.from || line.to) {
          for (const point of [line.from, line.to]) {
            if (!Array.isArray(point) || point.length !== 2) rejectBackup('geophys-line');
            point.forEach(validateFiniteNumber);
          }
        } else {
          for (const key of ['x0', 'y0', 'x1', 'y1']) validateFiniteNumber(line[key]);
        }
      }
    } else if (!['auto', 'section', 'all'].includes(lines)) rejectBackup('geophys-lines');
  }
  if (s.geology?.legend) validateArray(s.geology.legend, entry => {
    validateRecordKeys(entry, 'code name nameSet color colorSet order pattern show');
    if (entry.colorSet !== undefined && typeof entry.colorSet !== 'boolean') rejectBackup('geology-color-flag');
  });
  const range = (x, lo, hi) => {
    validateFiniteNumber(x);
    if (x < lo || x > hi) rejectBackup('setting-range');
  };
  for (const [k, lo, hi] of [['vex', 1, 5], ['traceWidth', 0.5, 3], ['surf', 0.15, 1], ['blockMargin', 0, 20000], ['coCount', 0, 100], ['secW', 5, 5000]]) if (s[k] !== undefined && s[k] !== null) range(s[k], lo, hi);
  const enums = {
    format: ['slide', 'release', 'square', 'portrait', 'a4'],
    view: ['3d', 'section'],
    terrainSource: ['auto', 'topo', 'dem', 'collars'],
    projection: ['perspective', 'orthographic'],
    collarFit: ['collars', 'terrain'],
    blockStyle: ['glass', 'solid'],
    calloutMode: ['calculated', 'manual', 'published'],
    insetStyle: ['plan', 'satellite', 'topo', 'claims']
  };
  for (const [k, allowed] of Object.entries(enums)) if (s[k] !== undefined && !allowed.includes(s[k])) rejectBackup('setting-enum');
  for (const [k, lo, hi] of [['opacity', 0.1, 1], ['anisotropy', 1, 20], ['search', 0, 20000], ['smooth', 0, 8], ['strength', 0.5, 2]]) if (s.geology?.[k] !== undefined && s.geology[k] !== null) range(s.geology[k], lo, hi);
  for (const [k, lo, hi] of [['cutoff', 0, 1e9], ['search', 5, 5000], ['cell', 2, 200], ['opacity', 0.05, 0.9]]) if (s.shell?.[k] !== undefined && s.shell[k] !== null) range(s.shell[k], lo, hi);
  if (s.brandStyle !== undefined && s.brandStyle !== null) {
    validateKeys(s.brandStyle, fieldNames('brandKitId brandRevision mode style fonts'));
    for (const k of ['brandKitId', 'brandRevision']) if (s.brandStyle[k] !== undefined && s.brandStyle[k] !== null) validateString(s.brandStyle[k]);
    if (!['style', 'full'].includes(s.brandStyle.mode)) rejectBackup('brand-style');
    if (s.brandStyle.fonts) {
      validateKeys(s.brandStyle.fonts, ['sans', 'narrow', 'mono']);
      for (const f of Object.values(s.brandStyle.fonts)) if (!STYLE_FONTS.includes(f)) rejectBackup('font');
    }
    if (s.brandStyle.style) {
      const st = s.brandStyle.style;
      validateKeys(st, fieldNames('version colours type logo panel spacing sourceNote'));
      for (const [k, allowed] of Object.entries({
        colours: 'primary accent ink muted panel panelBorder',
        type: 'title subtitle label note',
        logo: 'assetRef placement',
        panel: 'radius padding shadow',
        spacing: 'margin gap',
        sourceNote: 'position italic prefix'
      })) if (st[k]) validateKeys(st[k], fieldNames(allowed));
      if (st.type) for (const v of Object.values(st.type)) validateKeys(v, fieldNames('family weight size'));
      const check = structuredClone(st);
      if (check.logo?.assetRef === 'figure:logo') check.logo.assetRef = null;
      if (!validateFigureStyle(check).ok) rejectBackup('brand-style');
    }
  }
}
function validateSourceComplexity(files, settings) {
  let lines = 0,
    cells = 0,
    vertices = 0,
    faces = 0,
    intervalSteps = 0,
    equivalentWork = 0;
  const equivalentComponents = Object.keys(settings.eq?.metals || {}).length;
  const depths = new Map(),
    collars = new Set(),
    geologyCodes = new Set((settings.geology?.legend || []).map(row => row.code)),
    geophysLines = new Set();
  if (geologyCodes.size > 32) rejectBackup('geology-categories');
  const validateGeometryRow = (row, mapping, role, categoryIndex, lineIndex) => {
    if (categoryIndex !== undefined && String(row[categoryIndex] || '').trim()) {
      geologyCodes.add(String(row[categoryIndex]).trim());
      if (geologyCodes.size > 32) rejectBackup('geology-categories');
    }
    if (settings.geophys?.mode === 'curtain' && ['auto', 'all'].includes(settings.geophys.lines || 'auto') && lineIndex !== undefined) {
      geophysLines.add(String(row[lineIndex] || ''));
      if (geophysLines.size > 16) rejectBackup('geophys-lines');
    }
    if (!['collar', 'survey', 'assay', 'published'].includes(role)) return;
    const id = (row[mapping.hole] || '').trim();
    if (!id) return;
    if (role === 'collar') {
      collars.add(id);
      for (const key of ['east', 'north', 'elev', 'lat', 'lon']) {
        const value = parseFloat(String(row[mapping[key]] || '').trim().replace(/^</, ''));
        if (Number.isFinite(value) && Math.abs(value) > 1e9) rejectBackup('geometry-range');
      }
    }
    for (const key of ['assay', 'published'].includes(role) ? ['from', 'to'] : ['depth']) {
      const text = String(row[mapping[key]] || '');
      const value = parseFloat(text.trim().replace(/^</, ''));
      if (Number.isFinite(value)) {
        if (value < 0 || value > 20000) rejectBackup('trajectory-depth');
        depths.set(id, Math.max(depths.get(id) || 0, value));
      } else if (/^[+-]?(?:\d|\.)/.test(text)) {
        rejectBackup('trajectory-depth');
      }
    }
    if (['assay', 'published'].includes(role)) {
      const from = parseFloat(String(row[mapping.from] || '').trim().replace(/^</, ''));
      const to = parseFloat(String(row[mapping.to] || '').trim().replace(/^</, ''));
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
        intervalSteps += Math.ceil((to - from) / 2);
        if (intervalSteps > 100000) rejectBackup('interval-complexity');
        if (role === 'assay') {
          equivalentWork += equivalentComponents;
          if (equivalentWork > 400000) rejectBackup('equivalent-work');
        }
      }
    }
  };
  const effectiveFile = (header, sampleRows, file) => {
    // Match studio.addFiles then loadProject: first derive from actual headers
    // and row samples, then apply supported saved manual maps and role.
    // refineRole itself samples the first 300 rows; no duplicate alias regexes.
    const entry = {
      header,
      rows: sampleRows,
      cols: matchCols(header),
      ...(Object.hasOwn(file, 'geophysNumericPolicy') ? {
        geophysNumericPolicy: file.geophysNumericPolicy
      } : {})
    };
    const derivedRole = file.role === 'published' ? 'published' : refineRole(entry, roleOf(entry.cols, file.name), file.name);
    let mapping = file.cols === undefined ? entry.cols : file.cols;
    const role = file.role || derivedRole;
    if (role === 'published') mapping = pubCols(header, mapping);
    for (const index of Object.values(mapping)) if (index >= header.length) rejectBackup('columns');
    return {
      mapping,
      role,
      category: ['litho', 'lithlegend'].includes(role) ? mapping.code : undefined,
      line: role === 'geophys' ? mapping.line : undefined
    };
  };
  for (const f of files) {
    if (/\.(?:geojson|json|kml)$/i.test(f.name) || f.role === 'overlay' || /^\s*(<\?xml[^>]*>\s*)?<kml|^\s*\{[\s\S]{0,300}"Feature/.test(f.text.slice(0, 400))) rejectBackup('unsupported-overlay-file');
    if (/\.obj$/i.test(f.name)) {
      // Incremental line scan: do not split a hostile file into millions of strings.
      let start = 0;
      for (let i = 0; i <= f.text.length; i++) if (i === f.text.length || f.text[i] === '\n') {
        if (++lines > 100000) rejectBackup('source-rows');
        const line = f.text.slice(start, i).trim();
        start = i + 1;
        if (line.length > 65536) rejectBackup('source-cell');
        if (/^v\s/.test(line)) {
          if (++vertices > 25000) rejectBackup('mesh-complexity');
          const values = line.split(/\s+/).slice(1);
          if (values.length !== 3 || values.some(x => !Number.isFinite(Number(x)) || Math.abs(Number(x)) > 1e9)) rejectBackup('mesh-coordinates');
        } else if (/^f\s/.test(line)) {
          if (++faces > 25000) rejectBackup('mesh-complexity');
          const parts = line.split(/\s+/).slice(1);
          if (parts.length > 8) rejectBackup('mesh-complexity');
          if (parts.length < 3 || parts.some(x => !/^[-+]?\d+(?:\/[-+]?\d*){0,2}$/.test(x) || Math.abs(Number(x.split('/')[0])) > 25000 || Number(x.split('/')[0]) === 0)) rejectBackup('mesh-indices');
        }
      }
      continue;
    }
    // The shared XYZ sniff/parser split lines internally. Bound physical rows
    // first so even an empty-line bomb cannot allocate an unbounded line array.
    let physicalRows = 1;
    for (let i = 0; i < f.text.length; i++) {
      if (f.text[i] === '\r' || f.text[i] === '\n') {
        if (f.text[i] === '\r' && f.text[i + 1] === '\n') i++;
        if (++physicalRows > 100000) rejectBackup('source-rows');
      }
    }
    // Match native parseCSV's first-LF-segment sniff, including CR-only files,
    // without allocating one split array per possible delimiter. A CR-only
    // file's native sniff includes its entire text, so using only its first
    // physical row here could select a different parser from the live loader.
    const xyz = isXYZ(f.name, f.text);
    const counts = [',', ';', '\t'].map(delimiter => [delimiter, 1]);
    for (let index = 0; index < f.text.length && f.text[index] !== '\n'; index++) {
      for (const count of counts) if (f.text[index] === count[0]) count[1]++;
    }
    counts.sort((a, b) => b[1] - a[1]);
    const delimiter = counts[0][0];
    let quoted = false,
      cols = 1,
      cellChars = 0;
    for (let i = 0; i < f.text.length; i++) {
      const c = f.text[i];
      if (++cellChars > 65536) rejectBackup('source-cell');
      if (c === '\r' || c === '\n') {
        if (++lines > 100000) rejectBackup('source-rows');
        if (xyz || !quoted) {
          if (cols > 128) rejectBackup('source-columns');
          cells += cols;
          if (cells > 400000) rejectBackup('source-cells');
          cols = 1;
          cellChars = 0;
        } else if (c === '\r' && f.text[i + 1] === '\n') {
          // Native CSV keeps both characters inside a quoted field.
          if (++cellChars > 65536) rejectBackup('source-cell');
        }
        if (c === '\r' && f.text[i + 1] === '\n') i++;
        continue;
      }
      if (c === '"') {
        if (quoted && f.text[i + 1] === '"') {
          i++;
          continue;
        }
        quoted = !quoted;
      } else if (!quoted && (c === delimiter || xyz && /\s/.test(c) && c !== '\n' && i && !/\s/.test(f.text[i - 1]))) {
        if (++cols > 128) rejectBackup('source-columns');
        cellChars = 0;
      }
    }
    if (quoted) rejectBackup('source-quotes');
    if (++lines > 100000 || (cells += cols) > 400000) rejectBackup('source-cells');
    if (xyz) {
      const parsed = parseXYZ(f.text);
      if (parsed.header.length > 128 || parsed.rows.some(row => row.length > 128)) rejectBackup('source-columns');
      if (parsed.rows.reduce((count, row) => count + row.length, 0) > 400000) rejectBackup('source-cells');
      const effective = effectiveFile(parsed.header, parsed.rows.slice(0, 300), f);
      parsed.rows.forEach(row => validateGeometryRow(row, effective.mapping, effective.role, effective.category, effective.line));
    } else {
      let header = null,
        row = [],
        field = '',
        q = false,
        effective = null,
        sampleRows = [];
      const inspect = row => validateGeometryRow(row, effective.mapping, effective.role, effective.category, effective.line);
      const finishSample = () => {
        effective = effectiveFile(header || [], sampleRows, f);
        sampleRows.forEach(inspect);
        sampleRows = [];
      };
      const consume = () => {
        row.push(field);
        field = '';
        // Match studio.parseCSV: blank rows do not become the header.
        if (row.every(value => value.trim() === '')) {
          row = [];
          return;
        }
        if (!header) {
          header = row;
        } else if (effective) {
          inspect(row);
        } else {
          sampleRows.push(row);
          if (sampleRows.length === 300) finishSample();
        }
        row = [];
      };
      for (let i = 0; i < f.text.length; i++) {
        const c = f.text[i];
        if (q) {
          if (c === '"') {
            if (f.text[i + 1] === '"') {
              field += '"';
              i++;
            } else q = false;
          } else field += c;
        } else if (c === '"') q = true;else if (c === delimiter) {
          row.push(field);
          field = '';
        } else if (c === '\r' || c === '\n') {
          if (c === '\r' && f.text[i + 1] === '\n') i++;
          consume();
        } else field += c;
      }
      if (field || row.length) consume();
      if (!effective) finishSample();
    }
  }
  if (collars.size > 1000 || [...collars].reduce((n, id) => n + Math.ceil((depths.get(id) || 200) / 2), 0) > 100000) rejectBackup('trajectory-complexity');
}
function validateEmbeddedImage(url, path, dependencies) {
  validateString(url);
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!m || m[2].length % 4 !== 0 || m[2].length > Math.ceil(BACKUP_LIMITS.imageBytes / 3) * 4) rejectBackup('image-format');
  let raw;
  try {
    raw = atob(m[2]);
  } catch {
    rejectBackup('image-format');
  }
  if (btoa(raw) !== m[2]) rejectBackup('image-format');
  const b = Uint8Array.from(raw, c => c.charCodeAt(0));
  if (b.length > BACKUP_LIMITS.imageBytes) rejectBackup('image-size');
  let w, h;
  if (m[1] === 'png') {
    if (b.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => b[i] === x) || String.fromCharCode(...b.slice(12, 16)) !== 'IHDR') rejectBackup('image-signature');
    const d = new DataView(b.buffer);
    if (d.getUint32(8) !== 13) rejectBackup('image-signature');
    w = d.getUint32(16);
    h = d.getUint32(20);
    let i = 8,
      chunks = 0,
      idat = false,
      end = false;
    while (i + 12 <= b.length) {
      if (++chunks > 2048) rejectBackup('image-complexity');
      const n = d.getUint32(i),
        type = String.fromCharCode(...b.slice(i + 4, i + 8));
      if (n > b.length - i - 12) rejectBackup('image-signature');
      let crc = 0xffffffff;
      for (let k = i + 4; k < i + 8 + n; k++) {
        crc ^= b[k];
        for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
      }
      if ((crc ^ 0xffffffff) >>> 0 !== d.getUint32(i + 8 + n)) rejectBackup('image-checksum');
      if (type === 'IDAT') idat = true;
      if (type === 'IEND') {
        if (n !== 0 || i + 12 !== b.length) rejectBackup('image-signature');
        end = true;
      }
      i += n + 12;
    }
    if (!end || !idat || i !== b.length) rejectBackup('image-signature');
  } else {
    if (b.length < 4 || b[0] !== 255 || b[1] !== 216 || b.at(-2) !== 255 || b.at(-1) !== 217) rejectBackup('image-signature');
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i++] !== 255) rejectBackup('image-signature');
      let marker = b[i++];
      while (marker === 255) marker = b[i++];
      if (marker === 218 || marker === 217) break;
      const n = b[i] << 8 | b[i + 1];
      if (n < 2 || i + n > b.length) rejectBackup('image-signature');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (n < 8) rejectBackup('image-signature');
        h = b[i + 3] << 8 | b[i + 4];
        w = b[i + 5] << 8 | b[i + 6];
        break;
      }
      i += n;
    }
  }
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096 || w * h > BACKUP_LIMITS.imagePixels) rejectBackup('image-dimensions');
  dependencies.embeddedImages.push({
    path,
    mime: 'image/' + m[1],
    decodedBytes: b.length,
    width: w,
    height: h
  });
  if (dependencies.embeddedImages.reduce((n, x) => n + x.width * x.height, 0) > BACKUP_LIMITS.allPixels) rejectBackup('image-pixels');
}
export async function validateBackupProject(p) {
  validatePlainData(p);
  validateKeys(p, fieldNames('v app settings camera usingSample secSet files'));
  if (p.v !== 1 || p.app !== 'Exploration Maps 3D' || !isPlainObject(p.settings) || !Array.isArray(p.files) || p.files.length > BACKUP_LIMITS.files) rejectBackup('project');
  validateSettings(p.settings);
  if (typeof p.usingSample !== 'boolean' || typeof p.secSet !== 'boolean') rejectBackup('project-flags');
  if (p.camera !== null) {
    validateKeys(p.camera, ['azimuth', 'plunge', 'zoom', 'pan']);
    ['azimuth', 'plunge', 'zoom'].forEach(k => validateFiniteNumber(p.camera[k]));
    if (p.camera.zoom < 40 || p.camera.zoom > 100000 || p.camera.plunge < 3 || p.camera.plunge > 89) rejectBackup('camera');
    if (p.camera.pan !== undefined && p.camera.pan !== null) {
      if (!Array.isArray(p.camera.pan) || p.camera.pan.length !== 3) rejectBackup('camera');
      p.camera.pan.forEach(validateFiniteNumber);
    }
  }
  const names = new Set();
  for (const f of p.files) {
    validateKeys(f, fieldNames('name text role cols geophysNumericPolicy'));
    validateString(f.name);
    validateString(f.text);
    if (!f.name || f.name.length > 300 || names.has(f.name)) rejectBackup('file-name');
    names.add(f.name);
    if (f.role !== undefined && !supportedRoles.includes(f.role)) rejectBackup('file-role');
    if (f.role === 'mesh' && !/\.obj$/i.test(f.name)) rejectBackup('file-role');
    if (f.cols !== undefined) {
      if (!isPlainObject(f.cols)) rejectBackup('columns');
      for (const n of Object.values(f.cols)) if (!Number.isSafeInteger(n) || n < 0 || n > 10000) rejectBackup('columns');
    }
    if (Object.hasOwn(f, 'geophysNumericPolicy') && f.geophysNumericPolicy !== null && (typeof f.geophysNumericPolicy !== 'string' || f.geophysNumericPolicy.length > 80)) rejectBackup('policy');
  }
  validateSourceComplexity(p.files, p.settings);
  const dependencies = {
    embeddedImages: [],
    externalDependencies: [],
    sourceReferences: []
  };
  const images = (v, path) => {
    if (!v || typeof v !== 'object') return;
    if (Object.hasOwn(v, '$image')) {
      if (path !== 'settings.logo') rejectBackup('image-path');
      validateKeys(v, ['$image']);
      validateEmbeddedImage(v.$image, path, dependencies);
      return;
    }
    for (const [k, x] of Object.entries(v)) images(x, path + '.' + k);
  };
  images(p.settings, 'settings');
  if (p.settings.logo !== undefined && p.settings.logo !== null && !Object.hasOwn(p.settings.logo, '$image')) rejectBackup('image-format');
  if (p.settings.geology?.images !== undefined) {
    validateKeys(p.settings.geology.images, fieldNames('N E S W section'));
    for (const [k, v] of Object.entries(p.settings.geology.images)) validateEmbeddedImage(v, 'settings.geology.images.' + k, dependencies);
  }
  const s = p.settings,
    add = (kind, path, provider) => dependencies.externalDependencies.push({
      kind,
      path,
      provider
    });
  if (s.crs && (s.terrainSource === 'dem' || s.terrainSource === 'auto' && !p.files.some(f => f.role === 'topo'))) add('dem', 'settings.terrainSource', 'normal terrain provider');
  if (['satellite', 'muted'].includes(s.terrain)) add('imagery', 'settings.terrain', 'normal imagery provider');
  if (['satellite', 'topo'].includes(s.insetStyle)) add('insetTiles', 'settings.insetStyle', 'normal inset provider');
  if (s.brandStyle?.fonts?.sans) {
    if (!STYLE_FONTS.includes(s.brandStyle.fonts.sans)) rejectBackup('font');
    add('font', 'settings.brandStyle.fonts.sans', s.brandStyle.fonts.sans);
  }
  if (Object.keys(s.libRefs || {}).length) dependencies.sourceReferences.push({
    kind: 'library',
    path: 'settings.libRefs'
  });
  if (s.drillSource) dependencies.sourceReferences.push({
    kind: 'property',
    path: 'settings.drillSource'
  });
  return dependencies;
}
const envelopeKeys = fieldNames('format version kind producerRevision createdAt name project');
export async function decodeBackup(input) {
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) rejectBackup('input');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_BACKUP_BYTES) rejectBackup('size');
  let text;
  try {
    text = new TextDecoder('utf-8', {
      fatal: true
    }).decode(bytes);
  } catch {
    rejectBackup('utf8');
  }
  validateJsonGrammar(text);
  let e;
  try {
    e = JSON.parse(text);
  } catch {
    rejectBackup('json');
  }
  validateKeys(e, envelopeKeys);
  if (e.format !== 'exploration-maps-project' || e.version !== 1 || e.kind !== '3d') rejectBackup('version');
  for (const k of ['name', 'producerRevision', 'createdAt']) validateString(e[k]);
  if (e.name.length > 200 || e.producerRevision.length > 120 || e.createdAt.length > 40) rejectBackup('metadata');
  const dependencies = await validateBackupProject(e.project);
  return {
    project: e.project,
    name: e.name,
    dependencies
  };
}
export async function encodeBackup(project, {
  name = '3D figure',
  producerRevision = '',
  createdAt = new Date().toISOString()
} = {}) {
  await validateBackupProject(project);
  const e = {
    format: 'exploration-maps-project',
    version: 1,
    kind: '3d',
    producerRevision,
    createdAt,
    name,
    project
  };
  validatePlainData(e);
  const bytes = new TextEncoder().encode(JSON.stringify(e));
  if (bytes.byteLength > MAX_BACKUP_BYTES) rejectBackup('size');
  const decoded = await decodeBackup(bytes);
  const stem = name.replace(/[^\p{L}\p{N}._ -]/gu, '').trim().slice(0, 80) || '3D figure';
  return {
    bytes,
    filename: stem + '.emap-project.json',
    summary: {
      name: decoded.name,
      dependencies: decoded.dependencies
    }
  };
}
