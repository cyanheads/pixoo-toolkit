import { describe, it, expect, expectTypeOf } from 'vitest';
import { Canvas } from '../src/canvas.js';
import type { RGB } from '../src/color.js';
import {
  correctForPanel,
  downsample,
  quantize,
  simulatePanel,
  type Dither,
  type PanelResponse,
  type QuantizeOptions,
} from '../src/finish.js';
import type {
  Dither as CoreDither,
  PanelResponse as CorePanelResponse,
  QuantizeOptions as CoreQuantizeOptions,
} from '../src/core.js';
import type {
  Dither as BarrelDither,
  PanelResponse as BarrelPanelResponse,
  QuantizeOptions as BarrelQuantizeOptions,
} from '../src/index.js';

/** sRGB byte → linear light, from the IEC 61966-2-1 transfer function. */
function toLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light → sRGB byte, rounded. */
function toSrgb(l: number): number {
  const c = Math.min(1, Math.max(0, l));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
}

/** Deterministic PRNG (mulberry32) — the same stream on every run. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth three-channel gradient with two solid discs — thousands of distinct colors. */
function photo(width = 64, height = 64): Canvas {
  const c = new Canvas(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      c.setPixel(x, y, [
        (x * 255) / (width - 1),
        (y * 255) / (height - 1),
        ((x + y) * 255) / (width + height - 2),
      ]);
    }
  }
  c.fillCircle(width * 0.3, height * 0.4, width / 6, 'claude');
  c.fillCircle(width * 0.7, height * 0.6, width / 5, [30, 90, 200]);
  return c;
}

/** Random RGBA bytes, alpha included, with some fully transparent pixels. */
function noise(width: number, height: number, seed: number): Canvas {
  const next = prng(seed);
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
  for (let i = 3; i < bytes.length; i += 16) bytes[i] = 0;
  return Canvas.fromRgba(bytes, width, height);
}

/** Every pixel's stored RGBA, row-major. */
function pixels(c: Canvas): (readonly [number, number, number, number])[] {
  const out: (readonly [number, number, number, number])[] = [];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) out.push(c.getPixelRgba(x, y));
  }
  return out;
}

/** Distinct RGB among pixels with a non-zero alpha, packed 0xRRGGBB. */
function visibleColors(c: Canvas): Set<number> {
  const set = new Set<number>();
  for (const [r, g, b, a] of pixels(c)) if (a > 0) set.add((r << 16) | (g << 8) | b);
  return set;
}

/** Distinct flattened RGB triples (`toRgbBuffer`), packed 0xRRGGBB. */
function flatColors(c: Canvas): Set<number> {
  const rgb = c.toRgbBuffer();
  const set = new Set<number>();
  for (let i = 0; i < rgb.length; i += 3)
    set.add((rgb[i]! << 16) | (rgb[i + 1]! << 8) | rgb[i + 2]!);
  return set;
}

/** A canvas whose pixels are the given colors in one row, opaque. */
function row(colors: readonly RGB[]): Canvas {
  const c = new Canvas(colors.length, 1);
  colors.forEach((color, x) => c.setPixel(x, 0, color));
  return c;
}

/** `count` copies of a color. */
function times(color: RGB, count: number): RGB[] {
  return Array.from({ length: count }, () => color);
}

const DITHERS: readonly Dither[] = ['none', 'bayer4', 'floyd-steinberg'];

/**
 * An exact area average by brute force: every source pixel against every
 * output pixel, overlap measured in units of 1/(output size) source pixels,
 * color weighted by alpha in linear light.
 */
