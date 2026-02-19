import { describe, it, expect } from 'vitest';
import {
  hslToRgb,
  rgbToHsl,
  rgbToHex,
  hexToRgb,
  parseHexString,
  resolveColor,
  lerpColor,
  dimColor,
  NAMED_COLORS,
  Color,
  type RGB,
} from './color.js';

describe('hslToRgb', () => {
  it('converts pure red', () => {
    expect(hslToRgb([0, 1, 0.5])).toEqual([255, 0, 0]);
  });

  it('converts pure green', () => {
    expect(hslToRgb([120, 1, 0.5])).toEqual([0, 255, 0]);
  });

  it('converts pure blue', () => {
    expect(hslToRgb([240, 1, 0.5])).toEqual([0, 0, 255]);
  });

  it('converts white', () => {
    expect(hslToRgb([0, 0, 1])).toEqual([255, 255, 255]);
  });

  it('converts black', () => {
    expect(hslToRgb([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('converts mid-gray', () => {
    expect(hslToRgb([0, 0, 0.5])).toEqual([128, 128, 128]);
  });

  it('converts yellow (h=60)', () => {
    expect(hslToRgb([60, 1, 0.5])).toEqual([255, 255, 0]);
  });

  it('converts cyan (h=180)', () => {
    expect(hslToRgb([180, 1, 0.5])).toEqual([0, 255, 255]);
  });

  it('converts magenta (h=300)', () => {
    expect(hslToRgb([300, 1, 0.5])).toEqual([255, 0, 255]);
  });
});

describe('rgbToHsl', () => {
  it('converts pure red', () => {
    const [h, s, l] = rgbToHsl([255, 0, 0]);
    expect(h).toBeCloseTo(0, 1);
    expect(s).toBeCloseTo(1, 1);
    expect(l).toBeCloseTo(0.5, 1);
  });

  it('converts pure green', () => {
    const [h, s, l] = rgbToHsl([0, 255, 0]);
    expect(h).toBeCloseTo(120, 1);
    expect(s).toBeCloseTo(1, 1);
    expect(l).toBeCloseTo(0.5, 1);
  });

  it('converts white', () => {
    const [h, s, l] = rgbToHsl([255, 255, 255]);
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBe(1);
  });

  it('converts black', () => {
    const [h, s, l] = rgbToHsl([0, 0, 0]);
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBe(0);
  });

  it('round-trips through hslToRgb', () => {
    const colors: RGB[] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [128, 64, 200],
      [10, 200, 90],
    ];
    for (const rgb of colors) {
      const hsl = rgbToHsl(rgb);
      const back = hslToRgb(hsl);
      expect(back[0]).toBeCloseTo(rgb[0], 0);
      expect(back[1]).toBeCloseTo(rgb[1], 0);
      expect(back[2]).toBeCloseTo(rgb[2], 0);
    }
  });
});

describe('rgbToHex / hexToRgb', () => {
  it('packs red', () => {
    expect(rgbToHex([255, 0, 0])).toBe(0xff0000);
  });

  it('packs arbitrary color', () => {
    expect(rgbToHex([0x12, 0x34, 0x56])).toBe(0x123456);
  });

  it('unpacks red', () => {
    expect(hexToRgb(0xff0000)).toEqual([255, 0, 0]);
  });

  it('round-trips', () => {
    const rgb: RGB = [64, 128, 192];
    expect(hexToRgb(rgbToHex(rgb))).toEqual(rgb);
  });
});

describe('parseHexString', () => {
  it('parses 6-digit hex with #', () => {
    expect(parseHexString('#ff8040')).toEqual([255, 128, 64]);
  });

  it('parses 6-digit hex without #', () => {
    expect(parseHexString('ff8040')).toEqual([255, 128, 64]);
  });

  it('parses 3-digit shorthand', () => {
    expect(parseHexString('#f00')).toEqual([255, 0, 0]);
  });

  it('parses 3-digit shorthand without #', () => {
    expect(parseHexString('abc')).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('handles black', () => {
    expect(parseHexString('#000000')).toEqual([0, 0, 0]);
  });

  it('returns null for invalid hex characters', () => {
    expect(parseHexString('#zzzzzz')).toBeNull();
    expect(parseHexString('xyz')).toBeNull();
  });

  it('returns null for wrong-length strings', () => {
    expect(parseHexString('#abcd')).toBeNull();
    expect(parseHexString('a')).toBeNull();
  });
});

describe('resolveColor', () => {
  it('passes through RGB tuples', () => {
    expect(resolveColor([10, 20, 30])).toEqual([10, 20, 30]);
  });

  it('resolves hex numbers', () => {
    expect(resolveColor(0xff0000)).toEqual([255, 0, 0]);
  });

  it('resolves named colors', () => {
    expect(resolveColor('red')).toEqual([255, 0, 0]);
    expect(resolveColor('blue')).toEqual([0, 0, 255]);
  });

  it('resolves named colors case-insensitively', () => {
    expect(resolveColor('RED')).toEqual([255, 0, 0]);
    expect(resolveColor('Blue')).toEqual([0, 0, 255]);
  });

  it('resolves hex strings', () => {
    expect(resolveColor('#ff8040')).toEqual([255, 128, 64]);
  });

  it('resolves claude brand color', () => {
    expect(resolveColor('claude')).toEqual([230, 150, 70]);
  });

  it('returns white for unresolvable strings', () => {
    expect(resolveColor('notacolor')).toEqual([255, 255, 255]);
  });
});

describe('lerpColor', () => {
  it('returns start at t=0', () => {
    expect(lerpColor([0, 0, 0], [255, 255, 255], 0)).toEqual([0, 0, 0]);
  });

  it('returns end at t=1', () => {
    expect(lerpColor([0, 0, 0], [255, 255, 255], 1)).toEqual([255, 255, 255]);
  });

  it('returns midpoint at t=0.5', () => {
    const mid = lerpColor([0, 0, 0], [200, 100, 50], 0.5);
    expect(mid).toEqual([100, 50, 25]);
  });

  it('clamps t below 0', () => {
    expect(lerpColor([100, 100, 100], [200, 200, 200], -1)).toEqual([100, 100, 100]);
  });

  it('clamps t above 1', () => {
    expect(lerpColor([100, 100, 100], [200, 200, 200], 2)).toEqual([200, 200, 200]);
  });
});

describe('dimColor', () => {
  it('returns black at factor 0', () => {
    expect(dimColor([255, 128, 64], 0)).toEqual([0, 0, 0]);
  });

  it('returns unchanged at factor 1', () => {
    expect(dimColor([100, 200, 50], 1)).toEqual([100, 200, 50]);
  });

  it('halves at factor 0.5', () => {
    expect(dimColor([200, 100, 50], 0.5)).toEqual([100, 50, 25]);
  });

  it('clamps to 255 when factor > 1', () => {
    expect(dimColor([200, 200, 200], 2)).toEqual([255, 255, 255]);
  });

  it('clamps to 0 for negative factor', () => {
    expect(dimColor([100, 100, 100], -1)).toEqual([0, 0, 0]);
  });
});

describe('NAMED_COLORS', () => {
  it('has standard web colors', () => {
    expect(NAMED_COLORS['red']).toEqual([255, 0, 0]);
    expect(NAMED_COLORS['green']).toEqual([0, 255, 0]);
    expect(NAMED_COLORS['blue']).toEqual([0, 0, 255]);
    expect(NAMED_COLORS['black']).toEqual([0, 0, 0]);
    expect(NAMED_COLORS['white']).toEqual([255, 255, 255]);
  });

  it('has both gray and grey aliases', () => {
    expect(NAMED_COLORS['gray']).toEqual(NAMED_COLORS['grey']);
    expect(NAMED_COLORS['darkgray']).toEqual(NAMED_COLORS['darkgrey']);
    expect(NAMED_COLORS['lightgray']).toEqual(NAMED_COLORS['lightgrey']);
  });
});

describe('Color constants', () => {
  it('has correct values', () => {
    expect(Color.BLACK).toEqual([0, 0, 0]);
    expect(Color.WHITE).toEqual([255, 255, 255]);
    expect(Color.RED).toEqual([255, 0, 0]);
    expect(Color.GREEN).toEqual([0, 255, 0]);
    expect(Color.BLUE).toEqual([0, 0, 255]);
  });
});
