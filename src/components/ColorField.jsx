import React, { useEffect, useRef, useState } from 'react';

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * A color picker that mirrors a native <input type="color"> but also surfaces
 * the user's brand palette as one-click swatches in a popover.
 *
 * The brand swatches stay hidden until the user clicks the color input (which is
 * when they're about to pick a color), then appear in a small popover anchored
 * to the control — so the editor isn't cluttered with always-visible swatch rows.
 *
 * The onChange contract is identical to the native input: it always receives an
 * event-shaped argument ({ target: { value } }). Brand-swatch clicks synthesize
 * that shape so existing handlers reading `e.target.value` work unchanged.
 *
 * When `brandColors` is empty (anonymous user / no default kit + default theme),
 * no popover ever renders — the control looks exactly like a plain color input.
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
  const wrapRef = useRef(null);

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

  return (
    <div className="color-field">
      <div className="color-swatch-wrap" ref={wrapRef}>
        <input
          type="color"
          className={className}
          value={value}
          onChange={onChange}
          onFocus={() => swatches.length > 0 && setOpen(true)}
          title={title}
        />
        {onReset && (
          <button className="swatch-reset" type="button" onClick={onReset} title="Reset">✕</button>
        )}
        {open && swatches.length > 0 && (
          <div className="brand-swatch-popover" role="listbox" aria-label="Brand colors">
            {swatches.map((c, i) => (
              <button
                key={`${c.hex}-${i}`}
                type="button"
                className="brand-swatch"
                style={{ background: c.hex }}
                title={`${c.label} — ${c.hex}`}
                aria-label={`Use brand color ${c.label}`}
                onClick={() => { onChange({ target: { value: c.hex } }); setOpen(false); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
