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
      <div className="howto-card" role="dialog" aria-modal="true" aria-label="How to use Exploration Maps">
        <button className="howto-close" type="button" onClick={onClose} aria-label="Close">✕</button>

        <aside className="howto-nav" aria-label="Guide sections">
          <div className="howto-nav-header">How to Use Exploration Maps</div>
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
            <p><strong>Exploration Maps</strong> is a professional map-making tool built for mining and exploration companies. Import your spatial data, style it with industry-standard themes, add annotations and callouts, and export publication-ready maps as PNG, SVG, or PDF — all in the browser, with no GIS software required.</p>
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
              <li><strong>Sidebar (left)</strong> — all controls: layers, styling, annotations, design, export settings</li>
              <li><strong>Map canvas (right)</strong> — live preview of your map exactly as it will export</li>
              <li><strong>Toolbar (top of canvas)</strong> — save, open, zoom, and export buttons</li>
            </ul>
            <p>Everything you see on the canvas is what you get in the export — panel positions, styling, annotations, and all.</p>
          </section>

          {/* ── 2. New Project ── */}
          <section id="new-project">
            <h2>Starting a New Project</h2>
            <h3>Creating or loading a project</h3>
            <ul>
              <li>Click <strong>New</strong> in the toolbar to start a blank project</li>
              <li>Click <strong>Open</strong> to load a recently saved project from the list</li>
              <li>Projects auto-save to your browser — the <strong>✓ Saved</strong> indicator in the toolbar confirms the last save</li>
            </ul>
            <h3>The sample project</h3>
            <p>If you have no data yet, click <strong>"Or load sample mining data →"</strong> on the landing page to open a pre-built example (Buckhorn Creek Mining Corp.) with drillholes, claims, roads, and callouts already configured. This is the fastest way to explore what the tool can do.</p>
            <h3>Project management</h3>
            <ul>
              <li><strong>Save</strong> — immediately writes to browser storage</li>
              <li><strong>Save As</strong> — saves a copy under a new name</li>
              <li><strong>Dup</strong> — duplicates the current project</li>
              <li>From the Open panel: rename or delete any saved project</li>
            </ul>
            <p>Projects are stored in your browser's local storage. They persist across sessions but are specific to this browser and device. To back up a project, export your map; project files cannot currently be downloaded directly.</p>
          </section>

          {/* ── 3. Import Data ── */}
          <section id="import-data">
            <h2>Importing Your Data</h2>
            <h3>Supported file types</h3>
            <ul>
              <li><strong>GeoJSON</strong> (.geojson, .json) — polygons, polylines, points, multi-geometry. Best for claims, target areas, geological units, and structure lines.</li>
              <li><strong>CSV</strong> (.csv) — point data with lat/lng columns. Best for drillholes, sample locations, and any tabular point dataset.</li>
              <li><strong>Images</strong> (.jpg, .png) — for your company logo and custom inset maps.</li>
            </ul>
            <h3>Importing a GeoJSON file</h3>
            <ul>
              <li>In the <strong>Layers</strong> section of the sidebar, click the import/upload button</li>
              <li>Select your .geojson or .json file</li>
              <li>The layer is added automatically and the map fits to your data bounds</li>
              <li>If your file contains multiple feature types (e.g., polygons and lines), they are split into separate layers automatically</li>
            </ul>
            <h3>Importing a CSV file</h3>
            <ul>
              <li>Select your .csv file — the <strong>Column Mapper</strong> dialog opens</li>
              <li>Use the dropdowns to assign which columns hold your latitude and longitude values</li>
              <li>Column names are detected automatically when they follow common conventions (lat, lng, x, y, easting, northing, longitude, latitude)</li>
              <li>All other columns in your CSV are preserved as feature properties, accessible when clicking features on the map</li>
            </ul>
            <h3>Assigning a layer role</h3>
            <p>After importing, assign a <strong>Role</strong> to each layer from the layer card. Roles drive automatic styling, legend grouping, and template mode behavior.</p>
            <ul>
              <li><strong>Claims</strong> — mineral claims / property boundaries</li>
              <li><strong>Drillholes</strong> — drill collar points</li>
              <li><strong>Target Areas</strong> — exploration targets</li>
              <li><strong>Anomalies</strong> — geophysical or geochemical anomalies</li>
              <li><strong>Faults / Structures</strong> — geological structures and lineaments</li>
              <li><strong>Roads / Access</strong> — roads and access routes</li>
              <li><strong>Rivers / Water</strong> — drainage and water bodies</li>
              <li><strong>Labels</strong> — reference label layers</li>
            </ul>
            <p>See <strong>Appendix A</strong> for the default styling and legend group for each role.</p>
          </section>

          {/* ── 4. Layers ── */}
          <section id="layers">
            <h2>Working with Layers</h2>
            <h3>The layer list</h3>
            <ul>
              <li>Toggle visibility using the eye icon on each layer card</li>
              <li>Reorder layers by dragging — order controls which layer draws on top of others</li>
              <li>Set a <strong>Primary layer</strong> flag to control which layer the auto-zoom fits to</li>
              <li>Click a layer card to expand its styling and options</li>
            </ul>
            <h3>Renaming layers</h3>
            <p>Click the layer name and type a new display name. This name appears in the legend automatically — rename it before finalizing your map.</p>
            <h3>Styling a layer</h3>
            <p>Expand a layer card to access style controls. Available options depend on geometry type:</p>
            <ul>
              <li><strong>Polygon layers</strong>: stroke color, fill color, fill opacity (0–100%), stroke width, fill pattern (None / Hatch / Cross / Dots), layer opacity, dashed outline toggle</li>
              <li><strong>Line layers</strong>: stroke color, stroke width, dashed toggle, layer opacity</li>
              <li><strong>Point layers</strong>: marker shape (Circle, Square, Triangle, Pickaxe, Shovel, Star), marker color, fill color, size (6–24 px), layer opacity</li>
            </ul>
            <h3>Legend management</h3>
            <ul>
              <li>The legend is built automatically from all visible layers with legend entries enabled</li>
              <li>Click a legend label on the map to edit it inline</li>
              <li>Enable or disable a layer's legend entry from its layer card</li>
              <li>Items are grouped automatically by role: Property, Targets, Drilling, Reference, Infrastructure</li>
            </ul>
          </section>

          {/* ── 5. Basemap ── */}
          <section id="basemap">
            <h2>Choosing a Basemap</h2>
            <h3>Basemap options</h3>
            <ul>
              <li><strong>Light</strong> — neutral light gray. Best for technical and investor maps where your data layers should be the primary visual focus.</li>
              <li><strong>Satellite</strong> — aerial imagery. Best for showing terrain, vegetation, access, and physical infrastructure context.</li>
              <li><strong>Topographic</strong> — contour lines and terrain shading. Best for geological, environmental, and fieldwork maps.</li>
              <li><strong>Dark</strong> — dark background. Best for modern digital presentations, dashboards, and social media.</li>
            </ul>
            <p>Switch basemap from the <strong>Design</strong> section in the sidebar. Template modes also pre-select the most appropriate basemap for each map type.</p>
            <h3>Reference overlays</h3>
            <p>Independently toggle additional reference layers on top of any basemap:</p>
            <ul>
              <li><strong>Context</strong> — roads, water bodies, towns and populated places</li>
              <li><strong>Reference Labels</strong> — place names and geographic labels</li>
              <li><strong>Railway Network</strong> — rail infrastructure</li>
            </ul>
            <p>Use the <strong>Overlay Opacity</strong> slider to soften reference layers so your data remains primary. A value of 40–60% typically gives the right balance between context and clarity.</p>
          </section>

          {/* ── 6. Themes ── */}
          <section id="themes">
            <h2>Choosing a Design Theme</h2>
            <p>Themes control the color scheme for all map panels — title, legend, inset, logo — at once. Pick the one that fits your audience and document type.</p>
            <h3>The five themes</h3>
            <ul>
              <li><strong>Investor — Navy & White</strong>: dark navy title block, white panels, soft shadows. Best for investor decks and corporate presentations.</li>
              <li><strong>Technical — Sharp Borders</strong>: zero border radius, thick black borders, left navy accent bar. Best for technical reports and regulatory filings.</li>
              <li><strong>Modern — Dark Indigo</strong>: deep indigo panels, cyan glow borders. Best for digital publications, dashboards, and social media.</li>
              <li><strong>Terrain — Earthy & Warm</strong>: cream panels, earthy brown borders, burnt-sienna left accent. Best for environmental assessments, field geology, and ecology reports.</li>
              <li><strong>Blueprint — Midnight Cyan</strong>: near-black steel-blue panels, crisp cyan accent bars. Best for engineering and scientific publications.</li>
            </ul>
            <h3>Applying a theme</h3>
            <p>Open the <strong>Design</strong> section in the sidebar and choose from the <strong>Design Theme</strong> dropdown. The change applies instantly to all panels.</p>
            <h3>Overriding theme colors</h3>
            <p>Every theme color can be individually overridden without changing the theme:</p>
            <ul>
              <li><strong>Accent</strong> — the title accent stripe and callout borders. Auto-extracted from your uploaded logo, or set manually.</li>
              <li><strong>Title bg / Title text</strong> — title block background and text colors</li>
              <li><strong>Panel bg / Panel text</strong> — legend, logo, and inset background and text colors</li>
            </ul>
            <p>Click the <strong>Reset (✕)</strong> button next to any color swatch to restore the theme default. Use <strong>Reset all</strong> to return all colors to the active theme at once.</p>
          </section>

          {/* ── 7. Layout ── */}
          <section id="layout">
            <h2>Configuring the Map Layout</h2>
            <h3>Template modes</h3>
            <p>Template modes are one-click presets that configure basemap, reference overlays, visible layer roles, inset type, and composition:</p>
            <ul>
              <li><strong>Regional Location Map</strong> — satellite basemap, all roles visible, province inset</li>
              <li><strong>Claims Map</strong> — light basemap, claims + roads + rivers, country inset</li>
              <li><strong>Drill Results Map</strong> — light basemap, drillholes + targets, secondary zoom inset</li>
              <li><strong>Target Generation Map</strong> — satellite basemap, targets + anomalies + faults, regional inset</li>
              <li><strong>Infrastructure Map</strong> — topo basemap, roads + rivers + labels, country inset</li>
            </ul>
            <p>After applying a template mode, everything is still fully adjustable — template modes are a starting point, not a lock.</p>

            <h3>Title block</h3>
            <ul>
              <li>Click the title text on the map to edit it inline. Click the subtitle text to edit it separately.</li>
              <li><strong>Resize</strong>: hover the title panel to reveal handles — drag the bottom edge to adjust height, the right edge to adjust width, or the corner handle to adjust both at once.</li>
              <li>Add <strong>Map Date</strong>, <strong>Project Number</strong>, and <strong>Scale Note</strong> from Design → Text & Metadata — these appear right-aligned in the title block.</li>
              <li>Toggle <strong>"Title box"</strong> off in Design → Panel Boxes to remove the background and let the title float directly over the map.</li>
            </ul>

            <h3>Legend panel</h3>
            <ul>
              <li>Switch between <strong>Auto</strong>, <strong>Compact</strong>, and <strong>Expanded</strong> legend display modes</li>
              <li>Edit the legend title text from the Design section</li>
              <li>Resize by dragging: right edge (width), bottom edge (height), or corner (both)</li>
              <li>Toggle <strong>"Legend box"</strong> off to remove the panel background</li>
            </ul>

            <h3>Logo panel</h3>
            <ul>
              <li>Upload your company logo from the <strong>Layers</strong> section (logo uploader at the bottom)</li>
              <li>Drag the right edge, bottom edge, or corner handle to resize the logo panel</li>
              <li>Toggle <strong>"Logo box"</strong> off to remove the background and display the logo directly over the map</li>
            </ul>

            <h3>Inset / locator map</h3>
            <p>The inset is a small context map that shows where your project sits within a broader region. Choose the type from Design → Inset Map:</p>
            <ul>
              <li><strong>Province / State</strong> — auto-detected from your layer bounds, shows the province or state silhouette with a location dot</li>
              <li><strong>Country</strong> — zooms out to show the whole country</li>
              <li><strong>Regional</strong> — medium zoom for district-level context</li>
              <li><strong>Secondary Zoom</strong> — a zoomed-in detail window of the project area</li>
              <li><strong>Uploaded Inset</strong> — use a custom image (e.g., a pre-made cross-section or log)</li>
            </ul>
            <ul>
              <li>Resize the inset panel using its drag handles (right edge, bottom edge, or corner)</li>
              <li>Edit the inset title and label text inline</li>
              <li>Toggle the inset off entirely if a locator map is not needed</li>
            </ul>

            <h3>North arrow & scale bar</h3>
            <ul>
              <li>Toggle each on or off from the Design section</li>
              <li>The scale bar calculates the displayed distance automatically from the current zoom level</li>
            </ul>

            <h3>Positioning panels</h3>
            <p>Every element can be placed in any of the four corners. Use the corner pickers in the Design section:</p>
            <ul>
              <li>Title, Logo, Legend, Inset, North Arrow, and Scale Bar each have their own corner selector</li>
              <li>Elements assigned to the same corner stack automatically without overlapping</li>
              <li>Adjust <strong>Safe Margins</strong> to control the edge padding on all four sides</li>
            </ul>

            <h3>Footer</h3>
            <p>Add a disclaimer or data source note via Design → Text & Metadata → Footer. Toggle it on or off. The footer auto-hides if it would overlap the legend, scale bar, or north arrow.</p>
          </section>

          {/* ── 8. Annotations ── */}
          <section id="annotations">
            <h2>Annotations</h2>
            <p>Annotations are free-form elements placed directly on the map — not tied to imported data layers. All annotation tools are in the <strong>Annotations</strong> section of the sidebar.</p>

            <h3>Place Marker</h3>
            <ul>
              <li>Click <strong>Place Marker</strong>, then click anywhere on the map to drop a marker</li>
              <li>Edit: shape (Circle, Square, Triangle, Pickaxe, Shovel, Star), color, size, and label text</li>
              <li>Drag the marker itself to reposition it; drag the label independently to offset it from the marker</li>
            </ul>

            <h3>Draw Dashed Area</h3>
            <ul>
              <li>Click <strong>Draw Dashed Area</strong>, then click the map to place an elliptical zone</li>
              <li>Adjust: width, height, rotation, color, dashed/solid toggle</li>
              <li>Add a label — it appears with a dashed leader line and can be dragged to any position</li>
            </ul>

            <h3>Draw Distance Ring</h3>
            <ul>
              <li>Click <strong>Draw Distance Ring</strong>, then click the map to place the ring center</li>
              <li>Set the radius in kilometers</li>
              <li><strong>Arc label</strong>: text curves along the ring perimeter — set the angle to position it (0° = top, 90° = right, etc.)</li>
              <li><strong>Leader label</strong>: standard floating text with a dashed leader line</li>
              <li>Customize: label text, font size, color, bold toggle, ring color, dashed/solid stroke</li>
              <li>Enable <strong>Outside shade</strong> to add a vignette over everything outside the ring (see Outside shade section below)</li>
            </ul>

            <h3>Draw Boundary (polygon)</h3>
            <ul>
              <li>Click <strong>Draw Boundary</strong> to activate the polygon drawing tool</li>
              <li>Click on the map to place vertices one at a time — a live dashed preview builds with each click</li>
              <li>The blue circle marks the first vertex. Clicking it automatically closes and saves the polygon.</li>
              <li>Alternatively, click <strong>"Close &amp; Save"</strong> in the sidebar once you have 3 or more points</li>
              <li>Click <strong>Cancel</strong> to discard an in-progress polygon</li>
            </ul>
            <p>After saving, select the polygon to edit:</p>
            <ul>
              <li>Label, color, stroke width, dashed/solid toggle</li>
              <li><strong>Smooth boundary</strong> — applies Chaikin curve smoothing, rounding sharp corners while preserving the original click points (toggle off to restore the raw polygon)</li>
              <li><strong>Outside shade</strong> — adds a vignette over everything outside the polygon boundary</li>
            </ul>

            <h3>Place Map Label</h3>
            <ul>
              <li>Click <strong>Place Map Label</strong>, then click to drop a large background text label on the map</li>
              <li>Adjust: text, font size, opacity, letter-spacing, rotation, color, bold</li>
              <li>Use for: province or state names, geological unit labels, region watermarks</li>
            </ul>

            <h3>Outside shade / vignette</h3>
            <p>Outside shade adds a translucent overlay over everything outside a distance ring or polygon boundary, focusing attention on the interior area. The map panels (title, legend, logo) always appear above the shade and are never darkened.</p>
            <ul>
              <li>Enable via the <strong>Outside shade</strong> checkbox on any ring or polygon</li>
              <li>Three quick presets: <strong>Dark</strong> (black at 35%), <strong>Light</strong> (white fog at 30%), <strong>Warm</strong> (sepia at 25%)</li>
              <li>Customise further with the color picker and opacity slider</li>
            </ul>

            <h3>Deleting annotations</h3>
            <p>Click an annotation to select it, then press <kbd>Delete</kbd>. Or use the <strong>Remove</strong> button in its sidebar controls panel.</p>
          </section>

          {/* ── 9. Callouts ── */}
          <section id="callouts">
            <h2>Callouts</h2>
            <p>Callouts are styled text boxes that label specific map features — drillholes, assay results, named targets. Unlike free markers, callouts are tied to individual features in your data layers.</p>

            <h3>Adding callouts</h3>
            <ul>
              <li><strong>From a feature</strong>: click a drillhole or point on the map to open the inline editor. Fill in the title and subtext, then click <strong>"Add / Update Callout"</strong>.</li>
              <li><strong>From a layer</strong>: select a layer in the sidebar, then click <strong>"Add From Selected Layer"</strong> to create callouts for all features at once (uses a property column as the label).</li>
              <li>Use <strong>Auto Frame All</strong> to pan and zoom so all active callouts fit within the visible viewport.</li>
            </ul>

            <h3>Callout types</h3>
            <ul>
              <li><strong>Plain Label</strong> — simple floating text, no box or border</li>
              <li><strong>Leader Label</strong> — text with an arrow or line pointing to the feature</li>
              <li><strong>Boxed Annotation</strong> — text inside a styled rounded box with background and border</li>
              <li><strong>Badge Label</strong> — a colored chip (for a grade or assay value) combined with a main label — ideal for highlighting key results</li>
            </ul>

            <h3>Styling callouts</h3>
            <ul>
              <li>Background color, border color, text color, and subtext color</li>
              <li>Font size (11–16 px) and box width (140–320 px)</li>
              <li>Badge chip text and chip color (Badge type only)</li>
              <li>Priority: <strong>High / Medium / Low</strong> — controls render layering when callouts overlap</li>
            </ul>

            <h3>Positioning callouts</h3>
            <ul>
              <li>Use the <strong>nudge buttons</strong> (↑↓←→) to move a callout in 8 px steps</li>
              <li>Fine-tune after auto-placement to avoid overlaps with other callouts or annotations</li>
            </ul>
          </section>

          {/* ── 10. Region Highlights ── */}
          <section id="highlights">
            <h2>Region Highlights</h2>
            <p>Region highlights overlay a translucent color across an entire North American province or state. Useful for context maps that show which region a project is located in — for example, highlighting British Columbia red on a Canada map.</p>
            <h3>Adding a highlight</h3>
            <ul>
              <li>Open <strong>Design → Region Highlights</strong></li>
              <li>Select a province or state from the dropdown list</li>
              <li>Adjust the highlight color and opacity</li>
              <li>Add multiple highlights to different regions simultaneously</li>
              <li>Click the <strong>×</strong> next to any highlight to remove it</li>
            </ul>
          </section>

          {/* ── 11. Export ── */}
          <section id="export">
            <h2>Exporting Your Map</h2>
            <h3>Export formats</h3>
            <ul>
              <li><strong>PNG</strong> — raster image. Best for presentations, Word documents, email attachments, and web use. Click <strong>PNG</strong> in the toolbar.</li>
              <li><strong>SVG</strong> — vector format. Best for editing in Adobe Illustrator or Inkscape, or when you need infinite scalability. Click <strong>SVG</strong> in the toolbar.</li>
              <li><strong>PDF</strong> — document format. Best for print-ready deliverables, news releases, and regulatory submissions. Click <strong>PDF</strong> in the toolbar.</li>
            </ul>

            <h3>Setting the export aspect ratio</h3>
            <p>Use the <strong>Ratio</strong> buttons in the Export section to lock the canvas to a specific shape before exporting:</p>
            <ul>
              <li><strong>Landscape 16:9</strong> — PowerPoint slides and widescreen presentations</li>
              <li><strong>Square 1:1</strong> — social media posts and equal-dimension formats</li>
              <li><strong>Portrait 3:4</strong> — printed reports and document pages</li>
            </ul>
            <p>When a ratio is active, the canvas is visually constrained with a letterbox preview. Pan and zoom to frame your export precisely. Each ratio remembers its own map position independently — you can set a different framing for landscape vs. portrait without losing either. Click the active ratio button again to deactivate and return to free layout.</p>

            <h3>PDF page size</h3>
            <p>When exporting PDF, choose the page size from the export dialog:</p>
            <ul>
              <li>PowerPoint 16:9 (13.33″ × 7.5″)</li>
              <li>Letter Landscape (11″ × 8.5″) or Portrait (8.5″ × 11″)</li>
              <li>A4 Landscape (11.69″ × 8.27″) or Portrait (8.27″ × 11.69″)</li>
              <li>News Release Figure (6″ × 4.5″)</li>
            </ul>

            <h3>Resolution</h3>
            <p>Set the <strong>Pixel Ratio</strong> in Export Settings to control output resolution:</p>
            <ul>
              <li><strong>1×</strong> — screen resolution (smallest file size)</li>
              <li><strong>2×</strong> — standard HD, suitable for most presentations and reports</li>
              <li><strong>3×</strong> — high resolution, suitable for print-ready files</li>
            </ul>

            <h3>Watermark-free export</h3>
            <p>Enter your work email in the export dialog to unlock clean exports without the <em>explorationmaps.com</em> watermark. Your email is remembered for future sessions. A <strong>"Download with watermark"</strong> option is always available without entering an email.</p>

            <h3>Custom filename</h3>
            <p>Set a custom output filename in <strong>Export → Export Settings</strong> before clicking export. The filename is saved with the project.</p>
          </section>

          {/* ── 12. Tips ── */}
          <section id="tips">
            <h2>Tips & Best Practices</h2>
            <h3>Recommended workflow for a new map</h3>
            <ol style={{ paddingLeft: 20, lineHeight: 1.9, fontSize: 14, color: '#374151' }}>
              <li>Import your data layers and assign roles</li>
              <li>Choose a basemap and design theme</li>
              <li>Select a template mode that matches your map purpose</li>
              <li>Configure the title, subtitle, and metadata fields (map date, project number)</li>
              <li>Position panels to your preference using the corner pickers</li>
              <li>Add annotations — markers, rings, boundaries — and callouts for key features</li>
              <li>Activate the export ratio for your target format and pan/zoom to frame the export</li>
              <li>Export</li>
            </ol>
            <h3>Making your map look professional</h3>
            <ul>
              <li>Use one theme consistently — avoid mixing too many custom colors across panels</li>
              <li>Let roles apply default styling before customizing manually — it saves significant time</li>
              <li>Keep the legend concise: disable legend entries for layers the reader does not need to identify</li>
              <li>Use <strong>Improve Map</strong> as a starting-point optimizer — it auto-sets legend mode, title width, margins, and zoom level</li>
              <li>Use outside shade sparingly — it works best for single-focus maps where one area is most important</li>
              <li>For satellite basemaps, lower the reference overlay opacity to 40–50% so place names are readable without drowning your data</li>
            </ul>
            <h3>Multiple export formats from one project</h3>
            <ul>
              <li>Activate each ratio, adjust framing, then export — the three ratio map positions are stored independently, so switching between them doesn't lose your framing</li>
              <li>For investor presentations: Landscape 16:9, PNG at 2×</li>
              <li>For print reports: Letter Portrait or A4 Portrait PDF</li>
              <li>For news releases: News Release Figure PDF, or 2× PNG</li>
            </ul>
            <h3>Saving and sharing</h3>
            <ul>
              <li>The project auto-saves continuously — watch for the <strong>✓ Saved</strong> flash in the toolbar</li>
              <li>Projects live in your browser's local storage and are specific to this browser and device</li>
              <li>To share your work, export the map and share the image or PDF file</li>
              <li>Use <strong>Save As</strong> or <strong>Dup</strong> to create variations of a project (e.g., different themes or ratios) without overwriting the original</li>
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
                <tr><td><kbd>Delete</kbd></td><td>Remove the currently selected annotation (marker, ellipse, polygon, or callout)</td></tr>
                <tr><td><kbd>Escape</kbd></td><td>Close any open modal or dialog</td></tr>
                <tr><td>Click first vertex (while drawing polygon)</td><td>Automatically closes and saves the polygon</td></tr>
                <tr><td>Click map (with annotation tool active)</td><td>Place a marker, ring center, or polygon vertex at that location</td></tr>
                <tr><td>Drag annotation label</td><td>Reposition the label independently of its parent shape</td></tr>
                <tr><td>Drag panel resize handle</td><td>Resize the title, legend, logo, or inset panel</td></tr>
              </tbody>
            </table>
          </section>

          {/* ── Appendix C ── */}
          <section id="appendix-c">
            <h2>Appendix C — Glossary</h2>
            <dl>
              <dt>Layer Role</dt>
              <dd>The semantic category assigned to a data layer (e.g., Claims, Drillholes). Drives automatic styling, legend grouping, and template mode behavior.</dd>

              <dt>Template Mode</dt>
              <dd>A one-click preset that configures basemap, reference overlays, visible layer roles, inset type, and composition for common map types such as Claims Map or Drill Results Map.</dd>

              <dt>Inset Map</dt>
              <dd>The small locator map shown in a corner of the main canvas, indicating where the project sits within a larger geographic area (province, country, or region).</dd>

              <dt>Outside Shade</dt>
              <dd>A translucent color overlay covering everything outside a selected ring or polygon boundary, creating a vignette effect to focus attention on the interior. Map panels are always rendered above the shade.</dd>

              <dt>Chaikin Smoothing</dt>
              <dd>A curve-smoothing algorithm applied to polygon boundaries that rounds sharp corners by iteratively cutting them. The original click points are preserved — smoothing can be toggled off at any time.</dd>

              <dt>Pixel Ratio</dt>
              <dd>The export resolution multiplier. A 2× export is twice the screen pixel dimensions, producing a sharper image suitable for HD screens and standard print use. 3× is recommended for high-quality print.</dd>

              <dt>Accent Color</dt>
              <dd>A brand color that appears as the title panel stripe and callout borders. Can be set manually or auto-extracted from an uploaded company logo.</dd>

              <dt>Safe Margins</dt>
              <dd>The minimum distance all panels must remain from the map edge. Increase safe margins to give the layout more breathing room from the border.</dd>

              <dt>Arc Label</dt>
              <dd>A label for a distance ring where the text follows the curve of the ring perimeter, rather than appearing as a straight floating label. Position is set by angle (0° = top).</dd>

              <dt>Composition Preset</dt>
              <dd>A spacing and alignment setting (Tight, Balanced, Regional, Access) that controls how far the auto-zoom frames your layers when fitting the map view.</dd>
            </dl>
          </section>

        </div>
      </div>
    </div>
  );
}
