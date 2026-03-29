import React, { useState } from 'react';

// Static SVG map previews — no external images needed
function InvestorPreview() {
  return (
    <svg viewBox="0 0 220 140" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      {/* Light basemap bg */}
      <rect width="220" height="140" fill="#e8eff8" />
      {/* Terrain shapes */}
      <path d="M0 80 Q40 60 80 70 Q120 80 160 65 Q190 55 220 70 L220 140 L0 140Z" fill="#d4e0ef" />
      <path d="M0 100 Q50 88 100 95 Q150 102 220 90 L220 140 L0 140Z" fill="#c8d8ea" />
      {/* Claims polygon */}
      <polygon points="60,40 140,35 155,90 130,100 50,95" fill="rgba(41,128,185,0.28)" stroke="#1a5276" strokeWidth="1.5" />
      {/* Title block */}
      <rect x="8" y="8" width="90" height="28" rx="4" fill="rgba(10,31,66,0.92)" />
      <rect x="8" y="8" width="90" height="3" rx="2" fill="#4d86d5" />
      <rect x="14" y="17" width="50" height="5" rx="2" fill="rgba(255,255,255,0.85)" />
      <rect x="14" y="26" width="32" height="3" rx="1" fill="rgba(255,255,255,0.45)" />
      {/* Legend */}
      <rect x="8" y="44" width="60" height="38" rx="4" fill="rgba(255,255,255,0.94)" />
      <rect x="14" y="51" width="20" height="8" rx="1" fill="rgba(41,128,185,0.28)" stroke="#1a5276" strokeWidth="1" />
      <rect x="38" y="53" width="24" height="4" rx="1" fill="#ccd8e8" />
      <rect x="14" y="65" width="20" height="8" rx="1" fill="rgba(231,76,60,0.22)" stroke="#922b21" strokeWidth="1" />
      <rect x="38" y="67" width="18" height="4" rx="1" fill="#ccd8e8" />
      {/* North arrow */}
      <rect x="196" y="8" width="18" height="26" rx="3" fill="rgba(255,255,255,0.94)" />
      <text x="205" y="20" textAnchor="middle" fontSize="7" fontWeight="700" fill="#122033">N</text>
      <polygon points="205,22 202,30 205,28 208,30" fill="#122033" />
      {/* Scale bar */}
      <rect x="8" y="118" width="60" height="16" rx="3" fill="rgba(255,255,255,0.94)" />
      <rect x="13" y="122" width="20" height="5" fill="#1a3a5c" />
      <rect x="33" y="122" width="20" height="5" fill="white" stroke="#1a3a5c" strokeWidth="0.5" />
    </svg>
  );
}

function TechnicalPreview() {
  return (
    <svg viewBox="0 0 220 140" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      {/* Topo basemap bg */}
      <rect width="220" height="140" fill="#e4ddd4" />
      {/* Topo contour lines */}
      <ellipse cx="110" cy="70" rx="80" ry="50" fill="none" stroke="#c8b89a" strokeWidth="1" />
      <ellipse cx="110" cy="70" rx="60" ry="36" fill="none" stroke="#c0ae90" strokeWidth="0.8" />
      <ellipse cx="110" cy="70" rx="40" ry="24" fill="none" stroke="#b8a488" strokeWidth="0.8" />
      <ellipse cx="110" cy="70" rx="22" ry="13" fill="none" stroke="#b09a80" strokeWidth="0.6" />
      {/* Claims polygon */}
      <polygon points="55,38 150,32 162,92 135,102 42,98" fill="rgba(41,128,185,0.22)" stroke="#1a5276" strokeWidth="1.5" />
      {/* Roads */}
      <path d="M0 95 Q60 88 110 92 Q160 96 220 85" fill="none" stroke="#7c5e43" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M80 0 Q90 40 88 70 Q86 100 92 140" fill="none" stroke="#7c5e43" strokeWidth="1" strokeLinecap="round" />
      {/* Rail */}
      <path d="M0 110 L220 108" fill="none" stroke="#555" strokeWidth="1.5" strokeDasharray="4 3" />
      {/* Drillholes */}
      <circle cx="85" cy="58" r="3.5" fill="white" stroke="#1f2937" strokeWidth="1.5" />
      <circle cx="105" cy="65" r="3.5" fill="white" stroke="#1f2937" strokeWidth="1.5" />
      <circle cx="125" cy="55" r="3.5" fill="white" stroke="#1f2937" strokeWidth="1.5" />
      <circle cx="115" cy="78" r="3.5" fill="white" stroke="#1f2937" strokeWidth="1.5" />
      {/* Title block — sharp */}
      <rect x="8" y="8" width="92" height="28" rx="2" fill="rgba(20,20,30,0.90)" />
      <rect x="14" y="17" width="52" height="5" rx="1" fill="rgba(255,255,255,0.85)" />
      <rect x="14" y="26" width="34" height="3" rx="1" fill="rgba(255,255,255,0.45)" />
      {/* Legend */}
      <rect x="8" y="44" width="64" height="50" rx="2" fill="rgba(255,255,255,0.93)" />
      <rect x="13" y="51" width="20" height="7" rx="0" fill="rgba(41,128,185,0.22)" stroke="#1a5276" strokeWidth="1" />
      <rect x="37" y="53" width="28" height="3" rx="0" fill="#d0c8bc" />
      <circle cx="23" cy="68" r="3.5" fill="white" stroke="#1f2937" strokeWidth="1.5" />
      <rect x="37" y="65" width="22" height="3" rx="0" fill="#d0c8bc" />
      <path d="M13 80 L33 80" stroke="#7c5e43" strokeWidth="1.5" />
      <rect x="37" y="77" width="24" height="3" rx="0" fill="#d0c8bc" />
    </svg>
  );
}

