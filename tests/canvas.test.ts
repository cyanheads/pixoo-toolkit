import { createHash } from 'node:crypto';
import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import {
  Canvas,
  DEFAULT_SIZE,
  type BlendMode,
  type BlitOptions,
  type StrokeOptions,
} from '../src/canvas.js';
import type { RGB } from '../src/color.js';
import type {
  BlendMode as CoreBlendMode,
  BlitOptions as CoreBlitOptions,
  FillOptions as CoreFillOptions,
  StrokeOptions as CoreStrokeOptions,
} from '../src/core.js';
import type {
  BlendMode as BarrelBlendMode,
  BlitOptions as BarrelBlitOptions,
  FillOptions as BarrelFillOptions,
  StrokeOptions as BarrelStrokeOptions,
} from '../src/index.js';
import { drawText, FONT_3x5 } from '../src/font.js';
import { fillSubpaths, renderSvgPath, strokeSubpaths } from '../src/svg-path.js';

/** Count pixels carrying a non-zero stored alpha. */
function paintedCount(c: Canvas): number {
  let n = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) if (c.getPixelRgba(x, y)[3] !== 0) n++;
  }
  return n;
}

/** First 16 hex digits of the buffer's SHA-256 — pins exact bytes compactly. */
function digest(c: Canvas): string {
  return createHash('sha256').update(c.buffer).digest('hex').slice(0, 16);
}

/** One string per row, `#` for a painted pixel and `.` for a transparent one. */
function rowsOf(c: Canvas): string[] {
  const rows: string[] = [];
  for (let y = 0; y < c.height; y++) {
    let row = '';
    for (let x = 0; x < c.width; x++) row += c.getPixelRgba(x, y)[3] !== 0 ? '#' : '.';
    rows.push(row);
  }
  return rows;
}

/** Painted pixels as `[x, y]`, row-major. */
function paintedPixels(c: Canvas): [number, number][] {
  const px: [number, number][] = [];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) if (c.getPixelRgba(x, y)[3] !== 0) px.push([x, y]);
  }
  return px;
}

/**
 * The midpoint loop `drawCircle` ran before its cost was bounded by the
 * canvas: it walks the whole circumference. Every integer radius must still
 * paint exactly these pixels. The bounds check skips the no-op `setPixel`
 * calls for off-canvas points so a large radius stays quick to replay.
 */
function legacyDrawCircle(c: Canvas, cx: number, cy: number, radius: number, color: RGB): void {
  const plot = (px: number, py: number) => {
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    if (ix >= 0 && ix < c.width && iy >= 0 && iy < c.height) c.setPixel(ix, iy, color);
  };
  let x = radius,
    y = 0,
    d = 1 - radius;
  while (x >= y) {
    plot(cx + x, cy + y);
    plot(cx - x, cy + y);
    plot(cx + x, cy - y);
    plot(cx - x, cy - y);
    plot(cx + y, cy + x);
    plot(cx - y, cy + x);
    plot(cx + y, cy - x);
    plot(cx - y, cy - x);
    y++;
    if (d <= 0) {
      d += 2 * y + 1;
    } else {
      x--;
      d += 2 * (y - x) + 1;
    }
  }
}

/** The radii whose drawCircle bytes differ from the midpoint loop's. */
function midpointMismatches(
  width: number,
  height: number,
  cx: number,
  cy: number,
  radii: readonly number[],
): number[] {
  return radii.filter((r) => {
    const actual = new Canvas(width, height).drawCircle(cx, cy, r, [255, 0, 0]);
    const expected = new Canvas(width, height);
    legacyDrawCircle(expected, cx, cy, r, [255, 0, 0]);
    return Buffer.compare(actual.buffer, expected.buffer) !== 0;
  });
}

/** Integers from `from` to `to` inclusive. */
function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** `fillCircle`'s inside test: dx² + dy² ≤ r² + r from the center (cx, cy). */
function insideFootprint(cx: number, cy: number, r: number): (x: number, y: number) => boolean {
  return (x, y) => {
    const dx = x - cx,
      dy = y - cy;
    return dx * dx + dy * dy <= r * r + r;
  };
}

/** `fillCircle`'s footprint, found pixel by pixel. */
function footprint(width: number, height: number, cx: number, cy: number, r: number): Canvas {
  const inside = insideFootprint(cx, cy, r);
  const fill = new Canvas(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (inside(x, y)) fill.setPixel(x, y, 'white');
  }
  return fill;
}

/**
 * The edge of `fillCircle`'s footprint, found pixel by pixel: footprint
 * pixels with a horizontal or vertical neighbour outside it, on the canvas or
 * off it.
 */
function footprintEdge(width: number, height: number, cx: number, cy: number, r: number): Canvas {
  const inside = insideFootprint(cx, cy, r);
  const edge = new Canvas(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) {
        edge.setPixel(x, y, 'white');
      }
    }
  }
  return edge;
}

/**
 * The painted pixels of `c` with a horizontal or vertical neighbour unpainted,
 * for a shape that lies inside the canvas.
 */
function edgeOf(c: Canvas): Canvas {
  const painted = (x: number, y: number) => c.getPixelRgba(x, y)[3] !== 0;
  const edge = new Canvas(c.width, c.height);
  for (const [x, y] of paintedPixels(c)) {
    if (!painted(x - 1, y) || !painted(x + 1, y) || !painted(x, y - 1) || !painted(x, y + 1)) {
      edge.setPixel(x, y, 'white');
    }
  }
  return edge;
}

/** A 5×4 blit source mixing undrawn, opaque, and translucent pixels. */
function blitSource(): Canvas {
  const src = new Canvas(5, 4);
  const alphas = [0, 255, 128, 1, 254, 64, 255, 0, 200];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 5; x++) {
      const color: RGB = [(x * 50) % 256, (y * 70) % 256, (x * y * 30 + 17) % 256];
      src.setPixel(x, y, color, alphas[(y * 5 + x) % alphas.length]);
    }
  }
  return src;
}

/** Rows in [yStart, yEnd] carrying no painted pixel. */
function emptyRows(c: Canvas, yStart: number, yEnd: number): number[] {
  const rows: number[] = [];
  for (let y = yStart; y <= yEnd; y++) {
    let painted = 0;
    for (let x = 0; x < c.width; x++) if (c.getPixelRgba(x, y)[3] !== 0) painted++;
    if (painted === 0) rows.push(y);
  }
  return rows;
}

describe('Canvas construction', () => {
  it('creates a 64x64 canvas with an RGBA buffer', () => {
    const c = new Canvas();
    expect(c.width).toBe(64);
    expect(c.height).toBe(64);
    expect(c.buffer.length).toBe(64 * 64 * 4);
  });

  it('initializes fully transparent (reads as black)', () => {
    const c = new Canvas();
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]);
    expect(c.getPixelRgba(63, 63)).toEqual([0, 0, 0, 0]);
  });

  it('accepts a pre-filled RGBA buffer', () => {
    const buf = new Uint8Array(64 * 64 * 4);
    buf[0] = 255;
    buf[1] = 128;
    buf[2] = 64;
    buf[3] = 200;
    const c = new Canvas(buf);
    expect(c.getPixelRgba(0, 0)).toEqual([255, 128, 64, 200]);
  });

  it('upconverts a legacy RGB buffer to opaque RGBA', () => {
    const buf = new Uint8Array(64 * 64 * 3);
    buf[0] = 255;
    buf[1] = 128;
    buf[2] = 64;
    const c = new Canvas(buf);
    expect(c.buffer.length).toBe(64 * 64 * 4);
    expect(c.getPixelRgba(0, 0)).toEqual([255, 128, 64, 255]);
  });

  it('copies the source buffer (not aliased)', () => {
    const buf = new Uint8Array(64 * 64 * 4);
    buf[0] = 100;
    const c = new Canvas(buf);
    buf[0] = 200;
    expect(c.buffer[0]).toBe(100);
  });

  it('throws on wrong buffer size', () => {
    expect(() => new Canvas(new Uint8Array(100))).toThrow('Invalid buffer length');
  });

  it('creates a 16x16 canvas', () => {
    const c = new Canvas(16);
    expect(c.width).toBe(16);
    expect(c.height).toBe(16);
    expect(c.buffer.length).toBe(16 * 16 * 4);
  });

  it('creates a 32x32 canvas', () => {
    const c = new Canvas(32);
    expect(c.width).toBe(32);
    expect(c.height).toBe(32);
    expect(c.buffer.length).toBe(32 * 32 * 4);
  });

  it('creates a 64x64 canvas with explicit size', () => {
    const c = new Canvas(64);
    expect(c.width).toBe(64);
    expect(c.buffer.length).toBe(64 * 64 * 4);
  });

  it('infers size from buffer length', () => {
    const buf32 = new Uint8Array(32 * 32 * 3);
    buf32[0] = 42;
    const c = new Canvas(buf32);
    expect(c.width).toBe(32);
    expect(c.height).toBe(32);
    expect(c.getPixel(0, 0)).toEqual([42, 0, 0]);
  });
});

describe('Canvas of any width and height', () => {
  it.each([
    [320, 7],
    [7, 320],
    [1, 1],
    [4096, 1],
    [1, 4096],
    [100, 40],
  ])('creates a transparent %i×%i canvas', (width, height) => {
    const c = new Canvas(width, height);
    expect(c.width).toBe(width);
    expect(c.height).toBe(height);
    expect(c.buffer.length).toBe(width * height * 4);
    expect(paintedCount(c)).toBe(0);
  });

  it.each([1, 20, 100, 512, 4096])('creates a square from the single number %i', (size) => {
    const c = new Canvas(size);
    expect(c.width).toBe(size);
    expect(c.height).toBe(size);
    expect(c.buffer.length).toBe(size * size * 4);
  });

  it.each([0, -1, 1.5, Number.NaN, 4097, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects %s as a size',
    (size) => {
      expect(() => new Canvas(size)).toThrow(RangeError);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, 4097])('rejects %s as either dimension', (bad) => {
    expect(() => new Canvas(bad, 7)).toThrow(RangeError);
    expect(() => new Canvas(320, bad)).toThrow(RangeError);
  });

  it('names the bad dimension and the valid range', () => {
    expect(() => new Canvas(320, 0)).toThrow(
      new RangeError('Canvas height must be an integer from 1 to 4096; got 0'),
    );
    expect(() => new Canvas(4097)).toThrow(
      new RangeError('Canvas width must be an integer from 1 to 4096; got 4097'),
    );
  });

  it('points the buffer-length error at Canvas.fromRgba', () => {
    expect(() => new Canvas(new Uint8Array(320 * 7 * 4))).toThrow(
      'Invalid buffer length 8960; expected one of: 1024, 4096, 16384, 768, 3072, 12288 — use Canvas.fromRgba(buffer, width, height) for other dimensions',
    );
  });

  it.each([0, 100, 320 * 7 * 4, 64 * 64 * 4 + 1])(
    'throws RangeError for a %i-byte buffer, like every other dimension error',
    (length) => {
      const construct = () => new Canvas(new Uint8Array(length));
      expect(construct).toThrow(RangeError);
      expect(construct).toThrow(`Invalid buffer length ${length}; expected one of:`);
    },
  );
});

describe('drawing on non-square canvases', () => {
  const STAR = 'M8 1 L10 6 L15 6 L11 9 L13 15 L8 11 L3 15 L5 9 L1 6 L6 6 Z';
  const sprite = () => new Canvas(16).fillCircle(8, 8, 6, 'cyan').setPixel(0, 0, 'red', 90);

  /** Each op draws near the origin and far past it, so clipping is exercised on both axes. */
  const OPS: [string, (c: Canvas) => unknown][] = [
    [
      'setPixel',
      (c) => c.setPixel(5, 3, 'red').setPixel(300, 0, 'blue', 100).setPixel(0, 300, 'lime'),
    ],
    ['blendPixel', (c) => c.clear([9, 9, 9]).blendPixel(4, 0, 'white', 0.4)],
    ['clear', (c) => c.clear([1, 2, 3])],
    ['fillRect', (c) => c.fillRect(-3, 0, 400, 3, 'red').fillRect(0, -3, 3, 400, 'blue')],
    ['fillCircle', (c) => c.fillCircle(3, 3, 6, 'green')],
    ['drawCircle', (c) => c.drawCircle(3, 3, 4, 'green').drawCircle(30, 2, 9, 'yellow')],
    [
      'drawCircle fractional center',
      (c) => c.drawCircle(3.5, 2.25, 4, 'green').drawCircle(30.7, 2.5, 9, 'yellow'),
    ],
    [
      'drawLine',
      (c) =>
        c
          .drawLine(-50, -3, 400, 12, 'yellow')
          .drawLine(0, 0, Number.MAX_VALUE, 0, 'red')
          .drawLine(0, 0, 0, Number.MAX_VALUE, 'blue'),
    ],
    ['drawLineH', (c) => c.drawLineH(-2, 0, 500, 'red')],
    ['drawLineV', (c) => c.drawLineV(0, -2, 500, 'blue')],
    ['drawRect', (c) => c.drawRect(0, 0, 300, 300, 'white')],
    ['drawTriangle', (c) => c.drawTriangle(0, 0, 300, 5, 5, 300, 'red')],
    ['fillTriangle', (c) => c.fillTriangle(0, 0, 300, 5, 5, 300, 'red')],
    ['gradientRadial', (c) => c.gradientRadial(4, 3, 30, 'white', 'black')],
    ['blit', (c) => c.blit(sprite(), -4, -5).blit(sprite(), 290, 0).blit(sprite(), 0, 290)],
    ...(['normal', 'add', 'screen', 'multiply'] as const).map(
      (mode): [string, (c: Canvas) => unknown] => [
        `blit ${mode}`,
        (c) =>
          c
            .fillRect(0, 0, 20, 20, [40, 90, 160], { alpha: 0.6 })
            .blit(sprite(), -4, -5, { mode })
            .blit(sprite(), 290, 0, { mode })
            .blit(sprite(), 0, 290, { mode }),
      ],
    ),
    [
      'fillRect alpha',
      (c) =>
        c
          .fillRect(-3, 0, 400, 3, 'red', { alpha: 0.5 })
          .fillRect(0, -3, 3, 400, 'blue', { alpha: 0.3 }),
    ],
    ['fillCircle alpha', (c) => c.fillCircle(3, 3, 6, 'green', { alpha: 0.6 })],
    ['fillTriangle alpha', (c) => c.fillTriangle(0, 0, 300, 5, 5, 300, 'red', { alpha: 0.4 })],
    [
      'drawRect width alpha',
      (c) =>
        c
          .drawRect(0, 0, 300, 300, 'white', { width: 3, alpha: 0.7 })
          .drawRect(-2, -2, 9, 9, 'red', { width: 2 }),
    ],
    [
      'drawLine width',
      (c) =>
        c
          .drawLine(-50, -3, 400, 12, 'yellow', { width: 3 })
          .drawLine(0, 0, Number.MAX_VALUE, 0, 'red', { width: 2, alpha: 0.5 })
          .drawLine(0, 0, 0, Number.MAX_VALUE, 'blue', { width: 4 }),
    ],
    [
      'drawLine antialias',
      (c) =>
        c
          .drawLine(-50.5, -3.2, 400.7, 12.9, 'yellow', { antialias: true })
          .drawLine(0.5, 0.25, 0.5, 300, 'cyan', { antialias: true, width: 2, alpha: 0.8 }),
    ],
    [
      'drawCircle width',
      (c) =>
        c
          .drawCircle(3, 3, 4, 'green', { width: 3 })
          .drawCircle(30, 2, 9, 'yellow', { width: 2, alpha: 0.5 }),
    ],
    [
      'drawCircle antialias',
      (c) =>
        c
          .drawCircle(3.5, 3.25, 4.2, 'green', { antialias: true })
          .drawCircle(30, 2, 9, 'yellow', { width: 3, antialias: true }),
    ],
    ['scroll', (c) => c.fillRect(0, 0, 20, 20, 'red').setPixel(1, 0, 'blue').scroll(2, 1)],
    ['drawText', (c) => drawText(c, 'Hello, strip!', 0, 0, 'white', { font: FONT_3x5 })],
    ['renderSvgPath fill', (c) => renderSvgPath(c, STAR, 'orange', [16, 16], [-3, -4, 16, 16])],
    [
      'renderSvgPath stroke',
      (c) => renderSvgPath(c, STAR, 'orange', [16, 16], [-4, -4, 16, 16], { mode: 'stroke' }),
    ],
    [
      'fillSubpaths',
      (c) =>
        fillSubpaths(
          c,
          [
            [
              { x: 0, y: 0 },
              { x: 300, y: 3 },
              { x: 5, y: 300 },
            ],
          ],
          'red',
        ),
    ],
    [
      'strokeSubpaths',
      (c) =>
        strokeSubpaths(
          c,
          [
            [
              { x: 0, y: 0 },
              { x: 300, y: 0 },
            ],
            [
              { x: 0, y: 0 },
              { x: 0, y: 300 },
            ],
          ],
          'blue',
        ),
    ],
  ];

  const casesFor = (shapes: [number, number][]) =>
    shapes.flatMap(([w, h]) => OPS.map(([name, op]) => [name, w, h, op] as const));

  it.each(
    casesFor([
      [320, 7],
      [7, 320],
      [320, 1],
      [1, 320],
    ]),
  )(
    '%s paints a %i×%i canvas like the matching region of a 320×320 one',
    (_name, width, height, op) => {
      const small = new Canvas(width, height);
      const big = new Canvas(320);
      op(small);
      op(big);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          expect(small.getPixelRgba(x, y)).toEqual(big.getPixelRgba(x, y));
        }
      }
    },
  );

  it.each(
    casesFor([
      [320, 7],
      [7, 320],
    ]),
  )('%s paints something on a %i×%i canvas', (_name, width, height, op) => {
    const c = new Canvas(width, height);
    op(c);
    expect(paintedCount(c)).toBeGreaterThan(0);
  });

  it('runs gradientV from the first row to the last on a strip', () => {
    const c = new Canvas(320, 7).gradientV([255, 0, 0], [0, 0, 255]);
    for (const x of [0, 160, 319]) {
      expect(c.getPixel(x, 0)).toEqual([255, 0, 0]);
      expect(c.getPixel(x, 3)).toEqual([128, 0, 128]);
      expect(c.getPixel(x, 6)).toEqual([0, 0, 255]);
    }
    const tall = new Canvas(7, 320).gradientV([255, 0, 0], [0, 0, 255]);
    expect(tall.getPixel(6, 0)).toEqual([255, 0, 0]);
    expect(tall.getPixel(6, 319)).toEqual([0, 0, 255]);
  });

  it('runs gradientH from the first column to the last on a strip', () => {
    const c = new Canvas(7, 320).gradientH([255, 0, 0], [0, 0, 255]);
    for (const y of [0, 160, 319]) {
      expect(c.getPixel(0, y)).toEqual([255, 0, 0]);
      expect(c.getPixel(3, y)).toEqual([128, 0, 128]);
      expect(c.getPixel(6, y)).toEqual([0, 0, 255]);
    }
    const wide = new Canvas(320, 7).gradientH([255, 0, 0], [0, 0, 255]);
    expect(wide.getPixel(0, 6)).toEqual([255, 0, 0]);
    expect(wide.getPixel(319, 6)).toEqual([0, 0, 255]);
  });

  it.each([
    ['gradientV', 320, 1],
    ['gradientH', 1, 40],
    ['gradientV', 1, 1],
    ['gradientH', 1, 1],
  ] as const)('%s on a %i×%i canvas paints the start color', (method, width, height) => {
    const c = new Canvas(width, height)[method]([255, 0, 0], [0, 0, 255]);
    expect(paintedCount(c)).toBe(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) expect(c.getPixelRgba(x, y)).toEqual([255, 0, 0, 255]);
    }
  });
});

