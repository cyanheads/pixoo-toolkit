import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, it, expect } from 'vitest';
import { downsampleSprite, renderSprite, type SpriteCell } from '../src/image.js';
import { Canvas } from '../src/canvas.js';
import type { RGB } from '../src/color.js';

type RGBA = readonly [r: number, g: number, b: number, a: number];

async function downsamplePixel(rgba: RGBA) {
  const directory = await mkdtemp(join(tmpdir(), 'pixoo-toolkit-sprite-'));
  const path = join(directory, 'pixel.png');
  try {
    await sharp(Buffer.from(rgba), { raw: { width: 1, height: 1, channels: 4 } })
      .png()
      .toFile(path);
    return await downsampleSprite(path, 1, 1);
  } finally {
    await rm(directory, { recursive: true });
  }
}

function expectByteColor(color: RGB): void {
  for (const channel of color) {
    expect(Number.isInteger(channel)).toBe(true);
    expect(channel).toBeGreaterThanOrEqual(0);
    expect(channel).toBeLessThanOrEqual(255);
  }
}

describe('downsampleSprite', () => {
  it.each([
    [
      [255, 100, 100, 255],
      [255, 100, 100],
    ],
    [
      [100, 255, 100, 255],
      [100, 255, 100],
    ],
    [
      [100, 100, 255, 255],
      [100, 100, 255],
    ],
  ] as const)('keeps saturated %j body channels byte-valid', async (rgba, expected) => {
    const sprite = await downsamplePixel(rgba);

    expect(sprite.bodyColor).toEqual(expected);
    expect(sprite.grid[0]![0]!.color).toEqual(sprite.bodyColor);
    expectByteColor(sprite.bodyColor);
    expectByteColor(sprite.darkColor);
    expectByteColor(sprite.grid[0]![0]!.color!);
  });

  it.each([
    [244, 240],
    [245, 250],
    [249, 250],
    [250, 250],
    [251, 250],
    [252, 250],
    [253, 250],
    [254, 250],
    [255, 255],
  ])('quantizes a %i channel to %i', async (source, expected) => {
    const sprite = await downsamplePixel([source, 100, 100, 255]);

    expect(sprite.bodyColor).toEqual([expected, 100, 100]);
    expect(sprite.grid[0]![0]!.color).toEqual(sprite.bodyColor);
    expectByteColor(sprite.bodyColor);
    expectByteColor(sprite.grid[0]![0]!.color!);
  });

  it.each([0, 128])(
    'excludes pixels with alpha %i at or below the default threshold',
    async (a) => {
      const sprite = await downsamplePixel([100, 80, 60, a]);

      expect(sprite.grid).toEqual([[{ color: null }]]);
      expect(sprite.bodyColor).toEqual([0, 0, 0]);
      expect(sprite.darkColor).toEqual([0, 0, 0]);
    },
  );

  it('includes pixels immediately above the default alpha threshold', async () => {
    const sprite = await downsamplePixel([100, 80, 60, 129]);

    expect(sprite.bodyColor).toEqual([100, 80, 60]);
    expect(sprite.grid).toEqual([[{ color: sprite.bodyColor }]]);
  });

  it('excludes pixels above the near-white threshold in every channel', async () => {
    const sprite = await downsamplePixel([221, 221, 221, 255]);

    expect(sprite.grid).toEqual([[{ color: null }]]);
    expect(sprite.bodyColor).toEqual([0, 0, 0]);
    expect(sprite.darkColor).toEqual([0, 0, 0]);
  });

  it('keeps the near-white threshold itself visible', async () => {
    const sprite = await downsamplePixel([220, 220, 220, 255]);

    expect(sprite.bodyColor).toEqual([220, 220, 220]);
    expect(sprite.grid).toEqual([[{ color: sprite.bodyColor }]]);
  });

  it('classifies channels below the dark threshold as a dark cell', async () => {
    const sprite = await downsamplePixel([49, 40, 30, 255]);

    expect(sprite.darkColor).toEqual([49, 40, 30]);
    expect(sprite.grid).toEqual([[{ color: sprite.darkColor }]]);
    expectByteColor(sprite.darkColor);
  });

  it('classifies a channel at the dark threshold as body color', async () => {
    const sprite = await downsamplePixel([50, 40, 30, 255]);

    expect(sprite.bodyColor).toEqual([50, 40, 30]);
    expect(sprite.grid).toEqual([[{ color: sprite.bodyColor }]]);
  });
});

