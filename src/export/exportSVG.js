import { loadHtml2Canvas } from "./exportPNG";

export async function exportSVG(scene, options = {}) {
  const el = scene?.container || document.querySelector(".map-container");
  if (!el) throw new Error("Map container not found.");

  const html2canvas = await loadHtml2Canvas();
  const filename = options.filename || "map";

  const canvas = await html2canvas(el, {
    useCORS: true,
    allowTaint: false,
    backgroundColor: "#ffffff",
    scale: 2,
  });

  const imageData = canvas.toDataURL("image/png");
  const width = scene?.width || el.clientWidth;
  const height = scene?.height || el.clientHeight;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${imageData}" width="${width}" height="${height}"/>
</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}
