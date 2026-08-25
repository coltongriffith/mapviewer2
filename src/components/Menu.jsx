import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * One dropdown-menu family for the whole editor.
 *
 * Behaviour, not decoration: click outside closes, Escape closes and returns
 * focus to the trigger, and the trigger carries aria-haspopup/aria-expanded so
 * the state is announced. Items are ordinary buttons — every existing click
 * handler moves across unchanged.
 */
export default function Menu({
  label,
  title,
  align = 'left',
  className = '',
  triggerClassName = 'ui-btn',
  disabled = false,
  icon = null,
  children,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = useId();

  const close = useCallback((refocus) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(true); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div className={`ui-menu-wrap ${className}`} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        title={title}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label}
        <svg className="ui-menu-caret" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          id={menuId}
          className={`ui-menu ui-menu--${align}`}
          role="menu"
          onClick={(e) => {
            // Any activated item closes the menu; separators and labels do not.
            if (e.target.closest('.ui-menu-item')) close(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** A single menu row. `hint` is the right-aligned secondary text (format, shortcut…). */
export function MenuItem({ onClick, disabled, children, hint, title }) {
  return (
    <button type="button" role="menuitem" className="ui-menu-item" onClick={onClick} disabled={disabled} title={title}>
      <span>{children}</span>
      {hint ? <span className="ui-menu-item-hint">{hint}</span> : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="ui-menu-sep" role="separator" />;
}

export function MenuLabel({ children }) {
  return <div className="ui-menu-label">{children}</div>;
}