function makeGrid(rows: number, cols: number, fill: RGB | null = null): SpriteCell[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ color: fill })));
}

describe('renderSprite', () => {
  it('renders a single-cell sprite', () => {
    const c = new Canvas();
    const grid: SpriteCell[][] = [[{ color: [255, 0, 0] }]];
    renderSprite(c, grid, { scale: 4, x: 10, y: 10 });
    // Should fill a 4x4 block at (10,10)
    expect(c.getPixel(10, 10)).toEqual([255, 0, 0]);
    expect(c.getPixel(13, 13)).toEqual([255, 0, 0]);
    expect(c.getPixel(14, 10)).toEqual([0, 0, 0]); // just outside
  });

  it('skips null (transparent) cells', () => {
    const c = new Canvas();
    c.clear([128, 128, 128]);
    const grid: SpriteCell[][] = [[{ color: [255, 0, 0] }, { color: null }]];
    renderSprite(c, grid, { scale: 4, x: 0, y: 0 });
    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
    expect(c.getPixel(4, 0)).toEqual([128, 128, 128]); // null cell, background preserved
  });

  it('renders multi-cell grid at correct positions', () => {
    const c = new Canvas();
    const grid: SpriteCell[][] = [
      [{ color: [255, 0, 0] }, { color: [0, 255, 0] }],
      [{ color: [0, 0, 255] }, { color: [255, 255, 0] }],
    ];
    renderSprite(c, grid, { scale: 2, x: 10, y: 10 });
    expect(c.getPixel(10, 10)).toEqual([255, 0, 0]);
    expect(c.getPixel(12, 10)).toEqual([0, 255, 0]);
    expect(c.getPixel(10, 12)).toEqual([0, 0, 255]);
    expect(c.getPixel(12, 12)).toEqual([255, 255, 0]);
  });

  it('applies body color override', () => {
    const originalBody: RGB = [200, 100, 50];
    const newBody: RGB = [0, 255, 0];
    const grid: SpriteCell[][] = [[{ color: originalBody }]];
    const c = new Canvas();
    renderSprite(c, grid, {
      scale: 4,
      x: 0,
      y: 0,
      bodyColor: newBody,
      originalBodyColor: originalBody,
    });
    expect(c.getPixel(0, 0)).toEqual([0, 255, 0]);
  });

  it('applies dark color override', () => {
    const originalDark: RGB = [20, 12, 12];
    const newDark: RGB = [255, 0, 0];
    const grid: SpriteCell[][] = [[{ color: originalDark }]];
    const c = new Canvas();
    renderSprite(c, grid, {
      scale: 4,
      x: 0,
      y: 0,
      darkColor: newDark,
      originalDarkColor: originalDark,
    });
    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
  });

  it('auto-calculates scale from grid size', () => {
    const c = new Canvas();
    // 8x8 grid → scale should be floor(64/8) = 8
    const grid = makeGrid(8, 8, [255, 0, 0]);
    renderSprite(c, grid);
    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
    // At scale 8, pixel at (7,7) should still be in the first cell
    expect(c.getPixel(7, 7)).toEqual([255, 0, 0]);
  });

  it('centers horizontally when x is not specified', () => {
    const c = new Canvas();
    const grid: SpriteCell[][] = [[{ color: [255, 0, 0] }]];
    // 1 col, auto-scale = floor(64/1) = 64 → entire canvas should be filled
    // But x is auto-centered: floor((64 - 1*64)/2) = 0
    renderSprite(c, grid);
    expect(c.getPixel(0, 0)).toEqual([255, 0, 0]);
  });

  it('handles empty grid gracefully', () => {
    const c = new Canvas();
    renderSprite(c, []);
    // Should not throw, canvas stays black
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]);
  });
});
