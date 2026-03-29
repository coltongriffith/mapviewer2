import React from "react";
import { Link } from "react-router-dom";
import "./landing.css";

const FEATURES = [
  {
    title: "5 Map Modes",
    desc: "Project overview, regional claims, drill plan, target anomaly, and access location — each with smart layer presets.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="3" y="17" width="22" height="5" rx="2" fill="currentColor" opacity="0.25"/>
        <rect x="3" y="11" width="22" height="5" rx="2" fill="currentColor" opacity="0.55"/>
        <rect x="3" y="5" width="22" height="5" rx="2" fill="currentColor"/>
      </svg>
    ),
  },
  {
    title: "Custom Layer Styling",
    desc: "Per-layer fill colour, fill opacity, stroke colour, stroke width, and dash pattern. Reset to role defaults in one click.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="14" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
        <path d="M14 4 A10 10 0 0 1 24 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        <circle cx="14" cy="14" r="3" fill="currentColor"/>
      </svg>
    ),
  },
  {
    title: "PNG & SVG Export",
    desc: "High-resolution raster output at 1×, 2×, or 3× scale, plus clean vector SVG for further editing.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M14 4v14M8 13l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5 22h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    title: "Smart Annotations",
    desc: "Add callout labels directly from your data layers — plain text, leader lines, or boxed — with nudge positioning.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="4" y="6" width="16" height="11" rx="3" stroke="currentColor" strokeWidth="2" fill="none"/>
        <path d="M10 17l-3 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <path d="M8 11h8M8 14h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    title: "Locator Insets",
    desc: "Automatic province, country, or regional district context maps — or drop in your own custom image.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="3" y="3" width="22" height="22" rx="3" stroke="currentColor" strokeWidth="2" fill="none"/>
        <rect x="8" y="8" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" opacity="0.2"/>
        <circle cx="13" cy="13" r="2" fill="currentColor"/>
      </svg>
    ),
  },
  {
    title: "3 Design Themes",
    desc: "Modern Rounded, Technical Sharp, and Investor Clean — all production-ready and print-optimised.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect x="3" y="3" width="10" height="10" rx="2.5" fill="currentColor"/>
        <rect x="15" y="3" width="10" height="10" rx="5" fill="currentColor" opacity="0.5"/>
        <rect x="3" y="15" width="10" height="10" rx="0.5" fill="currentColor" opacity="0.25"/>
        <rect x="15" y="15" width="10" height="10" rx="2.5" fill="currentColor" opacity="0.75"/>
      </svg>
    ),
  },
];

