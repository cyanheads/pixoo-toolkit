import { describe, it, expect } from 'vitest';
import {
  parseSvgPath,
  parseSvgPathSubpaths,
  fillPolygon,
  fillSubpaths,
  renderSvgPath,
  strokeSubpaths,
  type Point,
} from '../src/svg-path.js';
import { Canvas } from '../src/canvas.js';

/** Every lit pixel as `x,y`, row-major — exact painted geometry, not just a count. */
function litPixels(canvas: Canvas): string[] {
  const out: string[] = [];
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (canvas.getPixel(x, y)[0] === 255) out.push(`${x},${y}`);
    }
  }
  return out;
}

describe('parseSvgPath', () => {
  it('parses absolute MoveTo', () => {
    const points = parseSvgPath('M10 20');
    expect(points).toEqual([{ x: 10, y: 20 }]);
  });

  it('parses relative moveTo', () => {
    const points = parseSvgPath('M10 20 m5 5');
    expect(points).toEqual([
      { x: 10, y: 20 },
      { x: 15, y: 25 },
    ]);
  });

  it('parses absolute LineTo', () => {
    const points = parseSvgPath('M0 0 L10 10 L20 0');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
  });

  it('parses relative lineTo', () => {
    const points = parseSvgPath('M10 10 l5 0 l0 5');
    expect(points).toEqual([
      { x: 10, y: 10 },
      { x: 15, y: 10 },
      { x: 15, y: 15 },
    ]);
  });

  it('parses absolute H and V', () => {
    const points = parseSvgPath('M0 0 H10 V10');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('parses relative h and v', () => {
    const points = parseSvgPath('M10 10 h5 v5');
    expect(points).toEqual([
      { x: 10, y: 10 },
      { x: 15, y: 10 },
      { x: 15, y: 15 },
    ]);
  });

  it('parses Z (closePath)', () => {
    const points = parseSvgPath('M0 0 L10 0 L10 10 Z');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    ]);
  });

  it('parses z (relative closePath)', () => {
    const points = parseSvgPath('M5 5 L15 5 L15 15 z');
    expect(points).toEqual([
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 5 },
    ]);
  });

  it('parses implicit lineTo after M', () => {
    const points = parseSvgPath('M0 0 10 10 20 0');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
  });

  it('parses multiple L coordinates', () => {
    const points = parseSvgPath('M0 0 L10 0 20 10 30 0');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
      { x: 30, y: 0 },
    ]);
  });

  it('samples absolute cubic bezier C along the curve', () => {
    const points = parseSvgPath('M0 0 C1 2 3 4 5 6');
    expect(points).toHaveLength(13); // start + 12 samples
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 5, y: 6 });
  });

  it('samples relative cubic bezier c to the correct endpoint', () => {
    const points = parseSvgPath('M10 10 c1 2 3 4 5 6');
    expect(points[0]).toEqual({ x: 10, y: 10 });
    expect(points.at(-1)).toEqual({ x: 15, y: 16 });
  });

  it('samples quadratic bezier Q through the curve midpoint', () => {
    const points = parseSvgPath('M0 0 Q8 16 16 0');
    expect(points.at(-1)).toEqual({ x: 16, y: 0 });
    // The t=0.5 sample sits at the curve apex (8, 8) — an endpoint-jump would skip it
    const mid = points[Math.floor(points.length / 2)]!;
    expect(mid.x).toBeCloseTo(8, 5);
    expect(mid.y).toBeCloseTo(8, 5);
  });

  it('samples relative quadratic bezier q to the correct endpoint', () => {
    const points = parseSvgPath('M10 10 q5 10 10 0');
    expect(points[0]).toEqual({ x: 10, y: 10 });
    expect(points.at(-1)).toEqual({ x: 20, y: 10 });
  });

  it('samples an absolute arc A and preserves its endpoint', () => {
    const points = parseSvgPath('M0 0 A10 10 0 0 1 20 20');
    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 20, y: 20 });
    expect(points.slice(1, -1).some((point) => point.x !== point.y)).toBe(true);
  });

  it('samples a relative arc a to the correct endpoint', () => {
    const points = parseSvgPath('M10 10 a5 5 0 0 1 10 10');
    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual({ x: 10, y: 10 });
    expect(points.at(-1)).toEqual({ x: 20, y: 20 });
  });

  it('parses repeated arc segments', () => {
    const points = parseSvgPath('M0 0 A5 5 0 0 1 10 0 5 5 0 0 1 20 0');
    expect(points.at(-1)).toEqual({ x: 20, y: 0 });
    expect(points.some((point) => point.x < 10 && point.y < 0)).toBe(true);
    expect(points.some((point) => point.x > 10 && point.y < 0)).toBe(true);
  });

  it('parses compact one-character arc flags', () => {
    const points = parseSvgPath('M0 0 A10 10 0 0110 20');
    expect(points.length).toBeGreaterThan(2);
    expect(points.at(-1)).toEqual({ x: 10, y: 20 });
  });

  it('parses compact arc flags before signed endpoint coordinates', () => {
    expect(parseSvgPath('M0 0 A10 10 0 01-10-20').at(-1)).toEqual({ x: -10, y: -20 });
  });

  it('honors the large-arc flag', () => {
    const small = parseSvgPath('M0 0 A10 10 0 0 1 10 0');
    const large = parseSvgPath('M0 0 A10 10 0 1 1 10 0');
    expect(large.length).toBeGreaterThan(small.length);
    expect(Math.min(...large.map((point) => point.y))).toBeLessThan(
      Math.min(...small.map((point) => point.y)),
    );
  });

  it('honors the sweep flag', () => {
    const increasing = parseSvgPath('M0 0 A10 10 0 0 1 20 0');
    const decreasing = parseSvgPath('M0 0 A10 10 0 0 0 20 0');
    expect(Math.min(...increasing.map((point) => point.y))).toBeCloseTo(-10, 5);
    expect(Math.max(...decreasing.map((point) => point.y))).toBeCloseTo(10, 5);
  });

  it('honors x-axis rotation', () => {
    const unrotated = parseSvgPath('M0 0 A12 6 0 0 1 16 8');
    const rotated = parseSvgPath('M0 0 A12 6 45 0 1 16 8');
    const unrotatedMid = unrotated[Math.floor(unrotated.length / 2)]!;
    const rotatedMid = rotated[Math.floor(rotated.length / 2)]!;
    expect(rotatedMid.x).not.toBeCloseTo(unrotatedMid.x, 2);
    expect(rotatedMid.y).not.toBeCloseTo(unrotatedMid.y, 2);
    expect(rotated.at(-1)).toEqual({ x: 16, y: 8 });
  });

  it('scales radii that are too small to connect the endpoints', () => {
    const points = parseSvgPath('M0 0 A1 1 0 0 1 10 0');
    expect(Math.min(...points.map((point) => point.y))).toBeLessThanOrEqual(-4.75);
    expect(points.at(-1)).toEqual({ x: 10, y: 0 });
  });

  it('scales subnormal radii without collapsing the arc to a chord', () => {
    const points = parseSvgPath('M0 0 A1e-320 1e-320 0 0 1 10 0');
    expect(points.length).toBeGreaterThan(2);
    expect(points.length).toBeLessThanOrEqual(4097);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
      true,
    );
    expect(points.at(-1)).toEqual({ x: 10, y: 0 });
  });

  it('treats negative radii as positive', () => {
    const positive = parseSvgPath('M0 0 A10 5 20 0 1 15 10');
    const negative = parseSvgPath('M0 0 A-10 -5 20 0 1 15 10');
    expect(negative).toEqual(positive);
  });

  it('renders a zero-radius arc as a line', () => {
    expect(parseSvgPath('M2 3 A0 5 30 1 1 8 9')).toEqual([
      { x: 2, y: 3 },
      { x: 8, y: 9 },
    ]);
  });

  it('omits an arc whose endpoint equals the current point', () => {
    expect(parseSvgPath('M2 3 A5 5 0 1 1 2 3')).toEqual([{ x: 2, y: 3 }]);
  });

  it('keeps the current point after omitting an identical-endpoint relative arc', () => {
    expect(parseSvgPath('M2 3 a5 5 0 1 1 0 0 l1 2').at(-1)).toEqual({ x: 3, y: 5 });
  });

  it('produces deterministic source-space arc samples', () => {
    expect(parseSvgPath('M0 0 A12 7 30 1 0 20 4')).toHaveLength(11);
  });

  it('preserves the endpoint for an extremely large finite radius', () => {
    const points = parseSvgPath('M0 0 A1e100 1e100 0 0 1 1 0');
    expect(points).toHaveLength(2);
    expect(points.at(-1)).toEqual({ x: 1, y: 0 });
    expect(points.length).toBeLessThanOrEqual(4097);
  });

  it('does not oversample a huge-radius small arc', () => {
    const points = parseSvgPath('M0 0 A1e16 1e16 0 0 1 1 0');
    expect(points).toHaveLength(2);
    expect(points.at(-1)).toEqual({ x: 1, y: 0 });
  });

  it('samples an extremely large finite-radius large arc without overflow', () => {
    const points = parseSvgPath('M0 0 A1e100 1e100 0 1 1 1 0');
    expect(points.length).toBeGreaterThan(2);
    expect(points.length).toBeLessThanOrEqual(4097);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
      true,
    );
    expect(points.at(-1)).toEqual({ x: 1, y: 0 });
  });

  it.each([String(Number.MAX_VALUE), '1e999'])(
    'keeps extreme radius sampling bounded for %s',
    (radius) => {
      const points = parseSvgPath(`M0 0 A${radius} ${radius} 0 0 1 1 0`);
      expect(points.at(-1)).toEqual({ x: 1, y: 0 });
      expect(points.length).toBeLessThanOrEqual(4097);
    },
  );

  it('resets cubic smooth-control reflection after an arc', () => {
    const chained = parseSvgPath('M0 0 C0 8 8 8 8 0 A4 4 0 0 1 16 0 S20 4 24 0');
    const standalone = parseSvgPath('M16 0 S20 4 24 0');
    expect(chained.slice(-standalone.length)).toEqual(standalone);
  });

  it('falls back to the current point for S with no preceding curve', () => {
    const points = parseSvgPath('M0 0 S3 4 5 6');
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 5, y: 6 });
  });

  it('reflects the control point for smooth cubic S', () => {
    // C ends with control (8,8); S reflects it to (8,-8) around the join (8,0)
    const points = parseSvgPath('M0 0 C0 8 8 8 8 0 S16 -8 16 0');
    expect(points).toHaveLength(25); // start + 12 + 12
    expect(points.at(-1)).toEqual({ x: 16, y: 0 });
    // The S segment dips below the axis because the reflected control pulls it down
    expect(points[13]!.y).toBeLessThan(0);
  });

  it('falls back to the current point for T with no preceding curve', () => {
    const points = parseSvgPath('M0 0 T10 20');
    expect(points.at(-1)).toEqual({ x: 10, y: 20 });
  });

  it('reflects the control point for smooth quadratic T', () => {
    // Q control (4,8) reflects around (8,0) to (12,-8): second hump mirrors below the axis
    const points = parseSvgPath('M0 0 Q4 8 8 0 T16 0');
    expect(points.at(-1)).toEqual({ x: 16, y: 0 });
    const tMid = points[1 + 12 + 5]!; // t=0.5 of the T segment
    expect(tMid.y).toBeLessThan(0);
  });

  it('handles negative coordinates', () => {
    const points = parseSvgPath('M-5-10 L-20-30');
    expect(points).toEqual([
      { x: -5, y: -10 },
      { x: -20, y: -30 },
    ]);
  });

  it('handles comma-separated coordinates', () => {
    const points = parseSvgPath('M0,0 L10,10');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(parseSvgPath('')).toEqual([]);
  });
});

