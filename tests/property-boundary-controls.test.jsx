import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PropertyBoundaryControls from '../src/components/PropertyBoundaryControls.jsx';

const project = () => ({ layout: { propertyNeighboursVersion: 1, primaryLayerId: 'subject' },
  layers: [{ id: 'subject', role: 'claims', visible: true, geojson: { type: 'FeatureCollection', features: [] } }] });
describe('One contextual property boundary choice', () => {
  it('starts unchecked and changes only the explicit layout flag', () => {
    const p = project(), setProject = vi.fn();
    render(<PropertyBoundaryControls project={p} layer={p.layers[0]} setProject={setProject} />);
    const check = screen.getByRole('checkbox',{ name: 'Emphasize property boundary' });
    expect(check).not.toBeChecked(); fireEvent.click(check);
    const next = setProject.mock.calls[0][0](p);
    expect(next.layers).toBe(p.layers);
    expect(next.layout).toEqual({ ...p.layout, propertyBoundaryOutline: true });
    expect(p.layout.propertyBoundaryOutline).toBeUndefined();
  });
  it('does not expose a new control on legacy or unselected maps', () => {
    const p = project(); p.layout.propertyNeighboursVersion = undefined;
    render(<PropertyBoundaryControls project={p} layer={p.layers[0]} setProject={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('allows removing an enabled but stale selection without choosing another property', () => {
    const p = project(); Object.assign(p.layout,{ primaryLayerId: 'missing', propertyBoundaryOutline: true });
    const setProject = vi.fn();
    render(<PropertyBoundaryControls project={p} layer={p.layers[0]} setProject={setProject} />);
    expect(screen.getByRole('status')).toHaveTextContent('Select a visible property claims layer');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(setProject.mock.calls[0][0](p).layout.propertyBoundaryOutline).toBe(false);
  });
  it('rejects queued activation or removal after another project/selection is loaded', () => {
    const p = project(), setProject = vi.fn();
    render(<PropertyBoundaryControls project={p} layer={p.layers[0]} setProject={setProject} />);
    fireEvent.click(screen.getByRole('checkbox'));
    const apply = setProject.mock.calls[0][0], other = structuredClone(p);
    expect(apply(other)).toBe(other);
    const hidden = { ...p, layers: [{ ...p.layers[0], visible: false }] };
    expect(apply(hidden)).toBe(hidden);
  });
  it('updates native status and removes its listener on unmount', () => {
    const p = project(); p.layout.propertyBoundaryOutline = true;
    const map = { emFxReport: { propertyBoundary: { ok: true, reason: null } }, on: vi.fn(), off: vi.fn() };
    const { unmount } = render(<PropertyBoundaryControls project={p} layer={p.layers[0]} setProject={vi.fn()} map={map} />);
    expect(screen.getByRole('status')).toHaveTextContent('individual claims remain selectable');
    const update = map.on.mock.calls[0][1];
    act(() => update({ propertyBoundary: { ok: false, reason: 'complexity-limit' } }));
    expect(screen.getByRole('status')).toHaveTextContent('too complex for boundary emphasis');
    unmount(); expect(map.off).toHaveBeenCalledWith('emfxreport',update);
  });
});
