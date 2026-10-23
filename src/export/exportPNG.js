import { renderSceneToCanvas, downloadCanvas } from "./renderScene";
import { blobAs } from '../utils/svg';

// The exported figure as a canvas: options.draftOverlay draws the draft mark across it and options.watermarkBand
// ({ client, year }) adds the Exploration Maps band under it (export/watermarkBand.js, loaded only then). Without
// either, exactly the canvas the renderer draws.
export async function figureCanvas(scene, options = {}) {
  const canvas = await renderSceneToCanvas(scene, options);
  if (!options.watermarkBand && !options.draftOverlay) return canvas;
  const band = await import('./watermarkBand.js');
  await band.bandFontsReady();
  if (options.draftOverlay) band.drawDraftOverlay(canvas.getContext('2d'), canvas.width, canvas.height);
  return options.watermarkBand ? band.withWatermarkBand(canvas, options.watermarkBand) : canvas;
}

export async function exportPNG(scene, options = {}) {
  if (!scene?.container || !scene?.map) {
    throw new Error("Map scene is not ready for export.");
  }

  const filename = `${options.filename || scene.project.layout?.exportSettings?.filename || "exploration-maps-export"}.png`;
  const canvas = await figureCanvas(scene, options);
  // options.as (window.EMAP): the PNG, encoded as the download is, comes back instead.
  if (options.as) return blobAs(await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The PNG could not be encoded.'))), 'image/png', 1.0)), options.as);
  downloadCanvas(filename, canvas);
}
