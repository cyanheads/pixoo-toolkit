import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  FONT_5x7,
  FONT_3x5,
  FONT_DIGITS_11x18,
  parseBdf,
  measureText,
  drawText,
  drawTextCentered,
  type BitmapFont,
  type TextOptions,
} from '../src/font.js';
import { Canvas } from '../src/canvas.js';

/** Printable-ASCII characters FONT_5x7 has always defined and FONT_3x5 previously lacked. */
const ADDED_3x5 = `"#$%&'*;<=>?@[\\]^_\`{|}~`;

/** Pairs whose 3×5 forms are close enough that an identical bitmap would be a defect. */
const CONFUSABLE_PAIRS: readonly (readonly [string, string])[] = [
  ['[', '{'],
  [']', '}'],
  ["'", '`'],
  ['"', '#'],
  ['<', '('],
  ['>', ')'],
  ['_', '-'],
  [';', ':'],
  ['*', '+'],
];

/** Every inked pixel on the canvas, in row-major order. */
function inkPixels(c: Canvas): [number, number][] {
  const px: [number, number][] = [];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (c.getPixelRgba(x, y)[3] !== 0) px.push([x, y]);
    }
  }
  return px;
}

/** Column indices carrying at least one inked pixel. */
function inkColumns(c: Canvas): number[] {
  return [...new Set(inkPixels(c).map(([x]) => x))].sort((a, b) => a - b);
}

/** Horizontal ink extent, or null when nothing was drawn. */
function inkSpan(c: Canvas): { min: number; max: number; width: number } | null {
  const cols = inkColumns(c);
  const min = cols[0];
  const max = cols[cols.length - 1];
  if (min === undefined || max === undefined) return null;
  return { min, max, width: max - min + 1 };
}

/** Characters sharing an identical bitmap, as `"a=b"` labels — empty when the table is collision-free. */
function collisions(font: BitmapFont): string[] {
  const byBitmap = new Map<string, string[]>();
  for (const [ch, rows] of Object.entries(font.glyphs)) {
    const key = rows.join(',');
    byBitmap.set(key, [...(byBitmap.get(key) ?? []), ch]);
  }
  return [...byBitmap.values()].filter((chars) => chars.length > 1).map((chars) => chars.join('='));
}

/** Every printable-ASCII character (32–126), in code order. */
const PRINTABLE_ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

/**
 * Stable digest of a glyph table's printable-ASCII entries — pins the exact
 * bitmaps, not just their shape, while leaving room for glyphs past ASCII.
 */
function asciiDigest(font: BitmapFont): string {
  const h = createHash('sha256');
  for (const [ch, rows] of Object.entries(font.glyphs)) {
    if (PRINTABLE_ASCII.includes(ch)) h.update(`${ch}:${rows.join(',')};`);
  }
  return h.digest('hex');
}

/**
 * `[font, scale, letterSpacing, measureText, drawText advance, sha256 prefix]`
 * for all of printable ASCII drawn at (1, 1) on a canvas two pixels larger
 * than the text — the output of 0.8.2, which every later release must match.
 */
const ASCII_RENDER_PINS: readonly (readonly [
  '5x7' | '3x5',
  number,
  number,
  number,
  number,
  string,
])[] = [
  ['5x7', 1, 0, 421, 421, '3c1ad5cc62168188'],
  ['5x7', 1, 1, 515, 516, 'cd7f1fcb81c384e9'],
  ['5x7', 1, 2, 609, 611, '88cb748bcbccfd59'],
  ['5x7', 1, 3, 703, 706, '58a81c399ba22f04'],
  ['5x7', 2, 0, 842, 842, '79dfb0c611256372'],
  ['5x7', 2, 1, 1030, 1032, '9cf4bc70c7427f91'],
  ['5x7', 2, 2, 1218, 1222, '96675aeef8e6c056'],
  ['5x7', 2, 3, 1406, 1412, '812c7acf97ed5d89'],
  ['5x7', 3, 0, 1263, 1263, '6196cc9a6523eeaa'],
  ['5x7', 3, 1, 1545, 1548, 'c46f70643f012da9'],
  ['5x7', 3, 2, 1827, 1833, 'a2e29666b2b73965'],
  ['5x7', 3, 3, 2109, 2118, 'c3cb019728eec5dc'],
  ['3x5', 1, 0, 265, 265, 'd9600e1eeaa954f0'],
  ['3x5', 1, 1, 359, 360, 'f1e9ae92f2ab00e8'],
  ['3x5', 1, 2, 453, 455, 'e6cbd4a00bceeadf'],
  ['3x5', 1, 3, 547, 550, '2fef862c5bced926'],
  ['3x5', 2, 0, 530, 530, '46af79d9e2cda721'],
  ['3x5', 2, 1, 718, 720, '8264c387d996f9c9'],
  ['3x5', 2, 2, 906, 910, '7b4a0555f40ac50c'],
  ['3x5', 2, 3, 1094, 1100, '0ad2b363aef32e82'],
  ['3x5', 3, 0, 795, 795, '75a735710b7b7af7'],
  ['3x5', 3, 1, 1077, 1080, 'a2be1b6ec5017503'],
  ['3x5', 3, 2, 1359, 1365, '7b3271edeaf2147e'],
  ['3x5', 3, 3, 1641, 1650, '532a1a4928f93fee'],
];

/** Draw `text` at (1, 1) on a canvas sized to fit it, returning the canvas and the advance. */
function renderTight(text: string, opts: TextOptions): { canvas: Canvas; advance: number } {
  const font = opts.font ?? FONT_5x7;
  const scale = opts.scale ?? 1;
  const canvas = new Canvas(measureText(text, opts) + 2, font.height * scale + 2);
  const advance = drawText(canvas, text, 1, 1, 'white', opts);
  return { canvas, advance };
}

describe('FONT_5x7', () => {
  it('has 5px width and 7px height', () => {
    expect(FONT_5x7.width).toBe(5);
    expect(FONT_5x7.height).toBe(7);
  });

  it('has all printable ASCII glyphs (32-126)', () => {
    for (let i = 32; i <= 126; i++) {
      const ch = String.fromCharCode(i);
      expect(FONT_5x7.glyphs[ch], `missing glyph for '${ch}' (${i})`).toBeDefined();
    }
  });

  it('each glyph has exactly 7 rows', () => {
    for (const [ch, rows] of Object.entries(FONT_5x7.glyphs)) {
      expect(rows.length, `glyph '${ch}' has wrong row count`).toBe(7);
    }
  });
});

describe('FONT_3x5', () => {
  it('has 3px width and 5px height', () => {
    expect(FONT_3x5.width).toBe(3);
    expect(FONT_3x5.height).toBe(5);
  });

  it('has digits 0-9', () => {
    for (let i = 0; i <= 9; i++) {
      expect(FONT_3x5.glyphs[String(i)]).toBeDefined();
    }
  });

  it('has uppercase A-Z', () => {
    for (let i = 65; i <= 90; i++) {
      const ch = String.fromCharCode(i);
      expect(FONT_3x5.glyphs[ch], `missing '${ch}'`).toBeDefined();
    }
  });

  it('has lowercase a-z', () => {
    for (let i = 97; i <= 122; i++) {
      const ch = String.fromCharCode(i);
      expect(FONT_3x5.glyphs[ch], `missing '${ch}'`).toBeDefined();
    }
  });

  it('each glyph has exactly 5 rows', () => {
    for (const [ch, rows] of Object.entries(FONT_3x5.glyphs)) {
      expect(rows.length, `glyph '${ch}' has wrong row count`).toBe(5);
    }
  });
});