describe('fillPolygon', () => {
  it('does nothing for fewer than 3 points', () => {
    const c = new Canvas();
    fillPolygon(
      c,
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      [255, 0, 0],
    );
    // Should be all black
    expect(c.getPixel(5, 5)).toEqual([0, 0, 0]);
  });

  it('fills a triangle', () => {
    const c = new Canvas();
    const triangle: Point[] = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 20, y: 30 },
      { x: 10, y: 10 }, // close
    ];
    fillPolygon(c, triangle, [255, 0, 0]);
    // Center should be filled
    expect(c.getPixel(20, 15)).toEqual([255, 0, 0]);
    // Outside should be empty
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]);
  });

  it('fills a rectangle-shaped polygon', () => {
    const c = new Canvas();
    const rect: Point[] = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
      { x: 10, y: 10 },
    ];
    fillPolygon(c, rect, [0, 255, 0]);
    expect(c.getPixel(20, 20)).toEqual([0, 255, 0]);
    expect(c.getPixel(5, 5)).toEqual([0, 0, 0]);
  });

  it('clips to canvas bounds', () => {
    const c = new Canvas();
    const bigPoly: Point[] = [
      { x: -10, y: -10 },
      { x: 100, y: -10 },
      { x: 100, y: 100 },
      { x: -10, y: 100 },
      { x: -10, y: -10 },
    ];
    fillPolygon(c, bigPoly, [128, 128, 128]);
    expect(c.getPixel(0, 0)).toEqual([128, 128, 128]);
    expect(c.getPixel(63, 63)).toEqual([128, 128, 128]);
  });
});

