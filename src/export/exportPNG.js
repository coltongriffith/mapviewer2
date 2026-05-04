import { renderSceneToCanvas, downloadCanvas } from "./renderScene";

export async function exportPNG(scene, options = {}) {
  if (!scene?.container || !scene?.map) {
    throw new Error("Map scene is not ready for export.");
  }

  const filename = `${options.filename || scene.project.layout?.exportSettings?.filename || "exploration-maps-export"}.png`;
  const canvas = await renderSceneToCanvas(scene, options);
  downloadCanvas(filename, canvas);
}
