import React, { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildGraduated, buildCategorical, classIndexFor, suggestBreaks } from '../src/utils/classification.js';
import ClassificationPanel from '../src/components/ClassificationPanel.jsx';

const feature = (value) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { Au: value } });
const raw = ['<0.005', '>100', '0,52', '1,000', '   ', null, 'ND', true, '0x10', 'Infinity', 0, '-2.5', ' 1e-3 ', '.5', '5.'];
const layer = { id: 'soil', type: 'points', style: { markerSize: 10 }, geojson: { type: 'FeatureCollection', features: raw.map(feature) } };
const legacy = { field: 'Au', mode: 'graduated', classes: [{ max: 1, color: '#112233' }, { max: null, color: '#334455' }] };
afterEach(cleanup);

it('new ranges exclude nonnumeric/qualified/ambiguous strings without changing raw observations', () => {
  const before = structuredClone(layer);
  const c = buildGraduated(layer, 'Au');
  expect(c.numericPolicy).toBe('finite-decimal-v1');
  for (const value of raw.slice(0, 10)) expect(classIndexFor(c, feature(value)), String(value)).toBe(-1);
  for (const value of raw.slice(10)) expect(classIndexFor(c, feature(value)), String(value)).toBeGreaterThanOrEqual(0);
  expect(layer).toEqual(before);
  expect(suggestBreaks(['0,52', '0,53', '0,54', '0,55'])).toEqual([]);
  expect(suggestBreaks([1, 2, 3, 4, '<1000'])).toEqual(suggestBreaks([1, 2, 3, 4]));
});

it('preserves legacy rendering and categorical raw strings across serialization', () => {
  const c = JSON.parse(JSON.stringify(legacy));
  expect(['<0.005', '>100', '0,52', '   '].map(v => classIndexFor(c, feature(v)))).toEqual([0, 1, 1, 0]);
  const categories = buildCategorical(layer, 'Au');
  expect(classIndexFor(categories, feature('<0.005'))).toBeGreaterThanOrEqual(0);
  const strict = JSON.parse(JSON.stringify(buildGraduated(layer, 'Au')));
  expect(classIndexFor(strict, feature('0,52'))).toBe(-1);
});

it('does not invent an all-values class for an entirely excluded population or interpret sentinels', () => {
  const l = { ...layer, geojson: { type: 'FeatureCollection', features: ['<1', '0,52', ' '].map(feature) } };
  expect(buildGraduated(l, 'Au').classes).toEqual([]);
  const c = buildGraduated(layer, 'Au');
  expect(classIndexFor(c, feature(-999))).toBeGreaterThanOrEqual(0);
  expect(classIndexFor(c, feature('1e999'))).toBe(-1);
  expect(classIndexFor({ ...c, numericPolicy: 'future-format' }, feature(1))).toBe(-1);
});

function Panel({ initial = legacy }) {
  const [current, setCurrent] = useState({ ...layer, classification: initial });
  return <><ClassificationPanel layer={current} isPoint updateLayer={(_, patch) => setCurrent(x => ({ ...x, ...patch }))} /><output data-testid="classification">{JSON.stringify(current.classification)}</output></>;
}
const current = () => JSON.parse(screen.getByTestId('classification').textContent);
it('keeps style edits on legacy parsing until an explicit rebuild, then reports exclusions and offers raw categories', () => {
  render(<Panel />);
  fireEvent.change(screen.getAllByLabelText('Legend label')[0], { target: { value: 'Edited label' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Size by class/ }));
  expect(current().numericPolicy).toBeUndefined();
  expect(classIndexFor(current(), feature('0,52'))).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild using plain numbers' }));
  expect(current().numericPolicy).toBe('finite-decimal-v1');
  expect(screen.getByText(/10 of 15 values excluded/)).toBeInTheDocument();
  expect(classIndexFor(current(), feature('0,52'))).toBe(-1);
  fireEvent.click(screen.getByRole('button', { name: 'Use unique values' }));
  expect(current().mode).toBe('categorical');
  expect(current().classes.some(c => c.value === '<0.005')).toBe(true);
});

it('a deliberate range rebuild upgrades legacy policy but changing an upper limit does not', () => {
  render(<Panel />);
  fireEvent.change(screen.getByLabelText('Class upper limit'), { target: { value: '2' } });
  expect(current().numericPolicy).toBeUndefined();
  fireEvent.change(screen.getByLabelText('Classes'), { target: { value: '3' } });
  expect(current().numericPolicy).toBe('finite-decimal-v1');
});
