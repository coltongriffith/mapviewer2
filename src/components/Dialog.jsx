import React, { useEffect, useRef, useCallback } from 'react';

/**
 * One accessible dialog primitive (audit P1-19).
 *
 * Modals across the app each implemented their own subset of the behaviour —
 * AuthModal had no role, no accessible name, no focus trap, no Escape and no
 * focus restoration, so focus could wander behind the overlay and a screen
 * reader gave no indication a dialog had opened.
 *
 * Provides: role="dialog" + aria-modal, an accessible name, initial focus,
 * a focus trap, Escape to close, background scroll lock, backdrop click, and
 * focus restoration to whatever was focused before it opened.
 */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function Dialog({
  onClose,
  title,
  titleId = 'dialog-title',
  className = '',
  panelClassName = 'modal-panel',
  children,
  // Some flows (password recovery) must not be dismissible by a stray click
  // or Escape — leaving them half-completed is the confusing state.
  dismissible = true,
  labelledBy,
}) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  const close = useCallback(() => {
    if (dismissible) onClose?.();
  }, [dismissible, onClose]);

  useEffect(() => {
    restoreRef.current = document.activeElement;

    // Focus the first meaningful control, or the panel itself.
    const panel = panelRef.current;
    const first = panel?.querySelector(FOCUSABLE);
    (first || panel)?.focus?.();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;

      // Trap: cycle within the dialog instead of escaping to the page behind.
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // Put focus back where the user left it.
      try { restoreRef.current?.focus?.(); } catch { /* element may be gone */ }
    };
  }, [close]);

  return (
    <div
      className={`modal-backdrop ${className}`.trim()}
      onMouseDown={(e) => { if (dismissible && e.target === e.currentTarget) close(); }}
    >
      <div
        ref={panelRef}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || (title ? titleId : undefined)}
        tabIndex={-1}
      >
        {title && <h2 className="auth-modal-title" id={titleId}>{title}</h2>}
        {children}
      </div>
    </div>
  );
}
