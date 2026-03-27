export function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function svgNodeToDataUrl(svgNode) {
  const serializer = new XMLSerializer();
  let svgText = serializer.serializeToString(svgNode);

  if (!svgText.includes('xmlns="http://www.w3.org/2000/svg"')) {
    svgText = svgText.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!svgText.includes('xmlns:xlink="http://www.w3.org/1999/xlink"')) {
    svgText = svgText.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

export function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
