import { useMemo } from 'react';
import { geojsonBounds, unionBounds } from '../utils/geometry';
import { INSET_MODES } from '../projectState';

const REFERENCE_PRESETS = {
  province_state: { label: 'Project in State', expand: 3.8 },
  country: { label: 'Project in Country', expand: 7.2 },
  regional_district: { label: 'Regional Context', expand: 2.15 },
  secondary_zoom: { label: 'Secondary Zoom', expand: 1.45 },
  custom_image: { label: 'Uploaded Inset', expand: 3.6 },
};

function expandBounds(bounds, factor) {
  const cx = (bounds.minLng + bounds.maxLng) / 2;
  const cy = (bounds.minLat + bounds.maxLat) / 2;
  const halfW = Math.max(0.01, ((bounds.maxLng - bounds.minLng) / 2) * factor);
  const halfH = Math.max(0.01, ((bounds.maxLat - bounds.minLat) / 2) * factor);
  return { minLng: cx - halfW, maxLng: cx + halfW, minLat: cy - halfH, maxLat: cy + halfH };
}

function normalize(visibleBounds, referenceBounds) {
  if (!visibleBounds || !referenceBounds) return null;
  const width = referenceBounds.maxLng - referenceBounds.minLng || 1;
  const height = referenceBounds.maxLat - referenceBounds.minLat || 1;
  const pad = 12;
  return {
    x: pad + ((visibleBounds.minLng - referenceBounds.minLng) / width) * (100 - pad * 2),
    y: pad + ((referenceBounds.maxLat - visibleBounds.maxLat) / height) * (100 - pad * 2),
    w: ((visibleBounds.maxLng - visibleBounds.minLng) / width) * (100 - pad * 2),
    h: ((visibleBounds.maxLat - visibleBounds.minLat) / height) * (100 - pad * 2),
  };
}

function buildBackdrop() {
  return {
    stateShape: 'M10,54 C12,34 26,14 46,12 C64,10 80,18 88,34 C92,42 92,56 88,66 C80,84 56,92 34,88 C18,84 8,72 10,54 Z',
    countyLines: [
      'M18 28 L78 28', 'M16 44 L84 44', 'M18 60 L82 60', 'M26 20 L26 82', 'M44 18 L44 84', 'M60 18 L60 82', 'M76 22 L76 76',
    ],
    highways: ['M16 68 C34 62, 52 62, 82 58', 'M58 18 C54 34, 54 48, 56 84'],
    river: 'M10 40 C22 38, 28 48, 40 46 S64 28, 76 34 S88 58, 94 52',
  };
}

// Project geographic [lng, lat] coordinates to SVG viewport [x, y]
function projectToSvg(lng, lat, refBbox, svgW, svgH, pad) {
  const [minLng, minLat, maxLng, maxLat] = refBbox;
  const rangeW = maxLng - minLng || 1;
  const rangeH = maxLat - minLat || 1;
  const x = pad + ((lng - minLng) / rangeW) * (svgW - pad * 2);
  const y = (svgH - pad) - ((lat - minLat) / rangeH) * (svgH - pad * 2); // invert Y
  return [x, y];
}

function buildAutoSvg(region, visibleBounds) {
  const svgW = 100, svgH = 100, pad = 6;
  // Expand region bbox slightly for padding
  const [minLng, minLat, maxLng, maxLat] = region.bbox;
  const padFrac = 0.06;
  const dLng = (maxLng - minLng) * padFrac;
  const dLat = (maxLat - minLat) * padFrac;
  const refBbox = [minLng - dLng, minLat - dLat, maxLng + dLng, maxLat + dLat];

  // Build SVG path(s) for region outline
  const paths = region.coordinates.map(ring => {
    if (ring.length < 2) return '';
    const pts = ring.map(([lng, lat]) => projectToSvg(lng, lat, refBbox, svgW, svgH, pad));
    return 'M ' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ') + ' Z';
  }).filter(Boolean);

  // Project location marker from visible bounds
  let markerEl = null;
  if (visibleBounds) {
    const [cx1, cy1] = projectToSvg(visibleBounds.minLng, visibleBounds.maxLat, refBbox, svgW, svgH, pad);
    const [cx2, cy2] = projectToSvg(visibleBounds.maxLng, visibleBounds.minLat, refBbox, svgW, svgH, pad);
    const mx = Math.min(cx1, cx2), my = Math.min(cy1, cy2);
    const mw = Math.max(4, Math.abs(cx2 - cx1)), mh = Math.max(4, Math.abs(cy2 - cy1));
    const dotX = mx + mw / 2, dotY = my + mh / 2;
    // Clamp to visible area
    const cx = Math.max(pad + 2, Math.min(svgW - pad - 2, dotX));
    const cy = Math.max(pad + 2, Math.min(svgH - pad - 2, dotY));
    markerEl = { mx: Math.max(pad, mx), my: Math.max(pad, my), mw, mh, cx, cy };
  }

  return { paths, markerEl };
}

