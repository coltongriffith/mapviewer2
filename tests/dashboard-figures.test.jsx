import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { filterAndSort, fmtRelative } from '../src/utils/dashboardList.js';

// The dashboard's 3D figures section and the list rules it shares with maps.

const authState = { user: { id: 'u1', email: 'geo@example.com' }, loading: false, signOut: vi.fn() };
vi.mock('../src/hooks/useAuth.jsx', () => ({ useAuth: () => authState }));

let figures = [];
let properties = [];
const api = vi.hoisted(() => ({}));
vi.mock('../src/utils/figures.js', () => {
  Object.assign(api, {
    listMyFigures: vi.fn(async () => figures),
    renameFigure: vi.fn(async () => ({})),
    deleteFigure: vi.fn(async () => {}),
    duplicateFigure: vi.fn(async (id, taken) => ({ id: 'copy', name: `${taken[0]} (copy)` })),
    editableProperties: vi.fn(async () => properties),
    moveFigure: vi.fn(async () => ({})),
    figureUrl: (id) => `/3d?project=${id}`,
    newFigureUrl: () => '/3d',
  });
  return api;
});

const fig = (id, name, updatedAt = '2026-10-01T00:00:00Z', thumbnail = null) => ({ id, name, updatedAt, thumbnail, bytes: 0 });

async function renderSection(props = {}) {
  const { default: FiguresSection } = await import('../src/components/FiguresSection.jsx');
  return render(<FiguresSection onError={vi.fn()} {...props} />);
}

beforeEach(() => {
  figures = [];
  properties = [];
  Object.values(api).forEach((f) => f.mockClear?.());
});

describe('filterAndSort', () => {
  const list = [
    { name: 'Cariboo', updatedAt: '2026-01-01' },
    { name: 'Golden Triangle', updatedAt: '2026-08-01' },
    { name: 'cariboo north', updatedAt: '2026-05-01' },
  ];
  it('puts the most recently edited first by default', () => {
    expect(filterAndSort(list).map((x) => x.name)).toEqual(['Golden Triangle', 'cariboo north', 'Cariboo']);
  });
  it('matches names regardless of case, and sorts by name', () => {
    expect(filterAndSort(list, ' CARIBOO ', 'name').map((x) => x.name)).toEqual(['Cariboo', 'cariboo north']);
  });
  it('never changes the list it was given', () => {
    const copy = [...list];
    filterAndSort(list, '', 'name');
    expect(list).toEqual(copy);
  });
  it('says when, relatively', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');
    expect(fmtRelative('2026-10-21T08:00:00Z', now)).toBe('Today');
    expect(fmtRelative('2026-10-20T08:00:00Z', now)).toBe('Yesterday');
    expect(fmtRelative('2026-10-17T08:00:00Z', now)).toBe('4 days ago');
    expect(fmtRelative('', now)).toBe('');
  });
});

describe('the 3D figures section', () => {
  it('shows an empty state with a way to start one', async () => {
    await renderSection();
    await screen.findByText(/no 3d figures yet/i);
    expect(screen.getByRole('link', { name: '+ New 3D figure' }).getAttribute('href')).toBe('/3d');
  });

  it('lists figures most recent first, with the stored thumbnail', async () => {
    figures = [fig('a', 'Old figure', '2026-01-01T00:00:00Z'), fig('b', 'New figure', '2026-09-01T00:00:00Z', 'data:image/jpeg;base64,AA')];
    const { container } = await renderSection();
    await screen.findByText('New figure');
    expect([...container.querySelectorAll('.dash-tile-name')].map((n) => n.textContent)).toEqual(['New figure', 'Old figure']);
    expect(container.querySelector('[data-figure="b"] img').getAttribute('src')).toBe('data:image/jpeg;base64,AA');
    expect(container.querySelector('[data-figure="a"] img')).toBeNull();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('searches and sorts like the maps do', async () => {
    figures = [fig('a', 'Rails section'), fig('b', 'Tower block'), fig('c', 'Rails long')];
    const { container } = await renderSection();
    await screen.findByText('Tower block');
    fireEvent.change(screen.getByLabelText(/search your 3d figures/i), { target: { value: 'rails' } });
    await waitFor(() => expect(screen.queryByText('Tower block')).toBeNull());
    fireEvent.change(screen.getByLabelText(/sort 3d figures/i), { target: { value: 'name' } });
    expect([...container.querySelectorAll('.dash-tile-name')].map((n) => n.textContent)).toEqual(['Rails long', 'Rails section']);
    fireEvent.change(screen.getByLabelText(/search your 3d figures/i), { target: { value: 'zzz' } });
    await screen.findByText(/no 3d figures match/i);
  });

  it('renames in an in-app dialog', async () => {
    figures = [fig('a', 'Rails section')];
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Rails section' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename 3D figure' });
    const field = within(dialog).getByLabelText('Figure name');
    expect(field.value).toBe('Rails section');
    fireEvent.change(field, { target: { value: 'Rails A–A′' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(api.renameFigure).toHaveBeenCalledWith('a', 'Rails A–A′'));
    await waitFor(() => expect(api.listMyFigures).toHaveBeenCalledTimes(2));
  });

  it('duplicates with every name taken in view, and says what it made', async () => {
    figures = [fig('a', 'Rails section'), fig('b', 'Rails section (copy)')];
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Rails section', exact: true }));
    await waitFor(() => expect(api.duplicateFigure).toHaveBeenCalled());
    const [id, taken] = api.duplicateFigure.mock.calls[0];
    expect(id).toBe('a');
    expect(taken).toEqual(expect.arrayContaining(['Rails section', 'Rails section (copy)']));
    await screen.findByRole('status');
  });

  it('deletes only after a confirm', async () => {
    figures = [fig('a', 'Rails section')];
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Rails section' }));
    expect(api.deleteFigure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Rails section' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete Rails section' }));
    await waitFor(() => expect(api.deleteFigure).toHaveBeenCalledWith('a'));
  });

  it('offers Move to a property only to someone who edits one, and moves into the chosen one', async () => {
    figures = [fig('a', 'Rails section')];
    const { unmount } = await renderSection();
    await screen.findByText('Rails section');
    expect(screen.queryByRole('button', { name: /move rails section/i })).toBeNull();
    unmount();

    properties = [{ id: 'p1', org_id: 'o1', name: 'Rails', orgName: 'Star Copper' }, { id: 'p2', org_id: 'o1', name: 'Tower', orgName: 'Star Copper' }];
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Move Rails section to a property' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Property'), { target: { value: 'p2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(api.moveFigure).toHaveBeenCalledWith('a', properties[1]));
    await screen.findByText(/moved “rails section” to tower/i);
  });

  it('says when the list could not load, rather than showing none', async () => {
    api.listMyFigures.mockRejectedValueOnce(new Error('offline'));
    await renderSection();
    await screen.findByText(/couldn.t load your 3d figures/i);
    expect(screen.queryByText(/no 3d figures yet/i)).toBeNull();
  });
});
