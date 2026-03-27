import { useMemo } from 'react';
import { geojsonBounds, unionBounds } from '../utils/geometry';
import { INSET_MODES } from '../projectState';

const REFERENCE_PRESETS = {
  province_state: { label: INSET_MODES.province_state, expand: 3.6 },
  country: { label: INSET_MODES.country, expand: 7.2 },
  regional_district: { label: INSET_MODES.regional_district, expand: 2.15 },
  secondary_zoom: { label: INSET_MODES.secondary_zoom, expand: 1.45 },
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
  const pad = 10;
  return {
    x: pad + ((visibleBounds.minLng - referenceBounds.minLng) / width) * (100 - pad * 2),
    y: pad + ((referenceBounds.maxLat - visibleBounds.maxLat) / height) * (100 - pad * 2),
    w: ((visibleBounds.maxLng - visibleBounds.minLng) / width) * (100 - pad * 2),
    h: ((visibleBounds.maxLat - visibleBounds.minLat) / height) * (100 - pad * 2),
  };
}

function buildBackdrop(mode) {
  const lineTone = mode === 'project_overview' ? '#cfd8e3' : '#d9e2ec';
  const fillTone = mode === 'project_overview' ? '#edf2f7' : '#f4f7fa';
  return {
    fillTone,
    lineTone,
    paths: [
      'M12,20 C20,12 35,10 45,16 C55,22 60,30 72,32 C82,34 88,40 88,52 C88,68 76,78 62,82 C50,86 36,88 22,82 C12,78 8,68 10,54 C12,42 8,30 12,20 Z',
      'M20,26 C28,20 38,20 45,24 C52,28 57,32 65,34 C70,36 76,39 78,46 C80,52 76,58 68,62 C58,68 46,72 32,70 C24,69 18,64 16,56 C14,48 14,34 20,26 Z',
    ],
    roads: [
      'M14 62 C28 55, 45 56, 60 48 S82 36, 92 28',
      'M22 15 C30 30, 33 48, 28 84',
    ],
    river: 'M8 44 C18 36, 28 42, 38 36 S58 26, 70 36 S88 62, 95 56',
  };
}

export default function LocatorInset({ layers, insetMode, mode, zone }) {
  const { visibleBounds, referenceBounds } = useMemo(() => {
    const visible = (layers || []).filter((layer) => layer.visible !== false);
    const visibleBounds = unionBounds(visible.map((layer) => geojsonBounds(layer.geojson)).filter(Boolean));
    if (!visibleBounds) return { visibleBounds: null, referenceBounds: null };
    const preset = REFERENCE_PRESETS[insetMode] || REFERENCE_PRESETS.province_state;
    return { visibleBounds, referenceBounds: { ...expandBounds(visibleBounds, preset.expand), label: preset.label } };
  }, [layers, insetMode]);

  const marker = normalize(visibleBounds, referenceBounds);
  const backdrop = buildBackdrop(mode);

  return (
    <div className="template-card inset-card polished" style={zone}>
      <div className="inset-header-row">
        <div className="inset-header">Locator</div>
        <div className="inset-mini-tag">{referenceBounds?.label || 'Context'}</div>
      </div>
      <svg viewBox="0 0 100 100" className="inset-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="locatorBg" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#eef3f8" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" rx="8" fill="url(#locatorBg)" stroke="#d3dce8" />
        {backdrop.paths.map((path, index) => (
          <path key={index} d={path} fill={backdrop.fillTone} stroke="#c9d4df" strokeWidth="0.8" />
        ))}
        {backdrop.roads.map((path, index) => (
          <path key={index} d={path} fill="none" stroke={backdrop.lineTone} strokeWidth="1.4" strokeLinecap="round" />
        ))}
        <path d={backdrop.river} fill="none" stroke="#b5d8f7" strokeWidth="1.8" strokeLinecap="round" />
        {marker ? (
          <>
            <rect
              x={Math.max(8, marker.x)}
              y={Math.max(8, marker.y)}
              width={Math.max(6, marker.w)}
              height={Math.max(6, marker.h)}
              fill="rgba(96,165,250,0.16)"
              stroke="#2563eb"
              strokeWidth="1.5"
              rx="2"
            />
            <circle
              cx={Math.min(92, Math.max(8, marker.x + marker.w / 2))}
              cy={Math.min(92, Math.max(8, marker.y + marker.h / 2))}
              r="2.6"
              fill="#0f2c56"
            />
          </>
        ) : null}
      </svg>
      <div className="inset-mode-label">{referenceBounds?.label || 'Province / State'}</div>
    </div>
  );
}
