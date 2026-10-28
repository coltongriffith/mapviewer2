/* ExplorationMaps · 3D Tour — HTML export
 * template: viewer/tour-template.html (contains __THREE__ and __DATA__ placeholders)
 * three:    contents of node_modules/three/build/three.min.js (pinned three@0.149.0 — last UMD-friendly line)
 * In Vite:  import template from './tour-template.html?raw'; import three from 'three/build/three.min.js?raw';
 */
import type { TourPackage } from './types';

export function exportTourHtml(pkg: TourPackage, template: string, three: string): string {
  if (!template.includes('__THREE__') || !template.includes('__DATA__')) throw new Error('Tour template is unavailable.');
  const data = JSON.stringify(pkg).replace(/</g, '\\u003c');           // safe inside <script>
  return template
    .replace('__THREE__', () => three.replace(/<\/script/gi, '<\\/script'))
    .replace('__DATA__', () => data);
}

/** Browser download helper */
export function downloadTour(html: string, filename = 'tour.html') {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** iframe snippet for client websites (WordPress: Custom HTML block) */
export const embedSnippet = (slug: string, height = 720) =>
  `<iframe src="https://www.explorationmaps.com/3d/${encodeURIComponent(slug)}" title="Interactive 3D model" style="width:100%;height:${Number.isFinite(height) ? Math.min(2000,Math.max(240,Math.round(height))) : 720}px;border:0;display:block" loading="lazy" allow="fullscreen"></iframe>`;
