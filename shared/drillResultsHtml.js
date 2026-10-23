import { notes, tableRows, toTsv } from './drillResults.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A portable table, using the calculator's already formatted cells and figure wording.
 * Both clipboard representations retain the recipe provenance, limitations and notes.
 * No calculation, fetching, approval status or external assets are added here.
 */
export function resultsTableDocument(out, recipe, { propertyName, recipeName, recipeVersion, unsaved = true, warnings = [] } = {}) {
  const title = `${propertyName || 'Property'} — drill results`;
  const provenance = unsaved
    ? `Unsaved recipe: ${recipeName || 'Default'}. Calculated from current assays.`
    : `Saved recipe: ${recipeName || 'Default'}, version ${recipeVersion}. Calculated from current assays.`;
  const rows = tableRows(out.results, out.columns);
  // Name the inclusion column for a standalone table; keep every canonical cell unchanged.
  const header = rows[0].map((c, i) => i === 1 ? 'Type' : c);
  const limitations = [...new Set([...(out.problems || []), ...warnings])];
  const footnotes = notes(recipe, out.eq);
  const cellStyle = 'border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top;';
  const list = (items) => `<ul>${items.map((t) => `<li>${escape(t)}</li>`).join('')}</ul>`;
  const body = `<h1>${escape(title)}</h1>
<p>${escape(provenance)}</p>
${limitations.length ? `<h2>Data limitations</h2>${list(limitations)}` : ''}
<table style="border-collapse:collapse;font-variant-numeric:tabular-nums;">
<caption style="text-align:left;padding:8px 0;">Calculated drill intervals</caption>
<thead><tr>${header.map((c) => `<th scope="col" style="${cellStyle}background:#f1f5f9;">${escape(c)}</th>`).join('')}</tr></thead>
<tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td style="${cellStyle}">${escape(c)}</td>`).join('')}</tr>`).join('\n')}</tbody>
</table>
<h2>Recipe notes</h2>${list(footnotes)}`;
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body style="font-family:Arial,sans-serif;color:#172033;margin:24px;">${body}</body></html>`,
    text: [title, provenance, ...limitations, '', toTsv([header, ...rows.slice(1)]), '', ...footnotes].join('\n'),
  };
}