describe('measureText', () => {
  it('returns 0 for empty string', () => {
    expect(measureText('')).toBe(0);
  });

  it('measures a single character', () => {
    const w = measureText('A');
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThanOrEqual(FONT_5x7.width);
  });

  it('measures multi-character string with spacing', () => {
    const oneChar = measureText('A');
    const twoChar = measureText('AB');
    // Two chars = width(A) + spacing + width(B)
    expect(twoChar).toBeGreaterThan(oneChar);
  });

  it('space character has full font width', () => {
    const spaceW = measureText(' ');
    expect(spaceW).toBe(FONT_5x7.width);
  });

  it('respects scale option', () => {
    const normal = measureText('AB');
    const scaled = measureText('AB', { scale: 2 });
    expect(scaled).toBe(normal * 2);
  });

  it('respects letterSpacing option', () => {
    const tight = measureText('AB', { letterSpacing: 0 });
    const wide = measureText('AB', { letterSpacing: 3 });
    expect(wide).toBeGreaterThan(tight);
  });

  it('uses FONT_3x5 when specified', () => {
    const w5x7 = measureText('0');
    const w3x5 = measureText('0', { font: FONT_3x5 });
    expect(w3x5).toBeLessThanOrEqual(w5x7);
  });
});

describe('drawText', () => {
  it('draws visible pixels for text', () => {
    const c = new Canvas();
    drawText(c, 'A', 0, 0, [255, 0, 0]);
    // At least some pixel in the bounding box should be set
    let found = false;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        const [r] = c.getPixel(x, y);
        if (r === 255) found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('returns the cursor advance (measureText + trailing spacing)', () => {
    const c = new Canvas();
    const w = drawText(c, 'Hello', 0, 0, [255, 255, 255]);
    // drawText returns cx - x which includes trailing spacing (useful for appending text)
    // measureText strips trailing spacing (gives the tight visual width)
    const spacing = 1; // default letterSpacing
    expect(w).toBe(measureText('Hello') + spacing);
  });

  it('renders at an offset', () => {
    const c = new Canvas();
    drawText(c, 'A', 20, 30, [255, 0, 0]);
    // Pixels before the offset should be empty
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]);
    // Should have something near the offset
    let found = false;
    for (let y = 30; y < 37; y++) {
      for (let x = 20; x < 25; x++) {
        const [r] = c.getPixel(x, y);
        if (r === 255) found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('handles scale=2', () => {
    const c1 = new Canvas();
    drawText(c1, 'A', 0, 0, [255, 0, 0]);

    const c2 = new Canvas();
    drawText(c2, 'A', 0, 0, [255, 0, 0], { scale: 2 });

    // At scale 2, the character occupies more pixels
    let count1 = 0,
      count2 = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (c1.getPixel(x, y)[0] === 255) count1++;
        if (c2.getPixel(x, y)[0] === 255) count2++;
      }
    }
    // Scale 2 should have ~4x the pixels
    expect(count2).toBeGreaterThan(count1 * 3);
    expect(count2).toBeLessThanOrEqual(count1 * 4);
  });

  it('uses ? glyph for unknown characters', () => {
    const c = new Canvas();
    // Assuming the control character won't have a glyph, it should fall back to '?'
    drawText(c, '\x01', 0, 0, [255, 255, 255]);
    // The '?' glyph should render something
    const cq = new Canvas();
    drawText(cq, '?', 0, 0, [255, 255, 255]);
    // Both should produce the same output
    expect(Buffer.from(c.buffer).equals(Buffer.from(cq.buffer))).toBe(true);
  });
});

describe('finite positions and options', () => {
  const digest = (c: Canvas) => createHash('sha256').update(c.buffer).digest('hex').slice(0, 16);

  /** `[label, draw, advance, digest]` on a 64×40 canvas — the bytes of 0.9.0. */
  it.each<[string, (c: Canvas) => number, number, string]>([
    [
      'letterSpacing -1',
      (c) => drawText(c, 'Hello, World', 2, 3, 'white', { letterSpacing: -1 }),
      39,
      'dafa0830087dcf71',
    ],
    [
      'letterSpacing 0.5',
      (c) => drawText(c, 'Hello, World', 2, 3, 'white', { letterSpacing: 0.5 }),
      57,
      '47a7dcf05d26b9ea',
    ],
    [
      'a fractional position',
      (c) => drawText(c, 'Pixoo 64', 1.5, 2.25, 'white'),
      46,
      'f0ef300aa0b11a33',
    ],
    [
      'a negative position',
      (c) => drawText(c, 'Pixoo 64', -3, -2, 'white', { font: FONT_3x5 }),
      30,
      '6930723035e7f21c',
    ],
    ['scale 1.5', (c) => drawText(c, 'AbZ', 1, 1, 'white', { scale: 1.5 }), 27, '7f36bf43daa248c4'],
    [
      'scale 2.5 in FONT_3x5',
      (c) => drawText(c, 'AbZ', 1, 1, 'white', { scale: 2.5, font: FONT_3x5 }),
      30,
      '68f6808c5208b256',
    ],
    [
      'FONT_DIGITS_11x18 with letterSpacing 1',
      (c) => drawText(c, '12:45', 0, 10, 'white', { font: FONT_DIGITS_11x18, letterSpacing: 1 }),
      63,
      '5c07dec6e8f0e2ff',
    ],
  ])('draws with %s as before', (_label, draw, advance, expected) => {
    const c = new Canvas(64, 40);
    expect(draw(c)).toBe(advance);
    expect(digest(c)).toBe(expected);
  });

  it.each<[string, (c: Canvas) => void, string]>([
    [
      'scale 2',
      (c) => drawTextCentered(c, 'PIXOO', 4, 'white', { font: FONT_5x7, scale: 2 }),
      'fad5f10494c9aa27',
    ],
    [
      'a region and letterSpacing 2',
      (c) =>
        drawTextCentered(c, 'Hi', 20, 'white', { regionX: 10, regionWidth: 21, letterSpacing: 2 }),
      'ab955862c2257021',
    ],
  ])('centers with %s as before', (_label, draw, expected) => {
    const c = new Canvas(64, 40);
    draw(c);
    expect(digest(c)).toBe(expected);
  });

  it.each<[string, TextOptions, number]>([
    ['letterSpacing -1', { letterSpacing: -1 }, 17],
    ['letterSpacing 0.5', { letterSpacing: 0.5 }, 23],
    ['scale 1.5', { scale: 1.5 }, 25.5],
    ['scale 2.5 in FONT_3x5', { scale: 2.5, font: FONT_3x5 }, 27.5],
    ['FONT_DIGITS_11x18 with letterSpacing 1', { font: FONT_DIGITS_11x18, letterSpacing: 1 }, 62],
  ])('measures with %s as before', (label, opts, width) => {
    const text = label.startsWith('scale')
      ? 'AbZ'
      : label.startsWith('FONT_DIGITS')
        ? '12:45'
        : 'Hello';
    expect(measureText(text, opts)).toBe(width);
  });
});

describe('invalid text geometry', () => {
  const NON_FINITE: [string, number][] = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ];

  type Call = (c: Canvas, v: number, color: string) => unknown;

  /** `[function, option, message suffix, call]` — every numeric input a text call takes. */
  const GUARDED: [string, string, string, Call][] = [
    ['drawText', 'x', 'must be finite', (c, v, color) => drawText(c, 'A', v, 0, color)],
    ['drawText', 'y', 'must be finite', (c, v, color) => drawText(c, 'A', 0, v, color)],
    [
      'drawText',
      'scale',
      'must be a finite number of at least 1',
      (c, v, color) => drawText(c, 'A', 0, 0, color, { scale: v }),
    ],
    [
      'drawText',
      'letterSpacing',
      'must be finite',
      (c, v, color) => drawText(c, 'AB', 0, 0, color, { letterSpacing: v }),
    ],
    [
      'measureText',
      'scale',
      'must be a finite number of at least 1',
      (_c, v) => measureText('AB', { scale: v }),
    ],
    [
      'measureText',
      'letterSpacing',
      'must be finite',
      (_c, v) => measureText('AB', { letterSpacing: v }),
    ],
    [
      'drawTextCentered',
      'y',
      'must be finite',
      (c, v, color) => drawTextCentered(c, 'A', v, color),
    ],
    [
      'drawTextCentered',
      'scale',
      'must be a finite number of at least 1',
      (c, v, color) => drawTextCentered(c, 'A', 0, color, { scale: v }),
    ],
    [
      'drawTextCentered',
      'letterSpacing',
      'must be finite',
      (c, v, color) => drawTextCentered(c, 'AB', 0, color, { letterSpacing: v }),
    ],
    [
      'drawTextCentered',
      'regionX',
      'must be finite',
      (c, v, color) => drawTextCentered(c, 'A', 0, color, { regionX: v }),
    ],
    [
      'drawTextCentered',
      'regionWidth',
      'must be finite',
      (c, v, color) => drawTextCentered(c, 'A', 0, color, { regionWidth: v }),
    ],
  ];

  const cases = GUARDED.flatMap(([fn, option, rule, call]) =>
    NON_FINITE.map(
      ([valueName, value]) =>
        [fn, option, valueName, rule, call, value] as [
          string,
          string,
          string,
          string,
          Call,
          number,
        ],
    ),
  );

  it.each(cases)(
    '%s rejects %s = %s without drawing',
    (fn, option, valueName, rule, call, value) => {
      const c = new Canvas(16);
      c.setPixel(2, 2, [1, 2, 3], 17);
      const before = new Uint8Array(c.buffer);

      expect(() => call(c, value, 'white')).toThrow(
        new RangeError(`${fn} ${option} ${rule}; got ${valueName}`),
      );
      expect(c.buffer).toEqual(before);
    },
  );

  it.each(GUARDED)('%s checks %s before resolving the color', (fn, option, rule, call) => {
    expect(() => call(new Canvas(16), Number.NaN, 'not-a-color')).toThrow(
      new RangeError(`${fn} ${option} ${rule}; got NaN`),
    );
  });

  it.each<[string, (v: number) => unknown]>([
    ['drawText', (v) => drawText(new Canvas(16), 'A', 0, 0, 'white', { scale: v })],
    ['measureText', (v) => measureText('AB', { scale: v })],
    ['drawTextCentered', (v) => drawTextCentered(new Canvas(16), 'A', 0, 'white', { scale: v })],
  ])('%s rejects a scale below 1', (fn, call) => {
    for (const scale of [0, 0.5, 0.999, -1, -0]) {
      expect(() => call(scale), `scale ${scale}`).toThrow(
        new RangeError(`${fn} scale must be a finite number of at least 1; got ${scale}`),
      );
    }
  });

  it('reproduces the silent failures from the issue', () => {
    const canvas = new Canvas();
    expect(() => drawText(canvas, 'A', Number.NaN, 0, 'white')).toThrow(RangeError);
    expect(() => measureText('AB', { scale: Number.NaN })).toThrow(RangeError);
    expect(() => measureText('AB', { letterSpacing: Number.NaN })).toThrow(RangeError);
    expect(() => drawText(canvas, 'A', 0, 0, 'white', { scale: 0 })).toThrow(RangeError);
    expect(() => new Canvas().fillRect(Number.NaN, 0, 4, 4, 'white')).toThrow(RangeError);
  });

  it('validates the options of an empty string too', () => {
    expect(() => measureText('', { scale: 0 })).toThrow(RangeError);
    expect(() => drawText(new Canvas(8), '', Number.NaN, 0, 'white')).toThrow(RangeError);
  });

  it('accepts a scale of exactly 1 and any finite letterSpacing, negative included', () => {
    expect(measureText('AB', { scale: 1, letterSpacing: -3 })).toBe(measureText('AB') - 4);
    expect(drawText(new Canvas(16), 'A', -100, 1e9, 'white', { scale: 1 })).toBe(
      measureText('A') + 1,
    );
  });
});

describe('drawTextCentered', () => {
  it('centers text horizontally', () => {
    const c = new Canvas();
    drawTextCentered(c, 'Hi', 0, [255, 0, 0]);
    const textW = measureText('Hi');
    const expectedStart = Math.floor((64 - textW) / 2);

    // Check that roughly centered
    let minX = 64,
      maxX = 0;
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 7; y++) {
        if (c.getPixel(x, y)[0] === 255) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    expect(minX).toBeGreaterThanOrEqual(expectedStart - 1);
    expect(minX).toBeLessThanOrEqual(expectedStart + 1);
  });
});

describe('FONT_3x5 glyph distinctness', () => {
  it("'g' glyph is pixel-distinct from digit '9'", () => {
    const cg = new Canvas();
    drawText(cg, 'g', 0, 0, [255, 0, 0], { font: FONT_3x5 });

    const c9 = new Canvas();
    drawText(c9, '9', 0, 0, [255, 0, 0], { font: FONT_3x5 });

    // The rendered bitmaps must differ — previously 'g' was visually identical to '9'
    expect(Buffer.from(cg.buffer).equals(Buffer.from(c9.buffer))).toBe(false);
  });
});

describe('lowercase glyphs', () => {
  it('FONT_3x5 renders distinct lowercase glyphs', () => {
    const upper = new Canvas();
    drawText(upper, 'A', 0, 0, [255, 0, 0], { font: FONT_3x5 });

    const lower = new Canvas();
    drawText(lower, 'a', 0, 0, [255, 0, 0], { font: FONT_3x5 });

    // FONT_3x5 has distinct lowercase forms
    expect(lower.buffer).not.toEqual(upper.buffer);
  });

  it('FONT_5x7 renders distinct lowercase glyphs', () => {
    const upper = new Canvas();
    drawText(upper, 'A', 0, 0, [255, 0, 0], { font: FONT_5x7 });

    const lower = new Canvas();
    drawText(lower, 'a', 0, 0, [255, 0, 0], { font: FONT_5x7 });

    expect(lower.buffer).not.toEqual(upper.buffer);
  });

  it('auto-uppercases when font lacks a glyph', () => {
    // Create a font with only uppercase A
    const tinyFont = { width: 3, height: 3, glyphs: { A: [0b111, 0b101, 0b111] } };
    const upper = new Canvas();
    drawText(upper, 'A', 0, 0, [255, 0, 0], { font: tinyFont });

    const lower = new Canvas();
    drawText(lower, 'a', 0, 0, [255, 0, 0], { font: tinyFont });

    expect(lower.buffer).toEqual(upper.buffer);
  });
});

describe('proportional metrics (tight ink bounds)', () => {
  it('anchors narrow glyphs at the pen position', () => {
    // Center-aligned cells ('!' is column 2 of 5) must not leave phantom space left of the pen
    for (const ch of ['!', '.', ':', "'", '(', 'i']) {
      const c = new Canvas();
      drawText(c, ch, 0, 0, [255, 0, 0]);
      let minX = 64;
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 64; x++) {
          if (c.getPixel(x, y)[0] === 255) minX = Math.min(minX, x);
        }
      }
      expect(minX, `'${ch}' ink should start at the pen (x=0)`).toBe(0);
    }
  });

  it('measures narrow punctuation by ink width', () => {
    expect(measureText('!')).toBe(1);
    expect(measureText('.')).toBe(1);
    expect(measureText(':')).toBe(1);
    expect(measureText('(')).toBe(3);
  });

  it('advance covers exactly ink width + trailing spacing', () => {
    const c = new Canvas();
    expect(drawText(c, '!', 0, 0, [255, 0, 0])).toBe(2); // 1px ink + 1px spacing
  });

  it('renders symmetric gaps around narrow glyphs (H.H)', () => {
    const c = new Canvas();
    drawText(c, 'H.H', 0, 0, [255, 0, 0]);
    // H ink x=0..4, '.' ink at x=6 (bottom row), second H ink x=8..12
    expect(c.getPixel(6, 6)).toEqual([255, 0, 0]);
    expect(c.getPixel(5, 6)).toEqual([0, 0, 0]);
    expect(c.getPixel(7, 6)).toEqual([0, 0, 0]);
    expect(c.getPixel(8, 0)).toEqual([255, 0, 0]);
  });

  it('keeps tight metrics under scale', () => {
    const c = new Canvas();
    const w = drawText(c, '!', 0, 0, [255, 0, 0], { scale: 2 });
    expect(w).toBe(4); // (1px ink + 1px spacing) * 2
    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]); // ink starts at the pen even when scaled
  });

  it('measures a 32-wide row with bit 31 set the same, signed or unsigned', () => {
    // Columns 0 and 27 of a 32-pixel cell: ink 28 wide, starting at the cell's left edge
    const unsigned = 0x80000010;
    for (const row of [unsigned, unsigned | 0]) {
      const font: BitmapFont = { width: 32, height: 1, glyphs: { A: [row] } };
      expect(measureText('A', { font }), `row ${row}`).toBe(28);
      const c = new Canvas();
      expect(drawText(c, 'A', 0, 0, [255, 0, 0], { font }), `row ${row}`).toBe(29);
      expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
      expect(c.getPixel(27, 0)).toEqual([255, 0, 0]);
    }
  });
});

