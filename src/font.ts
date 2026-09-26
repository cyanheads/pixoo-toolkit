/**
 * Bitmap font rendering onto canvases of any size.
 *
 * Three built-in faces:
 * - `FONT_5x7`: 5 wide × 7 tall, full printable ASCII (32–126) plus ° ← ↑ → ↓ ▲ ▼ ♥ · …
 * - `FONT_3x5`: 3 wide × 5 tall, the same characters in a compact cell
 * - `FONT_DIGITS_11x18`: 11 × 18 numerals on one 13-pixel advance, for clocks and readouts
 *
 * `parseBdf` turns a BDF (Glyph Bitmap Distribution Format) file's text into
 * a `BitmapFont`.
 *
 * Glyph data is stored as arrays of bitmask rows (one number per row).
 * For a 5-wide font, bit 4 = leftmost pixel, bit 0 = rightmost. Rows are
 * 32-bit masks, so no glyph is wider than 32 pixels.
 */

import { Canvas } from './canvas.js';
import { type ColorLike, resolveColor } from './color.js';

/** Where one glyph's bitmap sits and how far it moves the pen, in unscaled pixels. */
export interface GlyphMetrics {
  /** Bitmap columns, 0–32; bit (width − 1) of each row is the leftmost pixel. */
  readonly width: number;
  /** Pen → bitmap left edge (may be negative). */
  readonly x: number;
  /** Text top (drawText's y) → bitmap top row. */
  readonly y: number;
  /** Pen advance before letterSpacing. */
  readonly advance: number;
}

export interface BitmapFont {
  /**
   * Cell width, at most 32: the bitmap width of a glyph with no `metrics`
   * entry, and the advance of a character the font has no glyph for.
   */
  readonly width: number;
  readonly height: number;
  readonly glyphs: Record<string, readonly number[]>;
  /**
   * Optional per-glyph placement. A glyph with an entry draws its rows at
   * (pen + x, top + y) and advances by `advance`; a glyph without one keeps
   * tight ink metrics in the `width` × `height` cell. `FONT_5x7` and
   * `FONT_3x5` leave it unset.
   */
  readonly metrics?: Readonly<Record<string, GlyphMetrics>>;
}

// --- 5×7 font: full printable ASCII plus ° ← ↑ → ↓ ▲ ▼ ♥ · … ---

