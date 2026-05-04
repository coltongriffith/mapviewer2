import { renderSceneToSvg, downloadSvg } from "./renderScene";

export async function exportSVG(scene, options = {}) {
  if (!scene?.container || !scene?.map) {
    throw new Error("Map scene is not ready for export.");
  }

  const filename = `${options.filename || scene.project.layout?.exportSettings?.filename || "exploration-maps-export"}.svg`;
  const svg = await renderSceneToSvg(scene, options);
  downloadSvg(filename, svg);
}
