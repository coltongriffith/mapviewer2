import React from 'react';

/**
 * The Claim Matrix mark, inline.
 *
 * Inline rather than an <img> so it inherits nothing it shouldn't and needs no
 * network round trip in the toolbar; the file it mirrors is
 * public/brand/exploration-maps-mark.svg.
 *
 * Two brand rules are encoded here:
 *  - below 24px the internal copper square is dropped and the mark goes
 *    one-colour, which is what `size` switches on;
 *  - `reversed` swaps the territory to white for use on Mineral Slate.
 */
export default function BrandMark({ size = 20, reversed = false, className = '' }) {
  const solid = size < 24;
  const territory = reversed ? '#ffffff' : '#142126';
  const channel = reversed ? '#142126' : '#ffffff';

  return (
    <svg
      className={`em-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 480 520"
      aria-hidden="true"
      focusable="false"
    >
      <path fill={territory} d="M60 40H180V85H410V250H445V480H30V385H60Z" />
      <path
        fill="none"
        stroke={channel}
        strokeWidth="22"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        d="M18 180H132L205 250H240V325L320 400V490"
      />
      <path
        fill="none"
        stroke={channel}
        strokeWidth="22"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        d="M205 250L260 195"
      />
      <rect x="250" y="145" width="90" height="90" fill={channel} />
      {!solid && <rect x="273" y="168" width="44" height="44" fill="#C65322" />}
    </svg>
  );
}

/** The full lockup: mark plus the two-weight wordmark. */
