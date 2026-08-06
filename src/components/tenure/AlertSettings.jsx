import React, { useEffect, useState } from 'react';
import {
  getAlertPolicy, updateAlertPolicy, listRecipients, addRecipient, removeRecipient,
} from '../../utils/tenureMonitor';
import { alertOffsetsFor, lockedAlertOffsets, canAddAlertRecipient } from '../../utils/entitlements';
import { TENURE_ALERT_DISCLAIMER } from '../../utils/tenureDisclaimer';

// Reminder settings.
//
// Two things this screen is careful about:
//
// 1. It states what an alert IS — a reminder generated from public data, not a
//    notice from the province. Somebody who thinks Exploration Maps will tell
//    them authoritatively when a claim lapses has been misled by us, and the
//    place to prevent that is where they turn the reminders on.
//
// 2. Thresholds above the plan's are shown as locked rather than hidden.
//    A free user should be able to see that a 7-day reminder exists; hiding it
//    makes the upgrade invisible and makes the product look less capable than
//    it is.

const OFFSET_LABEL = (d) => (d === 1 ? '1 day before' : `${d} days before`);

export default function AlertSettings({ portfolio, entitlements, onClose, onUpgrade }) {
  const [policy, setPolicy] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const allowed = alertOffsetsFor(entitlements);
  const locked = lockedAlertOffsets(entitlements);
  // Every threshold this account could ever see, longest lead time first.
  const rungs = [
    ...allowed.map((days) => ({ days, isLocked: false })),
    ...locked.map((days) => ({ days, isLocked: true })),
  ].sort((a, b) => b.days - a.days);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, r] = await Promise.all([
          getAlertPolicy(portfolio.alert_policy_id),
          listRecipients(portfolio.alert_policy_id),
        ]);
        if (cancelled) return;
        setPolicy(p);
        setRecipients(r);
      } catch (e) {
        if (!cancelled) setError(String(e.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, [portfolio.alert_policy_id]);

  if (!policy) {
    return (
      <div className="export-hd-overlay" role="dialog" aria-modal="true" aria-label="Reminder settings">
        <div className="tm-add-modal">
          <p className="tm-muted">{error || 'Loading reminder settings…'}</p>
          <button className="secondary-btn" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const current = new Set(policy.expiry_offsets || []);

  const toggleOffset = (days) => {
    const next = new Set(current);
    if (next.has(days)) next.delete(days); else next.add(days);
    setPolicy((p) => ({ ...p, expiry_offsets: [...next].sort((a, b) => b - a) }));
    setSaved(false);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateAlertPolicy(policy.id, {
        expiry_offsets: policy.expiry_offsets,
        change_events_enabled: policy.change_events_enabled,
      });
      setSaved(true);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const email = newEmail.trim();
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      await addRecipient(policy.id, email);
      setRecipients(await listRecipients(policy.id));
      setNewEmail('');
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function drop(id) {
    setBusy(true);
    try {
      await removeRecipient(id);
      setRecipients(await listRecipients(policy.id));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const canAddMore = canAddAlertRecipient(entitlements, recipients.length);

  return (
    <div className="export-hd-overlay" role="dialog" aria-modal="true" aria-label="Reminder settings">
      <div className="tm-add-modal">
        <button className="export-hd-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="export-hd-title">Reminders for {portfolio.name}</h2>

        <p className="tm-help">{TENURE_ALERT_DISCLAIMER}</p>

        <section className="tm-panel-section">
          <h3>When to remind you</h3>
          <p className="tm-field-hint">
            Counted back from each claim's good-to-date, in Pacific time. If the province
            moves a good-to-date, the reminders for that claim are recalculated
            automatically and the outdated ones are cancelled.
          </p>

          {/* One list in lead-time order, locked thresholds in place rather
              than appended. Free plans now include the 1-day reminder, so a
              locked 7-day sitting below it would read as the shortest option
              available and misrepresent both. */}
          <ul className="tm-offset-list">
            {rungs.map(({ days, isLocked }) => (
              <li key={days} className={isLocked ? 'tm-offset-locked' : undefined}>
                <label className="tm-checkbox">
                  <input
                    type="checkbox"
                    disabled={isLocked}
                    checked={!isLocked && current.has(days)}
                    onChange={isLocked ? undefined : () => toggleOffset(days)}
                  />
                  <span>
                    {OFFSET_LABEL(days)}
                    {isLocked && <span className="tm-lock-tag">Pro</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {locked.length > 0 && onUpgrade && (
            <p className="tm-field-hint">
              <button type="button" className="tm-link-btn" onClick={onUpgrade}>
                Upgrade to Pro
              </button>
              {' '}to add {locked.map((d) => OFFSET_LABEL(d).toLowerCase()).join(' and ')}.
            </p>
          )}

          <label className="tm-checkbox">
            <input
              type="checkbox"
              checked={policy.change_events_enabled}
              onChange={() => {
                setPolicy((p) => ({ ...p, change_events_enabled: !p.change_events_enabled }));
                setSaved(false);
              }}
            />
            <span>
              Tell me when a monitored claim changes
              <span className="tm-field-hint">
                Good-to-date, status, ownership, area and boundary changes detected in the
                government record. Change notices are held back automatically whenever a
                government data import looks incomplete, so a bad night at the province
                cannot produce a wave of false alarms.
              </span>
            </span>
          </label>

          <div className="tm-panel-actions">
            <button className="btn primary" type="button" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save reminders'}
            </button>
            {saved && <span className="tm-saved-flash">Saved</span>}
          </div>
        </section>

        <section className="tm-panel-section">
          <h3>Who receives them</h3>
          <ul className="tm-recipient-list">
            {recipients.map((r) => (
              <li key={r.id}>
                <span>{r.email}</span>
                {r.role === 'owner' && <span className="tm-tag">account owner</span>}
                {r.bounced_at && (
                  <span className="tm-tag tm-tag--danger" title={r.bounce_reason || ''}>
                    bounced — not receiving mail
                  </span>
                )}
                {r.role !== 'owner' && (
                  <button type="button" className="tm-link-btn" onClick={() => drop(r.id)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>

          {canAddMore ? (
            <div className="tm-search-form">
              <label className="tm-sr-only" htmlFor="tm-new-recipient">Add a recipient email</label>
              <input
                id="tm-new-recipient"
                className="tm-input"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="colleague@company.com"
              />
              <button className="btn" type="button" disabled={busy || !newEmail.trim()} onClick={add}>
                Add
              </button>
            </div>
          ) : (
            <p className="tm-field-hint">
              {entitlements.max_alert_recipients === 1
                ? 'Your plan sends reminders to one address.'
                : `Your plan sends reminders to ${entitlements.max_alert_recipients} addresses.`}
              {onUpgrade && (
                <> <button type="button" className="tm-link-btn" onClick={onUpgrade}>Upgrade</button> to add more.</>
              )}
            </p>
          )}
        </section>

        {error && <p className="tm-error" role="alert">{error}</p>}

        <footer className="tm-add-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
