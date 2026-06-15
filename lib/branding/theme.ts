/**
 * Pure, dependency-free two-color theme generator. Given a tenant's primary
 * (accent) and secondary (surface) colors, produces a contrast-safe map of
 * CSS custom properties matching the app's token shape (see app/globals.css).
 * Both null → {} (the default :root palette applies). Node-testable (no React).
 */

type RGB = { r: number; g: number; b: number };

const DEFAULT_PRIMARY = "#e9b82e"; // app's gold
const DEFAULT_SECONDARY = "#050505"; // app's near-black
const NEAR_WHITE: RGB = { r: 245, g: 241, b: 230 }; // matches --foreground
const NEAR_BLACK: RGB = { r: 10, g: 10, b: 8 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** WCAG relative luminance. */
function relLum({ r, g, b }: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGB, b: RGB): number {
  const la = relLum(a);
  const lb = relLum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of near-white / near-black contrasts better on `bg`. */
function readableOn(bg: RGB): RGB {
  return contrast(NEAR_WHITE, bg) >= contrast(NEAR_BLACK, bg) ? NEAR_WHITE : NEAR_BLACK;
}

const WHITE: RGB = { r: 255, g: 255, b: 255 };
const BLACK: RGB = { r: 0, g: 0, b: 0 };

export type ThemeVars = Record<string, string>;

export function buildTenantTheme(
  primary: string | null,
  secondary: string | null,
): ThemeVars {
  if (!primary && !secondary) return {};

  const acc = parseHex(primary ?? DEFAULT_PRIMARY) ?? parseHex(DEFAULT_PRIMARY)!;
  const surf = parseHex(secondary ?? DEFAULT_SECONDARY) ?? parseHex(DEFAULT_SECONDARY)!;
  const fg = readableOn(surf);
  const onAcc = readableOn(acc);

  const card = mix(surf, fg, 0.06);
  const border = mix(surf, fg, 0.16);

  return {
    "--background": toHex(surf),
    "--foreground": toHex(fg),
    "--card": toHex(card),
    "--card-foreground": toHex(fg),
    "--popover": toHex(card),
    "--popover-foreground": toHex(fg),
    "--secondary": toHex(mix(surf, fg, 0.08)),
    "--secondary-foreground": toHex(fg),
    "--muted": toHex(mix(surf, fg, 0.04)),
    "--muted-foreground": toHex(mix(fg, surf, 0.35)),
    "--accent": toHex(mix(surf, acc, 0.15)),
    "--accent-foreground": toHex(acc),
    "--border": toHex(border),
    "--input": toHex(border),
    "--ring": toHex(acc),
    "--primary": toHex(acc),
    "--primary-foreground": toHex(onAcc),
    "--gold": toHex(acc),
    "--gold-bright": toHex(mix(acc, WHITE, 0.2)),
    "--gold-soft": toHex(mix(acc, fg, 0.45)),
    "--gold-deep": toHex(mix(acc, BLACK, 0.4)),
    "--ink": toHex(surf),
    "--sidebar": toHex(mix(surf, fg, 0.02)),
    "--sidebar-foreground": toHex(fg),
    "--sidebar-primary": toHex(acc),
    "--sidebar-primary-foreground": toHex(onAcc),
    "--sidebar-accent": toHex(mix(surf, acc, 0.15)),
    "--sidebar-accent-foreground": toHex(acc),
    "--sidebar-border": toHex(border),
    "--sidebar-ring": toHex(acc),
  };
}
