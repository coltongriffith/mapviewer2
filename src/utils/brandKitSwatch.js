import { getThemeTokens } from './themeTokens';

/**
 * Renders a small synchronous preview of a brand kit's look — theme background,
 * title strip colors, logo (if any), and accent color. No map render involved.
 * Returns a PNG data URL.
 */
export function renderBrandKitSwatch(config, { width = 240, height = 150 } = {}) {
  const tokens = getThemeTokens(config?.themeId);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Panel background
  ctx.fillStyle = config?.panelBgColor || tokens.panelFill || '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Title strip
  const titleH = Math.round(height * 0.28);
  ctx.fillStyle = config?.titleBgColor || tokens.titleFill || '#0c1a35';
  ctx.fillRect(0, 0, width, titleH);
  ctx.fillStyle = config?.titleFgColor || tokens.titleText || '#ffffff';
  ctx.font = `600 ${Math.round(titleH * 0.34)}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(config?.companyName || 'Project Title', 10, Math.round(titleH / 2));

  // Accent bar
  ctx.fillStyle = config?.accentColor || tokens.titleAccent || '#2563eb';
  ctx.fillRect(0, titleH, width, 4);

  // Logo, positioned by logoCorner
  if (config?.logo) {
    try {
      const img = new Image();
      img.src = config.logo;
      const logoSize = Math.round(height * 0.32);
      const margin = 8;
      let x = margin;
      let y = titleH + margin + 4;
      if (typeof config.logoCorner === 'string' && config.logoCorner.includes('right')) {
        x = width - logoSize - margin;
      }
      if (typeof config.logoCorner === 'string' && config.logoCorner.includes('bottom')) {
        y = height - logoSize - margin;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, logoSize, logoSize);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.strokeRect(x, y, logoSize, logoSize);
      if (img.complete && img.naturalWidth) {
        ctx.drawImage(img, x, y, logoSize, logoSize);
      }
    } catch {
      // ignore logo draw failures — swatch still renders without it
    }
  }

  // Body placeholder lines
  ctx.fillStyle = config?.panelFgColor || tokens.bodyText || '#1e293b';
  ctx.globalAlpha = 0.18;
  const lineY = titleH + 24;
  ctx.fillRect(10, lineY, width - 20, 6);
  ctx.fillRect(10, lineY + 14, width * 0.6, 6);
  ctx.globalAlpha = 1;

  return canvas.toDataURL('image/png');
}
