// The Export step's watermark band and designer layers. Lazy, so the editor's first load does not carry it.
//
// The band (export/watermarkBand.js, shared with /3d) goes under the PNG, SVG and PDF: the Exploration Maps mark,
// "DRAFT FOR REVIEW · NOT FOR PUBLICATION", who it was prepared for and the year. It is on by default for the
// free plan and for sample maps, off otherwise; ticking or unticking it is kept with the map's export settings.
// The layers ZIP (export/exportLayers.js) holds the figure, the map alone, the annotations alone on transparency
// and, on plans with SVG export, the annotations as SVG with live text.
export default function ExportExtras({ layout, updateLayout, bandDefault, svgAllowed, disabled, onLayers }) {
  const es = layout.exportSettings || {};
  const band = es.band ?? bandDefault;
  const set = (o) => updateLayout({ exportSettings: o });
  return (
    <>
      <label className="toggle-row">
        <input type="checkbox" checked={band} onChange={(e) => set({ band: e.target.checked })} />
        <span>Watermark band under the export (draft for review)</span>
      </label>
      {band && (
        <div className="control-row">
          <label htmlFor="f-band-client">Prepared for</label>
          <input id="f-band-client" value={es.bandClient || ''} placeholder={layout.companyName || 'Client name'} onChange={(e) => set({ bandClient: e.target.value })} />
        </div>
      )}
      <div className="ins-export-layers">
        <label className="toggle-row">
          <input type="checkbox" checked={Boolean(svgAllowed && es.layersSvg)} disabled={!svgAllowed} onChange={(e) => set({ layersSvg: e.target.checked })} />
          <span>Layers include annotations.svg (live text){svgAllowed ? '' : ' (Pro)'}</span>
        </label>
        <button className="btn" type="button" disabled={disabled} onClick={onLayers}
          title="figure.png, map.png (basemap and data only) and annotations.png (transparent), in one ZIP for a designer">
          Download layers (ZIP)
        </button>
      </div>
    </>
  );
}