const GLYPHS_5x7: Record<string, readonly number[]> = {
  // Punctuation & symbols
  ' ': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
  '!': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
  '"': [0b01010, 0b01010, 0b01010, 0b00000, 0b00000, 0b00000, 0b00000],
  '#': [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010],
  $: [0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100],
  '%': [0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011],
  '&': [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
  "'": [0b00100, 0b00100, 0b00100, 0b00000, 0b00000, 0b00000, 0b00000],
  '(': [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ')': [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  '*': [0b00000, 0b00100, 0b10101, 0b01110, 0b10101, 0b00100, 0b00000],
  '+': [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
  ',': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b01000],
  '-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100],
  '/': [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],

  // Digits
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],

  // Symbols
  ':': [0b00000, 0b00000, 0b00100, 0b00000, 0b00100, 0b00000, 0b00000],
  ';': [0b00000, 0b00000, 0b00100, 0b00000, 0b00100, 0b00100, 0b01000],
  '<': [0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010],
  '=': [0b00000, 0b00000, 0b11111, 0b00000, 0b11111, 0b00000, 0b00000],
  '>': [0b10000, 0b01000, 0b00100, 0b00010, 0b00100, 0b01000, 0b10000],
  '?': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b00000, 0b00100],
  '@': [0b01110, 0b10001, 0b10111, 0b10101, 0b10110, 0b10000, 0b01110],

  // Uppercase
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10101, 0b10011, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01110, 0b10001, 0b10000, 0b01110, 0b00001, 0b10001, 0b01110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],

  '[': [0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110],
  '\\': [0b10000, 0b01000, 0b01000, 0b00100, 0b00010, 0b00010, 0b00001],
  ']': [0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110],
  '^': [0b00100, 0b01010, 0b10001, 0b00000, 0b00000, 0b00000, 0b00000],
  _: [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111],
  '`': [0b01000, 0b00100, 0b00010, 0b00000, 0b00000, 0b00000, 0b00000],

  // Lowercase
  a: [0b00000, 0b00000, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111],
  b: [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110],
  c: [0b00000, 0b00000, 0b01110, 0b10000, 0b10000, 0b10001, 0b01110],
  d: [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111],
  e: [0b00000, 0b00000, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110],
  f: [0b00110, 0b01001, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000],
  g: [0b00000, 0b00000, 0b01111, 0b10001, 0b01111, 0b00001, 0b01110],
  h: [0b10000, 0b10000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001],
  i: [0b00100, 0b00000, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110],
  j: [0b00010, 0b00000, 0b00110, 0b00010, 0b00010, 0b10010, 0b01100],
  k: [0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010],
  l: [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  m: [0b00000, 0b00000, 0b11010, 0b10101, 0b10101, 0b10001, 0b10001],
  n: [0b00000, 0b00000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001],
  o: [0b00000, 0b00000, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110],
  p: [0b00000, 0b00000, 0b11110, 0b10001, 0b11110, 0b10000, 0b10000],
  q: [0b00000, 0b00000, 0b01111, 0b10001, 0b01111, 0b00001, 0b00001],
  r: [0b00000, 0b00000, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000],
  s: [0b00000, 0b00000, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110],
  t: [0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110],
  u: [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101],
  v: [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  w: [0b00000, 0b00000, 0b10001, 0b10001, 0b10101, 0b10101, 0b01010],
  x: [0b00000, 0b00000, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001],
  y: [0b00000, 0b00000, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
  z: [0b00000, 0b00000, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111],
  '{': [0b00010, 0b00100, 0b00100, 0b01000, 0b00100, 0b00100, 0b00010],
  '|': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  '}': [0b01000, 0b00100, 0b00100, 0b00010, 0b00100, 0b00100, 0b01000],
  '~': [0b00000, 0b00000, 0b01000, 0b10101, 0b00010, 0b00000, 0b00000],

  // Beyond ASCII — units, arrows, trend markers, and separators for dashboards
  '°': [0b01100, 0b10010, 0b10010, 0b01100, 0b00000, 0b00000, 0b00000],
  '←': [0b00000, 0b00100, 0b01000, 0b11111, 0b01000, 0b00100, 0b00000],
  '↑': [0b00100, 0b01110, 0b10101, 0b00100, 0b00100, 0b00100, 0b00100],
  '→': [0b00000, 0b00100, 0b00010, 0b11111, 0b00010, 0b00100, 0b00000],
  '↓': [0b00100, 0b00100, 0b00100, 0b00100, 0b10101, 0b01110, 0b00100],
  '▲': [0b00000, 0b00000, 0b00100, 0b01110, 0b11111, 0b00000, 0b00000],
  '▼': [0b00000, 0b00000, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000],
  '♥': [0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000],
  '·': [0b00000, 0b00000, 0b00000, 0b00100, 0b00000, 0b00000, 0b00000],
  '…': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b10101],
};

export const FONT_5x7: BitmapFont = {
  width: 5,
  height: 7,
  glyphs: GLYPHS_5x7,
};

// --- 3×5 compact font: full printable ASCII (32–126) plus ° ← ↑ → ↓ ▲ ▼ ♥ · … ---

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

  // Symbols with no faithful 3×5 form — suggestive marks chosen for LED legibility:
  // '%' keeps the diagonal plus one counter per side, '&' a figure-eight with a tail,
  // '@' a ring with a sweeping tail, '~' a two-cell wave.
  '"': [0b101, 0b101, 0b000, 0b000, 0b000],
  '#': [0b101, 0b111, 0b101, 0b111, 0b101],
  $: [0b011, 0b110, 0b010, 0b011, 0b110],
  '%': [0b100, 0b001, 0b010, 0b100, 0b001],
  '&': [0b010, 0b101, 0b010, 0b101, 0b011],
  "'": [0b010, 0b010, 0b000, 0b000, 0b000],
  '*': [0b000, 0b101, 0b010, 0b101, 0b000],
  ';': [0b000, 0b010, 0b000, 0b010, 0b100],
  '<': [0b001, 0b010, 0b100, 0b010, 0b001],
  '=': [0b000, 0b111, 0b000, 0b111, 0b000],
  '>': [0b100, 0b010, 0b001, 0b010, 0b100],
  '?': [0b111, 0b001, 0b010, 0b000, 0b010],
  '@': [0b111, 0b101, 0b111, 0b100, 0b011],

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

  '[': [0b110, 0b100, 0b100, 0b100, 0b110],
  '\\': [0b100, 0b100, 0b010, 0b001, 0b001],
  ']': [0b011, 0b001, 0b001, 0b001, 0b011],
  '^': [0b010, 0b101, 0b000, 0b000, 0b000],
  _: [0b000, 0b000, 0b000, 0b000, 0b111],
  '`': [0b100, 0b010, 0b000, 0b000, 0b000],

  // Lowercase — ascender/descender/body forms for 3×5 grid
  a: [0b000, 0b010, 0b101, 0b111, 0b101],
  b: [0b100, 0b100, 0b110, 0b101, 0b110],
  c: [0b000, 0b011, 0b100, 0b100, 0b011],
  d: [0b001, 0b001, 0b011, 0b101, 0b011],
  e: [0b000, 0b010, 0b101, 0b110, 0b011],
  f: [0b011, 0b010, 0b111, 0b010, 0b010],
  g: [0b011, 0b101, 0b101, 0b001, 0b110],
  h: [0b100, 0b100, 0b110, 0b101, 0b101],
  i: [0b010, 0b000, 0b010, 0b010, 0b010],
  j: [0b010, 0b000, 0b010, 0b010, 0b100],
  k: [0b100, 0b100, 0b101, 0b110, 0b101],
  l: [0b110, 0b010, 0b010, 0b010, 0b011],
  m: [0b000, 0b111, 0b111, 0b101, 0b101],
  n: [0b000, 0b110, 0b101, 0b101, 0b101],
  o: [0b000, 0b010, 0b101, 0b101, 0b010],
  // 'p' starts a row below the cap line so its bowl plus one-row descender stay
  // clear of 'P', which fills the same three columns from the top row down.
  p: [0b000, 0b110, 0b101, 0b110, 0b100],
  q: [0b011, 0b101, 0b011, 0b001, 0b001],
  r: [0b000, 0b000, 0b011, 0b100, 0b100],
  s: [0b000, 0b011, 0b100, 0b001, 0b110],
  t: [0b010, 0b010, 0b111, 0b010, 0b001],
  u: [0b000, 0b101, 0b101, 0b101, 0b010],
  v: [0b000, 0b101, 0b101, 0b010, 0b010],
  w: [0b000, 0b101, 0b101, 0b111, 0b010],
  x: [0b000, 0b000, 0b101, 0b010, 0b101],
  y: [0b101, 0b101, 0b011, 0b001, 0b110],
  z: [0b000, 0b111, 0b001, 0b010, 0b111],

  // Braces take a mid-row notch — three columns cannot hold the square-bracket
  // construction twice without '{' and '}' colliding with '[' and ']'.
  '{': [0b011, 0b010, 0b100, 0b010, 0b011],
  '|': [0b010, 0b010, 0b010, 0b010, 0b010],
  '}': [0b110, 0b010, 0b001, 0b010, 0b110],
  '~': [0b000, 0b110, 0b011, 0b000, 0b000],

  // Beyond ASCII. Three columns fold the obvious '←' and '→' into '+' and a
  // solid '…' into '_', so the side arrows take a full-height '<' or '>' head
  // on their shaft and the ellipsis keeps two dots.
  '°': [0b010, 0b101, 0b010, 0b000, 0b000],
  '←': [0b001, 0b010, 0b111, 0b010, 0b001],
  '↑': [0b010, 0b111, 0b010, 0b010, 0b010],
  '→': [0b100, 0b010, 0b111, 0b010, 0b100],
  '↓': [0b010, 0b010, 0b010, 0b111, 0b010],
  '▲': [0b000, 0b010, 0b111, 0b000, 0b000],
  '▼': [0b000, 0b000, 0b111, 0b010, 0b000],
  '♥': [0b000, 0b101, 0b111, 0b010, 0b000],
  '·': [0b000, 0b000, 0b010, 0b000, 0b000],
  '…': [0b000, 0b000, 0b000, 0b000, 0b101],
};

export const FONT_3x5: BitmapFont = {
  width: 3,
  height: 5,
  glyphs: GLYPHS_3x5,
};

// --- 11×18 numerals: 0–9, space, and : . - + / % ° ? ---

const GLYPHS_DIGITS_11x18: Record<string, readonly number[]> = {
  '0': [
    0b00111111100, 0b01111111110, 0b11000000011, 0b11000000011, 0b11000000011, 0b11000000011,
    0b11000000011, 0b11000000011, 0b11000000011, 0b11000000011, 0b11000000011, 0b11000000011,
    0b11000000011, 0b11000000011, 0b11000000011, 0b11000000011, 0b01111111110, 0b00111111100,
  ],
  '1': [
    0b00001100000, 0b00011100000, 0b00111100000, 0b01101100000, 0b00001100000, 0b00001100000,
    0b00001100000, 0b00001100000, 0b00001100000, 0b00001100000, 0b00001100000, 0b00001100000,
    0b00001100000, 0b00001100000, 0b00001100000, 0b00001100000, 0b01111111100, 0b01111111100,
  ],
  '2': [
    0b00111111100, 0b01111111110, 0b11000000011, 0b11000000011, 0b00000000011, 0b00000000011,
    0b00000000011, 0b00000000111, 0b00000011110, 0b00001111000, 0b00111100000, 0b01110000000,
    0b11100000000, 0b11000000000, 0b11000000000, 0b11000000000, 0b11111111111, 0b11111111111,
  ],
  '3': [
    0b00111111100, 0b01111111110, 0b11000000011, 0b11000000011, 0b00000000011, 0b00000000011,
    0b00000000011, 0b00000000011, 0b00011111110, 0b00011111110, 0b00000000011, 0b00000000011,
    0b00000000011, 0b00000000011, 0b11000000011, 0b11000000011, 0b01111111110, 0b00111111100,
  ],
  '4': [
    0b11000000110, 0b11000000110, 0b11000000110, 0b11000000110, 0b11000000110, 0b11000000110,
    0b11000000110, 0b11000000110, 0b11000000110, 0b11000000110, 0b11111111111, 0b11111111111,
    0b00000000110, 0b00000000110, 0b00000000110, 0b00000000110, 0b00000000110, 0b00000000110,
  ],
  '5': [
    0b11111111111, 0b11111111111, 0b11000000000, 0b11000000000, 0b11000000000, 0b11000000000,
    0b11000000000, 0b11000000000, 0b11111111100, 0b11111111110, 0b00000000011, 0b00000000011,
    0b00000000011, 0b00000000011, 0b11000000011, 0b11000000011, 0b01111111110, 0b00111111100,
  ],
  '6': [
    0b00111111100, 0b01111111110, 0b11000000011, 0b11000000011, 0b11000000000, 0b11000000000,
    0b11000000000, 0b11000000000, 0b11111111100, 0b11111111110, 0b11000000011, 0b11000000011,
    0b11000000011, 0b11000000011, 0b11000000011, 0b11000000011, 0b01111111110, 0b00111111100,
  ],
  '7': [
    0b11111111111, 0b11111111111, 0b00000000011, 0b00000000011, 0b00000000110, 0b00000000110,
    0b00000001100, 0b00000001100, 0b00000011000, 0b00000011000, 0b00000110000, 0b00000110000,
    0b00001100000, 0b00001100000, 0b00001100000, 0b00001100000, 0b00001100000, 0b00001100000,
  ],
  '8': [
    0b00111111100, 0b01111111110, 0b11000000011, 0b11000000011, 0b11000000011, 0b11000000011,
    0b11000000011, 0b11000000011, 0b01111111110, 0b01111111110, 0b11000000011, 0b11000000011,
    0b11000000011, 0b11000000011, 0b11000000011, 0b11000000011, 0b01111111110, 0b00111111100,
  ],
  '9': [
    0b00111111100, 0b01111111110, 0b11000000011, 0b11000000011, 0b11000000011, 0b11000000011,
    0b11000000011, 0b11000000011, 0b01111111111, 0b00111111111, 0b00000000011, 0b00000000011,
    0b00000000011, 0b00000000011, 0b11000000011, 0b11000000011, 0b01111111110, 0b00111111100,
  ],
  ' ': [],
  ':': [0b11, 0b11, 0b00, 0b00, 0b00, 0b00, 0b00, 0b00, 0b11, 0b11],
  '.': [0b11, 0b11],
  '-': [0b1111111, 0b1111111],
  '+': [
    0b00011000, 0b00011000, 0b00011000, 0b11111111, 0b11111111, 0b00011000, 0b00011000, 0b00011000,
  ],
  '/': [
    0b00000011, 0b00000011, 0b00000110, 0b00000110, 0b00000110, 0b00001100, 0b00001100, 0b00001100,
    0b00011000, 0b00011000, 0b00011000, 0b00110000, 0b00110000, 0b00110000, 0b01100000, 0b01100000,
    0b11000000, 0b11000000,
  ],
  '%': [
    0b01110000011, 0b11011000011, 0b11011000110, 0b11011000110, 0b01110001100, 0b00000001100,
    0b00000011000, 0b00000011000, 0b00000110000, 0b00000110000, 0b00001100000, 0b00001100000,
    0b00011000000, 0b00011001110, 0b00110011011, 0b00110011011, 0b01100011011, 0b01100001110,
  ],
  '°': [0b011110, 0b111111, 0b110011, 0b110011, 0b111111, 0b011110],
  '?': [
    0b00111111100, 0b01111111110, 0b11000000011, 0b11000000011, 0b00000000011, 0b00000000011,
    0b00000000111, 0b00000011110, 0b00000111000, 0b00001110000, 0b00001100000, 0b00001100000,
    0b00001100000, 0b00000000000, 0b00000000000, 0b00000000000, 0b00001100000, 0b00001100000,
  ],
};

/** The digits, '%', and '?': an 11-pixel bitmap with a pixel of bearing each side. */
const FIGURE: GlyphMetrics = { width: 11, x: 1, y: 0, advance: 13 };

const METRICS_DIGITS_11x18: Readonly<Record<string, GlyphMetrics>> = {
  '0': FIGURE,
  '1': FIGURE,
  '2': FIGURE,
  '3': FIGURE,
  '4': FIGURE,
  '5': FIGURE,
  '6': FIGURE,
  '7': FIGURE,
  '8': FIGURE,
  '9': FIGURE,
  '%': FIGURE,
  '?': FIGURE,
  // A figure space, so padded numbers keep their columns
  ' ': { width: 0, x: 0, y: 0, advance: 13 },
  // Dots centered on the digits' two counters
  ':': { width: 2, x: 2, y: 4, advance: 6 },
  '.': { width: 2, x: 1, y: 16, advance: 4 },
  '-': { width: 7, x: 1, y: 8, advance: 9 },
  '+': { width: 8, x: 1, y: 5, advance: 10 },
  '/': { width: 8, x: 1, y: 0, advance: 10 },
  '°': { width: 6, x: 1, y: 0, advance: 8 },
};

/**
 * Large numerals for clocks and readouts: every digit is an 11 × 18 bitmap on
 * one 13-pixel advance, so a time or count keeps its width as it changes.
 * Holds `0–9`, space, and `: . - + / % ° ?`; any other character draws the
 * `?` glyph. Units and labels come from `FONT_5x7` or `FONT_3x5`.
 */
export const FONT_DIGITS_11x18: BitmapFont = {
  width: 11,
  height: 18,
  glyphs: GLYPHS_DIGITS_11x18,
  metrics: METRICS_DIGITS_11x18,
};

// --- Text measurement & rendering ---

export interface TextOptions {
  /** Font to draw with (default: `FONT_5x7`). */
  font?: BitmapFont;
  /**
   * Extra pixels between characters, any finite number — negative tightens.
   * Defaults to 0 for a font with `metrics`, whose advances already include
   * the gap, and to 1 otherwise.
   */
  letterSpacing?: number;
  /** Scale factor for pixel-doubled text, a finite number of at least 1 (default: 1). */
  scale?: number;
}

/** The text functions whose inputs are validated, named in their errors. */
type TextFunction = 'drawText' | 'measureText' | 'drawTextCentered';

/** Throw RangeError naming the function and input for a `NaN` or infinite number. */
function assertFiniteInput(fn: TextFunction, name: string, value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new RangeError(`${fn} ${name} must be finite; got ${value}`);
  }
}

