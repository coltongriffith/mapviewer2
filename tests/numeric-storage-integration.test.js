import { beforeEach, expect, it } from 'vitest';
import { buildGraduated, classIndexFor } from '../src/utils/classification.js';
import { saveDraft, loadDraft, saveProjectRecord, listProjects, queueAccountSave, loadAccountSave } from '../src/utils/projectStorage.js';

beforeEach(() => localStorage.clear());
const raw = [0.123456789, 1.23456789e-7, '<0.0000005', '>100', '0,52', '   '];
const routes = {
  draft: payload => { expect(saveDraft({ payload }).ok).toBe(true); return loadDraft().payload; },
  local: payload => { expect(saveProjectRecord({ id: 'p', payload }).storage.ok).toBe(true); return listProjects()[0].payload; },
  account: payload => { expect(queueAccountSave({ payload }).ok).toBe(true); return loadAccountSave().payload; },
};
it.each(Object.keys(routes))('%s serialization preserves both new and legacy classification decisions and exact raw values', kind => {
  for (const strict of [false, true]) {
    const layer = { id: 'soil', geojson: { type: 'FeatureCollection', features: raw.map((Au, i) => ({ type: 'Feature',
      geometry: { type: 'Point', coordinates: [-120.123456789, 50.123456789] }, properties: { Au, SampleID: `LAB-${i}.123456789` } })) } };
    layer.classification = strict ? buildGraduated(layer, 'Au') : { field: 'Au', mode: 'graduated', classes: [{ max: 0.123456789 }, { max: null }] };
    const payload = { layers: [layer], layout: { title: 'Title 0.123456789' } }, before = structuredClone(payload);
    const expected = layer.geojson.features.map(f => classIndexFor(layer.classification, f));
    const restored = routes[kind](payload), saved = restored.layers[0];
    expect(payload).toEqual(before);
    expect(restored.layout).toEqual(payload.layout);
    expect(saved.geojson.features.map(f => f.properties)).toEqual(layer.geojson.features.map(f => f.properties));
    expect(saved.classification).toEqual(layer.classification);
    expect(saved.geojson.features.map(f => classIndexFor(saved.classification, f))).toEqual(expected);
    expect(saved.geojson.features[0].geometry.coordinates).toEqual([-120.123457, 50.123457]);
  }
});
