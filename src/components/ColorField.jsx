import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * A color picker that combines the user's brand palette with a custom color
 * control in a single popover.
 *
 * Clicking the swatch trigger opens one panel containing the brand colors AND a
 * "Custom" native color control — so the brand swatches and the OS color dialog
 * never fight over the same screen space. The native dialog only opens if the
 * user explicitly clicks the Custom control inside the panel.
 *
 * The popover is positioned with `position: fixed`, anchored to the trigger via
 * getBoundingClientRect and clamped to the viewport, so it is never clipped by an
 * ancestor's overflow (e.g. the scrollable inset controls or the Brand Kit
 * Studio body) and never hangs off-screen.
 *
 * The onChange contract is identical to a native <input type="color">: it always
 * receives an event-shaped argument ({ target: { value } }). Brand-swatch clicks
 * synthesize that shape so existing handlers reading `e.target.value` work
 * unchanged.
 *
 * When `brandColors` is empty (anonymous user / no default kit + default theme),
 * the control collapses to a plain native color input — no popover, no trigger.
 */
export default function ColorField({
  value,
  onChange,
  title,
  brandColors = [],
  onReset,
  className = 'swatch-input',
}) {
  const swatches = brandColors.filter((c) => c && HEX_RE.test(c.hex));
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);

  // Anchor the fixed-position popover under the trigger, clamped to the viewport.
  // Flips above the trigger when there isn't room below.
  const reposition = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const pw = popRef.current?.offsetWidth || 188;
    const ph = popRef.current?.offsetHeight || 130;
    const m = 8;
    let left = r.left;
    if (left + pw > window.innerWidth - m) left = window.innerWidth - pw - m;
    if (left < m) left = m;
    let top = r.bottom + 4;
    if (top + ph > window.innerHeight - m) {
      const above = r.top - ph - 4;
      top = above >= m ? above : Math.max(m, window.innerHeight - ph - m);
    }
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    reposition();
    const onScroll = () => reposition();
    const onResize = () => reposition();
    // capture:true so scrolls inside any container (sidebar, modal body) recompute.
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // No brand colors: behave exactly like a plain native color input.
  if (swatches.length === 0) {
    return (
      <div className="color-field">
        <div className="color-swatch-wrap">
          <input type="color" className={className} value={value} onChange={onChange} title={title} />
          {onReset && (
            <button className="swatch-reset" type="button" onClick={onReset} title="Reset">✕</button>
          )}
        </div>
      </div>
    );
  }

  const current = (value || '').toLowerCase();

  return (
    <div className="color-field">
      <div className="color-swatch-wrap" ref={wrapRef}>
        <button
          ref={triggerRef}
          type="button"
          className={`${className} color-trigger`}
          style={{ background: value }}
          onClick={() => setOpen((o) => !o)}
          title={title}
          aria-haspopup="dialog"
          aria-expanded={open}
        />
        {onReset && (
          <button className="swatch-reset" type="button" onClick={onReset} title="Reset">✕</button>
        )}
        {open && (
          <div
            ref={popRef}
            className="color-popover"
            role="dialog"
            aria-label="Choose color"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
          >
            <div className="color-popover-heading">Brand colors</div>
            <div className="brand-swatch-grid">
              {swatches.map((c, i) => (
                <button
                  key={`${c.hex}-${i}`}
                  type="button"
                  className={`brand-swatch${c.hex.toLowerCase() === current ? ' selected' : ''}`}
                  style={{ background: c.hex }}
                  title={`${c.label} — ${c.hex}`}
                  aria-label={`Use brand color ${c.label}`}
                  onClick={() => { onChange({ target: { value: c.hex } }); setOpen(false); }}
                />
              ))}
            </div>
            <label className="color-custom-row">
              <input type="color" className="swatch-input" value={value} onChange={onChange} title={title} />
              <span>Custom color</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