describe('Canvas.fromRgba', () => {
  it('wraps RGBA bytes of any dimensions', () => {
    const bytes = new Uint8Array(128 * 32 * 4);
    bytes.set([1, 2, 3, 4], (5 * 128 + 100) * 4);
    const c = Canvas.fromRgba(bytes, 128, 32);

    expect([c.width, c.height]).toEqual([128, 32]);
    expect(c.getPixelRgba(100, 5)).toEqual([1, 2, 3, 4]);
    expect(c.buffer).toEqual(bytes);
  });

  it('copies its input', () => {
    const bytes = new Uint8Array(3 * 2 * 4);
    const c = Canvas.fromRgba(bytes, 3, 2);
    bytes[0] = 99;
    expect(c.buffer[0]).toBe(0);
    c.buffer[1] = 77;
    expect(bytes[1]).toBe(0);
  });

  it('accepts panel sizes too', () => {
    const bytes = new Uint8Array(16 * 16 * 4).fill(200);
    const c = Canvas.fromRgba(bytes, 16, 16);
    expect(c.getPixelRgba(15, 15)).toEqual([200, 200, 200, 200]);
  });

  it.each([
    [3 * 2 * 4 - 1, 3, 2],
    [3 * 2 * 4 + 1, 3, 2],
    [3 * 2 * 3, 3, 2],
    [0, 1, 1],
  ])('rejects %i bytes for %i×%i', (length, width, height) => {
    expect(() => Canvas.fromRgba(new Uint8Array(length), width, height)).toThrow(
      new RangeError(
        `Canvas.fromRgba expected ${width * height * 4} bytes (${width}×${height}×4); got ${length}`,
      ),
    );
  });

  it.each([0, -1, 1.5, Number.NaN, 4097])('rejects %s as either dimension', (bad) => {
    expect(() => Canvas.fromRgba(new Uint8Array(0), bad, 1)).toThrow(RangeError);
    expect(() => Canvas.fromRgba(new Uint8Array(0), 1, bad)).toThrow(RangeError);
  });
});

describe('Canvas.clone', () => {
  it('creates an independent copy', () => {
    const c = new Canvas();
    c.setPixel(5, 5, [255, 0, 0]);
    const clone = c.clone();
    expect(clone.getPixel(5, 5)).toEqual([255, 0, 0]);
    clone.setPixel(5, 5, [0, 255, 0]);
    expect(c.getPixel(5, 5)).toEqual([255, 0, 0]);
  });

  it.each([
    [320, 7],
    [7, 320],
    [1, 1],
    [20, 20],
  ])('keeps a %i×%i canvas’s dimensions and alpha', (width, height) => {
    const c = new Canvas(width, height);
    c.setPixel(0, 0, [1, 2, 3]);
    c.setPixel(width - 1, height - 1, [9, 8, 7], 77);

    const clone = c.clone();

    expect([clone.width, clone.height]).toEqual([width, height]);
    expect(clone.buffer).toEqual(c.buffer);
    expect(clone.getPixelRgba(width - 1, height - 1)).toEqual([9, 8, 7, 77]);
    clone.setPixel(width - 1, height - 1, [255, 255, 255]);
    expect(c.getPixelRgba(width - 1, height - 1)).toEqual([9, 8, 7, 77]);
  });
});

describe('setPixel / getPixel', () => {
  it('sets and gets a pixel', () => {
    const c = new Canvas();
    c.setPixel(10, 20, [100, 150, 200]);
    expect(c.getPixel(10, 20)).toEqual([100, 150, 200]);
  });

  it('ignores out-of-bounds setPixel', () => {
    const c = new Canvas();
    c.setPixel(-1, 0, [255, 0, 0]);
    c.setPixel(64, 0, [255, 0, 0]);
    c.setPixel(0, -1, [255, 0, 0]);
    c.setPixel(0, 64, [255, 0, 0]);
    // Should not throw, and buffer is still zeroed
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]);
  });

  it('returns [0,0,0] for out-of-bounds getPixel', () => {
    const c = new Canvas();
    c.setPixel(0, 0, [255, 255, 255]);
    expect(c.getPixel(-1, 0)).toEqual([0, 0, 0]);
    expect(c.getPixel(64, 0)).toEqual([0, 0, 0]);
  });

  it('floors fractional coordinates', () => {
    const c = new Canvas();
    c.setPixel(1.7, 2.9, [255, 0, 0]);
    expect(c.getPixel(1, 2)).toEqual([255, 0, 0]);
  });

  it('accepts various ColorLike types', () => {
    const c = new Canvas();
    c.setPixel(0, 0, 'red');
    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
    c.setPixel(1, 0, 0x00ff00);
    expect(c.getPixel(1, 0)).toEqual([0, 255, 0]);
    c.setPixel(2, 0, '#0000ff');
    expect(c.getPixel(2, 0)).toEqual([0, 0, 255]);
  });

  it('supports method chaining', () => {
    const c = new Canvas();
    const result = c.setPixel(0, 0, [1, 2, 3]);
    expect(result).toBe(c);
  });
});

describe('clear', () => {
  it('fills the entire canvas with a color', () => {
    const c = new Canvas();
    c.clear([50, 100, 150]);
    expect(c.getPixel(0, 0)).toEqual([50, 100, 150]);
    expect(c.getPixel(32, 32)).toEqual([50, 100, 150]);
    expect(c.getPixel(63, 63)).toEqual([50, 100, 150]);
  });

  it('erases to fully transparent with no argument', () => {
    const c = new Canvas();
    c.setPixel(10, 10, [255, 0, 0]);
    c.clear();
    expect(c.getPixelRgba(10, 10)).toEqual([0, 0, 0, 0]);
    expect(paintedCount(c)).toBe(0);
  });
});

describe('fillRect', () => {
  it('fills a rectangular region', () => {
    const c = new Canvas();
    c.fillRect(10, 10, 5, 5, [255, 0, 0]);
    expect(c.getPixel(10, 10)).toEqual([255, 0, 0]);
    expect(c.getPixel(14, 14)).toEqual([255, 0, 0]);
    expect(c.getPixel(9, 10)).toEqual([0, 0, 0]);
    expect(c.getPixel(15, 10)).toEqual([0, 0, 0]);
  });

  it('clips at canvas boundaries', () => {
    const c = new Canvas();
    c.fillRect(-5, -5, 10, 10, [255, 0, 0]);
    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
    expect(c.getPixel(4, 4)).toEqual([255, 0, 0]);
    expect(c.getPixel(5, 5)).toEqual([0, 0, 0]);
  });
});

describe('fillCircle', () => {
  /** Painted x coordinates of row `y`. */
  const rowXs = (c: Canvas, y: number) =>
    range(0, c.width - 1).filter((x) => c.getPixelRgba(x, y)[3] !== 0);

  /** Indexes of the painted pixels, read straight from the buffer. */
  const lit = (c: Canvas): Set<number> => {
    const out = new Set<number>();
    for (let i = 3; i < c.buffer.length; i += 4) if (c.buffer[i] !== 0) out.add(i >> 2);
    return out;
  };

  it('fills a solid circle', () => {
    const c = new Canvas();
    c.fillCircle(32, 32, 5, [0, 255, 0]);
    expect(c.getPixel(32, 32)).toEqual([0, 255, 0]); // center
    expect(c.getPixel(32, 27)).toEqual([0, 255, 0]); // top edge
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]); // far away
  });

  it('leaves no one-pixel nub at the top of a radius-12 disc (issue repro)', () => {
    const c = new Canvas(32, 32).fillCircle(16, 16, 12, 'white');
    expect(rowXs(c, 3)).toEqual([]);
    expect(rowXs(c, 4)).toEqual(range(13, 19));
    expect(rowXs(c, 5)).toEqual(range(11, 21));
    for (const y of [15, 16, 17]) expect(rowXs(c, y), `row ${y}`).toEqual(range(4, 28));
  });

  it.each<[number, number]>([
    [24, 24],
    [23.5, 24.5],
    [20.25, 27.75],
    [-3, 30],
    [50, 10.5],
  ])('fills exactly the pixels with dx² + dy² ≤ r² + r about (%s, %s)', (cx, cy) => {
    const radii = [0, 0.3, 0.5, 1, 1.2, 2, 2.5, 3, 7, 7.3, 12, 20.7, 30];
    const mismatched = radii.filter((r) => {
      const c = new Canvas(48).fillCircle(cx, cy, r, 'white');
      return Buffer.compare(c.buffer, footprint(48, 48, cx, cy, r).buffer) !== 0;
    });
    expect(mismatched).toEqual([]);
  });

  it('has no one-pixel row or column at any pole for integer radii 1–64', () => {
    const nubbed = range(1, 64).filter((r) => {
      const disc = new Canvas(131).fillCircle(65, 65, r, 'white');
      const column = (x: number) => range(0, 130).filter((y) => disc.getPixelRgba(x, y)[3] !== 0);
      const ends = [rowXs(disc, 65 - r), rowXs(disc, 65 + r), column(65 - r), column(65 + r)];
      return ends.some((run) => run.length < 2);
    });
    expect(nubbed).toEqual([]);
  });

  it.each<[number, number]>([
    [65, 65],
    [10, 120],
    [0, 0],
  ])(
    'contains the integer-radius drawCircle ring of the same center (%s, %s) for radii 0–64',
    (cx, cy) => {
      const outside = range(0, 64).flatMap((r) => {
        const fill = lit(new Canvas(131).fillCircle(cx, cy, r, 'white'));
        const ring = [...lit(new Canvas(131).drawCircle(cx, cy, r, 'white'))];
        return ring
          .filter((i) => !fill.has(i))
          .map((i) => `r ${r}: (${i % 131}, ${(i / 131) | 0})`);
      });
      expect(outside).toEqual([]);
    },
  );

  it.each<[number, number]>([
    [24, 24],
    [23.5, 24.5],
    [20.3, 27.8],
  ])(
    'grows with the radius about (%s, %s): each footprint contains every smaller one',
    (cx, cy) => {
      const shrunk: string[] = [];
      let previous = new Set<number>();
      for (let step = 0; step <= 480; step++) {
        const r = step / 20;
        const current = lit(new Canvas(48).fillCircle(cx, cy, r, 'white'));
        for (const i of previous) if (!current.has(i)) shrunk.push(`r ${r}: ${i}`);
        previous = current;
      }
      expect(shrunk).toEqual([]);
    },
  );

  it.each([-0.3, -0.5, -0.99, -1, -2.5])('draws nothing for the negative radius %s', (r) => {
    for (const [cx, cy] of [
      [8, 8],
      [8.2, 7.9],
      [7.5, 7.5],
    ] as const) {
      for (const opts of [undefined, { alpha: 0.5 }]) {
        const c = mixedBackdrop(16, 16);
        const before = new Uint8Array(c.buffer);
        expect(c.fillCircle(cx, cy, r, 'white', opts)).toBe(c);
        expect(c.buffer, `(${cx}, ${cy}) ${JSON.stringify(opts)}`).toEqual(before);
      }
    }
  });

  it('stacks translucent discs into a glow with no + at the poles', () => {
    const c = new Canvas(40).clear('black');
    for (let r = 1; r <= 12; r++) c.fillCircle(20, 20, r, [255, 140, 40], { alpha: 0.2 });
    const level = (x: number, y: number) => c.getPixelRgba(x, y)[0];
    const nubs = range(1, 12).flatMap((r) =>
      (
        [
          [20, 20 - r, 1, 0],
          [20, 20 + r, 1, 0],
          [20 - r, 20, 0, 1],
          [20 + r, 20, 0, 1],
        ] as const
      )
        .filter(
          ([x, y, sx, sy]) =>
            level(x, y) !== level(x - sx, y - sy) || level(x, y) !== level(x + sx, y + sy),
        )
        .map(([x, y]) => `(${x}, ${y})`),
    );
    expect(nubs).toEqual([]);
  });
});

describe('drawRect', () => {
  it('draws a rectangle outline', () => {
    const c = new Canvas();
    c.drawRect(10, 10, 10, 10, [255, 255, 0]);
    // Corners
    expect(c.getPixel(10, 10)).toEqual([255, 255, 0]);
    expect(c.getPixel(19, 10)).toEqual([255, 255, 0]);
    expect(c.getPixel(10, 19)).toEqual([255, 255, 0]);
    expect(c.getPixel(19, 19)).toEqual([255, 255, 0]);
    // Interior should be empty
    expect(c.getPixel(15, 15)).toEqual([0, 0, 0]);
  });

  it.each<[string, number, number, number, number]>([
    ['a 10×10 square', 10, 10, 10, 10],
    ['a single pixel', 0, 0, 1, 1],
    ['a 1-wide column', 5, 5, 1, 4],
    ['a 1-tall row', 5, 5, 4, 1],
    ['a 2×2 block', 30, 30, 2, 2],
    ['a rect clipped at the top left', -3, -3, 8, 8],
    ['a rect clipped at the bottom right', 60, 60, 10, 10],
    ['a rect wider than the canvas', -5, 20, 80, 6],
  ])('outlines %s exactly (integer geometry is unchanged)', (_name, x, y, w, h) => {
    const c = new Canvas(64);
    expect(c.drawRect(x, y, w, h, 'red')).toBe(c);

    const expected = new Canvas(64);
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (px === x || px === x + w - 1 || py === y || py === y + h - 1) {
          expected.setPixel(px, py, 'red');
        }
      }
    }
    expect(Buffer.compare(c.buffer, expected.buffer)).toBe(0);
  });

  it('draws nothing for a zero width, as fillRect paints nothing (issue repro)', () => {
    const c = new Canvas(16);
    expect(c.drawRect(10, 10, 0, 3, 'white')).toBe(c);
    expect(paintedPixels(c)).toEqual([]);
  });

  it.each<[string, number, number, number, number]>([
    ['a zero width', 10, 10, 0, 3],
    ['a negative width', 10, 10, -2, 3],
    ['a zero height', 10, 10, 3, 0],
    ['a negative height', 10, 10, 3, -2],
    ['a zero width and height', 10, 10, 0, 0],
    ['a negative width and height', 10, 10, -3, -3],
    ['a width under one pixel', 10, 10, 0.5, 3],
    ['a fractional width that floors to its own start', 10.25, 10, 0.5, 3],
    ['a height under one pixel', 10, 10, 3, 0.9],
    ['a zero width at the canvas edge', 0, 0, 0, 16],
  ])('draws nothing for %s, as fillRect paints nothing', (_name, x, y, w, h) => {
    const stroked = new Canvas(16);
    const filled = new Canvas(16);
    stroked.setPixel(2, 2, [1, 2, 3], 17);
    const before = new Uint8Array(stroked.buffer);

    expect(stroked.drawRect(x, y, w, h, 'white')).toBe(stroked);
    filled.fillRect(x, y, w, h, 'white');

    expect(stroked.buffer).toEqual(before);
    expect(paintedCount(filled)).toBe(0);
  });

  it('still resolves the color of an empty rect', () => {
    expect(() => new Canvas(16).drawRect(10, 10, 0, 3, 'not-a-color')).toThrow();
  });
});

