// Helpers to extract and format mineral tenure claim info for tooltips/popups.
// Field names cover the BC MTA_ACQUIRED_TENURE_SVW schema with generic
// fallbacks, plus the normalized U.S. federal (BLM MLRS) keys produced by
// api/claims.js (CLAIM_NAME / TAG_NUMBER / LEGACY_NR / STATUS / US_STATE /
// SOURCE_SYSTEM / GEOM_GENERALIZED).

export const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Verbatim spec wording — keep in sync with utils/jurisdictions.js.
const US_DISCLAIMER =
  'U.S. mining-claim boundaries shown by Exploration Maps are generalized representations derived from public BLM records. They are not legal surveys and should not be relied upon to determine exact claim boundaries or ownership.';

export function claimSummary(props = {}, ownerName = null) {
  const tenure = props.TENURE_NUMBER_ID || props.TAG_NUMBER || props.TENURE_ID || props.TENURE_NO || props.ID || null;
  const owner = ownerName || props.OWNER_NAME || props.TENURE_HOLDER_NAME || props.HOLDER || props.OWNER || null;
  const name = props.CLAIM_NAME || null;
  const type = props.TITLE_TYPE_DESCRIPTION || props.TENURE_TYPE_DESCRIPTION || props.TENURE_TYPE || null;
  const subtype = props.TENURE_SUBTYPE_DESCRIPTION || props.TENURE_SUBTYPE || null;
  const status = props.TENURE_STATUS || props.STATUS || null;
  const legacy = props.LEGACY_NR || null;
  const usState = props.US_STATE || null;
  const source = props.SOURCE_SYSTEM || null;
  const generalized = props.GEOM_GENERALIZED === true;
  const areaHa = props.AREA_IN_HECTARES != null && Number.isFinite(Number(props.AREA_IN_HECTARES))
    ? `${Number(props.AREA_IN_HECTARES).toLocaleString(undefined, { maximumFractionDigits: 1 })} ha` : null;
  const fmtDate = (d) => {
    if (!d) return null;
    const s = String(d);
    return s.includes('T') ? s.slice(0, 10) : s.slice(0, 10);
  };
  const issued = fmtDate(props.ISSUE_DATE || props.ISSUED_DATE);
  const goodTo = fmtDate(props.GOOD_TO_DATE || props.EXPIRY_DATE || props.GOODSTANDI);
  return {
    tenure,
    owner: owner || (name ? null : 'Unknown'),
    name, type, subtype, status, legacy, usState, source, generalized,
    areaHa, issued, goodTo,
  };
}

export function claimTooltipHtml(props, ownerName = null) {
  const s = claimSummary(props, ownerName);
  // US federal claims have no claimant in the spatial data — lead with the
  // claim name instead of a fabricated "Unknown" owner.
  const heading = s.owner || s.name || 'Unknown';
  const parts = [s.tenure, s.type].filter(Boolean).map(esc).join(' · ');
  return `<strong>${esc(heading)}</strong>${parts ? `<br/>${parts}` : ''}`;
}

export function claimPopupRowsHtml(props, ownerName = null) {
  const s = claimSummary(props, ownerName);
  const row = (label, value) => (value ? `<div class="acp-row"><b>${label}:</b> ${esc(value)}</div>` : '');
  const heading = s.owner || s.name || 'Unknown';
  const isUs = s.source === 'BLM MLRS';
  return `<div class="acp-owner">${esc(heading)}</div>`
    + (s.owner && s.name ? row('Claim name', s.name) : '')
    + row(isUs ? 'MLRS serial' : 'Tenure', s.tenure)
    + (isUs ? row('Legacy serial', s.legacy) : '')
    + (isUs ? row('State', s.usState) : '')
    + row('Type', [s.type, s.subtype].filter(Boolean).join(' — '))
    + row('Status', s.status)
    + row('Area', s.areaHa)
    + row('Issued', s.issued)
    + row('Good until', s.goodTo)
    + (isUs ? row('Claimant', s.owner ? null : 'Not available in BLM spatial data') : '')
    + (isUs ? row('Source', 'BLM MLRS (federal)') : '')
    + (s.generalized ? `<div class="acp-row acp-disclaimer" style="margin-top:6px;font-size:11px;color:#94a3b8">${esc(US_DISCLAIMER)}</div>` : '');
}