describe('renderSvgPath', () => {
  it('fills every pixel of a right triangle and no others', () => {
    const c = new Canvas(16);
    renderSvgPath(c, 'M2 2 L10 2 L10 10 Z', [255, 0, 0], [16, 16], [0, 0, 16, 16]);
    expect(litPixels(c)).toEqual([
      '3,2',
      '4,2',
      '5,2',
      '6,2',
      '7,2',
      '8,2',
      '9,2',
      '10,2',
      '4,3',
      '5,3',
      '6,3',
      '7,3',
      '8,3',
      '9,3',
      '10,3',
      '5,4',
      '6,4',
      '7,4',
      '8,4',
      '9,4',
      '10,4',
      '6,5',
      '7,5',
      '8,5',
      '9,5',
      '10,5',
      '7,6',
      '8,6',
      '9,6',
      '10,6',
      '8,7',
      '9,7',
      '10,7',
      '9,8',
      '10,8',
      '10,9',
    ]);
  });

  it('renders a simple triangle path', () => {
    const c = new Canvas();
    renderSvgPath(c, 'M0 0 L16 0 L8 16 Z', [255, 0, 0], [16, 16], [0, 0, 64, 64]);
    // Some interior pixel should be filled
    expect(c.getPixel(32, 16)).toEqual([255, 0, 0]);
  });

  it('scales from SVG viewbox to target rect', () => {
    const c = new Canvas();
    // A rectangle covering the full 16x16 viewbox, rendered into a 32x32 region at offset (16,16)
    renderSvgPath(c, 'M0 0 L16 0 L16 16 L0 16 Z', [0, 128, 0], [16, 16], [16, 16, 32, 32]);
    expect(c.getPixel(32, 32)).toEqual([0, 128, 0]);
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]);
  });

  it('does nothing for zero-size viewbox', () => {
    const c = new Canvas();
    renderSvgPath(c, 'M0 0 L10 10 L0 10 Z', [255, 0, 0], [0, 0]);
    // Should remain black
    let anySet = false;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (c.getPixel(x, y)[0] !== 0) anySet = true;
      }
    }
    expect(anySet).toBe(false);
  });

  it.each([16, 32, 64] as const)('renders an arc circle at %d pixels', (size) => {
    const c = new Canvas(size);
    renderSvgPath(c, 'M1 0 A1 1 0 0 1 1 2 A1 1 0 0 1 1 0 Z', [255, 0, 0], [2, 2]);

    expect(c.getPixel(size / 2, size / 2)).toEqual([255, 0, 0]);
    expect(c.getPixel(Math.round(size * 0.78), Math.round(size * 0.13))).toEqual([255, 0, 0]);
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]);
  });

  it('increases arc sampling for the target render scale', () => {
    const path = 'M1 0 A1 1 0 0 1 1 2 A1 1 0 0 1 1 0 Z';
    expect(parseSvgPathSubpaths(path)[0]).toHaveLength(8);

    const c = new Canvas();
    renderSvgPath(c, path, [255, 0, 0], [2, 2]);
    expect(c.getPixel(28, 0)).toEqual([255, 0, 0]);
  });

  it('renders an arc-based even-odd hole', () => {
    const c = new Canvas();
    renderSvgPath(
      c,
      [
        'M32 4 A28 28 0 0 1 32 60 A28 28 0 0 1 32 4 Z',
        'M32 20 A12 12 0 0 1 32 44 A12 12 0 0 1 32 20 Z',
      ].join(' '),
      [0, 255, 0],
      [64, 64],
    );

    expect(c.getPixel(32, 32)).toEqual([0, 0, 0]);
    expect(c.getPixel(12, 32)).toEqual([0, 255, 0]);
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]);
  });
});