function referenceDownsample(src: Canvas, width: number, height: number): Canvas {
  const out = new Canvas(width, height);
  const overlap = (o: number, s: number, from: number, to: number) =>
    Math.max(0, Math.min((o + 1) * from, (s + 1) * to) - Math.max(o * from, s * to));
  for (let oy = 0; oy < height; oy++) {
    for (let ox = 0; ox < width; ox++) {
      let alpha = 0;
      const light = [0, 0, 0];
      for (let sy = 0; sy < src.height; sy++) {
        const wy = overlap(oy, sy, src.height, height);
        if (wy === 0) continue;
        for (let sx = 0; sx < src.width; sx++) {
          const wx = overlap(ox, sx, src.width, width);
          if (wx === 0) continue;
          const [r, g, b, a] = src.getPixelRgba(sx, sy);
          const w = wx * wy * a;
          alpha += w;
          light[0]! += w * toLinear(r);
          light[1]! += w * toLinear(g);
          light[2]! += w * toLinear(b);
        }
      }
      if (alpha === 0) continue;
      out.setPixel(
        ox,
        oy,
        [toSrgb(light[0]! / alpha), toSrgb(light[1]! / alpha), toSrgb(light[2]! / alpha)],
        Math.round(alpha / (src.width * src.height)),
      );
    }
  }
  return out;
}

