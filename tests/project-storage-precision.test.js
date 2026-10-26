import { beforeEach, expect, it } from 'vitest';
import { deflateSync, strToU8 } from 'fflate';
import {
  saveDraft, loadDraft, saveProjectRecord, listProjects, queueAccountSave, loadAccountSave,
  renameProjectRecord, updateProjectThumbnailRecord,
} from '../src/utils/projectStorage.js';

beforeEach(() => localStorage.clear());

const properties = {
  Au: '<0.0000005', Cu: 0.123456789, zero: 0, negative: -0.123456789,
  SampleID: 'LAB-1.123456789', quoted: '"value: 12.123456789"',
  nested: { assay: 1.23456789e-7, text: '1.23456789e-7', values: [0.0000005, '0,0000005'],
    geometry: { type: 'Point', coordinates: [12.123456789, 50.123456789] } },
};
function project() {
  return { layout: { title: 'Report 1.123456789', rotation: 12.123456789 },
    camera: { zoom: 15.123456789 }, layers: [{ id: 'soil-1.123456789', name: 'Series 0.0000005',
      classification: { field: 'Cu', numericPolicy: 'finite-decimal-v1', classes: [{ max: 0.123456789 }] },
      geojson: { type: 'FeatureCollection', bbox: [-120.123456789, 50.123456789, -120.123456789, 50.123456789],
        features: [{ type: 'Feature', id: 'sample-0.123456789', properties: structuredClone(properties),
          geometry: { type: 'Point', coordinates: [-120.123456789, 50.123456789, 123.123456789] } }] } }] };
}
const roundTrips = {
  draft: payload => { expect(saveDraft({ payload, projectName: 'Map 1.123456789' }).ok).toBe(true); return loadDraft(); },
  project: payload => { expect(saveProjectRecord({ id: 'p1', name: 'Map 1.123456789', payload }).storage.ok).toBe(true); return listProjects()[0]; },
  'pending account save': payload => { expect(queueAccountSave({ payload, projectName: 'Map 1.123456789' }).ok).toBe(true); return loadAccountSave(); },
};

it.each(Object.keys(roundTrips))('%s keeps raw properties, IDs and metadata exactly through the real save/load path', (kind) => {
  const payload = project(), before = structuredClone(payload);
  const saved = roundTrips[kind](payload);
  expect(saved.payload.layers[0].geojson.features[0].properties).toEqual(properties);
  expect(saved.payload.layers[0].geojson.features[0].id).toBe('sample-0.123456789');
  expect(saved.payload.layers[0].id).toBe('soil-1.123456789');
  expect(saved.payload.layers[0].classification).toEqual(payload.layers[0].classification);
  expect(saved.payload.layout).toEqual(payload.layout);
  expect(saved.payload.camera).toEqual(payload.camera);
  expect(saved.projectName ?? saved.name).toBe('Map 1.123456789');
  expect(payload).toEqual(before); // saving must not change the open map or its export source
});

it('keeps six-decimal geometry coordinates and bbox, without rounding properties that look like GeoJSON', () => {
  const payload = project();
  payload.layers.push({ id: 'collection', geojson: { type: 'Feature', properties: structuredClone(properties),
    geometry: { type: 'GeometryCollection', geometries: [
      { type: 'MultiPolygon', coordinates: [[[[1.123456789, -2.123456789], [1.123456789, -2.123456789]]]] },
      { type: 'LineString', coordinates: [[1e-7, -1e-7], [12, 45]] },
    ] } } });
  const saved = roundTrips.draft(payload).payload;
  const feature = saved.layers[0].geojson.features[0];
  expect(feature.geometry.coordinates).toEqual([-120.123457, 50.123457, 123.123457]);
  expect(saved.layers[0].geojson.bbox).toEqual([-120.123457, 50.123457, -120.123457, 50.123457]);
  expect(feature.properties.nested.geometry.coordinates).toEqual(properties.nested.geometry.coordinates);
  expect(saved.layers[1].geojson.geometry.geometries[0].coordinates).toEqual([[[[1.123457, -2.123457], [1.123457, -2.123457]]]]);
  expect(saved.layers[1].geojson.geometry.geometries[1].coordinates).toEqual([[0, 0], [12, 45]]);
});

it('metadata-only project-list rewrites preserve an existing project’s raw observations', () => {
  const payload = project();
  localStorage.setItem('mapviewer.projects.v1', JSON.stringify([{ id: 'p1', name: 'Original', payload }]));
  expect(renameProjectRecord('p1', 'Renamed 1.123456789')).toBe(true);
  expect(updateProjectThumbnailRecord('p1', 'thumbnail-0.123456789')).toBe(true);
  expect(listProjects()[0]).toMatchObject({ name: 'Renamed 1.123456789', thumbnail: 'thumbnail-0.123456789' });
  expect(listProjects()[0].payload.layers[0].geojson.features[0].properties).toEqual(properties);
});

it('reads previously stored compressed data without reinterpretation or rewriting its bytes', () => {
  const old = { payload: project(), projectName: 'Legacy 1.123456789' };
  const bytes = deflateSync(strToU8(JSON.stringify(old)));
  const stored = `gz1:${btoa(String.fromCharCode(...bytes))}`;
  localStorage.setItem('mapviewer.draft.v1', stored);
  expect(loadDraft()).toEqual(old);
  expect(localStorage.getItem('mapviewer.draft.v1')).toBe(stored);
});
