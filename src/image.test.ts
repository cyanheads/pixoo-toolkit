import { describe, it, expect } from 'vitest';
import { renderSprite, type SpriteCell } from './image.js';
import { Canvas } from './canvas.js';
import type { RGB } from './color.js';

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
