/**
 * Bitmap font rendering for 64×64 pixel displays.
 *
 * Two built-in sizes:
 * - `FONT_5x7`: 5 wide × 7 tall, full printable ASCII (32–126)
 * - `FONT_3x5`: 3 wide × 5 tall, compact for cramped layouts
 *
 * Glyph data is stored as arrays of bitmask rows (one number per row).
 * For a 5-wide font, bit 4 = leftmost pixel, bit 0 = rightmost.
 */

export interface BitmapFont {
  readonly width: number;
  readonly height: number;
  readonly glyphs: Record<string, readonly number[]>;
}

// --- 5×7 full ASCII font ---

const G = (rows: readonly number[]): readonly number[] => rows;

const GLYPHS_5x7: Record<string, readonly number[]> = {
  // Punctuation & symbols
  ' ': G([0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000]),
  '!': G([0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100]),
  '"': G([0b01010, 0b01010, 0b01010, 0b00000, 0b00000, 0b00000, 0b00000]),
  '#': G([0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010]),
  $: G([0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100]),
  '%': G([0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011]),
  '&': G([0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101]),
  "'": G([0b00100, 0b00100, 0b00100, 0b00000, 0b00000, 0b00000, 0b00000]),
  '(': G([0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010]),
  ')': G([0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000]),
  '*': G([0b00000, 0b00100, 0b10101, 0b01110, 0b10101, 0b00100, 0b00000]),
  '+': G([0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000]),
  ',': G([0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b01000]),
  '-': G([0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000]),
  '.': G([0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100]),
  '/': G([0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000]),

  // Digits
  '0': G([0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110]),
  '1': G([0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110]),
  '2': G([0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111]),
  '3': G([0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110]),
  '4': G([0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010]),
  '5': G([0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110]),
  '6': G([0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110]),
  '7': G([0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000]),
  '8': G([0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110]),
  '9': G([0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100]),

  // Symbols
  ':': G([0b00000, 0b00000, 0b00100, 0b00000, 0b00100, 0b00000, 0b00000]),
  ';': G([0b00000, 0b00000, 0b00100, 0b00000, 0b00100, 0b00100, 0b01000]),
  '<': G([0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010]),
  '=': G([0b00000, 0b00000, 0b11111, 0b00000, 0b11111, 0b00000, 0b00000]),
  '>': G([0b10000, 0b01000, 0b00100, 0b00010, 0b00100, 0b01000, 0b10000]),
  '?': G([0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b00000, 0b00100]),
  '@': G([0b01110, 0b10001, 0b10111, 0b10101, 0b10110, 0b10000, 0b01110]),

  // Uppercase
  A: G([0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001]),
  B: G([0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110]),
  C: G([0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110]),
  D: G([0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110]),
  E: G([0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111]),
  F: G([0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000]),
  G: G([0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110]),
  H: G([0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001]),
  I: G([0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110]),
  J: G([0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100]),
  K: G([0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001]),
  L: G([0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111]),
  M: G([0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001]),
  N: G([0b10001, 0b11001, 0b10101, 0b10101, 0b10011, 0b10001, 0b10001]),
  O: G([0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110]),
  P: G([0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000]),
  Q: G([0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101]),
  R: G([0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001]),
  S: G([0b01110, 0b10001, 0b10000, 0b01110, 0b00001, 0b10001, 0b01110]),
  T: G([0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100]),
  U: G([0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110]),
  V: G([0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100]),
  W: G([0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001]),
  X: G([0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001]),
  Y: G([0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100]),
  Z: G([0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111]),

  '[': G([0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110]),
  '\\': G([0b10000, 0b01000, 0b01000, 0b00100, 0b00010, 0b00010, 0b00001]),
  ']': G([0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110]),
  '^': G([0b00100, 0b01010, 0b10001, 0b00000, 0b00000, 0b00000, 0b00000]),
  _: G([0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111]),
  '`': G([0b01000, 0b00100, 0b00010, 0b00000, 0b00000, 0b00000, 0b00000]),

  // Lowercase
  a: G([0b00000, 0b00000, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111]),
  b: G([0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110]),
  c: G([0b00000, 0b00000, 0b01110, 0b10000, 0b10000, 0b10001, 0b01110]),
  d: G([0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111]),
  e: G([0b00000, 0b00000, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110]),
  f: G([0b00110, 0b01001, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000]),
  g: G([0b00000, 0b00000, 0b01111, 0b10001, 0b01111, 0b00001, 0b01110]),
  h: G([0b10000, 0b10000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001]),
  i: G([0b00100, 0b00000, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110]),
  j: G([0b00010, 0b00000, 0b00110, 0b00010, 0b00010, 0b10010, 0b01100]),
  k: G([0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010]),
  l: G([0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110]),
  m: G([0b00000, 0b00000, 0b11010, 0b10101, 0b10101, 0b10001, 0b10001]),
  n: G([0b00000, 0b00000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001]),
  o: G([0b00000, 0b00000, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110]),
  p: G([0b00000, 0b00000, 0b11110, 0b10001, 0b11110, 0b10000, 0b10000]),
  q: G([0b00000, 0b00000, 0b01111, 0b10001, 0b01111, 0b00001, 0b00001]),
  r: G([0b00000, 0b00000, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000]),
  s: G([0b00000, 0b00000, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110]),
  t: G([0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110]),
  u: G([0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101]),
  v: G([0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100]),
  w: G([0b00000, 0b00000, 0b10001, 0b10001, 0b10101, 0b10101, 0b01010]),
  x: G([0b00000, 0b00000, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001]),
  y: G([0b00000, 0b00000, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110]),
  z: G([0b00000, 0b00000, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111]),
  '{': G([0b00010, 0b00100, 0b00100, 0b01000, 0b00100, 0b00100, 0b00010]),
  '|': G([0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100]),
  '}': G([0b01000, 0b00100, 0b00100, 0b00010, 0b00100, 0b00100, 0b01000]),
  '~': G([0b00000, 0b00000, 0b01000, 0b10101, 0b00010, 0b00000, 0b00000]),
};

