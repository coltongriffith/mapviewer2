import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { mapName, copyName, UNTITLED_MAP } from '../src/utils/mapName.js';
import NameDialog from '../src/components/NameDialog.jsx';
import LegendEditor from '../src/components/LegendEditor.jsx';

// B4: one name for a map everywhere. The dashboard said "Untitled map Copy"
// while the editor showed the figure title of the same map.

describe('mapName', () => {
  it('is the saved name when the map has one', () => {
    expect(mapName('Tower drill plan', 'Figure 2')).toBe('Tower drill plan');
  });

  it('is the figure title while the record is still "Untitled map"', () => {
    expect(mapName(UNTITLED_MAP, 'Tower Project')).toBe('Tower Project');
    expect(mapName('', '  Tower Project ')).toBe('Tower Project');
    expect(mapName(null, undefined)).toBe(UNTITLED_MAP);
  });

  it('does not take the placeholder title a new map starts with', () => {
    expect(mapName(UNTITLED_MAP, 'Project Map')).toBe(UNTITLED_MAP);
  });
});

describe('copyName', () => {
  it('names the first copy "<name> (copy)"', () => {
    expect(copyName('Tower', [])).toBe('Tower (copy)');
  });

  it('numbers later copies, skipping names already taken', () => {
    expect(copyName('Tower', ['Tower', 'Tower (copy)'])).toBe('Tower (copy 2)');
    expect(copyName('Tower', ['Tower (copy)', 'Tower (copy 2)'])).toBe('Tower (copy 3)');
  });

  it('copies a copy under the original name rather than stacking suffixes', () => {
    expect(copyName('Tower (copy)', ['Tower', 'Tower (copy)'])).toBe('Tower (copy 2)');
    expect(copyName('Tower (copy 2)', ['Tower (copy)', 'Tower (copy 2)'])).toBe('Tower (copy 3)');
  });

  it('falls back to "Untitled map" for a nameless map', () => {
    expect(copyName('', [])).toBe('Untitled map (copy)');
  });
});

describe('NameDialog (Save As, new legend heading)', () => {
  it('is a labelled dialog with the default name in a labelled field', () => {
    render(<NameDialog title="Save as a new map" label="Map name" initialValue="Tower (2)" onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Save as a new map' })).toBeTruthy();
    const field = screen.getByLabelText('Map name');
    expect(field.value).toBe('Tower (2)');
    expect(document.activeElement).toBe(field);
  });

  it('saves the trimmed name on Enter', () => {
    const onSubmit = vi.fn();
    render(<NameDialog title="Save as" label="Map name" initialValue="Tower" onSubmit={onSubmit} onClose={vi.fn()} />);
    const field = screen.getByLabelText('Map name');
    fireEvent.change(field, { target: { value: '  Tower v2 ' } });
    fireEvent.submit(field.closest('form'));
    expect(onSubmit).toHaveBeenCalledWith('Tower v2');
  });

  it('closes on Escape and on Cancel without saving, and will not save an empty name', () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<NameDialog title="Save as" label="Map name" initialValue="Tower" onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText('Map name'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText('Map name').closest('form'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('Legend "New heading…" asks in the app, not with window.prompt()', () => {
  it('opens the name dialog and files the entry under the typed heading', () => {
    const prompt = vi.spyOn(window, 'prompt');
    const updateLayout = vi.fn();
    const layout = { legendGrouped: true, legendCustomItems: [{ id: 'custom-1', label: 'Mill site', symbol: 'circle', color: '#000000' }] };
    render(<LegendEditor derivedItems={[]} layout={layout} updateLayout={updateLayout} />);
    fireEvent.change(screen.getByLabelText(/to heading$/), { target: { value: '__new__' } });
    expect(screen.getByRole('dialog', { name: 'New legend heading' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Heading'), { target: { value: 'Infrastructure' } });
    fireEvent.submit(screen.getByLabelText('Heading').closest('form'));
    expect(updateLayout).toHaveBeenCalledWith({ legendOverrides: { 'custom-1': { group: 'Infrastructure' } } });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(prompt).not.toHaveBeenCalled();
  });
});