describe('drawCircle', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s radius without mutation', (_name, radius) => {
    const c = new Canvas(16);
    c.setPixel(2, 2, [1, 2, 3], 17);
    const before = new Uint8Array(c.buffer);

    expect(() => c.drawCircle(8, 8, radius, [255, 0, 0])).toThrow(RangeError);
    expect(c.buffer).toEqual(before);
  });

  it('validates the radius before resolving the color', () => {
    const c = new Canvas(16);

    expect(() => c.drawCircle(8, 8, Number.NaN, 'not-a-color')).toThrow(
      new RangeError('drawCircle center and radius must be finite'),
    );
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects a %s center without mutation', (_name, value) => {
    const cx = new Canvas(16);
    const cy = new Canvas(16);
    cx.setPixel(2, 2, [1, 2, 3], 17);
    cy.setPixel(2, 2, [1, 2, 3], 17);
    const before = new Uint8Array(cx.buffer);

    expect(() => cx.drawCircle(value, 8, 4, [255, 0, 0])).toThrow(RangeError);
    expect(() => cy.drawCircle(8, value, 4, [255, 0, 0])).toThrow(RangeError);
    expect(cx.buffer).toEqual(before);
    expect(cy.buffer).toEqual(before);
  });

  it('draws a circle outline', () => {
    const c = new Canvas();
    expect(c.drawCircle(32, 32, 10, [0, 0, 255])).toBe(c);
    // Top of circle should be set
    expect(c.getPixel(32, 22)).toEqual([0, 0, 255]);
    // Center should not be set
    expect(c.getPixel(32, 32)).toEqual([0, 0, 0]);
  });

  it('draws a zero-radius circle as one pixel', () => {
    const c = new Canvas(16);

    expect(c.drawCircle(8, 8, 0, [255, 0, 0])).toBe(c);
    expect(c.getPixelRgba(8, 8)).toEqual([255, 0, 0, 255]);
    expect(c.buffer.filter((value, index) => index % 4 === 3 && value !== 0)).toHaveLength(1);
  });

  it('treats a negative finite radius as a no-op', () => {
    const c = new Canvas(16);
    c.setPixel(2, 2, [1, 2, 3], 17);
    const before = new Uint8Array(c.buffer);

    expect(c.drawCircle(8, 8, -1, [255, 0, 0])).toBe(c);
    expect(c.buffer).toEqual(before);
  });
});

describe('drawCircle with an integer radius', () => {
  it('draws the midpoint ring for radius 1 and 3', () => {
    const c = new Canvas(12, 9);
    c.drawCircle(2, 2, 1, 'white');
    c.drawCircle(7, 4, 3, 'white');

    expect(rowsOf(c)).toEqual([
      '............',
      '.###..###...',
      '.#.#.#...#..',
      '.####.....#.',
      '....#.....#.',
      '....#.....#.',
      '.....#...#..',
      '......###...',
      '............',
    ]);
  });

  it.each<[number, number]>([
    [32, 32],
    [0, 0],
    [63, 10],
    [-5, 30],
    [70, 70],
    [20, -9],
  ])('paints what the midpoint loop did for radii 0–72 about (%s, %s)', (cx, cy) => {
    expect(midpointMismatches(64, 64, cx, cy, range(0, 72))).toEqual([]);
  });

  it.each<[number, number]>([
    [20, 6],
    [-3, 20],
    [45, 5],
  ])('paints what the midpoint loop did on a 40×12 strip about (%s, %s)', (cx, cy) => {
    expect(midpointMismatches(40, 12, cx, cy, range(0, 50))).toEqual([]);
  });

  it.each<[string, number, number, number]>([
    ['r = 1000 through the left of the canvas', -990, 30, 1000],
    ['r = 1000 through the top of the canvas', 32, 1030, 1000],
    ['r = 10⁶ through the canvas', -999_968, 32, 1_000_000],
    ['r = 2²⁵ + 1 through the canvas', -(2 ** 25) + 31, 20, 2 ** 25 + 1],
    ['r = 2²⁵ + 1 across the canvas bottom', 40, 2 ** 25 + 60, 2 ** 25 + 1],
  ])('paints what the midpoint loop did for %s', (_name, cx, cy, r) => {
    expect(midpointMismatches(64, 64, cx, cy, [r])).toEqual([]);
  });
});

describe('drawCircle cost', () => {
  /** Run `draw` and return how long it took, in milliseconds. */
  function timed(draw: () => void): number {
    const started = performance.now();
    draw();
    return performance.now() - started;
  }

  it('returns promptly for a radius of 1e9 centered on the canvas', () => {
    const c = new Canvas(64);
    expect(timed(() => c.drawCircle(32, 32, 1e9, 'white'))).toBeLessThan(250);
    expect(paintedCount(c)).toBe(0);
  });

  it('returns promptly for a radius of 1e15 and paints nothing, the ring lying off the canvas (issue repro)', () => {
    const c = new Canvas(64);
    expect(timed(() => c.drawCircle(32, 32, 1e15, 'white'))).toBeLessThan(250);
    expect(paintedCount(c)).toBe(0);
  });

  it.each([
    ['Number.MAX_VALUE', Number.MAX_VALUE],
    ['1e300', 1e300],
    ['2⁴⁰ + ½', 2 ** 40 + 0.5],
  ])('returns promptly for a radius of %s', (_name, radius) => {
    const c = new Canvas(64);
    expect(timed(() => c.drawCircle(32, 32, radius, 'white'))).toBeLessThan(250);
    expect(paintedCount(c)).toBe(0);
  });

  it('paints the clipped arc of a 1e15 ring that crosses the canvas', () => {
    const vertical = new Canvas(64);
    const horizontal = new Canvas(64);
    expect(timed(() => vertical.drawCircle(-1e15 + 32, 20, 1e15, 'white'))).toBeLessThan(250);
    expect(timed(() => horizontal.drawCircle(40, 1e15 + 60, 1e15, 'white'))).toBeLessThan(250);

    // A radius this large is flat across 64 pixels: one column, one row.
    expect(paintedPixels(vertical)).toEqual(range(0, 63).map((y) => [32, y]));
    expect(paintedPixels(horizontal)).toEqual(range(0, 63).map((x) => [x, 60]));
  });

  it('bounds the cost of a ring through a 4096×4096 canvas by the canvas', () => {
    const c = new Canvas(4096);
    expect(timed(() => c.drawCircle(-1e12 + 2000, 2048, 1e12, 'white'))).toBeLessThan(1000);
    expect(paintedCount(c)).toBe(4096);
  });

  it('paints the clipped edge of a large fractional ring through the canvas', () => {
    const cx = -1_000_000 + 32.25;
    const c = new Canvas(64);
    expect(timed(() => c.drawCircle(cx, 32, 1_000_000.5, 'white'))).toBeLessThan(250);
    expect(Buffer.compare(c.buffer, footprintEdge(64, 64, cx, 32, 1_000_000.5).buffer)).toBe(0);
    expect(paintedCount(c)).toBeGreaterThan(0);
  });

  it('paints the clipped edge of a large integer-radius ring about a fractional center', () => {
    const cy = 1_000_000 + 40.5;
    const c = new Canvas(64);
    expect(timed(() => c.drawCircle(20.75, cy, 1_000_000, 'white'))).toBeLessThan(250);
    expect(Buffer.compare(c.buffer, footprintEdge(64, 64, 20.75, cy, 1_000_000).buffer)).toBe(0);
    expect(paintedCount(c)).toBeGreaterThan(0);
  });

  it.each([
    ['1e15', 1e15],
    ['1e300', 1e300],
    ['Number.MAX_VALUE', Number.MAX_VALUE],
  ])(
    'returns promptly for a radius of %s about a fractional center, painting nothing',
    (_name, radius) => {
      const c = new Canvas(64);
      expect(timed(() => c.drawCircle(32.5, 31.25, radius, 'white'))).toBeLessThan(250);
      expect(paintedCount(c)).toBe(0);
    },
  );
});

describe('drawCircle with a fractional radius', () => {
  it('is symmetric about its center, on the edge of fillCircle (issue repro)', () => {
    const c = new Canvas(64).drawCircle(32, 32, 7.3, 'white');
    const row = paintedPixels(c).filter(([, y]) => y === 32);
    const column = paintedPixels(c).filter(([x]) => x === 32);

    // fillCircle(32, 32, 7.3) spans x 25–39 on row 32 and y 25–39 on column 32
    expect(row).toEqual([
      [25, 32],
      [39, 32],
    ]);
    expect(column).toEqual([
      [32, 25],
      [32, 39],
    ]);
  });

  const RADII = [0.5, 1.2, 1.5, 2.9, 3.9, 7.3, 7.5, 10.25, 20.7, 31.49, 45.01];

  it.each<[number, number]>([
    [32, 32],
    [10, 12],
    [0, 63],
    [70, -4],
  ])('paints exactly the edge of the fillCircle footprint about (%s, %s)', (cx, cy) => {
    const mismatched = RADII.filter((r) => {
      const c = new Canvas(64).drawCircle(cx, cy, r, 'white');
      return Buffer.compare(c.buffer, footprintEdge(64, 64, cx, cy, r).buffer) !== 0;
    });
    expect(mismatched).toEqual([]);
  });

  it.each<[number, number]>([
    [32.5, 32.5],
    [20.25, 11.75],
    [-0.4, 40.6],
  ])(
    'paints exactly the edge of the fillCircle footprint about the fractional center (%s, %s)',
    (cx, cy) => {
      const mismatched = RADII.filter((r) => {
        const c = new Canvas(64).drawCircle(cx, cy, r, 'white');
        return Buffer.compare(c.buffer, footprintEdge(64, 64, cx, cy, r).buffer) !== 0;
      });
      expect(mismatched).toEqual([]);
    },
  );

  it('paints the edge of a fractional ring on a non-square strip', () => {
    for (const r of RADII) {
      const c = new Canvas(40, 12).drawCircle(20, 6, r, 'white');
      expect(Buffer.compare(c.buffer, footprintEdge(40, 12, 20, 6, r).buffer), `r=${r}`).toBe(0);
    }
  });

  it.each(RADII)('mirrors across both axes of an integer center at radius %s', (r) => {
    const rows = rowsOf(new Canvas(65).drawCircle(32, 32, r, 'white'));
    const mirrored = rows.map((row) => [...row].reverse().join(''));
    expect(mirrored).toEqual(rows);
    expect(rows.toReversed()).toEqual(rows);
  });

  it.each(RADII)('paints exactly the edge of what fillCircle paints at radius %s', (r) => {
    for (const [cx, cy] of [
      [50, 50],
      [48.5, 51],
      [47.25, 52.75],
    ] as const) {
      const fill = new Canvas(100).fillCircle(cx, cy, r, 'white');
      const ring = new Canvas(100).drawCircle(cx, cy, r, 'white');
      expect(rowsOf(ring), `(${cx}, ${cy})`).toEqual(rowsOf(edgeOf(fill)));
    }
  });

  it.each(RADII)('stays inside the fillCircle footprint at radius %s', (r) => {
    const ring = new Canvas(64).drawCircle(30.5, 33, r, 'white');
    const fill = new Canvas(64).fillCircle(30.5, 33, r, 'white');
    const outside = paintedPixels(ring).filter(([x, y]) => fill.getPixelRgba(x, y)[3] === 0);
    expect(outside).toEqual([]);
  });

  it('draws nothing for a negative fractional radius', () => {
    const c = new Canvas(16);
    expect(c.drawCircle(8, 8, -2.5, 'white')).toBe(c);
    expect(paintedCount(c)).toBe(0);
  });
});

describe('drawCircle with an integer radius about a fractional center', () => {
  it.each<[number, number, number]>([
    [10.7, 20.2, 5],
    [32.5, 32.5, 7],
    [20.9, 12.1, 10],
  ])('lies on fillCircle(%s, %s, %s), tracing its edge (issue repro)', (cx, cy, r) => {
    const fill = new Canvas(64).fillCircle(cx, cy, r, 'white');
    const ring = new Canvas(64).drawCircle(cx, cy, r, 'white');
    const outside = paintedPixels(ring).filter(([x, y]) => fill.getPixelRgba(x, y)[3] === 0);
    expect(outside).toEqual([]);
    expect(rowsOf(ring)).toEqual(rowsOf(edgeOf(fill)));
  });

  it.each<[number, number]>([
    [10.7, 20.2],
    [32.5, 32.5],
    [20.9, 12.1],
    [31.25, 30.75],
    [-0.4, 40.6],
    [63.5, 0.5],
    [32, 31.5],
    [31.5, 32],
    [40.3, 17],
  ])(
    'paints exactly the edge of the fillCircle footprint for radii 1–32 about (%s, %s)',
    (cx, cy) => {
      const mismatched = range(1, 32).filter((r) => {
        const c = new Canvas(64).drawCircle(cx, cy, r, 'white');
        return Buffer.compare(c.buffer, footprintEdge(64, 64, cx, cy, r).buffer) !== 0;
      });
      expect(mismatched).toEqual([]);
    },
  );

  it.each<[number, number]>([
    [10.7, 20.2],
    [-0.5, 63.9],
  ])('paints the clipped footprint edge for radii 0–72 about (%s, %s)', (cx, cy) => {
    const mismatched = range(0, 72).filter((r) => {
      const c = new Canvas(64).drawCircle(cx, cy, r, 'white');
      return Buffer.compare(c.buffer, footprintEdge(64, 64, cx, cy, r).buffer) !== 0;
    });
    expect(mismatched).toEqual([]);
  });

  it('paints the footprint edge on a non-square strip', () => {
    for (const r of range(0, 24)) {
      const c = new Canvas(40, 12).drawCircle(19.5, 6.25, r, 'white');
      const expected = footprintEdge(40, 12, 19.5, 6.25, r);
      expect(Buffer.compare(c.buffer, expected.buffer), `r=${r}`).toBe(0);
    }
  });

  it('draws nothing at radius 0 about a fractional center, as fillCircle fills nothing', () => {
    for (const [cx, cy] of [
      [8.5, 8.5],
      [8, 8.25],
      [7.9, 8],
    ] as const) {
      const ring = new Canvas(16).drawCircle(cx, cy, 0, 'white');
      const fill = new Canvas(16).fillCircle(cx, cy, 0, 'white');
      expect(paintedCount(ring), `(${cx}, ${cy})`).toBe(0);
      expect(paintedCount(fill), `(${cx}, ${cy})`).toBe(0);
    }
  });
});

describe('drawLine', () => {
  it.each([
    ['NaN', 'x0', 0, Number.NaN],
    ['Infinity', 'x0', 0, Number.POSITIVE_INFINITY],
    ['-Infinity', 'x0', 0, Number.NEGATIVE_INFINITY],
    ['NaN', 'y0', 1, Number.NaN],
    ['Infinity', 'y0', 1, Number.POSITIVE_INFINITY],
    ['-Infinity', 'y0', 1, Number.NEGATIVE_INFINITY],
    ['NaN', 'x1', 2, Number.NaN],
    ['Infinity', 'x1', 2, Number.POSITIVE_INFINITY],
    ['-Infinity', 'x1', 2, Number.NEGATIVE_INFINITY],
    ['NaN', 'y1', 3, Number.NaN],
    ['Infinity', 'y1', 3, Number.POSITIVE_INFINITY],
    ['-Infinity', 'y1', 3, Number.NEGATIVE_INFINITY],
  ])('rejects %s at %s without mutation', (_valueName, _endpointName, index, value) => {
    const c = new Canvas(16);
    c.setPixel(2, 2, [1, 2, 3], 17);
    const before = new Uint8Array(c.buffer);
    const endpoints: [number, number, number, number] = [1, 1, 3, 3];
    endpoints[index] = value;

    expect(() => c.drawLine(...endpoints, [255, 0, 0])).toThrow(RangeError);
    expect(c.buffer).toEqual(before);
  });

  it.each<[name: string, endpoints: [number, number, number, number]]>([
    ['horizontal', [Number.MAX_VALUE, 0, 0, 0]],
    ['vertical', [0, Number.MAX_VALUE, 0, 0]],
    ['diagonal', [Number.MAX_VALUE, Number.MAX_VALUE, 0, 0]],
  ])('clips an intersecting extreme finite %s segment', (_name, endpoints) => {
    const c = new Canvas(16);

    expect(c.drawLine(...endpoints, [255, 0, 0])).toBe(c);

    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
  });

  it('ignores an entirely off-canvas extreme finite segment', () => {
    const c = new Canvas(16);
    c.setPixel(2, 2, [1, 2, 3], 17);
    const before = new Uint8Array(c.buffer);

    expect(c.drawLine(Number.MAX_VALUE, 16, 0, 16, [255, 0, 0])).toBe(c);
    expect(c.buffer).toEqual(before);
  });

  it('ignores an off-canvas extreme finite point', () => {
    const c = new Canvas(16);
    const before = new Uint8Array(c.buffer);

    expect(
      c.drawLine(
        Number.MAX_VALUE,
        Number.MAX_VALUE,
        Number.MAX_VALUE,
        Number.MAX_VALUE,
        [255, 0, 0],
      ),
    ).toBe(c);
    expect(c.buffer).toEqual(before);
  });

  it('draws a horizontal line', () => {
    const c = new Canvas();
    c.drawLine(5, 10, 15, 10, [255, 0, 0]);
    for (let x = 5; x <= 15; x++) {
      expect(c.getPixel(x, 10)).toEqual([255, 0, 0]);
    }
  });

  it('draws a vertical line', () => {
    const c = new Canvas();
    c.drawLine(10, 5, 10, 15, [0, 255, 0]);
    for (let y = 5; y <= 15; y++) {
      expect(c.getPixel(10, y)).toEqual([0, 255, 0]);
    }
  });

  it('draws a diagonal line (Bresenham)', () => {
    const c = new Canvas();
    c.drawLine(0, 0, 10, 10, [255, 255, 255]);
    expect(c.getPixel(0, 0)).toEqual([255, 255, 255]);
    expect(c.getPixel(5, 5)).toEqual([255, 255, 255]);
    expect(c.getPixel(10, 10)).toEqual([255, 255, 255]);
  });

  it('draws a single-pixel line', () => {
    const c = new Canvas();
    c.drawLine(5, 5, 5, 5, [255, 0, 0]);
    expect(c.getPixel(5, 5)).toEqual([255, 0, 0]);
  });

  it('floors finite fractional endpoints and supports chaining', () => {
    const fractional = new Canvas(16);
    const integer = new Canvas(16);

    expect(fractional.drawLine(1.9, 2.9, 5.9, 4.9, [255, 0, 0])).toBe(fractional);
    integer.drawLine(1, 2, 5, 4, [255, 0, 0]);

    expect(fractional.buffer).toEqual(integer.buffer);
  });

  it('clips finite out-of-bounds endpoints', () => {
    const c = new Canvas(16);
    c.drawLine(-2, 0, 2, 0, [255, 0, 0]);

    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
    expect(c.getPixel(1, 0)).toEqual([255, 0, 0]);
    expect(c.getPixel(2, 0)).toEqual([255, 0, 0]);
    expect(c.getPixel(3, 0)).toEqual([0, 0, 0]);
  });

  it.each<[endpoints: [number, number, number, number], expectedPixels: [number, number][]]>([
    [
      [-2, 0, 2, 1],
      [
        [0, 1],
        [1, 1],
        [2, 1],
      ],
    ],
    [
      [2, 1, -2, 0],
      [
        [0, 0],
        [1, 1],
        [2, 1],
      ],
    ],
  ])('preserves the clipped Bresenham raster for %j', (endpoints, expectedPixels) => {
    const c = new Canvas(16);

    c.drawLine(...endpoints, [255, 0, 0]);

    const actualPixels: [number, number][] = [];
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (c.getPixelRgba(x, y)[3] !== 0) actualPixels.push([x, y]);
      }
    }
    expect(actualPixels).toEqual(expectedPixels);
  });
});

