# Property boundary overlay: feasibility contract

This is a test-only geometry proof on released main `1a034f73`. There is no
editor control, renderer binding, saved setting or production behavior yet.

## Intended result

Give an explicitly selected property a clearer exterior while retaining its
individual claim borders, source attributes, per-feature styles, classifications,
selection targets, manual annotations and compact-key references. The exterior
is a presentation overlay, not a new title, ownership assertion or replacement
for original claim geometry. Existing maps must not activate it automatically.

## What the proof establishes

Ten synthetic fixtures exercise the existing declared `@turf/dissolve` library
on copied, visible polygon geometry. Adjacent polygons lose only their shared
edge in the derived result. A positive gap of 0.00001 coordinate units remains
open; an interior hole and disconnected MultiPolygon parts remain. Hidden claims
are excluded before union, including a wholly hidden property. Overlap does not
remove either source identity. Mutating an output coordinate does not mutate the
input. Derived polygons have no copied scientific or identifying properties.

The existing `canDissolve` refusal for classified/per-feature-styled layers stays
in force. The proof does not call that refusal defective: keeping the original
features and drawing a separate overlay is the proposed solution. Existing
identity and trim-consumer regressions run alongside these fixtures.

## Required before runtime integration

- Resolve only the explicitly selected, visible eligible Property & Neighbours
  subject. Stale, ambiguous, hidden, context or non-polygon selections produce
  no overlay; do not infer a replacement subject.
- Bound source count, polygon/ring/coordinate count and topology work before
  union, and bound derived output. Reject invalid/open/nonfinite/out-of-range or
  unsupported geometry. The test-local prototype is **not** an input validator;
  ten fixtures do not establish arbitrary topology correctness.
- Preserve holes, disconnected pieces and gaps without snapping, buffering,
  convex hulls, smoothing or tolerance-based gap closing. Do not add a fallback
  outline around invalid data when derivation fails.
- Cache derived geometry by immutable geometry and visibility inputs, with
  collectable ownership. Style-only changes must not repeat polygon union.
- Feed one result to native, read-only, PNG and SVG, independently of original
  feature drawing and hit testing. Derived outlines must not intercept clicks,
  trim/style selection, or change the ordinary dissolve guard.
- Review stroke ordering, visibility, clipping, opacity and expert overrides
  visually on actual desktop/mobile output before exposing a minimal opt-in
  control. Preserve saved maps, undo/redo, restore and export permissions.

No new dependency, database, entitlement or account change is proposed. A future
cohesive implementation PR needs tests, native visual/export evidence, measured
builds and review; merge requires separate human approval.
