import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));
const trackEvent = vi.hoisted(() => vi.fn());
vi.mock('../src/utils/track', () => ({ trackEvent, trackEventOnce: vi.fn() }));
vi.mock('leaflet', () => ({ default: { control: { zoom: () => ({ addTo: vi.fn() }) } } }));
vi.mock('../src/components/AnnotationOverlay', () => ({ default: () => null }));
const callouts = vi.hoisted(() => ({ seen: null }));
const drill = vi.hoisted(() => ({ plan: null }));
vi.mock('../src/components/DrillPlanOverlay', () => ({ default: ({ plan }) => { drill.plan = plan; return null; } }));
vi.mock('../src/utils/drillPlanLegend.js', () => ({ drillPlanLegendItems: () => [{ id: 'dp-ok', type: 'line', label: 'Drill traces', style: {} }] }));
vi.mock('../src/components/CalloutsOverlay', () => ({ default: ({ callouts: c }) => { callouts.seen = c; return null; } }));
const canvas = vi.hoisted(() => ({ project: null }));
vi.mock('../src/components/MapCanvas', () => ({
  default: function MockCanvas({ project, onReady }) {
    canvas.project = project;
    React.useEffect(() => {
      onReady({ getContainer: () => ({ offsetWidth: 800, offsetHeight: 450 }), setView: vi.fn(), once: vi.fn(), scrollWheelZoom: { disable: vi.fn(), enable: vi.fn() } });
    }, [onReady]);
    return <div data-testid="canvas" />;
  },
}));

import EmbedMapPage from '../src/components/EmbedMapPage';
import EmbedCodeDialog from '../src/components/EmbedCodeDialog';
import { embedCode, embedShareId, embedReferrer, embedLayers } from '../src/utils/embedCode';
import { entitlementsFor, TIERS } from '../src/utils/entitlements';
import { publishLiveMap, getLiveMap, revokeLiveMap } from '../src/utils/cloudStorage';

const square = (x) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { TENURE_NUMBER_ID: '1234567', OWNER_NAME: 'Star Copper', PRIVATE_NOTE: 'x' }, geometry: { type: 'Polygon', coordinates: [[[x, 55], [x + 0.1, 55], [x + 0.1, 55.1], [x, 55.1], [x, 55]]] } }] });
const state = {
  layout: { title: 'Rails Project', companyName: 'Star Copper Corp.', logo: 'data:image/png;base64,AAAA', basemap: 'blank' },
  mapView: { center: { lat: 55, lng: -130 }, zoom: 9 },
  callouts: [{ id: 'k1', text: 'RL-01: 12 m @ 1.4% Cu' }],
  layers: [
    { id: 'claims', name: 'Rails claims', role: 'claims', type: 'polygons', visible: true, geojson: square(-130), style: { fill: '#c65322' }, legend: { enabled: true } },
    { id: 'roads', name: 'Roads', role: 'other', type: 'polygons', visible: true, geojson: square(-129), legend: { enabled: true } },
    { id: 'off', name: 'Switched off', role: 'other', type: 'polygons', visible: false, geojson: square(-128) },
  ],
};

beforeEach(() => { rpc.mockReset(); trackEvent.mockReset(); canvas.project = null; });

describe('embed helpers', () => {
  it('reads the share id from /embed/map/<id> only', () => {
    expect(embedShareId('/embed/map/abc123def456')).toBe('abc123def456');
    expect(embedShareId('/embed/map/abc123def456/')).toBe('abc123def456');
    for (const p of ['/map/abc123def456', '/embed/map/', '/embed/map/abc123def456/x', '/embed/map/a<b>c123']) expect(embedShareId(p)).toBeNull();
  });

  it('builds a fixed or responsive iframe snippet with the chosen size and aspect', () => {
    const fixed = embedCode('abc123def456', { origin: 'https://www.explorationmaps.com', title: 'Rails "Project"', width: 800, aspect: '4:3', responsive: false });
    expect(fixed).toBe('<iframe src="https://www.explorationmaps.com/embed/map/abc123def456" title="Rails &quot;Project&quot;" loading="lazy" allowfullscreen width="800" height="600" style="border:0;max-width:100%"></iframe>');
    const fluid = embedCode('abc123def456', { origin: 'https://x.test', width: 960, height: 400 });
    expect(fluid).toContain('<div style="width:100%;max-width:960px"><div style="position:relative;padding-top:41.6667%">');
    expect(fluid).toMatch(/^<div style="[^"]*"><div style="position:relative;[^"]*"><iframe [^>]*style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"><\/iframe><\/div><\/div>$/);
    expect(embedCode('abc123def456', { origin: 'https://x.test', width: 1e6, aspect: 'bogus', responsive: false })).toContain('width="4000" height="2250"');
  });

  it('keeps only the host and path of the embedding page', () => {
    expect(embedReferrer('https://starcopper.com/projects/rails?utm_source=x&token=1#map')).toBe('starcopper.com/projects/rails');
    expect(embedReferrer('https://starcopper.com/')).toBe('starcopper.com');
    expect(embedReferrer('')).toBeNull();
    expect(embedReferrer('file:///c/site.html')).toBeNull();
  });

  it('gives claim layers their registry popup and leaves the rest alone', () => {
    const [claims, roads] = embedLayers(state.layers);
    expect(claims.claimInfo).toBe('registry');
    expect(roads).toBe(state.layers[1]);
  });

  it('is a Pro feature', () => {
    expect([TIERS.ANONYMOUS, TIERS.FREE, TIERS.PRO, TIERS.COMPANY].map((t) => entitlementsFor(t).live_embed)).toEqual([false, false, true, true]);
  });
});

describe('live map RPCs', () => {
  it('publishes the map behind its live link and reads it back', async () => {
    rpc.mockResolvedValueOnce({ data: 'f'.repeat(32), error: null });
    expect(await publishLiveMap('p1', state)).toBe('f'.repeat(32));
    expect(rpc).toHaveBeenCalledWith('publish_live_map', { p_project: 'p1', p_state: state });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'LIVE_MAP_PLAN: live web maps are part of Pro' } });
    await expect(publishLiveMap('p1', state)).rejects.toThrow('Live web maps are part of Pro.');
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await getLiveMap('p1')).toBeNull();
    expect(rpc).toHaveBeenLastCalledWith('get_live_map', { p_project: 'p1' });
  });
});

