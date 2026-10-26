import React from 'react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import PackageExport from '../src/components/PackageExport.jsx';
const mock = vi.hoisted(() => ({ cloud: vi.fn(), download: vi.fn(), render: vi.fn(), stage: vi.fn() }));
vi.mock('../src/hooks/useAuth.jsx', () => ({ useAuth: () => ({ entitlements: { clean_export: true } }) }));
vi.mock('../src/utils/cloudStorage', () => ({ loadCloudProject: mock.cloud }));
vi.mock('../src/utils/entitlements', () => ({ canExportFormat: () => false }));
vi.mock('../src/utils/svg', () => ({ downloadBlob: mock.download }));
vi.mock('../src/components/Dialog', () => ({ default: ({ children }) => <div role="dialog">{children}</div> }));
vi.mock('../src/components/ReadOnlyMapStage', () => ({ default: function Stage({ project, onExportReady }) {
  React.useEffect(() => { mock.stage(project); onExportReady({ renderCanvas: mock.render }); }, [project, onExportReady]);
  return null;
} }));
beforeEach(() => {
  vi.clearAllMocks();
  mock.render.mockResolvedValue({ toBlob: callback => callback({ arrayBuffer: async () => new ArrayBuffer(1) }) });
});
afterEach(cleanup);
const start = () => fireEvent.click(screen.getByRole('button', { name: /Download package/ }));
it('renders a captured map without fetching its later live revision, validating before and after output generation', async () => {
  const payload = { layout: {}, layers: [], name: 'Captured' }, validate = vi.fn(async () => {});
  render(<PackageExport projects={[{ id: 'm', name: 'Map' }]} onClose={() => {}} preset={{ picked: ['m'], mapPayloads: { m: payload }, validate, extra: { 'record.json': new Uint8Array([1]) }, draft: false }} />);
  start(); await waitFor(() => expect(mock.download).toHaveBeenCalledOnce(), { timeout: 2500 });
  expect(mock.cloud).not.toHaveBeenCalled(); expect(mock.stage).toHaveBeenCalledWith(payload); expect(validate).toHaveBeenCalledTimes(2);
});
it('does not download when sources change during map rendering', async () => {
  const validate = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error('Sources changed'));
  render(<PackageExport projects={[{ id: 'm', name: 'Map' }]} onClose={() => {}} preset={{ picked: ['m'], mapPayloads: { m: { layout: {}, layers: [] } }, validate, draft: false }} />);
  start(); await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Sources changed'); expect(mock.download).not.toHaveBeenCalled();
});
it('ordinary package exports still load their current cloud maps', async () => {
  const payload = { layout: {}, layers: [] }; mock.cloud.mockResolvedValue({ payload });
  render(<PackageExport projects={[{ id: 'm', name: 'Map' }]} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Map' })); start();
  await waitFor(() => expect(mock.download).toHaveBeenCalledOnce(), { timeout: 2500 });
  expect(mock.cloud).toHaveBeenCalledWith('m'); expect(mock.stage).toHaveBeenCalledWith(payload);
});