describe('font table characterization', () => {
  it("keeps FONT_5x7's printable-ASCII glyphs byte-identical", () => {
    // Update this digest only when an ASCII glyph of FONT_5x7 is deliberately edited.
    expect(asciiDigest(FONT_5x7)).toBe(
      'dac5b718165e8c9c99df5e954609adac1b2bb978c3ea5376cd536e12aab23073',
    );
  });

  it("keeps FONT_3x5's printable-ASCII glyphs byte-identical", () => {
    // Update this digest only when an ASCII glyph of FONT_3x5 is deliberately edited.
    expect(asciiDigest(FONT_3x5)).toBe(
      'd456ed2e8a53234df1c2b5d53d377d637d6ac70d804b6eb942afcf3e64d9177b',
    );
  });

  it.each(ASCII_RENDER_PINS)(
    'renders and measures ASCII in FONT_%s at scale %i, letterSpacing %i exactly as 0.8.2',
    (name, scale, letterSpacing, measured, advance, digest) => {
      const font = name === '5x7' ? FONT_5x7 : FONT_3x5;
      const opts = { font, scale, letterSpacing };
      expect(measureText(PRINTABLE_ASCII, opts)).toBe(measured);
      const drawn = renderTight(PRINTABLE_ASCII, opts);
      expect(drawn.advance).toBe(advance);
      expect(createHash('sha256').update(drawn.canvas.buffer).digest('hex').slice(0, 16)).toBe(
        digest,
      );
    },
  );

  it.each([
    ['5x7', FONT_5x7],
    ['3x5', FONT_3x5],
  ])('defaults letterSpacing to 1 in FONT_%s', (_name, font) => {
    const byDefault = renderTight(PRINTABLE_ASCII, { font });
    const explicit = renderTight(PRINTABLE_ASCII, { font, letterSpacing: 1 });
    expect(byDefault.advance).toBe(explicit.advance);
    expect(byDefault.canvas.buffer).toEqual(explicit.canvas.buffer);
    expect(measureText(PRINTABLE_ASCII, { font })).toBe(
      measureText(PRINTABLE_ASCII, { font, letterSpacing: 1 }),
    );
  });

  it("keeps FONT_3x5's existing digit rendering unchanged", () => {
    const c = new Canvas();
    drawText(c, '50', 2, 2, 'white', { font: FONT_3x5 });
    expect(inkColumns(c)).toEqual([2, 3, 4, 6, 7, 8]);
    expect(measureText('50', { font: FONT_3x5 })).toBe(7);
  });
});

