# Exploration Maps — Feature Catalogue for Testing and Content

Date: 2026-09-09 · Built from the code on `main` at that date.

This is the complete list of what the product does, written for two readers:
the person who will **test every feature** and the person who will **film or
screenshot each one** for social media. Each feature has the same shape:

- **Where** — the exact button, tab or URL, quoting the label text as it appears on screen.
- **What it does** — one or two sentences.
- **Test** — numbered steps a non-developer can follow.
- **Options** — every control the feature exposes.
- **Gotchas** — limits, gating, and things that will surprise you on camera.
- **Film it** — the shot and the hook line. Only on features worth a post.

Plan tags: `Free` works for everyone, `Account` needs a signed-in user,
`Pro` needs a paid plan (or a grandfathered account created before 17 July 2026).

---

## 0. Before you start

### 0.1 Where to test

| Need | Use |
|---|---|
| Registry claim search, tenure search, analytics | The **deployed site** (Vercel). Plain `npm run dev` has no `/api` functions, so claim search fails there. `vercel dev` also works. |
| Billing (Upgrade, checkout, portal) | A deployment with Stripe keys. Without them every billing button shows "Billing is not configured yet." |
| Reminder and welcome emails | A deployment with a Resend key. Without it, emails are silently skipped. |
| A clean first visit | A private window. Signed-in users never see the landing page at `/`. Clear site data to hide the "Your maps" strip. |

### 0.2 Fastest ways into a good-looking map

Type these into the address bar. The query string is consumed once and removed, so **refreshing mid-take drops you into a blank editor**. Bookmark the full URL.

| URL | What loads |
|---|---|
| `/?demo=aurora_demo` | Cedar Ridge investor map: dissolved teal claims on satellite, collars with traces, three dashed targets, intercept callouts. The hero image on the homepage. |
| `/?demo=target` | Target map: classed soil copper on hillshade, drill traces, UTM frame, grouped legend, boxed callouts, strike bracket. |
| `/?demo=geology` | Bedrock geology coloured by unit, claim boundary, targets, collars, UTM frame. |
| `/?demo=regional` | Regional location: property padded out in its district, neighbouring operators, Highway 16, the town, callouts. |
| `/?demo=drill_plan` | Drill results on satellite, no footer. URL only. |
| `/?demo=claims` | Claims and land position on a light base. URL only. |
| `/?demo=infrastructure` | Access roads and a dashed powerline corridor. URL only. |
| `/?demo=dark` | Dark basemap overview. URL only. |
| Data tab → "Load sample data" | Buckhorn Creek Property: sample claims and drillholes with a logo. |