export const FONT_5x7: BitmapFont = {
  width: 5,
  height: 7,
  glyphs: GLYPHS_5x7,
};

// --- 3×5 compact font (digits, uppercase, basic punctuation) ---

const GLYPHS_3x5: Record<string, readonly number[]> = {
  ' ': [0b000, 0b000, 0b000, 0b000, 0b000],
  '!': [0b010, 0b010, 0b010, 0b000, 0b010],
  '.': [0b000, 0b000, 0b000, 0b000, 0b010],
  ',': [0b000, 0b000, 0b000, 0b010, 0b100],
  ':': [0b000, 0b010, 0b000, 0b010, 0b000],
  '-': [0b000, 0b000, 0b111, 0b000, 0b000],
  '+': [0b000, 0b010, 0b111, 0b010, 0b000],
  '/': [0b001, 0b001, 0b010, 0b100, 0b100],
  '(': [0b010, 0b100, 0b100, 0b100, 0b010],
  ')': [0b010, 0b001, 0b001, 0b001, 0b010],
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b011, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b010, 0b010, 0b010],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  A: [0b010, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b011, 0b100, 0b100, 0b100, 0b011],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b110, 0b100, 0b111],
  F: [0b111, 0b100, 0b110, 0b100, 0b100],
  G: [0b011, 0b100, 0b101, 0b101, 0b011],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  J: [0b001, 0b001, 0b001, 0b101, 0b010],
  K: [0b101, 0b110, 0b100, 0b110, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b101, 0b101, 0b101],
  N: [0b101, 0b111, 0b111, 0b101, 0b101],
  O: [0b010, 0b101, 0b101, 0b101, 0b010],
  P: [0b110, 0b101, 0b110, 0b100, 0b100],
  Q: [0b010, 0b101, 0b101, 0b110, 0b011],
  R: [0b110, 0b101, 0b110, 0b101, 0b101],
  S: [0b011, 0b100, 0b010, 0b001, 0b110],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b010],
  V: [0b101, 0b101, 0b101, 0b010, 0b010],
  W: [0b101, 0b101, 0b101, 0b111, 0b101],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
};

