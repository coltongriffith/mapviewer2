# Exploration & Drill presentation

Local foundation; native visual/export verification and publication remain.

The existing drill card, side_panel template and drill_plan API ID are retained.
Explicit selection fills the rail title from an unambiguous supplied property
name or a supplied figure title, preserves company colours/fonts/logo/source
notes, uses grouped legends by default and a quieter tight-framed composition.
Collar-only input is presented neutrally as Exploration & Drill. Selecting a
style does not establish that results or approvals exist.

All existing layer objects, IDs, geometries, coordinates, source attributes,
classes, cutoffs, result callouts, manual styling, labels, survey/trace values and
scientific settings remain intact. This recipe does not guess new header aliases,
calculate intercepts, classify results or generate assays. Existing
import/render/API contracts continue to handle supplied content.

On first selection, up to80 visible unstyled collars can receive existing plain
callouts from the importer's supplied `_holeid`/`label` values. Only short,
unambiguous IDs are used; missing IDs, shared feature keys and dense tables stay
unlabelled automatically. Existing feature-linked annotations are not duplicated.
Reselection preserves removed labels. No collar/result coordinates or values are
invented. The legacy automatic “Planned Drillholes” caption becomes neutral only
when no planned filename or explicit user edit supplied that status.

Saved custom output dimensions and ratio, meaningful subtitles, logos/fonts and
custom inset images persist. Reference overlays are taken from the prior editor
state rather than the mode's extra defaults. Old maps are not migrated or
restyled on load. Normal template selection retains its existing rail setup.

Native review found a capped legend clipping supplied class rows and automatic
cards crossing the rail. This recipe now measures legend content, gives locator
height back before shrinking the legend, and reserves the full technical rail in
the existing shared callout obstacle path. Existing scored placement is used;
stored callout data and explicitly pinned positions stay intact. Legacy layouts
retain their previous sizing and obstacle behavior.

Classified legend ranges carry their literal source field in their group heading
for this recipe (for example `Geochemistry · Cu_ppm`). No unit or element is
inferred, no class ID/value/style changes, and explicit user group overrides still
win. Narrow rails reserve additional title/source-note wrapping space without
altering their text; existing saved layouts outside this recipe are unchanged.

Before review: actual available-input native desktop/mobile/no-logo/restore/PNG
checks, supplied-result preservation, source review, focused browser regressions,
final measured plain/configured builds/budgets and a focused PR. No merge or
production activation is authorized by this implementation.
