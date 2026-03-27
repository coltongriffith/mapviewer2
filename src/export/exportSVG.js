export function exportSVG(scene) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">
  <rect width="100%" height="100%" fill="#e5e5e5"/>
  <text x="20" y="40" font-size="20" font-family="Arial">SVG Export Ready</text>
</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "map.svg";
  a.click();
  URL.revokeObjectURL(url);
}
