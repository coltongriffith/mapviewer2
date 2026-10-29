# Property & Neighbours: first-result recipe

This strengthens the existing `claims` map-type card. It keeps its public ID,
template engine and mode, and adds no new editor step, network access or schema.
The recipe runs only when the user explicitly selects the card (including the
existing `EMAP.setMapType('claims')` path). Opening a saved map never applies it.

## Inputs and defaults

- Branding comes from the current project layout: uploaded logo/its existing
  colour extraction, or the existing owned-brand-kit application. Colours,
  fonts, logo, brand snapshot and supplied disclosures remain in the map.
- Prefer the already selected claims framing layer; otherwise use the sole
  visible, non-context claims layer. Never infer an owner from a filename,
  colour, company name or spatial proximity. Ambiguous inputs remain neutral
  with a hint pointing to the existing **Use for Framing** control.
- Preserve a supplied title. With only the generic default title, use a single
  consistent supplied `PROJECT_NAME` / `PROPERTY_NAME`, then the layer caption.
- Replace only generic import legend captions with readable source filenames.
  Preserve meaningful supplied captions and excluded legend entries.
- Unstyled, unclassified project claims use the current brand accent; contextual
  claims use restrained grey. Classifications, per-feature overrides, scientific
  attributes and manual layer styles are not rewritten. No claim dissolve or
  ownership categorization is introduced.
- For unstyled claims, use an unambiguous complete supplied label/name/tenure-ID
  column via the existing shared geometry-label renderer. Existing label settings
  (including off) win. Missing/ambiguous fields receive no invented text. Automatic
  label setup is bounded to 80 features per layer; denser uploads retain the
  existing expert tools. Labels that cannot fit are hidden rather than shrunk
  below the configured minimum. Numbered dense-claim keys remain later scope.
- Use quiet terrain, a coordinated logo/title row, compact locator, fitted legend
  and small north arrow. Keep supplied custom inset/hidden-inset choice.
- Default to the existing landscape frame only when no ratio or complete custom
  pixel size is supplied. Preserve existing output choices.

Template-aware fitting prefers this recipe's selected primary layer, preventing
distant neighbouring claims from shrinking the subject. Existing fit behavior is
unchanged outside the recipe. The standard template gains a small recipe-only
legend allowance verified against the actual DOM, so three entries do not scroll.

## Export correction found during review

Preview hides the inspector, widening a free-size stage. The existing resize
effect watched only `stageLogical`, which remains null in free-size mode, leaving
Leaflet's old tile coverage and a blank strip in both Preview and PNG. It now
also watches the stage width/height; fixed-size stages retain their logical size.
This refreshes coverage without rerunning the template or changing source data.

## Validation and limits

Focused units cover supplied branding/title/labels, ambiguous subject/fields,
hidden/empty layers, source captions, manual/classified styles, formats, legend
agreement, custom inset and primary-only fitting. Browser regression cases cover
actual card application/restore and free-size Preview tile coverage. Existing
browser coverage remains intact. Local UI review uses the retained historical
Star Copper inputs and logo without changing them; it is a design example, not
a new verification of ownership. No production account or saved cloud map edited.

The explicit recipe and resize check add about 1.4 KiB to the editor graph.
Narrow measured budget updates retain approximately 0.4 KiB hash headroom; other
route limits, dependencies, paid-kit rules and export entitlements are unchanged.

Review before merge. This work does not authorize deployment or other templates.
