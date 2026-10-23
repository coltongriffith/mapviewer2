import { resultsTableSnapshot } from '../../shared/drillResultsTable.js';
import { layoutResultsPages, RESULTS_PAGE } from '../../shared/drillResultsPages.js';
import { zipSync } from 'fflate';

const font = (size, bold) => `${bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
export function drawResultsPage(canvas, page, number, total) {
  const { width, height, margin, lineHeight } = RESULTS_PAGE;
  canvas.width = width * 2; canvas.height = height * 2;
  const g = canvas.getContext('2d'); g.scale(2, 2);
  g.fillStyle = '#fff'; g.fillRect(0, 0, width, height); g.textBaseline = 'top';
  const text = (lines, x, y, size = 10, bold = false, color = '#172033', spacing = lineHeight) => {
    g.font = font(size, bold); g.fillStyle = color;
    lines.forEach((line, i) => g.fillText(line, x, y + i * spacing));
  };
  for (const b of page.blocks) {
    if (b.kind === 'text') { text(b.lines, b.x, b.y, b.size, b.bold, b.color, b.lineHeight); continue; }
    let x = b.x;
    b.cells.forEach((lines, i) => {
      g.fillStyle = b.header ? '#e2e8f0' : b.shaded ? '#f8fafc' : '#fff';
      g.fillRect(x, b.y, b.widths[i], b.height);
      g.strokeStyle = '#cbd5e1'; g.lineWidth = 0.5; g.strokeRect(x, b.y, b.widths[i], b.height);
      text(lines, x + 6, b.y + 6, 10, b.header); x += b.widths[i];
    });
  }
  text([`Page ${number} of ${total} | Read with data limitations and recipe notes.`], margin, height - margin, 9, false, '#475569');
}

// One canvas at a time. No remote fonts/assets or HTML rendering; user text is literal.
export async function resultsTablePages(out, recipe, options, format) {
  if (!['png', 'pdf'].includes(format)) throw new Error('Unsupported table format.');
  const snapshot = resultsTableSnapshot(out, recipe, options);
  const canvas = document.createElement('canvas'), g = canvas.getContext('2d');
  const pages = layoutResultsPages(snapshot, (text, size, bold) => { g.font = font(size, bold); return g.measureText(text).width; });
  const pdf = format === 'pdf' ? new (await import('jspdf')).jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true }) : null;
  if (pdf) pdf.setProperties({ title: snapshot.title, subject: snapshot.provenance });
  const files = {}; let single;
  try {
    for (let i = 0; i < pages.length; i++) {
      drawResultsPage(canvas, pages[i], i + 1, pages.length);
      if (pdf) {
        if (i) pdf.addPage('letter', 'landscape');
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, RESULTS_PAGE.width, RESULTS_PAGE.height);
      } else {
        single = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create table image.')), 'image/png'));
        if (pages.length > 1) files[`results-page-${String(i + 1).padStart(3, '0')}.png`] = new Uint8Array(await single.arrayBuffer());
      }
      // Let the progress message paint and keep large exports responsive.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (pdf) return { blob: pdf.output('blob'), extension: 'pdf', pages: pages.length };
    if (pages.length === 1) return { blob: single, extension: 'png', pages: 1 };
    // PNGs are already compressed. Reuse the existing ZIP writer without adding
    // an async compression worker to the shared editor dependency.
    const bytes = zipSync(files, { level: 0 });
    return { blob: new Blob([bytes], { type: 'application/zip' }), extension: 'zip', pages: pages.length };
  } finally { canvas.width = 0; canvas.height = 0; }
}
