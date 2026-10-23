import { renderSceneToCanvas, downloadCanvas } from "./renderScene";

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
  downloadCanvas(filename, canvas);
}
