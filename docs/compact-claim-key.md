# Compact claim key

In the existing editor, select **Property & Neighbours**, choose the property
claims layer under **Customize → Layers**, and expand **Compact claim key**.
Select the literal column containing the supplied identifiers, then choose
**Create claim key**. Nothing is enabled automatically on existing maps.

The map prints short references such as K1 and a table linking each located
reference to its supplied identifier. These references are display aids, not
new claim numbers or ownership evidence. Source geometry, IDs, attributes,
scientific values, styles, ordinary labels and annotations remain intact.

References survive save/restore, source reordering and temporary hiding. Hiding
K2 leaves K1 and K3; restoring that shape brings K2 back. Added/deleted shapes,
changed identifiers or a different property require **Rebuild claim key**.
**Remove claim key** removes only the key.

Identifiers must be complete, unique short text (up to 256 characters without
control characters) or safe whole numbers. Leading zeroes in text are preserved.
Each shape also needs a supplied identity recognised by the existing feature
identity system. Geometry alone is insufficient. Duplicate source identities,
missing or repeated identifiers, invalid shapes and stale keys are rejected.

Work is bounded to 5,000 source shapes and 200 retained key entries. These are
validation limits, not a promise that 200 rows fit a figure. The existing
80-feature automatic-label safeguard remains unchanged. The shared label
layout draws only clear, fitted references in the current view and derives the
table from those exact placements. An explicit notice counts unlocated and
hidden claims. Zooming into part of a dense layer can therefore produce a
smaller readable key without renumbering the saved references.

The table uses clear space between existing furniture and avoids existing
labels and callout boxes. Complete identifiers wrap; they are not truncated.
If the table cannot fit completely, the whole key is withheld and an editor
message/export warning explains the problem. Zoom, move furniture or reduce
the retained claims; existing map content still renders. Editor/read-only,
PNG and SVG use the same composition and painters. Existing export permissions
and watermark rules still apply.
