// Shared helpers for the pSEO pipeline. Node ≥18, no runtime deps beyond the
// repo's own (fflate for xlsx). Every network helper fails loudly — a silent
// partial pull is worse than a crash.

import fs from 'node:fs';
import path from 'node:path';

// ── CSV ───────────────────────────────────────────────────────────────────────

export function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(file, rows, headers) {
  const cols = headers || Object.keys(rows[0] || {});
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c])).join(','));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  console.log(`  wrote ${rows.length} rows → ${file}`);
}

export function readCsv(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing input file: ${file}`);
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQ = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') pushField();
    else if (ch === '\n') { pushField(); pushRow(); }
    else if (ch !== '\r') field += ch;
  }
  pushField(); pushRow();
  const headers = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// ── Fetch with retry (loud) ───────────────────────────────────────────────────

export async function fetchText(url, { tries = 3, timeoutMs = 60000, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'ExplorationMaps-pSEO/1.0 (+https://www.explorationmaps.com)', ...headers } });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url.slice(0, 120)}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      console.warn(`  attempt ${attempt}/${tries} failed: ${err.message}`);
      if (attempt < tries) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`FETCH FAILED after ${tries} tries: ${url.slice(0, 160)}\n  ${lastErr?.message}`);
}

export async function fetchJson(url, opts) {
  const text = await fetchText(url, opts);
  try { return JSON.parse(text); }
  catch { throw new Error(`Response was not JSON (first 200 chars): ${text.slice(0, 200)}`); }
}

export async function fetchBuffer(url, { tries = 3, timeoutMs = 120000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'ExplorationMaps-pSEO/1.0' } });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (attempt < tries) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`FETCH FAILED: ${url}\n  ${lastErr?.message}`);
}

// ── Minimal .xlsx reader (via fflate) ─────────────────────────────────────────
// Reads the first worksheet of an xlsx into an array-of-arrays. Handles shared
// strings and inline strings; enough for the TSX issuer workbook.

export async function readXlsxFirstSheet(buf) {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(buf));
  const get = (re) => {
    const key = Object.keys(files).find((k) => re.test(k));
    return key ? strFromU8(files[key]) : null;
  };
  const sharedXml = get(/xl\/sharedStrings\.xml$/);
  const shared = [];
  if (sharedXml) {
    for (const m of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]));
      shared.push(texts.join(''));
    }
  }
  const sheetXml = get(/xl\/worksheets\/sheet1\.xml$/) || get(/xl\/worksheets\/sheet\d+\.xml$/);
  if (!sheetXml) throw new Error('xlsx: no worksheet found');
  const rows = [];
  for (const rm of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1];
      const inner = cm[2];
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] || null;
      const col = ref ? colToIndex(ref) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1] || '';
      let val = '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (type === 's' && v != null) val = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') val = decodeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] || '');
      else if (v != null) val = decodeXml(v);
      cells[col] = val;
    }
    rows.push(cells);
  }
  return rows;
}

function colToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// ── Company-name normalization + scoring ─────────────────────────────────────

const LEGAL_SUFFIXES = /\b(INCORPORATED|INC|LIMITED|LTD|LTEE|LTÉE|CORPORATION|CORP|COMPANY|CO|PLC|SA|AG|NL|LLC|LP|ULC|HOLDINGS?|GROUP)\b\.?/g;
const NOISE_WORDS = new Set(['THE', 'OF', 'AND', '&', 'A']);

export function normalizeName(raw) {
  if (!raw) return '';
  return String(raw)
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')       // strip accents
    .replace(/\([^)]*\)/g, ' ')                              // parentheticals
    .replace(/[^A-Z0-9& ]+/g, ' ')                           // punctuation
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(normalized) {
  return normalized.split(' ').filter((t) => t && !NOISE_WORDS.has(t));
}

// 0–100 similarity between two already-normalized names. Exact = 100; token
// Dice overlap weighted with a prefix bonus. Deterministic and dependency-free.
export function nameScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 100;
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const inter = ta.filter((t) => setB.has(t)).length;
  const dice = (2 * inter) / (ta.length + tb.length);
  let score = Math.round(dice * 90);
  // Prefix bonus: first tokens agree (distinctive part of mining co names)
  if (ta[0] === tb[0]) score += 8;
  if (ta.length >= 2 && tb.length >= 2 && ta[1] === tb[1]) score += 2;
  // Containment (one name fully inside the other) is a strong signal
  if (inter === Math.min(ta.length, tb.length)) score = Math.max(score, 88 + Math.min(inter, 4));
  return Math.min(score, 99); // only literal equality reaches 100
}

// ── Geo helpers ───────────────────────────────────────────────────────────────

export function mercatorX(lng) { return (lng + 180) / 360; }
export function mercatorY(lat) {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

export function geojsonBounds(geojson) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const scan = (coords) => {
    if (typeof coords[0] === 'number') {
      minLng = Math.min(minLng, coords[0]); maxLng = Math.max(maxLng, coords[0]);
      minLat = Math.min(minLat, coords[1]); maxLat = Math.max(maxLat, coords[1]);
    } else coords.forEach(scan);
  };
  for (const f of geojson.features || []) if (f.geometry?.coordinates) scan(f.geometry.coordinates);
  if (!Number.isFinite(minLng)) throw new Error('geojsonBounds: no coordinates');
  return { minLng, minLat, maxLng, maxLat };
}

export function centroidOf(geojson) {
  const b = geojsonBounds(geojson);
  return { lng: (b.minLng + b.maxLng) / 2, lat: (b.minLat + b.maxLat) / 2 };
}

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function fmtHa(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v >= 1000 ? `${Math.round(v).toLocaleString('en-CA')}` : `${Math.round(v * 10) / 10}`;
}

export function slugifyTicker(ticker) {
  return String(ticker).trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/\./g, '-');
}

export function todayIso() { return new Date().toISOString().slice(0, 10); }

// A tenure whose good-to/due date has passed is pending forfeiture, not held —
// the registries still return these rows, so every pull must drop them before
// they reach a published page. Blank/unparseable dates are kept (can't judge).
export function isExpired(goodTo, today = todayIso()) {
  const d = String(goodTo ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today;
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