/**
 * Throw RangeError for a `scale` that is not a finite number of at least 1 —
 * below 1 no pixel is drawn, and an infinite one never finishes drawing — or
 * a non-finite `letterSpacing`, which would turn every later position into
 * `NaN` or `Infinity`.
 */
function assertTextOptions(opts: TextOptions, fn: TextFunction): void {
  const { scale } = opts;
  if (scale !== undefined && !(Number.isFinite(scale) && scale >= 1)) {
    throw new RangeError(`${fn} scale must be a finite number of at least 1; got ${scale}`);
  }
  assertFiniteInput(fn, 'letterSpacing', opts.letterSpacing);
}

/** Rows are 32-bit masks, so no glyph is wider than this. */
const MAX_GLYPH_WIDTH = 32;

/** Fonts whose widths have passed `assertGlyphWidths`, so a large font is not rescanned on every call. */
const widthCheckedFonts = new WeakSet<BitmapFont>();

/** Throw RangeError for a font whose cell or any `metrics` entry is wider than 32 pixels. */
function assertGlyphWidths(font: BitmapFont): void {
  if (widthCheckedFonts.has(font)) return;
  if (font.width > MAX_GLYPH_WIDTH) {
    throw new RangeError(
      `Font width is ${font.width}; glyph rows are 32-bit masks, so a font is at most ${MAX_GLYPH_WIDTH} pixels wide`,
    );
  }
  for (const [ch, metrics] of Object.entries(font.metrics ?? {})) {
    if (metrics.width > MAX_GLYPH_WIDTH) {
      throw new RangeError(
        `Glyph ${JSON.stringify(ch)} is ${metrics.width} pixels wide; glyph rows are 32-bit masks, so a glyph is at most ${MAX_GLYPH_WIDTH}`,
      );
    }
  }
  widthCheckedFonts.add(font);
}

