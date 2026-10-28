import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectDataDownload from '../src/components/ProjectDataDownload';
import { loadCloudProject } from '../src/utils/cloudStorage';
import { downloadBlob } from '../src/utils/svg';
const auth = { user: { id: 'u1' } };
vi.mock('../src/hooks/useAuth.jsx', () => ({ useAuth: () => auth }));
vi.mock('../src/utils/cloudStorage', () => ({ loadCloudProject: vi.fn() }));
vi.mock('../src/utils/svg', () => ({ downloadBlob: vi.fn() }));
const layer = { name: 'Collars', visible: false, geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { hole: '001' }, geometry: { type: 'Point', coordinates: [1, 2] } }] } };
const record = { name: 'Saved name', payload: { layers: [layer, { name: 'Tiles', tiles: {} }] } };
const project = { id: 'p1', name: 'My project' };
beforeEach(() => { vi.clearAllMocks(); auth.user = { id: 'u1' }; loadCloudProject.mockResolvedValue(record); });

describe('saved project downloads', () => {
  it('loads the saved record, offers hidden vector layers and downloads both formats', async () => {
    const close = vi.fn();
    render(<ProjectDataDownload project={project} onClose={close} />);
    expect(await screen.findByRole('option', { name: 'Collars (1 features)' })).toBeInTheDocument();
    expect(loadCloudProject).toHaveBeenCalledWith('p1');
    expect(screen.queryByRole('option', { name: 'Tiles' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(downloadBlob).toHaveBeenLastCalledWith('Saved name-Collars.csv', expect.any(Blob));
    fireEvent.click(screen.getByRole('button', { name: 'Download GeoJSON' }));
    expect(downloadBlob).toHaveBeenLastCalledWith('Saved name-Collars.geojson', expect.any(Blob));
    expect(record.payload.layers[0].visible).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalled();
  });
  it('handles permission/network errors with retry instead of exposing stale data', async () => {
    loadCloudProject.mockRejectedValueOnce(new Error('forbidden'));
    render(<ProjectDataDownload project={project} onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Download CSV' });
    expect(loadCloudProject).toHaveBeenCalledTimes(2);
  });
  it('does not show a delayed previous-project response after switching projects', async () => {
    let finish;
    loadCloudProject.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<ProjectDataDownload project={project} onClose={() => {}} />);
    view.rerender(<ProjectDataDownload project={{ id: 'p2', name: 'Next' }} onClose={() => {}} />);
    await screen.findByRole('button', { name: 'Download CSV' });
    await act(async () => finish({ name: 'Old', payload: { layers: [{ ...layer, name: 'Old secret' }] } }));
    expect(screen.queryByText(/Old secret/)).not.toBeInTheDocument();
  });
  it('clears loaded data immediately on sign-out and does not refetch', async () => {
    const view = render(<ProjectDataDownload project={project} onClose={() => {}} />);
    await screen.findByRole('button', { name: 'Download CSV' });
    auth.user = null;
    view.rerender(<ProjectDataDownload project={project} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument();
    expect(loadCloudProject).toHaveBeenCalledTimes(1);
  });
  it('explains raster-only maps and treats malformed payloads as a recoverable error', async () => {
    loadCloudProject.mockResolvedValueOnce({ payload: { layers: [{ tiles: {} }] } });
    const view = render(<ProjectDataDownload project={project} onClose={() => {}} />);
    await screen.findByText(/No saved vector layers/);
    loadCloudProject.mockResolvedValueOnce({ payload: null });
    view.rerender(<ProjectDataDownload project={{ id: 'p2' }} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load'));
  });
});
