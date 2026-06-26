import React from 'react';

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * A color picker that mirrors a native <input type="color"> but also surfaces
 * the user's brand palette as one-click swatches beneath it.
 *
 * The onChange contract is identical to the native input: it always receives an
 * event-shaped argument ({ target: { value } }). Brand-swatch clicks synthesize
 * that shape so existing handlers reading `e.target.value` work unchanged.
 *
 * When `brandColors` is empty (anonymous user / no default kit + default theme),
 * no swatch row renders — the control looks exactly like a plain color input.
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
  return (
    <div className="color-field">
      <div className="color-swatch-wrap">
        <input type="color" className={className} value={value} onChange={onChange} title={title} />
        {onReset && (
          <button className="swatch-reset" type="button" onClick={onReset} title="Reset">✕</button>
        )}
      </div>
      {swatches.length > 0 && (
        <div className="brand-swatch-row">
          {swatches.map((c, i) => (
            <button
              key={`${c.hex}-${i}`}
              type="button"
              className="brand-swatch"
              style={{ background: c.hex }}
              title={`${c.label} — ${c.hex}`}
              aria-label={`Use brand color ${c.label}`}
              onClick={() => onChange({ target: { value: c.hex } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
