# Returning from crew close-ups

Zoom to crew deliberately saves a camera pan aimed at the rig. Wheel zoom keeps
that target, so zooming out alone does not recenter the drilling.

The preview toolbar now exposes **Fit model**. It clears that camera pan and
frames the full model at the current viewing direction. It cancels a running
camera flight and clears residual orbit motion; no dataset reload is required.

**Pick focus** lets the user click or tap a visible terrain, block face, assay
tube, envelope or imported model surface. A ray hit supplies the real scene
point for the saved camera pan. The view moves closer within the existing
model zoom limits. Subsequent wheel zoom and orbit use that point. Empty space
does not invent a target; Escape or clicking the button again cancels selection.
Lock view prevents picking, and switching to the section view cancels it.

Only camera framing changes. Source data, scientific settings, crew position,
saved camera format and full-resolution export paths stay unchanged. Focus
selection is temporary UI state and is never stored in a saved project.

Desktop and mobile browser checks cover a true-scale crew close-up, fitting the
drilling, cancellation, blank-space handling, model picking, wheel zoom, saved
camera restoration, view locking and preservation of files/scientific settings.
The existing crew flight/export regression remains in the validation set.