describe('subpaths and implicit closure', () => {
  const countRed = (c: Canvas): number => {
    let n = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (c.getPixel(x, y)[0] === 255) n++;
      }
    }
    return n;
  };

  it('fills an unclosed path identically to its Z-closed form', () => {
    const open = new Canvas();
    renderSvgPath(open, 'M 8 8 L 56 8 L 32 56', [255, 0, 0], [64, 64]);
    const closed = new Canvas();
    renderSvgPath(closed, 'M 8 8 L 56 8 L 32 56 Z', [255, 0, 0], [64, 64]);
    const openCount = countRed(open);
    expect(openCount).toBeGreaterThan(500);
    expect(openCount).toBe(countRed(closed));
  });

  it('fills multi-subpath paths with even-odd holes (donut)', () => {
    const c = new Canvas();
    renderSvgPath(c, 'M 8 8 H 56 V 56 H 8 Z M 24 24 H 40 V 40 H 24 Z', [0, 255, 0], [64, 64]);
    expect(c.getPixel(32, 32)).toEqual([0, 0, 0]); // hole stays empty
    expect(c.getPixel(16, 32)).toEqual([0, 255, 0]); // ring is filled
    expect(c.getPixel(32, 12)).toEqual([0, 255, 0]); // top band — no phantom connector notch
  });

  it('parseSvgPathSubpaths returns one ring per subpath', () => {
    const rings = parseSvgPathSubpaths('M 8 8 H 56 V 56 H 8 Z M 24 24 H 40 V 40 H 24 Z');
    expect(rings).toHaveLength(2);
  });

  it('fillSubpaths fills rings with holes directly', () => {
    const c = new Canvas();
    fillSubpaths(
      c,
      [
        [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        [
          { x: 25, y: 25 },
          { x: 35, y: 25 },
          { x: 35, y: 35 },
          { x: 25, y: 35 },
        ],
      ],
      [255, 0, 0],
    );
    expect(c.getPixel(30, 30)).toEqual([0, 0, 0]);
    expect(c.getPixel(15, 30)).toEqual([255, 0, 0]);
  });

  it('parses compact decimal coordinates', () => {
    expect(parseSvgPath('M0 0l.5.5 1 1')).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1.5, y: 1.5 },
    ]);
  });
});

