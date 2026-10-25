import { captureChartPng } from './qaqcChartPng';

// Reuse the reviewed PNG clone's geometry, font and export-only axis padding,
// but keep charts separate from the report's pageable text/evidence blocks.
// This function is synchronous, before any lazy import or image decoding.
export function captureQaqcReportCharts(elements) {
  const charts = {};
  for (const [key, svg] of Object.entries(elements)) {
    if (!svg) continue;
    const png = captureChartPng(svg, { title: '', lines: [], filename: '' });
    const parsed = new DOMParser().parseFromString(png.svg, 'image/svg+xml');
    const clone = parsed.documentElement.querySelector('svg');
    if (parsed.querySelector('parsererror') || !clone) throw new Error('Could not capture the displayed chart. No report was downloaded.');
    const box = clone.getAttribute('viewBox').split(/\s+/).map(Number);
    const width = box[2], height = box[3];
    if (![width, height].every(v => Number.isFinite(v) && v > 0 && v <= 2048)) throw new Error('Chart dimensions exceed the PDF limit. No report was downloaded.');
    clone.removeAttribute('x'); clone.removeAttribute('y');
    // Unlike the PNG, the PDF's full exact unit appears in its scope section.
    clone.querySelectorAll('[data-export-label]').forEach(node => { node.textContent = node.textContent.replace('unit below', 'unit in scope'); });
    // SVG source remains vector; give the image decoder enough raster pixels
    // for a 2x page without retaining a separate chart canvas.
    clone.setAttribute('width', width * 2); clone.setAttribute('height', height * 2);
    const text = new XMLSerializer().serializeToString(clone);
    if (new TextEncoder().encode(text).byteLength > 8 * 1024 * 1024) throw new Error('Chart evidence exceeds the PDF rendering limit. No report was downloaded.');
    charts[key] = { svg: text, width, height };
  }
  return charts;
}

export function measureQaqcReport() {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) throw new Error('PDF downloads are unavailable in this browser.');
  return (text, fontSize, bold) => {
    context.font = `${bold ? 'bold ' : ''}${fontSize}px Arial, sans-serif`;
    return context.measureText(text).width;
  };
}
