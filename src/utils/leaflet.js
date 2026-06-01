import L from 'leaflet';

export function makeMarkerIcon(type, color, size = 14, fillColor = null) {
  const s = size;
  const h = s / 2;
  const fc = fillColor || color;
  const sc = color;
  let inner = '';

  if (type === 'circle') {
    inner = `<circle cx="${h}" cy="${h}" r="${h - 1}" fill="${fc}" stroke="${sc}" stroke-width="1.2"/>`;
  } else if (type === 'drillhole') {
    inner = `<polygon points="${h},${s - 1} 1,1 ${s - 1},1" fill="${fc}" stroke="${sc}" stroke-width="1"/><line x1="${h}" y1="0" x2="${h}" y2="${s}" stroke="${sc}" stroke-width="2"/>`;
  } else if (type === 'diamond') {
    inner = `<polygon points="${h},1 ${s - 1},${h} ${h},${s - 1} 1,${h}" fill="${fc}" stroke="${sc}" stroke-width="1"/>`;
  } else if (type === 'square') {
    inner = `<rect x="2" y="2" width="${s - 4}" height="${s - 4}" fill="${fc}" stroke="${sc}" stroke-width="1.5"/>`;
  } else if (type === 'triangle') {
    inner = `<polygon points="${h},1 ${s - 1},${s - 1} 1,${s - 1}" fill="${fc}" stroke="${sc}" stroke-width="1"/>`;
  } else if (type === 'cross') {
    inner = `<line x1="${h}" y1="1" x2="${h}" y2="${s - 1}" stroke="${sc}" stroke-width="2"/><line x1="1" y1="${h}" x2="${s - 1}" y2="${h}" stroke="${sc}" stroke-width="2"/>`;
  } else if (type === 'triangle_down') {
    inner = `<polygon points="${h},${s - 1} 1,1 ${s - 1},1" fill="${fc}" stroke="${sc}" stroke-width="1"/>`;
  } else if (type === 'star') {
    const r1 = h - 1; const r2 = (h - 1) * 0.45;
    const pts = Array.from({ length: 10 }, (_, i) => { const a = (i * Math.PI) / 5 - Math.PI / 2; const r = i % 2 === 0 ? r1 : r2; return `${h + r * Math.cos(a)},${h + r * Math.sin(a)}`; }).join(' ');
    inner = `<polygon points="${pts}" fill="${fc}" stroke="${sc}" stroke-width="1"/>`;
  } else if (type === 'hexagon') {
    const r = h - 1;
    const pts = Array.from({ length: 6 }, (_, i) => { const a = (i * Math.PI) / 3 - Math.PI / 2; return `${(h + r * Math.cos(a)).toFixed(1)},${(h + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
    inner = `<polygon points="${pts}" fill="${fc}" stroke="${sc}" stroke-width="1"/>`;
  } else if (type === 'pin') {
    const cr = h * 0.58; const cy2 = h * 0.72;
    inner = `<circle cx="${h}" cy="${cy2}" r="${cr}" fill="${fc}" stroke="${sc}" stroke-width="1.2"/><polygon points="${h - cr * 0.55},${cy2 + cr * 0.4} ${h + cr * 0.55},${cy2 + cr * 0.4} ${h},${s - 1}" fill="${fc}" stroke="${sc}" stroke-width="1.2" stroke-linejoin="round"/>`;
  }

  return L.icon({
    iconUrl: `data:image/svg+xml;base64,${btoa(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${inner}</svg>`
    )}`,
    iconSize: [s, s],
    iconAnchor: [h, h],
    popupAnchor: [0, -h - 2],
  });
}

export function markerSvgUrl(type, color, size = 16) {
  const s = size;
  const h = s / 2;
  let inner = '';

  if (type === 'circle') {
    inner = `<circle cx="${h}" cy="${h}" r="${h - 1}" fill="${color}" stroke="#444" stroke-width="0.8"/>`;
  } else if (type === 'drillhole') {
    inner = `<polygon points="${h},${s - 2} 2,2 ${s - 2},2" fill="${color}" stroke="#444" stroke-width="1"/><line x1="${h}" y1="0" x2="${h}" y2="${s}" stroke="${color}" stroke-width="1.5"/>`;
  } else if (type === 'diamond') {
    inner = `<polygon points="${h},1 ${s - 1},${h} ${h},${s - 1} 1,${h}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  } else if (type === 'square') {
    inner = `<rect x="2" y="2" width="${s - 4}" height="${s - 4}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  } else if (type === 'triangle') {
    inner = `<polygon points="${h},1 ${s - 1},${s - 1} 1,${s - 1}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  } else if (type === 'cross') {
    inner = `<line x1="${h}" y1="1" x2="${h}" y2="${s - 1}" stroke="${color}" stroke-width="2"/><line x1="1" y1="${h}" x2="${s - 1}" y2="${h}" stroke="${color}" stroke-width="2"/>`;
  } else if (type === 'triangle_down') {
    inner = `<polygon points="${h},${s - 1} 1,1 ${s - 1},1" fill="${color}" stroke="#444" stroke-width="1"/>`;
  } else if (type === 'star') {
    const r1 = h - 1; const r2 = (h - 1) * 0.45;
    const pts = Array.from({ length: 10 }, (_, i) => { const a = (i * Math.PI) / 5 - Math.PI / 2; const r = i % 2 === 0 ? r1 : r2; return `${h + r * Math.cos(a)},${h + r * Math.sin(a)}`; }).join(' ');
    inner = `<polygon points="${pts}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  } else if (type === 'hexagon') {
    const r = h - 1;
    const pts = Array.from({ length: 6 }, (_, i) => { const a = (i * Math.PI) / 3 - Math.PI / 2; return `${(h + r * Math.cos(a)).toFixed(1)},${(h + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
    inner = `<polygon points="${pts}" fill="${color}" stroke="#444" stroke-width="1"/>`;
  } else if (type === 'pin') {
    const cr = h * 0.58; const cy2 = h * 0.72;
    inner = `<circle cx="${h}" cy="${cy2}" r="${cr}" fill="${color}" stroke="#444" stroke-width="1"/><polygon points="${h - cr * 0.55},${cy2 + cr * 0.4} ${h + cr * 0.55},${cy2 + cr * 0.4} ${h},${s - 1}" fill="${color}" stroke="#444" stroke-width="1" stroke-linejoin="round"/>`;
  }

  return `data:image/svg+xml;base64,${btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">${inner}</svg>`
  )}`;
}
