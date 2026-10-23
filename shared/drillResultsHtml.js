import { toTsv } from './drillResults.js';
import { resultsTableSnapshot } from './drillResultsTable.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A portable table, using the calculator's already formatted cells and figure wording.
 * Both clipboard representations retain the recipe provenance, limitations and notes.
 * No calculation, fetching, approval status or external assets are added here.
 */
export function resultsTableDocument(out, recipe, options) {
  const { title, provenance, header, rows, limitations, footnotes } = resultsTableSnapshot(out, recipe, options);
  const cellStyle = 'border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top;';
  const list = (items) => `<ul>${items.map((t) => `<li>${escape(t)}</li>`).join('')}</ul>`;
  const body = `<h1>${escape(title)}</h1>
<p>${escape(provenance)}</p>
${limitations.length ? `<h2>Data limitations</h2>${list(limitations)}` : ''}
<table style="border-collapse:collapse;font-variant-numeric:tabular-nums;">
<caption style="text-align:left;padding:8px 0;">Calculated drill intervals</caption>
<thead><tr>${header.map((c) => `<th scope="col" style="${cellStyle}background:#f1f5f9;">${escape(c)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td style="${cellStyle}">${escape(c)}</td>`).join('')}</tr>`).join('\n')}</tbody>
</table>
<h2>Recipe notes</h2>${list(footnotes)}`;
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body style="font-family:Arial,sans-serif;color:#172033;margin:24px;">${body}</body></html>`,
    text: [title, provenance, ...limitations, '', toTsv([header, ...rows]), '', ...footnotes].join('\n'),
  };
}