/** Font, letter spacing, and scale for one call, validated, with the defaults applied. */
function textSettings(
  opts: TextOptions,
  fn: TextFunction,
): { font: BitmapFont; spacing: number; scale: number } {
  assertTextOptions(opts, fn);
  const font = opts.font ?? FONT_5x7;
  assertGlyphWidths(font);
  return {
    font,
    spacing: opts.letterSpacing ?? (font.metrics ? 0 : 1),
    scale: opts.scale ?? 1,
  };
}

/**
 * One character's bitmap and where it lands relative to the pen and the text
 * top, in unscaled pixels. Columns before `firstColumn` are not drawn.
 */
interface GlyphPlacement {
  readonly rows: readonly number[];
  readonly rowCount: number;
  readonly width: number;
  readonly firstColumn: number;
  readonly x: number;
  readonly y: number;
  readonly advance: number;
}

/**
 * Tight glyph metrics from bitmask data: `width` is the ink span in pixels,
 * `offset` is the leftmost ink column within the glyph cell. Glyphs with no
 * ink (space) advance the full cell width.
 */
function inkMetrics(font: BitmapFont, glyph: readonly number[]): { width: number; offset: number } {
  let hi = -1;
  let lo = 31;
  for (const row of glyph) {
    if (row === 0) continue;
    const rowHi = 31 - Math.clz32(row);
    const rowLo = 31 - Math.clz32(row & -row);
    if (rowHi > hi) hi = rowHi;
    if (rowLo < lo) lo = rowLo;
  }
  if (hi < 0) return { width: font.width, offset: 0 };
  // Bit (font.width - 1) is the leftmost pixel column
  return { width: hi - lo + 1, offset: font.width - 1 - hi };
}

