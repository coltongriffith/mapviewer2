function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[data-mapviewer-html2canvas="true"]'
    );

    if (existing) {
      existing.addEventListener("load", () => resolve(window.html2canvas), {
        once: true,
      });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load html2canvas.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    script.async = true;
    script.dataset.mapviewerHtml2canvas = "true";

    script.onload = () => {
      if (!window.html2canvas) {
        reject(new Error("html2canvas loaded but unavailable."));
        return;
      }
      resolve(window.html2canvas);
    };

    script.onerror = () =>
      reject(new Error("Failed to load html2canvas."));

    document.head.appendChild(script);
  });
}

function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function waitForTiles() {
  const tiles = document.querySelectorAll(".leaflet-tile");

  if (!tiles.length) return;

  await Promise.all(
    Array.from(tiles).map(
      (tile) =>
        new Promise((resolve) => {
          if (tile.complete) return resolve();
          tile.onload = resolve;
          tile.onerror = resolve;
        })
    )
  );
}

export async function exportPNG(scene, options = {}) {
  const el = document.querySelector(".map-container");
  if (!el) throw new Error("Map container not found.");

  const html2canvas = await loadHtml2Canvas();

  const pixelRatio = options.pixelRatio || 2;
  const filename = options.filename || "map";

  // ensure map fully rendered
  await wait(200);
  await waitForTiles();

  const rect = el.getBoundingClientRect();

  const canvas = await html2canvas(el, {
    useCORS: true,
    backgroundColor: "#ffffff",
    scale: pixelRatio,
    width: rect.width,
    height: rect.height,
    scrollX: 0,
    scrollY: 0,
  });

  const link = document.createElement("a");
  link.download = `${filename}.png`;
  link.href = canvas.toDataURL("image/png", 1.0);
  link.click();
}