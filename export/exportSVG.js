function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mapviewer-html2canvas="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.html2canvas), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load html2canvas.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    script.async = true;
    script.dataset.mapviewerHtml2canvas = "true";
    script.onload = () => {
      if (!window.html2canvas) {
        reject(new Error("html2canvas loaded but unavailable."));
        return;
      }
      resolve(window.html2canvas);
    };
    script.onerror = () => reject(new Error("Failed to load html2canvas."));
    document.head.appendChild(script);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTiles(root) {
  const tiles = root?.querySelectorAll?.(".leaflet-tile") || [];
  if (!tiles.length) return;
  await Promise.all(
    Array.from(tiles).map(
      (tile) =>
        new Promise((resolve) => {
          if (tile.complete) {
            resolve();
            return;
          }
          tile.addEventListener("load", resolve, { once: true });
          tile.addEventListener("error", resolve, { once: true });
        })
    )
  );
}

export async function exportSVG(scene, options = {}) {
  const el = scene?.container || document.querySelector(".map-container");
  if (!el) throw new Error("Map container not found.");

  const html2canvas = await loadHtml2Canvas();
  const filename = options.filename || scene?.project?.exportSettings?.filename || "map-export";
  const scale = Number(options.pixelRatio || scene?.project?.exportSettings?.pixelRatio || 2);

  await wait(250);
  await waitForTiles(el);

  const canvas = await html2canvas(el, {
    useCORS: true,
    allowTaint: false,
    backgroundColor: "#ffffff",
    scale,
    scrollX: 0,
    scrollY: 0,
    width: scene?.width,
    height: scene?.height,
    logging: false,
  });

  const png = canvas.toDataURL("image/png", 1.0);
  const width = canvas.width;
  const height = canvas.height;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${png}" width="${width}" height="${height}" />
</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `${filename}.svg`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
