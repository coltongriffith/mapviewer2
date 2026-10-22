// The 2D designer layers ZIP, as /3d's (src/three-d/desk.js): the figure and its parts as separate files at the
// export size, to finish or restyle in a design tool. Loaded only when "Download layers (ZIP)" is pressed.
//
//   figure.png       the export as Export PNG makes it (the watermark band under it when that is on)
//   map.png          the basemap and the data layers only: no labels, annotations, cards or panels
//   annotations.png  everything else on transparency: map labels, annotations, callouts, title, legend, scale,
//                    north arrow, inset, logo and credits. It stacks over map.png to make the figure
//   annotations.svg  (opts.svg) the same annotation layer with live text, to stack over map.png
//   layers.json      what each file is, the size and when it was made
import { zipSync } from 'fflate';
import { renderSceneToCanvas, renderSceneToSvg } from './renderScene';
import { figureCanvas } from './exportPNG';
import { downloadBlob } from '../utils/svg';

export const LAYER_FILES = { figure: 'figure.png', map: 'map.png', annotations: 'annotations.png', svg: 'annotations.svg', about: 'layers.json' };
const NOTE = 'map.png and annotations.png stack (map below) to make figure.png; annotations.png is transparent.';

const pngBytes = (c) => new Promise((resolve, reject) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('The PNG could not be encoded.'))), 'image/png'));

// The ZIP's files, by name, as bytes. opts: the export options (size, credit, background, watermarkBand) and svg.
export async function layerFiles(scene, opts = {}) {
  const figure = await figureCanvas(scene, opts);
  const map = await renderSceneToCanvas(scene, { ...opts, layer: 'map' });
  const notes = await renderSceneToCanvas(scene, { ...opts, layer: 'annotations', background: 'transparent' });
  const files = { [LAYER_FILES.figure]: await pngBytes(figure), [LAYER_FILES.map]: await pngBytes(map), [LAYER_FILES.annotations]: await pngBytes(notes) };
  if (opts.svg) files[LAYER_FILES.svg] = new TextEncoder().encode(await renderSceneToSvg(scene, { ...opts, layer: 'annotations' }));
  const about = {
    note: opts.svg ? `${NOTE} annotations.svg is annotations.png with live text, at the same size.` : NOTE,
    files: Object.keys(files), width: map.width, height: map.height,
    watermarkBand: Boolean(opts.watermarkBand) && 'under figure.png only, so the layers stay the figure\'s size to stack',
    exportedAt: new Date().toISOString(),
  };
  files[LAYER_FILES.about] = new TextEncoder().encode(JSON.stringify(about, null, 2));
  return files;
}

export async function exportLayers(scene, opts = {}) {
  if (!scene?.container || !scene?.map) throw new Error('Map scene is not ready for export.');
  const files = await layerFiles(scene, opts);
  // PNGs are stored, not deflated: they are compressed already.
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, k.endsWith('.png') ? [v, { level: 0 }] : v])));
  const name = opts.filename || scene.project.layout?.exportSettings?.filename || 'exploration-maps-export';
  downloadBlob(`${name}-layers.zip`, new Blob([zip], { type: 'application/zip' }));
  return Object.keys(files);
}