export const FONT_3x5: BitmapFont = {
  width: 3,
  height: 5,
  glyphs: GLYPHS_3x5,
};

// --- Text measurement & rendering ---

import { Canvas } from './canvas.js';
import { type ColorLike, resolveColor } from './color.js';

export interface TextOptions {
  font?: BitmapFont;
  /** Extra pixels between characters (default: 1). */
  letterSpacing?: number;
  /** Scale factor for pixel-doubled text (default: 1). */
  scale?: number;
}

/** Calculate the rendered width of a glyph from its bitmask data. */
function glyphWidth(font: BitmapFont, ch: string, glyph: readonly number[]): number {
  let maxBit = 0;
  for (const row of glyph) {
    if (row > 0) {
      const bits = Math.floor(Math.log2(row)) + 1;
      if (bits > maxBit) maxBit = bits;
    }
  }
  return Math.max(maxBit, ch === ' ' ? font.width : 1);
}

/** Resolve a character to a glyph, auto-uppercasing if the font lacks lowercase. */
function resolveGlyph(
  font: BitmapFont,
  ch: string,
): { ch: string; glyph: readonly number[] | undefined } {
  let glyph = font.glyphs[ch];
  if (!glyph && ch >= 'a' && ch <= 'z') {
    const upper = ch.toUpperCase();
    glyph = font.glyphs[upper];
    if (glyph) return { ch: upper, glyph };
  }
  return { ch, glyph: glyph ?? font.glyphs['?'] };
}

/** Measure the pixel width of a string without drawing it. */
export function measureText(text: string, opts: TextOptions = {}): number {
  const font = opts.font ?? FONT_5x7;
  const spacing = opts.letterSpacing ?? 1;
  const scale = opts.scale ?? 1;
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const { ch, glyph } = resolveGlyph(font, text[i]!);
    if (!glyph) {
      width += (font.width + spacing) * scale;
      continue;
    }
    width += (glyphWidth(font, ch, glyph) + spacing) * scale;
  }
  // Remove trailing spacing
  if (text.length > 0) width -= spacing * scale;
  return width;
}

/** Draw a text string onto a canvas. Returns the width drawn. */
export function drawText(
  canvas: Canvas,
  text: string,
  x: number,
  y: number,
  color: ColorLike,
  opts: TextOptions = {},
): number {
  const font = opts.font ?? FONT_5x7;
  const spacing = opts.letterSpacing ?? 1;
  const scale = opts.scale ?? 1;
  const [r, g, b] = resolveColor(color);
  let cx = x;

  for (let i = 0; i < text.length; i++) {
    const { ch, glyph } = resolveGlyph(font, text[i]!);
    if (!glyph) {
      cx += (font.width + spacing) * scale;
      continue;
    }

    const gw = glyphWidth(font, ch, glyph);

    // Render glyph
    for (let gy = 0; gy < font.height; gy++) {
      const row = glyph[gy]!;
      for (let gx = 0; gx < font.width; gx++) {
        // Bit order: MSB = left pixel
        const bit = (row >> (font.width - 1 - gx)) & 1;
        if (bit) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = cx + gx * scale + sx;
              const py = y + gy * scale + sy;
              canvas.setPixel(px, py, [r, g, b]);
            }
          }
        }
      }
    }

    cx += (gw + spacing) * scale;
  }

  return cx - x;
}

/** Draw text centered horizontally within the canvas (or a given width). */
export function drawTextCentered(
  canvas: Canvas,
  text: string,
  y: number,
  color: ColorLike,
  opts: TextOptions & { regionX?: number; regionWidth?: number } = {},
): void {
  const regionX = opts.regionX ?? 0;
  const regionWidth = opts.regionWidth ?? canvas.width;
  const textWidth = measureText(text, opts);
  const x = regionX + Math.floor((regionWidth - textWidth) / 2);
  drawText(canvas, text, x, y, color, opts);
}