describe('strokeSubpaths', () => {
  it('draws every segment of an open ring and no closing segment', () => {
    const c = new Canvas(16);
    strokeSubpaths(
      c,
      [
        [
          { x: 2, y: 2 },
          { x: 5, y: 2 },
          { x: 5, y: 5 },
        ],
      ],
      [255, 0, 0],
    );
    expect(litPixels(c)).toEqual(['2,2', '3,2', '4,2', '5,2', '5,3', '5,4', '5,5']);
  });

  it('draws the closing segment of a Z-terminated ring', () => {
    const c = new Canvas(16);
    strokeSubpaths(c, parseSvgPathSubpaths('M2,2 L5,2 L5,5 Z'), [255, 0, 0]);
    expect(litPixels(c)).toEqual(['2,2', '3,2', '4,2', '5,2', '3,3', '5,3', '4,4', '5,4', '5,5']);
  });

  it('draws a two-point ring that fill renders as nothing', () => {
    const ring: Point[] = [
      { x: 2, y: 2 },
      { x: 5, y: 5 },
    ];

    const stroked = new Canvas(16);
    strokeSubpaths(stroked, [ring], [255, 0, 0]);
    expect(litPixels(stroked)).toEqual(['2,2', '3,3', '4,4', '5,5']);

    const filled = new Canvas(16);
    fillSubpaths(filled, [ring], [255, 0, 0]);
    expect(litPixels(filled)).toEqual([]);
  });

  it('draws nothing for a one-point ring', () => {
    const c = new Canvas(16);
    strokeSubpaths(c, [[{ x: 4, y: 4 }]], [255, 0, 0]);
    expect(litPixels(c)).toEqual([]);
  });

  it('draws nothing for an empty subpath list', () => {
    const c = new Canvas(16);
    strokeSubpaths(c, [], [255, 0, 0]);
    expect(litPixels(c)).toEqual([]);
  });

  it('clips a segment that runs past both canvas edges', () => {
    const c = new Canvas(16);
    strokeSubpaths(
      c,
      [
        [
          { x: -4, y: 4 },
          { x: 20, y: 4 },
        ],
      ],
      [255, 0, 0],
    );
    expect(litPixels(c)).toEqual(Array.from({ length: 16 }, (_, x) => `${x},4`));
  });

  it('throws RangeError for non-finite geometry', () => {
    const c = new Canvas(16);
    expect(() =>
      strokeSubpaths(
        c,
        [
          [
            { x: 2, y: 2 },
            { x: Number.POSITIVE_INFINITY, y: 5 },
          ],
        ],
        [255, 0, 0],
      ),
    ).toThrow(RangeError);
  });
});