/**
 * The glyph a character draws with: its own, its uppercase form's when the
 * font lacks lowercase, else the font's '?'. Undefined when none exists.
 */
function glyphKey(font: BitmapFont, ch: string): string | undefined {
  if (font.glyphs[ch]) return ch;
  if (ch >= 'a' && ch <= 'z' && font.glyphs[ch.toUpperCase()]) return ch.toUpperCase();
  return font.glyphs['?'] ? '?' : undefined;
}

/**
 * Place one character. A glyph with a `metrics` entry sits where the entry
 * says; one without is shifted so its leftmost ink lands at the pen and
 * advances by its ink width. A character with no glyph and no '?' draws
 * nothing and advances the cell width.
 */
function placeGlyph(font: BitmapFont, ch: string): GlyphPlacement {
  const key = glyphKey(font, ch);
  if (key === undefined) {
    return { rows: [], rowCount: 0, width: 0, firstColumn: 0, x: 0, y: 0, advance: font.width };
  }
  const rows = font.glyphs[key]!;
  const metrics = font.metrics?.[key];
  if (metrics) {
    const { width, x, y, advance } = metrics;
    return { rows, rowCount: rows.length, width, firstColumn: 0, x, y, advance };
  }
  const ink = inkMetrics(font, rows);
  return {
    rows,
    rowCount: font.height,
    width: font.width,
    firstColumn: ink.offset,
    x: -ink.offset,
    y: 0,
    advance: ink.width,
  };
}