describe('FONT_3x5 printable-ASCII coverage', () => {
  it('defines a glyph for every character FONT_5x7 defines', () => {
    const missing = Object.keys(FONT_5x7.glyphs).filter((ch) => !FONT_3x5.glyphs[ch]);
    expect(missing, `FONT_3x5 is missing: ${missing.join(' ')}`).toEqual([]);
  });

  it('keeps every FONT_3x5 row inside the 3-bit cell', () => {
    for (const [ch, rows] of Object.entries(FONT_3x5.glyphs)) {
      rows.forEach((row, i) => {
        expect(row, `FONT_3x5 '${ch}' row ${i} escapes the cell`).toBeGreaterThanOrEqual(0);
        expect(row, `FONT_3x5 '${ch}' row ${i} escapes the cell`).toBeLessThanOrEqual(0b111);
      });
    }
  });

  it('keeps every FONT_5x7 row inside the 5-bit cell', () => {
    for (const [ch, rows] of Object.entries(FONT_5x7.glyphs)) {
      rows.forEach((row, i) => {
        expect(row, `FONT_5x7 '${ch}' row ${i} escapes the cell`).toBeGreaterThanOrEqual(0);
        expect(row, `FONT_5x7 '${ch}' row ${i} escapes the cell`).toBeLessThanOrEqual(0b11111);
      });
    }
  });

  it('gives confusable pairs different bitmaps', () => {
    for (const [a, b] of CONFUSABLE_PAIRS) {
      const ga = FONT_3x5.glyphs[a];
      const gb = FONT_3x5.glyphs[b];
      expect(ga, `FONT_3x5 missing '${a}'`).toBeDefined();
      expect(gb, `FONT_3x5 missing '${b}'`).toBeDefined();
      expect(ga, `'${a}' and '${b}' share a bitmap`).not.toEqual(gb);
    }
  });

  it('gives every FONT_3x5 glyph a bitmap no other glyph shares', () => {
    expect(collisions(FONT_3x5)).toEqual([]);
  });

  it('gives every FONT_5x7 glyph a bitmap no other glyph shares', () => {
    expect(collisions(FONT_5x7)).toEqual([]);
  });
});

describe('FONT_3x5 lowercase p', () => {
  it('renders distinctly from uppercase P', () => {
    const lower = new Canvas();
    drawText(lower, 'p', 0, 0, [255, 0, 0], { font: FONT_3x5 });
    const upper = new Canvas();
    drawText(upper, 'P', 0, 0, [255, 0, 0], { font: FONT_3x5 });

    expect(Buffer.from(lower.buffer).equals(Buffer.from(upper.buffer))).toBe(false);
  });

  it('sits below the cap line and descends past the other bowls', () => {
    const rows = FONT_3x5.glyphs['p'];
    expect(rows).toBeDefined();
    // Lowercase form: no ink on the cap row, ink on the descender row.
    expect(rows![0], 'p should not reach the cap line').toBe(0b000);
    expect(rows![4], 'p should carry a descender stem').toBeGreaterThan(0);
  });

  it('stays distinct from the glyphs it neighbours in shape', () => {
    for (const other of ['P', 'b', 'q', '9', 'o']) {
      expect(FONT_3x5.glyphs['p'], `'p' matches '${other}'`).not.toEqual(FONT_3x5.glyphs[other]);
    }
  });
});

