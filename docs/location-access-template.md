# Location & Access first-result recipe

Source work in progress; native visual/export validation and release review are
still required. This strengthens the existing `infrastructure` card/API ID rather
than adding a workflow or changing the saved-map import path.

The recipe runs on explicit selection only. It reuses Property & Neighbours'
released title, brand, caption and safe property/context style setup, but uses a
broader regional view, a contextual legend at the right and a combined scale/north
row. A single project label replaces only claim labels generated during this
application; existing label decisions, including off, remain untouched.

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

Next: built-app checks with actual supplied property/road data, long names and
missing labels/logos; portrait/mobile/undo/reopen/export; measured builds and
budgets; focused reviewable PR. No production schema/settings or merge authority
is introduced by this source milestone.
