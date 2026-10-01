import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { insetStyle, insetStylePatch } from '../src/utils/insetStyle';

const saskatchewan = {
  name: 'Saskatchewan',
  bbox: [-110, 49, -101.36, 60],
  coordinates: [[[-110, 49], [-101.36, 49], [-101.36, 60], [-110, 60], [-110, 49]]],
};
vi.mock('../src/utils/detectRegion', () => ({ detectRegion: vi.fn(async () => saskatchewan) }));

const { default: LocatorInset } = await import('../src/components/LocatorInset.jsx');

const claims = [{
  id: 'claims',
  geojson: {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-104, 57], [-103.9, 57], [-103.9, 57.1], [-104, 57.1], [-104, 57]]] } }],
  },
}];

describe('Inset Style control', () => {
  it('only reads Satellite when the inset tiles are imagery', () => {
    expect(insetStyle({ insetMode: 'satellite_locator', insetBasemap: 'satellite' })).toBe('satellite_locator');
    expect(insetStyle({ insetMode: 'satellite_locator', insetBasemap: 'satellite_hybrid' })).toBe('satellite_locator');
    expect(insetStyle({ insetMode: 'satellite_locator' })).toBe('satellite_locator');
    // MCP maps carry the main map's tiles here; picking Satellite must change them.
    expect(insetStyle({ insetMode: 'satellite_locator', insetBasemap: 'light_grey' })).toBe('tiles');
    expect(insetStyle({ insetMode: 'province_state', insetBasemap: 'satellite' })).toBe('standard');
    expect(insetStyle({ insetMode: 'country' })).toBe('standard');
  });

  it('switches the tiles to imagery when Satellite is chosen', () => {
    expect(insetStylePatch('satellite_locator')).toEqual({ insetMode: 'satellite_locator', insetBasemap: 'satellite' });
    expect(insetStylePatch('standard')).toEqual({ insetMode: 'province_state' });
    expect(insetStylePatch('tiles')).toEqual({});
  });
});

describe('Standard locator without a stored region', () => {
  it('outlines the detected province instead of the generic placeholder', async () => {
    const { container } = render(<LocatorInset layers={claims} insetMode="province_state" autoInsetRegion={null} />);
    await waitFor(() => expect(screen.getByText('Saskatchewan')).toBeTruthy());
    // The placeholder's fake river is the giveaway that the generic sketch drew.
    expect(container.innerHTML).not.toContain('#b5d8f7');
  });
});