/**
 * Measure the pixel width of a string without drawing it: the sum of each
 * character's advance — its tight ink width, or its `metrics` advance — plus
 * letterSpacing between characters, with no trailing spacing.
 *
 * @throws RangeError for a `scale` that is not a finite number of at least 1,
 *   a non-finite `letterSpacing`, or a font wider than 32 pixels or with a
 *   `metrics` entry that is.
 */
export function measureText(text: string, opts: TextOptions = {}): number {
  const { font, spacing, scale } = textSettings(opts, 'measureText');
  let width = 0;
  for (const ch of text) width += (placeGlyph(font, ch).advance + spacing) * scale;
  return text.length > 0 ? width - spacing * scale : 0;
}

/**
 * Draw a text string onto a canvas, one glyph per code point, so a character
 * outside the Basic Multilingual Plane is one glyph (or one '?'). Each glyph's
 * leftmost ink lands at the pen position (tight proportional metrics —
 * center-aligned glyph cells get no phantom left gap), except a glyph with a
 * `metrics` entry, which draws its bitmap at (pen + metrics.x, y + metrics.y)
 * and advances by `metrics.advance`. Returns the cursor advance, including
 * trailing spacing.
 *
 * @throws RangeError for a non-finite `x` or `y`, a `scale` that is not a
 *   finite number of at least 1, a non-finite `letterSpacing`, or a font
 *   wider than 32 pixels or with a `metrics` entry that is — before anything
 *   is drawn.
 */
export function drawText(
  canvas: Canvas,
  text: string,
  x: number,
  y: number,
  color: ColorLike,
  opts: TextOptions = {},
): number {
  assertFiniteInput('drawText', 'x', x);
  assertFiniteInput('drawText', 'y', y);
  const { font, spacing, scale } = textSettings(opts, 'drawText');
  const [r, g, b] = resolveColor(color);
  let cx = x;

  for (const ch of text) {
    const glyph = placeGlyph(font, ch);
    for (let gy = 0; gy < glyph.rowCount; gy++) {
      const row = glyph.rows[gy]!;
      for (let gx = glyph.firstColumn; gx < glyph.width; gx++) {
        // Bit order: MSB = left pixel
        if ((row >> (glyph.width - 1 - gx)) & 1) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = cx + (glyph.x + gx) * scale + sx;
              const py = y + (glyph.y + gy) * scale + sy;
              canvas.setPixel(px, py, [r, g, b]);
            }
          }
        }
      }
    }
    cx += (glyph.advance + spacing) * scale;
  }

  return cx - x;
}

/**
 * Draw text centered horizontally within the canvas (or a given width).
 *
 * @throws RangeError for a non-finite `y`, `regionX`, `regionWidth`, or
 *   `letterSpacing`, or a `scale` that is not a finite number of at least 1 —
 *   each error naming this function — or for a font `drawText` rejects.
 */
export function drawTextCentered(
  canvas: Canvas,
  text: string,
  y: number,
  color: ColorLike,
  opts: TextOptions & { regionX?: number; regionWidth?: number } = {},
): void {
  assertFiniteInput('drawTextCentered', 'y', y);
  assertFiniteInput('drawTextCentered', 'regionX', opts.regionX);
  assertFiniteInput('drawTextCentered', 'regionWidth', opts.regionWidth);
  assertTextOptions(opts, 'drawTextCentered');
  const regionX = opts.regionX ?? 0;
  const regionWidth = opts.regionWidth ?? canvas.width;
  const textWidth = measureText(text, opts);
  const x = regionX + Math.floor((regionWidth - textWidth) / 2);
  drawText(canvas, text, x, y, color, opts);
}

// --- BDF loading ---

/** One non-blank line of BDF text, split into its keyword and arguments. */
interface BdfLine {
  /** 1-based line number in the source text. */
  readonly no: number;
  readonly text: string;
  readonly keyword: string;
  readonly args: readonly string[];
}