describe('FONT_3x5 missing-glyph fallback', () => {
  it('renders the ? marker for an unknown character', () => {
    const unknown = new Canvas();
    drawText(unknown, '\x01', 0, 0, [255, 255, 255], { font: FONT_3x5 });
    expect(inkPixels(unknown).length).toBeGreaterThan(0);

    const marker = new Canvas();
    drawText(marker, '?', 0, 0, [255, 255, 255], { font: FONT_3x5 });
    expect(Buffer.from(unknown.buffer).equals(Buffer.from(marker.buffer))).toBe(true);
  });

  it('keeps the fallback visible mid-string', () => {
    const withUnknown = new Canvas();
    drawText(withUnknown, 'A\x01B', 1, 1, 'white', { font: FONT_3x5 });
    const withoutUnknown = new Canvas();
    drawText(withoutUnknown, 'AB', 1, 1, 'white', { font: FONT_3x5 });

    expect(inkPixels(withUnknown).length).toBeGreaterThan(inkPixels(withoutUnknown).length);
    expect(inkSpan(withUnknown)!.width).toBe(measureText('A\x01B', { font: FONT_3x5 }));
    expect(inkSpan(withUnknown)!.width).toBe(measureText('A?B', { font: FONT_3x5 }));
  });

  it("draws strictly more ink for '50%' than for '50'", () => {
    const withPercent = new Canvas();
    drawText(withPercent, '50%', 2, 2, 'white', { font: FONT_3x5 });
    const withoutPercent = new Canvas();
    drawText(withoutPercent, '50', 2, 2, 'white', { font: FONT_3x5 });

    expect(inkPixels(withPercent).length).toBeGreaterThan(inkPixels(withoutPercent).length);
    expect(inkColumns(withPercent)).not.toEqual(inkColumns(withoutPercent));
    expect(inkSpan(withPercent)!.max).toBeGreaterThan(inkSpan(withoutPercent)!.max);
  });
});

describe('FONT_3x5 metrics for the added characters', () => {
  it('measures each added glyph as its drawn ink span', () => {
    for (const ch of ADDED_3x5) {
      const c = new Canvas();
      drawText(c, ch, 2, 2, [0, 255, 0], { font: FONT_3x5 });
      const span = inkSpan(c);
      expect(span, `'${ch}' drew no ink`).not.toBeNull();
      expect(span!.min, `'${ch}' ink should start at the pen`).toBe(2);
      expect(span!.width, `'${ch}' ink span should equal measureText`).toBe(
        measureText(ch, { font: FONT_3x5 }),
      );
    }
  });

  it('measures runs of added characters as their drawn ink span', () => {
    for (let i = 0; i < ADDED_3x5.length; i += 5) {
      const run = ADDED_3x5.slice(i, i + 5);
      const c = new Canvas();
      drawText(c, run, 1, 1, [0, 255, 0], { font: FONT_3x5 });
      const span = inkSpan(c);
      expect(span, `'${run}' drew no ink`).not.toBeNull();
      expect(span!.min, `'${run}' ink should start at the pen`).toBe(1);
      expect(span!.width, `'${run}' ink span should equal measureText`).toBe(
        measureText(run, { font: FONT_3x5 }),
      );
    }
  });

  it('measures and draws an empty string as nothing', () => {
    const c = new Canvas();
    expect(measureText('', { font: FONT_3x5 })).toBe(0);
    expect(drawText(c, '', 0, 0, [255, 0, 0], { font: FONT_3x5 })).toBe(0);
    expect(inkPixels(c)).toEqual([]);
  });

  it('scales an added glyph without breaking tight metrics', () => {
    const one = new Canvas();
    drawText(one, '%', 0, 0, [255, 0, 0], { font: FONT_3x5 });
    const two = new Canvas();
    drawText(two, '%', 0, 0, [255, 0, 0], { font: FONT_3x5, scale: 2 });

    expect(inkPixels(two).length).toBe(inkPixels(one).length * 4);
    expect(inkSpan(two)!.min).toBe(0);
    expect(inkSpan(two)!.width).toBe(inkSpan(one)!.width * 2);
    expect(measureText('%', { font: FONT_3x5, scale: 2 })).toBe(
      measureText('%', { font: FONT_3x5 }) * 2,
    );
  });

  it('honors letterSpacing between added glyphs', () => {
    const tight = measureText('<>', { font: FONT_3x5, letterSpacing: 0 });
    const wide = measureText('<>', { font: FONT_3x5, letterSpacing: 3 });
    expect(wide - tight).toBe(3);

    const c = new Canvas();
    drawText(c, '<>', 0, 0, [255, 0, 0], { font: FONT_3x5, letterSpacing: 0 });
    expect(inkSpan(c)!.width).toBe(tight);
  });
});

/** Characters past ASCII that both built-in fonts define. */
const SYMBOLS = [...'°←↑→↓▲▼♥·…'];

const BUILT_IN_FONTS = [
  ['5x7', FONT_5x7],
  ['3x5', FONT_3x5],
] as const;

describe('built-in glyphs past ASCII', () => {
  it.each(BUILT_IN_FONTS)('FONT_%s defines ° ← ↑ → ↓ ▲ ▼ ♥ · …', (_name, font) => {
    expect(SYMBOLS.filter((ch) => !font.glyphs[ch])).toEqual([]);
    expect(Object.keys(font.glyphs)).toHaveLength(95 + SYMBOLS.length);
  });

  it.each(BUILT_IN_FONTS)('FONT_%s draws each as its own ink at the pen', (_name, font) => {
    const marker = new Canvas(16, 16);
    drawText(marker, '?', 2, 2, 'white', { font });
    for (const ch of SYMBOLS) {
      const c = new Canvas(16, 16);
      const advance = drawText(c, ch, 2, 2, 'white', { font });
      const span = inkSpan(c);
      expect(span, `'${ch}' drew no ink`).not.toBeNull();
      expect(span!.min, `'${ch}' ink should start at the pen`).toBe(2);
      expect(span!.width, `'${ch}' ink span should equal measureText`).toBe(
        measureText(ch, { font }),
      );
      expect(advance).toBe(measureText(ch, { font }) + 1);
      expect(c.buffer, `'${ch}' drew the ? marker`).not.toEqual(marker.buffer);
      for (const [, y] of inkPixels(c)) {
        expect(y, `'${ch}' escapes the cell`).toBeLessThan(2 + font.height);
      }
    }
  });

  it("keeps FONT_3x5's arrows and ellipsis clear of +, <, >, and _", () => {
    const g = FONT_3x5.glyphs;
    expect(g['←']).not.toEqual(g['+']);
    expect(g['→']).not.toEqual(g['+']);
    expect(g['←']).not.toEqual(g['<']);
    expect(g['→']).not.toEqual(g['>']);
    expect(g['…']).not.toEqual(g['_']);
    expect(g['·']).not.toEqual(g['.']);
  });

  it('sets 72°F ▲ with the degree sign and triangle, not ? markers', () => {
    for (const [, font] of BUILT_IN_FONTS) {
      const symbols = new Canvas();
      drawText(symbols, '72°F ▲', 1, 1, 'white', { font });
      const markers = new Canvas();
      drawText(markers, '72?F ?', 1, 1, 'white', { font });
      expect(symbols.buffer).not.toEqual(markers.buffer);
      expect(inkSpan(symbols)!.width).toBe(measureText('72°F ▲', { font }));
    }
  });
});

