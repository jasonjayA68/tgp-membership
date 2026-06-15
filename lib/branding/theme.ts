/**
 * Pure, dependency-free two-color theme generator. Contrast-safe: foreground,
 * muted text, and accent-as-text tokens are guaranteed legible (>= 4.5:1) on the
 * chosen surface for ANY two input colors (pure-extreme fallback + accent
 * correction). Both null -> {} (the default :root palette applies). No React.
 */

type RGB = { r: number; g: number; b: number };

const DEFAULT_PRIMARY = "#e9b82e";
const DEFAULT_SECONDARY = "#050505";
const SOFT_WHITE: RGB = { r: 245, g: 241, b: 230 };
const SOFT_BLACK: RGB = { r: 10, g: 10, b: 8 };
const PURE_WHITE: RGB = { r: 255, g: 255, b: 255 };
const PURE_BLACK: RGB = { r: 0, g: 0, b: 0 };
const FLOOR = 4.5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function parseHex(hex: string): RGB | null {
  let s = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

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
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Exposed for tests: contrast ratio between two hex colors. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) return 1;
  return contrast(a, b);
}

/** Readable foreground on `bg`, guaranteed >= FLOOR (soft tone if it clears, else pure). */
function readableOn(bg: RGB): RGB {
  const soft = contrast(SOFT_WHITE, bg) >= contrast(SOFT_BLACK, bg) ? SOFT_WHITE : SOFT_BLACK;
  if (contrast(soft, bg) >= FLOOR) return soft;
  return contrast(PURE_WHITE, bg) >= contrast(PURE_BLACK, bg) ? PURE_WHITE : PURE_BLACK;
}

function roundRGB({ r, g, b }: RGB): RGB {
  return {
    r: Math.round(clamp(r, 0, 255)),
    g: Math.round(clamp(g, 0, 255)),
    b: Math.round(clamp(b, 0, 255)),
  };
}

/** Nudge `color` toward the highest-contrast pure extreme until the EMITTED
 * (rounded) color is legible (>= floor) on `surf`. */
function legibleOn(color: RGB, surf: RGB, floor = FLOOR): RGB {
  const target = contrast(PURE_WHITE, surf) >= contrast(PURE_BLACK, surf) ? PURE_WHITE : PURE_BLACK;
  let c = color;
  for (let i = 0; i < 40 && contrast(roundRGB(c), surf) < floor; i++) c = mix(c, target, 0.1);
  return c;
}

export type ThemeVars = Record<string, string>;

export function buildTenantTheme(primary: string | null, secondary: string | null): ThemeVars {
  if (!primary && !secondary) return {};

  const acc = parseHex(primary ?? DEFAULT_PRIMARY) ?? parseHex(DEFAULT_PRIMARY)!;
  const surf = parseHex(secondary ?? DEFAULT_SECONDARY) ?? parseHex(DEFAULT_SECONDARY)!;
  const fg = readableOn(surf);
  const onAcc = readableOn(acc);

  // Light surfaces need bigger deltas so cards/borders stay visible.
  const light = relLum(surf) > 0.5;
  const cardT = light ? 0.1 : 0.06;
  const borderT = light ? 0.26 : 0.16;

  // Accent corrected to be legible as text/icon on the surface.
  const gold = legibleOn(acc, surf);

  return {
    "--background": toHex(surf),
    "--foreground": toHex(fg),
    "--card": toHex(mix(surf, fg, cardT)),
    "--card-foreground": toHex(fg),
    "--popover": toHex(mix(surf, fg, cardT)),
    "--popover-foreground": toHex(fg),
    "--secondary": toHex(mix(surf, fg, light ? 0.12 : 0.08)),
    "--secondary-foreground": toHex(fg),
    "--muted": toHex(mix(surf, fg, light ? 0.07 : 0.04)),
    "--muted-foreground": toHex(legibleOn(mix(fg, surf, 0.35), surf)),
    "--accent": toHex(mix(surf, acc, 0.15)),
    "--accent-foreground": toHex(gold),
    "--border": toHex(mix(surf, fg, borderT)),
    "--input": toHex(mix(surf, fg, borderT)),
    "--ring": toHex(acc),
    "--primary": toHex(acc),
    "--primary-foreground": toHex(onAcc),
    "--gold": toHex(gold),
    "--gold-bright": toHex(mix(gold, fg, 0.18)),
    "--gold-soft": toHex(mix(gold, fg, 0.4)),
    "--gold-deep": toHex(mix(gold, surf, 0.25)),
    "--ink": toHex(surf),
    "--sidebar": toHex(mix(surf, fg, 0.02)),
    "--sidebar-foreground": toHex(fg),
    "--sidebar-primary": toHex(acc),
    "--sidebar-primary-foreground": toHex(onAcc),
    "--sidebar-accent": toHex(mix(surf, acc, 0.15)),
    "--sidebar-accent-foreground": toHex(gold),
    "--sidebar-border": toHex(mix(surf, fg, borderT)),
    "--sidebar-ring": toHex(acc),
  };
}
