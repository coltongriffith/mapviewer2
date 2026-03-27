import { renderSceneToSvg, downloadSvg } from "./renderScene";

export async function exportSVG(scene, options = {}) {
  if (!scene?.container || !scene?.map) {
    throw new Error("Map scene is not ready for export.");
  }

  const filename = `${options.filename || scene.project.layout?.exportSettings?.filename || "mapviewer-export"}.svg`;
  const svg = renderSceneToSvg(scene, options);
  downloadSvg(filename, svg);
}
