import React, { useState } from 'react';
import { rankNotices, SEVERITY } from '../utils/claimNotices';

// One notice region for a claim result set, instead of four stacked blocks.
//
// The expanded notice reads as it always did. The rest become a single row of
// short labels; clicking one opens its full text underneath. Nothing is
// removed — the wording of every `detail` is unchanged, and the export path
// still carries the full disclaimers onto the map itself.
//
// The blocking claim-name gate is deliberately NOT rendered here. It owns a
// checkbox that stops an import, so it stays where it is, at full size, as the
// only loud thing on the panel.
export default function ClaimNoticeStrip({ notices }) {
  const [openId, setOpenId] = useState(null);
  const { expanded, collapsed } = rankNotices(
    (notices || []).filter((n) => n.severity !== SEVERITY.BLOCKING),
  );

  if (!expanded.length && !collapsed.length) return null;

  return (
    <div className="claim-notices">
      {expanded.map((n) => (
        <div key={n.id} className="claim-notices-lead" role="alert">
          <strong>{n.short}</strong>
          {n.detail ? <span>{n.detail}</span> : null}
        </div>
      ))}

      {collapsed.length > 0 && (
        <div className="claim-notices-rest">
          {collapsed.map((n) => (
            n.detail ? (
              <button
                key={n.id}
                type="button"
                className="claim-notices-chip"
                aria-expanded={openId === n.id}
                onClick={() => setOpenId(openId === n.id ? null : n.id)}
              >
                {n.short}
              </button>
            ) : (
              <span key={n.id} className="claim-notices-chip claim-notices-chip--static">
                {n.short}
              </span>
            )
          ))}
        </div>
      )}

      {openId && (
        <p className="claim-notices-detail">
          {collapsed.find((n) => n.id === openId)?.detail}
        </p>
      )}
    </div>
  );
}
