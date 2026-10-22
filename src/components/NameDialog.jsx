import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import Dialog from './Dialog';

/**
 * Ask for a name in the app instead of window.prompt(), which blocks the
 * page (and any agent or test driving it) until it is answered. Enter saves,
 * Escape or Cancel closes without saving; the field starts with the default
 * selected, so typing replaces it. Portalled to <body> so a panel it is
 * opened from (the legend editor) cannot clip it.
 */
export default function NameDialog({
  title, label = 'Name', initialValue = '', confirmLabel = 'Save', onSubmit, onClose,
}) {
  const [value, setValue] = useState(initialValue);
  const name = value.trim();
  return createPortal(
    <Dialog onClose={onClose} title={title} titleId="name-dialog-title" panelClassName="modal-panel auth-modal name-dialog">
      <form className="auth-form" onSubmit={(e) => { e.preventDefault(); if (name) onSubmit(name); }}>
        <label className="auth-label" htmlFor="name-dialog-input">
          {label}
          <input
            id="name-dialog-input"
            className="auth-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            maxLength={200}
            autoComplete="off"
            required
          />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="ui-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="ui-btn ui-btn--primary" type="submit" disabled={!name}>{confirmLabel}</button>
        </div>
      </form>
      {/* After the form, so the dialog's first-focus lands on the field. */}
      <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Close">×</button>
    </Dialog>,
    document.body,
  );
}
