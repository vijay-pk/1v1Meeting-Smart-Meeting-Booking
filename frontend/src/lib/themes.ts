/**
 * Public booking page themes.
 *
 * Each theme is a set of design tokens for a light and a dark variant, applied as CSS variables on
 * the page wrapper only (never on <html>), so the admin dashboard's own dark mode and every other
 * user are unaffected. The page reads the variables through the `.bm-*` classes in index.css.
 *
 * Compatibility with what admins already saved:
 *   - `theme_settings` stays {theme?, bg_gradient, button_color, button_text_color, ...}.
 *   - The five original presets keep their ids, `bg_gradient` and `button_color`, so a saved choice
 *     still resolves to the same theme (matched on bg_gradient first, because the stored `theme` id
 *     was never reliably written by the old settings screen).
 *   - Every theme also carries a `bg_gradient` Tailwind string and `button_color`. The schedule and
 *     checkout pages still paint their header from those, over a gradient that is dark enough for
 *     their white text, so they stay legible whatever theme is chosen.
 */
export type ThemeMode = 'light' | 'dark';

export interface ModeTokens {
  /** Page background (any CSS background value). */
  bg: string;
  /** Text drawn directly on the page background (header, footer). */
  onBg: string;
  onBgMuted: string;
  /** Surfaces. */
  card: string;
  border: string;
  text: string;
  muted: string;
  chip: string;
  /** Accent tint (badges, icon chips) and the ink drawn on it. */
  soft: string;
  ink: string;
  shadow: string;
  /** Backdrop blur in px for glass surfaces (0 = none). */
  blur: number;
}

export interface BookingTheme {
  id: string;
  name: string;
  /** The mode shown first; the visitor can switch. */
  native: ThemeMode;
  /** Solid accent used for primary buttons (and what `button_color` holds). */
  accent: string;
  /** Button background; may be a gradient. */
  accentBg: string;
  accentText: string;
  display?: string;
  light: ModeTokens;
  dark: ModeTokens;
  /** Compatibility with the saved settings and the older public pages. */
  bg_gradient: string;
  button_color: string;
  /** Swatch for the admin picker. */
  preview_bg: string;
}

const SANS = "'Inter', system-ui, sans-serif";
const SERIF = "'Playfair Display', 'Georgia', 'Times New Roman', serif";
const MONO = "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace";

const SH_LIGHT = '0 1px 2px rgba(15,23,42,.06), 0 8px 24px -8px rgba(15,23,42,.12)';
const SH_DARK = '0 1px 2px rgba(0,0,0,.4), 0 10px 30px -10px rgba(0,0,0,.6)';

const lightBase = { onBg: '#0f172a', onBgMuted: '#475569', card: '#ffffff', border: 'rgba(15,23,42,.09)', text: '#0f172a', muted: '#475569', chip: '#f1f5f9', shadow: SH_LIGHT, blur: 0 };
const darkBase = { onBg: '#f8fafc', onBgMuted: '#94a3b8', card: '#111827', border: 'rgba(255,255,255,.10)', text: '#f8fafc', muted: '#9ca3af', chip: 'rgba(255,255,255,.07)', shadow: SH_DARK, blur: 0 };

