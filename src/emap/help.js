// EMAP.help(): the 2D editor's agent API notes (Tower v3 spec item 45), in sections like /3d's EM3D.help().
// EMAP.help() lists the sections, EMAP.help('labels') prints one, EMAP.help('all') prints every one.
// Loaded with the API (src/emap/api.js), never with the editor itself.

export const SECTIONS = [
  ['start', 'what EMAP is, how to wait for it, how errors read'],
  ['state', 'getState, getProject, undo and redo'],
  ['view', 'centre, zoom, bounds, fit to a layer or to the data'],
  ['layers', 'add, list, show, hide, order, opacity and colours of data layers'],
  ['geology', 'feather, plume, glow, casing, line types and the basemap wash'],
  ['labels', 'names along lines, names in areas, free map labels, the label halo'],
  ['cards', 'theme, title card, legend, inset, scale and north panel, card style, footer'],
  ['callouts', 'callouts, markers, and auto-arrange'],
  ['drill', 'the drill plan: traces, interval tags, the results card and the highlight card'],
  ['export', 'PNG, SVG, PDF and the layers ZIP as a data URL or Blob; the watermark band'],
  ['project', 'save, save as, duplicate, open, new map, load a project, all without dialogs'],
  ['examples', 'a whole figure, start to finish'],
];

