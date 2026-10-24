import { downloadBlob } from './svg';

const NS = 'http://www.w3.org/2000/svg';
const WIDTH = 960, SCALE = 2, MAX_HEIGHT = 2048;
const aborted = () => new DOMException('The comparison changed. Download cancelled.', 'AbortError');
const check = current => { if (!current()) throw aborted(); };

// One snapshot's labels only. No current-property lookups or analytical dates.
export function chartProvenance(analysis, manifest, propertyName) {
  const s = analysis.scope;
  return [
    `Property: ${propertyName || 'Name not recorded'} | ID: ${s.propertyId}`,
    `Import: ${s.batchId}`,
    `Group: ${s.sampleType || `CRM ${s.crmId} | revision ${s.crmRevision}`} | lab ${s.labId} | job ${s.labBatchId} | element ${s.element} | exact unit ${s.unit}`,
    `${analysis.eligibleCount} assessed / ${analysis.selectedCount} selected; ${analysis.excludedCount} unassessed. ${manifest.loadedWrittenCount} records written / ${manifest.submittedCount} rows submitted.`,
    'Historical written-import subset only; not a full-file, whole-job or current-property report. Unchanged reimport records remain in earlier imports.',
    manifest.rolledBackAt ? `Rolled back: ${manifest.rolledBackAt}. Historical records shown.` : 'Newer record versions may exist.',
    `Snapshot retrieved: ${manifest.retrievedAt} (not an analysis date).`,
    `File: ${manifest.provenance?.filename || 'Not recorded'}`,
    `File SHA-256: ${manifest.provenance?.sha256 || 'Not recorded'}`,
    `Request fingerprint: ${manifest.requestHash || 'Not recorded'}`,
    'Raw/censored values, exclusions and exact version pins remain in the app evidence table; this PNG is a chart, not the full evidence report.',
  ];
}

// Synchronous by design: DOM + labels are frozen before any image decoding.
export function captureChartPng(svg, { title, lines, filename }) {
  if (!svg || svg.tagName.toLowerCase() !== 'svg') throw new Error('No chart is available to download.');
  const box = svg.getAttribute('viewBox')?.trim().split(/\s+/).map(Number);
  if (box?.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) throw new Error('Chart dimensions are unavailable.');
  // The compact live duplicate plot has little space between long tick labels
  // and the vertical axis title. Add export-only margin, never move its data.
  if (svg.querySelector('[data-export-transform]')) { box[0] -= 24; box[2] += 24; }
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('PNG downloads are unavailable in this browser.');
  measure.font = '16px Arial';
  const wrapped = [];
  for (const value of [title, ...lines]) {
    // Preserve every character, including long IDs/units; never silently truncate.
    let line = '';
    for (const char of String(value)) {
      if (char === '\n') { wrapped.push(line); line = ''; }
      else if (line && measure.measureText(line + char).width > WIDTH - 64) {
        const space = line.lastIndexOf(' ');
        const split = space > 0 ? space + 1 : line.length;
        wrapped.push(line.slice(0, split)); line = line.slice(split);
      }
      if (char !== '\n') line += char;
    }
    wrapped.push(line);
  }
  const chartHeight = Math.min(640, 800 * box[3] / box[2]);
  const chartWidth = chartHeight * box[2] / box[3];
  const height = Math.ceil(64 + chartHeight + wrapped.length * 22);
  if (chartWidth > WIDTH - 64 || height > MAX_HEIGHT) throw new Error('Chart labels exceed the PNG size limit. No labels were omitted.');
  const root = document.createElementNS(NS, 'svg');
  root.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  root.setAttribute('width', WIDTH); root.setAttribute('height', height);
  root.setAttribute('viewBox', `0 0 ${WIDTH} ${height}`);
  const background = document.createElementNS(NS, 'rect');
  background.setAttribute('width', '100%'); background.setAttribute('height', '100%'); background.setAttribute('fill', '#fff'); root.append(background);
  const clone = svg.cloneNode(true);
  clone.setAttribute('viewBox', box.join(' '));
  clone.removeAttribute('style'); clone.setAttribute('x', (WIDTH - chartWidth) / 2); clone.setAttribute('y', '24');
  clone.setAttribute('width', chartWidth); clone.setAttribute('height', chartHeight);
  clone.setAttribute('color', '#172033'); clone.setAttribute('font-family', 'Arial, sans-serif');
  // Long exact units live in wrapped provenance; keep the axes legible without
  // changing coordinates, points or reference lines.
  clone.querySelectorAll('[data-export-label]').forEach(node => { node.textContent = node.getAttribute('data-export-label'); });
  clone.querySelectorAll('[data-export-transform]').forEach(node => { node.setAttribute('transform', node.getAttribute('data-export-transform')); });
  root.append(clone);
  wrapped.forEach((line, i) => {
    const text = document.createElementNS(NS, 'text'); text.setAttribute('x', '32'); text.setAttribute('y', 48 + chartHeight + i * 22);
    text.setAttribute('font-family', 'Arial, sans-serif'); text.setAttribute('font-size', '16'); text.setAttribute('fill', '#172033');
    if (i === 0) text.setAttribute('font-weight', 'bold'); text.textContent = line; root.append(text);
  });
  return { svg: new XMLSerializer().serializeToString(root), width: WIDTH * SCALE, height: height * SCALE, filename };
}

export async function downloadChartPng(capture, isCurrent = () => true) {
  check(isCurrent);
  const canvas = document.createElement('canvas');
  let url;
  try {
    if (capture.width !== WIDTH * SCALE || !Number.isInteger(capture.height) || capture.height <= 0 || capture.height > MAX_HEIGHT * SCALE) throw new Error('PNG dimensions exceed the size limit.');
    url = URL.createObjectURL(new Blob([capture.svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Could not render this chart as PNG.')); img.src = url; });
    check(isCurrent);
    canvas.width = capture.width; canvas.height = capture.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('PNG downloads are unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode this chart as PNG.')), 'image/png'));
    check(isCurrent); downloadBlob(capture.filename, blob);
  } finally { if (url) URL.revokeObjectURL(url); canvas.width = 0; canvas.height = 0; }
}