export const THEMES: BookingTheme[] = [
  // ---- The five original presets, upgraded (same ids, gradients and button colours) ----------
  {
    id: 'amber', name: 'Sunset Amber (SuperProfile)', native: 'light', accent: '#D32F2F', accentBg: 'linear-gradient(135deg,#D32F2F,#B71C1C)', accentText: '#ffffff',
    light: { ...lightBase, bg: 'linear-gradient(165deg,#873600 0%,#A04000 48%,#6E2C00 100%)', onBg: '#ffffff', onBgMuted: 'rgba(255,255,255,.8)', soft: '#FDECEA', ink: '#B71C1C' },
    dark: { ...darkBase, bg: 'linear-gradient(165deg,#2a1204 0%,#3b1a06 55%,#1c0b02 100%)', card: '#1f1410', soft: 'rgba(229,57,53,.18)', ink: '#ff8a80' },
    bg_gradient: 'from-[#873600] via-[#A04000] to-[#6E2C00]', button_color: '#D32F2F', preview_bg: 'bg-gradient-to-r from-[#873600] to-[#D32F2F]',
  },
  {
    id: 'indigo', name: 'Deep Indigo (High Tech)', native: 'light', accent: '#4f46e5', accentBg: 'linear-gradient(135deg,#4f46e5,#4338ca)', accentText: '#ffffff',
    light: { ...lightBase, bg: 'linear-gradient(165deg,#1e1b4b 0%,#312e81 55%,#0f172a 100%)', onBg: '#ffffff', onBgMuted: 'rgba(255,255,255,.78)', soft: '#eef2ff', ink: '#4338ca' },
    dark: { ...darkBase, bg: 'linear-gradient(165deg,#0b0a24 0%,#15124a 55%,#050816 100%)', card: '#14152e', soft: 'rgba(99,102,241,.2)', ink: '#a5b4fc' },
    bg_gradient: 'from-[#1e1b4b] via-[#312e81] to-[#0f172a]', button_color: '#4f46e5', preview_bg: 'bg-gradient-to-r from-[#1e1b4b] to-[#4f46e5]',
  },
  {
    id: 'emerald', name: 'Emerald Growth (Consulting)', native: 'light', accent: '#059669', accentBg: 'linear-gradient(135deg,#047857,#065f46)', accentText: '#ffffff',
    light: { ...lightBase, bg: 'linear-gradient(165deg,#064e3b 0%,#047857 55%,#022c22 100%)', onBg: '#ffffff', onBgMuted: 'rgba(255,255,255,.92)', soft: '#ecfdf5', ink: '#047857' },
    dark: { ...darkBase, bg: 'linear-gradient(165deg,#03231a 0%,#05382a 55%,#011510 100%)', card: '#0f1f1a', soft: 'rgba(16,185,129,.18)', ink: '#6ee7b7' },
    bg_gradient: 'from-[#064e3b] via-[#047857] to-[#022c22]', button_color: '#059669', preview_bg: 'bg-gradient-to-r from-[#064e3b] to-[#059669]',
  },
  {
    id: 'slate', name: 'Sleek Minimal Dark', native: 'dark', accent: '#ea580c', accentBg: 'linear-gradient(135deg,#c2410c,#9a3412)', accentText: '#ffffff',
    light: { ...lightBase, bg: 'linear-gradient(165deg,#0b1220 0%,#111827 55%,#0b1220 100%)', onBg: '#ffffff', onBgMuted: 'rgba(255,255,255,.75)', soft: '#fff1e6', ink: '#c2410c' },
    dark: { ...darkBase, bg: 'linear-gradient(165deg,#020617 0%,#0f172a 55%,#020617 100%)', card: '#0f172a', soft: 'rgba(234,88,12,.18)', ink: '#fdba74' },
    bg_gradient: 'from-slate-950 via-slate-900 to-slate-950', button_color: '#ea580c', preview_bg: 'bg-gradient-to-r from-slate-950 to-orange-600',
  },
  {
    id: 'rose', name: 'Crimson Executive', native: 'light', accent: '#e11d48', accentBg: 'linear-gradient(135deg,#be123c,#9f1239)', accentText: '#ffffff',
    light: { ...lightBase, bg: 'linear-gradient(165deg,#881337 0%,#9f1239 55%,#4c0519 100%)', onBg: '#ffffff', onBgMuted: 'rgba(255,255,255,.8)', soft: '#fff1f2', ink: '#be123c' },
    dark: { ...darkBase, bg: 'linear-gradient(165deg,#2a0610 0%,#3d0a18 55%,#18030a 100%)', card: '#1f1013', soft: 'rgba(244,63,94,.18)', ink: '#fda4af' },
    bg_gradient: 'from-[#881337] via-[#9f1239] to-[#4c0519]', button_color: '#e11d48', preview_bg: 'bg-gradient-to-r from-[#881337] to-[#e11d48]',
  },

  // ---- New premium themes ---------------------------------------------------------------------
  {
    id: 'premium-orange', name: 'Premium Orange', native: 'light', accent: '#ea580c', accentBg: 'linear-gradient(135deg,#c2410c,#9a3412)', accentText: '#ffffff', display: SANS,
    light: { ...lightBase, bg: 'linear-gradient(180deg,#fff7ed 0%,#ffedd5 100%)', soft: '#ffedd5', ink: '#c2410c', border: 'rgba(194,65,12,.14)', chip: '#fff1e0' },
    dark: { ...darkBase, bg: 'linear-gradient(180deg,#1a0f08 0%,#2a1608 100%)', card: '#241710', soft: 'rgba(251,146,60,.18)', ink: '#fdba74' },
    bg_gradient: 'from-[#C2410C] via-[#EA580C] to-[#9A3412]', button_color: '#ea580c', preview_bg: 'bg-gradient-to-r from-[#fff7ed] to-[#ea580c]',
  },
  {
    id: 'midnight-luxury', name: 'Midnight Luxury', native: 'dark', accent: '#d4af37', accentBg: 'linear-gradient(135deg,#f0d27a,#b8901f)', accentText: '#1a1405', display: SERIF,
    light: { ...lightBase, bg: 'linear-gradient(180deg,#faf6ea 0%,#f1e8cc 100%)', card: '#fffdf6', soft: '#f6edc8', ink: '#7a5c08', border: 'rgba(122,92,8,.2)', chip: '#f6f0dc' },
    dark: { ...darkBase, bg: 'radial-gradient(1200px 600px at 20% -10%,#1d1a12 0%,#0b0b0d 55%,#000 100%)', onBgMuted: '#a8a291', card: 'rgba(255,255,255,.05)', border: 'rgba(212,175,55,.28)', muted: '#b8b3a3', chip: 'rgba(212,175,55,.1)', soft: 'rgba(212,175,55,.16)', ink: '#f0d27a', blur: 14 },
    bg_gradient: 'from-[#0a0a0a] via-[#1a160b] to-[#000000]', button_color: '#d4af37', preview_bg: 'bg-gradient-to-r from-[#0a0a0a] to-[#d4af37]',
  },
  {
    id: 'modern-indigo', name: 'Modern Indigo', native: 'light', accent: '#6366f1', accentBg: 'linear-gradient(135deg,#4f46e5,#7c3aed)', accentText: '#ffffff',
    light: { ...lightBase, bg: 'linear-gradient(180deg,#f8f9ff 0%,#eef0ff 100%)', soft: '#e9e8ff', ink: '#4338ca', border: 'rgba(79,70,229,.14)', chip: '#f0f1ff' },
    dark: { ...darkBase, bg: 'linear-gradient(180deg,#0c0d1f 0%,#14153a 100%)', card: '#15163a', soft: 'rgba(139,92,246,.2)', ink: '#c4b5fd' },
    bg_gradient: 'from-[#4338ca] via-[#6d28d9] to-[#312e81]', button_color: '#6366f1', preview_bg: 'bg-gradient-to-r from-[#eef0ff] to-[#7c3aed]',
  },
  {
    id: 'emerald-professional', name: 'Emerald Professional', native: 'light', accent: '#059669', accentBg: 'linear-gradient(135deg,#047857,#065f46)', accentText: '#ffffff',
    light: { ...lightBase, bg: 'linear-gradient(180deg,#f7fdf9 0%,#ecf8f1 100%)', soft: '#d9f3e5', ink: '#047857', border: 'rgba(5,150,105,.2)', chip: '#eef8f2' },
    dark: { ...darkBase, bg: 'linear-gradient(180deg,#071410 0%,#0b1f19 100%)', card: '#0e201a', soft: 'rgba(16,185,129,.18)', ink: '#6ee7b7' },
    bg_gradient: 'from-[#065f46] via-[#059669] to-[#064e3b]', button_color: '#059669', preview_bg: 'bg-gradient-to-r from-[#ecf8f1] to-[#059669]',
  },
  {
    id: 'ocean-blue', name: 'Ocean Blue', native: 'light', accent: '#0284c7', accentBg: 'linear-gradient(135deg,#0369a1,#075985)', accentText: '#ffffff',
    light: { ...lightBase, bg: 'linear-gradient(180deg,#f0f9ff 0%,#e0f2fe 100%)', soft: '#d7ecfb', ink: '#0369a1', border: 'rgba(2,132,199,.16)', chip: '#e8f4fd' },
    dark: { ...darkBase, bg: 'linear-gradient(180deg,#06121c 0%,#0a2236 100%)', card: '#0c2133', soft: 'rgba(56,189,248,.18)', ink: '#7dd3fc' },
    bg_gradient: 'from-[#0369a1] via-[#0284c7] to-[#075985]', button_color: '#0284c7', preview_bg: 'bg-gradient-to-r from-[#e0f2fe] to-[#0284c7]',
  },
  {
    id: 'minimalist', name: 'Minimalist Premium', native: 'light', accent: '#111111', accentBg: '#111111', accentText: '#ffffff', display: SERIF,
    light: { ...lightBase, bg: '#fafafa', card: '#ffffff', border: 'rgba(0,0,0,.08)', soft: '#f1f1f1', ink: '#111111', chip: '#f4f4f4', shadow: '0 1px 2px rgba(0,0,0,.04)', muted: '#555555' },
    dark: { ...darkBase, bg: '#0b0b0b', card: '#141414', border: 'rgba(255,255,255,.1)', soft: 'rgba(255,255,255,.08)', ink: '#f5f5f5', shadow: 'none' },
    bg_gradient: 'from-neutral-900 via-neutral-800 to-neutral-900', button_color: '#111111', preview_bg: 'bg-gradient-to-r from-neutral-100 to-neutral-900',
  },
  {
    id: 'glassmorphism', name: 'Glassmorphism', native: 'light', accent: '#7c3aed', accentBg: 'linear-gradient(135deg,#7c3aed,#be185d)', accentText: '#ffffff',
    light: { ...lightBase, bg: 'radial-gradient(900px 500px at 10% 0%,#c4b5fd 0%,transparent 60%),radial-gradient(800px 500px at 100% 20%,#f9a8d4 0%,transparent 55%),linear-gradient(180deg,#eef2ff,#fdf2f8)', card: 'rgba(255,255,255,.62)', border: 'rgba(255,255,255,.7)', soft: 'rgba(124,58,237,.12)', ink: '#5b21b6', chip: 'rgba(255,255,255,.6)', onBgMuted: '#1e293b', muted: '#334155', blur: 16 },
    dark: { ...darkBase, bg: 'radial-gradient(900px 500px at 10% 0%,#4c1d95 0%,transparent 60%),radial-gradient(800px 500px at 100% 20%,#831843 0%,transparent 55%),linear-gradient(180deg,#0b0820,#12081c)', card: 'rgba(255,255,255,.07)', border: 'rgba(255,255,255,.16)', soft: 'rgba(167,139,250,.2)', ink: '#ddd6fe', muted: '#c9c6e0', onBgMuted: '#d9d6ee', blur: 16 },
    bg_gradient: 'from-[#4c1d95] via-[#be185d] to-[#0e7490]', button_color: '#7c3aed', preview_bg: 'bg-gradient-to-r from-[#c4b5fd] to-[#f9a8d4]',
  },
  {
    id: 'dark-developer', name: 'Dark Developer', native: 'dark', accent: '#22d3ee', accentBg: 'linear-gradient(135deg,#22d3ee,#3b82f6)', accentText: '#04121a', display: MONO,
    light: { ...lightBase, bg: 'linear-gradient(180deg,#f1f6fb 0%,#e4edf6 100%)', soft: '#d6eefa', ink: '#0369a1', chip: '#e8f0f8' },
    dark: { ...darkBase, bg: 'linear-gradient(180deg,#050b16 0%,#0a1424 60%,#0d1117 100%)', card: '#0d1626', border: 'rgba(34,211,238,.18)', soft: 'rgba(34,211,238,.14)', ink: '#67e8f9', muted: '#8aa0b8' },
    bg_gradient: 'from-[#020617] via-[#0b1220] to-[#0f172a]', button_color: '#22d3ee', preview_bg: 'bg-gradient-to-r from-[#050b16] to-[#22d3ee]',
  },
];

