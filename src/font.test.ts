import { describe, it, expect } from 'vitest';
import {
  FONT_5x7,
  FONT_3x5,
  measureText,
  drawText,
  drawTextCentered,
} from './font.js';
import { Canvas } from './canvas.js';

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
    let count1 = 0, count2 = 0;
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

describe('drawTextCentered', () => {
  it('centers text horizontally', () => {
    const c = new Canvas();
    drawTextCentered(c, 'Hi', 0, [255, 0, 0]);
    const textW = measureText('Hi');
    const expectedStart = Math.floor((64 - textW) / 2);

    // Check that roughly centered
    let minX = 64, maxX = 0;
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