/** A glyph's BBX (or the font's FONTBOUNDINGBOX): size and offset from the origin. */
interface BdfBox {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

const BDF_INTEGER = /^[+-]?\d+$/;
const BDF_HEX = /^[0-9A-Fa-f]+$/;
const MAX_CODE_POINT = 0x10ffff;

function bdfSyntaxError(line: number, message: string): SyntaxError {
  return new SyntaxError(`BDF line ${line}: ${message}`);
}

/** The integer arguments of `line`, which must number exactly `count`. */
function bdfIntegers(line: BdfLine, count: number): number[] {
  if (line.args.length !== count || !line.args.every((arg) => BDF_INTEGER.test(arg))) {
    throw bdfSyntaxError(
      line.no,
      `${line.keyword} takes ${count} integer${count === 1 ? '' : 's'}; got "${line.text}"`,
    );
  }
  return line.args.map(Number);
}

/** A string property's value, without its surrounding quotes. */
function bdfString(line: BdfLine): string {
  return line.text
    .slice(line.keyword.length)
    .trim()
    .replace(/^"(.*)"$/, '$1');
}

/** Read a BBX or FONTBOUNDINGBOX line, rejecting one wider than a 32-bit row. */
function bdfBox(line: BdfLine): BdfBox {
  const [width = 0, height = 0, x = 0, y = 0] = bdfIntegers(line, 4);
  if (width < 0 || height < 0) {
    throw bdfSyntaxError(line.no, `${line.keyword} has a negative size; got "${line.text}"`);
  }
  if (width > MAX_GLYPH_WIDTH) {
    throw new RangeError(
      `BDF line ${line.no}: ${line.keyword} is ${width} pixels wide; glyph rows are 32-bit masks, so a glyph is at most ${MAX_GLYPH_WIDTH}`,
    );
  }
  return { width, height, x, y };
}

/**
 * Read the `height` hex rows after a BITMAP line and the ENDCHAR that closes
 * them. Each row keeps its leftmost `width` bits, so bit (width − 1) is the
 * leftmost pixel; byte padding past `width` is dropped.
 */
function bdfBitmap(next: (expected: string) => BdfLine, box: BdfBox): number[] {
  const digits = Math.ceil(box.width / 4);
  const rows: number[] = [];
  for (;;) {
    const line = next('ENDCHAR');
    if (line.text === 'ENDCHAR') {
      if (rows.length !== box.height) {
        throw bdfSyntaxError(
          line.no,
          `BITMAP has ${rows.length} rows; its BBX height is ${box.height}`,
        );
      }
      return rows;
    }
    if (rows.length === box.height) {
      throw bdfSyntaxError(
        line.no,
        BDF_HEX.test(line.text)
          ? `BITMAP has more rows than its BBX height of ${box.height}`
          : `expected ENDCHAR; got "${line.text}"`,
      );
    }
    if (!BDF_HEX.test(line.text) || line.text.length < digits) {
      throw bdfSyntaxError(
        line.no,
        `BITMAP row "${line.text}" is not ${digits} or more hex digits`,
      );
    }
    const value = digits === 0 ? 0 : Number.parseInt(line.text.slice(0, digits), 16);
    rows.push(value >>> (digits * 4 - box.width));
  }
}

/** One glyph read from STARTCHAR through ENDCHAR; `code` is -1 for an unencoded glyph. */
interface BdfGlyph {
  readonly code: number;
  readonly advance: number;
  readonly box: BdfBox;
  readonly rows: number[];
}

/** Read the glyph that `start` (its STARTCHAR line) opens. */
function bdfGlyph(
  start: BdfLine,
  next: (expected: string) => BdfLine,
  fontAdvance: number | undefined,
): BdfGlyph {
  const name = JSON.stringify(start.args.join(' '));
  let code: number | undefined;
  let advance = fontAdvance;
  let box: BdfBox | undefined;
  for (;;) {
    const line = next('ENDCHAR');
    switch (line.keyword) {
      case 'ENCODING': {
        // `ENCODING -1 n` pairs an unencoded glyph with a font-specific index.
        const count = line.args[0] === '-1' && line.args.length === 2 ? 2 : 1;
        code = bdfIntegers(line, count)[0]!;
        if (code < -1 || code > MAX_CODE_POINT) {
          throw bdfSyntaxError(line.no, `ENCODING ${code} is not a Unicode code point`);
        }
        break;
      }
      case 'DWIDTH':
        advance = bdfIntegers(line, 2)[0]!;
        break;
      case 'BBX':
        box = bdfBox(line);
        break;
      case 'BITMAP': {
        if (!box) throw bdfSyntaxError(line.no, `BITMAP before BBX in glyph ${name}`);
        if (code === undefined) throw bdfSyntaxError(start.no, `glyph ${name} has no ENCODING`);
        if (advance === undefined) {
          throw bdfSyntaxError(start.no, `glyph ${name} has no DWIDTH, and the font sets none`);
        }
        return { code, advance, box, rows: bdfBitmap(next, box) };
      }
      case 'STARTCHAR':
      case 'ENDCHAR':
      case 'ENDFONT':
        throw bdfSyntaxError(line.no, `expected BITMAP in glyph ${name}; got "${line.text}"`);
    }
  }
}

/**
 * Parse the text of a BDF (Glyph Bitmap Distribution Format) font into a
 * `BitmapFont`. Pure — BDF text in, font out — so it runs wherever the rest
 * of this module does; read the file however the platform allows.
 *
 * Reads STARTFONT, FONTBOUNDINGBOX, FONT_ASCENT and FONT_DESCENT (each from
 * the bounding box when absent), CHARSET_REGISTRY and CHARSET_ENCODING,
 * font-level and per-glyph DWIDTH, ENCODING, BBX, BITMAP, ENDCHAR, and
 * ENDFONT, and ignores every other line, DEFAULT_CHAR included. ENCODING is
 * the glyph's Unicode code point; ENCODING -1 glyphs are skipped.
 *
 * The font's `width` is the bounding-box width and its `height` is ascent +
 * descent. Every glyph gets a `metrics` entry: its BBX width, its BBX x
 * offset, `y = ascent − (BBX y offset + BBX height)` so all glyphs share one
 * baseline, and its DWIDTH (or the font-level one) as the advance.
 *
 * @throws SyntaxError naming the 1-based line for malformed input: input
 *   that ends early or does not start with STARTFONT, a missing ENDCHAR, a
 *   keyword with the wrong number of integers, a BITMAP whose row count is
 *   not its BBX height, a row that is not hex, or a glyph with no ENCODING,
 *   BBX, or DWIDTH.
 * @throws RangeError naming the line for a glyph or bounding box wider than
 *   32 pixels (rows are 32-bit masks), or a charset other than ISO10646 or
 *   ISO8859-1, whose encodings are not Unicode code points.
 */
export function parseBdf(text: string): BitmapFont {
  const physicalLines = text.split(/\r?\n/);
  const lines: BdfLine[] = [];
  physicalLines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (trimmed === '') return;
    const [keyword = '', ...args] = trimmed.split(/\s+/);
    lines.push({ no: index + 1, text: trimmed, keyword, args });
  });
  let cursor = 0;
  const next = (expected: string): BdfLine => {
    const line = lines[cursor++];
    if (!line) {
      throw bdfSyntaxError(physicalLines.length, `input ends early; expected ${expected}`);
    }
    return line;
  };

  const start = next('STARTFONT');
  if (start.keyword !== 'STARTFONT') {
    throw bdfSyntaxError(start.no, `expected STARTFONT; got "${start.text}"`);
  }

  let bounds: BdfBox | undefined;
  let ascent: number | undefined;
  let descent: number | undefined;
  let fontAdvance: number | undefined;
  let registry: BdfLine | undefined;
  let charsetEncoding: BdfLine | undefined;
  let line = next('ENDFONT');
  for (; line.keyword !== 'STARTCHAR' && line.keyword !== 'ENDFONT'; line = next('ENDFONT')) {
    switch (line.keyword) {
      case 'FONTBOUNDINGBOX':
        bounds = bdfBox(line);
        break;
      case 'FONT_ASCENT':
        ascent = bdfIntegers(line, 1)[0]!;
        break;
      case 'FONT_DESCENT':
        descent = bdfIntegers(line, 1)[0]!;
        break;
      case 'DWIDTH':
        fontAdvance = bdfIntegers(line, 2)[0]!;
        break;
      case 'CHARSET_REGISTRY':
        registry = line;
        break;
      case 'CHARSET_ENCODING':
        charsetEncoding = line;
        break;
    }
  }

  if (!bounds) {
    throw bdfSyntaxError(line.no, `expected FONTBOUNDINGBOX before "${line.text}"`);
  }
  if (registry) {
    const name = bdfString(registry).toUpperCase();
    const encoding = charsetEncoding ? bdfString(charsetEncoding) : '';
    if (name !== 'ISO10646' && !(name === 'ISO8859' && encoding === '1')) {
      throw new RangeError(
        `BDF line ${registry.no}: charset ${name}-${encoding} does not encode Unicode code points; parseBdf reads ISO10646 and ISO8859-1 fonts`,
      );
    }
  }
  const fontAscent = ascent ?? bounds.height + bounds.y;
  const fontDescent = descent ?? -bounds.y;

  const glyphs: Record<string, readonly number[]> = {};
  const metrics: Record<string, GlyphMetrics> = {};
  for (; line.keyword !== 'ENDFONT'; line = next('ENDFONT')) {
    if (line.keyword !== 'STARTCHAR') continue;
    const glyph = bdfGlyph(line, next, fontAdvance);
    if (glyph.code === -1) continue;
    const ch = String.fromCodePoint(glyph.code);
    glyphs[ch] = glyph.rows;
    metrics[ch] = {
      width: glyph.box.width,
      x: glyph.box.x,
      y: fontAscent - (glyph.box.y + glyph.box.height),
      advance: glyph.advance,
    };
  }

  return { width: bounds.width, height: fontAscent + fontDescent, glyphs, metrics };
}
