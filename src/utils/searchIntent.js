// What a claim search query is, before it reaches a registry.
//
// Search telemetry (Oct–Nov 2026) showed a steady share of empty searches that
// were never going to match a holder or claim number: coordinates pasted from
// a report ("49.494891, -117.290039"), NTS map sheets ("33A08", "082J002"),
// Ontario cell IDs ("41I11C177") and claim numbers typed into the company box.
// None of those is a registry field, but each names a PLACE, and the Nearby
// Claims tool answers "what is staked here" for a place. This module reads the
// query so the search panel can offer that instead of "no claims found".

import { parseClaimNumbers } from '../../shared/claimNumbers.js';

// Decimal lat/lng, either order, comma/space/semicolon separated. Kept to the
// part of the world the registries cover (Canada and the western US) so a
// stray pair of numbers is not read as a location.
export function parseLatLng(raw) {
  const m = String(raw ?? '').trim().match(/^\(?\s*(-?\d{1,3}\.\d+)\s*°?\s*[NS]?\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*°?\s*[EW]?\s*\)?$/i);
  if (!m) return null;
  let a = Number(m[1]);
  let b = Number(m[2]);
  // "-117.29, 49.49" — longitude first.
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a];
  // Western hemisphere written without the minus sign: "49.49, 117.29" or
  // "49.49 N, 117.29 W". Nothing these registries cover is east of Greenwich.
  const lat = a;
  const lng = b >= 50 && b <= 170 ? -b : b;
  if (lat < 24 || lat > 84 || lng < -170 || lng > -50) return null;
  return { lat, lng };
}

// NTS letter areas and sheets both number in a snake from the south-east
// corner of a 4 × 4 grid: A–D (1–4) run east to west along the bottom row,
// E–H (5–8) west to east above it, and so on.
function snake(index) {
  const row = Math.floor(index / 4);
  const pos = index % 4;
  return { row, colFromEast: row % 2 === 0 ? pos : 3 - pos };
}

// South-west corner and size of an NTS area, for series rows 0–6 (40°–68° N),
// where every area is 1° of latitude by 2° of longitude. North of 68° the
// areas widen; nothing there is searched here, so those return null.
function ntsArea(series, letter) {
  const row = series % 10;
  const col = Math.floor(series / 10);
  if (row > 6 || col < 0 || col > 11) return null;
  const idx = letter.toUpperCase().charCodeAt(0) - 65;
  if (idx < 0 || idx > 15) return null;
  const seriesSouth = 40 + 4 * row;
  const seriesEast = 48 + 8 * col; // degrees west
  const { row: r, colFromEast } = snake(idx);
  return {
    south: seriesSouth + r,
    east: -(seriesEast + 2 * colFromEast),
    latSize: 1,
    lngSize: 2,
  };
}

function center(box) {
  return { lat: box.south + box.latSize / 2, lng: box.east - box.lngSize / 2 };
}

const pad3 = (n) => String(n).padStart(3, '0');

// "093A", "33A08", "082J002", "41I11C177" → the sheet and its centre.
//   sizeKm is the search radius that covers the sheet.
export function parseMapSheet(raw) {
  const t = String(raw ?? '').trim().replace(/[\s.\-_/]+/g, '').toUpperCase();
  let m;
  // Ontario MLAS cell ID: 1:50k sheet + cell. "41111C177" is the same ID with
  // the letter I typed as a 1, which the telemetry shows more than once.
  if ((m = t.match(/^0?(\d{2})([A-P1])(\d{2})([A-Z])(\d{3})$/))) {
    const letter = m[2] === '1' ? 'I' : m[2];
    return sheet(Number(m[1]), letter, Number(m[3]), 'cell');
  }
  // A quarter of a 1:50k sheet, as Manitoba writes it: "062P01-SW-East".
  if ((m = t.match(/^0?(\d{2,3})([A-P])(\d{2})(?:NE|NW|SE|SW)[A-Z]*$/))) {
    return sheet(Number(m[1]), m[2], Number(m[3]), 'nts');
  }
  // BCGS 1:20,000 tile within a 1:250k area: 082J002. Searched at the area's
  // centre; the tile numbering is not needed to find "claims around here".
  if ((m = t.match(/^0?(\d{2,3})([A-P])(\d{3})$/))) {
    return sheet(Number(m[1]), m[2], null, 'bcgs', `${pad3(m[1])}${m[2]}${m[3]}`);
  }
  // NTS 1:50k (033A08) or 1:250k (093A).
  if ((m = t.match(/^0?(\d{2,3})([A-P])(\d{1,2})?$/))) {
    const n = m[3] ? Number(m[3]) : null;
    if (n !== null && (n < 1 || n > 16)) return null;
    return sheet(Number(m[1]), m[2], n, 'nts');
  }
  return null;
}

function sheet(series, letter, number, kind, labelOverride = null) {
  const area = ntsArea(series, letter);
  if (!area) return null;
  const label = labelOverride || `${pad3(series)}${letter}${number ? String(number).padStart(2, '0') : ''}`;
  if (!number) return { kind, label, ...center(area), radiusKm: 50 };
  const { row, colFromEast } = snake(number - 1);
  const box = {
    south: area.south + row * 0.25,
    east: area.east - colFromEast * 0.5,
    latSize: 0.25,
    lngSize: 0.5,
  };
  return { kind, label, ...center(box), radiusKm: 20 };
}

// One read of the query, for the search panel:
//   { type: 'point', lat, lng, label }        coordinates
//   { type: 'sheet', lat, lng, label, ... }   NTS / BCGS sheet or Ontario cell
//   { type: 'number' }                        a claim number (or a list)
//   { type: 'text' }                          anything else: a holder name
export function readSearchQuery(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return { type: 'text' };
  const point = parseLatLng(t);
  if (point) return { type: 'point', ...point, radiusKm: 25, label: `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}` };
  const sheet = parseMapSheet(t);
  if (sheet) return { type: 'sheet', ...sheet };
  if (/\d/.test(t) && parseClaimNumbers(t).kind === 'numbers') return { type: 'number' };
  return { type: 'text' };
}
