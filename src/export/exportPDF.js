import { jsPDF } from "jspdf";
import { renderSceneToCanvas } from "./renderScene";

// Page size presets in inches [width, height]
export const PDF_SIZES = {
  ppt_169:          { label: 'PowerPoint 16:9',      w: 13.33, h: 7.5 },
  letter_landscape: { label: 'Letter Landscape',     w: 11,    h: 8.5 },
  letter_portrait:  { label: 'Letter Portrait',      w: 8.5,   h: 11  },
  a4_landscape:     { label: 'A4 Landscape',         w: 11.69, h: 8.27 },
  a4_portrait:      { label: 'A4 Portrait',          w: 8.27,  h: 11.69 },
  news_release:     { label: 'News Release Figure',  w: 6,     h: 4.5 },
};

export async function exportPDF(scene, options = {}) {
  if (!scene?.container || !scene?.map) {
    throw new Error("Map scene is not ready for export.");
  }

  const sizeKey = options.pdfSize || 'letter_landscape';
  const size = PDF_SIZES[sizeKey] || PDF_SIZES.letter_landscape;
  const orientation = size.w >= size.h ? 'landscape' : 'portrait';

  const pdf = new jsPDF({ orientation, unit: 'in', format: [size.w, size.h] });
  const canvas = await renderSceneToCanvas(scene, options);
  const imgData = canvas.toDataURL('image/jpeg', 0.93);

  // Letterbox: fit the map image within the PDF page preserving its aspect ratio
  const canvasAspect = canvas.width / canvas.height;
  const pageAspect = size.w / size.h;
  let imgW, imgH, imgX, imgY;
  if (canvasAspect > pageAspect) {
    imgW = size.w;
    imgH = size.w / canvasAspect;
    imgX = 0;
    imgY = (size.h - imgH) / 2;
  } else {
    imgH = size.h;
    imgW = size.h * canvasAspect;
    imgX = (size.w - imgW) / 2;
    imgY = 0;
  }
  pdf.addImage(imgData, 'JPEG', imgX, imgY, imgW, imgH);

  const filename = options.filename || scene.project?.layout?.exportSettings?.filename || 'mapviewer-export';
  pdf.save(`${filename}.pdf`);
}
