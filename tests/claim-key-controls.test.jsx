import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ClaimKeyControls from '../src/components/ClaimKeyControls.jsx';

afterEach(cleanup);
function fixture() {
  return { layout: { propertyNeighboursVersion: 1, primaryLayerId: 'claims', title: 'Supplied title' },
    layers: [{ id: 'claims', role: 'claims', style: { fill: '#123456' }, fx: { label: { text: 'Manual label' } },
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'source-one',
        properties: { CLAIM_ID: '001', Au: 2.7 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } }] } }] };
}
let latest;
function Harness({ initial }) {
  const [project, setProject] = useState(initial); latest = project;
  return <>
    <ClaimKeyControls project={project} layer={project.layers[0]} fields={['CLAIM_ID', 'Au']} setProject={setProject} />
    <button onClick={() => setProject((prev) => ({ ...prev, layers: prev.layers.map((layer) => ({ ...layer,
      geojson: { ...layer.geojson, features: layer.geojson.features.map((feature) => ({ ...feature, properties: { ...feature.properties, CLAIM_ID: 'Changed' } })) } })) }))}>Change source identifier</button>
  </>;
}
describe('explicit compact-key controls', () => {
  it('creates and removes only the saved key after deliberate field selection', () => {
    const p = fixture(), before = structuredClone(p);
    render(<Harness initial={p} />);
    fireEvent.click(screen.getByText('Compact claim key'));
    expect(screen.getByRole('button', { name: 'Create claim key' }).disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Source identifier column' }), { target: { value: 'CLAIM_ID' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create claim key' }));
    expect(latest.layout.claimKey.entries[0]).toMatchObject({ identity: 'source-one', identifier: '001', reference: 'K1' });
    expect(latest.layers).toEqual(before.layers); expect(latest.layout.title).toBe(before.layout.title);
    fireEvent.click(screen.getByRole('button', { name: 'Remove claim key' }));
    expect(latest.layout.claimKey).toBeNull(); expect(latest.layers).toEqual(before.layers);
  });
  it('explains changed source and requires explicit rebuild', () => {
    render(<Harness initial={fixture()} />);
    fireEvent.click(screen.getByText('Compact claim key'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Source identifier column' }), { target: { value: 'CLAIM_ID' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create claim key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change source identifier' }));
    expect(screen.getByRole('status').textContent).toContain('identifiers changed');
    expect(latest.layout.claimKey.entries[0].identifier).toBe('001');
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild claim key' }));
    expect(latest.layout.claimKey.entries[0].identifier).toBe('Changed');
    expect(latest.layers[0].geojson.features[0].properties.Au).toBe(2.7);
  });
  it('adds no controls to unrelated templates or context layers', () => {
    const p = fixture(); p.layout.propertyNeighboursVersion = undefined;
    render(<Harness initial={p} />);
    expect(screen.queryByText('Compact claim key')).toBeNull();
  });
});