Other deep links: `/?intent=claims` (editor with the registry search open), `/?intent=claims&region=ontario`, `/?intent=claims&query=Dolly Varden` (auto-runs the search), `/?intent=claims-upload`, `/?intent=drill-results`, `/?claims=DV&company=Dolly Varden Silver&region=bc` (a company's published claims), `/?tenure=1044501` (one B.C. tenure), `/tenure-monitor`, `/dashboard`, `/account`, `/map/<id>` (a shared map), `/admin`.

Region slugs: `british-columbia`/`bc`, `ontario`/`on`, `quebec`/`qc`, `saskatchewan`/`sk`, `manitoba`/`mb`, `newfoundland-labrador`/`nl`, `yukon`/`yt`.

### 0.3 Sample files in the repo

| File | Use it for |
|---|---|
| `scripts/blog-data/sample-collars.csv` | The CSV column mapper. Its UTM eastings trigger the projected-coordinates hint. Has azimuth, dip and depth for traces. |
| `src/assets/sampleDrillholes.json` | Drill traces (every hole has Az, Dip, Length_m); colour by `Au_gpt` (ranges) or `Status` (unique values). |
| `src/assets/sampleClaims.json` | Claim styling, dissolve, legend. |
| `public/companies-assets/<TICKER>.geojson` | Real company claim outlines (30 issuers, e.g. `DV`, `GOT`, `ESK`). |

### 0.4 Things that are collapsed by default

Inside the editor these sections start closed. Click the heading to open them: **Export**, **Drillhole Labels**, **Inset**, **Reference Overlays**, **Customize design**. Only **Nearby Claims** starts open.

---

## 1. Getting in: landing page and onboarding

### 1.1 Landing page `/` — `Free`
**Where.** The homepage. Nav: `Features`, `Use Cases`, `Examples`, `Pricing`, `Tenure Monitor`, `Sign in / Sign up free`, `Start a map`.
**What it does.** Sections in order: hero with a claim search box, the hero map (click opens the live demo), a 1-2-3 workflow strip, company claim-map tiles, "Your maps" (only if you have local projects), capabilities, use cases, the three example maps, a traditional-vs-Exploration-Maps comparison, pricing, a closing call to action, footer.
**Test.**
1. Type a company (e.g. `Dolly Varden`) in `Search mineral claims` and press `Search`. The editor opens with the registry search already running.
2. Click the hero map. The Cedar Ridge demo loads.
3. Click each of the three example cards (`Open this example →`). Each loads its own demo.
4. Click a company tile (`DV`, `GOT`, `ESK`, `BBB`, `SCOT`, `TUD`) and `All mapped companies →`.
**Gotchas.** The `Registry search is available across seven Canadian jurisdictions` disclosure lists the regions. The U.S. sentence only appears when the U.S. flag is on. The pricing buttons open the editor, not Stripe.
**Film it.** Hero search → claims appear on a map in under ten seconds. Hook: "Type a company name. Get its claims on a map."

### 1.2 First-run checklist — `Free`
**Where.** Top of the editor's side panel, card titled `Make your first map`.
**What it does.** Four steps that tick off as you go: `Add your data` (buttons `Search public claims`, `Upload a file`, `Load sample data`), `Choose your layout` (`Use investor layout · 16:9`, `Customize design`), `Download your map` (`Export PNG`), `Save for your next update` (`Save to a free account`).
**Test.** Open `/?intent=claims`, close the modal, then work through the four buttons. The card disappears when steps 1 to 3 are done and you are signed in, or when you press `✕`.
**Gotchas.** Dismissal does not persist across a reload. Step 4 needs a real email sign-in.

### 1.3 How to use guide — `Free`
**Where.** The `?` button in the editor toolbar, or `How to use` in the landing footer.
**What it does.** A 15-section guide with a sticky nav that highlights as you scroll. Escape closes it.
**Gotchas.** Parts are out of date: it mentions "Pickaxe, Shovel" marker shapes that do not exist, says layers can be dragged to reorder (they cannot; use Move Up/Down), and says the free plan saves 3 projects (it is 2).

---

## 2. Getting data on the map

### 2.1 File upload — `Free`
**Where.** Editor → `Data` tab → `Upload` box: `Drag and drop a map file here`, `or click to browse`. Also `Add Claims` → `Upload File`.
**What it does.** Turns a file into a styled layer. Formats: zipped shapefile (`.zip`), loose shapefile parts (`.shp` + `.dbf` + `.prj` + `.shx` selected together), `.geojson` / `.json`, `.kml` / `.kmz`, `.csv`, and images (`.png .jpg .gif .webp`) with or without a world file (`.pgw .jgw .wld .tfw`).
**Test.**
1. Drag a zipped shapefile onto the box. Status reads `Imported <name>. Layer added successfully.`
2. Select all four shapefile parts at once in the file picker. One layer appears.
3. Drop a projected shapefile with no `.prj`. The import stops and explains.
4. Drop a 250,000-feature file. The import stops with the limit named.
**Options.** The `i` button lists formats. The `Add Claims → Upload File` path adds a preview step (`✓ 42 features found`) and, for a projected file with no CRS, a `Coordinate system of "file"` dropdown (WGS84, BC Albers, Web Mercator, NAD83 and WGS84 UTM zones 7N to 22N) with `Convert and preview`.
**Gotchas.** 50 MB per file. 200,000 features and 3,000,000 vertices per file. 500 entries and 300 MB uncompressed per zip. The app never guesses a projection. Roles are inferred from the file name: "road"/"access" → Roads, "target" → Target Areas, "fault" → Faults, "anomaly"/"mag" → Anomalies, points → Drillholes, anything else → Claims. Rename the file or change `Layer Role` afterwards.
**Film it.** Four-way split: shapefile, KML, GeoJSON, CSV all landing on the same map. Hook: "Whatever your GIS exported, drop it here."

### 2.2 CSV column mapper — `Free`
**Where.** Appears automatically after dropping a CSV whose coordinate columns are not obvious. Title `Map CSV columns`.
**What it does.** Lets you assign a role to each column with a three-row preview. Roles: `Longitude — east/west position *`, `Latitude — north/south position *`, `Point name (hole ID, sample #…)`, `Elevation`, `Azimuth (for drill traces)`, `Dip (for drill traces)`, `Hole length / depth (for drill traces)`, `— Skip —`.
**Test.**
1. Drop `scripts/blog-data/sample-collars.csv`. The mapper opens with a hint that the values look projected (its coordinates are UTM metres).
2. Drop a CSV with `lat` and `lon` headers. No dialog: it imports straight away and reports skipped rows.
3. Map azimuth, dip and depth, press `Import drillholes`, and watch traces appear from each collar.
**Options.** One column per role; assigning a role clears it from any other column. Buttons `Import drillholes` / `Cancel`.
**Gotchas.** Recognised header synonyms include `easting/x/lon/longitude`, `northing/y/lat/latitude`, `holeid/hole_id/dhid/bhid/collar`, `azimuth/azi/az/bearing`, `dip/inclination/incl`, `length/depth/total_depth/eoh/td/hole_length`. Coordinates must be WGS84 lat/long; UTM CSVs need converting first.
**Film it.** The three-row preview updating as you pick roles. Hook: "Your drill collar spreadsheet is already a map."

### 2.3 Drill traces — `Free`
**Where.** Automatic. Any drillhole layer whose collars carry azimuth, dip and length draws a surface-projection line from each collar. Legend row `Drill trace` appears beside `Drill Collars`.
**What it does.** Projects each hole to surface using `length × cos(dip)` along the azimuth. Traces share the collar's identity: hide, style or remove the collar and its trace follows.
**Test.** Load `/?demo=target` or the Buckhorn sample and zoom to a collar. Toggle the layer's visibility. Change `Point Border` colour and watch the traces recolour.
**Gotchas.** Vertical holes draw no trace. Junk values (`N/A`, `-`) are ignored rather than drawn pointing north. Traces are never listed in the shape list and are excluded from colour-by-attribute statistics.
**Film it.** Zoom from a dot to a fan of traces across a target. Hook: "Azimuth, dip, length. That's all it takes."

### 2.4 Georeferenced image overlay (magnetics, geology scans) — `Free`
**Where.** Drop a `.png/.jpg/.gif/.webp` on the upload box, alone or together with its world file. Modal `Place image on the map`.
**What it does.** Stretches the image between four edges so a geophysics grid, a scanned geology sheet or an old plan sits under your data. Drawn above the basemap and below every vector layer; exported at the same place and opacity.
**Test.**
1. Drop an image with its `.pgw`. The edges are pre-filled; confirm the coordinate system and press `Place on map`.
2. Drop an image alone. Type four edges (lat/long, or UTM with `Zone` and `Hemisphere / datum`) and place it.
3. Under `Layers`, select it, change `Opacity`, press `Re-place image…` to adjust the edges.
**Options.** `Coordinates are` (Latitude / longitude (WGS84) or UTM (metres)), `Zone` 1 to 60, `North`/`South`, `NAD83`/`WGS84`, four edge fields, `Opacity` 10 to 100 %.
**Gotchas.** 8 MB per image; resampled to 2048 px on the long edge. Must be north-up in the chosen coordinate system; a rotated grid is placed by its bounding box. Dropping a world file alone shows `Drop the world file together with its image`.
**Film it.** A magnetics grid fading in under claims, opacity slider moving. Hook: "Put your mag survey under your claims in one drag."

### 2.5 Custom tile and WMS services — `Free`
**Where.** Editor → `Layout` tab → `Reference Overlays` → `Add a tile or WMS service`.
**What it does.** Adds a published map service (a survey's geology or magnetics) as a layer above the basemap and below your data, with a credit printed on the export.
**Test.** Choose `Type` (`Tile URL ({z}/{x}/{y})` or `WMS`), give it a `Name`, paste the URL, for WMS list `WMS layers`, add a `Credit (printed on the export)`, press `Add as layer`. Export and read the credit at the bottom left.
**Gotchas.** URL must start with `https://`; a tile URL needs `{z}`, `{x}`, `{y}`; an API key in the URL is refused because it would be saved and shared with the map.

### 2.6 Claims registry search — `Free`
**Where.** `Data` tab → `Add Claims` → `Search Claims Registry`. Heading `Claims Registry Search`.
**What it does.** Live search of seven Canadian registries by company name or claim number, grouped into geographic areas, then imported as a styled claims layer with the source and retrieval date printed on the export.

| Jurisdiction | Registry | Modes |
|---|---|---|
| British Columbia | Mineral Titles Online | Company, Claim # |
| Ontario | MLAS | Company, Claim # |
| Saskatchewan | MARS | Company, Claim # |
| Manitoba | Mineral Dispositions | Claim # only |
| Newfoundland & Labrador | GeoAtlas | Company, Claim # |
| Yukon | Quartz Claims | Company, Claim # |
| Quebec | GESTIM (weekly mirror) | Company, Claim # |

**Test.**
1. Pick `British Columbia`, type `Dolly Varden`, press `Search`.
2. If several holders match, pick one from `Found 3 matching companies — select the right one:`.
3. Results are grouped by area (`Northwest BC · 12 claims · 640 ha · exp. …`). Expand a group, tick claims, or `Select All`, then press `Add 36 claims to map`.
4. Search a tenure number (`1044501`). Try a near-miss (`104450`) to see the relaxed search notice.
5. Search a company in the wrong province. Watch `Checking other provinces…` then `Found elsewhere: Ontario — 14 claims found · Switch & view →`.
6. Type an NTS sheet like `093K`. Read the map-sheet message.
**Options.** Jurisdiction dropdown, `Company` / `Claim #` tabs (auto-detected from what you type), `Select All` / `Deselect All`, per-claim checkboxes, U.S. claim-type chips when enabled.
**Gotchas.** Manitoba has no company search. BC has no map-sheet search. Quebec is refreshed weekly, not live. Results cap at 1,000 claims with a warning. Alberta, Nova Scotia, New Brunswick and the territories other than Yukon are not covered. U.S. BLM states are hidden unless the deployment enables them; when on, company search matches claim **names**, and a checkbox `I understand these are claim-name matches, not confirmed holdings.` must be ticked before import.
**Film it.** Company name → grouped results → claims land on the map with the legend. Hook: "Seven registries. One search box."

### 2.7 Claim popups and tooltips — `Free`
**Where.** Hover or click any registry claim on the map.
**What it does.** Tooltip shows owner (or claim name) and `tenure · type`. Popup lists `Claim name`, `Tenure`, `Type`, `Status`, `Area`, `Issued`, `Good until`, and a `+ Add Callout` button that drops a leader callout at the claim centre.
**Test.** Import claims, hover, click, press `+ Add Callout`.

### 2.8 Nearby claims (radius search) — `Free`
**Where.** `Data` tab → `Nearby Claims` (open by default).
**What it does.** Loads every claim within a radius of your property, coloured by owner, so the map shows who holds the neighbouring ground.
**Test.**
1. With a claims layer on the map, pick `Search Radius` (`10 km`, `25 km`, `50 km`, `100 km`) and press `Load Claims`.
2. Or press `📍 Pick on map`, click anywhere, then `Load Claims`.
3. Tick `Show on map`, `Add to legend`, `Dissolve inner borders`. Move `Fill opacity`.
4. Under `Claim owners`, recolour an owner, rename its label, hide one with `×`.
5. Export. The nearby claims appear in the file under a `Nearby Claims` legend group.
**Gotchas.** Needs a claims layer or a dropped pin. Large areas truncate at 2,000 claims with a note. `Clear All` removes them.
**Film it.** Radius growing from 10 to 100 km as the neighbourhood fills in with colours. Hook: "See who's staked around you."

### 2.9 Company claim pages — `Free`
**Where.** `/companies/` and `/companies/<ticker>/` (30 issuers, e.g. `/companies/dv/`). Tiles on the homepage.
**What it does.** Static pages with each issuer's claim map, claim list and neighbouring holders. Buttons `Open interactive version →` and `Save an editable copy` load the company's claims into the editor as an editable layer titled `<Company> — Mineral Claims`; the second also opens the sign-in prompt.
**Test.** Open `/companies/dv/`, press `Open interactive version →`, style and export.
**Gotchas.** The `/companies/ontario/` hub exists but every issuer page today is B.C.-sourced.

### 2.10 Tenure hand-off into the editor — `Account`
**Where.** Tenure Monitor → `Open in Exploration Maps` or a row's `Open map`; reminder emails link to `/?tenure=<number>`.
**What it does.** Loads monitored claims as a layer stamped with the government sync date. If a boundary changed after the map was built, a banner over the map says so and asks you to re-import.

---

## 3. Layers and styling

### 3.1 Layer list — `Free`
**Where.** `Layers` tab. Each row: eye button (show/hide), colour swatch, name, role, source file, `✕` remove.
**Test.** Click a row to select it. Toggle the eye. Press `✕` (no confirmation).
**Gotchas.** No drag reorder. Use `Move Up` / `Move Down` in the panel below.

### 3.2 Layer panel — `Free`
**Where.** Select a layer under `Layers`.
**Options.** `Display Label` (also renames the legend row), `Layer Role` (Claims, Drillholes, Rock Samples, Soil Samples, Target Areas, Anomalies, Faults / Structures, Roads / Access, Rivers / Water, Labels), `Move Down` / `Use for Framing` / `Move Up`, `Outline Color` (or `Point Border`), `Fill Color` (or `Point Fill`), `Layer Opacity`.
Polygons and lines add: `Fill Opacity`, `Outline Width` 0.5 to 6 px, `Dashed outline`, `Dissolve inner borders`, `Fill Pattern` (`Solid`, `Hatch`, `Cross`, `Dots`).
Points add: `Point Size` 6 to 24 px, `Marker Shape` (Circle, Square, Tri ▲, Tri ▼, Diamond, Cross, Star, Hexagon, Pin, DH Pin), `Custom Icon` (`Upload Icon` png/svg/jpeg/gif, `✕` to clear).
**Test.** Change the role of a claims layer to Target Areas and watch it go dashed gold. Set `Fill Pattern` to Hatch. Upload a custom icon for collars and check the legend swatch uses it.
**Gotchas.** Changing the role reapplies that role's default style. `Dissolve` is disabled once a layer is classified or has per-shape styles, and pauses while trim or per-shape styling is armed. `Use for Framing` decides what auto-zoom fits; press it again to clear.
**Film it.** One claims layer going from flat blue to dissolved teal with a white outline and hatch. Hook: "Style once. The legend follows."

### 3.3 Dissolve inner borders — `Free`
**Where.** Layer panel checkbox `Dissolve inner borders`; also in `Nearby Claims`.
**What it does.** Merges adjacent claim cells into one outline per layer (or per owner for nearby claims) with an aggregated hectare count in the popup.
**Film it.** A grid of 40 cells collapsing into one property outline. Hook: "Forty cells. One property."

### 3.4 Remove individual shapes (trim) — `Free`
**Where.** Layer panel → `Remove individual shapes` → `Select on map` (becomes `Done removing`) and `List (N)`.
**What it does.** Non-destructive removal of single shapes or a box-selected group; they leave the map, legend and export until restored.
**Test.**
1. Press `Select on map`, click a claim. It disappears.
2. Drag an orange box over several. Toast: `Removed N features from the map. Use Restore to bring them back.`
3. Press `List (N)`, filter with `Filter by name or claim number`, use `Remove these N` / `Restore these N`, or tick rows.
4. Press `Restore all`.
**Gotchas.** List shows at most 300 rows; filter to reach the rest. Callouts anchored to removed ground re-anchor automatically. Selecting another layer disarms the mode.
**Film it.** Box-drag removing a southern block, then Restore. Hook: "Trim the map, keep the data."

### 3.5 Style individual shapes — `Free`
**Where.** Layer panel → `Style individual shapes` → `Select on map` (becomes `Done styling`).
**What it does.** Gives one polygon or line its own `Outline`, `Fill`, `Outline Width`, `Fill Opacity` and `Dashed outline` so a priority target can be bold beside thin ones.
**Test.** Arm it, click a target, thicken the outline and make it red, press `Reset this shape`, then `Reset N styled`.
**Gotchas.** Mutually exclusive with trim mode.
**Film it.** Three identical targets, one becoming the bold red priority. Hook: "Make the one that matters stand out."

### 3.6 Colour by attribute (classed symbology) — `Free`
**Where.** Layer panel → `Colour by attribute` (only shown when the layer has attribute columns).
**What it does.** Colours (and sizes, for points) a layer by one of its columns: `Ranges` for numbers (soil copper in four classes) or `Unique values` for categories (geology units). Each class becomes its own legend row.
**Test.**
1. Load `/?demo=target`, select `Soil Samples (Cu ppm)`, open `Colour by attribute`. Change `Classes` to 5 and edit a break.
2. Load the Buckhorn sample, select the drillholes, pick `Attribute` = `Au_gpt (numeric)`, `Method` = `Ranges`. Then pick `Status` with `Unique values`.
3. Override a legend label in the per-class label box.
**Options.** `Attribute` (`None (one style for the layer)` plus each field), `Method` (`Ranges` / `Unique values`), `Classes` 2 to 6, per class: colour, upper limit (last reads `and above`), point size, legend label.
**Gotchas.** Breaks are quantiles rounded to nice numbers, not equal intervals. Unique values caps at the 12 most common. Features with no value keep the layer style. Classifying disables dissolve.
**Film it.** A grid of white dots turning into a yellow-to-purple copper anomaly, legend rows appearing. Hook: "Your soil grid, classed in one click."

---

## 4. Labels, callouts and annotations

### 4.1 Drill collar callout editor — `Free`
**Where.** Click a drill collar on the map (tooltip `Click to edit callout`). A popup opens beside it. The same fields live under `Labels` tab → `Drillhole Labels`.
**What it does.** Builds an intercept callout for that hole: `Title`, `Subtext` (one result per line), `Type` (Plain Label, Leader Label, Boxed Annotation, Badge Label), badge `Chip Text` and `Chip Color`, `BG` / `Border` / `Text` colours, and a `Marker Shape` row that changes just that hole's marker. `Add Callout` places it.
**Test.** Click a collar, type `CR-24-03`, subtext `14.0 m @ 2.36 g/t Au`, press `Add Callout`. **Drag the popup by its header** to move it out of the way. Click another hole: the popup resets beside it.
**Film it.** Click hole, type result, callout appears with a leader. Hook: "Headline intercepts, on the map, in seconds."

### 4.2 Callouts — `Free`
**Where.** `Labels` tab → `Callouts`. Buttons `Add From Selected Layer` and `Auto Frame All`. Each callout is a card with `Remove`.
**What it does.** Annotation boxes with leader lines that avoid each other automatically.
**Options.** `Text`, `Subtext` (multi-line), `Anchor` (only when the layer splits into 2+ geographic blocks), `Type` (Plain / Leader / Boxed / Badge), `Priority` (High / Medium / Low), `Chip Text` / `Chip Color` (badge), `Background`, `Border / Line`, `Text Color`, `Subtext Color`, `Font Size` 9 to 18, `Text Align`, `Style preset` (`Card` white with navy text, `Banner` dark with white centred text), `Arrowhead on the leader line`, `Nudge` arrows (8 px per press).
**On the map.** Drag the box (snap guides appear). Drag the corner handle to resize 100 to 400 px. Click the title or subtext of a selected callout to edit in place; in the subtext **Enter commits, Shift+Enter adds a line**. Delete key removes the selected callout (Ctrl+Z undoes).
**Test.** Add three callouts near each other and press `Auto Frame All`. Switch one to `Banner` and tick the arrowhead. Type a two-line subtext with Shift+Enter.
**Film it.** A banner callout reading "Untested strike >1.5 km" landing next to a bracket line. Hook: "Say it on the map, not in the caption."

### 4.3 Distance line and strike bracket — `Free`
**Where.** `Labels` tab → `Annotations` → `Measure Distance`, then click two points. Select the line to open `Distance Line`.
**Options.** `Color`, `Style` (`Measure` dashed with end dots and the length in the middle; `Bracket` solid with end ticks for a strike length), `Units` km / mi, `Show caption`, `Caption` (blank shows the measured length), `Delete Distance Line`.
**Film it.** Measure mode flipping to Bracket with the caption "Untested strike >1.5 km".

### 4.4 Markers, areas, rings, map labels, boundaries — `Free`
**Where.** `Labels` tab → `Annotations`. Six tool buttons; click the map after choosing one.

| Tool | What you get | Controls |
|---|---|---|
| `Place Marker` | A draggable symbol with a draggable label | `Label`, `Marker Type` (10 shapes), `Color`, `Size` 12 to 36, `Remove Marker` |
| `Draw Dashed Area` | A dashed ellipse for a target zone | `Label`, `Width` / `Height` 24 to 320, `Rotation`, `Color`, `Dashed outline`, `Outside shade` |
| `Draw Distance Ring` | A radius ring with a curved label | `Label`, `Radius (km/mi)`, `Ring Color`, `Units`, `Label Size`, `Label Color`, `Bold`, `Curved arc label` + `Angle`, `Dashed outline`, `Outside shade` |
| `Place Map Label` | Big letter-spaced region text | `Text` (rendered uppercase), `Size` 14 to 72, `Opacity`, `Rotation`, `Color` |
| `Draw Boundary` | Click vertices, close on the first point or `Close & Save` | `Label`, `Arc label along boundary`, `Color`, `Stroke Width`, `Label Size`, `Dashed outline`, `Smooth boundary`, `Outside shade` |
| `Measure Distance` | See 4.3 | |

`Outside shade` presets: `Dark`, `Light`, `Warm`, plus colour and opacity 5 to 75 %. It dims everything outside the ring or boundary.
**Test.** Draw a 5 km ring around the property with `Curved arc label` and `Outside shade` = Dark. Draw a boundary with `Smooth boundary`.
**Film it.** Outside shade switching on: the district dims, the property glows. Hook: "Focus the eye."

---

## 5. Layout and design

### 5.1 Map type — `Free`
**Where.** `Layout` tab → `Map` → `Map type`.
**Options.** `Investor / presentation map`, `Claims and tenure map`, `Drill results map`, `Infrastructure and access map`, `NI 43-101 figure`. Sets template, mode and theme together; reads `Custom` once you change any of them individually.
**Film it.** Same data, five map types, one click each. Hook: "One dataset. Five deliverables."

### 5.2 Title, subtitle and metadata — `Free`
**Where.** `Layout` → `Map` → `Title`, `Subtitle`, `Title Size`. `Customize design` → `Text & Metadata` → `Legend Title`, `Text Size`, `Footer / Disclaimer`, `Map Date`, `Project #`, `Scale Note`.
**On the map.** Click the title or subtitle text to edit inline. Click a legend label to rename it.
**Gotchas.** Date, project number and scale note appear as a `·`-joined line in the title block.

### 5.3 Basemaps — `Free`
**Where.** `Layout` → `Map` → `Basemap` thumbnail picker.
**Options.** `Light`, `Dark`, `Terrain`, `Satellite`, `Hillshade`, `NatGeo`, `Blank` (with `Background Color`).
**Gotchas.** Light, Dark, Hillshade and NatGeo stop at zoom 16 and upscale beyond. Terrain and NatGeo bake in highways, so a `Highways` legend row is added automatically (turn it off with `showHighwaysLegend` in a saved recipe, or ignore it).
**Film it.** Seven basemaps in a rapid cut under the same claims. Hook: "Pick the base that sells the story."

### 5.4 Panels: show, hide, drag, resize — `Free`
**Where.** `Layout` → `Map` → checkboxes `Title`, `North Arrow`, `Scale Bar`, `Legend`, `Footer`, `Inset Map`. Each panel on the map also has a `×`.
**Drag.** Grab any panel (title, legend, logo, inset, north arrow, scale bar, footer). On Standard and NI 43-101 templates four corner clusters appear, each with slots `Closest to corner`, `Side by side`, `Furthest in`. On the Technical (side panel) template a 5 × 2 grid appears on the right rail.
**Resize.** Hover a panel for edge and corner handles. Snap guides show when edges line up.
**Reset.** `Reset Element Positions`.
**Options.** `Compass Style` (`Compass Rose`, `Simple Arrow`, `Decorative`, `Surveyor`), `Show panel box`, `Panel Corners` 0 to 24 px with `↺`, and under `Customize design` → `Panel Boxes` five checkboxes to hide any panel's background.
**Film it.** Drag the legend across the map and watch the drop slots light up. Hook: "Every panel goes where you want it."

### 5.5 Logo and brand colours — `Free`
**Where.** `Layout` → logo card → `↑ Upload Logo`; then `Replace` / `Remove`.
**What it does.** Reads the logo's colours: the dominant colour becomes the title bar, a second saturated colour becomes the accent, and claims, targets and collars are recoloured to match. Status: `Brand colors applied`.
**Gotchas.** 3 MB max. SVGs are sanitised and can be rejected (`That SVG could not be used safely — try exporting it as a PNG.`).
**Film it.** Drop a logo, the whole map recolours. Hook: "Your brand, applied to the map in one drop."

### 5.6 Templates, modes, themes, fonts — `Free`
**Where.** `Layout` → `Customize design`.
**Options.** `Template` (`Standard`, `NI 43-101`, `Technical` side panel), `Mode` (`Regional Location Map`, `Claims Map`, `Drill Results Map`, `Target Generation Map`, `Infrastructure Map`), `Design Theme` (`Clean`, `Technical`, `Dark`, `Warm`), colour overrides (`Title bg`, `Title text`, `Panel bg`, `Panel text`, `Accent`) with `Reset all`, `Refit Map`, `Improve Map`, and `Fonts` for `Title`, `Legend`, `Labels`, `Callouts` (Inter, Roboto, Open Sans, Montserrat, Lato, plus the brand kit's fonts).
**Gotchas.** A mode preset changes basemap, inset, framing and which roles are visible, but layers you already styled keep their visibility.

### 5.7 NI 43-101 title strip — `Free`
**Where.** Choose `Map type` = `NI 43-101 figure` (or `Template` = `NI 43-101`). `Customize design` → `NI 43-101 Title Strip`.
**Options.** `Figure Title`, `Subtitle / Property`, `Strip Position` (Bottom / Top), `Scale Override`, `Text Size`, `Qualified Person`, `QP Credentials`, `Company`, `Figure No.`, `Revision`, `Projection`.
**What it does.** A monospace strip with cells TITLE / SCALE + PROJECTION / QUALIFIED PERSON / FIGURE. Empty fields show italic placeholders. The UTM frame is forced on.
**Film it.** Drill map becoming a report figure with the strip and grid. Hook: "Technical-report ready."

### 5.8 UTM coordinate frame and datum caption — `Free`
**Where.** `Customize design` → `Coordinate Frame & Datum`.
**Options.** `UTM coordinate frame (ticks and labels on every edge)`, `Projection under the scale bar`, `Projection / Datum` text (blank derives the UTM zone from the map centre, e.g. `NAD83 / UTM Zone 9N`).
**What it does.** White margins with a black frame, eastings and northings on all four edges, and a datum line under the scale bar. Works on every template and exports identically.
**Film it.** Toggle the frame on over the target map. Hook: "Coordinates on every edge, no GIS required."

### 5.9 Legend editor — `Free`
**Where.** `Customize design` → `Legend Items`.
**Options.** `Group entries under headings` (per-row heading fields, default groups Property / Targets / Drilling / Reference / Infrastructure), per-row label override, `↑` / `↓` order, `Remove` / `Show`, `+ Add legend item` (custom rows with a symbol: Circle, Square, Triangle, Triangle (down), Diamond, Hexagon, Star, Cross, Pin, Drillhole, Line, Filled area, plus colour and `Delete`).
**Gotchas.** Derived rows always mirror the layer's real style, so the legend can never disagree with the map. Added items are labels only and draw nothing.
**Film it.** Ungrouped list becoming a grouped, reordered legend. Hook: "A legend that reads like a report."

### 5.10 Region highlights — `Free`
**Where.** `Customize design` → `Region Highlights` → `+ Add Region…`.
**What it does.** Tints any North American province or state as a translucent fill, with colour and opacity per region. Good for regional context maps.

### 5.11 Locator inset — `Free`
**Where.** `Layout` → `Inset` (collapsed).
**Options.** `Inset Style` (`Standard` province/state silhouette with an extent box, or `Satellite`), `Inset Title`, `Inset Label`, `Region`, `Background` and `Marker` colours, `Upload Inset` for your own image (3 MB), `Remove Inset Image`. Badge `Detected: British Columbia` shows the auto-detected region.
**Gotchas.** The region is detected from the newest layer's centre; a multi-region file picks one.

### 5.12 Reference overlays — `Free`
**Where.** `Layout` → `Reference Overlays` (collapsed).
**Options.** `Overlay Opacity` 20 to 100 %, `Roads + Settlements`, `Reference Labels`, `Railways`, `Bedrock Geology (USGS)`.
**Gotchas.** There is no powerlines overlay. A failed service shows `… could not be loaded — the map service did not respond.`

### 5.13 Brand kits — `Pro` to save, `Account` to see
**Where.** `Customize design` → `Brand Kits` → `Manage` / `+ New kit`; also `/account` → `My Brand Kits` and the dashboard nav.
**What it does.** Saves colours, theme, fonts, logo, and company/QP defaults as a reusable kit; `Apply` restyles any map. Studio actions: `Capture current settings`, `Apply current look to this map`, `★ Set default`, `Duplicate`, `Delete`.
**Gotchas.** Free accounts can preview but saving raises the upgrade modal.
**Film it.** Apply a kit to three different maps. Hook: "Every map on-brand, automatically."

### 5.14 Preview mode — `Free`
**Where.** Toolbar `Preview` / `Exit preview`.
**What it does.** Hides the side panel, delete buttons and resize handles so the stage shows the map as it will export. Changes nothing in the file.

### 5.15 Undo, redo, shortcuts — `Free`
Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo (30 steps), Delete/Backspace removes the selected marker, callout, ellipse or boundary, Escape closes modals and inline edits, Shift+Enter adds a line in a callout, clicking the first vertex closes a boundary, `−` / `+` toolbar buttons zoom by half steps.

---

## 6. Export and share

### 6.1 Export ratio and size — `Free` with caps
**Where.** `Export` tab (collapsed; click the heading) or toolbar `Export` → `Export settings…`.
**Options.** `Export Ratio` (`Landscape` 16:9, `Square` 1:1, `Portrait` 3:4; click again to release), `Filename`, `Scale` (`1× — Screen`, `2× — Print`, `3× — Large format`, `Custom (px)` with `Width (px)` / `Height (px)`).
**What it does.** A ratio letterboxes the stage so you frame exactly what will export; each ratio remembers its own view. A custom size makes the canvas match those pixels.
**Gotchas.** Free and anonymous exports clamp the long edge to 2,000 px (the file still downloads, with a toast); Pro goes to 12,000 px. Scale options beyond the plan are disabled and suffixed `(Pro)`.

### 6.2 Export formats — `Free` PNG, `Pro` others
**Where.** Toolbar `Export` menu: `Image for slides and web` (PNG), `Vector for editing` (SVG), `Vector for Illustrator` (ZIP with a separate basemap PNG), `Document for reports` (PDF). Same four under the `Export` tab.
**What it does.** Redraws everything on the stage through one pipeline: basemap, rasters, overlays, layers with all styling, traces, annotations, callouts, panels, frame, strip, credits.
**Test.** Export PNG at 2×. Export PDF and pick `Page size` (`PowerPoint 16:9`, `Letter Landscape`, `Letter Portrait`, `A4 Landscape`, `A4 Portrait`, `News Release Figure (6" × 4.5")`). Open the Illustrator ZIP in Illustrator.
**Gotchas.** SVG, Illustrator and PDF raise the `Upgrade to Pro` modal on free plans; the export resumes automatically after checkout. If the tile server blocks it, the SVG warns `basemap omitted from SVG`. A data source credit (registry, retrieval date, overlay attributions, custom tile credits) prints bottom-left on every export and cannot be removed.
**Film it.** The export menu, then the PNG opening in a slide. Hook: "Slide-ready in one click."

### 6.3 Watermark and email gate — `Free`
**Where.** Appears on the first export for anonymous users, and always for PDF (to choose page size). Title `Export PNG — remove the watermark`.
**What it does.** Enter a `Work email` and press `Email sign-in link & download PNG` to swap the large watermark for a small corner credit and receive a passwordless sign-in link. Or `Download with watermark`.
**Gotchas.** Three states: large `explorationmaps.com` watermark (anonymous, no email), small corner credit (any free account), clean (Pro). After a first export, anonymous users see the toast `Map exported. Create a free account to save it…`.

### 6.4 Share link and public map page — `Free`
**Where.** Toolbar `Share` → `Generate Share Link` → `Copy`.
**What it does.** Creates a permanent read-only page at `/map/<id>` that renders the full composed figure (panels, legend, callouts, frame, NI strip) with no account needed. The bottom bar offers `Make your own copy — free, no signup` (or `Edit this map` when signed in) and `Create your own map →`.
**Test.** Generate a link, open it in a private window, press `Make your own copy`. Then on `/account` → `Shared links` see the view count and press `Revoke`; reload the link to see `Map not available`.
**Gotchas.** Links from anonymous users expire after 30 days and cannot be revoked; signed-in links never expire. Limits: 2 MB payload, 50,000 features, a few links per hour. Nearby claims are baked into the shared copy.
**Film it.** Copy link → open on a phone → the map. Hook: "Send the map, not the file."

---

## 7. Projects and account

### 7.1 Sign in — `Free`
**Where.** Side panel `Sign in / Create account`, landing `Sign in / Sign up free`, the `On this device — sign in to keep` chip, the export gate, or the post-export toast.
**Methods.** Passwordless email link (default: `Email me a sign-in link`), or `Use a password instead` with `Create account` and `Forgot password?`. No social sign-in.
**Gotchas.** The link must be opened on the same device and browser. Password reset opens a modal that cannot be dismissed until a password is set.

### 7.2 Save, autosave, open, rename, duplicate — `Free` local, `Account` cloud
**Where.** Toolbar `Project` menu: `New map`, `Open…`, `Save`, `Save As…`, `Duplicate`. State chip: `Unsaved`, `Saved`, `Saved to cloud`.
**What it does.** Anonymous work saves in the browser; signed-in work saves to the cloud with a thumbnail. A local draft autosaves after every change; cloud autosave runs 10 s after the last edit.
**Test.** Save, reload, `Open…` → `Saved Projects` (rename with `✎`, delete with `✕` → `Delete?`). Open the same cloud project in two tabs, save in both, and handle `This project changed elsewhere` (`Reload the newer version`, `Save mine as a copy`, `Overwrite with mine`).
**Gotchas.** `Save As…` uses a plain browser prompt. Free accounts keep 2 cloud projects. Loading a demo never overwrites your open project (fixed 2026-09-09). Signing in uploads up to 10 local maps to your account and keeps the local copies.

### 7.3 Dashboard `/dashboard` — `Account`
**What it does.** `Your maps` with thumbnails, search (`Search maps…`), sort (`Last edited` / `Name`), and `✎ Rename`, `⧉ Duplicate`, `✕ Delete` per tile. `Tenure Monitor` card with attention shortcuts. `Jump back in` links.
**Gotchas.** Lists cloud projects only. Delete is a soft delete for 30 days.

### 7.4 Settings and billing `/account` — `Account`
**Sections.** `Plan & Billing`, `Brand defaults` (`Company name`, `Qualified Person`, `QP credentials`, `Projection`, pre-filled into every new map), `Your maps`, `Recently deleted` (`Restore`), `Shared links` (views, expiry, `Revoke`), `My Brand Kits`.

---

## 8. Tenure Monitor `/tenure-monitor` — `Account`, B.C. only

### 8.1 Portfolio and adding claims
**Where.** Nav `Tenure Monitor`. First run: `Never lose track of a mineral claim deadline.` → `Create a claim group`. Toolbar: `Add claims`, `Search a map extent`, filter box, `Table` / `Map` / `Activity`, `Export CSV`, `Open in Exploration Maps`.
**Add modes.** `Tenure number`, `Several numbers`, `Registered owner` (results grouped `Exact name match`, `Possible match — check before adding`, `Weak match — probably a different company`), `Client number`, `Upload CSV` (a claim schedule; every row reported back as Matched, Several possible matches, Not found, Found but not in good standing, Duplicate, Already monitored, Could not be read).
**Gotchas.** Free: 10 claims, 1 group, 1 recipient. Pro: 50 claims, unlimited groups, 2 recipients. `Search a map extent` only counts; it does not add. All dates are computed in Pacific time.

### 8.2 Table, map, activity
**Table.** Columns `Tenure`, `Claim`, `Registered owner`, `Project`, `Area (ha)`, `Good-to-date`, `Days remaining`, `Decision` (Undecided, Review required, Intend to maintain, Intend to allow lapse, Maintenance completed, Needs official verification), `Last change`, `Actions` (`Verify in MTO`, `Open map`, `Stop monitoring`). Urgency bands with icon and label: Expired, 0–7 days, 8–30, 31–90, 91–180, More than 180, Date unavailable.
**Map.** `Colour by`: days until good-to-date, status, owner, project, decision, recent change.
**Activity.** Detected changes, `Scheduled and sent reminders`, and an audit log.
**Summary tiles.** `Expiring in 30 days`, `Expiring in 90 days`, `Expiring in 12 months`, `Past good-to-date`, `Needs review`, `Changed recently`. Freshness line `B.C. government data last synchronized …`.

### 8.3 Reminders
**Where.** `Reminders` → `Reminders for <group>`.
**Options.** `90 days before`, `30 days before`, `7 days before` (Pro), `1 day before`; `Tell me when a monitored claim changes`; recipients (`colleague@company.com` → `Add`).
**Film it.** Owner search → grouped matches → summary tiles → reminder settings. Hook: "Never miss a good-to-date."

### 8.4 CSV export
`Export CSV` writes the filtered rows with tenure, claim, owner, project, type, status, area, dates, days remaining, urgency, decision and notes, headed by the sync time and an MTO disclaimer.

---

## 9. Plans and billing

| | Anonymous | Free account | Pro ($29/mo or $290/yr) |
|---|---|---|---|
| Export formats | PNG | PNG | PNG, SVG, Illustrator, PDF |
| Max long edge | 2,000 px | 2,000 px | 12,000 px |
| Watermark | Large mark, or small credit after email | Small credit | None |
| Cloud projects | 0 | 2 | Unlimited |
| Brand kits | preview | preview | Save and apply |
| Tenure Monitor | search only | 10 claims, 1 group, 1 recipient, 90/30/1-day reminders | 50 claims, unlimited groups, 2 recipients, adds 7-day |

**Where.** `Upgrade to Pro` modal (from any gate), landing `#pricing`, `/account` → `Plan & Billing` (`Upgrade — $290/yr (≈ $24.17/mo)`, `$29/month`, `Manage subscription`).
**Test.** On a free account, press `Export SVG` → upgrade modal → choose an interval → Stripe checkout (test card) → return; the SVG export resumes on its own.
**Gotchas.** Accounts created before 17 July 2026 are Pro permanently and show `Pro — early adopter.` Promo codes work in checkout. Past-due subscriptions keep Pro. The data-source credit stays on every export regardless of plan.

---

## 10. Marketing site and SEO pages — `Free`

- Six landing pages: `/mining-map-software/`, `/bc-mineral-claims-map/`, `/mining-claim-search-by-company-name/`, `/shapefile-to-map/`, `/drill-results-map/`, `/mineral-tenure-monitoring/`.
- 21 how-to guides and 4 comparisons under `/blog/` (hubs `/blog/how-to/`, `/blog/comparisons/`).
- 30 company pages under `/companies/` plus TSXV, CSE, BC and Ontario hubs.
- `/about/`, `/contact/`, `/privacy/`, `/terms/`, `/refunds/`.
- Every guide's buttons deep-link into the editor with the right intent and region.

---

## 11. Known issues to keep off camera

Found while building this catalogue. Fixed items are marked.

1. **Fixed.** The on-canvas legend heading ignored `Legend Title` (exports honoured it). Now the editor and shared page show the title you set.
2. **Fixed.** The upgrade modal and account page said the free plan saves 3 cloud projects; the limit is 2 and both now read from the same number.
3. **Fixed.** Two upgrade reasons (resolution clamp, brand kit) fell through to generic copy; each now names its limit.
4. The How to use guide lists marker shapes that do not exist, says layers drag to reorder, and describes five inset options where the picker has two.
5. The share modal says the link is permanent; anonymous links expire after 30 days.
6. Four gallery demos (`claims`, `drill_plan`, `infrastructure`, `dark`) have no button on the site; reach them by URL.
7. The pricing table mentions U.S. BLM search even on deployments where U.S. jurisdictions are switched off.
8. The landing footer links `Privacy` but not `Terms` or `Refunds`, though both pages exist.
9. `Save As…` and Tenure Monitor's `Search a map extent` use plain browser prompts.

---

## 12. Twenty posts, in the order to shoot them

Each is one feature, one hook, one shot under 30 seconds. Start with the demos that already look finished.

| # | Feature | Start from | Hook |
|---|---|---|---|
| 1 | Registry search | `/?intent=claims&query=Dolly Varden` | "Type a company. Get its claims." |
| 2 | Colour by attribute | `/?demo=target` | "Your soil grid, classed in one click." |
| 3 | Drill traces | Buckhorn sample | "Azimuth, dip, length. That's all it takes." |
| 4 | Collar callouts | `/?demo=aurora_demo` | "Headline intercepts, on the map." |
| 5 | Logo → brand colours | Buckhorn sample + a logo PNG | "Your brand in one drop." |
| 6 | Dissolve | any claims layer | "Forty cells. One property." |
| 7 | Nearby claims | `/?demo=claims` | "See who's staked around you." |
| 8 | Basemap flip | `/?demo=dark` | "Pick the base that sells the story." |
| 9 | UTM frame | `/?demo=geology` | "Coordinates on every edge." |
| 10 | NI 43-101 strip | Buckhorn + `NI 43-101 figure` | "Technical-report ready." |
| 11 | Trim shapes | any claims layer | "Trim the map, keep the data." |
| 12 | Per-shape styling | `/?demo=target` | "Make the one that matters stand out." |
| 13 | Distance ring + outside shade | `/?demo=regional` | "Focus the eye." |
| 14 | Strike bracket | `/?demo=target` | "Say it on the map." |
| 15 | Georeferenced image | an image + `.pgw` | "Your mag survey under your claims." |
| 16 | Drag panels | any demo | "Every panel goes where you want it." |
| 17 | Grouped legend | `/?demo=target` | "A legend that reads like a report." |
| 18 | Export ratio + PDF page size | any demo, Pro account | "Slide-ready in one click." |
| 19 | Share link | any demo | "Send the map, not the file." |
| 20 | Tenure Monitor | `/tenure-monitor` | "Never miss a good-to-date." |
