import React, { useEffect, useRef, useState, useCallback } from 'react';

const SECTIONS = [
  { id: 'welcome',      label: 'Welcome & Overview' },
  { id: 'new-project',  label: 'Starting a New Project' },
  { id: 'import-data',  label: 'Importing Your Data' },
  { id: 'layers',       label: 'Working with Layers' },
  { id: 'basemap',      label: 'Choosing a Basemap' },
  { id: 'themes',       label: 'Choosing a Design Theme' },
  { id: 'layout',       label: 'Configuring the Layout' },
  { id: 'annotations',  label: 'Annotations' },
  { id: 'callouts',     label: 'Callouts' },
  { id: 'highlights',   label: 'Region Highlights' },
  { id: 'export',       label: 'Exporting Your Map' },
  { id: 'tips',         label: 'Tips & Best Practices' },
  { id: 'appendix-a',  label: 'Appendix A — Layer Roles' },
  { id: 'appendix-b',  label: 'Appendix B — Shortcuts' },
  { id: 'appendix-c',  label: 'Appendix C — Glossary' },
];

function Img({ caption }) {
  return (
    <div className="howto-img-placeholder">
      📷 {caption}
    </div>
  );
}

export default function HowToUseModal({ onClose }) {
  const contentRef = useRef(null);
  const [activeId, setActiveId] = useState('welcome');

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const topmost = visible.reduce((a, b) =>
            a.boundingClientRect.top < b.boundingClientRect.top ? a : b
          );
          setActiveId(topmost.target.id);
        }
      },
      { root: content, threshold: 0.15 }
    );
    SECTIONS.forEach(({ id }) => {
      const el = content.querySelector(`#${id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const scrollTo = useCallback((id) => {
    const content = contentRef.current;
    if (!content) return;
    const el = content.querySelector(`#${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="howto-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="howto-card" role="dialog" aria-modal="true" aria-label="How to use MapViewer">
        <button className="howto-close" type="button" onClick={onClose} aria-label="Close">✕</button>

        <aside className="howto-nav" aria-label="Guide sections">
          <div className="howto-nav-header">How to Use MapViewer</div>
          {SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`howto-nav-item${activeId === id ? ' active' : ''}`}
              onClick={() => scrollTo(id)}
            >
              {label}
            </button>
          ))}
        </aside>

        <div className="howto-content" ref={contentRef}>

          {/* ── 1. Welcome ── */}
          <section id="welcome">
            <h2>Welcome & Overview</h2>
            <p>MapViewer is a professional map-making tool built for mining and exploration companies. It lets you import your spatial data, style it with industry-standard themes, add annotations and callouts, and export publication-ready maps as PNG, SVG, or PDF — all in the browser.</p>
            <h3>What you can create</h3>
            <ul>
              <li>Regional location maps showing project context</li>
              <li>Claims and property boundary maps</li>
              <li>Drill plan and drill results maps</li>
              <li>Target generation and anomaly maps</li>
              <li>Access and infrastructure maps</li>
            </ul>
            <h3>The interface at a glance</h3>
            <ul>
              <li><strong>Sidebar (left)</strong> — all controls: layers, styling, annotations, design, export</li>
              <li><strong>Map canvas (right)</strong> — live preview of your map exactly as it will export</li>
              <li><strong>Toolbar (top of canvas)</strong> — save, open, zoom, and export buttons</li>
            </ul>
            <Img caption="Full app screenshot with sidebar and map canvas labeled" />
          </section>

          {/* ── 2. New Project ── */}
          <section id="new-project">
            <h2>Starting a New Project</h2>
            <h3>Creating or loading a project</h3>
            <ul>
              <li>Click <strong>New</strong> in the toolbar to start a blank project</li>
              <li>Click <strong>Open</strong> to load a recently saved project</li>
              <li>Projects are saved automatically to your browser — look for the <strong>✓ Saved</strong> indicator</li>
            </ul>
            <h3>The sample project</h3>
            <p>If you have no data yet, click <strong>"Or load sample mining data →"</strong> in the sidebar to explore a pre-built example (Buckhorn Creek Mining Corp.) with drillholes, claims, roads, and callouts already configured.</p>
            <Img caption="Project list / Open projects panel showing recent projects with timestamps" />
            <h3>Project management</h3>
            <ul>
              <li><strong>Save</strong> — immediately writes to browser storage</li>
              <li><strong>Save As</strong> — saves a copy under a new name</li>
              <li><strong>Dup</strong> — duplicates the current project</li>
              <li>From the Open panel: rename or delete any saved project</li>
            </ul>
            <Img caption="Toolbar with Save, Save As, Open, New, Dup buttons labeled" />
          </section>

          {/* ── 3. Import Data ── */}
          <section id="import-data">
            <h2>Importing Your Data</h2>
            <h3>Supported file types</h3>
            <ul>
              <li><strong>GeoJSON</strong> (.geojson, .json) — polygons, polylines, points, multi-geometry. Best for claims, target areas, geological units.</li>
              <li><strong>CSV</strong> (.csv) — point data with lat/lng columns. Best for drillholes, sample locations.</li>
              <li><strong>Images</strong> (.jpg, .png) — for your company logo and custom inset maps.</li>
            </ul>
            <Img caption="Import button in the sidebar with file picker open" />
            <h3>Importing a GeoJSON file</h3>
            <ul>
              <li>In the <strong>Layers</strong> section, click the import/upload button</li>
              <li>Select your .geojson or .json file</li>
              <li>The layer is added automatically and the map fits to your data</li>
            </ul>
            <Img caption="A newly imported polygon layer displayed on the map" />
            <h3>Importing a CSV file</h3>
            <ul>
              <li>Select your .csv file — the Column Mapper dialog opens</li>
              <li>Use the dropdowns to assign which columns hold your latitude and longitude values</li>
              <li>Column names are detected automatically when they follow common conventions (lat, lng, x, y, easting, northing)</li>
            </ul>
            <Img caption="Column Mapper modal with lat/lng dropdowns open" />
            <h3>Assigning a layer role</h3>
            <p>After importing, assign a <strong>Role</strong> to each layer. Roles drive automatic styling, legend grouping, and template behavior.</p>
            <ul>
              <li><strong>Claims</strong> — mineral claims / property boundaries</li>
              <li><strong>Drillholes</strong> — drill collar points</li>
              <li><strong>Target Areas</strong> — exploration targets</li>
              <li><strong>Anomalies</strong> — geophysical or geochemical anomalies</li>
              <li><strong>Faults / Structures</strong> — geological structures</li>
              <li><strong>Roads / Access</strong> — roads and access routes</li>
              <li><strong>Rivers / Water</strong> — drainage and water bodies</li>
              <li><strong>Labels</strong> — reference label layers</li>
            </ul>
            <Img caption="Role dropdown on a layer card in the sidebar" />
          </section>

          {/* ── 4. Layers ── */}
          <section id="layers">
            <h2>Working with Layers</h2>
            <h3>The layer list</h3>
            <ul>
              <li>Toggle visibility using the eye icon on each layer card</li>
              <li>Reorder layers by dragging — order affects what draws on top of what</li>
              <li>Set a <strong>Primary layer</strong> to control which layer the auto-zoom fits to</li>
              <li>Click a layer card to expand its controls</li>
            </ul>
            <Img caption="Layer list with visibility toggles and drag handles" />
            <h3>Renaming layers</h3>
            <p>Click the layer name and type a new display name. This name appears in the legend automatically.</p>
            <h3>Styling a layer</h3>
            <p>Expand a layer card to access its style controls. Available options depend on the geometry type:</p>
            <ul>
              <li><strong>Polygon layers</strong>: stroke color, fill color, fill opacity (0–100%), stroke width, fill pattern (None / Hatch / Cross / Dots), layer opacity, dashed outline toggle</li>
              <li><strong>Line layers</strong>: stroke color, stroke width, dashed toggle, layer opacity</li>
              <li><strong>Point layers</strong>: marker shape (Circle, Square, Triangle, Pickaxe, Shovel, Star), marker color, fill color, size (6–24 px), layer opacity</li>
            </ul>
            <Img caption="Style controls panel open for a polygon layer showing fill, stroke, and pattern options" />
            <Img caption="The same claims layer shown with Hatch, Cross, and Dots fill patterns side by side" />
            <h3>Legend management</h3>
            <ul>
              <li>The legend is built automatically from all visible layers</li>
              <li>Click a legend label on the map to edit it inline</li>
              <li>Enable or disable a layer's legend entry from its layer card</li>
              <li>Items are grouped automatically: Property, Targets, Drilling, Reference, Infrastructure</li>
            </ul>
            <Img caption="Legend panel on the map with grouped entries highlighted" />
          </section>

          {/* ── 5. Basemap ── */}
          <section id="basemap">
            <h2>Choosing a Basemap</h2>
            <h3>Basemap options</h3>
            <ul>
              <li><strong>Light</strong> — neutral light gray. Best for technical and investor maps where your data should stand out.</li>
              <li><strong>Satellite</strong> — aerial imagery. Best for showing terrain, access, and infrastructure context.</li>
              <li><strong>Topographic</strong> — contour lines and terrain. Best for geological and environmental maps.</li>
              <li><strong>Dark</strong> — dark background. Best for modern digital presentations and social media.</li>
            </ul>
            <p>Switch basemap from the <strong>Design</strong> section or from a template mode preset.</p>
            <Img caption="The same project area shown in all four basemap styles (Light, Satellite, Topo, Dark) in a 2×2 grid" />
            <h3>Reference overlays</h3>
            <p>Independently toggle additional reference layers on top of any basemap:</p>
            <ul>
              <li><strong>Context</strong> — roads, water bodies, towns</li>
              <li><strong>Reference Labels</strong> — place names and geographic labels</li>
              <li><strong>Railway Network</strong> — rail infrastructure</li>
            </ul>
            <p>Use the <strong>Overlay Opacity</strong> slider to soften reference layers so your data remains primary.</p>
            <Img caption="Map with reference overlays on vs. off — same area, dramatically different context" />
          </section>

          {/* ── 6. Themes ── */}
          <section id="themes">
            <h2>Choosing a Design Theme</h2>
            <p>Themes control the color scheme for all map panels (title, legend, legend, inset, footer) at once. Pick the one that fits your audience and document type.</p>
            <h3>The five themes</h3>
            <ul>
              <li><strong>Investor — Navy & White</strong>: dark navy title block, white panels, soft shadows. Best for investor decks and corporate presentations.</li>
              <li><strong>Technical — Sharp Borders</strong>: zero border radius, thick black borders, left navy accent bar. Best for technical reports and regulatory filings.</li>
              <li><strong>Modern — Dark Indigo</strong>: deep indigo panels, cyan glow borders. Best for digital publications, dashboards, and social media.</li>
              <li><strong>Terrain — Earthy & Warm</strong>: cream panels, earthy brown borders, burnt-sienna left accent. Best for environmental assessments, field geology, and ecology.</li>
              <li><strong>Blueprint — Midnight Cyan</strong>: near-black steel-blue panels, crisp cyan accent bars. Best for engineering and scientific publications.</li>
            </ul>
            <Img caption="All five themes applied to the same map, shown side-by-side" />
            <h3>Applying a theme</h3>
            <p>Open the <strong>Design</strong> section in the sidebar and choose from the <strong>Design Theme</strong> dropdown. The change applies instantly across all panels.</p>
            <h3>Overriding theme colors</h3>
            <p>Every theme color can be individually overridden without changing the theme:</p>
            <ul>
              <li><strong>Accent</strong> — controls the title accent stripe and callout borders. Auto-extracted from your uploaded logo.</li>
              <li><strong>Title bg / Title text</strong> — title block background and text colors</li>
              <li><strong>Panel bg / Panel text</strong> — legend, logo, inset background and text</li>
            </ul>
            <p>Click the <strong>Reset</strong> (✕) button next to any swatch to restore the theme default. Use <strong>Reset all</strong> to return all colors to the active theme.</p>
            <Img caption="Color override swatches in the Design section with reset (✕) buttons visible" />
          </section>

          {/* ── 7. Layout ── */}
          <section id="layout">
            <h2>Configuring the Map Layout</h2>
            <h3>Template modes</h3>
            <p>Template modes are preset starting points that configure basemap, reference overlays, visible layer roles, inset type, and composition in one click:</p>
            <ul>
              <li><strong>Regional Location Map</strong> — satellite basemap, all roles, province inset</li>
              <li><strong>Claims Map</strong> — light basemap, claims + roads + rivers, country inset</li>
              <li><strong>Drill Results Map</strong> — light basemap, drillholes + targets, secondary zoom inset</li>
              <li><strong>Target Generation Map</strong> — satellite basemap, targets + anomalies + faults, regional inset</li>
              <li><strong>Infrastructure Map</strong> — topo basemap, roads + rivers + labels, country inset</li>
            </ul>
            <Img caption="Template mode dropdown in the Design section" />

            <h3>Title block</h3>
            <ul>
              <li>Click the title text on the map to edit it inline. Same for the subtitle.</li>
              <li><strong>Resize by dragging</strong>: hover the title panel to reveal handles — drag the bottom edge for height, right edge for width, or corner handle for both at once.</li>
              <li>Add <strong>Map Date</strong>, <strong>Project Number</strong>, and <strong>Scale Note</strong> from Design → Text & Metadata — they appear right-aligned in the title block.</li>
              <li>Toggle <strong>"Title box"</strong> off in Design → Panel Boxes to remove the background and let text float directly over the map.</li>
            </ul>
            <Img caption="Title panel with resize handles visible on hover — bottom, right, and corner handles labeled" />
            <Img caption="Transparent title mode — title text floating directly over the satellite basemap" />

            <h3>Legend panel</h3>
            <ul>
              <li>Switch between <strong>Auto</strong>, <strong>Compact</strong>, and <strong>Expanded</strong> legend modes</li>
              <li>Edit the legend title text</li>
              <li>Drag the right edge to adjust width, bottom edge to adjust height, corner to adjust both</li>
              <li>Toggle <strong>"Legend box"</strong> off to remove the panel background</li>
            </ul>
            <Img caption="Legend panel with resize handles in use" />

            <h3>Logo panel</h3>
            <ul>
              <li>Upload your logo in the <strong>Layers</strong> section (logo uploader)</li>
              <li>Drag handles on the logo panel to resize width, height, or both</li>
              <li>Toggle <strong>"Logo box"</strong> off to remove the background (logo sits directly on the map)</li>
            </ul>
            <Img caption="Logo panel with and without box background — floating logo on satellite basemap" />

            <h3>Inset / locator map</h3>
            <p>The inset is a small context map that shows where your project sits within a broader region.</p>
            <ul>
              <li><strong>Province / State</strong> — auto-detected from your layer bounds, shows the province/state silhouette</li>
              <li><strong>Country</strong> — zooms out to show the whole country</li>
              <li><strong>Regional</strong> — medium zoom for district-level context</li>
              <li><strong>Secondary Zoom</strong> — a zoomed-in detail of the project area</li>
              <li><strong>Uploaded Inset</strong> — use a custom image (e.g., a pre-made cross-section)</li>
            </ul>
            <ul>
              <li>Drag handles to resize the inset panel (right edge, bottom edge, or corner)</li>
              <li>Edit the inset title and label text</li>
              <li>Toggle visibility off if the inset is not needed</li>
            </ul>
            <Img caption="Inset map showing British Columbia province with project location dot" />
            <Img caption="Four inset modes compared — Province, Country, Regional, Secondary Zoom" />

            <h3>North arrow & scale bar</h3>
            <ul>
              <li>Toggle each on/off from the Design section</li>
              <li>The scale bar calculates distance automatically based on the current zoom level</li>
            </ul>

            <h3>Positioning all panels</h3>
            <p>Every element can be independently moved to any of the four corners. Use the corner pickers in the Design section:</p>
            <ul>
              <li>Title, Logo, Legend, Inset, North Arrow, Scale Bar each have their own corner selector</li>
              <li>Elements in the same corner stack automatically without overlapping</li>
              <li>Adjust <strong>Safe Margins</strong> to control the edge padding on all four sides</li>
            </ul>
            <Img caption="Panel corner-placement dropdowns in the Design section sidebar" />
            <Img caption="Example layout with legend in top-right, title bottom-left, and inset bottom-right" />

            <h3>Footer</h3>
            <p>Add a disclaimer or data source note via Design → Text & Metadata → Footer. Toggle it on/off. The footer auto-hides if it would overlap the legend, scale bar, or north arrow.</p>
          </section>

          {/* ── 8. Annotations ── */}
          <section id="annotations">
            <h2>Annotations</h2>
            <p>Annotations are free-form elements you place directly on the map — not tied to imported data layers. Find all annotation tools in the <strong>Annotations</strong> section of the sidebar.</p>
            <Img caption="Annotation tool buttons row — Place Marker, Draw Dashed Area, Draw Distance Ring, Place Map Label, Draw Boundary" />

            <h3>Place Marker</h3>
            <ul>
              <li>Click <strong>Place Marker</strong>, then click anywhere on the map</li>
              <li>Edit: shape (Circle, Square, Triangle, Pickaxe, Shovel, Star), color, size, label text</li>
              <li>Drag the marker to reposition it; drag the label independently to offset it</li>
            </ul>
            <Img caption="A Pickaxe marker on the map with its sidebar controls open beside it" />

            <h3>Draw Dashed Area</h3>
            <ul>
              <li>Click <strong>Draw Dashed Area</strong>, then click the map to place an elliptical/oval zone</li>
              <li>Adjust: width, height, rotation, color, dashed/solid toggle</li>
              <li>Add a label — it appears with a dashed leader line. Drag the label to reposition it.</li>
            </ul>
            <Img caption="Dashed ellipse highlight zone placed over a target area, with label and leader line" />

            <h3>Draw Distance Ring</h3>
            <ul>
              <li>Click <strong>Draw Distance Ring</strong>, then click to place the ring center</li>
              <li>Set the radius in kilometers</li>
              <li><strong>Arc label</strong>: text curves along the ring perimeter — rotate to any angle (0° = top)</li>
              <li><strong>Leader label</strong>: standard text with a dashed leader line</li>
              <li>Customize: label text, font size, color, bold toggle, ring color, dashed/solid</li>
              <li><strong>Outside shade</strong>: adds a translucent vignette over everything outside the ring (see below)</li>
            </ul>
            <Img caption="Distance ring with arc label curving along the top of the perimeter" />
            <Img caption="Two concentric rings with different radii, colors, and arc labels" />

            <h3>Draw Boundary (polygon)</h3>
            <ul>
              <li>Click <strong>Draw Boundary</strong> to activate the polygon tool</li>
              <li>Click on the map to place vertices one at a time — a live dashed preview builds with each click</li>
              <li>The blue circle marks the first vertex. Click it to close the polygon automatically.</li>
              <li>Alternatively, click <strong>"Close & Save"</strong> in the sidebar once you have 3 or more points</li>
            </ul>
            <Img caption="In-progress polygon drawing showing vertex dots and live dashed path preview" />
            <Img caption="Completed boundary polygon with Close & Save button visible in sidebar" />
            <p>After saving, edit the polygon:</p>
            <ul>
              <li>Label, color, stroke width, dashed/solid toggle</li>
              <li><strong>Smooth boundary</strong> — toggle to apply Chaikin curve smoothing, rounding sharp corners while preserving the original click points</li>
              <li><strong>Outside shade</strong> — adds a vignette over everything outside the polygon</li>
            </ul>
            <Img caption="Same polygon with Smooth boundary off vs. on — corners visibly rounded" />

            <h3>Place Map Label</h3>
            <ul>
              <li>Click <strong>Place Map Label</strong>, then click to place a large background text label</li>
              <li>Adjust: text, font size, opacity, letter-spacing, rotation, color, bold</li>
              <li>Use for: province names, geological unit names, region callouts</li>
            </ul>
            <Img caption="Large translucent 'BRITISH COLUMBIA' watermark label spanning the map" />

            <h3>Outside shade / vignette</h3>
            <p>Outside shade darkens (or lightens) everything outside a distance ring or polygon boundary, focusing attention on the interior area.</p>
            <ul>
              <li>Enable via the <strong>Outside shade</strong> checkbox on any ring or polygon</li>
              <li>Three quick presets: <strong>Dark</strong> (black, 35%), <strong>Light</strong> (white fog, 30%), <strong>Warm</strong> (sepia, 25%)</li>
              <li>Customise with the color picker and opacity slider</li>
              <li>Panels (title, legend, logo) always appear above the shade — they are never darkened</li>
            </ul>
            <Img caption="Dark outside shade applied around a target polygon — interior remains fully lit" />
            <Img caption="Light/fog shade around a distance ring for a softer focus effect" />

            <h3>Deleting annotations</h3>
            <p>Click an annotation to select it, then press <kbd>Delete</kbd>. Or use the <strong>Remove</strong> button in the sidebar controls.</p>
          </section>

          {/* ── 9. Callouts ── */}
          <section id="callouts">
            <h2>Callouts</h2>
            <p>Callouts are styled text boxes that label specific map features — drillholes, assay results, named targets. Unlike free markers, callouts are linked to your data layer features.</p>
            <Img caption="Map with several callouts labeling drillhole collars with name, depth, and assay" />

            <h3>Adding callouts</h3>
            <ul>
              <li><strong>From a feature</strong>: click a drillhole or point on the map to open the inline editor. Fill in the title and subtext, then click "Add / Update Callout".</li>
              <li><strong>From a layer</strong>: select a layer, then click "Add From Selected Layer" to create callouts for all features at once.</li>
              <li>Use <strong>Auto Frame All</strong> to zoom/pan so all callouts fit in the viewport.</li>
            </ul>
            <Img caption="Inline feature editor appearing next to a clicked drillhole point" />

            <h3>Callout types</h3>
            <ul>
              <li><strong>Plain Label</strong> — simple floating text, no box</li>
              <li><strong>Leader Label</strong> — text with an arrow/line pointing to the feature</li>
              <li><strong>Boxed Annotation</strong> — text inside a styled rounded box</li>
              <li><strong>Badge Label</strong> — a colored chip (grade, assay value) with a main label — ideal for highlighting key results</li>
            </ul>
            <Img caption="All four callout types side-by-side on the same map" />

            <h3>Styling callouts</h3>
            <ul>
              <li>Background color, border color, text color, subtext color</li>
              <li>Font size (11–16 px), box width (140–320 px)</li>
              <li>Badge chip text and chip color (Badge type only)</li>
              <li>Priority: High / Medium / Low — controls render layering when callouts overlap</li>
            </ul>

            <h3>Positioning callouts</h3>
            <ul>
              <li>Use the <strong>nudge buttons</strong> (↑↓←→) to move a callout in 8 px steps</li>
              <li>After auto-placement, nudge to fine-tune position relative to the feature</li>
            </ul>
            <Img caption="Callout sidebar controls open — nudge buttons and style options visible" />
          </section>

          {/* ── 10. Region Highlights ── */}
          <section id="highlights">
            <h2>Region Highlights</h2>
            <p>Region highlights overlay a translucent color across an entire North American province or state — useful for context maps that show which region a project is located in.</p>
            <Img caption="Map with British Columbia highlighted in red/orange against a neutral background" />
            <h3>Adding a highlight</h3>
            <ul>
              <li>Open <strong>Design → Region Highlights</strong></li>
              <li>Select a province or state from the list</li>
              <li>Adjust the color and opacity</li>
              <li>Add multiple highlights to different regions simultaneously</li>
              <li>Click the <strong>×</strong> button to remove a highlight</li>
            </ul>
            <Img caption="Region Highlights control panel with two provinces highlighted and their color/opacity controls" />
          </section>

          {/* ── 11. Export ── */}
          <section id="export">
            <h2>Exporting Your Map</h2>
            <h3>Export formats</h3>
            <ul>
              <li><strong>PNG</strong> — raster image. Best for presentations, Word documents, email attachments, and web use.</li>
              <li><strong>SVG</strong> — vector format. Best when you need to edit the map in Adobe Illustrator or Inkscape, or need infinite scalability.</li>
              <li><strong>PDF</strong> — document format. Best for print-ready deliverables, news releases, and regulatory submissions.</li>
            </ul>

            <h3>Setting the export aspect ratio</h3>
            <p>Use the <strong>Ratio</strong> buttons in the Export section to lock the canvas to a specific shape before exporting:</p>
            <ul>
              <li><strong>Landscape 16:9</strong> — PowerPoint slides, widescreen presentations</li>
              <li><strong>Square 1:1</strong> — social media posts, equal dimensions</li>
              <li><strong>Portrait 3:4</strong> — printed reports and document pages</li>
            </ul>
            <p>When a ratio is active, the map canvas is visually constrained. Pan and zoom to frame your export perfectly. Each ratio remembers its own map position independently — you can set up a different framing for landscape vs. portrait. Click the active ratio button again to deactivate and return to free layout.</p>
            <Img caption="Ratio switcher with Landscape active — constrained canvas with dark letterbox visible" />
            <Img caption="The same project in Landscape vs. Portrait ratio showing different map framing" />

            <h3>PDF page size</h3>
            <p>When exporting PDF, choose the page size:</p>
            <ul>
              <li>PowerPoint 16:9 (13.33″ × 7.5″)</li>
              <li>Letter Landscape (11″ × 8.5″) or Portrait (8.5″ × 11″)</li>
              <li>A4 Landscape (11.69″ × 8.27″) or Portrait (8.27″ × 11.69″)</li>
              <li>News Release Figure (6″ × 4.5″)</li>
            </ul>

            <h3>Resolution</h3>
            <p>Set the <strong>Pixel Ratio</strong> in Export Settings:</p>
            <ul>
              <li><strong>1×</strong> — screen resolution (smaller file size)</li>
              <li><strong>2×</strong> — standard HD, suitable for most presentations and reports</li>
              <li><strong>3×</strong> — high resolution, suitable for print</li>
            </ul>

            <h3>Watermark-free export</h3>
            <p>Enter your work email in the export dialog to unlock clean exports with no <em>explorationmaps.com</em> label. Your email is remembered for future sessions. A "Download with watermark" option is always available without an email.</p>
            <Img caption="Export modal with email field, ratio badge, and PDF page size selector visible" />

            <h3>Custom filename</h3>
            <p>Set a custom output filename in <strong>Export → Export Settings</strong> before clicking export.</p>
          </section>

          {/* ── 12. Tips ── */}
          <section id="tips">
            <h2>Tips & Best Practices</h2>
            <h3>Recommended workflow for a new map</h3>
            <ol style={{ paddingLeft: 20, lineHeight: 1.9, fontSize: 14, color: '#374151' }}>
              <li>Import your data layers and assign roles</li>
              <li>Choose a basemap and design theme</li>
              <li>Select a template mode that matches your map purpose</li>
              <li>Configure the title, subtitle, and metadata fields</li>
              <li>Position panels to your preference</li>
              <li>Add annotations — markers, rings, boundaries, callouts</li>
              <li>Activate the export ratio for your target format</li>
              <li>Pan and zoom to frame the export</li>
              <li>Export</li>
            </ol>
            <h3>Making your map look professional</h3>
            <ul>
              <li>Use one theme consistently — avoid mixing too many custom colors</li>
              <li>Let roles apply default styling before customizing — it saves time</li>
              <li>Keep the legend concise: hide entries the reader doesn't need</li>
              <li>Use <strong>Improve Map</strong> as a starting-point optimizer — it auto-sets legend mode, title width, margins, and zoom</li>
              <li>Use outside shade sparingly — it works best for single-focus maps where one area matters most</li>
            </ul>
            <h3>Multiple export formats from one project</h3>
            <ul>
              <li>Activate each ratio, adjust framing, then export — the three ratio map positions are stored independently</li>
              <li>For presentations: Landscape 16:9, PNG at 2×</li>
              <li>For print reports: Letter Portrait PDF</li>
              <li>For news releases: News Release Figure PDF, or 2× PNG</li>
            </ul>
            <h3>Saving and sharing</h3>
            <ul>
              <li>The project auto-saves continuously — watch for the <strong>✓ Saved</strong> flash</li>
              <li>Projects live in your browser's local storage</li>
              <li>To share your map, export it and share the image or PDF file</li>
            </ul>
          </section>

          {/* ── Appendix A ── */}
          <section id="appendix-a">
            <h2>Appendix A — Layer Role Reference</h2>
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Legend Group</th>
                  <th>Default Style</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Claims</td><td>Property</td><td>Blue stroke, light blue fill (22% opacity)</td></tr>
                <tr><td>Target Areas</td><td>Targets</td><td>Amber dashed stroke, light amber fill</td></tr>
                <tr><td>Anomalies</td><td>Targets</td><td>Purple stroke, light purple fill</td></tr>
                <tr><td>Faults / Structures</td><td>Reference</td><td>Dark gray dashed line, no fill</td></tr>
                <tr><td>Roads / Access</td><td>Infrastructure</td><td>Brown solid line, no fill</td></tr>
                <tr><td>Rivers / Water</td><td>Infrastructure</td><td>Sky blue stroke, light blue fill</td></tr>
                <tr><td>Drillholes</td><td>Drilling</td><td>Dark circle marker, white fill</td></tr>
                <tr><td>Labels</td><td>Reference</td><td>Dark text only, no fill</td></tr>
              </tbody>
            </table>
          </section>

          {/* ── Appendix B ── */}
          <section id="appendix-b">
            <h2>Appendix B — Keyboard Shortcuts</h2>
            <table>
              <thead>
                <tr>
                  <th>Key / Action</th>
                  <th>Effect</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><kbd>Delete</kbd></td><td>Remove the currently selected annotation (marker, ellipse, polygon, callout)</td></tr>
                <tr><td><kbd>Escape</kbd></td><td>Close any open modal or dialog</td></tr>
                <tr><td>Click first vertex (while drawing polygon)</td><td>Automatically closes and saves the polygon</td></tr>
                <tr><td>Click map (with annotation tool active)</td><td>Place a marker / ring / polygon point at that location</td></tr>
                <tr><td>Drag annotation label</td><td>Reposition the label independently of the shape</td></tr>
              </tbody>
            </table>
          </section>

          {/* ── Appendix C ── */}
          <section id="appendix-c">
            <h2>Appendix C — Glossary</h2>
            <dl style={{ fontSize: 14, lineHeight: 1.8, color: '#374151' }}>
              <dt style={{ fontWeight: 700, color: '#0f172a', marginTop: 14 }}>Layer Role</dt>
              <dd style={{ marginLeft: 20 }}>The semantic category assigned to a data layer (e.g., Claims, Drillholes). Drives automatic styling, legend grouping, and template mode behavior.</dd>

              <dt style={{ fontWeight: 700, color: '#0f172a', marginTop: 14 }}>Template Mode</dt>
              <dd style={{ marginLeft: 20 }}>A preset configuration (basemap, visible roles, inset type, composition) for common map types such as Claims Map or Drill Results Map.</dd>

              <dt style={{ fontWeight: 700, color: '#0f172a', marginTop: 14 }}>Inset Map</dt>
              <dd style={{ marginLeft: 20 }}>The small context map (locator) shown in a corner of the main map, indicating where the project sits within a larger geographic area.</dd>

              <dt style={{ fontWeight: 700, color: '#0f172a', marginTop: 14 }}>Outside Shade</dt>
              <dd style={{ marginLeft: 20 }}>A translucent color overlay that covers everything outside a selected ring or polygon boundary, creating a vignette effect to focus attention on the interior.</dd>

              <dt style={{ fontWeight: 700, color: '#0f172a', marginTop: 14 }}>Chaikin Smoothing</dt>
              <dd style={{ marginLeft: 20 }}>A curve-smoothing algorithm applied to polygon boundaries that rounds sharp corners by iteratively cutting them. The original click points are preserved and smoothing can be toggled off.</dd>

              <dt style={{ fontWeight: 700, color: '#0f172a', marginTop: 14 }}>Pixel Ratio</dt>
              <dd style={{ marginLeft: 20 }}>The export resolution multiplier. 2× means the exported image is twice the screen pixel dimensions, producing a sharper image suitable for print and HD screens.</dd>

              <dt style={{ fontWeight: 700, color: '#0f172a', marginTop: 14 }}>Accent Color</dt>
              <dd style={{ marginLeft: 20 }}>A brand color that appears as the title panel stripe and callout borders. Can be set manually or auto-extracted from an uploaded logo.</dd>

              <dt style={{ fontWeight: 700, color: '#0f172a', marginTop: 14 }}>Safe Margins</dt>
              <dd style={{ marginLeft: 20 }}>The minimum distance all panels must stay from the map edge. Increase safe margins to give the layout more breathing room from the border.</dd>

              <dt style={{ fontWeight: 700, color: '#0f172a', marginTop: 14 }}>Arc Label</dt>
              <dd style={{ marginLeft: 20 }}>A label for a distance ring where the text follows the curve of the ring perimeter, rather than appearing as a straight floating label.</dd>

              <dt style={{ fontWeight: 700, color: '#0f172a', marginTop: 14 }}>Composition Preset</dt>
              <dd style={{ marginLeft: 20 }}>A spacing/alignment setting (Tight, Balanced, Regional, Access) that controls how far the auto-zoom frames your layers when fitting the map view.</dd>
            </dl>
          </section>

        </div>
      </div>
    </div>
  );
}