export default function LocatorInset({ layers, insetMode, mode, insetImage, autoInsetRegion, zone }) {
  const { visibleBounds, referenceBounds } = useMemo(() => {
    const visible = (layers || []).filter((layer) => layer.visible !== false);
    const visibleBounds = unionBounds(visible.map((layer) => geojsonBounds(layer.geojson)).filter(Boolean));
    if (!visibleBounds) return { visibleBounds: null, referenceBounds: null };
    const preset = REFERENCE_PRESETS[insetMode] || REFERENCE_PRESETS.province_state;
    return { visibleBounds, referenceBounds: { ...expandBounds(visibleBounds, preset.expand), label: preset.label } };
  }, [layers, insetMode]);

  const marker = normalize(visibleBounds, referenceBounds);
  const backdrop = buildBackdrop(mode);
  const wantsCustom = insetMode === 'custom_image';
  const showCustom = wantsCustom && insetImage;
  const showAuto = !showCustom && !!autoInsetRegion;

  const autoSvg = useMemo(() => {
    if (!showAuto) return null;
    return buildAutoSvg(autoInsetRegion, visibleBounds);
  }, [showAuto, autoInsetRegion, visibleBounds]);

  return (
    <div className="template-card inset-card polished" style={zone}>
      <div className="inset-header-row">
        <div className="inset-header">Project Locator</div>
      </div>
      {showCustom ? (
        <div className="inset-image-wrap">
          <img src={insetImage} alt="Inset map" className="inset-image" />
        </div>
      ) : showAuto ? (
        <svg viewBox="0 0 100 100" className="inset-svg" preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="0" width="100" height="100" fill="#f0f4f8" />
          {autoSvg.paths.map((d, i) => (
            <path key={i} d={d} fill="#dce8f5" stroke="#8aabcf" strokeWidth="0.8" />
          ))}
          {autoSvg.markerEl && (
            <>
              <rect
                x={autoSvg.markerEl.mx}
                y={autoSvg.markerEl.my}
                width={autoSvg.markerEl.mw}
                height={autoSvg.markerEl.mh}
                fill="rgba(96,165,250,0.25)"
                stroke="#2563eb"
                strokeWidth="1.2"
                rx="1.5"
              />
              <circle
                cx={autoSvg.markerEl.cx}
                cy={autoSvg.markerEl.cy}
                r="3.5"
                fill="#1d4ed8"
                stroke="#ffffff"
                strokeWidth="1.2"
              />
            </>
          )}
        </svg>
      ) : wantsCustom ? (
        <div className="inset-empty-state">No custom inset image loaded yet.</div>
      ) : (
        <svg viewBox="0 0 100 100" className="inset-svg" preserveAspectRatio="none">
          <defs>
            <linearGradient id="locatorBg" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="100%" stopColor="#eef3f8" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="100" rx="8" fill="url(#locatorBg)" stroke="#d3dce8" />
          <path d={backdrop.stateShape} fill="#eef3f8" stroke="#c9d4df" strokeWidth="1" />
          {backdrop.countyLines.map((path, index) => (
            <path key={index} d={path} fill="none" stroke="#d4dce6" strokeWidth="0.9" />
          ))}
          {backdrop.highways.map((path, index) => (
            <path key={index} d={path} fill="none" stroke="#cad5e2" strokeWidth="1.5" strokeLinecap="round" />
          ))}
          <path d={backdrop.river} fill="none" stroke="#b5d8f7" strokeWidth="1.8" strokeLinecap="round" />
          {marker ? (
            <>
              <rect
                x={Math.max(10, marker.x)}
                y={Math.max(10, marker.y)}
                width={Math.max(8, marker.w)}
                height={Math.max(8, marker.h)}
                fill="rgba(96,165,250,0.15)"
                stroke="#2563eb"
                strokeWidth="1.4"
                rx="2"
              />
              <circle
                cx={Math.min(92, Math.max(8, marker.x + marker.w / 2))}
                cy={Math.min(92, Math.max(8, marker.y + marker.h / 2))}
                r="3.2"
                fill="#0f2c56"
                stroke="#ffffff"
                strokeWidth="1.2"
              />
            </>
          ) : null}
        </svg>
      )}
      {!showCustom ? (
        <div className="inset-mode-label">
          {showAuto ? autoInsetRegion.name : (referenceBounds?.label || 'Project in State')}
        </div>
      ) : null}
    </div>
  );
}
