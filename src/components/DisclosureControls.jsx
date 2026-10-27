import { STANDARDS } from '../../shared/disclosure.js';

// The figure's disclosure standard (layout.disclosureStandard): with one set, the publication check runs before
// a download and warns about what the standard expects and the figure leaves out (shared/disclosure.js). Lazy,
// as the Export step's other extras.
export default function DisclosureControls({ layout, updateLayout }) {
  const std = STANDARDS[layout.disclosureStandard] ? layout.disclosureStandard : '';
  return (
    <>
      <div className="control-row">
        <label htmlFor="f-disclosure-standard">Disclosure standard</label>
        <select id="f-disclosure-standard" value={std} onChange={(e) => updateLayout({ disclosureStandard: e.target.value || null })}>
          <option value="">None</option>
          <option value="ni43101">NI 43-101 (Canada)</option>
          <option value="sk1300">S-K 1300 (US)</option>
        </select>
      </div>
      {std && (
        <>
          <label className="toggle-row">
            <input type="checkbox" checked={!!layout.disclosurePending} onChange={(e) => updateLayout({ disclosurePending: e.target.checked })} />
            <span>The figure shows holes with assays pending</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={!!layout.disclosureHistorical} onChange={(e) => updateLayout({ disclosureHistorical: e.target.checked })} />
            <span>The figure shows historical data</span>
          </label>
          <div className="small-note">The publication check looks for a scale bar, a north arrow, the coordinate system, data sources and these labels. It is a checklist, not advice on the rules.</div>
        </>
      )}
    </>
  );
}
