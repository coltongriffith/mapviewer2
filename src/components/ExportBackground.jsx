// The Export step's background choice for a blank basemap (PNG and SVG; a PDF page is always opaque). Lazy, so
// the editor's first load does not carry it.
export default function ExportBackground({ layout, updateLayout }) {
  return (
    <label className="toggle-row">
      <input type="checkbox" checked={layout.exportSettings?.background === 'transparent'} onChange={(e) => updateLayout({ exportSettings: { background: e.target.checked ? 'transparent' : 'white' } })} />
      <span>Transparent background (PNG and SVG; PDF stays white)</span>
    </label>
  );
}
