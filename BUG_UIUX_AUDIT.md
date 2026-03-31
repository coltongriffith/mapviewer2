# Mapviewer bug + UI/UX audit (main live version)

Date: 2026-03-31

## Functional bugs

1. **Duplicate point click handlers fire for drillhole layers**  
   In `MapCanvas`, drillhole point features attach click logic in both `pointToLayer` and `onEachFeature`. This can trigger duplicate selection/popup behavior on one click and makes click side-effects nondeterministic.

2. **Leaflet map instance is never destroyed on unmount**  
   `MapCanvas` initializes the map in an effect but does not call `map.remove()` in cleanup. Returning to landing/editor repeatedly can leak map/event resources.

3. **Callout auto-layout can still overlap and go off-canvas**  
   `resolveCalloutBoxes` only attempts 8 positional nudges and does not clamp callouts to viewport bounds. Dense callout scenes still collide or render partly off-screen.

4. **Drag interactions are mouse-only (no pointer/touch support)**  
   Callout and annotation dragging rely on `mousemove`/`mouseup` listeners only, so touch/stylus users cannot reliably drag annotations on tablets.

## UI/UX design issues

5. **Layer visibility toggle is not keyboard-accessible**  
   In `LayerList`, visibility is an interactive `<span>` with `onClick` inside a button row. Keyboard and assistive technology users do not get proper button semantics or focus behavior.

6. **Overlays can visually stack/compete in confusing ways**  
   `map-topbar` (`z-index: 700`) always sits above callouts (`520`) and annotation overlays (`510`), and template zones (`400`) are below these. This can hide user content near the top and creates competing visual hierarchy.

7. **One full-screen SVG per callout is costly and can clutter layering**  
   `CalloutsOverlay` renders a separate full-size `<svg>` for every callout leader line. At scale, this increases DOM cost and can create subtle z-order artifacts.

8. **Responsive behavior is constrained on smaller screens**  
   At <=820px, the sidebar still consumes up to 46vh while map controls/top bar remain dense; critical editing controls and map viewport can feel cramped, increasing scroll friction.

## Performance and maintainability risks

9. **Main JS bundle is currently large (~693 kB minified)**  
   Build warning indicates chunk size exceeds recommended limit; this can hurt first-load experience on lower-bandwidth field conditions.

10. **`updateLayout` writes derived `legendItems` from closure into state on every patch**  
    Derived data is being copied into layout state each update, which risks stale writes and makes state harder to reason about.

## Suggested fix order

1. Fix duplicate drillhole click binding + map cleanup (high confidence bugs).  
2. Improve callout layout (collision + bounds) and pointer event handling.  
3. Fix accessibility semantics (visibility toggle as real button/checkbox).  
4. Reduce layering conflicts (topbar behavior + safe area).  
5. Optimize callout leader rendering and split large bundle.
