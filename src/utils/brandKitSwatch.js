import { getThemeTokens } from './themeTokens';

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Renders a clean, legible preview of a brand kit's look — a title strip with
 * the company name and accent bar, the logo (if decoded), a row of the kit's
 * brand-colour chips, and a couple of body lines. Rendered at 2× internally so
 * it stays crisp when shown larger (account cards, the Brand Kit Studio).
 * Returns a PNG data URL. No map render involved.
 */
export function renderBrandKitSwatch(config, { width = 240, height = 150 } = {}) {
  const tokens = getThemeTokens(config?.themeId);
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const accent = config?.accentColor || tokens.titleAccent || '#2563eb';
  const titleBg = config?.titleBgColor || tokens.titleFill || '#0c1a35';
  const titleFg = config?.titleFgColor || tokens.titleText || '#ffffff';
  const panelBg = config?.panelBgColor || tokens.panelFill || '#ffffff';
  const panelFg = config?.panelFgColor || tokens.bodyText || '#1e293b';

  // Panel background
  ctx.fillStyle = panelBg;
  ctx.fillRect(0, 0, width, height);

  // Title strip + accent bar
  const titleH = Math.round(height * 0.30);
  ctx.fillStyle = titleBg;
  ctx.fillRect(0, 0, width, titleH);
  ctx.fillStyle = accent;
  ctx.fillRect(0, titleH, width, 4);
  ctx.fillStyle = titleFg;
  ctx.font = `600 ${Math.round(titleH * 0.32)}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const company = config?.companyName || 'Your Company';
  ctx.fillText(company.length > 22 ? company.slice(0, 21) + '…' : company, 12, Math.round(titleH / 2));

  // Logo (only if already decoded — callers that care pre-decode it)
  let bodyLeft = 14;
  if (config?.logo) {
    try {
      const img = new Image();
      img.src = config.logo;
      const box = Math.round(height * 0.30);
      const x = 14;
      const y = titleH + 14;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, box, box);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.strokeRect(x, y, box, box);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, x, y, box, box);
      bodyLeft = x + box + 12;
    } catch { /* swatch still renders without the logo */ }
  }

  // Body lines (muted)
  ctx.fillStyle = panelFg;
  ctx.globalAlpha = 0.16;
  const lineY = titleH + 18;
  ctx.fillRect(bodyLeft, lineY, width - bodyLeft - 14, 6);
  ctx.fillRect(bodyLeft, lineY + 13, (width - bodyLeft - 14) * 0.62, 6);
  ctx.globalAlpha = 1;

  // Brand-colour chip row along the bottom — makes the palette legible at a glance
  const chips = [accent, titleBg, titleFg, panelBg, panelFg].filter((c) => HEX_RE.test(c || ''));
  const chipSize = Math.round(height * 0.13);
  const gap = 6;
  const totalW = chips.length * chipSize + (chips.length - 1) * gap;
  let cx = Math.round((width - totalW) / 2);
  const cy = height - chipSize - 10;
  chips.forEach((c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    const r = 3;
    ctx.moveTo(cx + r, cy);
    ctx.arcTo(cx + chipSize, cy, cx + chipSize, cy + chipSize, r);
    ctx.arcTo(cx + chipSize, cy + chipSize, cx, cy + chipSize, r);
    ctx.arcTo(cx, cy + chipSize, cx, cy, r);
    ctx.arcTo(cx, cy, cx + chipSize, cy, r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,23,42,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    cx += chipSize + gap;
  });

  return canvas.toDataURL('image/png');
}
