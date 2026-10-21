import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ThreeDTab from '../src/components/admin/ThreeDTab';
import {
  kindRows, sharedMapsDaily, splitText, threeDTrackingNote, THREE_D_EXPORT_LABEL, THREE_D_DATA_LABEL, METRIC_DEFS,
} from '../src/components/admin/metrics';
import { threeDReport } from './fixtures/three-d-report';

const renderTab = (props = {}) => render(<ThreeDTab data={threeDReport} onOpenUser={() => {}} {...props} />);

describe('3D & sharing metrics', () => {
  it('labels export and data kinds, and keeps an unknown kind as itself', () => {
    expect(kindRows([{ kind: 'png', n: 6, sessions: 3 }, { kind: 'gif', n: 1, sessions: 1 }], THREE_D_EXPORT_LABEL)).toEqual([
      { label: '3D figure (PNG)', value: 6, sub: '3 tabs' }, { label: 'gif', value: 1, sub: '1 tab' },
    ]);
    expect(kindRows([{ kind: 'terrain', sessions: 2 }], THREE_D_DATA_LABEL, 'sessions')).toEqual([{ label: 'Real terrain', value: 2, sub: undefined }]);
    expect(kindRows(null)).toEqual([]);
  });

  it('adds 2D and 3D shares together per day', () => {
    expect(sharedMapsDaily([{ d: '2026-10-20', created_2d: 1, created_3d: 2, viewed_2d: null, viewed_3d: 4 }])).toEqual([
      { d: '2026-10-20', created_2d: 1, created_3d: 2, viewed_2d: null, viewed_3d: 4, created: 3, viewed: 4 },
    ]);
    expect(sharedMapsDaily(undefined)).toEqual([]);
    expect(splitText(1200, undefined)).toBe('2D 1,200 · 3D 0');
  });

  it('says what the event-only figures cover', () => {
    expect(threeDTrackingNote(null)).toMatch(/No \/3d events recorded yet/);
    expect(threeDTrackingNote('2026-10-20T16:00:00Z')).toMatch(/^\/3d events since Oct 20, 2026\. Projects, shares and versions come from their tables/);
  });

  it('defines every metric the tab explains', () => {
    for (const k of ['three_d_opens', 'three_d_active', 'three_d_projects', 'three_d_exports', 'three_d_data', 'three_d_top_projects',
      'shared_created', 'shared_viewed', 'shared_top']) expect(METRIC_DEFS[k]?.length, k).toBeGreaterThan(60);
  });
});

describe('3D & sharing tab', () => {
  it('shows 3D use, exports, projects and both kinds of shared map', () => {
    renderTab();
    expect(screen.getByText('6 added their own data · 4 exported')).toBeInTheDocument();
    expect(screen.getByText('6 png · 2 section · 1 layers')).toBeInTheDocument();
    expect(screen.getByText(/^\/3d events since Oct 20, 2026/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '3D opens per day' })).toBeInTheDocument();
    expect(screen.getByText('Designer layers (ZIP)')).toBeInTheDocument();
    expect(screen.getByText('Geology logs')).toBeInTheDocument();
    const [projects] = screen.getAllByRole('table');
    expect(within(projects).getByRole('rowheader', { name: /Rails Zone long section/ })).toBeInTheDocument();
    expect(within(projects).getByText(/· deleted/)).toBeInTheDocument();
    expect(screen.getByText('2D 6 · 3D 3 · 2 by AI')).toBeInTheDocument();
    expect(screen.getByText('2D 12 · 3D 11')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Shared maps made and viewed per day' })).toBeInTheDocument();
    const shares = screen.getAllByRole('table')[1];
    expect(within(shares).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['2D map', '3D figure', '2D map']);
    expect(within(shares).getByRole('link', { name: `/3d/share/${'a'.repeat(32)}` })).toHaveAttribute('href', `/3d/share/${'a'.repeat(32)}`);
    expect(within(shares).getByText('AI connector')).toBeInTheDocument();
  });

  it('opens an owner in the Users tab', () => {
    const onOpenUser = vi.fn();
    renderTab({ onOpenUser });
    fireEvent.click(screen.getAllByRole('button', { name: 'ana@example.test' })[0]);
    expect(onOpenUser).toHaveBeenCalledWith('00000000-0000-4000-8000-00000000000a');
  });

  it('says so when nothing happened', () => {
    const empty = {
      ...threeDReport, tracking_since: null, exports_by_kind: [], data_by_kind: [], top_projects: [],
      daily: [], shared_maps: { ...threeDReport.shared_maps, daily: [], top: [] },
    };
    renderTab({ data: empty });
    expect(screen.getByText('No one opened /3d in this period.')).toBeInTheDocument();
    expect(screen.getByText('No 3D exports in this period.')).toBeInTheDocument();
    expect(screen.getByText('No one added their own data in this period.')).toBeInTheDocument();
    expect(screen.getByText('No 3D figure was created, saved, shared or published in this period.')).toBeInTheDocument();
    expect(screen.getByText('No live link was made or viewed in this period.')).toBeInTheDocument();
    expect(screen.getByText(/No \/3d events recorded yet/)).toBeInTheDocument();
  });
});

describe('3D activity in the Users tab', () => {
  it('lists an account\'s 3D figures and hides itself when there are none', async () => {
    const { ThreeDActivity } = await import('../src/components/admin/UsersTab');
    const td = { project_count: 2, projects: [{ id: 'p1', name: 'Rails Zone', updated_at: '2026-10-20T15:00:00Z', deleted: false },
      { id: 'p2', name: 'Old', updated_at: '2026-10-01T15:00:00Z', deleted: true }], shares: 1, share_views: 9, versions: 2, exports: 4, last_active: null };
    const { container, rerender } = render(<ThreeDActivity td={td} />);
    expect(screen.getByText('3D figures (2)')).toBeInTheDocument();
    expect(screen.getByText('Old · deleted')).toBeInTheDocument();
    expect(screen.getByText('1 links · 9 views')).toBeInTheDocument();
    rerender(<ThreeDActivity td={{ project_count: 0, projects: [], shares: 0, exports: 0 }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ThreeDActivity td={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
