import { describe, it, expect } from 'vitest';
import { Canvas, DISPLAY_SIZE } from '../src/canvas.js';

describe('Canvas construction', () => {
  it('creates a 64x64 canvas', () => {
    const c = new Canvas();
    expect(c.width).toBe(64);
    expect(c.height).toBe(64);
    expect(c.buffer.length).toBe(64 * 64 * 3);
  });

  it('initializes to black by default', () => {
    const c = new Canvas();
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]);
    expect(c.getPixel(63, 63)).toEqual([0, 0, 0]);
  });

  it('accepts a pre-filled buffer', () => {
    const buf = new Uint8Array(64 * 64 * 3);
    buf[0] = 255;
    buf[1] = 128;
    buf[2] = 64;
    const c = new Canvas(buf);
    expect(c.getPixel(0, 0)).toEqual([255, 128, 64]);
  });

  it('copies the source buffer (not aliased)', () => {
    const buf = new Uint8Array(64 * 64 * 3);
    buf[0] = 100;
    const c = new Canvas(buf);
    buf[0] = 200;
    expect(c.buffer[0]).toBe(100);
  });

  it('throws on wrong buffer size', () => {
    expect(() => new Canvas(new Uint8Array(100))).toThrow('12288');
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

  it('defaults to black', () => {
    const c = new Canvas();
    c.setPixel(10, 10, [255, 0, 0]);
    c.clear();
    expect(c.getPixel(10, 10)).toEqual([0, 0, 0]);
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
  it('draws a circle outline', () => {
    const c = new Canvas();
    c.drawCircle(32, 32, 10, [0, 0, 255]);
    // Top of circle should be set
    expect(c.getPixel(32, 22)).toEqual([0, 0, 255]);
    // Center should not be set
    expect(c.getPixel(32, 32)).toEqual([0, 0, 0]);
  });
});

describe('drawLine', () => {
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

  it('handles degenerate (collinear) triangle gracefully', () => {
    const c = new Canvas();
    // Horizontal line — no area to fill
    c.fillTriangle(5, 5, 10, 5, 15, 5, [255, 0, 0]);
    // Should not crash; may or may not fill the line
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

  it('skips black pixels by default (transparent)', () => {
    const src = new Canvas();
    src.setPixel(0, 0, [255, 0, 0]);
    // (1,0) is black by default

    const dst = new Canvas();
    dst.clear([128, 128, 128]);
    dst.blit(src, 10, 10);
    expect(dst.getPixel(10, 10)).toEqual([255, 0, 0]);
    expect(dst.getPixel(11, 10)).toEqual([128, 128, 128]); // not overwritten
  });

  it('copies all pixels when transparentColor is null', () => {
    const src = new Canvas();
    src.setPixel(0, 0, [255, 0, 0]);
    // (1,0) is black

    const dst = new Canvas();
    dst.clear([128, 128, 128]);
    dst.blit(src, 10, 10, { transparentColor: null });
    expect(dst.getPixel(10, 10)).toEqual([255, 0, 0]);
    expect(dst.getPixel(11, 10)).toEqual([0, 0, 0]); // black WAS copied
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
});

describe('scroll', () => {
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
    // Pixels 0-59 should be black (vacated)
    expect(c.getPixel(0, 0)).toEqual([0, 0, 0]);
    expect(c.getPixel(59, 0)).toEqual([0, 0, 0]);
    // Pixels 60-63 should have original content
    expect(c.getPixel(63, 0)).toEqual([128, 128, 128]);
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

describe('DISPLAY_SIZE', () => {
  it('is 64', () => {
    expect(DISPLAY_SIZE).toBe(64);
  });
});
