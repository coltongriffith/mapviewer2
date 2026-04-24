export const THEME_TOKENS = {
  // ─── Clean Investor Style ───────────────────────────────────────────────────
  // Premium presentation deck: deep navy title block, white panels, soft shadows.
  // No accent bar — the dark title block IS the accent.
  investor_clean: {
    panelRadius: 10,
    panelFill: 'rgba(255,255,255,0.98)',
    panelBorder: 'rgba(148, 163, 184, 0.28)',
    panelShadow: '0 4px 20px rgba(15, 23, 42, 0.09)',
    titleRadius: 10,
    titleFill: '#0c1a35',
    titleBorder: 'rgba(255,255,255,0.10)',
    titleAccent: null,
    titleAccentStyle: null,
    titleText: '#ffffff',
    subtitleText: 'rgba(255,255,255,0.70)',
    panelTitle: '#0f172a',
    bodyText: '#1e293b',
    mutedText: '#64748b',
    footerFill: 'rgba(248,250,252,0.99)',
    footerText: '#475569',
    calloutFill: 'rgba(255,255,255,0.99)',
    calloutBorder: '#2563eb',
    calloutText: '#0f172a',
    northArrowFill: 'rgba(255,255,255,0.98)',
    northArrowText: '#0c1a35',
    scaleFill: 'rgba(255,255,255,0.98)',
    scaleStroke: '#0c1a35',
    insetFill: 'rgba(255,255,255,0.98)',
    insetBorder: 'rgba(148, 163, 184, 0.28)',
    insetTitle: '#0f172a',
    insetMuted: '#64748b',
    logoFill: 'rgba(255,255,255,0.98)',
    logoBorder: 'rgba(148, 163, 184, 0.28)',
    panelAccentLeft: null,
  },

  // ─── Technical Style ────────────────────────────────────────────────────────
  // Survey/engineering feel: zero radius, thick black borders, no shadows.
  // Title block is WHITE with a bold navy LEFT-SIDE accent bar — distinctive.
  // All panels get a matching left accent stripe.
  technical_sharp: {
    panelRadius: 0,
    panelFill: 'rgba(255,255,255,1.0)',
    panelBorder: 'rgba(0,0,0,0.72)',
    panelShadow: 'none',
    titleRadius: 0,
    titleFill: 'rgba(255,255,255,1.0)',
    titleBorder: 'rgba(0,0,0,0.72)',
    titleAccent: '#1a3a6b',
    titleAccentStyle: 'left',
    titleText: '#0a0f1a',
    subtitleText: '#1e3a5f',
    panelTitle: '#0a0f1a',
    bodyText: '#0a0f1a',
    mutedText: '#374151',
    footerFill: 'rgba(240,242,246,1.0)',
    footerText: '#1e293b',
    calloutFill: 'rgba(255,255,255,1.0)',
    calloutBorder: '#0a0f1a',
    calloutText: '#0a0f1a',
    northArrowFill: 'rgba(255,255,255,1.0)',
    northArrowText: '#0a0f1a',
    scaleFill: 'rgba(255,255,255,1.0)',
    scaleStroke: '#0a0f1a',
    insetFill: 'rgba(255,255,255,1.0)',
    insetBorder: 'rgba(0,0,0,0.72)',
    insetTitle: '#0a0f1a',
    insetMuted: '#374151',
    logoFill: 'rgba(255,255,255,1.0)',
    logoBorder: 'rgba(0,0,0,0.72)',
    panelAccentLeft: '#1a3a6b',
  },

  // ─── Dark Modern Style ───────────────────────────────────────────────────────
  // Data visualization / social: deep indigo panels, sky-blue accents, high contrast.
  // Panels glow with a subtle blue border edge.
  modern_dark: {
    panelRadius: 9,
    panelFill: 'rgba(22,33,62,0.97)',
    panelBorder: 'rgba(56,189,248,0.30)',
    panelShadow: '0 8px 32px rgba(0,0,0,0.50)',
    titleRadius: 9,
    titleFill: 'rgba(8,16,36,0.99)',
    titleBorder: 'rgba(56,189,248,0.35)',
    titleAccent: '#38bdf8',
    titleAccentStyle: 'top',
    titleText: '#f0f9ff',
    subtitleText: '#7dd3fc',
    panelTitle: '#e0f2fe',
    bodyText: '#e2e8f0',
    mutedText: '#94a3b8',
    footerFill: 'rgba(8,16,36,0.99)',
    footerText: '#7dd3fc',
    calloutFill: 'rgba(22,33,62,0.97)',
    calloutBorder: '#38bdf8',
    calloutText: '#f0f9ff',
    northArrowFill: 'rgba(22,33,62,0.97)',
    northArrowText: '#f0f9ff',
    scaleFill: 'rgba(22,33,62,0.97)',
    scaleStroke: '#e2e8f0',
    insetFill: 'rgba(22,33,62,0.97)',
    insetBorder: 'rgba(56,189,248,0.30)',
    insetTitle: '#e0f2fe',
    insetMuted: '#94a3b8',
    logoFill: 'rgba(22,33,62,0.97)',
    logoBorder: 'rgba(56,189,248,0.30)',
    panelAccentLeft: null,
  },
};

// Fallback aliases — kept so old stored project themeIds still render
THEME_TOKENS.modern_rounded    = THEME_TOKENS.investor_clean;
THEME_TOKENS.clean_corporate   = THEME_TOKENS.investor_clean;
THEME_TOKENS.technical_science = THEME_TOKENS.technical_sharp;
THEME_TOKENS.government_report = THEME_TOKENS.technical_sharp;
THEME_TOKENS.investor_clean_old = THEME_TOKENS.investor_clean;

export function getThemeTokens(themeId) {
  return THEME_TOKENS[themeId] || THEME_TOKENS.investor_clean;
}
