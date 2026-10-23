import React, { useMemo, useState } from 'react';

// Receives the already-loaded reader, so selecting CSV never loads Excel code.
export default function ExcelSheetPicker({ workbook, onChoose, onCancel }) {
  const { sheets, reader, name } = workbook;
  const [index, setIndex] = useState(() => Math.max(0, sheets.findIndex(s => s.sheet === workbook.selection?.sheet)));
  const [headerRow, setHeaderRow] = useState(() => workbook.selection?.headerRow || reader.guessHeaderRow(sheets[index].data));
  const [decimalComma, setDecimalComma] = useState(() => workbook.selection?.decimalComma === true);
  const selected = sheets[index];
  const parsed = useMemo(() => {
    try { return { table: reader.sheetTable(selected, Number(headerRow)) }; }
    catch (e) { return { error: e.message }; }
  }, [reader, selected, headerRow]);
  return <section className="ws-form" aria-label="Choose Excel sheet">
    <b>{name}</b>
    <div className="ws-form-grid">
      <label className="ws-field">Sheet<select value={index} onChange={e => { const i = Number(e.target.value); setIndex(i); setHeaderRow(reader.guessHeaderRow(sheets[i].data)); }}>
        {sheets.map((s, i) => <option key={i} value={i}>{s.sheet}</option>)}
      </select></label>
      <label className="ws-field">Header row<input type="number" min="1" max={Math.max(1, selected.data.length)} value={headerRow} onChange={e => setHeaderRow(e.target.value)} /></label>
      <label className="ws-field">Decimal separator in text values<select value={decimalComma ? 'comma' : 'point'} onChange={e => setDecimalComma(e.target.value === 'comma')}>
        <option value="point">Point (0.52)</option><option value="comma">Comma (0,52)</option>
      </select></label>
    </div>
    <p className="dash-muted">Check the sheet and column names before continuing. The decimal choice applies to mapped numeric fields, never hole or sample IDs. Store IDs with leading zeros as text in Excel. Formula cells use their saved results: recalculate and save the workbook in Excel first.</p>
    <div className="ws-table-wrap"><table className="ws-table" aria-label="Excel row preview">
      <tbody>{selected.data.slice(Math.max(0, Number(headerRow) - 1), Math.max(0, Number(headerRow) - 1) + 6).map((r, i) => <tr key={i}>
        <th scope="row">{Number(headerRow) + i}</th>{r.slice(0, 10).map((v, j) => <td key={j}>{v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '')}</td>)}
      </tr>)}</tbody>
    </table></div>
    {parsed.error && <p className="ws-error" role="alert">{parsed.error}</p>}
    <div className="ws-row"><button className="btn primary" type="button" disabled={!parsed.table} onClick={() => onChoose(parsed.table, { sheet: selected.sheet, headerRow: Number(headerRow), decimalComma })}>Use these columns</button>
      <button className="btn" type="button" onClick={onCancel}>Cancel</button></div>
  </section>;
}
