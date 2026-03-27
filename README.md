# Mapviewer refactor starter pack

This pack adds the new file structure without forcing a full cutover yet.

## Safe order
1. Add all new files from `src/` into your repo.
2. Do not delete anything yet.
3. Commit.
4. In the next pass, replace `src/App.jsx` and wire the new export pipeline.

## What this pack does
- Adds utility modules for geo/math/svg helpers.
- Adds reusable overlay component shells.
- Adds export pipeline shells for PNG/SVG.
- Does **not** change runtime behavior until you import these files.

## Files to add
See `file-list.txt`.
