// The Inset Style control's choices, mapped to and from the layout.
//
// A satellite_locator inset draws whatever tiles insetBasemap names. Maps made
// through the agent API / MCP connector can carry non-imagery tiles there
// (light grey, dark, terrain), and showing those as "Satellite" left no way to
// switch the inset to imagery: the control already read Satellite, so picking
// it changed nothing.
const SATELLITE_TILES = new Set(['satellite', 'satellite_hybrid']);

export function insetStyle(layout) {
  if (layout?.insetMode !== 'satellite_locator') return 'standard';
  return !layout.insetBasemap || SATELLITE_TILES.has(layout.insetBasemap) ? 'satellite' : 'tiles';
}

// Layout changes for a choice. Satellite always means imagery. Standard
// collapses any older reference mode (country, regional...) only when chosen.
export function insetStylePatch(style) {
  if (style === 'satellite') return { insetMode: 'satellite_locator', insetBasemap: 'satellite' };
  if (style === 'standard') return { insetMode: 'province_state' };
  return {};
}