function SatellitePreview() {
  return (
    <svg viewBox="0 0 220 140" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      {/* Satellite dark bg */}
      <rect width="220" height="140" fill="#1a2030" />
      {/* Satellite texture patches */}
      <rect x="0" y="0" width="110" height="70" fill="#222d3a" opacity="0.8" />
      <rect x="110" y="0" width="110" height="70" fill="#1e2838" opacity="0.8" />
      <rect x="0" y="70" width="110" height="70" fill="#1c2535" opacity="0.8" />
      <rect x="110" y="70" width="110" height="70" fill="#20293a" opacity="0.8" />
      {/* Water body */}
      <path d="M0 50 Q30 42 60 52 Q80 58 100 50 L100 80 Q70 88 40 80 Q20 74 0 78Z" fill="#1a3550" opacity="0.9" />
      {/* Claims polygon */}
      <polygon points="65,30 155,26 168,88 140,100 52,96" fill="rgba(41,128,185,0.30)" stroke="#4d86d5" strokeWidth="1.5" />
      {/* Towns */}
      <circle cx="72" cy="112" r="3" fill="#fbbf24" opacity="0.8" />
      <circle cx="148" cy="118" r="2.5" fill="#fbbf24" opacity="0.8" />
      {/* Title block */}
      <rect x="8" y="8" width="90" height="28" rx="6" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
      <rect x="14" y="17" width="50" height="5" rx="2" fill="rgba(255,255,255,0.75)" />
      <rect x="14" y="26" width="32" height="3" rx="1" fill="rgba(255,255,255,0.35)" />
      {/* Legend */}
      <rect x="8" y="44" width="60" height="28" rx="5" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      <rect x="14" y="51" width="20" height="8" rx="1" fill="rgba(41,128,185,0.35)" stroke="#4d86d5" strokeWidth="1" />
      <rect x="38" y="53" width="22" height="4" rx="1" fill="rgba(255,255,255,0.3)" />
      {/* North arrow */}
      <rect x="196" y="8" width="18" height="26" rx="5" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
      <text x="205" y="20" textAnchor="middle" fontSize="7" fontWeight="700" fill="rgba(255,255,255,0.85)">N</text>
      <polygon points="205,22 202,30 205,28 208,30" fill="rgba(255,255,255,0.85)" />
    </svg>
  );
}

const TEMPLATE_CARDS = [
  {
    id: 'investor',
    name: 'Investor Map',
    desc: 'Clean light basemap, bold claims overlay',
    Preview: InvestorPreview,
  },
  {
    id: 'technical',
    name: 'Technical Map',
    desc: 'Topo basemap, drillholes, rail overlays',
    Preview: TechnicalPreview,
  },
  {
    id: 'satellite',
    name: 'Satellite Map',
    desc: 'Satellite imagery, project overview',
    Preview: SatellitePreview,
  },
];

export default function LandingPage({
  onFileDrop,
  onFileChange,
  onTemplateSelect,
  onContinue,
  hasSavedLayers,
  isLoading,
  fileInputRef,
}) {
  const [dragActive, setDragActive] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileDrop(file);
  };

  return (
    <div className="landing-root">
      <header className="landing-header">
        <div className="landing-header-brand">
          <span className="brand-name">Exploration Maps</span>
          <span className="brand-tagline">Mining map builder</span>
        </div>
        {hasSavedLayers && (
          <button className="landing-continue-btn" type="button" onClick={onContinue}>
            Continue editing →
          </button>
        )}
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <h1 className="landing-headline">
            Turn shapefiles into<br />
            <span className="landing-headline-accent">investor-ready maps</span>
          </h1>
          <p className="landing-sub">
            Drop a shapefile and get a branded, presentation-quality map in seconds.
            Built for mining exploration teams.
          </p>
        </section>

        <div
          className={`landing-dropzone${dragActive ? ' drag-active' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isLoading && fileInputRef.current?.click()}
        >
          {isLoading ? (
            <>
              <div className="landing-spinner" />
              <p className="landing-dropzone-primary">Building your map…</p>
            </>
          ) : (
            <>
              <div className="landing-dropzone-icon">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 28V12M20 12L13 19M20 12L27 19" stroke="#4d86d5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M8 30h24" stroke="#4d86d5" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </div>
              <p className="landing-dropzone-primary">Upload your mining claims shapefile</p>
              <p className="landing-dropzone-secondary">Export from QGIS, ArcGIS, or MineSight as a .zip shapefile, .geojson, or .json</p>
              <button
                className="landing-browse-btn"
                type="button"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              >
                Browse files
              </button>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.geojson,.json"
            onChange={onFileChange}
            hidden
          />
        </div>

        <section className="landing-templates">
          <h2 className="landing-section-title">Or start with a style</h2>
          <div className="landing-template-grid">
            {TEMPLATE_CARDS.map(({ id, name, desc, Preview }) => (
              <button
                key={id}
                type="button"
                className="landing-template-card"
                onClick={() => onTemplateSelect(id)}
              >
                <div className="landing-template-preview">
                  <Preview />
                </div>
                <div className="landing-template-info">
                  <span className="landing-template-name">{name}</span>
                  <span className="landing-template-desc">{desc}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
