import JSZip from 'jszip';
import { renderSceneToSvg, downloadSvg } from "./renderScene";
import { downloadBlob, blobAs } from '../utils/svg';

export async function exportSVG(scene, options = {}) {
  if (!scene?.container || !scene?.map) {
    throw new Error("Map scene is not ready for export.");
  }

  const baseName = options.filename || scene.project.layout?.exportSettings?.filename || "exploration-maps-export";
  let svg = await renderSceneToSvg(scene, options);
  // The draft mark across the figure and the Exploration Maps band under it, when asked for
  // (export/watermarkBand.js, loaded only then).
  if (options.watermarkBand || options.draftOverlay) {
    const band = await import('./watermarkBand.js');
    await band.bandFontsReady();
    if (options.draftOverlay) svg = band.withDraftOverlaySvg(svg);
    if (options.watermarkBand) svg = band.withWatermarkBandSvg(svg, options.watermarkBand);
  }
  // options.as (window.EMAP): the SVG as the download holds it, returned instead.
  if (options.as) return blobAs(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), options.as);

  if (options.illustratorMode) {
    // Extract the basemap data URI so Illustrator can link it as an external image
    const match = svg.match(/<image href="(data:image\/png;base64,[^"]+)"([^>]*?)\/>/);
    if (!match) {
      // No embedded basemap — just download as a regular SVG
      downloadSvg(`${baseName}.svg`, svg);
      return;
    }
    const dataUrl = match[1];
    const rest = match[2];
    const editedSvg = svg.replace(match[0], `<image href="basemap.png"${rest}/>`);

    // Convert data URI to binary blob
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pngBlob = new Blob([bytes], { type: 'image/png' });

    const zip = new JSZip();
    zip.file(`${baseName}.svg`, editedSvg);
    zip.file('basemap.png', pngBlob);
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    downloadBlob(`${baseName}-illustrator.zip`, zipBlob);
  } else {
    downloadSvg(`${baseName}.svg`, svg);
  }
}