describe('code-point iteration', () => {
  it('measures an astral character as one ? marker', () => {
    expect(measureText('😀')).toBe(5);
    expect(measureText('😀', { font: FONT_3x5 })).toBe(3);
  });

  it.each(BUILT_IN_FONTS)('draws one ? marker for an astral character in FONT_%s', (_n, font) => {
    const astral = new Canvas();
    const advance = drawText(astral, '😀', 0, 0, 'white', { font });
    const marker = new Canvas();
    drawText(marker, '?', 0, 0, 'white', { font });
    expect(astral.buffer).toEqual(marker.buffer);
    expect(advance).toBe(measureText('?', { font }) + 1);
  });

  it('measures and draws a mid-string astral character like a ?', () => {
    const astral = new Canvas();
    const astralAdvance = drawText(astral, 'A😀B', 1, 1, 'white');
    const marker = new Canvas();
    const markerAdvance = drawText(marker, 'A?B', 1, 1, 'white');
    expect(astral.buffer).toEqual(marker.buffer);
    expect(astralAdvance).toBe(markerAdvance);
    expect(measureText('A😀B')).toBe(measureText('A?B'));
  });
});

/**
 * A hand-built font mixing glyphs placed by `metrics` with one ('T') left to
 * tight ink metrics.
 */
const PLACED_FONT: BitmapFont = {
  width: 4,
  height: 6,
  glyphs: {
    A: [0b11, 0b11],
    B: [0b1],
    T: [0b1111, 0b0110],
    '?': [0b1],
  },
  metrics: {
    A: { width: 2, x: 1, y: 3, advance: 5 },
    B: { width: 1, x: -1, y: 5, advance: 2 },
    '?': { width: 1, x: 0, y: 0, advance: 2 },
  },
};

describe('per-glyph metrics', () => {
  it('draws each glyph at (pen + x, top + y) and advances by advance', () => {
    const c = new Canvas();
    const advance = drawText(c, 'AB', 10, 20, 'white', { font: PLACED_FONT });
    expect(inkPixels(c)).toEqual([
      [11, 23],
      [12, 23],
      [11, 24],
      [12, 24],
      [14, 25],
    ]);
    expect(advance).toBe(7);
    expect(measureText('AB', { font: PLACED_FONT })).toBe(7);
  });

  it('defaults letterSpacing to 0 and adds an explicit one after each advance', () => {
    const c = new Canvas();
    const advance = drawText(c, 'AB', 10, 20, 'white', { font: PLACED_FONT, letterSpacing: 2 });
    expect(inkPixels(c)).toContainEqual([16, 25]);
    expect(advance).toBe(11);
    expect(measureText('AB', { font: PLACED_FONT, letterSpacing: 2 })).toBe(9);
  });

  it('scales offsets and advances', () => {
    const c = new Canvas();
    const advance = drawText(c, 'AB', 0, 0, 'white', { font: PLACED_FONT, scale: 2 });
    const expected: [number, number][] = [];
    for (let y = 6; y < 10; y++) for (let x = 2; x < 6; x++) expected.push([x, y]);
    expected.push([8, 10], [9, 10], [8, 11], [9, 11]);
    expect(inkPixels(c).toSorted(([ax, ay], [bx, by]) => ay - by || ax - bx)).toEqual(
      expected.toSorted(([ax, ay], [bx, by]) => ay - by || ax - bx),
    );
    expect(advance).toBe(14);
    expect(measureText('AB', { font: PLACED_FONT, scale: 2 })).toBe(14);
  });

  it('keeps tight ink metrics for a glyph with no metrics entry', () => {
    const c = new Canvas();
    const advance = drawText(c, 'TA', 0, 0, 'white', { font: PLACED_FONT });
    expect(inkPixels(c)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [1, 1],
      [2, 1],
      [5, 3],
      [6, 3],
      [5, 4],
      [6, 4],
    ]);
    expect(advance).toBe(9);
    expect(measureText('TA', { font: PLACED_FONT })).toBe(9);
  });

  it("places a missing character by the '?' glyph's metrics", () => {
    const missing = new Canvas();
    const marker = new Canvas();
    expect(drawText(missing, 'AZ', 3, 3, 'white', { font: PLACED_FONT })).toBe(
      drawText(marker, 'A?', 3, 3, 'white', { font: PLACED_FONT }),
    );
    expect(missing.buffer).toEqual(marker.buffer);
  });

  it('centers by summed advances', () => {
    const c = new Canvas();
    drawTextCentered(c, 'AB', 0, 'white', { font: PLACED_FONT });
    // (64 - 7) / 2 floors to 28; A's bitmap starts one pixel right of the pen.
    expect(inkSpan(c)!.min).toBe(29);
  });
});

describe('glyph width cap', () => {
  it('rejects a hand-built font wider than 32 pixels', () => {
    const wide: BitmapFont = { width: 40, height: 1, glyphs: { A: [2 ** 39] } };
    expect(() => measureText('A', { font: wide })).toThrow(RangeError);
    expect(() => drawText(new Canvas(), 'A', 0, 0, 'white', { font: wide })).toThrow(RangeError);
  });

  it('rejects a font with any metrics entry wider than 32 pixels', () => {
    const wide: BitmapFont = {
      width: 8,
      height: 1,
      glyphs: { A: [1], B: [1] },
      metrics: {
        A: { width: 1, x: 0, y: 0, advance: 2 },
        B: { width: 33, x: 0, y: 0, advance: 34 },
      },
    };
    expect(() => measureText('A', { font: wide })).toThrow(RangeError);
    expect(() => drawText(new Canvas(), 'A', 0, 0, 'white', { font: wide })).toThrow(RangeError);
  });

  it('draws all 32 columns of a 32-pixel glyph, with or without metrics', () => {
    const tight: BitmapFont = { width: 32, height: 2, glyphs: { A: [0xffffffff, 0x80000001] } };
    const placed: BitmapFont = {
      ...tight,
      metrics: { A: { width: 32, x: 0, y: 0, advance: 33 } },
    };
    for (const font of [tight, placed]) {
      const c = new Canvas();
      drawText(c, 'A', 0, 0, 'white', { font });
      expect(inkColumns(c)).toEqual(Array.from({ length: 32 }, (_, i) => i));
      expect(inkPixels(c).filter(([, y]) => y === 1)).toEqual([
        [0, 1],
        [31, 1],
      ]);
    }
    expect(measureText('A', { font: tight })).toBe(32);
    expect(measureText('A', { font: placed })).toBe(33);
  });
});

/**
 * A BDF font with a proportional glyph ('i'), a descender at a negative x
 * offset ('j'), an astral glyph that takes the font-level DWIDTH, a zero-size
 * space, and an unencoded glyph. Ascent 8, descent 2.
 */
const BDF_LINES: readonly string[] = [
  'STARTFONT 2.1',
  'COMMENT fixture for parseBdf',
  'FONT -fixture-test-medium-r-normal--10-100-75-75-p-60-ISO10646-1',
  'SIZE 10 75 75',
  'FONTBOUNDINGBOX 6 10 -1 -2',
  'DWIDTH 6 0',
  'STARTPROPERTIES 5',
  'FONT_ASCENT 8',
  'FONT_DESCENT 2',
  'CHARSET_REGISTRY "ISO10646"',
  'CHARSET_ENCODING "1"',
  'DEFAULT_CHAR 63',
  'ENDPROPERTIES',
  'CHARS 5',
  'STARTCHAR space',
  'ENCODING 32',
  'SWIDTH 400 0',
  'DWIDTH 4 0',
  'BBX 0 0 0 0',
  'BITMAP',
  'ENDCHAR',
  'STARTCHAR i',
  'ENCODING 105',
  'SWIDTH 300 0',
  'DWIDTH 3 0',
  'BBX 1 6 1 0',
  'BITMAP',
  '80',
  '00',
  '80',
  '80',
  '80',
  '80',
  'ENDCHAR',
  'STARTCHAR j',
  'ENCODING 106',
  'DWIDTH 3 0',
  'BBX 3 8 -1 -2',
  'BITMAP',
  '20',
  '00',
  '20',
  '20',
  '20',
  '20',
  '20',
  'C0',
  'ENDCHAR',
  'STARTCHAR grinning',
  'ENCODING 128512',
  'BBX 5 5 0 1',
  'BITMAP',
  '70',
  '88',
  'D8',
  '88',
  '70',
  'ENDCHAR',
  'STARTCHAR unencoded',
  'ENCODING -1',
  'DWIDTH 4 0',
  'BBX 2 2 0 0',
  'BITMAP',
  'C0',
  'C0',
  'ENDCHAR',
  'ENDFONT',
];