describe('drawLineH / drawLineV', () => {
  it('draws fast horizontal line', () => {
    const c = new Canvas();
    c.drawLineH(5, 10, 10, [128, 128, 128]);
    for (let x = 5; x < 15; x++) {
      expect(c.getPixel(x, 10)).toEqual([128, 128, 128]);
    }
    expect(c.getPixel(4, 10)).toEqual([0, 0, 0]);
    expect(c.getPixel(15, 10)).toEqual([0, 0, 0]);
  });

  it('draws fast vertical line', () => {
    const c = new Canvas();
    c.drawLineV(10, 5, 10, [64, 64, 64]);
    for (let y = 5; y < 15; y++) {
      expect(c.getPixel(10, y)).toEqual([64, 64, 64]);
    }
    expect(c.getPixel(10, 4)).toEqual([0, 0, 0]);
    expect(c.getPixel(10, 15)).toEqual([0, 0, 0]);
  });

  it('clips horizontal line out of bounds', () => {
    const c = new Canvas();
    c.drawLineH(0, -1, 10, [255, 0, 0]); // off-screen Y
    expect(c.getPixel(5, 0)).toEqual([0, 0, 0]);
  });

  it('clips vertical line out of bounds', () => {
    const c = new Canvas();
    c.drawLineV(-1, 0, 10, [255, 0, 0]); // off-screen X
    expect(c.getPixel(0, 5)).toEqual([0, 0, 0]);
  });
});

describe('drawTriangle', () => {
  it('draws three edges', () => {
    const c = new Canvas();
    c.drawTriangle(10, 10, 20, 10, 15, 5, [255, 0, 0]);
    expect(c.getPixel(10, 10)).toEqual([255, 0, 0]);
    expect(c.getPixel(20, 10)).toEqual([255, 0, 0]);
    expect(c.getPixel(15, 5)).toEqual([255, 0, 0]);
  });

  it.each<[string, [number, number, number, number, number, number]]>([
    ['integer vertices', [10, 10, 20, 10, 15, 5]],
    ['fractional vertices', [1.5, 2.25, 13.9, 4.1, 6.5, 14.75]],
    ['vertices off the canvas', [-10, 3, 20, -8, 8, 30]],
  ])('paints its three edges exactly as drawLine does, for %s', (_name, v) => {
    const [x0, y0, x1, y1, x2, y2] = v;
    const c = new Canvas(16);
    expect(c.drawTriangle(x0, y0, x1, y1, x2, y2, 'red')).toBe(c);

    const expected = new Canvas(16)
      .drawLine(x0, y0, x1, y1, 'red')
      .drawLine(x1, y1, x2, y2, 'red')
      .drawLine(x2, y2, x0, y0, 'red');
    expect(Buffer.compare(c.buffer, expected.buffer)).toBe(0);
  });
});

describe('fillTriangle', () => {
  it('fills interior pixels of a triangle', () => {
    const c = new Canvas();
    // Large triangle: (5,30) (30,5) (55,30) — plenty of interior
    c.fillTriangle(5, 30, 30, 5, 55, 30, [255, 0, 0]);
    // Center of the triangle should be filled
    expect(c.getPixel(30, 20)).toEqual([255, 0, 0]);
    expect(c.getPixel(20, 25)).toEqual([255, 0, 0]);
    expect(c.getPixel(40, 25)).toEqual([255, 0, 0]);
  });

  it('does not fill outside the triangle', () => {
    const c = new Canvas();
    c.fillTriangle(5, 30, 30, 5, 55, 30, [255, 0, 0]);
    // Well outside
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]);
    expect(c.getPixel(63, 63)).toEqual([0, 0, 0]);
    // Above the apex
    expect(c.getPixel(30, 2)).toEqual([0, 0, 0]);
  });

  it('paints nothing for a degenerate (collinear) triangle', () => {
    const c = new Canvas();
    // Horizontal line — every vertex on row 5, so no scanline has any span
    expect(c.fillTriangle(5, 5, 10, 5, 15, 5, [255, 0, 0])).toBe(c);
    expect(paintedCount(c)).toBe(0);
    expect(c.getPixelRgba(5, 5)).toEqual([0, 0, 0, 0]);
    expect(c.getPixelRgba(10, 5)).toEqual([0, 0, 0, 0]);
  });

  it('leaves no gap row at a fractional middle vertex', () => {
    const c = new Canvas(64);
    c.fillTriangle(10, 10, 40, 20.5, 12, 40, 'white');
    expect(emptyRows(c, 10, 40)).toEqual([]);
  });

  it('leaves no gap row at an integer middle vertex', () => {
    const c = new Canvas(64);
    c.fillTriangle(10, 10, 40, 20, 12, 40, 'white');
    expect(emptyRows(c, 10, 40)).toEqual([]);
  });

  it.each([20.01, 20.5, 20.99, 25.5])('covers every row for a middle vertex at y=%s', (by) => {
    const c = new Canvas(64);
    c.fillTriangle(10, 10, 40, by, 12, 40, 'white');

    expect(emptyRows(c, 10, 40)).toEqual([]);
  });

  it('paints the exact fill of a fractional-middle-vertex triangle', () => {
    const c = new Canvas(16);
    c.fillTriangle(3, 2, 11, 6.5, 5, 10, [255, 0, 0]);

    const rows: string[] = [];
    for (let y = 0; y < c.height; y++) {
      let row = '';
      for (let x = 0; x < c.width; x++) row += c.getPixelRgba(x, y)[3] !== 0 ? '#' : '.';
      rows.push(row);
    }
    // Rows 2–10 are each a single contiguous span, widest on row 6 — the last
    // row of the upper half, immediately above the middle vertex at y=6.5.
    expect(rows).toEqual([
      '................',
      '................',
      '...#............',
      '....#...........',
      '....###.........',
      '....#####.......',
      '....#######.....',
      '.....######.....',
      '.....####.......',
      '.....##.........',
      '.....#..........',
      '................',
      '................',
      '................',
      '................',
      '................',
    ]);
  });

  it('keeps the row above a fractional middle vertex on a sliver triangle', () => {
    const c = new Canvas(16);
    c.fillTriangle(2, 4, 12, 4.5, 2, 5, [255, 0, 0]);

    const painted: [number, number][] = [];
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (c.getPixelRgba(x, y)[3] !== 0) painted.push([x, y]);
      }
    }
    expect(painted).toEqual([
      [2, 4],
      [2, 5],
    ]);
  });
});

describe('non-finite geometry', () => {
  const NON_FINITE: [string, number][] = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ];

  const GUARDED: [string, (c: Canvas, value: number, color: string) => unknown][] = [
    ['fillRect x', (c, v, color) => c.fillRect(v, 0, 4, 4, color)],
    ['fillRect y', (c, v, color) => c.fillRect(0, v, 4, 4, color)],
    ['fillRect w', (c, v, color) => c.fillRect(0, 0, v, 4, color)],
    ['fillRect h', (c, v, color) => c.fillRect(0, 0, 4, v, color)],
    ['fillCircle cx', (c, v, color) => c.fillCircle(v, 8, 4, color)],
    ['fillCircle cy', (c, v, color) => c.fillCircle(8, v, 4, color)],
    ['fillCircle radius', (c, v, color) => c.fillCircle(8, 8, v, color)],
    ['drawCircle cx', (c, v, color) => c.drawCircle(v, 8, 4, color)],
    ['drawCircle cy', (c, v, color) => c.drawCircle(8, v, 4, color)],
    ['drawCircle radius', (c, v, color) => c.drawCircle(8, 8, v, color)],
    ['fillTriangle x0', (c, v, color) => c.fillTriangle(v, 0, 8, 2, 4, 8, color)],
    ['fillTriangle y0', (c, v, color) => c.fillTriangle(0, v, 8, 2, 4, 8, color)],
    ['fillTriangle x1', (c, v, color) => c.fillTriangle(0, 0, v, 2, 4, 8, color)],
    ['fillTriangle y1', (c, v, color) => c.fillTriangle(0, 0, 8, v, 4, 8, color)],
    ['fillTriangle x2', (c, v, color) => c.fillTriangle(0, 0, 8, 2, v, 8, color)],
    ['fillTriangle y2', (c, v, color) => c.fillTriangle(0, 0, 8, 2, 4, v, color)],
    ['drawLineH x', (c, v, color) => c.drawLineH(v, 4, 6, color)],
    ['drawLineH y', (c, v, color) => c.drawLineH(0, v, 6, color)],
    ['drawLineH length', (c, v, color) => c.drawLineH(0, 4, v, color)],
    ['drawLineV x', (c, v, color) => c.drawLineV(v, 4, 6, color)],
    ['drawLineV y', (c, v, color) => c.drawLineV(4, v, 6, color)],
    ['drawLineV length', (c, v, color) => c.drawLineV(4, 0, v, color)],
    ['drawRect x', (c, v, color) => c.drawRect(v, 0, 8, 8, color)],
    ['drawRect y', (c, v, color) => c.drawRect(0, v, 8, 8, color)],
    ['drawRect w', (c, v, color) => c.drawRect(0, 0, v, 8, color)],
    ['drawRect h', (c, v, color) => c.drawRect(0, 0, 8, v, color)],
    ['drawTriangle x0', (c, v, color) => c.drawTriangle(v, 0, 8, 2, 4, 8, color)],
    ['drawTriangle y0', (c, v, color) => c.drawTriangle(0, v, 8, 2, 4, 8, color)],
    ['drawTriangle x1', (c, v, color) => c.drawTriangle(0, 0, v, 2, 4, 8, color)],
    ['drawTriangle y1', (c, v, color) => c.drawTriangle(0, 0, 8, v, 4, 8, color)],
    ['drawTriangle x2', (c, v, color) => c.drawTriangle(0, 0, 8, 2, v, 8, color)],
    ['drawTriangle y2', (c, v, color) => c.drawTriangle(0, 0, 8, 2, 4, v, color)],
    ['blit dx', (c, v) => c.blit(new Canvas(4).clear('white'), v, 0)],
    ['blit dy', (c, v) => c.blit(new Canvas(4).clear('white'), 0, v)],
    ['gradientRadial cx', (c, v, color) => c.gradientRadial(v, 8, 4, color, 'black')],
    ['gradientRadial cy', (c, v, color) => c.gradientRadial(8, v, 4, color, 'black')],
    ['gradientRadial radius', (c, v, color) => c.gradientRadial(8, 8, v, color, 'black')],
  ];

  const cases = GUARDED.flatMap(([label, call]) =>
    NON_FINITE.map(
      ([valueName, value]) =>
        [label, valueName, call, value] as [string, string, typeof call, number],
    ),
  );

  it.each(cases)('rejects %s = %s without mutation', (_label, _valueName, call, value) => {
    const c = new Canvas(16);
    c.setPixel(2, 2, [1, 2, 3], 17);
    const before = new Uint8Array(c.buffer);

    expect(() => call(c, value, 'red')).toThrow(RangeError);
    expect(c.buffer).toEqual(before);
  });

  it('rejects a NaN width instead of drawing a stray rectangle edge', () => {
    const c = new Canvas(64);

    expect(() => c.drawRect(0, 0, Number.NaN, 10, 'red')).toThrow(RangeError);
    expect(paintedCount(c)).toBe(0);
  });

  it('names drawRect — not a delegate — in the error message', () => {
    expect(() => new Canvas(16).drawRect(0, 0, Number.NaN, 10, 'red')).toThrow(
      new RangeError('drawRect coordinates and dimensions must be finite'),
    );
  });

  it('names drawTriangle — not drawLine — in the error message (issue repro)', () => {
    expect(() => new Canvas(8).drawTriangle(Number.NaN, 0, 1, 1, 2, 2, 'white')).toThrow(
      new RangeError('drawTriangle vertex coordinates must be finite'),
    );
  });

  it('rejects a non-finite last vertex before drawing any edge', () => {
    const c = new Canvas(16);
    expect(() => c.drawTriangle(0, 0, 8, 2, Number.NaN, 8, 'red')).toThrow(
      new RangeError('drawTriangle vertex coordinates must be finite'),
    );
    expect(paintedCount(c)).toBe(0);
  });

  it('names blit in the offset error message', () => {
    expect(() => new Canvas(16).blit(new Canvas(4), Number.NaN, 0)).toThrow(
      new RangeError('blit offsets must be finite'),
    );
  });

  it.each([
    ['drawCircle', (c: Canvas, v: number) => c.drawCircle(v, 8, 4, 'red')],
    ['fillCircle', (c: Canvas, v: number) => c.fillCircle(v, 8, 4, 'red')],
  ])('names the center alongside the radius in the %s message', (method, call) => {
    expect(() => call(new Canvas(16), Number.NaN)).toThrow(
      new RangeError(`${method} center and radius must be finite`),
    );
  });

  it('names the center alongside the radius in the gradientRadial message', () => {
    expect(() => new Canvas(16).gradientRadial(Number.NaN, 8, 4, 'white', 'black')).toThrow(
      new RangeError('gradientRadial center and radius must be finite'),
    );
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects a %s fillCircle radius, matching drawCircle', (_name, radius) => {
    const filled = new Canvas(64);
    const stroked = new Canvas(64);

    expect(() => filled.fillCircle(32, 32, radius, 'red')).toThrow(RangeError);
    expect(() => stroked.drawCircle(32, 32, radius, 'red')).toThrow(RangeError);
    expect(paintedCount(filled)).toBe(0);
  });

  it.each(GUARDED)('validates %s before resolving the color', (_label, call) => {
    expect(() => call(new Canvas(16), Number.NaN, 'not-a-color')).toThrow(RangeError);
  });

  it('still draws for finite geometry', () => {
    const c = new Canvas(16);
    c.fillRect(0, 0, 2, 2, 'red');
    c.drawRect(4, 4, 4, 4, 'red');
    c.fillCircle(12, 12, 1, 'red');
    c.drawLineH(0, 15, 3, 'red');
    c.drawLineV(15, 0, 3, 'red');
    c.fillTriangle(0, 8, 4, 8, 2, 11, 'red');

    expect(paintedCount(c)).toBeGreaterThan(0);
  });
});

describe('blendPixel', () => {
  it('blends foreground onto background', () => {
    const c = new Canvas();
    c.setPixel(5, 5, [100, 100, 100]);
    c.blendPixel(5, 5, [200, 200, 200], 0.5);
    const [r, g, b] = c.getPixel(5, 5);
    expect(r).toBe(150);
    expect(g).toBe(150);
    expect(b).toBe(150);
  });

  it('does nothing at alpha=0', () => {
    const c = new Canvas();
    c.setPixel(5, 5, [100, 100, 100]);
    c.blendPixel(5, 5, [200, 200, 200], 0);
    expect(c.getPixel(5, 5)).toEqual([100, 100, 100]);
  });

  it('fully replaces at alpha=1', () => {
    const c = new Canvas();
    c.setPixel(5, 5, [100, 100, 100]);
    c.blendPixel(5, 5, [200, 200, 200], 1);
    expect(c.getPixel(5, 5)).toEqual([200, 200, 200]);
  });

  it.each<[string, number, readonly number[]]>([
    ['0.5', 0.5, [178, 75, 100, 255]],
    ['0.25', 0.25, [139, 113, 150, 255]],
    ['1', 1, [255, 0, 0, 255]],
    ['1.5', 1.5, [255, 0, 0, 255]],
    ['Infinity', Number.POSITIVE_INFINITY, [255, 0, 0, 255]],
    ['0', 0, [100, 150, 200, 255]],
    ['-0.5', -0.5, [100, 150, 200, 255]],
    ['-Infinity', Number.NEGATIVE_INFINITY, [100, 150, 200, 255]],
  ])('composites alpha %s onto an opaque pixel as before', (_name, alpha, expected) => {
    const c = new Canvas(4);
    c.setPixel(1, 1, [100, 150, 200]);
    expect(c.blendPixel(1, 1, [255, 0, 0], alpha)).toBe(c);
    expect(c.getPixelRgba(1, 1)).toEqual(expected);
  });

  it.each<[number, readonly number[]]>([
    [0.25, [255, 0, 0, 64]],
    [0.5, [255, 0, 0, 128]],
  ])('composites alpha %s onto a transparent pixel as before', (alpha, expected) => {
    const c = new Canvas(4);
    c.blendPixel(2, 2, [255, 0, 0], alpha);
    expect(c.getPixelRgba(2, 2)).toEqual(expected);
  });

  it('ignores an out-of-bounds pixel at a finite alpha', () => {
    const c = new Canvas(4);
    expect(c.blendPixel(-1, 2, [255, 0, 0], 0.5)).toBe(c);
    expect(c.blendPixel(4, 2, [255, 0, 0], 0.5)).toBe(c);
    expect(paintedCount(c)).toBe(0);
  });
});