describe('EmbedMapPage', () => {
  it('reads the share afresh, counts an embed view and toggles layers', async () => {
    rpc.mockResolvedValue({ data: state, error: null });
    Object.defineProperty(document, 'referrer', { value: 'https://starcopper.com/rails?ref=news', configurable: true });
    render(<EmbedMapPage shareId="abc123def456" />);
    await screen.findByTestId('canvas');
    expect(rpc).toHaveBeenCalledWith('get_shared_map', { share_id: 'abc123def456' });
    expect(trackEvent).toHaveBeenCalledWith('share_viewed', { mapId: 'abc123def456', embed: true, referrer: 'starcopper.com/rails' });
    expect(screen.getByRole('heading', { name: 'Rails Project' })).toBeTruthy();
    expect(screen.getByAltText('Star Copper Corp.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Made with ExplorationMaps' }).getAttribute('target')).toBe('_blank');
    expect(screen.queryByLabelText('Switched off')).toBeNull();
    expect(canvas.project.layers.find((l) => l.id === 'claims').claimInfo).toBe('registry');
    expect(callouts.seen).toEqual(state.callouts);
    const legend = screen.getByRole('region', { name: 'Legend' });
    expect(legend.textContent).toContain('Roads');
    fireEvent.click(screen.getByLabelText('Roads'));
    await waitFor(() => expect(canvas.project.layers.find((l) => l.id === 'roads').visible).toBe(false));
    expect(legend.textContent).not.toContain('Roads');
    fireEvent.click(screen.getByLabelText('Roads'));
    await waitFor(() => expect(canvas.project.layers.find((l) => l.id === 'roads').visible).toBe(true));
  });

  it('says so when the link is gone or the service is down', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const { unmount } = render(<EmbedMapPage shareId="abc123def456" />);
    expect((await screen.findByRole('alert')).textContent).toContain('not available');
    unmount();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    render(<EmbedMapPage shareId="abc123def456" />);
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('draws a published drill plan and lists it in the legend', async () => {
    const plan = { holes: [{ id: 'RL-01' }] };
    rpc.mockResolvedValue({ data: { ...state, drillPlan: plan }, error: null });
    render(<EmbedMapPage shareId="abc123def456" />);
    await waitFor(() => expect(drill.plan).toEqual(plan));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Legend' }).textContent).toContain('Drill traces'));
  });

  it('shows a malformed embed link as unavailable without asking the server', async () => {
    render(<EmbedMapPage shareId={null} />);
    expect((await screen.findByRole('alert')).textContent).toContain('not available');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('EmbedCodeDialog', () => {
  const pro = entitlementsFor(TIERS.PRO);
  it.each(['PGRST202', '42883'])('maps missing-function %s from every live RPC to a plain unavailable error', async (code) => {
    for (const call of [() => getLiveMap('p1'), () => publishLiveMap('p1', state), () => revokeLiveMap('p1')]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'internal function signature schema cache' } });
      await expect(call()).rejects.toMatchObject({ code: 'LIVE_MAP_UNAVAILABLE', message: 'Live maps are not available yet. Your saved map is unchanged.' });
    }
  });
  it('shows a free account the upsell', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const onUpgrade = vi.fn();
    render(<EmbedCodeDialog projectId="p1" canPublish entitlements={entitlementsFor(TIERS.FREE)} getState={() => state} onUpgrade={onUpgrade} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'See Pro' }));
    expect(onUpgrade).toHaveBeenCalledWith('live_embed');
    expect(rpc).toHaveBeenCalledWith('get_live_map', { p_project: 'p1' });
    expect(screen.queryByLabelText('Embed code')).toBeNull();
  });

  it('keeps stopping an existing live map available after a plan downgrade without enabling republication', async () => {
    const id = 'd'.repeat(32);
    rpc.mockResolvedValueOnce({ data: { id, updated_at: '2026-10-25T10:00:00Z', view_count: 3 }, error: null });
    render(<EmbedCodeDialog projectId="p1" canPublish entitlements={entitlementsFor(TIERS.FREE)} getState={() => state} onUpgrade={() => {}} onClose={() => {}} />);
    const stop = await screen.findByRole('button', { name: 'Stop live map' });
    expect(screen.getByLabelText('Embed code').value).toContain(id);
    expect(screen.queryByRole('button', { name: /Republish with|Publish live map/ })).toBeNull();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    rpc.mockResolvedValueOnce({ data: true, error: null });
    fireEvent.click(stop);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop live map' })).toBeNull());
    expect(rpc).toHaveBeenLastCalledWith('revoke_live_map', { p_project: 'p1' });
    expect(screen.getByRole('button', { name: 'See Pro' })).toBeTruthy();
  });

  it('shows a plain unavailable state for a missing live-map RPC and can retry after activation', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find public.get_live_map in schema cache' } });
    render(<EmbedCodeDialog projectId="p1" canPublish entitlements={pro} getState={() => state} onUpgrade={() => {}} onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Live maps are not available yet');
    expect(screen.queryByText(/schema cache/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish live map' })).toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Retry live map status' }));
    expect(await screen.findByRole('button', { name: 'Publish live map' })).toBeTruthy();
    expect(rpc.mock.calls.every(([fn]) => fn === 'get_live_map')).toBe(true);
  });

  it('keeps known live metadata and Stop available when a refresh fails, and retries the read without publishing', async () => {
    const id = 'e'.repeat(32);
    rpc.mockResolvedValueOnce({ data: { id, updated_at: '2026-10-25T10:00:00Z', view_count: 3 }, error: null });
    const props = { projectId: 'p1', canPublish: true, entitlements: pro, getState: () => state, onUpgrade: () => {}, onClose: () => {} };
    const view = render(<EmbedCodeDialog {...props} />);
    expect(await screen.findByLabelText('Embed code')).toBeTruthy();
    view.rerender(<EmbedCodeDialog {...props} canPublish={false} />);
    rpc.mockRejectedValueOnce(new Error('Network request failed'));
    view.rerender(<EmbedCodeDialog {...props} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The live map status could not be loaded');
    expect(screen.getByLabelText('Embed code').value).toContain(id);
    expect(screen.getByRole('button', { name: 'Stop live map' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Republish with the current map' })).toBeDisabled();
    rpc.mockResolvedValueOnce({ data: { id, updated_at: '2026-10-25T10:00:00Z', view_count: 4 }, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Retry live map status' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText(/4 views/)).toBeTruthy();
    expect(rpc.mock.calls.every(([fn]) => fn === 'get_live_map')).toBe(true);
  });

  it('lets an editor of a paid company map publish on a free personal plan', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    render(<EmbedCodeDialog projectId="p1" canPublish entitlements={entitlementsFor(TIERS.FREE)} workspacePaid getState={() => state} onUpgrade={() => {}} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Publish live map' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'See Pro' })).toBeNull();
  });

  it('asks for a saved map before publishing', () => {
    render(<EmbedCodeDialog projectId={null} canPublish={false} entitlements={pro} getState={() => state} onUpgrade={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Save this map to your account first/)).toBeTruthy();
  });

  it('publishes only when asked, then offers the iframe code with size options', async () => {
    const getState = vi.fn(() => state);
    const id = 'c'.repeat(32);
    rpc.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: id, error: null })
      .mockResolvedValueOnce({ data: { id, updated_at: '2026-10-25T10:00:00Z', view_count: 3 }, error: null });
    render(<EmbedCodeDialog projectId="p1" canPublish entitlements={pro} title="Rails" getState={getState} onUpgrade={() => {}} onClose={() => {}} />);
    const button = await screen.findByRole('button', { name: 'Publish live map' });
    expect(getState).not.toHaveBeenCalled();
    fireEvent.click(button);
    const code = await screen.findByLabelText('Embed code');
    expect(getState).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenNthCalledWith(2, 'publish_live_map', { p_project: 'p1', p_state: state });
    expect(code.value).toContain(`/embed/map/${id}`);
    expect(code.value).toContain('padding-top:56.25%');
    fireEvent.change(screen.getByLabelText('Shape'), { target: { value: '1:1' } });
    fireEvent.click(screen.getByLabelText('Fit the page width'));
    expect(screen.getByLabelText('Embed code').value).toContain('width="960" height="960"');
    expect(screen.getByText(/3 views/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Republish with the current map' })).toBeTruthy();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    rpc.mockResolvedValueOnce({ data: true, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Stop live map' }));
    expect(await screen.findByRole('button', { name: 'Publish live map' })).toBeTruthy();
    expect(rpc).toHaveBeenLastCalledWith('revoke_live_map', { p_project: 'p1' });
  });
});
