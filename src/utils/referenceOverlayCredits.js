import { REFERENCE_OVERLAY_CONFIG, REFERENCE_OVERLAY_KEYS } from './referenceOverlayConfig.js';

// What the reference overlays are, in words, for the people who read the map
// rather than build it.
//
// A viewer handed a finished map sees coloured shapes under the claims and has
// no way to learn what they mean: the toggle that switched them on is in the
// editor, the Leaflet attribution control is not part of an export, and the
// legend only lists the author's own layers. Reported exactly that way — "it's
// cool to have the bedrock overlayed but as a reader I don't even know what
// that is".
//
// So each enabled overlay contributes a margin note saying what it shows and
// who publishes it. That is also where the attribution obligation is met: these
// are third-party services whose licences require credit, and until now an
// exported PNG or SVG carried none.
//
// The names come from the shared config rather than a list kept here. A hand-
// kept list is what put the first version wrong: it credited "OpenStreetMap"
// for the two CARTO-hosted layers, so CARTO went uncredited in exactly the
// artifact this is meant to fix.
//
// Kept deliberately short. This sits in 7.5px type at the foot of the map,
// alongside the claim-provenance lines, and a paragraph there would be noise.
export function overlayCreditLine(key) {
  const cfg = REFERENCE_OVERLAY_CONFIG[key];
  if (!cfg) return null;
  const who = cfg.parties.join(' / ');
  return `${cfg.creditLabel}: ${who}${cfg.creditDetail ? `, ${cfg.creditDetail}` : ''}`;
}

export function referenceOverlayCredits(referenceOverlays) {
  const enabled = referenceOverlays || {};
  return REFERENCE_OVERLAY_KEYS
    .filter((key) => enabled[key])
    .map(overlayCreditLine)
    .filter(Boolean);
}

// For the editor, so the person turning the overlay on is told what it is at
// the moment they turn it on.
export const OVERLAY_DESCRIPTIONS = {
  geology: 'Colours show rock units from the USGS/GSC world geologic compilation — regional context, not property-scale mapping. The source is credited on your export.',
};