describe('NaN alpha', () => {
  it('blendPixel throws instead of erasing the destination pixel (issue repro)', () => {
    const c = new Canvas(4);
    c.setPixel(1, 1, [100, 150, 200]);
    expect(() => c.blendPixel(1, 1, [255, 0, 0], Number.NaN)).toThrow(
      new RangeError('blendPixel alpha must not be NaN'),
    );
    expect(c.getPixelRgba(1, 1)).toEqual([100, 150, 200, 255]);
  });

  it('setPixel throws instead of storing an invisible pixel', () => {
    const c = new Canvas(4);
    c.setPixel(1, 1, [100, 150, 200]);
    expect(() => c.setPixel(1, 1, [255, 0, 0], Number.NaN)).toThrow(
      new RangeError('setPixel alpha must not be NaN'),
    );
    expect(c.getPixelRgba(1, 1)).toEqual([100, 150, 200, 255]);
  });

  it.each([
    ['setPixel', (c: Canvas) => c.setPixel(1, 1, [255, 0, 0], Number.NaN)],
    ['blendPixel', (c: Canvas) => c.blendPixel(1, 1, [255, 0, 0], Number.NaN)],
  ])('%s leaves a transparent pixel transparent', (method, call) => {
    const c = new Canvas(4);
    expect(() => call(c)).toThrow(new RangeError(`${method} alpha must not be NaN`));
    expect(paintedCount(c)).toBe(0);
  });

  it.each([
    ['setPixel', (c: Canvas) => c.setPixel(-1, 9, [255, 0, 0], Number.NaN)],
    ['blendPixel', (c: Canvas) => c.blendPixel(-1, 9, [255, 0, 0], Number.NaN)],
  ])('%s rejects a NaN alpha for an out-of-bounds pixel too', (method, call) => {
    expect(() => call(new Canvas(4))).toThrow(new RangeError(`${method} alpha must not be NaN`));
  });

  it.each([
    ['setPixel', (c: Canvas) => c.setPixel(1, 1, 'not-a-color', Number.NaN)],
    ['blendPixel', (c: Canvas) => c.blendPixel(1, 1, 'not-a-color', Number.NaN)],
  ])('%s checks alpha before resolving the color', (method, call) => {
    expect(() => call(new Canvas(4))).toThrow(new RangeError(`${method} alpha must not be NaN`));
  });
});

describe('setPixel alpha', () => {
  it.each<[string, number, number]>([
    ['255', 255, 255],
    ['17', 17, 17],
    ['17.4', 17.4, 17],
    ['17.5', 17.5, 18],
    ['0', 0, 0],
    ['-3', -3, 0],
    ['300', 300, 255],
    ['Infinity', Number.POSITIVE_INFINITY, 255],
    ['-Infinity', Number.NEGATIVE_INFINITY, 0],
  ])('stores alpha %s as %s', (_name, alpha, stored) => {
    const c = new Canvas(4);
    expect(c.setPixel(1, 1, [10, 20, 30], alpha)).toBe(c);
    expect(c.getPixelRgba(1, 1)).toEqual([10, 20, 30, stored]);
  });
});

describe('blit', () => {
  it('composites one canvas onto another', () => {
    const src = new Canvas();
    src.setPixel(0, 0, [255, 0, 0]);
    src.setPixel(1, 0, [0, 255, 0]);

    const dst = new Canvas();
    dst.blit(src, 10, 10);
    expect(dst.getPixel(10, 10)).toEqual([255, 0, 0]);
    expect(dst.getPixel(11, 10)).toEqual([0, 255, 0]);
  });

  it('skips undrawn (transparent) source pixels', () => {
    const src = new Canvas();
    src.setPixel(0, 0, [255, 0, 0]);
    // (1,0) was never drawn — alpha 0

    const dst = new Canvas();
    dst.clear([128, 128, 128]);
    dst.blit(src, 10, 10);
    expect(dst.getPixel(10, 10)).toEqual([255, 0, 0]);
    expect(dst.getPixel(11, 10)).toEqual([128, 128, 128]); // not overwritten
  });

  it('composites explicitly drawn black (no color key)', () => {
    const src = new Canvas();
    src.setPixel(0, 0, [0, 0, 0]); // true black, drawn opaque

    const dst = new Canvas();
    dst.clear([128, 128, 128]);
    dst.blit(src, 10, 10);
    expect(dst.getPixel(10, 10)).toEqual([0, 0, 0]); // black lands
  });

  it('blends semi-transparent source pixels (source-over)', () => {
    const src = new Canvas();
    src.setPixel(0, 0, [255, 0, 0], 128);

    const dst = new Canvas();
    dst.clear([0, 0, 255]);
    dst.blit(src, 10, 10);
    const [r, , b] = dst.getPixel(10, 10);
    expect(r).toBeGreaterThan(100); // red came through
    expect(b).toBeGreaterThan(100); // blue shows underneath
    expect(dst.getPixelRgba(10, 10)[3]).toBe(255); // opaque destination stays opaque
  });

  it('honors the deprecated transparentColor key for drawn pixels', () => {
    const src = new Canvas();
    src.setPixel(0, 0, [255, 0, 0]);
    src.setPixel(1, 0, [0, 0, 0]); // drawn black, keyed out below

    const dst = new Canvas();
    dst.clear([128, 128, 128]);
    dst.blit(src, 10, 10, { transparentColor: [0, 0, 0] });
    expect(dst.getPixel(10, 10)).toEqual([255, 0, 0]);
    expect(dst.getPixel(11, 10)).toEqual([128, 128, 128]); // keyed black skipped
  });

  it('treats transparentColor: null as plain source-over', () => {
    const src = new Canvas();
    src.setPixel(0, 0, [255, 0, 0]);
    // (1,0) undrawn — alpha 0, skipped regardless of the key

    const dst = new Canvas();
    dst.clear([128, 128, 128]);
    dst.blit(src, 10, 10, { transparentColor: null });
    expect(dst.getPixel(10, 10)).toEqual([255, 0, 0]);
    expect(dst.getPixel(11, 10)).toEqual([128, 128, 128]);
  });

  /** `[dx, dy, digest, digest with transparentColor [50, 0, 17]]` — the bytes of 0.9.0. */
  it.each<[number, number, string, string]>([
    [0, 0, '6a13dc297fca2cf3', 'ee9932f482477a87'],
    [3, 2, '4bc917659545be03', '56955bb48c5e89e2'],
    [-2, -1, '9004e528dca0b0d8', '9004e528dca0b0d8'],
    [13, 10, '3d3ffb9c0f2d9be2', '13f6d3cc522e0958'],
    [15, 11, '6f2e0692314e925e', '6f2e0692314e925e'],
    [-4, 0, 'ddd85f91a77e4f3f', 'ddd85f91a77e4f3f'],
    [16, 0, '6f2e0692314e925e', '6f2e0692314e925e'],
    [0, -4, '6f2e0692314e925e', '6f2e0692314e925e'],
    [-100, 5, '6f2e0692314e925e', '6f2e0692314e925e'],
  ])('composites at integer offset (%i, %i) byte for byte as before', (dx, dy, plain, keyed) => {
    const dst = Canvas.fromRgba(noiseRgba(16, 12), 16, 12);
    expect(dst.blit(blitSource(), dx, dy)).toBe(dst);
    expect(digest(dst)).toBe(plain);

    const keyedDst = Canvas.fromRgba(noiseRgba(16, 12), 16, 12);
    keyedDst.blit(blitSource(), dx, dy, { transparentColor: [50, 0, 17] });
    expect(digest(keyedDst)).toBe(keyed);
  });

  it('floors a fractional offset, drawing 2.5 like 2 (issue repro)', () => {
    const src = new Canvas(2, 1);
    src.setPixel(0, 0, [255, 0, 0]);
    src.setPixel(1, 0, [0, 255, 0]);
    const dst = new Canvas(8, 1);

    expect(dst.blit(src, 2.5, 0)).toBe(dst);
    expect([2, 3, 4].map((x) => dst.getPixelRgba(x, 0))).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 0, 0],
    ]);
  });

  it.each<[number, number]>([
    [2.5, 0],
    [0, 1.75],
    [-0.25, 0],
    [0, -0.5],
    [3.99, -1.01],
    [-2.5, 9.5],
    [12.2, 10.9],
    [-4.01, 0],
    [15.999, 11.999],
  ])('composites at (%s, %s) exactly as at the floored offset', (dx, dy) => {
    const fractional = Canvas.fromRgba(noiseRgba(16, 12), 16, 12);
    const floored = Canvas.fromRgba(noiseRgba(16, 12), 16, 12);

    fractional.blit(blitSource(), dx, dy);
    floored.blit(blitSource(), Math.floor(dx), Math.floor(dy));

    expect(Buffer.compare(fractional.buffer, floored.buffer)).toBe(0);
  });

  it('floors a fractional offset with the deprecated transparentColor key too', () => {
    const fractional = Canvas.fromRgba(noiseRgba(16, 12), 16, 12);
    const floored = Canvas.fromRgba(noiseRgba(16, 12), 16, 12);

    fractional.blit(blitSource(), 3.7, 2.2, { transparentColor: [50, 0, 17] });
    floored.blit(blitSource(), 3, 2, { transparentColor: [50, 0, 17] });

    expect(Buffer.compare(fractional.buffer, floored.buffer)).toBe(0);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects a %s offset on either axis without mutation', (_name, offset) => {
    const dst = Canvas.fromRgba(noiseRgba(16, 12), 16, 12);
    const before = new Uint8Array(dst.buffer);

    expect(() => dst.blit(blitSource(), offset, 0)).toThrow(
      new RangeError('blit offsets must be finite'),
    );
    expect(() => dst.blit(blitSource(), 0, offset)).toThrow(
      new RangeError('blit offsets must be finite'),
    );
    expect(dst.buffer).toEqual(before);
  });
});

describe('gradientV', () => {
  it('produces top color at y=0 and bottom color at y=63', () => {
    const c = new Canvas();
    c.gradientV([255, 0, 0], [0, 0, 255]);
    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
    expect(c.getPixel(0, 63)).toEqual([0, 0, 255]);
  });

  it('produces midpoint color near center', () => {
    const c = new Canvas();
    c.gradientV([0, 0, 0], [254, 254, 254]);
    const [r] = c.getPixel(0, 32);
    // Roughly halfway
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(155);
  });
});

describe('gradientH', () => {
  it('produces left color at x=0 and right color at x=63', () => {
    const c = new Canvas();
    c.gradientH([255, 0, 0], [0, 0, 255]);
    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
    expect(c.getPixel(63, 0)).toEqual([0, 0, 255]);
  });
});

describe('gradientRadial', () => {
  it('produces inner color at center and outer further away', () => {
    const c = new Canvas();
    c.gradientRadial(32, 32, 30, [255, 255, 255], [0, 0, 0]);
    const center = c.getPixel(32, 32);
    const edge = c.getPixel(0, 0);
    expect(center[0]).toBeGreaterThan(edge[0]);
  });

  it('resolves the center pixel to the inner color at radius 0', () => {
    const c = new Canvas();
    c.gradientRadial(32, 32, 0, 'white', 'black');
    expect(c.getPixel(32, 32)).toEqual([255, 255, 255]);
  });

  it('gives every non-center pixel the outer color at radius 0', () => {
    const c = new Canvas(16);
    c.gradientRadial(8, 8, 0, 'white', [10, 20, 30]);
    expect(c.getPixel(0, 0)).toEqual([10, 20, 30]);
    expect(c.getPixel(8, 7)).toEqual([10, 20, 30]);
    expect(c.getPixel(15, 15)).toEqual([10, 20, 30]);
    expect(c.getPixel(8, 8)).toEqual([255, 255, 255]);
  });
});

describe('scroll', () => {
  it.each([
    ['positive horizontal', 1.75, 0],
    ['negative horizontal', -0.25, 0],
    ['positive vertical', 0, 1.75],
    ['negative vertical', 0, -0.25],
  ])('floors %s offsets before shifting pixels', (_name, dx, dy) => {
    const fractional = new Canvas(16);
    fractional.setPixel(0, 0, [255, 0, 0]);
    fractional.setPixel(7, 7, [0, 255, 0], 128);
    fractional.setPixel(15, 15, [0, 0, 255]);
    const integer = fractional.clone();

    expect(fractional.scroll(dx, dy)).toBe(fractional);
    integer.scroll(Math.floor(dx), Math.floor(dy));

    expect(fractional.buffer).toEqual(integer.buffer);
  });

  it('shifts pixels by (dx, dy)', () => {
    const c = new Canvas();
    c.setPixel(10, 10, [255, 0, 0]);
    c.scroll(5, 3);
    expect(c.getPixel(10, 10)).toEqual([0, 0, 0]);
    expect(c.getPixel(15, 13)).toEqual([255, 0, 0]);
  });

  it('clears vacated area', () => {
    const c = new Canvas();
    c.clear([128, 128, 128]);
    c.scroll(60, 0);
    // Pixels 0-59 should be transparent (vacated)
    expect(c.getPixelRgba(0, 0)).toEqual([0, 0, 0, 0]);
    expect(c.getPixelRgba(59, 0)).toEqual([0, 0, 0, 0]);
    // Pixels 60-63 should have original content
    expect(c.getPixelRgba(63, 0)).toEqual([128, 128, 128, 255]);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects a %s offset instead of erasing the canvas', (_name, offset) => {
    const horizontal = new Canvas(64).fillRect(0, 0, 64, 64, 'red');
    const vertical = new Canvas(64).fillRect(0, 0, 64, 64, 'red');

    expect(() => horizontal.scroll(offset, 0)).toThrow(RangeError);
    expect(() => vertical.scroll(0, offset)).toThrow(RangeError);
    expect(paintedCount(horizontal)).toBe(64 * 64);
    expect(paintedCount(vertical)).toBe(64 * 64);
  });

  it('names scroll in the offset error message', () => {
    expect(() => new Canvas(16).scroll(Number.NaN, 0)).toThrow(
      new RangeError('scroll offsets must be finite'),
    );
  });
});

/** Deterministic xorshift32 noise — every byte value, alpha included, in scrambled order. */
function noiseRgba(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  let s = 0x2545f491;
  for (let i = 0; i < bytes.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    bytes[i] = s & 0xff;
  }
  return bytes;
}

/** The Node reference encoding `toBase64` has always produced. */
const nodeBase64 = (c: Canvas): string => Buffer.from(c.toRgbBuffer()).toString('base64');

describe('toBase64', () => {
  it.each([
    [16, 16],
    [32, 32],
    [64, 64],
    [1, 1],
    [5, 3],
    [320, 7],
    [7, 320],
  ])('matches the Node base64 of the flattened RGB for a noisy %i×%i canvas', (width, height) => {
    const c = Canvas.fromRgba(noiseRgba(width, height), width, height);
    expect(c.toBase64()).toBe(nodeBase64(c));
  });

  it('exercises all 64 base64 symbols on a noisy panel', () => {
    const encoded = Canvas.fromRgba(noiseRgba(64, 64), 64, 64).toBase64();
    expect(new Set(encoded).size).toBe(64);
  });

  describe('with no Buffer global, as in a browser', () => {
    /** Run `fn` with `globalThis.Buffer` stubbed to undefined. */
    function withoutBuffer<T>(fn: () => T): T {
      vi.stubGlobal('Buffer', undefined);
      try {
        expect(globalThis.Buffer).toBeUndefined();
        return fn();
      } finally {
        vi.unstubAllGlobals();
      }
    }

    it.each([16, 32, 64])('encodes a blank size-%i canvas byte-identically', (size) => {
      const c = new Canvas(size);
      const expected = nodeBase64(c);
      expect(withoutBuffer(() => c.toBase64())).toBe(expected);
    });

    it.each([
      [16, 16],
      [32, 32],
      [64, 64],
      [1, 1],
      [320, 7],
      [4096, 64],
    ])('encodes a noisy %i×%i canvas byte-identically', (width, height) => {
      const c = Canvas.fromRgba(noiseRgba(width, height), width, height);
      const expected = nodeBase64(c);
      expect(withoutBuffer(() => c.toBase64())).toBe(expected);
    });
  });

  it('returns a valid base64 string of correct length', () => {
    const c = new Canvas();
    const b64 = c.toBase64();
    expect(typeof b64).toBe('string');
    const decoded = Buffer.from(b64, 'base64');
    expect(decoded.length).toBe(64 * 64 * 3);
  });

  it('encodes pixel data correctly', () => {
    const c = new Canvas();
    c.setPixel(0, 0, [255, 128, 64]);
    const decoded = Buffer.from(c.toBase64(), 'base64');
    expect(decoded[0]).toBe(255);
    expect(decoded[1]).toBe(128);
    expect(decoded[2]).toBe(64);
  });
});

describe('RGBA semantics', () => {
  it('drawing primitives write opaque pixels', () => {
    const c = new Canvas();
    c.setPixel(0, 0, [255, 0, 0]);
    c.fillRect(1, 0, 1, 1, [0, 255, 0]);
    c.drawLineH(2, 0, 1, [0, 0, 255]);
    expect(c.getPixelRgba(0, 0)[3]).toBe(255);
    expect(c.getPixelRgba(1, 0)[3]).toBe(255);
    expect(c.getPixelRgba(2, 0)[3]).toBe(255);
  });

  it('setPixel stores an explicit alpha', () => {
    const c = new Canvas();
    c.setPixel(0, 0, [255, 0, 0], 128);
    expect(c.getPixelRgba(0, 0)).toEqual([255, 0, 0, 128]);
  });

  it('clear() erases to transparent; clear(color) fills opaque', () => {
    const c = new Canvas();
    c.clear([10, 20, 30]);
    expect(c.getPixelRgba(5, 5)).toEqual([10, 20, 30, 255]);
    c.clear();
    expect(c.getPixelRgba(5, 5)).toEqual([0, 0, 0, 0]);
  });

  it('toRgbBuffer flattens alpha over black', () => {
    const c = new Canvas();
    c.setPixel(0, 0, [200, 100, 50]); // opaque
    c.setPixel(1, 0, [200, 100, 50], 128); // half
    const rgb = c.toRgbBuffer();
    expect(rgb.length).toBe(64 * 64 * 3);
    expect([rgb[0], rgb[1], rgb[2]]).toEqual([200, 100, 50]);
    expect(rgb[3]).toBe(Math.round((200 * 128) / 255));
    expect(rgb[4]).toBe(Math.round((100 * 128) / 255));
  });

  it('blendPixel onto a transparent pixel stores the color at that alpha', () => {
    const c = new Canvas();
    c.blendPixel(0, 0, [255, 0, 0], 0.5);
    const [r, g, b, a] = c.getPixelRgba(0, 0);
    expect([r, g, b]).toEqual([255, 0, 0]);
    expect(a).toBe(128);
  });

  it('clone preserves alpha', () => {
    const c = new Canvas();
    c.setPixel(3, 3, [9, 9, 9], 77);
    expect(c.clone().getPixelRgba(3, 3)).toEqual([9, 9, 9, 77]);
  });
});