describe('downsample', () => {
  it('averages a 512×512 red/blue checkerboard of 1-px cells to [188, 0, 188] at 64×64', () => {
    const board = new Canvas(512, 512);
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) board.setPixel(x, y, (x + y) % 2 === 0 ? 'red' : 'blue');
    }
    const out = downsample(board, 64, 64);
    expect([out.width, out.height]).toEqual([64, 64]);
    for (const px of pixels(out)) expect(px).toEqual([188, 0, 188, 255]);
  });

  it('weighs partial pixels exactly: black/white/black 3×1 → gray 156 twice at 2×1', () => {
    const out = downsample(
      row([
        [0, 0, 0],
        [255, 255, 255],
        [0, 0, 0],
      ]),
      2,
      1,
    );
    expect(pixels(out)).toEqual([
      [156, 156, 156, 255],
      [156, 156, 156, 255],
    ]);
  });

  it.each([
    [7, 5, 3, 2],
    [5, 7, 2, 3],
    [100, 70, 64, 48],
    [64, 64, 63, 17],
    [64, 64, 64, 16],
    [33, 1, 32, 1],
  ])(
    'matches an exact alpha-weighted area average from %i×%i to %i×%i',
    (sw, sh, width, height) => {
      const src = noise(sw, sh, sw * 1000 + sh);
      expect(downsample(src, width, height).buffer).toEqual(
        referenceDownsample(src, width, height).buffer,
      );
    },
  );

  it.each([
    [64, 64],
    [100, 77],
    [37, 64],
  ])(
    "keeps every channel of a hard-edged render within its footprint's source range at %i×%i",
    (width, height) => {
      const src = new Canvas(512, 512).clear([12, 20, 40]);
      const next = prng(7);
      for (let i = 0; i < 40; i++) {
        const color: RGB = [next() * 255, next() * 255, next() * 255];
        if (i % 3 === 0) src.fillCircle(next() * 512, next() * 512, 8 + next() * 60, color);
        else if (i % 3 === 1)
          src.fillRect(next() * 512, next() * 512, next() * 90, next() * 90, color);
        else
          src.drawLine(next() * 512, next() * 512, next() * 512, next() * 512, color, { width: 3 });
      }
      const out = downsample(src, width, height);
      const outside: string[] = [];
      let blended = 0;
      for (let oy = 0; oy < height; oy++) {
        const y0 = Math.floor((oy * 512) / height);
        const y1 = Math.ceil(((oy + 1) * 512) / height);
        for (let ox = 0; ox < width; ox++) {
          const x0 = Math.floor((ox * 512) / width);
          const x1 = Math.ceil(((ox + 1) * 512) / width);
          const lo = [255, 255, 255];
          const hi = [0, 0, 0];
          for (let sy = y0; sy < y1; sy++) {
            for (let sx = x0; sx < x1; sx++) {
              src.getPixel(sx, sy).forEach((v, ch) => {
                lo[ch] = Math.min(lo[ch]!, v);
                hi[ch] = Math.max(hi[ch]!, v);
              });
            }
          }
          const got = out.getPixelRgba(ox, oy);
          if (got[3] !== 255) outside.push(`(${ox}, ${oy}) alpha ${got[3]}`);
          for (let ch = 0; ch < 3; ch++) {
            if (got[ch]! < lo[ch]! || got[ch]! > hi[ch]!) {
              outside.push(`(${ox}, ${oy}) channel ${ch}: ${got[ch]} outside ${lo[ch]}–${hi[ch]}`);
            }
            if (lo[ch] !== hi[ch]) blended++;
          }
        }
      }
      expect(outside).toEqual([]);
      // The render has edges to cross: many footprints mix colors
      expect(blended).toBeGreaterThan(width * height * 0.1);
    },
  );

  it('weights color by alpha and averages alpha: [red α255, any α0] → [255, 0, 0, 128]', () => {
    const src = new Canvas(2, 1).setPixel(0, 0, 'red').setPixel(1, 0, 'lime', 0);
    expect(pixels(downsample(src, 1, 1))).toEqual([[255, 0, 0, 128]]);
  });

  it('leaves an all-transparent footprint [0, 0, 0, 0], whatever its hidden color', () => {
    const src = new Canvas(4, 2).clear('white');
    for (let y = 0; y < 2; y++) {
      src.setPixel(0, y, 'red', 0).setPixel(1, y, 'lime', 0);
    }
    expect(pixels(downsample(src, 2, 1))).toEqual([
      [0, 0, 0, 0],
      [255, 255, 255, 255],
    ]);
  });

  it('returns an equal copy, not the input, at the same size', () => {
    const src = photo(16, 12);
    src.setPixel(1, 1, 'red', 0).setPixel(2, 2, 'cyan', 90);
    const out = downsample(src, 16, 12);
    expect(out).not.toBe(src);
    expect(out.buffer).not.toBe(src.buffer);
    expect([out.width, out.height]).toEqual([16, 12]);
    expect(out.buffer).toEqual(src.buffer);
  });

  it('shrinks one axis and keeps the other', () => {
    const src = noise(8, 6, 3);
    expect(downsample(src, 8, 3).buffer).toEqual(referenceDownsample(src, 8, 3).buffer);
  });

  it.each([
    ['a width of 0', 0, 6, 'width must be an integer from 1 to 16; got 0'],
    ['a width of 1.5', 1.5, 6, 'width must be an integer from 1 to 16; got 1.5'],
    ['a NaN width', Number.NaN, 6, 'width must be an integer from 1 to 16; got NaN'],
    [
      'an infinite width',
      Number.POSITIVE_INFINITY,
      6,
      'width must be an integer from 1 to 16; got Infinity',
    ],
    ['a negative width', -4, 6, 'width must be an integer from 1 to 16; got -4'],
    ['a width past the source', 17, 6, 'width must be an integer from 1 to 16; got 17'],
    ['a height of 0', 8, 0, 'height must be an integer from 1 to 12; got 0'],
    ['a height of 1.5', 8, 1.5, 'height must be an integer from 1 to 12; got 1.5'],
    ['a NaN height', 8, Number.NaN, 'height must be an integer from 1 to 12; got NaN'],
    ['a height past the source', 8, 13, 'height must be an integer from 1 to 12; got 13'],
  ])('rejects %s for a 16×12 source', (_label, width, height, message) => {
    const call = () => downsample(photo(16, 12), width, height);
    expect(call).toThrow(RangeError);
    expect(call).toThrow(`downsample ${message}`);
  });

  it('never mutates its input', () => {
    const src = noise(20, 20, 9);
    const before = new Uint8Array(src.buffer);
    downsample(src, 7, 3);
    downsample(src, 20, 20);
    expect(src.buffer).toEqual(before);
  });
});