export const HELP = {
  start: `Exploration Maps 2D (the map editor) can be driven by an AI assistant, a browser agent or you, from the
browser console. The API is window.EMAP. It is loaded once the editor opens, so wait for it:

  await new Promise((r) => (window.EMAP ? r() : addEventListener('emap:ready', r, { once: true })))
  await EMAP.ready()              Promise; resolves with getState() once the map has drawn

Every setter changes the map exactly as the matching control does: the change can be undone (Ctrl+Z or
EMAP.undo()), the map shows "Unsaved" until it is saved, and it autosaves to this browser as usual.
Setters return a Promise of the new state (EMAP.getState()). Layers, callouts and labels are named by
their id (from getState) or, for layers, by their name.

Invalid input rejects the Promise with an Error that names what is allowed (help, getState, getView,
getProject, listLayers and listProjects answer at once, and throw), for example:
  EMAP.setGeoStyle('Faults', { lineType: 'wavy' })
  → Error: lineType must be one of "plain", "zone", "trend", "fault", "thrust".

No native dialog (prompt, confirm, alert) ever opens. Replacing a map that has unsaved changes needs
{ discard: true }; saveAs takes its name.

EMAP.help()          the list of sections        EMAP.help('labels')   one section
EMAP.help('all')     everything                  EMAP.version          the API version`,

  state: `State
  EMAP.getState()                 the map as plain data: map (id, name, unsaved, signedIn), plan (formats
                                  this account can export), view, layers, title, legend (with item ids),
                                  inset, scaleNorth, theme, wash, labelHalo, callouts, mapLabels, markers,
                                  drillPlan (a summary), export settings
  EMAP.getProject()               a deep copy of the whole project, as saved (for EMAP.loadProject)
  EMAP.ready()                    Promise of the state once the map is ready
  EMAP.undo() / EMAP.redo()       Promises. One step, as Ctrl+Z / Ctrl+Y (edits within 0.4 s are one step;
                                  a pan or zoom is not a step)
A "change" event: window.addEventListener('emap:change', (e) => e.detail) fires after each API setter.`,

  view: `View
  EMAP.getView()                  { center: {lat, lng}, zoom, bounds: {south, west, north, east} }
  EMAP.setView({center: {lat, lng} | [lat, lng], zoom})
  EMAP.setView({bounds: {south, west, north, east} | [[south, west], [north, east]], padding: 40})
                                  zoom 1-22. The view is kept with the map (and with the frame shape)
  EMAP.fitLayer(idOrName, {padding: 40})   frames one layer, as "Zoom to layer"
  EMAP.fitAll()                   "Fit to data": frames the data clear of the panels
Example:
  await EMAP.setView({center: {lat: 50.6, lng: -120.69}, zoom: 14})`,

  layers: `Layers
  EMAP.listLayers()               [{id, name, type, geometry: "polygon" | "line" | "points", role, visible,
                                  opacity, legend, style, fx, features, framing}]
  EMAP.addLayer({name, geojson, role, style, fx, legend})   Promise of the new id. geojson: a
                                  FeatureCollection, a Feature or a geometry, in longitude/latitude (WGS 84).
                                  role: "claims" | "drillholes" | "rock_samples" | "soil_samples" |
                                  "target_areas" | "anomalies" | "faults_structures" | "roads_access" |
                                  "rivers_water" | "labels" | "sampling_extent" | "other" (unset: inferred
                                  from the name, as an import does). style, fx: as setLayerStyle and
                                  setGeoStyle. legend: false keeps it out of the legend
  EMAP.removeLayer(idOrName)      EMAP.moveLayer(idOrName, "up" | "down")   (up: drawn later, on top)
  EMAP.setLayer(idOrName, {name, role, visible, opacity (0-1), legend (true | false), framing})
                                  name is the display label, also its legend label; framing: true frames
                                  the map to this layer ("Use for framing")
  EMAP.setLayerStyle(idOrName, {fill, stroke (hex), fillOpacity (0-1), strokeWidth (0.5-12),
                                dash (true | false | "8 5"), dissolve (true | false),
                                markerSize (1-64), markerShape})   areas and lines take fill, stroke,
                                  fillOpacity, strokeWidth, dash, dissolve; points take fill (the point's
                                  fill), stroke (its border), markerSize and markerShape: "circle" |
                                  "square" | "triangle" | "triangle_down" | "diamond" | "cross" | "star" |
                                  "hexagon" | "pin" | "drillhole"
  EMAP.setBasemap(key)            "light" | "dark" | "terrain" | "satellite" | "hillshade" | "natgeo" | "blank"
Example:
  const id = await EMAP.addLayer({name: 'Claims', role: 'claims', geojson: CLAIMS})
  await EMAP.setLayerStyle(id, {fill: '#c65322', fillOpacity: 0.2, stroke: '#c65322', strokeWidth: 2})`,

  geology: `Geology and line styling (areas and lines; points have none)
  EMAP.setGeoStyle(idOrName, {...} | null)   null turns it off, so the layer draws as before.
    Areas:  feather (0-40 px, soft edges), outline (true | false, the hard outline),
            plume (true | null | {az: bearing it fades toward 0-360, tail: opacity at the far end 0-1,
            blur: 0-40 px})   a natural dispersal plume, fading from its source side
    Lines:  lineType: "plain" (the layer's dash) | "zone" (defined zone, solid with casing) |
            "trend" (inferred trend, dashed) | "fault" (inferred fault, dashed with "?") |
            "thrust" (dash-dot with teeth), glow (0-24 px), glowOpacity (0-1), glowColor (hex | null),
            casing (true | false; on by default for "zone"), teeth ("left" | "right", for thrust and
            fault, as drawn)
    The fill opacity and colours stay the layer's own (setLayerStyle).
  EMAP.setWash({amount (0-0.8), vignette (0-1), color: "#ffffff"} | null)   a veil over the basemap and an
                                  edge vignette (not on the blank basemap)
Example:
  await EMAP.setGeoStyle('Durand Stock', {feather: 8, outline: false})
  await EMAP.setGeoStyle('Thunder trend', {lineType: 'trend', glow: 6})
  await EMAP.setGeoStyle('Gold-in-soil', {plume: {az: 225, tail: 0, blur: 6}})`,

  labels: `Labels
  EMAP.setLayerLabel(idOrName, {...} | null)   a line layer's name along the line, or an area's name
                                  printed into its fill (a darker shade of it). null turns it off. It turns
                                  on the layer's geology style (setGeoStyle) with its defaults if it is off.
    Both:   text (else the layer name), field (a property to read instead, per feature), size (6-48 px),
            weight (300-900), ls (letter spacing 0-1 em), caps (true | false), color (hex | null for the
            darker shade), opacity (0.1-1), halo (true | false), nudge (step clear of panels and other
            labels, default true)
    Lines:  side ("left" | "right" | "on", as drawn), offset (-40 to 60 px), start (0-100, % along the
            line), flip (keep upright, default true)
    Areas:  sub (an italic second line), subField, rotate ("auto" to turn with the unit, or -90 to 90),
            fit ("shrink" | "hide" when it does not fit), minSize (4-24 px), per ("layer": one, in the
            largest clear spot | "feature": one per shape)
  EMAP.addMapLabel({text, at: {lat, lng}, size (8-120), color, opacity (0-1), rotation (-180-180),
                    bold, tracking (0-1)})   Promise of the id: a free label written on the map, as
                                  "Place Map Label" (a region or valley name)
  EMAP.updateMapLabel(id, {...})  EMAP.removeMapLabel(id)
  EMAP.setLabelHalo({color, width (0-8), opacity (0-1)} | false)   the halo round map labels and callout
                                  text (Studio theme; on there by default)
Example:
  await EMAP.setLayerLabel('Thunder trend', {text: 'THUNDER TREND', side: 'left', offset: 6, start: 60})
  await EMAP.setLayerLabel('Durand Stock', {sub: 'diorite', rotate: 'auto'})`,

  cards: `Cards and panels
  EMAP.setTheme({theme, accent, titleBg, titleText, panelBg, panelText, fonts: {title, legend, callout,
                 label, footer}})   theme: "investor_clean" | "technical_sharp" | "modern_dark" |
                                  "warm_terrain" | "studio" (rounded cards, as /3d). Colours hex or null;
                                  fonts "Inter" | "Roboto" | "Open Sans" | "Montserrat" | "Lato"
  EMAP.setMapType(type)           "investor" | "claims" | "drill" | "infrastructure" | "ni_43101": the Style
                                  step's cards (template, mode and theme together)
  EMAP.setTitle({title, subtitle, kicker (the caps line over the title, Studio), date, projectNumber,
                 scaleNote, show, box (true | false: the card behind it), corner})
  EMAP.setLegend({show, title, corner, box, items: {itemId: {label, hidden}}})   item ids from
                                  getState().legend.items; a renamed or hidden entry stays derived from
                                  its layer
  EMAP.setInset({enabled, style: "standard" | "satellite", title, label (caption), corner, pill
                 (Studio: a pill such as "TSXV: TICK"), projectLabel (Studio: the name at the marker)})
  EMAP.setScaleNorth({scaleBar, northArrow, northStyle: "classic" | "arrow" | "decorative" |
                      "surveyor" | "rose" | "split", home: "panel" (one card, the bar left of the
                      arrow) | "title" (in the title card) | "apart", datumNote, datumSub, corner,
                      northCorner})   home, datumNote and datumSub are Studio's
  EMAP.setCard(kind, {tone: "light" | "dark", accent: "left" | "top" | "none", radius (0-24),
                      opacity (0-1), shadow})   Studio's card style; kind "title" | "legend" | "inset" |
                                  "scale" | "callout"
  EMAP.setFooter({text, show})
  Corners are "tl" | "tr" | "bl" | "br"; a moved card goes to the outside of its new corner.
Example:
  await EMAP.setTheme({theme: 'studio', accent: '#2f9e44'})
  await EMAP.setTitle({title: 'Rabbit North Project', subtitle: 'Geology and drilling', kicker: 'SAMPLE CORP · TSXV: SMP'})
  await EMAP.setInset({style: 'satellite', title: 'Project location', label: 'British Columbia, Canada'})
  await EMAP.setScaleNorth({home: 'panel', northStyle: 'rose'})`,

  callouts: `Callouts and markers
  EMAP.addCallout({text, subtext, type: "plain" | "leader" | "boxed" | "badge", at: {lat, lng} | layer:
                   idOrName, offset: {x, y} (px from the anchor), boxWidth (80-480), badgeValue,
                   badgeColor, style: {background, border, textColor, subtextColor, fontSize (6-40)}})
                                  Promise of the id. layer: anchored on its largest block, as "Add From
                                  Selected Layer"
  EMAP.updateCallout(id, {...})   the same fields; EMAP.removeCallout(id)
  EMAP.arrangeCallouts()          Promise. "Auto-arrange": places every callout clear of the panels
  EMAP.addMarker({at: {lat, lng}, type: "circle" | "square" | "triangle" | "triangle_down" | "diamond" |
                  "cross" | "star" | "hexagon" | "pin" | "drillhole", color, size (6-64), label})
                                  Promise of the id: a marker placed by hand, as "Place Marker"
  EMAP.updateMarker(id, {...})    EMAP.removeMarker(id)`,

  drill: `Drill plan (traces, assay bars, interval tags, results card, highlight card)
  EMAP.setDrillPlan({files: [{name, text, kind}], crs})   Promise of {holes, assays, results, notes,
                                  problems}. CSV text of collars, downhole surveys, assays and a published
                                  results table (Result ID, Hole ID, From, To, Approved text, ...), read as
                                  the Drill plan panel reads them; kind ("collars" | "surveys" | "assays" |
                                  "published" | "ignore") overrides the guess. crs: the collars' system when
                                  they are in easting/northing, e.g. "EPSG:26910" (NAD83 / UTM 10N),
                                  "EPSG:32611" (WGS 84 / UTM 11N) or "EPSG:3005". A new plan is framed
  EMAP.updateDrillPlan({show: {traces, bars, pills, collars, tags, padTag, card}, element, bins:
                        [{min, color}], fan: {padKey: true}, legend})   element: the assay column
                                  colouring the bars (getState().drillPlan.elements)
  EMAP.setResultsCard({show, title, date, isNew})   the release's results card (NEW badge: isNew)
  EMAP.setIntervalTags({show, padTag, headings: {resultId: "Upper Blue Sky"}})   a dark tag at each
                                  published interval; padTag: the common-pad tag
  EMAP.setHighlightCard({at: {lat, lng} | holeId, heading, sub, main, second} | null)   a discovery card
                                  with a star at "at"
  EMAP.fitDrillPlan()             "Fit to plan"
  EMAP.removeDrillPlan()`,

  export: `Export (Promises; the file comes back, nothing downloads unless download: true)
  EMAP.exportPNG({as: "dataUrl" | "blob", band, draft, bandClient, pixelRatio (1-4), width, height,
                  background: "white" | "transparent", filename, download})
  EMAP.exportSVG({as: "text" | "dataUrl" | "blob", band, draft, bandClient, download})   live text
  EMAP.exportPDF({as: "dataUrl" | "blob", pdfSize, band, draft, bandClient, download})   pdfSize:
                                  "ppt_169" | "letter_landscape" | "letter_portrait" | "a4_landscape" |
                                  "a4_portrait" | "news_release" (default letter_landscape)
  EMAP.exportLayers({as: "dataUrl" | "blob", svg, band, draft, download})   the designer ZIP: figure.png,
                                  map.png (basemap and data only), annotations.png (transparent; stacks
                                  over map.png), annotations.svg (svg: true, where SVG is allowed) and
                                  layers.json
  draft: the separate tiled draft mark across the figure; true/false overrides this export only.
  Unset uses the saved setting, or defaults on for free/sample maps. In the layers ZIP it is on
  figure.png only; map.png and annotations stay clean.
  Each resolves with {data, clamped, warnings}: data is the file; clamped is true when the plan's pixel
  cap cut a PNG down. band: the Exploration Maps watermark band under the figure ("DRAFT FOR REVIEW · NOT
  FOR PUBLICATION", "Prepared for <bandClient | company>", ©); unset: the map's own setting (on for the
  free plan and sample maps). Exported as a click on the Export step exports it: the plan decides the
  formats (getState().plan.formats) and the corner credit, and signed out with no email given the
  figure carries the large watermark, as "Download with watermark" does.
  EMAP.setExport({band, draft, bandClient, pixelRatio, filename, layersSvg})   the map's saved export settings
Example:
  const { data } = await EMAP.exportPNG({as: 'dataUrl', band: false, draft: false})`,

  project: `Project (no dialogs)
  EMAP.save()                     Promise. Saves the open map (to the account when signed in, else this browser)
  EMAP.saveAs(name)               Promise. A new saved copy named name; the editor then works on it
  EMAP.duplicate()                Promise. A copy named "<name> (copy)"; the editor then works on it
  EMAP.listProjects()             [{id, name, updatedAt}] the saved maps "Open…" lists
  EMAP.openProject(idOrName, {discard})   Promise. Opens a saved map
  EMAP.newMap({discard})          Promise. A new blank map
  EMAP.loadProject(project, {name, discard})   Promise. Opens a project object (EMAP.getProject())
                                  as a new map, not yet saved: save() or saveAs(name) keeps it
  discard: true is needed to leave a map with unsaved changes (getState().map.unsaved); otherwise these
  throw instead of losing work.`,

  examples: `Example: a geology figure with drilling, start to finish
  await EMAP.ready()
  await EMAP.setTheme({theme: 'studio', accent: '#2f9e44'})
  await EMAP.setBasemap('satellite'); await EMAP.setWash({amount: 0.2, vignette: 0.3})
  const unit = await EMAP.addLayer({name: 'Durand Stock', role: 'other', geojson: UNIT})
  await EMAP.setLayerStyle(unit, {fill: '#e7a1bf', fillOpacity: 0.55})
  await EMAP.setGeoStyle(unit, {feather: 8, outline: false})
  await EMAP.setLayerLabel(unit, {sub: 'diorite'})
  const trend = await EMAP.addLayer({name: 'Thunder trend', geojson: TREND, style: {stroke: '#f5b425', strokeWidth: 4}})
  await EMAP.setGeoStyle(trend, {lineType: 'trend', glow: 6})
  await EMAP.setLayerLabel(trend, {side: 'left', offset: 6})
  await EMAP.setTitle({title: 'Rabbit North Project', subtitle: 'Geology and drilling'})
  await EMAP.setInset({style: 'satellite'}); await EMAP.setScaleNorth({home: 'panel'})
  await EMAP.setDrillPlan({files: [{name: 'collars.csv', text: COLLARS}, {name: 'assays.csv', text: ASSAYS},
                                   {name: 'release.csv', text: RELEASE, kind: 'published'}], crs: 'EPSG:26910'})
  await EMAP.setResultsCard({show: true, title: 'Holes 077 & 078', isNew: true})
  await EMAP.fitAll()
  const png = (await EMAP.exportPNG({as: 'dataUrl'})).data
  const svg = (await EMAP.exportSVG({as: 'text'})).data
  await EMAP.saveAs('Rabbit North Fig 1')`,
};

/** The help text: no section, the list of sections; a section's name, that section; "all", every one. */
export function helpText(section) {
  if (section === undefined || section === null || section === '') {
    const w = Math.max(...SECTIONS.map(([k]) => k.length));
    return `${HELP.start}\n\nSections (EMAP.help('name')):\n${SECTIONS.map(([k, d]) => `  ${k.padEnd(w)}  ${d}`).join('\n')}`;
  }
  const k = String(section).toLowerCase().trim();
  if (k === 'all') return SECTIONS.map(([s]) => HELP[s]).join('\n\n');
  if (!HELP[k]) throw new Error(`No help section "${section}". Sections: ${SECTIONS.map(([s]) => s).join(', ')}, or "all".`);
  return HELP[k];
}