describe('DEFAULT_SIZE', () => {
  it('is 64', () => {
    expect(DEFAULT_SIZE).toBe(64);
  });
});

describe('Canvas with different sizes', () => {
  it('clone preserves size', () => {
    const c = new Canvas(32);
    c.setPixel(5, 5, [255, 0, 0]);
    const clone = c.clone();
    expect(clone.width).toBe(32);
    expect(clone.height).toBe(32);
    expect(clone.getPixel(5, 5)).toEqual([255, 0, 0]);
  });

  it('drawing works on 16x16 canvas', () => {
    const c = new Canvas(16);
    c.fillRect(0, 0, 8, 8, [255, 0, 0]);
    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
    expect(c.getPixel(7, 7)).toEqual([255, 0, 0]);
    expect(c.getPixel(8, 8)).toEqual([0, 0, 0]);
  });

  it('bounds checking respects canvas size', () => {
    const c = new Canvas(16);
    c.setPixel(15, 15, [255, 0, 0]);
    c.setPixel(16, 0, [0, 255, 0]); // out of bounds
    expect(c.getPixel(15, 15)).toEqual([255, 0, 0]);
    expect(c.getPixel(16, 0)).toEqual([0, 0, 0]);
  });

  it('blit works between different-sized canvases', () => {
    const src = new Canvas(16);
    src.setPixel(0, 0, [255, 0, 0]);

    const dst = new Canvas(32);
    dst.blit(src, 10, 10);
    expect(dst.getPixel(10, 10)).toEqual([255, 0, 0]);
  });

  it('gradientV works on 32x32 canvas', () => {
    const c = new Canvas(32);
    c.gradientV([255, 0, 0], [0, 0, 255]);
    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
    expect(c.getPixel(0, 31)).toEqual([0, 0, 255]);
  });

  it('toBase64 encodes correct buffer size', () => {
    const c = new Canvas(16);
    const decoded = Buffer.from(c.toBase64(), 'base64');
    expect(decoded.length).toBe(16 * 16 * 3);
  });
});

/**
 * A seeded straight-alpha backdrop: about a quarter of its pixels
 * transparent, a quarter opaque, and the rest partially transparent.
 */
function mixedBackdrop(width: number, height: number): Canvas {
  const bytes = noiseRgba(width, height);
  for (let i = 3; i < bytes.length; i += 4) {
    const pick = (bytes[i - 1]! ^ bytes[i - 3]!) & 3;
    if (pick === 0) bytes[i] = 0;
    else if (pick === 1) bytes[i] = 255;
  }
  return Canvas.fromRgba(bytes, width, height);
}

/** Every option any primitive or `blit` takes, so one scene signature fits them all. */
type AnyOptions = StrokeOptions & BlitOptions;

const FILL_DEFAULTS: AnyOptions[] = [{}, { alpha: 1 }];
const RECT_DEFAULTS: AnyOptions[] = [{}, { alpha: 1 }, { width: 1 }, { alpha: 1, width: 1 }];
const STROKE_DEFAULTS: AnyOptions[] = [
  {},
  { alpha: 1 },
  { width: 1 },
  { antialias: false },
  { alpha: 1, width: 1, antialias: false },
];
const BLIT_DEFAULTS: AnyOptions[] = [{}, { mode: 'normal' }];

/**
 * One scene per option-bearing method on a 40×24 canvas — fractional,
 * clipped, and degenerate inputs among them — each passing `opts` to every
 * call, plus the option spellings that must reproduce the omitted-options
 * bytes.
 */
const CHARACTERIZED: [
  method: string,
  draw: (c: Canvas, opts?: AnyOptions) => void,
  defaults: AnyOptions[],
][] = [
  [
    'fillRect',
    (c, o) =>
      c
        .fillRect(3, 2, 10, 6, 'red', o)
        .fillRect(-5, -3, 12, 8, [10, 200, 30], o)
        .fillRect(35.7, 20.2, 10, 10, 'cyan', o)
        .fillRect(10.5, 5.5, 0.4, 3, 'white', o)
        .fillRect(20.25, 8.75, 5.5, 2.5, 'orange', o)
        .fillRect(0, 0, 0, 5, 'blue', o)
        .fillRect(5, 5, -3, 4, 'blue', o)
        .fillRect(-1e300, 12, 2e300, 1, [90, 90, 250], o),
    FILL_DEFAULTS,
  ],
  [
    'fillCircle',
    (c, o) =>
      c
        .fillCircle(10, 10, 6, 'green', o)
        .fillCircle(39, 0, 5, 'magenta', o)
        .fillCircle(20.5, 12.25, 4.7, [200, 100, 50], o)
        .fillCircle(5, 5, 0, 'white', o)
        .fillCircle(5, 5, -2, 'red', o)
        .fillCircle(-3, 30, 8, 'yellow', o)
        .fillCircle(30, 5, 2.5, 'blue', o),
    FILL_DEFAULTS,
  ],
  [
    'fillTriangle',
    (c, o) =>
      c
        .fillTriangle(2, 2, 20, 5, 8, 18, 'red', o)
        .fillTriangle(-5, -5, 50, 3, 10, 40, [0, 0, 200], o)
        .fillTriangle(1.5, 20.2, 30.7, 22.9, 15.1, 10.4, 'lime', o)
        .fillTriangle(0, 0, 10, 10, 20, 20, 'white', o)
        .fillTriangle(5, 5, 5, 5, 5, 5, 'white', o)
        .fillTriangle(30, 1, 39.5, 12, 25, 23.9, 'orange', o),
    FILL_DEFAULTS,
  ],
  [
    'drawRect',
    (c, o) =>
      c
        .drawRect(2, 2, 10, 8, 'red', o)
        .drawRect(30, 15, 20, 20, 'white', o)
        .drawRect(5.5, 3.25, 7.9, 6.6, 'cyan', o)
        .drawRect(10, 10, 0, 3, 'blue', o)
        .drawRect(10, 10, -2, 3, 'blue', o)
        .drawRect(1, 1, 1, 1, 'yellow', o)
        .drawRect(-1e300, 5, 2e300, 4, [100, 50, 200], o)
        .drawRect(15, 15, 2, 2, 'green', o)
        .drawRect(-3, 18, 8, 10, 'magenta', o),
    RECT_DEFAULTS,
  ],
  [
    'drawLine',
    (c, o) =>
      c
        .drawLine(0, 0, 39, 23, 'white', o)
        .drawLine(39, 0, 0, 23, 'red', o)
        .drawLine(-10, 5, 50, 8, 'yellow', o)
        .drawLine(3.7, 4.2, 20.9, 15.5, 'cyan', o)
        .drawLine(Number.MAX_VALUE, 0, 0, 0, 'blue', o)
        .drawLine(0, Number.MAX_VALUE, 0, 0, 'green', o)
        .drawLine(Number.MAX_VALUE, Number.MAX_VALUE, 0, 0, 'magenta', o)
        .drawLine(5, 5, 5, 5, 'orange', o)
        .drawLine(20, 3, 22, 20, [1, 2, 3], o)
        .drawLine(39, 23, 30, 23, 'white', o),
    STROKE_DEFAULTS,
  ],
  [
    'drawCircle',
    (c, o) =>
      c
        .drawCircle(20, 12, 8, 'white', o)
        .drawCircle(20, 12, 0, 'red', o)
        .drawCircle(20, 12, -2, 'red', o)
        .drawCircle(7.5, 6.3, 5.2, 'cyan', o)
        .drawCircle(38, 22, 6, 'yellow', o)
        .drawCircle(-2, -2, 5, 'green', o)
        .drawCircle(20.7, 12.2, 10, 'magenta', o)
        .drawCircle(20, 12, 3.5, 'blue', o)
        .drawCircle(30, 6, 1, 'orange', o),
    STROKE_DEFAULTS,
  ],
  [
    'blit',
    (c, o) => {
      const key = { ...o, transparentColor: [50, 0, 17] as RGB };
      c.blit(blitSource(), 0, 0, o)
        .blit(blitSource(), 3, 2, o)
        .blit(blitSource(), -2, -1, o)
        .blit(blitSource(), 37, 21, o)
        .blit(blitSource(), 10, 5, key)
        .blit(blitSource(), -1, 20, key);
    },
    BLIT_DEFAULTS,
  ],
  [
    'blendPixel',
    (c) => {
      const noise = noiseRgba(25, 20);
      for (let i = 0; i < 500; i++) {
        const [x, y, r, g] = noise.subarray(i * 4, i * 4 + 4);
        c.blendPixel(x! % 42, y! % 26, [r!, g!, (r! ^ g!) & 0xff], ((x! * 7 + y!) % 101) / 100);
      }
    },
    [],
  ],
];

describe('characterization of the option-bearing primitives', () => {
  /** `[digest on a mixed-alpha backdrop, digest on a transparent canvas]` — the bytes before options. */
  const GOLDEN: Record<string, [string, string]> = {
    fillRect: ['ccbdfd06f04142b7', 'e914b18e5b98ea63'],
    fillCircle: ['a4848ac2bd32389b', '3bb8ba0c17f882ab'],
    fillTriangle: ['92fa98d6ca499f49', 'a0dec363289d2450'],
    drawRect: ['a65ff8682de71605', '3e6b1105a5a5c84f'],
    drawLine: ['1e86835db9ae072b', '11b5655a16a34d88'],
    drawCircle: ['edec37ad82a7dd13', '12997b4a9861daea'],
    blit: ['6fa3b558754fdff7', 'a50e60c66515ffa2'],
    blendPixel: ['482ba1751761b443', '265e058971435ef1'],
  };

  const paint = (draw: (c: Canvas, opts?: AnyOptions) => void, opts?: AnyOptions) => {
    const mixed = mixedBackdrop(40, 24);
    const clear = new Canvas(40, 24);
    draw(mixed, opts);
    draw(clear, opts);
    return [digest(mixed), digest(clear)];
  };

  it.each(CHARACTERIZED)('%s paints its pinned bytes with options omitted', (method, draw) => {
    expect(paint(draw)).toEqual(GOLDEN[method]);
  });

  it.each(
    CHARACTERIZED.flatMap(([method, draw, defaults]) =>
      defaults.map((opts) => [method, JSON.stringify(opts), draw, opts] as const),
    ),
  )('%s paints the same bytes with options %s', (method, _label, draw, opts) => {
    expect(paint(draw, opts)).toEqual(GOLDEN[method]);
  });
});

describe('rings the fillCircle footprint does not shape', () => {
  /** Rings at integer centers and radii — at 1px, the midpoint circle. */
  const integerRings = (c: Canvas, o?: StrokeOptions) =>
    c
      .drawCircle(20, 12, 8, 'white', o)
      .drawCircle(20, 12, 0, 'red', o)
      .drawCircle(38, 22, 6, 'yellow', o)
      .drawCircle(-2, -2, 5, 'green', o)
      .drawCircle(30, 6, 1, 'orange', o);
  /** Integer, fractional-center, and fractional-radius rings, in one draw order. */
  const allRings = (c: Canvas, o?: StrokeOptions) =>
    c
      .drawCircle(20, 12, 8, 'white', o)
      .drawCircle(20, 12, 0, 'red', o)
      .drawCircle(38, 22, 6, 'yellow', o)
      .drawCircle(-2, -2, 5, 'green', o)
      .drawCircle(20.7, 12.2, 10, 'magenta', o)
      .drawCircle(30, 6, 1, 'orange', o)
      .drawCircle(7.5, 6.3, 5.2, 'cyan', o)
      .drawCircle(20, 12, 3.5, 'blue', o);

  /**
   * `[label, draw, [digest on a mixed-alpha backdrop, digest on a transparent
   * canvas]]`. None of these rings traces the `fillCircle` footprint, so its
   * inside test never moves their bytes.
   */
  const PINNED: [string, (c: Canvas) => unknown, [string, string]][] = [
    [
      'the 1px ring at integer centers and radii',
      (c) => integerRings(c),
      ['b79dfda9aab735fb', '5cad3cdca3b0fb77'],
    ],
    [
      'width 3 at integer centers and radii',
      (c) => integerRings(c, { width: 3 }),
      ['01b9385308c43c93', 'aadb9b78ef186c3d'],
    ],
    [
      'width 2 at alpha 0.5 at integer centers and radii',
      (c) => integerRings(c, { width: 2, alpha: 0.5 }),
      ['ee19eebaa357d457', '6d66577020e0d6d6'],
    ],
    [
      'antialias at integer centers and radii',
      (c) => integerRings(c, { antialias: true }),
      ['66a05cb62fed6ebb', 'a7fcadbb91dbaf13'],
    ],
    [
      'width 2 antialias at integer centers and radii',
      (c) => integerRings(c, { width: 2, antialias: true }),
      ['e1444be4351a950b', '95dc215561f40de3'],
    ],
    ['width 3', (c) => allRings(c, { width: 3 }), ['6d3ee69e151a1373', 'e807bed70ee764ca']],
    [
      'width 2 at alpha 0.5',
      (c) => allRings(c, { width: 2, alpha: 0.5 }),
      ['107d8b780276052b', '4caef1a3f2cdee6e'],
    ],
    [
      'antialias',
      (c) => allRings(c, { antialias: true }),
      ['d8351eff6497ab55', 'b89113476015ef47'],
    ],
    [
      'width 2 antialias',
      (c) => allRings(c, { width: 2, antialias: true }),
      ['13830f3054461e8f', '8914fa3862c2237b'],
    ],
  ];

  it.each(PINNED)('paints its pinned bytes for %s', (_label, draw, expected) => {
    const mixed = mixedBackdrop(40, 24);
    const clear = new Canvas(40, 24);
    draw(mixed);
    draw(clear);
    expect([digest(mixed), digest(clear)]).toEqual(expected);
  });
});

type Rgba = readonly [number, number, number, number];

/**
 * The compositing #46 specifies, on straight alpha as 0–1 floats rounded
 * once: Porter-Duff plus (clamped) for `add`; for the others the W3C
 * Compositing 1 separable blend `B` composited source-over, which for
 * `normal` (B = Cs) is plain source-over.
 */
function referenceBlend(src: Rgba, dst: Rgba, mode: BlendMode): Rgba {
  const as = src[3] / 255;
  const ab = dst[3] / 255;
  const ao = mode === 'add' ? Math.min(1, as + ab) : as + ab * (1 - as);
  const channel = (k: 0 | 1 | 2): number => {
    const cs = src[k] / 255;
    const cb = dst[k] / 255;
    let co: number;
    if (mode === 'add') co = Math.min(1, as * cs + ab * cb);
    else if (mode === 'normal') co = as * cs + ab * cb * (1 - as);
    else {
      const b = mode === 'multiply' ? cb * cs : cb + cs - cb * cs;
      co = as * ((1 - ab) * cs + ab * b) + ab * cb * (1 - as);
    }
    return Math.round((co / ao) * 255);
  };
  return [channel(0), channel(1), channel(2), Math.round(ao * 255)];
}

const MODES: BlendMode[] = ['normal', 'add', 'screen', 'multiply'];

/** A 1×1 canvas holding one RGBA pixel. */
const pixel = (rgba: Rgba): Canvas => Canvas.fromRgba(new Uint8Array(rgba), 1, 1);

