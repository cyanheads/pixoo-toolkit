/** RGB color as a 3-tuple [r, g, b], each 0–255. */
export type RGB = readonly [r: number, g: number, b: number];

/** HSL color as a 3-tuple [h, s, l]. h: 0–360, s/l: 0–1. */
export type HSL = readonly [h: number, s: number, l: number];

/** Anything that can be resolved to an RGB color. */
export type ColorLike = RGB | string | number;

// --- Conversion ---

export function hslToRgb([h, s, l]: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function rgbToHsl([r, g, b]: RGB): HSL {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

/** Pack RGB into a single 24-bit number (0xRRGGBB). */
export function rgbToHex([r, g, b]: RGB): number {
  return (r << 16) | (g << 8) | b;
}

/** Unpack a 24-bit number (0xRRGGBB) into RGB. */
export function hexToRgb(hex: number): RGB {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

/** Parse a CSS-style hex string (#RGB or #RRGGBB) into RGB. */
export function parseHexString(s: string): RGB {
  const clean = s.replace(/^#/, '');
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16);
    const g = parseInt(clean[1]! + clean[1]!, 16);
    const b = parseInt(clean[2]! + clean[2]!, 16);
    return [r || 0, g || 0, b || 0];
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r || 0, g || 0, b || 0];
}

/** Resolve any ColorLike to an RGB tuple. */
export function resolveColor(c: ColorLike): RGB {
  if (Array.isArray(c)) {
    return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  }
  if (typeof c === 'number') return hexToRgb(c);
  if (typeof c === 'string') {
    const named = NAMED_COLORS[c.toLowerCase()];
    if (named) return named;
    return parseHexString(c);
  }
  return [255, 255, 255];
}

/** Linearly interpolate between two colors. t: 0–1. */
export function lerpColor(a: RGB, b: RGB, t: number): RGB {
  const u = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

/** Dim a color by a factor (0 = black, 1 = unchanged). */
export function dimColor(c: RGB, factor: number): RGB {
  return [
    Math.round(c[0] * factor),
    Math.round(c[1] * factor),
    Math.round(c[2] * factor),
  ];
}

// --- Named colors ---

export const NAMED_COLORS: Record<string, RGB> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  pink: [255, 105, 180],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  darkgray: [64, 64, 64],
  darkgrey: [64, 64, 64],
  lightgray: [192, 192, 192],
  lightgrey: [192, 192, 192],
  brown: [139, 69, 19],
  lime: [0, 255, 0],
  teal: [0, 128, 128],
  navy: [0, 0, 128],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  coral: [255, 127, 80],
  salmon: [250, 128, 114],
  gold: [255, 215, 0],
  indigo: [75, 0, 130],
  violet: [238, 130, 238],
  turquoise: [64, 224, 208],
  // Claude brand
  claude: [230, 150, 70],
  'claude-orange': [230, 150, 70],
  'claude-tan': [210, 180, 140],
} as const;

/** Convenience color constants. */
export const Color = {
  BLACK: [0, 0, 0] as RGB,
  WHITE: [255, 255, 255] as RGB,
  RED: [255, 0, 0] as RGB,
  GREEN: [0, 255, 0] as RGB,
  BLUE: [0, 0, 255] as RGB,
  YELLOW: [255, 255, 0] as RGB,
  CYAN: [0, 255, 255] as RGB,
  MAGENTA: [255, 0, 255] as RGB,
  ORANGE: [255, 165, 0] as RGB,
  PURPLE: [128, 0, 128] as RGB,
  PINK: [255, 105, 180] as RGB,
  GRAY: [128, 128, 128] as RGB,
  TRANSPARENT: [0, 0, 0] as RGB, // no actual alpha, but useful as a sentinel
} as const;