const BDF = BDF_LINES.join('\n');

/** 1-based line number of the `occurrence`-th line equal to `text`. */
function lineOf(lines: readonly string[], text: string, occurrence = 1): number {
  let seen = 0;
  const index = lines.findIndex((line) => line === text && ++seen === occurrence);
  if (index < 0) throw new Error(`fixture has no line ${JSON.stringify(text)}`);
  return index + 1;
}

/** The fixture with the 1-based line `line` replaced by `replacement` (none removes it). */
function withLine(line: number, ...replacement: string[]): string[] {
  return [...BDF_LINES.slice(0, line - 1), ...replacement, ...BDF_LINES.slice(line)];
}

/** A one-glyph BDF font whose glyph 'A' has the given BBX and bitmap rows. */
function singleGlyphBdf(bbx: string, rows: readonly string[], header: readonly string[] = []) {
  return [
    'STARTFONT 2.1',
    `FONTBOUNDINGBOX ${bbx}`,
    ...header,
    'STARTCHAR A',
    'ENCODING 65',
    `DWIDTH ${bbx.split(' ')[0]} 0`,
    `BBX ${bbx}`,
    'BITMAP',
    ...rows,
    'ENDCHAR',
    'ENDFONT',
  ].join('\n');
}

describe('parseBdf', () => {
  it('reads the bounding box, ascent + descent, and every encoded glyph', () => {
    const font = parseBdf(BDF);
    expect(font.width).toBe(6);
    expect(font.height).toBe(10);
    expect(Object.keys(font.glyphs).toSorted()).toEqual([' ', 'i', 'j', '😀'].toSorted());
    expect(font.metrics).toEqual({
      ' ': { width: 0, x: 0, y: 8, advance: 4 },
      i: { width: 1, x: 1, y: 2, advance: 3 },
      j: { width: 3, x: -1, y: 2, advance: 3 },
      '😀': { width: 5, x: 0, y: 2, advance: 6 },
    });
    expect(font.glyphs['j']).toEqual([1, 0, 1, 1, 1, 1, 1, 0b110]);
    expect(font.glyphs['😀']).toEqual([0b01110, 0b10001, 0b11011, 0b10001, 0b01110]);
  });

  it('draws each glyph at the pixels its BBX and DWIDTH give, on a shared baseline', () => {
    const font = parseBdf(BDF);
    const c = new Canvas();
    const advance = drawText(c, ' ij😀', 10, 0, 'white', { font });
    const expected: [number, number][] = [
      // 'i' at pen 14 + 1: dot on row 2, stem on rows 4–7 ending at the baseline
      [15, 2],
      [15, 4],
      [15, 5],
      [15, 6],
      [15, 7],
      // 'j' at pen 17 − 1: dot on row 2, stem on rows 4–8, hook on row 9 below the baseline
      [18, 2],
      [18, 4],
      [18, 5],
      [18, 6],
      [18, 7],
      [18, 8],
      [16, 9],
      [17, 9],
      // U+1F600 at pen 20, font-level DWIDTH, one row above the baseline
      [21, 2],
      [22, 2],
      [23, 2],
      [20, 3],
      [24, 3],
      [20, 4],
      [21, 4],
      [23, 4],
      [24, 4],
      [20, 5],
      [24, 5],
      [21, 6],
      [22, 6],
      [23, 6],
    ];
    const byRow = ([ax, ay]: [number, number], [bx, by]: [number, number]) => ay - by || ax - bx;
    expect(inkPixels(c).toSorted(byRow)).toEqual(expected.toSorted(byRow));
    expect(advance).toBe(16);
    expect(measureText(' ij😀', { font })).toBe(16);
  });

  it('draws a character the font lacks as one ? only when the font defines one', () => {
    const font = parseBdf(BDF);
    // No '?' in the fixture: an unknown character advances the bounding-box width.
    expect(measureText('iXi', { font })).toBe(3 + 6 + 3);
  });

  it('takes ascent and descent from the bounding box when the properties omit them', () => {
    const lines = BDF_LINES.filter((line) => !/^FONT_(ASCENT|DESCENT) /.test(line));
    expect(parseBdf(lines.join('\n'))).toEqual(parseBdf(BDF));
  });

  it('accepts CRLF line endings, blank lines, and an ISO8859-1 registry', () => {
    const latin1 = BDF_LINES.map((line) =>
      line.startsWith('CHARSET_REGISTRY') ? 'CHARSET_REGISTRY "ISO8859"' : line,
    );
    expect(parseBdf(latin1.join('\r\n'))).toEqual(parseBdf(BDF));
    expect(parseBdf(BDF_LINES.join('\n\n'))).toEqual(parseBdf(BDF));
  });

  it('draws all 32 columns of a 32-pixel glyph', () => {
    const font = parseBdf(singleGlyphBdf('32 2 0 0', ['FFFFFFFF', '80000001']));
    const c = new Canvas();
    drawText(c, 'A', 0, 0, 'white', { font });
    expect(inkColumns(c)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(inkPixels(c).filter(([, y]) => y === 1)).toEqual([
      [0, 1],
      [31, 1],
    ]);
  });

  it.each([
    ['empty input', '', 1],
    ['input that does not start with STARTFONT', BDF_LINES.slice(1).join('\n'), 1],
    ['input truncated mid-bitmap', BDF_LINES.slice(0, lineOf(BDF_LINES, 'D8')).join('\n'), 55],
    ['input truncated before ENDFONT', BDF_LINES.slice(0, -1).join('\n'), 66],
    [
      'a missing ENDCHAR',
      withLine(lineOf(BDF_LINES, 'ENDCHAR', 2)).join('\n'),
      lineOf(BDF_LINES, 'STARTCHAR j') - 1,
    ],
    [
      'a missing ENDCHAR before ENDFONT',
      withLine(lineOf(BDF_LINES, 'ENDCHAR', 5)).join('\n'),
      lineOf(BDF_LINES, 'ENDFONT') - 1,
    ],
    [
      'a BBX with three integers',
      withLine(lineOf(BDF_LINES, 'BBX 1 6 1 0'), 'BBX 1 6 1').join('\n'),
      lineOf(BDF_LINES, 'BBX 1 6 1 0'),
    ],
    [
      'a DWIDTH with one integer',
      withLine(lineOf(BDF_LINES, 'DWIDTH 3 0'), 'DWIDTH 3').join('\n'),
      lineOf(BDF_LINES, 'DWIDTH 3 0'),
    ],
    [
      'a FONTBOUNDINGBOX with a non-integer',
      withLine(lineOf(BDF_LINES, 'FONTBOUNDINGBOX 6 10 -1 -2'), 'FONTBOUNDINGBOX 6 ten -1 -2').join(
        '\n',
      ),
      lineOf(BDF_LINES, 'FONTBOUNDINGBOX 6 10 -1 -2'),
    ],
    [
      'an ENCODING with two integers',
      withLine(lineOf(BDF_LINES, 'ENCODING 105'), 'ENCODING 105 7').join('\n'),
      lineOf(BDF_LINES, 'ENCODING 105'),
    ],
    [
      'a BITMAP one row short of the BBX height',
      withLine(lineOf(BDF_LINES, '00')).join('\n'),
      lineOf(BDF_LINES, 'ENDCHAR', 2) - 1,
    ],
    [
      'a BITMAP one row past the BBX height',
      withLine(lineOf(BDF_LINES, 'ENDCHAR', 2), '80', 'ENDCHAR').join('\n'),
      lineOf(BDF_LINES, 'ENDCHAR', 2),
    ],
    ['a non-hex row', withLine(lineOf(BDF_LINES, '00'), '0G').join('\n'), lineOf(BDF_LINES, '00')],
    [
      'a glyph with no DWIDTH and no font-level DWIDTH',
      withLine(lineOf(BDF_LINES, 'DWIDTH 6 0')).join('\n'),
      lineOf(BDF_LINES, 'STARTCHAR grinning') - 1,
    ],
    [
      'a glyph with no ENCODING',
      withLine(lineOf(BDF_LINES, 'ENCODING 106')).join('\n'),
      lineOf(BDF_LINES, 'STARTCHAR j'),
    ],
    [
      'a BITMAP before its BBX',
      withLine(lineOf(BDF_LINES, 'BBX 1 6 1 0')).join('\n'),
      lineOf(BDF_LINES, 'BBX 1 6 1 0'),
    ],
    [
      'an ENCODING past U+10FFFF',
      withLine(lineOf(BDF_LINES, 'ENCODING 128512'), 'ENCODING 1114112').join('\n'),
      lineOf(BDF_LINES, 'ENCODING 128512'),
    ],
    [
      'a missing FONTBOUNDINGBOX',
      withLine(lineOf(BDF_LINES, 'FONTBOUNDINGBOX 6 10 -1 -2')).join('\n'),
      lineOf(BDF_LINES, 'STARTCHAR space') - 1,
    ],
  ])('throws SyntaxError naming the line for %s', (_label, text, line) => {
    expect(() => parseBdf(text)).toThrow(SyntaxError);
    expect(() => parseBdf(text)).toThrow(new RegExp(`^BDF line ${line}: `));
  });

  it.each([
    ['a 33-pixel glyph', singleGlyphBdf('33 1 0 0', ['FFFFFFFF80']), 2],
    [
      'a KOI8-R font',
      singleGlyphBdf('8 1 0 0', ['FF'], ['CHARSET_REGISTRY "KOI8"', 'CHARSET_ENCODING "R"']),
      3,
    ],
    [
      'an ISO8859-5 font',
      singleGlyphBdf('8 1 0 0', ['FF'], ['CHARSET_REGISTRY "ISO8859"', 'CHARSET_ENCODING "5"']),
      3,
    ],
  ])('throws RangeError naming the line for %s', (_label, text, line) => {
    expect(() => parseBdf(text)).toThrow(RangeError);
    expect(() => parseBdf(text)).toThrow(new RegExp(`^BDF line ${line}: `));
  });

  it('throws RangeError for a glyph 33 pixels wide inside a narrower bounding box', () => {
    const lines = withLine(lineOf(BDF_LINES, 'BBX 1 6 1 0'), 'BBX 33 6 1 0');
    expect(() => parseBdf(lines.join('\n'))).toThrow(RangeError);
    expect(() => parseBdf(lines.join('\n'))).toThrow(
      new RegExp(`^BDF line ${lineOf(BDF_LINES, 'BBX 1 6 1 0')}: `),
    );
  });
});

describe('FONT_DIGITS_11x18', () => {
  const font = FONT_DIGITS_11x18;
  const DIGITS = [...'0123456789'];

  it('defines 0–9, space, and : . - + / % ° ? — nothing else', () => {
    expect(Object.keys(font.glyphs).toSorted()).toEqual([...DIGITS, ...' :.-+/%°?'].toSorted());
    expect(Object.keys(font.metrics!).toSorted()).toEqual(Object.keys(font.glyphs).toSorted());
    expect(font.width).toBe(11);
    expect(font.height).toBe(18);
  });

  it('draws every digit as an 11×18 bitmap on one 13-pixel advance', () => {
    for (const d of DIGITS) {
      expect(font.glyphs[d], `'${d}' rows`).toHaveLength(18);
      expect(font.metrics![d], `'${d}' metrics`).toEqual({ width: 11, x: 1, y: 0, advance: 13 });
    }
  });

  it('keeps every glyph inside its bitmap, the 18-row line, and its advance', () => {
    for (const [ch, rows] of Object.entries(font.glyphs)) {
      const m = font.metrics![ch]!;
      expect(m.x, `'${ch}' x`).toBeGreaterThanOrEqual(0);
      expect(m.y, `'${ch}' y`).toBeGreaterThanOrEqual(0);
      expect(m.y + rows.length, `'${ch}' bottom`).toBeLessThanOrEqual(18);
      expect(m.x + m.width, `'${ch}' right edge`).toBeLessThanOrEqual(m.advance);
      rows.forEach((row, i) => {
        expect(row, `'${ch}' row ${i}`).toBeGreaterThanOrEqual(0);
        expect(row, `'${ch}' row ${i}`).toBeLessThan(2 ** m.width);
      });
      if (ch !== ' ') {
        expect(
          rows.some((row) => row > 0),
          `'${ch}' has no ink`,
        ).toBe(true);
      }
    }
  });

  it('gives every glyph a bitmap no other glyph shares', () => {
    expect(collisions(font)).toEqual([]);
  });

  it('measures the same width for any time of day', () => {
    expect(measureText('11:11', { font })).toBe(measureText('22:22', { font }));
    expect(measureText('00:00', { font })).toBe(measureText('18:59', { font }));
  });

  it('sets 12:45 and -12.5° in 60 pixels or less', () => {
    expect(measureText('12:45', { font })).toBeLessThanOrEqual(60);
    expect(measureText('-12.5°', { font })).toBeLessThanOrEqual(60);
  });

  it('centers 12:45 with left and right ink margins within 1 pixel', () => {
    const c = new Canvas();
    drawTextCentered(c, '12:45', 40, 'white', { font });
    const span = inkSpan(c)!;
    expect(Math.abs(span.min - (63 - span.max))).toBeLessThanOrEqual(1);
    for (const [, y] of inkPixels(c)) {
      expect(y).toBeGreaterThanOrEqual(40);
      expect(y).toBeLessThan(40 + 18);
    }
  });

  it('draws the ? glyph, not a blank, for a character the face lacks', () => {
    for (const missing of ['F', 'f', 'é', '😀']) {
      const c = new Canvas();
      const marker = new Canvas();
      expect(drawText(c, `1${missing}`, 0, 0, 'white', { font })).toBe(
        drawText(marker, '1?', 0, 0, 'white', { font }),
      );
      expect(c.buffer, `'${missing}'`).toEqual(marker.buffer);
      expect(inkPixels(c).length).toBeGreaterThan(
        inkPixels(renderTight('1', { font }).canvas).length,
      );
    }
  });

  it('defaults letterSpacing to 0, so digits sit 2 pixels apart', () => {
    const c = new Canvas();
    drawText(c, '88', 0, 0, 'white', { font });
    // '8' fills columns 1–11 of its 13-pixel advance.
    expect(inkColumns(c)).not.toContain(12);
    expect(inkColumns(c)).not.toContain(13);
    expect(inkColumns(c)).toContain(14);
    expect(measureText('88', { font })).toBe(26);
  });
});
