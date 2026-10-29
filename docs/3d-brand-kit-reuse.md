# Reusing saved brand kits in 3D

Brand now offers **Load my brand kits**, a selector and **Apply brand kit**.
Loading does not alter the figure. Applying copies the selected kit's current
presentation colours, supported sans font and inline logo through the same
shared adapter used by 2D and the existing 3D figure-style API.

Source files, coordinates, scientific settings, grade/geology colours, camera,
figure size, titles and company text stay unchanged. 3D uses one supported sans
family and its existing mono face, weights and sizes. Missing kit fields keep
the figure's current colours/logo. A later kit edit does not mutate a saved
figure: style values and kit revision are copied into that figure.

## Access and lifetime

- Account code and kit reads remain lazy, behind the explicit Load action.
- The existing 3D Supabase client verifies the user with `auth.getUser`, reads
  `templates` with `user_id` equal to that verified ID, and verifies the user
  again before returning rows. Foreign/malformed rows are not shown.
- Apply reads the selected kit again with both its ID and owner filter. It
  cannot apply a kit deleted or reassigned since the list was loaded.
- Auth changes clear rows and selection and invalidate pending operations.
  A changed figure also invalidates application while the query or logo/font
  decoding is pending. Staged assets commit only to the original figure.
- Signed-out, missing-schema, unavailable-kit and network errors keep the
  current figure. No kit creation, update, default selection, deletion, account
  assignment or entitlement change is introduced. Applying an owned look is
  available as in 2D; saving reusable kits retains the existing paid limits.

No migration, storage activation, service-role key or production data change
is required. Logos use the existing inline image path; remote logos are not
fetched through the picker and kit text is rendered with `textContent`.

## Validation

Focused unit cases cover verified owner filters, foreign rows, signed-out and
stale requests, selected-kit rereads, malformed/missing schema responses and
account/figure changes during application. Existing figure-style tests cover
slow/failed assets, supersession and legacy API behavior.

Built desktop/mobile flows use an in-memory synthetic backend. They verify
explicit application, fresh revisions, inline logo, no writes, scientific/data
preservation, saved/exported snapshot stability, sign-out invalidation and safe
anonymous/missing-schema fallback. The mobile logo input is constrained to its
grid column so the Brand panel does not introduce horizontal scrolling.
