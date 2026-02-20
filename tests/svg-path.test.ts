import { describe, it, expect } from 'vitest';
import { parseSvgPath, fillPolygon, renderSvgPath, type Point } from '../src/svg-path.js';
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

  it('parses absolute cubic bezier C (line to endpoint)', () => {
    const points = parseSvgPath('M0 0 C1 2 3 4 5 6');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 6 },
    ]);
  });

  it('parses relative cubic bezier c', () => {
    const points = parseSvgPath('M10 10 c1 2 3 4 5 6');
    expect(points).toEqual([
      { x: 10, y: 10 },
      { x: 15, y: 16 },
    ]);
  });

  it('parses absolute quadratic bezier Q (line to endpoint)', () => {
    const points = parseSvgPath('M0 0 Q5 10 10 0');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('parses relative quadratic bezier q', () => {
    const points = parseSvgPath('M10 10 q5 10 10 0');
    expect(points).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ]);
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

  it('parses smooth cubic S', () => {
    const points = parseSvgPath('M0 0 S3 4 5 6');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 6 },
    ]);
  });

  it('parses smooth quadratic T', () => {
    const points = parseSvgPath('M0 0 T10 20');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ]);
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
