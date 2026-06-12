import { describe, it, expect } from 'vitest';
import {
  parseSvgPath,
  parseSvgPathSubpaths,
  fillPolygon,
  fillSubpaths,
  renderSvgPath,
  type Point,
} from '../src/svg-path.js';
import { Canvas } from '../src/canvas.js';

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

  it('parses absolute arc A (line to endpoint)', () => {
    const points = parseSvgPath('M0 0 A10 10 0 0 1 20 20');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 20 },
    ]);
  });

  it('parses relative arc a', () => {
    const points = parseSvgPath('M10 10 a5 5 0 0 1 10 10');
    expect(points).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
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
