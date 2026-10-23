import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Importer } from '../src/components/workspace/DrillPanel.jsx';
const { readWorkbook } = vi.hoisted(() => ({ readWorkbook: vi.fn() }));
vi.mock('../src/utils/xlsxRead.js', () => ({ readWorkbook }));
vi.mock('../src/lib/supabase', () => ({ supabase: null }));
afterEach(() => vi.clearAllMocks());
function setup() {
  let resolve;
  readWorkbook.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<Importer db={{ templates: async () => [] }} property={{ id: 'fixture', crs: null }} orgId="fixture" onDone={() => {}} />);
  fireEvent.change(screen.getByLabelText('Drill data file'), { target: { files: [{ name: 'old.xlsx', size: 100 }] } });
  return () => resolve([{ sheet: 'Old sheet', data: [] }]);
}
describe('Excel file read lifetime', () => {
  it('ignores a completed read after cancellation', async () => {
    const finish = setup();
    await waitFor(() => expect(readWorkbook).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await act(async () => { finish(); });
    expect(screen.queryByRole('region', { name: 'Choose Excel sheet' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ Import CSV or Excel' })).toBeTruthy();
  });
  it('does not let an old workbook replace a newer CSV', async () => {
    const finish = setup();
    await waitFor(() => expect(readWorkbook).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Drill data file'), { target: { files: [{ name: 'new.csv', size: 100, text: async () => 'HoleID,From,To,Au_ppm\nTEST-01,0,1,0.5' }] } });
    await screen.findByRole('form', { name: 'Import drill data' });
    await act(async () => { finish(); });
    expect(screen.getByText('new.csv')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Choose Excel sheet' })).toBeNull();
  });
});
