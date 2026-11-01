# Location & Access first-result recipe

Source work in progress; native visual/export validation and release review are
still required. This strengthens the existing `infrastructure` card/API ID rather
than adding a workflow or changing the saved-map import path.

The recipe runs on explicit selection only. It reuses Property & Neighbours'
released title, brand, caption and safe property/context style setup, but uses a
broader regional view, a contextual legend at the right and a combined scale/north
row. A single project label replaces only claim labels generated during this
application; existing label decisions, including off, remain untouched.

Fresh-workspace placeholder subtitles are replaced by Location & Access, while
supplied descriptions stay. Existing reference-overlay choices are read before
the legacy mode preset adds its defaults, so selecting this recipe does not
enable unsolicited rail/label overlays. The default standalone map carries the
supplied source note in its fitted legend; an explicit presentation choice stays.
Its small compass retains its actual width beside the scale. Property labels use
supplied property identity (or source caption), not a potentially different figure
heading. Source headers ROAD_NAME_FULL/HIGHWAY_ROUTE_NUMBER are recognised only
when complete and unambiguous; missing names are not replaced with invented text.

Supplied complete road/route-name columns can label uploaded line layers. Manual
and classified layers, source attributes and existing line symbology remain
unchanged. No access right, seasonality, proposed/existing status, route distance,
power capacity or ownership is inferred from a name or line on a basemap.

Framing uses the known property plus route layers explicitly marked `focus:true`.
An unmarked regional road inventory does not dwarf the project: the padded
property remains the framing reference. Existing framing controls remain usable.
If the supplied data does not establish a unique property, the recipe does not
choose an owner by file order, company name or colour.

Source fields, logo/fonts/disclosures, output ratio or custom dimensions and user
styles are preserved. Native labels stay on the existing shared render/export
path. Automatic label setup remains bounded to80features per layer. The no-logo
zero-space behavior is limited to opted-in recipes, retaining legacy sizing.

Native verification used historical supplied property/road/brand inputs through
the existing upload/card/Preview/PNG flow. Desktop landscape, 390px portrait,
no-logo/reselection, history and local-draft reopen were checked. Actual source
road names were absent and remained absent. A separately marked synthetic-name
QA fixture confirmed short names render and overlong names can be omitted by the
existing line fitter; it makes no real road-name or access claim. Evidence and
limitations are recorded in the workspace's Location & Access review folder.

Browser regressions cover card selection, supplied attributes/branding/source
note, manual-route preservation, draft restore and no-logo portrait furniture.
Hosted execution is still required; discovery alone is not a browser pass.
No production schema/settings or merge authority is introduced by this work.
