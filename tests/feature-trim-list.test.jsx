import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FeatureTrimList from '../src/components/FeatureTrimList.jsx';
import { featureLabel } from '../src/utils/featureIdentity.js';

const claim = (id, name, ha) => ({
  type: 'Feature',
  properties: { TENURE_NUMBER_ID: id, CLAIM_NAME: name, AREA_IN_HECTARES: ha },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});

const layerOf = (features, overrides = {}) => ({
  id: 'l1', role: 'claims', featureOverrides: overrides,
  geojson: { type: 'FeatureCollection', features },
});

const northSouth = layerOf([
  claim(1, 'NORTH RIDGE', 420),
  claim(2, 'NORTH RIDGE', 380),
  claim(3, 'SOUTH FORK', 210),
  claim(4, 'SOUTH FORK', 190),
]);

describe('featureLabel', () => {
  it('leads with the claim name and distinguishes duplicates by number', () => {
    // 1,719 B.C. names are shared by more than one title, so a list keyed on
    // name alone would show four identical rows for two different blocks.
    const a = featureLabel(claim(1, 'NORTH RIDGE', 420));
    const b = featureLabel(claim(2, 'NORTH RIDGE', 380));
    expect(a.title).toBe('NORTH RIDGE');
    expect(b.title).toBe('NORTH RIDGE');
    expect(a.subtitle).not.toBe(b.subtitle);
    expect(a.subtitle).toContain('#1');
    expect(a.subtitle).toContain('420 ha');
  });

  it('names an unnamed claim by its number rather than leaving it blank', () => {
    // 22% of B.C. titles have no name at all.
    const unnamed = { type: 'Feature', properties: { TENURE_NUMBER_ID: 99 } };
    expect(featureLabel(unnamed).title).toBe('Claim 99');
  });

  it('is searchable by name or by number', () => {
    const label = featureLabel(claim(1084001, 'CRYSTAL LAKE', 500));
    expect(label.search).toContain('crystal');
    expect(label.search).toContain('1084001');
  });
});

describe('FeatureTrimList', () => {
  it('shows every shape with a checkbox, ticked when it is on the map', () => {
    render(<FeatureTrimList layer={northSouth} onSetHidden={() => {}} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it('unticks a shape that has been removed', () => {
    const trimmed = layerOf(northSouth.geojson.features, { 'TENURE_NUMBER_ID:3': { hidden: true } });
    render(<FeatureTrimList layer={trimmed} onSetHidden={() => {}} />);
    expect(screen.getAllByRole('checkbox').filter((b) => !b.checked)).toHaveLength(1);
  });

  it('removes a single shape when its box is unticked', () => {
    const onSetHidden = vi.fn();
    render(<FeatureTrimList layer={northSouth} onSetHidden={onSetHidden} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    const [features, hidden] = onSetHidden.mock.calls[0];
    expect(hidden).toBe(true);
    expect(features).toHaveLength(1);
    expect(features[0].properties.TENURE_NUMBER_ID).toBe(1);
  });

  it('filters by name', () => {
    render(<FeatureTrimList layer={northSouth} onSetHidden={() => {}} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'south' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('filters by claim number, for when the name is not memorable', () => {
    render(<FeatureTrimList layer={northSouth} onSetHidden={() => {}} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '3' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('bulk-removes ONLY what the filter is showing', () => {
    // The whole north/south job in two actions — and the failure mode that
    // matters: a bulk button that quietly took the whole layer while the user
    // believed it applied to their search.
    const onSetHidden = vi.fn();
    render(<FeatureTrimList layer={northSouth} onSetHidden={onSetHidden} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'south' } });
    fireEvent.click(screen.getByRole('button', { name: /Remove these 2/ }));

    const [features, hidden] = onSetHidden.mock.calls[0];
    expect(hidden).toBe(true);
    expect(features.map((f) => f.properties.TENURE_NUMBER_ID).sort()).toEqual([3, 4]);
  });

  it('says how many the bulk action will take, so it is never a surprise', () => {
    render(<FeatureTrimList layer={northSouth} onSetHidden={() => {}} />);
    // Unfiltered it reads as "all"; filtered it names the count.
    expect(screen.getByRole('button', { name: /Remove all/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'north' } });
    expect(screen.getByRole('button', { name: /Remove these 2/ })).toBeTruthy();
  });

  it('offers restore only when something in view is removed', () => {
    const restoreName = /Restore/;
    const { unmount } = render(<FeatureTrimList layer={northSouth} onSetHidden={() => {}} />);
    expect(screen.getByRole('button', { name: restoreName }).disabled).toBe(true);
    unmount();

    const trimmed = layerOf(northSouth.geojson.features, { 'TENURE_NUMBER_ID:3': { hidden: true } });
    render(<FeatureTrimList layer={trimmed} onSetHidden={() => {}} />);
    expect(screen.getByRole('button', { name: restoreName }).disabled).toBe(false);
  });

  it('does not offer to remove shapes that are already gone', () => {
    const allGone = layerOf(northSouth.geojson.features, {
      'TENURE_NUMBER_ID:1': { hidden: true }, 'TENURE_NUMBER_ID:2': { hidden: true },
      'TENURE_NUMBER_ID:3': { hidden: true }, 'TENURE_NUMBER_ID:4': { hidden: true },
    });
    render(<FeatureTrimList layer={allGone} onSetHidden={() => {}} />);
    expect(screen.getByRole('button', { name: /Remove/ }).disabled).toBe(true);
  });

  it('caps the rendered rows but still acts on the whole filtered set', () => {
    // A 500-claim layer must not put 500 rows in the DOM, and the bulk button
    // must not quietly act on only the 300 that are visible.
    const many = layerOf(Array.from({ length: 500 }, (_, i) => claim(i + 1, `CELL ${i + 1}`, 21)));
    const onSetHidden = vi.fn();
    render(<FeatureTrimList layer={many} onSetHidden={onSetHidden} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(300);

    fireEvent.click(screen.getByRole('button', { name: /Remove all/ }));
    expect(onSetHidden.mock.calls[0][0]).toHaveLength(500);
  });

  it('tells the user rows are being withheld', () => {
    const many = layerOf(Array.from({ length: 500 }, (_, i) => claim(i + 1, `CELL ${i + 1}`, 21)));
    render(<FeatureTrimList layer={many} onSetHidden={() => {}} />);
    expect(screen.getByText(/Showing 300 of 500/)).toBeTruthy();
  });

  it('says so when a filter matches nothing', () => {
    render(<FeatureTrimList layer={northSouth} onSetHidden={() => {}} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText(/No shapes match/)).toBeTruthy();
  });

  it('renders nothing for a layer with no features', () => {
    const { container } = render(<FeatureTrimList layer={layerOf([])} onSetHidden={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('labels the filter for screen readers', () => {
    render(<FeatureTrimList layer={northSouth} onSetHidden={() => {}} />);
    // The visible placeholder is not an accessible name.
    expect(screen.getByLabelText(/Filter shapes by name or number/)).toBeTruthy();
  });

  it('gives every row an accessible name naming its claim', () => {
    render(<FeatureTrimList layer={northSouth} onSetHidden={() => {}} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[2]).getByRole('checkbox')).toBeTruthy();
    expect(rows[2].textContent).toContain('SOUTH FORK');
    expect(rows[2].textContent).toContain('#3');
  });
});
