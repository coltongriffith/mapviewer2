// Helpers to extract and format mineral tenure claim info for tooltips/popups.
// Field names cover the BC MTA_ACQUIRED_TENURE_SVW schema with generic fallbacks.

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function claimSummary(props = {}, ownerName = null) {
  const tenure = props.TENURE_NUMBER_ID || props.TAG_NUMBER || props.TENURE_ID || props.TENURE_NO || props.ID || null;
  const owner = ownerName || props.OWNER_NAME || props.TENURE_HOLDER_NAME || props.HOLDER || props.OWNER || 'Unknown';
  const type = props.TENURE_TYPE_DESCRIPTION || props.TENURE_TYPE || null;
  const subtype = props.TENURE_SUBTYPE_DESCRIPTION || props.TENURE_SUBTYPE || null;
  const status = props.TENURE_STATUS || props.STATUS || null;
  const areaHa = props.AREA_IN_HECTARES != null && Number.isFinite(Number(props.AREA_IN_HECTARES))
    ? `${Number(props.AREA_IN_HECTARES).toLocaleString(undefined, { maximumFractionDigits: 1 })} ha` : null;
  const fmtDate = (d) => {
    if (!d) return null;
    const s = String(d);
    return s.includes('T') ? s.slice(0, 10) : s.slice(0, 10);
  };
  const issued = fmtDate(props.ISSUE_DATE || props.ISSUED_DATE);
  const goodTo = fmtDate(props.GOOD_TO_DATE || props.EXPIRY_DATE || props.GOODSTANDI);
  return { tenure, owner, type, subtype, status, areaHa, issued, goodTo };
}

export function claimTooltipHtml(props, ownerName = null) {
  const s = claimSummary(props, ownerName);
  const parts = [s.tenure, s.type].filter(Boolean).map(esc).join(' · ');
  return `<strong>${esc(s.owner)}</strong>${parts ? `<br/>${parts}` : ''}`;
}

export function claimPopupRowsHtml(props, ownerName = null) {
  const s = claimSummary(props, ownerName);
  const row = (label, value) => (value ? `<div class="acp-row"><b>${label}:</b> ${esc(value)}</div>` : '');
  return `<div class="acp-owner">${esc(s.owner)}</div>`
    + row('Tenure', s.tenure)
    + row('Type', [s.type, s.subtype].filter(Boolean).join(' — '))
    + row('Status', s.status)
    + row('Area', s.areaHa)
    + row('Issued', s.issued)
    + row('Good until', s.goodTo);
}