describe('blit blend modes', () => {
  it.each<[string, Rgba, Rgba, BlendMode, Rgba]>([
    ['opaque over opaque', [200, 0, 0, 255], [100, 0, 0, 255], 'add', [255, 0, 0, 255]],
    ['opaque over opaque', [200, 0, 0, 255], [100, 0, 0, 255], 'screen', [222, 0, 0, 255]],
    ['opaque over opaque', [200, 0, 0, 255], [100, 0, 0, 255], 'multiply', [78, 0, 0, 255]],
    ['half over opaque', [200, 0, 0, 128], [100, 0, 0, 255], 'add', [200, 0, 0, 255]],
    ['half over opaque', [200, 0, 0, 128], [100, 0, 0, 255], 'screen', [161, 0, 0, 255]],
    ['half over opaque', [200, 0, 0, 128], [100, 0, 0, 255], 'multiply', [89, 0, 0, 255]],
    ['half over half', [200, 0, 0, 128], [0, 0, 200, 128], 'add', [100, 0, 100, 255]],
    ['half over opaque', [200, 0, 0, 128], [100, 0, 0, 255], 'normal', [150, 0, 0, 255]],
  ])('composites %s [%s] onto [%s] in %s mode as %s', (_name, src, dst, mode, expected) => {
    const c = pixel(dst);
    expect(c.blit(pixel(src), 0, 0, { mode })).toBe(c);
    expect(c.getPixelRgba(0, 0)).toEqual(expected);
  });

  it.each(MODES)('matches the specified formula for every pixel of a %s blit', (mode) => {
    const source = mixedBackdrop(20, 14);
    const before = mixedBackdrop(40, 24);
    // A different backdrop underneath than on top
    before.scroll(7, 3);
    const after = before.clone().blit(source, 25, -4, { mode });

    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 40; x++) {
        const dst = before.getPixelRgba(x, y);
        const src = source.getPixelRgba(x - 25, y + 4);
        const overlapped = x >= 25 && y + 4 < 14;
        const expected = overlapped && src[3] !== 0 ? referenceBlend(src, dst, mode) : dst;
        expect(after.getPixelRgba(x, y), `(${x}, ${y})`).toEqual(expected);
      }
    }
  });

  it.each(MODES)(
    'stores the source unchanged over a transparent destination in %s mode',
    (mode) => {
      const source = mixedBackdrop(12, 9);
      const c = new Canvas(12, 9).blit(source, 0, 0, { mode });
      expect(Buffer.compare(c.buffer, new Canvas(12, 9).blit(source).buffer)).toBe(0);
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 12; x++) {
          const src = source.getPixelRgba(x, y);
          expect(c.getPixelRgba(x, y)).toEqual(src[3] === 0 ? [0, 0, 0, 0] : src);
        }
      }
    },
  );

  it.each(MODES)('skips alpha-0 source pixels in %s mode', (mode) => {
    const source = Canvas.fromRgba(new Uint8Array([255, 255, 255, 0, 90, 10, 200, 0]), 2, 1);
    const c = mixedBackdrop(2, 1);
    const before = new Uint8Array(c.buffer);
    c.blit(source, 0, 0, { mode });
    expect(c.buffer).toEqual(before);
  });

  it.each<[BlendMode, RGB]>([
    ['add', [0, 0, 0]],
    ['screen', [0, 0, 0]],
    ['multiply', [255, 255, 255]],
  ])('leaves an opaque destination unchanged under %s with its identity color', (mode, color) => {
    const bytes = noiseRgba(16, 12);
    for (let i = 3; i < bytes.length; i += 4) bytes[i] = 255;
    const c = Canvas.fromRgba(bytes, 16, 12);
    c.blit(new Canvas(16, 12).clear(color), 0, 0, { mode });
    expect(c.buffer).toEqual(bytes);
  });

  it.each(MODES)('skips transparentColor-keyed pixels in %s mode', (mode) => {
    const source = new Canvas(3, 1)
      .setPixel(0, 0, [50, 0, 17])
      .setPixel(1, 0, [50, 0, 17], 90)
      .setPixel(2, 0, [200, 100, 0]);
    const c = new Canvas(3, 1).clear([10, 20, 30]);
    c.blit(source, 0, 0, { mode, transparentColor: [50, 0, 17] });
    expect(c.getPixelRgba(0, 0)).toEqual([10, 20, 30, 255]);
    expect(c.getPixelRgba(1, 0)).toEqual([10, 20, 30, 255]);
    expect(c.getPixelRgba(2, 0)).toEqual(
      referenceBlend([200, 100, 0, 255], [10, 20, 30, 255], mode),
    );
  });

  it('adds light cumulatively, clamping at full', () => {
    const glow = new Canvas(1, 1).setPixel(0, 0, [100, 60, 0], 128);
    const c = pixel([0, 0, 0, 255]);
    c.blit(glow, 0, 0, { mode: 'add' });
    expect(c.getPixelRgba(0, 0)).toEqual([50, 30, 0, 255]);
    c.blit(glow, 0, 0, { mode: 'add' }).blit(glow, 0, 0, { mode: 'add' });
    expect(c.getPixelRgba(0, 0)).toEqual([150, 90, 0, 255]);
    for (let i = 0; i < 5; i++) c.blit(glow, 0, 0, { mode: 'add' });
    expect(c.getPixelRgba(0, 0)).toEqual([255, 240, 0, 255]);
  });

  it.each(['overlay', '', 'Add', 'lighter'])('rejects mode %j before drawing anything', (mode) => {
    const c = mixedBackdrop(16, 12);
    const before = new Uint8Array(c.buffer);
    expect(() => c.blit(blitSource(), 0, 0, { mode: mode as BlendMode })).toThrow(
      new RangeError(`blit mode must be one of normal, add, screen, multiply; got ${mode}`),
    );
    expect(c.buffer).toEqual(before);
  });
});

/**
 * Each option-bearing primitive called opaque and at `{ alpha }` — the
 * geometry covers the pixels the 1px paths reach more than once: rect
 * corners, a 1×1 rect, circle axis and 45° points, a radius-0 center.
 */
const ALPHA_CASES: [label: string, draw: (c: Canvas, opts?: StrokeOptions) => unknown][] = [
  ['fillRect', (c, o) => c.fillRect(3.5, 2, 20, 9, 'white', o)],
  ['fillCircle', (c, o) => c.fillCircle(20, 12, 8.4, 'white', o)],
  ['fillCircle r=8', (c, o) => c.fillCircle(20, 12, 8, 'white', o)],
  ['fillTriangle', (c, o) => c.fillTriangle(1, 1, 38, 6.5, 12, 22, 'white', o)],
  ['drawRect', (c, o) => c.drawRect(10, 10, 10, 6, 'white', o)],
  ['drawRect 1×1', (c, o) => c.drawRect(4, 4, 1, 1, 'white', o)],
  ['drawRect 1-wide', (c, o) => c.drawRect(30, 2, 1, 9, 'white', o)],
  ['drawRect width 3', (c, o) => c.drawRect(2, 2, 30, 18, 'white', { ...o, width: 3 })],
  ['drawLine', (c, o) => c.drawLine(0, 0, 39, 17, 'white', o)],
  ['drawLine clipped', (c, o) => c.drawLine(-20, 30, 60, -9, 'white', o)],
  ['drawLine width 4', (c, o) => c.drawLine(2, 20, 35, 3, 'white', { ...o, width: 4 })],
  [
    'drawLine antialias',
    (c, o) => c.drawLine(1.5, 2.25, 36.5, 20.75, 'white', { ...o, antialias: true }),
  ],
  ['drawCircle r=10', (c, o) => c.drawCircle(20, 12, 10, 'white', o)],
  ['drawCircle r=5', (c, o) => c.drawCircle(8, 8, 5, 'white', o)],
  ['drawCircle r=0', (c, o) => c.drawCircle(30, 5, 0, 'white', o)],
  ['drawCircle r=7.3', (c, o) => c.drawCircle(20, 12, 7.3, 'white', o)],
  ['drawCircle width 3', (c, o) => c.drawCircle(20, 12, 9, 'white', { ...o, width: 3 })],
  [
    'drawCircle antialias',
    (c, o) => c.drawCircle(20.5, 11.75, 8.2, 'white', { ...o, width: 2, antialias: true }),
  ],
];

describe('the alpha option', () => {
  it.each(ALPHA_CASES)('%s at alpha 0 leaves the buffer untouched', (_label, draw) => {
    const c = mixedBackdrop(40, 24);
    const before = new Uint8Array(c.buffer);
    draw(c, { alpha: 0 });
    expect(c.buffer).toEqual(before);
  });

  it.each(ALPHA_CASES)(
    '%s at alpha 0.5 composites exactly the pixels the opaque call lights, once each',
    (_label, draw) => {
      const opaque = new Canvas(40, 24);
      draw(opaque);
      const translucent = new Canvas(40, 24);
      draw(translucent, { alpha: 0.5 });

      expect(paintedCount(opaque)).toBeGreaterThan(0);
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 40; x++) {
          const a = opaque.getPixelRgba(x, y)[3];
          // One composite of a pixel at coverage a/255 halves its alpha; a second would raise it
          const expected = a === 0 ? 0 : Math.round((a / 255) * 0.5 * 255);
          expect(
            Math.abs(translucent.getPixelRgba(x, y)[3] - expected),
            `(${x}, ${y})`,
          ).toBeLessThanOrEqual(1);
        }
      }
    },
  );

  it.each(ALPHA_CASES)(
    '%s at alpha 0.5 over opaque black lights each pixel of the opaque call to half',
    (_label, draw) => {
      const opaque = new Canvas(40, 24);
      draw(opaque);
      const translucent = new Canvas(40, 24).clear('black');
      draw(translucent, { alpha: 0.5 });
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 40; x++) {
          const a = opaque.getPixelRgba(x, y)[3];
          const level = Math.round((a / 255) * 0.5 * 255);
          const [r, , , stored] = translucent.getPixelRgba(x, y);
          expect(stored).toBe(255);
          expect(Math.abs(r - level), `(${x}, ${y})`).toBeLessThanOrEqual(1);
        }
      }
    },
  );

  it.each<[string, (c: Canvas, alpha: number) => unknown]>([
    ['fillRect', (c, alpha) => c.fillRect(-2.5, 3, 30, 15, [200, 40, 90], { alpha })],
    ['fillCircle', (c, alpha) => c.fillCircle(21.5, 11, 9.3, [200, 40, 90], { alpha })],
    ['fillTriangle', (c, alpha) => c.fillTriangle(-4, 2, 44, 9, 17, 30, [200, 40, 90], { alpha })],
    ['drawRect', (c, alpha) => c.drawRect(3, 1, 30, 20, [200, 40, 90], { alpha, width: 4 })],
  ])('%s composites source-over like blendPixel on every destination alpha', (_label, draw) => {
    for (const alpha of [0.3, 0.5, 0.97]) {
      const opaque = new Canvas(40, 24);
      draw(opaque, 1);
      const actual = mixedBackdrop(40, 24);
      draw(actual, alpha);
      const expected = mixedBackdrop(40, 24);
      for (const [x, y] of paintedPixels(opaque)) expected.blendPixel(x, y, [200, 40, 90], alpha);
      expect(Buffer.compare(actual.buffer, expected.buffer), `alpha ${alpha}`).toBe(0);
    }
  });

  it('stores alpha 1 as an opaque write on every destination alpha', () => {
    const c = mixedBackdrop(40, 24).fillRect(0, 0, 40, 24, [9, 8, 7], { alpha: 1 });
    expect(Buffer.compare(c.buffer, new Canvas(40, 24).clear([9, 8, 7]).buffer)).toBe(0);
  });

  const OPTIONED: [
    method: string,
    call: (c: Canvas, opts: StrokeOptions, color: string) => unknown,
  ][] = [
    ['fillRect', (c, o, color) => c.fillRect(1, 1, 6, 6, color, o)],
    ['fillCircle', (c, o, color) => c.fillCircle(8, 8, 4, color, o)],
    ['fillTriangle', (c, o, color) => c.fillTriangle(0, 0, 8, 2, 4, 8, color, o)],
    ['drawRect', (c, o, color) => c.drawRect(1, 1, 6, 6, color, o)],
    ['drawLine', (c, o, color) => c.drawLine(0, 0, 15, 9, color, o)],
    ['drawCircle', (c, o, color) => c.drawCircle(8, 8, 5, color, o)],
  ];

  const BAD_ALPHAS: [string, number][] = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['-0.1', -0.1],
    ['1.5', 1.5],
    ['128', 128],
  ];

  it.each(
    OPTIONED.flatMap(([method, call]) =>
      BAD_ALPHAS.map(([name, v]) => [method, name, call, v] as const),
    ),
  )(
    '%s rejects alpha %s before resolving the color, without mutation',
    (method, name, call, alpha) => {
      const c = mixedBackdrop(16, 16);
      const before = new Uint8Array(c.buffer);
      expect(() => call(c, { alpha }, 'not-a-color')).toThrow(
        new RangeError(`${method} alpha must be a number from 0 to 1; got ${name}`),
      );
      expect(() => call(c, { alpha }, 'red')).toThrow(RangeError);
      expect(c.buffer).toEqual(before);
    },
  );

  it.each(OPTIONED)('%s still resolves the color at alpha 0', (_method, call) => {
    expect(() => call(new Canvas(16), { alpha: 0 }, 'not-a-color')).toThrow();
  });
});

describe('stroke width', () => {
  it('draws drawRect(10, 10, 10, 6) at width 2 as the fill minus its inset (issue case)', () => {
    const stroked = new Canvas(32).drawRect(10, 10, 10, 6, 'white', { width: 2 });
    const fill = new Canvas(32).fillRect(10, 10, 10, 6, 'white');
    const inset = new Canvas(32).fillRect(12, 12, 6, 2, 'white');
    const expected = paintedPixels(fill).filter(([x, y]) => inset.getPixelRgba(x, y)[3] === 0);
    expect(paintedPixels(stroked)).toEqual(expected);
    expect(paintedPixels(stroked)).toHaveLength(60 - 12);
  });

  it('fills the rect when the width reaches its middle', () => {
    for (const width of [3, 4, 50]) {
      const stroked = new Canvas(32).drawRect(10, 10, 10, 6, 'white', { width });
      const filled = new Canvas(32).fillRect(10, 10, 10, 6, 'white');
      expect(Buffer.compare(stroked.buffer, filled.buffer), `width ${width}`).toBe(0);
    }
  });

  it.each<[number, number, number, number]>([
    [10, 10, 0, 3],
    [10, 10, -2, 3],
    [10, 10, 3, 0],
    [10, 10, 3, -2],
    [10.25, 10, 0.5, 3],
    [0, 0, 0, 16],
  ])('draws nothing for the empty rect (%s, %s, %s, %s) at width 2 or more', (x, y, w, h) => {
    for (const width of [2, 3, 7]) {
      const c = mixedBackdrop(16, 16);
      const before = new Uint8Array(c.buffer);
      c.drawRect(x, y, w, h, 'white', { width, alpha: 0.5 });
      expect(c.buffer).toEqual(before);
    }
  });

  it('paints, for random rects and widths, the fill pixels within the width of its edge', () => {
    const noise = noiseRgba(16, 16);
    for (let n = 0; n < 150; n++) {
      const [a = 0, b = 0, cc = 0, d = 0] = noise.subarray(n * 4, n * 4 + 4);
      const x = (a % 50) / 2 - 8;
      const y = (b % 40) / 2 - 8;
      const w = (cc % 60) / 2 - 3;
      const h = (d % 44) / 2 - 3;
      const width = 1 + ((a ^ d) % 6);
      const actual = new Canvas(24, 20).drawRect(x, y, w, h, 'white', { width });
      const expected = new Canvas(24, 20);
      const [l, t, r, btm] = [Math.floor(x), Math.floor(y), Math.floor(x + w), Math.floor(y + h)];
      for (let py = t; py < btm; py++) {
        for (let px = l; px < r; px++) {
          const edge = px < l + width || px >= r - width || py < t + width || py >= btm - width;
          if (edge) expected.setPixel(px, py, 'white');
        }
      }
      expect(Buffer.compare(actual.buffer, expected.buffer), `rect ${[x, y, w, h, width]}`).toBe(0);
    }
  });

  it.each<[number, number[]]>([
    [3, [9, 10, 11]],
    [2, [9, 10]],
    [4, [8, 9, 10, 11]],
    [5, [8, 9, 10, 11, 12]],
  ])('drawLine(2, 10, 20, 10) at width %i lights rows %j across columns 2–20', (width, rows) => {
    const c = new Canvas(32).drawLine(2, 10, 20, 10, 'white', { width });
    const expected = rows.flatMap((y) => range(2, 20).map((x) => [x, y]));
    expect(paintedPixels(c)).toEqual(expected.sort((p, q) => p[1]! - q[1]! || p[0]! - q[0]!));
  });

  it('centers a vertical line the same way, the extra pixel of an even width to the left', () => {
    const c = new Canvas(32).drawLine(10, 2, 10, 20, 'white', { width: 2 });
    expect(new Set(paintedPixels(c).map(([x]) => x))).toEqual(new Set([9, 10]));
    expect(paintedCount(c)).toBe(2 * 19);
  });

  it.each<[string, [number, number, number, number], number, number, number[]]>([
    // k = 0.5: half-span 1.5·√1.25 ≈ 1.68 about m = 5
    ['a shallow line', [0, 0, 20, 10], 3, 10, [4, 5, 6]],
    // k = 1: half-span 1.5·√2 ≈ 2.12 about m = 10
    ['a 45° line', [0, 0, 20, 20], 3, 10, [8, 9, 10, 11, 12]],
    // k = 0.75: half-span 1·1.25 = 1.25 about m = 6, the half-open span [4.75, 7.25)
    ['a 3-4-5 line', [0, 0, 16, 12], 2, 8, [5, 6, 7]],
  ])('spans the perpendicular width across %s', (_name, [x0, y0, x1, y1], width, column, rows) => {
    const c = new Canvas(32).drawLine(x0, y0, x1, y1, 'white', { width });
    expect(
      paintedPixels(c)
        .filter(([x]) => x === column)
        .map(([, y]) => y),
    ).toEqual(rows);
  });

  it('steps the major axis of a steep line, spanning columns', () => {
    const c = new Canvas(32).drawLine(4, 0, 14, 20, 'white', { width: 3 });
    // y-major, k = 0.5: at row 10 the centerline is x = 9, half-span ≈ 1.68
    expect(
      paintedPixels(c)
        .filter(([, y]) => y === 10)
        .map(([x]) => x),
    ).toEqual([8, 9, 10]);
    expect(Math.min(...paintedPixels(c).map(([, y]) => y))).toBe(0);
    expect(Math.max(...paintedPixels(c).map(([, y]) => y))).toBe(20);
  });

  it.each<[number, number[]]>([
    [3, [21, 22, 23, 41, 42, 43]],
    [2, [22, 23, 41, 42]],
  ])('drawCircle(32, 32, 10) at width %i lights x %j along row 32', (width, xs) => {
    const c = new Canvas(64).drawCircle(32, 32, 10, 'white', { width });
    expect(
      paintedPixels(c)
        .filter(([, y]) => y === 32)
        .map(([x]) => x),
    ).toEqual(xs);
    const column = paintedPixels(c)
      .filter(([x]) => x === 32)
      .map(([, y]) => y);
    expect(column).toEqual(xs);
  });

  it('draws a width-3 ring as the band r − 1.5 ≤ d < r + 1.5', () => {
    const c = new Canvas(64).drawCircle(32, 32, 12, 'white', { width: 3 });
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const d = Math.hypot(x - 32, y - 32);
        expect(c.getPixelRgba(x, y)[3] !== 0, `(${x}, ${y})`).toBe(d >= 10.5 && d < 13.5);
      }
    }
  });

  it('keeps the exact fractional center of an integer-radius aliased ring, as the 1px ring does', () => {
    const c = new Canvas(64).drawCircle(32.7, 31.2, 9, 'white', { width: 3 });
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const d = Math.hypot(x - 32.7, y - 31.2);
        expect(c.getPixelRgba(x, y)[3] !== 0, `(${x}, ${y})`).toBe(d >= 7.5 && d < 10.5);
      }
    }
  });

  it('keeps the exact center of a fractional-radius aliased ring, as the 1px ring does', () => {
    const c = new Canvas(66).drawCircle(32.5, 32.5, 6.5, 'white', { width: 2 });
    const lit = paintedPixels(c);
    expect(lit.length).toBeGreaterThan(0);
    for (const [x, y] of lit) {
      // Symmetric about 32.5 on both axes, and inside the band about the exact center
      expect(c.getPixelRgba(65 - x, y)[3], `(${x}, ${y})`).toBe(255);
      expect(c.getPixelRgba(x, 65 - y)[3], `(${x}, ${y})`).toBe(255);
      const d = Math.hypot(x - 32.5, y - 32.5);
      expect(d >= 5.5 && d < 7.5, `(${x}, ${y})`).toBe(true);
    }
  });

  describe('contains the 1px stroke at widths 2 and 3', () => {
    const noise = noiseRgba(40, 30);
    const at = (i: number) => noise[i % noise.length]!;
    const lit = (c: Canvas) => new Set(paintedPixels(c).map(([x, y]) => y * c.width + x));

    it.each([
      ['integer', 1],
      ['fractional', 7],
    ])('for 300 random %s lines', (_name, scale) => {
      for (let n = 0; n < 300; n++) {
        const [x0, y0, x1, y1] = [0, 1, 2, 3].map(
          (k) => (at(n * 4 + k) % 60) + (scale === 1 ? 0 : at(n + k) / 256),
        );
        const thin = lit(new Canvas(64).drawLine(x0!, y0!, x1!, y1!, 'white'));
        for (const width of [2, 3]) {
          const wide = lit(new Canvas(64).drawLine(x0!, y0!, x1!, y1!, 'white', { width }));
          expect(
            [...thin].filter((p) => !wide.has(p)),
            `${[x0, y0, x1, y1]} w${width}`,
          ).toEqual([]);
        }
      }
    });

    it.each([
      ['integer', false],
      ['fractional', true],
    ])('for 300 random circles with %s center and radius', (_name, fractional) => {
      for (let n = 0; n < 300; n++) {
        const f = (k: number) => (fractional ? at(n * 3 + k + 1) / 256 : 0);
        const [cx, cy, r] = [
          10 + (at(n * 3) % 44) + f(0),
          10 + (at(n * 3 + 1) % 44) + f(1),
          (at(n * 3 + 2) % 20) + f(2),
        ];
        const thin = lit(new Canvas(64).drawCircle(cx, cy, r, 'white'));
        for (const width of [2, 3]) {
          const wide = lit(new Canvas(64).drawCircle(cx, cy, r, 'white', { width }));
          expect(
            [...thin].filter((p) => !wide.has(p)),
            `${[cx, cy, r]} w${width}`,
          ).toEqual([]);
        }
      }
    });

    it.each<[number, number]>([
      [32.7, 31.2],
      [20.5, 40.5],
      [31, 30.9],
      [10.25, 33],
    ])('for integer radii 0–32 about the fractional center (%s, %s)', (cx, cy) => {
      const escaped = range(0, 32).flatMap((r) => {
        const thin = lit(new Canvas(64).drawCircle(cx, cy, r, 'white'));
        return [2, 3].flatMap((width) => {
          const wide = lit(new Canvas(64).drawCircle(cx, cy, r, 'white', { width }));
          return [...thin].filter((p) => !wide.has(p)).map((p) => `r ${r} w${width}: ${p}`);
        });
      });
      expect(escaped).toEqual([]);
    });
  });

  const STROKED: [method: string, call: (c: Canvas, width: number, color: string) => unknown][] = [
    ['drawRect', (c, width, color) => c.drawRect(1, 1, 6, 6, color, { width })],
    ['drawLine', (c, width, color) => c.drawLine(0, 0, 15, 9, color, { width })],
    ['drawCircle', (c, width, color) => c.drawCircle(8, 8, 5, color, { width })],
  ];

  const BAD_WIDTHS: [string, number][] = [
    ['0', 0],
    ['-1', -1],
    ['1.5', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ];

  it.each(
    STROKED.flatMap(([method, call]) =>
      BAD_WIDTHS.map(([name, v]) => [method, name, call, v] as const),
    ),
  )(
    '%s rejects width %s before resolving the color, without mutation',
    (method, name, call, width) => {
      const c = mixedBackdrop(16, 16);
      const before = new Uint8Array(c.buffer);
      expect(() => call(c, width, 'not-a-color')).toThrow(
        new RangeError(`${method} width must be a positive integer; got ${name}`),
      );
      expect(c.buffer).toEqual(before);
    },
  );
});