describe('quantize', () => {
  it.each(DITHERS)('leaves at most `colors` visible colors (dither %s)', (dither) => {
    const src = photo();
    expect(visibleColors(src).size).toBeGreaterThan(256);
    for (const colors of [2, 3, 16, 256]) {
      const out = quantize(src, { colors, dither });
      expect(visibleColors(out).size, `${colors} colors`).toBeLessThanOrEqual(colors);
    }
  });

  it('fills the full budget when the frame holds more colors than it', () => {
    const out = quantize(photo(), { colors: 16 });
    expect(visibleColors(out).size).toBe(16);
  });

  it.each(DITHERS)('returns a frame already within the limit unchanged (dither %s)', (dither) => {
    const src = row([
      [10, 20, 30],
      [200, 100, 50],
      [10, 20, 30],
      [0, 255, 0],
    ]);
    src.setPixel(1, 0, [200, 100, 50], 70).setPixel(3, 0, [0, 255, 0], 0);
    for (const colors of [2, 3, 256]) {
      const out = quantize(src, { colors, dither });
      expect(out).not.toBe(src);
      expect(out.buffer, `${colors} colors`).toEqual(src.buffer);
    }
  });

  it('splits the box with the largest squared error, not the most pixels or the widest range', () => {
    // First cut 30 | 200. Then {0, 30} (SSE 45000) splits before {200, 250} (SSE 2500), though the
    // latter spans the wider range; with equal counts {0, 10} (SSE 1000) waits for {200, 250} (25000)
    const bySse = row([
      ...times([0, 0, 0], 100),
      ...times([30, 0, 0], 100),
      ...times([200, 0, 0], 2),
      ...times([250, 0, 0], 2),
    ]);
    expect([...visibleColors(quantize(bySse, { colors: 3 }))].toSorted((a, b) => a - b)).toEqual([
      0x000000, 0x1e0000, 0xe10000,
    ]);

    const byCount = row([
      ...times([0, 0, 0], 20),
      ...times([10, 0, 0], 20),
      ...times([200, 0, 0], 20),
      ...times([250, 0, 0], 20),
    ]);
    expect([...visibleColors(quantize(byCount, { colors: 3 }))].toSorted((a, b) => a - b)).toEqual([
      0x050000, 0xc80000, 0xfa0000,
    ]);
  });

  it('cuts along the axis that removes the most squared error and uses each box mean', () => {
    const src = row([
      ...times([10, 0, 0], 5),
      ...times([12, 0, 0], 5),
      ...times([10, 200, 0], 5),
      ...times([12, 200, 0], 5),
    ]);
    const out = quantize(src, { colors: 2 });
    expect(pixels(out).map(([r, g, b]) => [r, g, b])).toEqual([
      ...times([11, 0, 0], 10),
      ...times([11, 200, 0], 10),
    ]);
  });

  it('maps a pixel to the nearest palette color, the lowest index winning a tie', () => {
    const src = row([[1, 1, 1]]);
    expect(
      pixels(
        quantize(src, {
          palette: [
            [0, 0, 0],
            [2, 2, 2],
          ],
        }),
      ),
    ).toEqual([[0, 0, 0, 255]]);
    expect(
      pixels(
        quantize(src, {
          palette: [
            [2, 2, 2],
            [0, 0, 0],
          ],
        }),
      ),
    ).toEqual([[2, 2, 2, 255]]);
  });

  it.each(DITHERS)('makes every visible pixel a palette color (dither %s)', (dither) => {
    const out = quantize(photo(), { palette: ['#000000', '#f0ead6', 'claude'], dither });
    const used = visibleColors(out);
    for (const color of used) expect([0x000000, 0xf0ead6, 0xe69646]).toContain(color);
    expect(used.size).toBe(3);
  });

  it.each(DITHERS)(
    'passes alpha through and leaves alpha-0 pixels as they are (dither %s)',
    (dither) => {
      const src = photo(32, 32);
      const next = prng(11);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const [r, g, b] = src.getPixel(x, y);
          src.setPixel(x, y, [r, g, b], (x + y) % 5 === 0 ? 0 : Math.floor(next() * 256));
        }
      }
      for (const options of [{ colors: 8 }, { palette: ['navy', 'gold', 'white'] }] as const) {
        const out = quantize(src, { ...options, dither });
        for (let i = 0; i < src.buffer.length; i += 4) {
          expect(out.buffer[i + 3], `alpha at byte ${i}`).toBe(src.buffer[i + 3]);
          if (src.buffer[i + 3] === 0) {
            expect([...out.buffer.subarray(i, i + 4)]).toEqual([...src.buffer.subarray(i, i + 4)]);
          }
        }
      }
    },
  );

  it.each(DITHERS)('is deterministic (dither %s)', (dither) => {
    const src = noise(40, 30, 21);
    expect(quantize(src, { colors: 16, dither }).buffer).toEqual(
      quantize(src, { colors: 16, dither }).buffer,
    );
    expect(quantize(src, { palette: ['red', 'teal', 'black'], dither }).buffer).toEqual(
      quantize(src, { palette: ['red', 'teal', 'black'], dither }).buffer,
    );
  });

  it.each(DITHERS)('maps every pixel to a one-color palette (dither %s)', (dither) => {
    const out = quantize(photo(16, 16), { palette: ['gold'], dither });
    expect([...visibleColors(out)]).toEqual([0xffd700]);
  });

  it('never mutates its input', () => {
    const src = noise(24, 24, 5);
    const before = new Uint8Array(src.buffer);
    for (const dither of DITHERS) {
      quantize(src, { colors: 4, dither });
      quantize(src, { palette: ['black', 'white'], dither });
    }
    expect(src.buffer).toEqual(before);
  });

  it.each([
    [
      'both colors and palette',
      { colors: 4, palette: ['red'] },
      TypeError,
      'quantize takes exactly one of colors and palette; got both',
    ],
    [
      'neither colors nor palette',
      { dither: 'bayer4' },
      TypeError,
      'quantize takes exactly one of colors and palette; got neither',
    ],
    [
      '1 color',
      { colors: 1 },
      RangeError,
      'quantize colors must be an integer from 2 to 256; got 1',
    ],
    [
      '257 colors',
      { colors: 257 },
      RangeError,
      'quantize colors must be an integer from 2 to 256; got 257',
    ],
    [
      '2.5 colors',
      { colors: 2.5 },
      RangeError,
      'quantize colors must be an integer from 2 to 256; got 2.5',
    ],
    [
      'NaN colors',
      { colors: Number.NaN },
      RangeError,
      'quantize colors must be an integer from 2 to 256; got NaN',
    ],
    [
      'an empty palette',
      { palette: [] },
      RangeError,
      'quantize palette must hold 1 to 256 colors; got 0',
    ],
    [
      'a 257-color palette',
      { palette: times([1, 2, 3], 257) },
      RangeError,
      'quantize palette must hold 1 to 256 colors; got 257',
    ],
    [
      'an unknown dither',
      { colors: 4, dither: 'ordered' },
      RangeError,
      'quantize dither must be one of none, bayer4, floyd-steinberg; got ordered',
    ],
    [
      'an unresolvable palette entry',
      { palette: ['black', 'nope'] },
      Error,
      'Unknown color: "nope"',
    ],
  ] as const)('rejects %s', (_label, options, ErrorType, message) => {
    const src = photo(8, 8);
    const call = () => quantize(src, options as unknown as QuantizeOptions);
    expect(call).toThrow(ErrorType);
    expect(call).toThrow(message);
  });
});