function MapPreviewSVG() {
  return (
    <svg
      viewBox="0 0 560 360"
      xmlns="http://www.w3.org/2000/svg"
      className="hero-preview"
    >
      {/* Background */}
      <rect width="560" height="360" fill="#dde7f2"/>

      {/* Grid */}
      {[56, 112, 168, 224, 280, 336, 392, 448, 504].map((x) => (
        <line key={`gx${x}`} x1={x} y1="0" x2={x} y2="360" stroke="rgba(0,0,0,0.06)" strokeWidth="1"/>
      ))}
      {[45, 90, 135, 180, 225, 270, 315].map((y) => (
        <line key={`gy${y}`} x1="0" y1={y} x2="560" y2={y} stroke="rgba(0,0,0,0.06)" strokeWidth="1"/>
      ))}

      {/* Target area — dashed amber */}
      <polygon
        points="260,60 390,50 420,160 360,190 240,180 200,110"
        fill="rgba(251,191,36,0.18)"
        stroke="#f59e0b"
        strokeWidth="2"
        strokeDasharray="8 5"
      />

      {/* Claims polygon A */}
      <polygon
        points="80,90 220,70 250,140 290,160 260,230 140,250 70,200"
        fill="rgba(147,197,253,0.28)"
        stroke="#60a5fa"
        strokeWidth="2"
      />

      {/* Claims polygon B */}
      <polygon
        points="300,170 420,165 450,260 390,300 270,290 250,240"
        fill="rgba(147,197,253,0.28)"
        stroke="#60a5fa"
        strokeWidth="2"
      />

      {/* Anomaly polygon */}
      <ellipse cx="330" cy="130" rx="55" ry="38" fill="rgba(217,70,239,0.14)" stroke="#a21caf" strokeWidth="1.8"/>

      {/* River */}
      <path d="M30,180 Q80,160 130,185 Q190,215 240,195 Q300,170 360,200 Q420,230 500,210"
        fill="none" stroke="#7dd3fc" strokeWidth="3" opacity="0.7"/>

      {/* Road */}
      <path d="M60,310 Q150,290 240,300 Q330,310 430,280 Q490,265 540,270"
        fill="none" stroke="#b49577" strokeWidth="2" strokeDasharray="none"/>

      {/* Drill holes */}
      {[[160,120],[200,145],[175,175],[220,170],[245,140],[330,200],[360,230],[300,245]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="5" fill="white" stroke="#1f2937" strokeWidth="1.5"/>
      ))}

      {/* Legend box */}
      <rect x="14" y="270" width="140" height="76" rx="6" fill="rgba(255,255,255,0.93)" stroke="rgba(0,0,0,0.12)" strokeWidth="1"/>
      <text x="22" y="286" fontSize="8" fontWeight="700" fill="#475569" letterSpacing="0.06em" textTransform="uppercase">LEGEND</text>
      <rect x="22" y="293" width="14" height="9" rx="1" fill="rgba(147,197,253,0.35)" stroke="#60a5fa" strokeWidth="1.2"/>
      <text x="42" y="301" fontSize="9" fill="#1e293b">Mining Claims</text>
      <rect x="22" y="307" width="14" height="9" rx="1" fill="rgba(251,191,36,0.2)" stroke="#f59e0b" strokeWidth="1.2" strokeDasharray="4 2"/>
      <text x="42" y="315" fontSize="9" fill="#1e293b">Target Areas</text>
      <circle cx="29" cy="329" r="4" fill="white" stroke="#1f2937" strokeWidth="1.4"/>
      <text x="42" y="333" fontSize="9" fill="#1e293b">Drillholes</text>

      {/* North arrow box */}
      <rect x="510" y="14" width="36" height="50" rx="5" fill="rgba(255,255,255,0.93)" stroke="rgba(0,0,0,0.12)" strokeWidth="1"/>
      <text x="528" y="32" fontSize="11" fontWeight="800" fill="#0f172a" textAnchor="middle">N</text>
      <path d="M528,36 L524,50 L528,47 L532,50 Z" fill="#0f172a"/>

      {/* Scale bar */}
      <rect x="14" y="336" width="80" height="10" rx="2" fill="none" stroke="#475569" strokeWidth="1"/>
      <rect x="14" y="336" width="40" height="10" rx="0" fill="#475569"/>
      <text x="14" y="358" fontSize="8" fill="#64748b">0        5 km</text>

      {/* Callout */}
      <line x1="305" x2="340" y1="100" y2="120" stroke="#0f172a" strokeWidth="1.2"/>
      <rect x="260" y="83" width="75" height="20" rx="3" fill="rgba(255,255,255,0.95)" stroke="#0f172a" strokeWidth="1"/>
      <text x="297" y="96" fontSize="9" fontWeight="700" fill="#0f172a" textAnchor="middle">Cu Anomaly</text>
    </svg>
  );
}

export default function Landing() {
  return (
    <div className="landing">
      {/* Nav */}
      <nav className="landing-nav">
        <div className="landing-wordmark">Map<span>Viewer</span></div>
        <Link to="/editor" className="nav-cta">Open Editor →</Link>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <div className="hero-text">
          <p className="hero-eyebrow">Geology Map Generator</p>
          <h1 className="hero-title">
            Professional geology maps.<br />
            <span>Export-ready.</span>
          </h1>
          <p className="hero-sub">
            Import your claims and drill data, style every layer, and export
            publication-quality PNG or SVG figures in minutes.
          </p>
          <div className="hero-actions">
            <Link to="/editor" className="hero-cta">Launch Editor →</Link>
            <span className="hero-hint">No signup required · Works in your browser</span>
          </div>
        </div>

        <div className="hero-preview-wrap">
          <MapPreviewSVG />
        </div>
      </section>

      {/* Features */}
      <section className="feature-section">
        <p className="feature-section-title">What's included</p>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <span className="feature-icon">{f.icon}</span>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <span>MapViewer · Built for geoscientists</span>
        <span className="footer-badge">Browser-based · No install</span>
      </footer>
    </div>
  );
}
