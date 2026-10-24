import { downloadBlob } from './svg';

const MAX_BYTES = 32 * 1024 * 1024;
const check = current => { if (!current()) throw new DOMException('The comparison changed. Download cancelled.', 'AbortError'); };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

async function drawChart(context, command, chart, current) {
  if (!chart) throw new Error('A captured chart is unavailable. No report was downloaded.');
  let url, image;
  try {
    check(current);
    url = URL.createObjectURL(new Blob([chart.svg], { type: 'image/svg+xml;charset=utf-8' }));
    image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Could not render a report chart. No report was downloaded.')); img.src = url; });
    check(current); context.drawImage(image, command.x, command.y, command.width, command.height);
  } finally { if (url) URL.revokeObjectURL(url); if (image) { image.onload = null; image.onerror = null; image.src = ''; } }
}

// Layout has already been measured in full before this lazy module is loaded.
// One reusable page canvas; decoded chart images are released immediately.
export async function downloadQaqcReportPdf({ layout, charts, filename, generatedAt }, { isCurrent = () => true, onProgress = () => {} } = {}) {
  check(isCurrent);
  if (layout.width !== 792 || layout.height !== 612 || !layout.pages.length || layout.pages.length > 100) throw new Error('This comparison exceeds the PDF limit; no report was downloaded. Review the complete evidence in the app.');
  const { jsPDF } = await import('jspdf'); check(isCurrent);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true });
  pdf.setProperties({ title: 'QA/QC comparison snapshot', subject: 'Historical selected comparison; not a full-file or whole-job report.' });
  pdf.setCreationDate(new Date(generatedAt));
  const canvas = document.createElement('canvas');
  try {
    for (let index = 0; index < layout.pages.length; index++) {
      check(isCurrent); onProgress({ page: index + 1, total: layout.pages.length });
      canvas.width = layout.width * 2; canvas.height = layout.height * 2;
      const context = canvas.getContext('2d'); if (!context) throw new Error('PDF downloads are unavailable in this browser.');
      context.scale(2, 2); context.fillStyle = '#fff'; context.fillRect(0, 0, layout.width, layout.height); context.textBaseline = 'top';
      for (const command of layout.pages[index].commands) {
        check(isCurrent);
        if (command.kind === 'chart') { await drawChart(context, command, charts[command.key], isCurrent); check(isCurrent); }
        else if (command.kind === 'text') {
          context.font = `${command.bold ? 'bold ' : ''}${command.fontSize}px Arial, sans-serif`;
          context.fillStyle = command.color || '#172033'; context.fillText(command.text, command.x, command.y);
        } else throw new Error('A report block could not be rendered. No report was downloaded.');
      }
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not encode a report page. No report was downloaded.')), 'image/png'));
      check(isCurrent); const bytes = new Uint8Array(await blob.arrayBuffer()); check(isCurrent);
      if (index) pdf.addPage('letter', 'landscape');
      pdf.addImage(bytes, 'PNG', 0, 0, layout.width, layout.height);
      await pause(); check(isCurrent);
    }
    const blob = pdf.output('blob'); check(isCurrent);
    if (blob.size > MAX_BYTES) throw new Error('This comparison exceeds the 32 MiB PDF limit; no report was downloaded. Review the complete evidence in the app.');
    downloadBlob(filename, blob);
  } finally { canvas.width = 0; canvas.height = 0; }
}