describe('quantize dithering', () => {
  const BLACK_WHITE = ['black', 'white'] as const;

  /** A 64×64 field of one sRGB gray. */
  const field = (v: number) => new Canvas(64, 64).clear([v, v, v]);

  /** 0, 17 … 255 across a 64×64 canvas, each level a 4-px-wide step. */
  const staircase = () => {
    const c = new Canvas(64, 64);
    for (let x = 0; x < 64; x++)
      c.fillRect(x, 0, 1, 64, [17 * (x >> 2), 17 * (x >> 2), 17 * (x >> 2)]);
    return c;
  };

  it('lights 20–23% of a flat sRGB 128 field under floyd-steinberg', () => {
    const out = quantize(field(128), { palette: BLACK_WHITE, dither: 'floyd-steinberg' });
    const lit = pixels(out).filter(([r]) => r === 255).length / (64 * 64);
    expect(lit).toBeGreaterThanOrEqual(0.2);
    expect(lit).toBeLessThanOrEqual(0.23);
  });

  it('lights exactly 3 of every 16 pixels of a flat sRGB 128 field under bayer4', () => {
    const out = quantize(field(128), { palette: BLACK_WHITE, dither: 'bayer4' });
    for (let by = 0; by < 64; by += 4) {
      for (let bx = 0; bx < 64; bx += 4) {
        let lit = 0;
        for (let y = by; y < by + 4; y++) {
          for (let x = bx; x < bx + 4; x++) if (out.getPixel(x, y)[0] === 255) lit++;
        }
        expect(lit, `block (${bx}, ${by})`).toBe(3);
      }
    }
  });

  it.each(['bayer4', 'floyd-steinberg'] as const)(
    'keeps each step of a 0, 17 … 255 staircase within 0.04 of its intended light (%s)',
    (dither) => {
      const out = quantize(staircase(), { palette: BLACK_WHITE, dither });
      for (let step = 0; step < 16; step++) {
        let light = 0;
        for (let y = 0; y < 64; y++) {
          for (let x = 4 * step; x < 4 * step + 4; x++) light += toLinear(out.getPixel(x, y)[0]);
        }
        expect(
          Math.abs(light / 256 - toLinear(17 * step)),
          `step ${step} (level ${17 * step})`,
        ).toBeLessThanOrEqual(0.04);
      }
    },
  );

  it('mixes the two nearest palette colors by linear light under bayer4', () => {
    // sRGB 60 sits between black and gray 128: its light is 0.21 of gray's, so 3 of 16 pixels
    // turn gray; white, the farthest color, never appears
    const out = quantize(field(60), {
      palette: ['black', [128, 128, 128], 'white'],
      dither: 'bayer4',
    });
    const counts = new Map<number, number>();
    for (const [r] of pixels(out)) counts.set(r, (counts.get(r) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({ 0: (64 * 64 * 13) / 16, 128: (64 * 64 * 3) / 16 });
  });

  it.each([
    ['pure blue over yellow', [0, 0, 255], [255, 230, 120]],
    ['teal over orange', [0, 128, 128], [200, 120, 60]],
  ] as const)(
    'keeps a color the palette cannot reach from bleeding into the next region under floyd-steinberg (%s)',
    (_label, above, below) => {
      // Black, cream, and orange hold no blue to spend, so the upper field's error has nowhere to go
      const palette = ['#000000', '#f0ead6', 'claude'];
      const stacked = quantize(new Canvas(64, 64).clear(below).fillRect(0, 0, 64, 32, above), {
        palette,
        dither: 'floyd-steinberg',
      });
      const alone = quantize(new Canvas(64, 32).clear(below), {
        palette,
        dither: 'floyd-steinberg',
      });
      const shares = (c: Canvas, y0: number) => {
        const counts = new Map<number, number>();
        for (let y = y0; y < y0 + 16; y++) {
          for (let x = 0; x < 64; x++) {
            const [r, g, b] = c.getPixel(x, y);
            const key = (r << 16) | (g << 8) | b;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
        return [0x000000, 0xf0ead6, 0xe69646].map((key) => (counts.get(key) ?? 0) / (16 * 64));
      };
      const near = shares(alone, 0);
      shares(stacked, 32).forEach((share, k) => {
        expect(Math.abs(share - near[k]!), `palette color ${k}`).toBeLessThanOrEqual(0.15);
      });
    },
  );

  it('leaves a pixel on a palette color untouched under both dithers', () => {
    const src = field(0).fillRect(0, 0, 64, 32, 'white');
    for (const dither of ['bayer4', 'floyd-steinberg'] as const) {
      expect(quantize(src, { palette: BLACK_WHITE, dither }).buffer).toEqual(src.buffer);
    }
  });
});

describe('correctForPanel and simulatePanel', () => {
  const LINEAR: PanelResponse = [
    [0, 0],
    [255, 1],
  ];
  const SRGB_17: PanelResponse = Array.from(
    { length: 16 },
    (_, i) => [17 * i, toLinear(17 * i)] as const,
  );
  const DARK_LOW: PanelResponse = [
    [0, 0],
    [4, 0],
    [255, 1],
  ];
  const PANEL_FNS = [
    ['correctForPanel', correctForPanel],
    ['simulatePanel', simulatePanel],
  ] as const;

  /** Every channel value 0–255 in each channel, one pixel per value. */
  const ramp = () => {
    const c = new Canvas(256, 1);
    for (let v = 0; v < 256; v++) c.setPixel(v, 0, [v, 255 - v, (v * 7) % 256]);
    return c;
  };

  it('maps 128 to 55 under the linear response', () => {
    expect(correctForPanel(row([[128, 128, 128]]), LINEAR).getPixelRgba(0, 0)).toEqual([
      55, 55, 55, 255,
    ]);
  });

  it.each(PANEL_FNS)(
    'is the identity ±1 under the sRGB curve sampled every 17 levels (%s)',
    (_name, fn) => {
      const src = ramp();
      const out = fn(src, SRGB_17);
      for (let x = 0; x < 256; x++) {
        const want = src.getPixel(x, 0);
        out.getPixel(x, 0).forEach((v, ch) => {
          expect(Math.abs(v - want[ch]!), `value ${want[ch]}`).toBeLessThanOrEqual(1);
        });
      }
    },
  );

  it.each([
    ['linear', LINEAR],
    ['sRGB-sampled', SRGB_17],
  ] as const)('round-trips within ±2 from 40 up under the %s response', (_name, response) => {
    const src = ramp();
    const out = simulatePanel(correctForPanel(src, response), response);
    for (let x = 0; x < 256; x++) {
      const want = src.getPixel(x, 0);
      out.getPixel(x, 0).forEach((v, ch) => {
        if (want[ch]! >= 40) {
          expect(Math.abs(v - want[ch]!), `value ${want[ch]}`).toBeLessThanOrEqual(2);
        }
      });
    }
  });

  it.each(PANEL_FNS)(
    'maps 0 to 0 and 255 to 255 and returns an opaque canvas (%s)',
    (_name, fn) => {
      const src = new Canvas(3, 2)
        .setPixel(0, 0, 'white')
        .setPixel(1, 0, 'black')
        .setPixel(2, 0, 'red');
      for (const response of [LINEAR, SRGB_17, DARK_LOW]) {
        const out = fn(src, response);
        expect(pixels(out)).toEqual([
          [255, 255, 255, 255],
          [0, 0, 0, 255],
          [255, 0, 0, 255],
          [0, 0, 0, 255],
          [0, 0, 0, 255],
          [0, 0, 0, 255],
        ]);
      }
    },
  );

  it.each(PANEL_FNS)('never adds distinct colors (%s)', (_name, fn) => {
    const src = noise(48, 48, 13);
    for (const response of [LINEAR, SRGB_17, DARK_LOW]) {
      const out = fn(src, response);
      expect(flatColors(out).size).toBeLessThanOrEqual(flatColors(src).size);
      expect(pixels(out).every(([, , , a]) => a === 255)).toBe(true);
    }
  });

  it.each(PANEL_FNS)('flattens over black as toRgbBuffer does before mapping (%s)', (_name, fn) => {
    const src = noise(32, 16, 17);
    const flat = new Canvas(32, 16);
    const rgb = src.toRgbBuffer();
    for (let p = 0; p < 32 * 16; p++)
      flat.setPixel(p % 32, Math.floor(p / 32), [rgb[p * 3]!, rgb[p * 3 + 1]!, rgb[p * 3 + 2]!]);
    for (const response of [LINEAR, SRGB_17]) {
      expect(fn(src, response).buffer).toEqual(fn(flat, response).buffer);
    }
  });

  it('interpolates linearly in light between response points', () => {
    const response: PanelResponse = [
      [0, 0],
      [100, 0.5],
      [255, 1],
    ];
    // Drive 50 sits halfway to [100, 0.5]: light 0.25, sRGB 137
    expect(simulatePanel(row([[50, 100, 255]]), response).getPixel(0, 0)).toEqual([137, 188, 255]);
  });

  it('takes the lower drive on a tie', () => {
    // Drives 100–150 all give sRGB 128's light, so 128 takes 100; 1 sits nearest the dark drives 0–4
    const plateau: PanelResponse = [
      [0, 0],
      [100, toLinear(128)],
      [150, toLinear(128)],
      [255, 1],
    ];
    expect(correctForPanel(row([[128, 128, 128]]), plateau).getPixel(0, 0)).toEqual([
      100, 100, 100,
    ]);
    expect(correctForPanel(row([[1, 0, 1]]), DARK_LOW).getPixel(0, 0)).toEqual([0, 0, 0]);
  });

  it('corrects for a panel that stays dark through drive 4', () => {
    const out = correctForPanel(ramp(), DARK_LOW);
    for (let x = 1; x < 256; x++) {
      expect(out.getPixel(x, 0)[0]).toBeGreaterThanOrEqual(out.getPixel(x - 1, 0)[0]);
    }
    for (let v = 0; v < 256; v++) expect([1, 2, 3, 4]).not.toContain(out.getPixel(v, 0)[0]);
  });

  it.each(PANEL_FNS)('never mutates its input (%s)', (_name, fn) => {
    const src = noise(16, 16, 23);
    const before = new Uint8Array(src.buffer);
    const out = fn(src, SRGB_17);
    expect(out).not.toBe(src);
    expect(src.buffer).toEqual(before);
  });

  const MALFORMED: [string, unknown][] = [
    ['an empty response', []],
    ['a single point', [[0, 0]]],
    ['a non-array response', null],
    [
      'a point that is not a pair',
      [
        [0, 0],
        [128, 0.5, 1],
        [255, 1],
      ],
    ],
    [
      'a first point off [0, 0]',
      [
        [0, 0.1],
        [255, 1],
      ],
    ],
    [
      'a first drive above 0',
      [
        [1, 0],
        [255, 1],
      ],
    ],
    [
      'a last point off [255, 1]',
      [
        [0, 0],
        [255, 0.9],
      ],
    ],
    [
      'a last drive below 255',
      [
        [0, 0],
        [254, 1],
      ],
    ],
    [
      'a repeated drive',
      [
        [0, 0],
        [128, 0.4],
        [128, 0.5],
        [255, 1],
      ],
    ],
    [
      'a falling drive',
      [
        [0, 0],
        [200, 0.4],
        [100, 0.5],
        [255, 1],
      ],
    ],
    [
      'a fractional drive',
      [
        [0, 0],
        [100.5, 0.5],
        [255, 1],
      ],
    ],
    [
      'a falling light',
      [
        [0, 0],
        [100, 0.6],
        [200, 0.5],
        [255, 1],
      ],
    ],
    [
      'a NaN light',
      [
        [0, 0],
        [100, Number.NaN],
        [255, 1],
      ],
    ],
    [
      'a light above 1',
      [
        [0, 0],
        [100, 1.5],
        [255, 1],
      ],
    ],
  ];

  it.each(PANEL_FNS)('rejects malformed responses with RangeError (%s)', (name, fn) => {
    const src = photo(4, 4);
    for (const [label, response] of MALFORMED) {
      const call = () => fn(src, response as PanelResponse);
      expect(call, label).toThrow(RangeError);
      expect(call, label).toThrow(new RegExp(`^${name} response `));
    }
  });
});

describe('finish types', () => {
  it('exports the same types through ./core and the main entry', () => {
    expectTypeOf<CoreDither>().toEqualTypeOf<Dither>();
    expectTypeOf<BarrelDither>().toEqualTypeOf<Dither>();
    expectTypeOf<CoreQuantizeOptions>().toEqualTypeOf<QuantizeOptions>();
    expectTypeOf<BarrelQuantizeOptions>().toEqualTypeOf<QuantizeOptions>();
    expectTypeOf<CorePanelResponse>().toEqualTypeOf<PanelResponse>();
    expectTypeOf<BarrelPanelResponse>().toEqualTypeOf<PanelResponse>();
    expectTypeOf<Dither>().toEqualTypeOf<'none' | 'bayer4' | 'floyd-steinberg'>();
  });

  it('rejects both colors and palette at compile time', () => {
    // @ts-expect-error — colors and palette are exclusive
    const both: QuantizeOptions = { colors: 4, palette: ['red'] };
    expect(() => quantize(new Canvas(2, 2), both)).toThrow(TypeError);
  });
});
