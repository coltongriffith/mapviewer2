import { renderSceneToCanvas, downloadCanvas } from "./renderScene";
import { blobAs } from '../utils/svg';

// The exported figure as a canvas: options.watermarkBand ({ client, year }) adds the Exploration Maps band under
// it (export/watermarkBand.js, loaded only then). Without it, exactly the canvas the renderer draws.
export async function figureCanvas(scene, options = {}) {
  const canvas = await renderSceneToCanvas(scene, options);
  if (!options.watermarkBand) return canvas;
  const band = await import('./watermarkBand.js');
  await band.bandFontsReady();
  return band.withWatermarkBand(canvas, options.watermarkBand);
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