export const DEFAULT_THEME_ID = 'amber';

/** Presets for the admin picker: same shape the old list had, plus the new themes. */
export const THEME_PRESETS = THEMES.map((t) => ({
  id: t.id, name: t.name, bg_gradient: t.bg_gradient, button_color: t.button_color, preview_bg: t.preview_bg,
}));

export function getTheme(id?: string | null): BookingTheme | undefined {
  return THEMES.find((t) => t.id === id);
}

/**
 * Which theme a saved `theme_settings` means. Matched on bg_gradient first (the old settings screen
 * only ever saved bg_gradient + button_color, so the stored `theme` id is often stale), then the
 * stored id, then the default. An admin's saved choice therefore keeps rendering as itself.
 */
export function resolveTheme(ts?: { theme?: string; bg_gradient?: string } | null): BookingTheme {
  const byGradient = ts?.bg_gradient ? THEMES.find((t) => t.bg_gradient === ts.bg_gradient) : undefined;
  return byGradient || getTheme(ts?.theme) || getTheme(DEFAULT_THEME_ID)!;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** CSS variables for one theme + mode, honouring a custom button colour the admin set. */
export function themeVars(
  theme: BookingTheme,
  mode: ThemeMode,
  ts?: { button_color?: string; button_text_color?: string } | null,
): Record<string, string> {
  const t = theme[mode];
  const customButton = ts?.button_color && HEX.test(ts.button_color) && ts.button_color.toLowerCase() !== theme.accent.toLowerCase();
  const accentBg = customButton ? (ts!.button_color as string) : theme.accentBg;
  const accentText = customButton && ts?.button_text_color && HEX.test(ts.button_text_color) ? ts.button_text_color : customButton ? '#ffffff' : theme.accentText;
  return {
    '--bm-bg': t.bg,
    '--bm-on-bg': t.onBg,
    '--bm-on-bg-muted': t.onBgMuted,
    '--bm-card': t.card,
    '--bm-border': t.border,
    '--bm-text': t.text,
    '--bm-muted': t.muted,
    '--bm-chip': t.chip,
    '--bm-soft': t.soft,
    '--bm-ink': t.ink,
    '--bm-shadow': t.shadow,
    '--bm-blur': `${t.blur}px`,
    '--bm-accent': accentBg,
    '--bm-accent-text': accentText,
    '--bm-font': theme.display || SANS,
    colorScheme: mode,
  };
}