describe('anti-aliased lines and circles', () => {
  /** Stored alpha of every painted pixel as `x,y:alpha`, row-major. */
  const alphas = (c: Canvas): string[] =>
    paintedPixels(c).map(([x, y]) => `${x},${y}:${c.getPixelRgba(x, y)[3]}`);

  it('splits a line at y = 10.5 evenly across rows 10 and 11 (issue case)', () => {
    const c = new Canvas(32).drawLine(2, 10.5, 20, 10.5, 'white', { antialias: true });
    expect(paintedPixels(c)).toHaveLength(2 * 19);
    for (const x of range(2, 20)) {
      expect(c.getPixelRgba(x, 10)).toEqual([255, 255, 255, 128]);
      expect(c.getPixelRgba(x, 11)).toEqual([255, 255, 255, 128]);
    }
  });

  it('splits a line at y = 10.25 as 191 and 64 (issue case)', () => {
    const c = new Canvas(32).drawLine(2, 10.25, 20, 10.25, 'white', { antialias: true });
    expect(paintedPixels(c)).toHaveLength(2 * 19);
    expect(c.getPixelRgba(7, 10)[3]).toBe(191);
    expect(c.getPixelRgba(7, 11)[3]).toBe(64);
  });

  it.each<[string, [number, number, number, number]]>([
    ['horizontal', [2, 10, 20, 10]],
    ['vertical', [5, 1, 5, 22]],
    ['reversed horizontal', [30, 3, 0, 3]],
    ['clipped horizontal', [-40, 7, 400, 7]],
  ])('draws a %s line at integer coordinates byte for byte like the 1px line', (_name, ends) => {
    const smooth = mixedBackdrop(32, 24).drawLine(...ends, [30, 200, 90], { antialias: true });
    const plain = mixedBackdrop(32, 24).drawLine(...ends, [30, 200, 90]);
    expect(Buffer.compare(smooth.buffer, plain.buffer)).toBe(0);
  });

  it('composites coverage × alpha: y = 10.5 at alpha 0.5 over opaque black is [64,64,64,255]', () => {
    const c = new Canvas(32).clear('black');
    c.drawLine(2, 10.5, 20, 10.5, 'white', { antialias: true, alpha: 0.5 });
    expect(c.getPixelRgba(9, 10)).toEqual([64, 64, 64, 255]);
    expect(c.getPixelRgba(9, 11)).toEqual([64, 64, 64, 255]);
    expect(c.getPixelRgba(9, 9)).toEqual([0, 0, 0, 255]);
  });

  it('gives a 45° line one full pixel and two 53s per column (issue case)', () => {
    const c = new Canvas(32).drawLine(0, 0, 20, 20, 'white', { antialias: true });
    expect(c.getPixelRgba(10, 10)[3]).toBe(255);
    expect(c.getPixelRgba(10, 9)[3]).toBe(53);
    expect(c.getPixelRgba(10, 11)[3]).toBe(53);
    expect(c.getPixelRgba(10, 8)[3]).toBe(0);
  });

  it.each([1, 2, 3, 4])(
    'conserves coverage across a column at width %i for any sub-pixel offset',
    (width) => {
      for (const offset of [0, 0.1, 0.25, 0.5, 0.75, 0.9]) {
        const c = new Canvas(8, 24).drawLine(0, 11 + offset, 7, 11 + offset, 'white', {
          width,
          antialias: true,
        });
        for (let x = 0; x < 8; x++) {
          let sum = 0;
          for (let y = 0; y < 24; y++) sum += c.getPixelRgba(x, y)[3];
          expect(Math.abs(sum - width * 255), `offset ${offset}, x ${x}`).toBeLessThanOrEqual(2);
        }
      }
    },
  );

  it('shades a sloped line with a total coverage per column of its width across', () => {
    // k = 0.5: the span is 2 · (3/2) · √1.25 ≈ 3.354 rows tall
    const c = new Canvas(40, 30).drawLine(0.3, 4.6, 36.3, 22.6, 'white', {
      width: 3,
      antialias: true,
    });
    for (let x = 1; x < 36; x++) {
      let sum = 0;
      for (let y = 0; y < 30; y++) sum += c.getPixelRgba(x, y)[3];
      expect(Math.abs(sum / 255 - 3 * Math.sqrt(1.25)), `x ${x}`).toBeLessThan(0.02);
    }
  });

  it.each<[string, StrokeOptions, string[]]>([
    ['1px', { antialias: true }, ['42,32:255']],
    ['width 2', { width: 2, antialias: true }, ['41,32:128', '42,32:255', '43,32:128']],
  ])('shades drawCircle(32, 32, 10) at %s along row 32 (issue case)', (_name, opts, expected) => {
    const c = new Canvas(64).drawCircle(32, 32, 10, 'white', opts);
    const right = range(33, 63)
      .filter((x) => c.getPixelRgba(x, 32)[3] !== 0)
      .map((x) => `${x},32:${c.getPixelRgba(x, 32)[3]}`);
    expect(right).toEqual(expected);
  });

  it('shades a ring by clamp(w/2 + ½ − |d − r|, 0, 1) at a fractional center and radius', () => {
    const [cx, cy, r, width] = [20.4, 13.7, 8.35, 2];
    const c = new Canvas(40, 30).drawCircle(cx, cy, r, 'white', { width, antialias: true });
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 40; x++) {
        const coverage = Math.min(
          1,
          Math.max(0, width / 2 + 0.5 - Math.abs(Math.hypot(x - cx, y - cy) - r)),
        );
        expect(c.getPixelRgba(x, y)[3], `(${x}, ${y})`).toBe(Math.round(coverage * 255));
      }
    }
  });

  it('is symmetric about an integer center', () => {
    for (const r of [3, 6.5, 10.25]) {
      const rows = new Canvas(65).drawCircle(32, 32, r, 'white', { antialias: true, width: 2 });
      const view = range(0, 64).map((y) =>
        range(0, 64)
          .map((x) => rows.getPixelRgba(x, y)[3])
          .join(','),
      );
      expect(view.toReversed(), `r ${r}`).toEqual(view);
      const mirrored = range(0, 64).map((y) =>
        range(0, 64)
          .map((x) => rows.getPixelRgba(64 - x, y)[3])
          .join(','),
      );
      expect(mirrored, `r ${r}`).toEqual(view);
    }
  });

  it('draws a radius-0 anti-aliased circle as one opaque pixel', () => {
    const c = new Canvas(16).drawCircle(8, 8, 0, 'white', { antialias: true });
    expect(alphas(c)).toEqual(['8,8:255']);
  });

  it.each<[string, StrokeOptions]>([
    ['1px', {}],
    ['width 3', { width: 3 }],
    ['antialias', { antialias: true }],
    ['width 3 antialias', { width: 3, antialias: true }],
    ['alpha', { alpha: 0.5 }],
  ])('draws nothing for a negative radius at %s', (_name, opts) => {
    for (const r of [-1, -2, -0.5]) {
      const c = mixedBackdrop(16, 16);
      const before = new Uint8Array(c.buffer);
      c.drawCircle(8, 8, r, 'white', opts);
      expect(c.buffer).toEqual(before);
    }
  });

  it.each<[string, StrokeOptions]>([
    ['width 3', { width: 3 }],
    ['antialias', { antialias: true }],
  ])('places a line between endpoints at ±Number.MAX_VALUE exactly, at %s', (_name, opts) => {
    const M = Number.MAX_VALUE;
    const c = new Canvas(64).drawLine(-M, -M, M, M, 'white', opts);
    for (const p of [0, 10, 63]) expect(c.getPixelRgba(p, p)[3], `(${p}, ${p})`).toBe(255);
    expect(c.getPixelRgba(40, 0)[3]).toBe(0);
    expect(c.getPixelRgba(0, 40)[3]).toBe(0);
  });
});

describe('stroke cost', () => {
  /** Run `draw` and return how long it took, in milliseconds. */
  function timed(draw: () => void): number {
    const started = performance.now();
    draw();
    return performance.now() - started;
  }

  it.each<[string, [number, number, number, number], StrokeOptions]>([
    ['horizontal', [Number.MAX_VALUE, 0, 0, 0], { width: 3 }],
    ['vertical', [0, Number.MAX_VALUE, 0, 0], { width: 3 }],
    ['diagonal', [Number.MAX_VALUE, Number.MAX_VALUE, 0, 0], { width: 3 }],
    ['horizontal', [Number.MAX_VALUE, 0, 0, 0], { antialias: true }],
    ['vertical', [0, Number.MAX_VALUE, 0, 0], { antialias: true }],
    ['diagonal', [Number.MAX_VALUE, Number.MAX_VALUE, 0, 0], { antialias: true }],
  ])('clips an intersecting extreme %s segment %j and paints (0, 0)', (_name, ends, opts) => {
    const c = new Canvas(16);
    expect(timed(() => c.drawLine(...ends, [255, 0, 0], opts))).toBeLessThan(250);
    expect(c.getPixelRgba(0, 0)).toEqual([255, 0, 0, 255]);
  });

  it.each<[string, StrokeOptions]>([
    ['width 3', { width: 3 }],
    ['antialias', { antialias: true }],
    ['width 3 antialias', { width: 3, antialias: true }],
  ])('returns promptly for drawCircle(32, 32, 1e15) at %s, painting nothing', (_name, opts) => {
    const c = new Canvas(64);
    expect(timed(() => c.drawCircle(32, 32, 1e15, 'white', opts))).toBeLessThan(250);
    expect(paintedCount(c)).toBe(0);
  });

  it('paints the clipped arc of a 1e15 ring crossing the canvas at width 3', () => {
    const c = new Canvas(64);
    expect(timed(() => c.drawCircle(-1e15 + 32, 20, 1e15, 'white', { width: 3 }))).toBeLessThan(
      250,
    );
    expect(paintedPixels(c)).toEqual(range(0, 63).flatMap((y) => [31, 32, 33].map((x) => [x, y])));
  });

  it('returns promptly for drawLine(0, 0, 63, 63) at width 1e9, filling the canvas', () => {
    const c = new Canvas(64);
    expect(timed(() => c.drawLine(0, 0, 63, 63, 'white', { width: 1e9 }))).toBeLessThan(250);
    expect(paintedCount(c)).toBe(64 * 64);
  });

  it('bounds a wide anti-aliased ring on a 4096×4096 canvas by the canvas', () => {
    const c = new Canvas(4096);
    expect(
      timed(() => c.drawCircle(2048, 2048, 2000, 'white', { width: 6, antialias: true })),
    ).toBeLessThan(1000);
    expect(paintedCount(c)).toBeGreaterThan(0);
  });
});

describe('option types', () => {
  it('exports BlendMode, BlitOptions, FillOptions, and StrokeOptions from both entries', () => {
    expectTypeOf<CoreBlendMode>().toEqualTypeOf<BarrelBlendMode>();
    expectTypeOf<CoreBlendMode>().toEqualTypeOf<'normal' | 'add' | 'screen' | 'multiply'>();
    expectTypeOf<CoreBlitOptions>().toEqualTypeOf<BarrelBlitOptions>();
    expectTypeOf<CoreFillOptions>().toEqualTypeOf<BarrelFillOptions>();
    expectTypeOf<CoreStrokeOptions>().toEqualTypeOf<BarrelStrokeOptions>();
    expectTypeOf<StrokeOptions>().toEqualTypeOf<CoreStrokeOptions>();
  });

  it('draws with the options through the main entry and /core alike', async () => {
    const [core, barrel] = await Promise.all([import('../src/core.js'), import('../src/index.js')]);
    expect(core.Canvas).toBe(barrel.Canvas);
    const draw = (c: Canvas) =>
      c
        .drawLine(0, 1.5, 7, 1.5, 'white', { antialias: true, width: 2 })
        .blit(new Canvas(8, 4).clear([0, 0, 90]), 0, 0, { mode: 'add' });
    const viaCore = draw(new core.Canvas(8, 4));
    const viaBarrel = draw(new barrel.Canvas(8, 4));
    expect(Buffer.compare(viaCore.buffer, viaBarrel.buffer)).toBe(0);
    expect(viaCore.getPixelRgba(3, 1)).toEqual([255, 255, 255, 255]);
    expect(viaCore.getPixelRgba(3, 2)).toEqual([255, 255, 255, 255]);
    expect(viaCore.getPixelRgba(3, 0)).toEqual([0, 0, 90, 255]);
  });

  it('rejects options a method does not take', () => {
    const c = new Canvas(8);
    // @ts-expect-error drawRect takes no antialias
    c.drawRect(0, 0, 4, 4, 'red', { antialias: true });
    // @ts-expect-error fills take no antialias
    c.fillRect(0, 0, 4, 4, 'red', { antialias: true });
    // @ts-expect-error fills take no width
    c.fillRect(0, 0, 4, 4, 'red', { width: 2 });
    // @ts-expect-error fills take no antialias
    c.fillCircle(4, 4, 2, 'red', { antialias: true });
    // @ts-expect-error fills take no width
    c.fillCircle(4, 4, 2, 'red', { width: 2 });
    // @ts-expect-error fills take no antialias
    c.fillTriangle(0, 0, 4, 0, 2, 4, 'red', { antialias: true });
    // @ts-expect-error fills take no width
    c.fillTriangle(0, 0, 4, 0, 2, 4, 'red', { width: 2 });
    // @ts-expect-error blit takes no alpha
    c.blit(new Canvas(2), 0, 0, { alpha: 0.5 });
    expect(paintedCount(c)).toBeGreaterThan(0);
  });
});