describe('renderSvgPath stroke mode', () => {
  const CHEVRON = 'M6,4 L12,10 L6,16';

  it('strokes an outline chevron instead of filling its wedge', () => {
    const stroked = new Canvas(32);
    renderSvgPath(stroked, CHEVRON, [255, 0, 0], [24, 24], [0, 0, 24, 24], { mode: 'stroke' });
    expect(litPixels(stroked)).toEqual([
      '6,4',
      '7,5',
      '8,6',
      '9,7',
      '10,8',
      '11,9',
      '12,10',
      '11,11',
      '10,12',
      '9,13',
      '8,14',
      '7,15',
      '6,16',
    ]);

    const filled = new Canvas(32);
    renderSvgPath(filled, CHEVRON, [255, 0, 0], [24, 24], [0, 0, 24, 24]);
    expect(litPixels(filled)).toHaveLength(42);
    // The wedge interior is fill-only — it is not part of the outline
    expect(filled.getPixel(8, 10)).toEqual([255, 0, 0]);
    expect(stroked.getPixel(8, 10)).toEqual([0, 0, 0]);
  });

  it('renders identical output for the default and an explicit fill mode', () => {
    const implicit = new Canvas(32);
    renderSvgPath(implicit, CHEVRON, [255, 0, 0], [24, 24], [0, 0, 24, 24]);
    const explicit = new Canvas(32);
    renderSvgPath(explicit, CHEVRON, [255, 0, 0], [24, 24], [0, 0, 24, 24], { mode: 'fill' });
    expect(litPixels(explicit)).toEqual(litPixels(implicit));
  });

  it('strokes a closed path back to its start point', () => {
    const c = new Canvas(16);
    renderSvgPath(c, 'M2,2 L5,2 L5,5 Z', [255, 0, 0], [16, 16], [0, 0, 16, 16], { mode: 'stroke' });
    expect(litPixels(c)).toEqual(['2,2', '3,2', '4,2', '5,2', '3,3', '5,3', '4,4', '5,4', '5,5']);
  });
});
