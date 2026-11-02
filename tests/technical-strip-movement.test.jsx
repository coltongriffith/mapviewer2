import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { useTechnicalStripFields } from '../src/utils/useTechnicalStripFields.js';
import { resolveTitleStripFields } from '../src/templates/technicalReportTemplate.js';
import { autoProjectionName, formatScaleDenom, scaleDenomFromMap } from '../src/utils/geo.js';
import TechnicalReportStrip from '../src/components/TechnicalReportStrip.jsx';

afterEach(cleanup);
const layout = { templateId: 'ni_43101_technical', technicalReportVersion: 1, title: 'Supplied title' };
function movingMap() {
  const callbacks = new Map();
  return { step: .01, center: { lat: 50, lng: -123 },
    getSize: () => ({ x: 1000, y: 600 }), getCenter() { return this.center; },
    containerPointToLatLng([x]) { return { lat: this.center.lat, lng: this.center.lng + x * this.step }; },
    on: vi.fn((events, fn) => { for (const event of events.split(' ')) callbacks.set(event, fn); }),
    off: vi.fn((events, fn) => { for (const event of events.split(' ')) if (callbacks.get(event) === fn) callbacks.delete(event); }),
    fire(event) { callbacks.get(event)?.(); },
  };
}
const exportedFields = (map, settings = layout) => resolveTitleStripFields(settings, {
  scaleText: formatScaleDenom(scaleDenomFromMap(map)), projectionText: autoProjectionName(map),
});

describe('read-only technical metadata follows the actual view', () => {
  it('updates scale on zoom, projection on pan, and matches export resolution', () => {
    const map = movingMap();
    const { result } = renderHook(() => useTechnicalStripFields(map, layout));
    const before = result.current.scale;
    act(() => { map.step /= 4; map.fire('zoomend'); });
    expect(result.current.scale).not.toBe(before);
    expect(result.current.scale).toBe(exportedFields(map).scale);
    act(() => { map.center = { lat: -20, lng: 30 }; map.fire('moveend'); });
    expect(result.current.projection).toBe(exportedFields(map).projection);
    expect(result.current.projection).toContain('36S');
    expect(result.current.title).toBe('Supplied title');
  });
  it('retains supplied scale/projection while still listening for view changes', () => {
    const map = movingMap(), supplied = { ...layout, manualScaleDenom: '25000', projectionName: 'Supplied datum / local grid' };
    const { result } = renderHook(() => useTechnicalStripFields(map, supplied));
    act(() => { map.step /= 8; map.center.lng = 40; map.fire('zoomend'); map.fire('moveend'); });
    expect(result.current.scale).toBe('1:25,000');
    expect(result.current.projection).toBe(supplied.projectionName);
  });
  it('removes subscriptions when the map changes, recipe is disabled, or viewer unmounts', () => {
    const first = movingMap(), second = movingMap();
    const { rerender, unmount } = renderHook(({ map, settings }) => useTechnicalStripFields(map, settings), { initialProps: { map: first, settings: layout } });
    rerender({ map: second, settings: layout });
    expect(first.off).toHaveBeenCalledWith('moveend zoomend', expect.any(Function));
    rerender({ map: second, settings: { ...layout, technicalReportVersion: undefined } });
    expect(second.off).toHaveBeenCalledTimes(1);
    rerender({ map: second, settings: layout });
    unmount();
    expect(second.off).toHaveBeenCalledTimes(2);
  });
  it('does not subscribe legacy or unrelated maps and exposes an explicit accessible image role', () => {
    const map = movingMap();
    const { result } = renderHook(() => useTechnicalStripFields(map, { title: 'Legacy' }));
    expect(map.on).not.toHaveBeenCalled();
    render(<TechnicalReportStrip layout={layout} fields={result.current} width={1250} height={800} />);
    expect(screen.getByRole('img', { name: 'Technical report title block' })).toBeTruthy();
  });
});
