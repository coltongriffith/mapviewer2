/**
 * Captures a small JPEG thumbnail of the current map/project using the same
 * scene-render pipeline as PNG export, at a low pixel ratio. Never throws —
 * returns null on any failure so it can be safely fired-and-forgotten after a save.
 *
 * The scene/render modules are imported dynamically: this file is statically
 * imported by App.jsx, and a static import chain here would drag the entire
 * export pipeline (~½ MB pre-gzip) into the main bundle. Thumbnails happen
 * after saves — never on the critical path — so lazy loading costs nothing.
 */
export async function captureProjectThumbnail({ mapContainer, project, map, maxWidth = 320, maxHeight = 200 }) {
  try {
    if (!mapContainer || !project || !map) return null;
    const [{ buildScene }, { renderSceneToCanvas }] = await Promise.all([
      import('../export/buildScene'),
      import('../export/renderScene'),
    ]);
    const scene = buildScene(mapContainer, project, map);
    if (!scene.width || !scene.height) return null;

    const fitScale = Math.min(maxWidth / scene.width, maxHeight / scene.height);
    const canvas = await renderSceneToCanvas(scene, { pixelRatio: fitScale, noWatermark: true });

    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}
