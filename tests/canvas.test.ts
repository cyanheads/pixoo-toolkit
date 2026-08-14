import { describe, it, expect } from 'vitest';
import { Canvas, DEFAULT_SIZE } from '../src/canvas.js';

/** Count pixels carrying a non-zero stored alpha. */
function paintedCount(c: Canvas): number {
  let n = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) if (c.getPixelRgba(x, y)[3] !== 0) n++;
  }
  return n;
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

describe('Canvas.clone', () => {
  it('creates an independent copy', () => {
    const c = new Canvas();
    c.setPixel(5, 5, [255, 0, 0]);
    const clone = c.clone();
    expect(clone.getPixel(5, 5)).toEqual([255, 0, 0]);
    clone.setPixel(5, 5, [0, 255, 0]);
    expect(c.getPixel(5, 5)).toEqual([255, 0, 0]);
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
  it('fills a solid circle', () => {
    const c = new Canvas();
    c.fillCircle(32, 32, 5, [0, 255, 0]);
    expect(c.getPixel(32, 32)).toEqual([0, 255, 0]); // center
    expect(c.getPixel(32, 27)).toEqual([0, 255, 0]); // top edge
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]); // far away
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

  it.each([
    ['horizontal', [Number.MAX_VALUE, 0, 0, 0]],
    ['vertical', [0, Number.MAX_VALUE, 0, 0]],
    ['diagonal', [Number.MAX_VALUE, Number.MAX_VALUE, 0, 0]],
  ] as const)('clips an intersecting extreme finite %s segment', (_name, endpoints) => {
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

  it.each([
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
  ] as const)('preserves the clipped Bresenham raster for %j', (endpoints, expectedPixels) => {
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

describe('toBase64', () => {
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
