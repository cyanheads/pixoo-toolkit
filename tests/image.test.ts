import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as gifencNs from 'gifenc';
import sharp from 'sharp';
import { describe, it, expect, vi } from 'vitest';
import {
  downsampleSprite,
  loadAnimation,
  loadImage,
  renderSprite,
  type LoadedAnimation,
  type SpriteCell,
} from '../src/image.js';
import { Canvas } from '../src/canvas.js';
import type { RGB } from '../src/color.js';

// Each fit × kernel case runs dozens of sharp decodes; the 5 s default flakes under CPU contention.
vi.setConfig({ testTimeout: 30_000 });

type RGBA = readonly [r: number, g: number, b: number, a: number];

// gifenc ships CJS only; Node exposes it as a default-only namespace (see src/preview.ts).
const gifencDefault = (gifencNs as typeof gifencNs & { default?: unknown }).default;
const { GIFEncoder, quantize, applyPalette } =
  typeof gifencDefault === 'object' && gifencDefault !== null
    ? (gifencDefault as typeof gifencNs)
    : gifencNs;

async function withTempDir<T>(fn: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'pixoo-toolkit-image-'));
  try {
    return await fn(directory);
  } finally {
    await rm(directory, { recursive: true });
  }
}

/** Encode straight-alpha RGBA bytes as a PNG. */
async function encodePng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
  );
}

/** Write `bytes` to a temp file and hand its path to `fn`. */
async function withFile<T>(
  name: string,
  bytes: Uint8Array | string,
  fn: (path: string) => Promise<T>,
): Promise<T> {
  return withTempDir(async (directory) => {
    const path = join(directory, name);
    await writeFile(path, bytes);
    return fn(path);
  });
}

async function downsamplePixel(rgba: RGBA) {
  return withFile('pixel.png', await encodePng(new Uint8Array(rgba), 1, 1), (path) =>
    downsampleSprite(path, 1, 1),
  );
}

/** RGBA image whose every pixel is distinct: `(x, y)` → `[x·16, y·32, 255 − x·8, 255]`. */
const SOURCE_W = 16;
const SOURCE_H = 8;
const sourceColor = (x: number, y: number): RGBA => [x * 16, y * 32, 255 - x * 8, 255];
const SOURCE_RGBA = new Uint8Array(SOURCE_W * SOURCE_H * 4);
for (let y = 0; y < SOURCE_H; y++) {
  for (let x = 0; x < SOURCE_W; x++) SOURCE_RGBA.set(sourceColor(x, y), (y * SOURCE_W + x) * 4);
}
const sourcePng = () => encodePng(SOURCE_RGBA, SOURCE_W, SOURCE_H);

/** A canvas holding `pixel(x, y)` wherever it returns a color, transparent elsewhere. */
function expectedCanvas(
  width: number,
  height: number,
  pixel: (x: number, y: number) => RGBA | null,
  base?: RGBA,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = pixel(x, y) ?? base;
      if (color) out.set(color, (y * width + x) * 4);
    }
  }
  return out;
}

/** Distinct RGB colors in a canvas's opaque pixels. */
function opaqueColors(canvas: Canvas): Set<string> {
  const colors = new Set<string>();
  for (let i = 0; i < canvas.buffer.length; i += 4) {
    if (canvas.buffer[i + 3] === 255) colors.add(canvas.buffer.subarray(i, i + 3).join(','));
  }
  return colors;
}

const FRAME_COLORS: readonly RGB[] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
  [255, 255, 255],
  [255, 128, 0],
  [128, 0, 255],
  [0, 128, 64],
  [128, 128, 128],
  [64, 32, 16],
];

/**
 * One solid frame per color in `FRAME_COLORS[0…n)`, with a black marker pixel at x = frame index
 * on row 0 — so a decoded frame names its source frame.
 */
function markedFrame(k: number, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) rgba.set([...FRAME_COLORS[k]!, 255], p * 4);
  rgba.set([0, 0, 0, 255], (k % width) * 4);
  return rgba;
}

/** Animated GIF (gifenc) of marked frames with the given per-frame delays in ms. */
function markedGif(delays: readonly number[], width = 8, height = 6): Uint8Array {
  const gif = GIFEncoder();
  delays.forEach((delay, k) => {
    const rgba = markedFrame(k, width, height);
    const palette = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay });
  });
  gif.finish();
  return gif.bytes();
}

describe('loadImage', () => {
  it('contains the image on a new 64×64 canvas with nearest-neighbor and a transparent letterbox', async () => {
    const canvas = await withFile('source.png', await sourcePng(), (path) => loadImage(path));

    // 16×8 contained in 64×64: scale 4, content rows 16–47.
    expect([canvas.width, canvas.height]).toEqual([64, 64]);
    expect(canvas.buffer).toEqual(
      expectedCanvas(64, 64, (x, y) =>
        y >= 16 && y < 48 ? sourceColor(Math.floor(x / 4), Math.floor((y - 16) / 4)) : null,
      ),
    );
  });

  it('creates a canvas of the requested size', async () => {
    const canvas = await withFile('source.png', await sourcePng(), (path) =>
      loadImage(path, { size: 16 }),
    );

    expect([canvas.width, canvas.height]).toEqual([16, 16]);
    expect(canvas.buffer).toEqual(
      expectedCanvas(16, 16, (x, y) => (y >= 4 && y < 12 ? sourceColor(x, y - 4) : null)),
    );
  });

  it('crops to cover the canvas', async () => {
    const canvas = await withFile('source.png', await sourcePng(), (path) =>
      loadImage(path, { fit: 'cover' }),
    );

    // Scale 8 → 128×64, centre-cropped 32 px from the left.
    expect(canvas.buffer).toEqual(
      expectedCanvas(64, 64, (x, y) => sourceColor(Math.floor((x + 32) / 8), Math.floor(y / 8))),
    );
  });

  it('stretches to fill the canvas', async () => {
    const canvas = await withFile('source.png', await sourcePng(), (path) =>
      loadImage(path, { fit: 'fill' }),
    );

    expect(canvas.buffer).toEqual(
      expectedCanvas(64, 64, (x, y) => sourceColor(Math.floor(x / 4), Math.floor(y / 8))),
    );
  });

  it('honors a smoothing kernel', async () => {
    const [nearest, lanczos] = await withFile('source.png', await sourcePng(), (path) =>
      Promise.all([loadImage(path), loadImage(path, { kernel: 'lanczos3' })]),
    );
    const sourceColors = new Set<string>();
    for (let y = 0; y < SOURCE_H; y++) {
      for (let x = 0; x < SOURCE_W; x++) sourceColors.add(sourceColor(x, y).slice(0, 3).join(','));
    }

    expect([...opaqueColors(nearest)].every((c) => sourceColors.has(c))).toBe(true);
    expect([...opaqueColors(lanczos)].some((c) => !sourceColors.has(c))).toBe(true);
    // The letterbox stays transparent under any kernel.
    expect(lanczos.getPixelRgba(0, 0)).toEqual([0, 0, 0, 0]);
    expect(lanczos.getPixelRgba(63, 63)).toEqual([0, 0, 0, 0]);
  });

  it('draws into a region of a supplied canvas and returns that canvas', async () => {
    const target = new Canvas(32).clear([9, 9, 9]);
    const result = await withFile('source.png', await sourcePng(), (path) =>
      loadImage(path, { canvas: target, width: 16, height: 8, x: 5, y: 3 }),
    );

    expect(result).toBe(target);
    expect(target.buffer).toEqual(
      expectedCanvas(32, 32, (x, y) =>
        x >= 5 && x < 21 && y >= 3 && y < 11 ? sourceColor(x - 5, y - 3) : [9, 9, 9, 255],
      ),
    );
  });

  it('clips a region that hangs off the canvas', async () => {
    const target = new Canvas(16);
    await withFile('source.png', await sourcePng(), (path) =>
      loadImage(path, { canvas: target, width: 16, height: 8, x: -4, y: 12 }),
    );

    expect(target.buffer).toEqual(
      expectedCanvas(16, 16, (x, y) => (x < 12 && y >= 12 ? sourceColor(x + 4, y - 12) : null)),
    );
  });

  it.each([
    [320, 7],
    [7, 320],
  ])(
    'draws a region of a %i×%i canvas like the matching region of a 320×320 one',
    async (width, height) => {
      const regions = [
        { width: 16, height: 8, x: 3, y: -2 },
        { width: 20, height: 12, x: -5, y: 1, fit: 'cover', kernel: 'lanczos3' },
      ] as const;
      await withFile('source.png', await sourcePng(), async (path) => {
        for (const region of regions) {
          const small = await loadImage(path, { ...region, canvas: new Canvas(width, height) });
          const big = await loadImage(path, { ...region, canvas: new Canvas(320) });
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              expect(small.getPixelRgba(x, y)).toEqual(big.getPixelRgba(x, y));
            }
          }
        }
      });
    },
  );

  it('contains the image within both dimensions of a strip canvas', async () => {
    const strip = await withFile('source.png', await sourcePng(), (path) =>
      loadImage(path, { canvas: new Canvas(320, 7) }),
    );

    // 16×8 contained in 320×7: 14×7, centred horizontally.
    expect(paintedBounds(strip)).toEqual([153, 0, 166, 6]);
  });

  it('composites source alpha over the canvas', async () => {
    const png = await encodePng(new Uint8Array([255, 0, 0, 128, 0, 255, 0, 0]), 2, 1);
    const target = new Canvas(16).clear([0, 0, 255]);
    await withFile('alpha.png', png, (path) =>
      loadImage(path, { canvas: target, width: 2, height: 1 }),
    );

    expect(target.getPixelRgba(0, 0)).toEqual([128, 0, 127, 255]);
    // A fully transparent source pixel leaves the destination untouched.
    expect(target.getPixelRgba(1, 0)).toEqual([0, 0, 255, 255]);
  });

  it('loads only the first frame of an animated GIF', async () => {
    const canvas = await withFile('anim.gif', markedGif([100, 100, 100]), (path) =>
      loadImage(path, { size: 16, fit: 'fill' }),
    );

    expect(opaqueColors(canvas)).toEqual(new Set(['255,0,0', '0,0,0']));
  });

  it('rejects a missing file and leaves the supplied canvas untouched', async () => {
    const target = new Canvas(16).clear([1, 2, 3]);
    const before = new Uint8Array(target.buffer);

    await expect(loadImage('/nonexistent/pixoo/image.png', { canvas: target })).rejects.toThrow(
      'Input file is missing',
    );
    expect(target.buffer).toEqual(before);
  });

  it('rejects a file that is not an image and leaves the supplied canvas untouched', async () => {
    const target = new Canvas(16).clear([1, 2, 3]);
    const before = new Uint8Array(target.buffer);

    await withFile('notes.txt', 'not an image at all', async (path) => {
      await expect(loadImage(path, { canvas: target })).rejects.toThrow(
        'Input file contains unsupported image format',
      );
    });
    expect(target.buffer).toEqual(before);
  });
});

/** The same encoded bytes as a `Uint8Array`, a `Buffer`, and a view at a non-zero offset. */
function byteForms(bytes: Uint8Array): [string, Uint8Array][] {
  const padded = new Uint8Array(bytes.length + 24);
  padded.set(bytes, 17);
  return [
    ['Uint8Array', new Uint8Array(bytes)],
    ['Buffer', Buffer.from(bytes)],
    ['subarray view', padded.subarray(17, 17 + bytes.length)],
  ];
}

describe('loadImage from bytes', () => {
  const OPTION_SETS = [
    ['default options', {}],
    ['size', { size: 16 }],
    ['fit cover', { fit: 'cover' }],
    ['fit fill', { fit: 'fill', kernel: 'mitchell' }],
    ['kernel lanczos3', { kernel: 'lanczos3' }],
    ['region', { width: 10, height: 20, x: 3, y: -4 }],
  ] as const;

  it.each(OPTION_SETS)('matches loading the file path with %s', async (_label, opts) => {
    const png = await sourcePng();
    const fromPath = await withFile('source.png', png, (path) => loadImage(path, opts));

    for (const [form, bytes] of byteForms(png)) {
      const fromBytes = await loadImage(bytes, opts);
      expect([form, fromBytes.width, fromBytes.height]).toEqual([
        form,
        fromPath.width,
        fromPath.height,
      ]);
      expect(fromBytes.buffer).toEqual(fromPath.buffer);
    }
  });

  it('matches loading the file path onto a supplied canvas', async () => {
    const png = await sourcePng();
    const fromPath = await withFile('source.png', png, (path) =>
      loadImage(path, {
        canvas: new Canvas(32).clear([9, 9, 9]),
        x: 4,
        y: 4,
        width: 16,
        height: 8,
      }),
    );

    for (const [, bytes] of byteForms(png)) {
      const target = new Canvas(32).clear([9, 9, 9]);
      const result = await loadImage(bytes, { canvas: target, x: 4, y: 4, width: 16, height: 8 });
      expect(result).toBe(target);
      expect(target.buffer).toEqual(fromPath.buffer);
    }
  });

  it.each([
    ['garbage', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
    ['an empty Uint8Array', new Uint8Array(0)],
    ['an empty Buffer', Buffer.alloc(0)],
  ])('rejects %s and leaves the supplied canvas untouched', async (_label, bytes) => {
    const target = new Canvas(16).clear([1, 2, 3]);
    const before = new Uint8Array(target.buffer);

    await expect(loadImage(bytes, { canvas: target })).rejects.toThrow(Error);
    expect(target.buffer).toEqual(before);
  });

  it('rejects truncated bytes and leaves the supplied canvas untouched', async () => {
    const png = await sourcePng();
    const target = new Canvas(16).clear([1, 2, 3]);
    const before = new Uint8Array(target.buffer);

    await expect(loadImage(png.subarray(0, 40), { canvas: target })).rejects.toThrow(
      'Input buffer has corrupt header',
    );
    expect(target.buffer).toEqual(before);
  });

  it('names the unsupported format the way a bad file does', async () => {
    await expect(loadImage(new TextEncoder().encode('not an image at all'))).rejects.toThrow(
      'Input buffer contains unsupported image format',
    );
  });
});

describe('downsampleSprite from bytes', () => {
  it.each([
    ['default options', {}],
    ['alphaThreshold', { alphaThreshold: 100 }],
    ['dark and white thresholds', { darkThreshold: 5, whiteThreshold: 150 }],
  ] as const)('matches downsampling the file path with %s', async (_label, opts) => {
    const png = await encodePng(spriteFixture(), 12, 10);
    const fromPath = await withFile('sprite.png', png, (path) =>
      downsampleSprite(path, 3, 3, opts),
    );

    for (const [, bytes] of byteForms(png)) {
      expect(await downsampleSprite(bytes, 3, 3, opts)).toEqual(fromPath);
    }
  });

  it.each([
    ['garbage', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
    ['an empty Uint8Array', new Uint8Array(0)],
  ])('rejects %s', async (_label, bytes) => {
    await expect(downsampleSprite(bytes, 3, 3)).rejects.toThrow(Error);
  });

  it('rejects a missing path and a non-image path as before', async () => {
    await expect(downsampleSprite('/nonexistent/pixoo/sprite.png', 3, 3)).rejects.toThrow(
      'Input file is missing',
    );
    await withFile('notes.txt', 'not an image at all', async (path) => {
      await expect(downsampleSprite(path, 3, 3)).rejects.toThrow(
        'Input file contains unsupported image format',
      );
    });
  });
});

/**
 * 12×10 sprite: transparent margin, a 6×6 body block at (3,2) in [200, 120, 90] with dark eye
 * pixels at (4,3) and (7,3).
 */
function spriteFixture(): Uint8Array {
  const rgba = new Uint8Array(12 * 10 * 4);
  for (let y = 2; y < 8; y++) {
    for (let x = 3; x < 9; x++) rgba.set([200, 120, 90, 255], (y * 12 + x) * 4);
  }
  for (const x of [4, 7]) rgba.set([10, 10, 10, 255], (3 * 12 + x) * 4);
  return rgba;
}

describe('downsampleSprite on a multi-cell image', () => {
  it('samples cell centres inside the bounding box of visible content', async () => {
    const sprite = await withFile('sprite.png', await encodePng(spriteFixture(), 12, 10), (path) =>
      downsampleSprite(path, 3, 3),
    );
    const body: RGB = [200, 120, 90];
    const dark: RGB = [10, 10, 10];

    expect(sprite).toEqual({
      grid: [
        [{ color: dark }, { color: body }, { color: body }],
        [{ color: body }, { color: body }, { color: body }],
        [{ color: body }, { color: body }, { color: body }],
      ],
      bodyColor: body,
      darkColor: dark,
      cols: 3,
      rows: 3,
    });
  });
});

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

  it('rejects a ragged grid before painting anything', () => {
    const c = new Canvas();
    c.clear([128, 128, 128]);
    const ragged: SpriteCell[][] = [
      [{ color: [255, 0, 0] }, { color: [0, 255, 0] }],
      [{ color: [0, 0, 255] }],
    ];

    expect(() => renderSprite(c, ragged, { scale: 4, x: 0, y: 0 })).toThrow(RangeError);
    expect(() => renderSprite(c, ragged, { scale: 4, x: 0, y: 0 })).toThrow(
      'Sprite grid row 1 has 1 cell; expected 2',
    );
    // The first row must not have been painted before the throw.
    expect(c.getPixel(0, 0)).toEqual([128, 128, 128]);
  });

  it('rejects a row longer than the first', () => {
    const c = new Canvas();
    const ragged: SpriteCell[][] = [
      [{ color: [255, 0, 0] }],
      [{ color: [0, 255, 0] }, { color: [0, 0, 255] }],
    ];

    expect(() => renderSprite(c, ragged, { scale: 4 })).toThrow(
      'Sprite grid row 1 has 2 cells; expected 1',
    );
  });

  it('accepts a rectangular grid of any shape', () => {
    const c = new Canvas();
    const wide = makeGrid(6, 2, [255, 0, 0]);
    const tall = makeGrid(2, 6, [0, 255, 0]);
    expect(() => renderSprite(c, wide, { scale: 2, x: 0, y: 0 })).not.toThrow();
    expect(() => renderSprite(c, tall, { scale: 2, x: 0, y: 20 })).not.toThrow();
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

/** Bounding box `[x0, y0, x1, y1]` (inclusive) of painted pixels, or `null` when none. */
function paintedBounds(c: Canvas): [number, number, number, number] | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (c.getPixelRgba(x, y)[3] === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

describe('renderSprite default scale on panel squares', () => {
  const GRIDS: [cols: number, rows: number][] = [
    [1, 1],
    [8, 8],
    [10, 8],
    [3, 7],
    [2, 64],
    [65, 1],
  ];
  const cases = ([16, 32, 64] as const).flatMap((size) =>
    GRIDS.map(([cols, rows]) => [size, cols, rows] as const),
  );

  it.each(cases)(
    'on a %i-pixel square fits a %i×%i grid by its longer side',
    (size, cols, rows) => {
      const c = new Canvas(size);
      renderSprite(c, makeGrid(rows, cols, [255, 0, 0]));

      const scale = Math.floor(size / Math.max(cols, rows));
      const x0 = Math.floor((size - cols * scale) / 2);
      expect(paintedBounds(c)).toEqual(
        scale === 0 ? null : [x0, 0, x0 + cols * scale - 1, Math.min(size, rows * scale) - 1],
      );
    },
  );
});

describe('renderSprite default scale on non-square canvases', () => {
  it.each([
    // [canvas w, h, grid cols, rows, expected bounds]
    [64, 32, 8, 8, [16, 0, 47, 31]], // height-bound: scale 4, centred horizontally
    [32, 64, 8, 8, [0, 0, 31, 31]], // width-bound: scale 4
    [320, 7, 10, 7, [155, 0, 164, 6]], // scale 1 on a strip
    [7, 320, 7, 10, [0, 0, 6, 9]],
  ] as const)(
    'fits a %i×%i canvas with a %i×%i grid inside both dimensions',
    (width, height, cols, rows, bounds) => {
      const c = new Canvas(width, height);
      renderSprite(c, makeGrid(rows, cols, [255, 0, 0]));
      expect(paintedBounds(c)).toEqual(bounds);
    },
  );

  it('paints nothing when the grid cannot fit even at scale 1', () => {
    const c = new Canvas(320, 7);
    renderSprite(c, makeGrid(8, 8, [255, 0, 0]));
    expect(paintedBounds(c)).toBeNull();
  });

  it('still honors an explicit scale', () => {
    const c = new Canvas(320, 7);
    renderSprite(c, makeGrid(8, 8, [255, 0, 0]), { scale: 2, x: 0 });
    expect(paintedBounds(c)).toEqual([0, 0, 15, 6]);
  });
});

// --- loadAnimation ---------------------------------------------------------------------------

const GIF_DELAYS = [100, 50, 200, 0, 10, 20, 30];
/** sharp's WebP writer stores 0 and 10 ms as 100 ms, so the WebP fixture avoids both. */
const WEBP_DELAYS = [100, 50, 200, 20, 30, 40, 60];

/** Stack same-size RGBA frames top to bottom, the layout sharp takes for multi-page raw input. */
function stackFrames(frames: readonly Uint8Array[]): Buffer {
  const strip = Buffer.alloc(frames.reduce((n, f) => n + f.length, 0));
  let offset = 0;
  for (const frame of frames) {
    strip.set(frame, offset);
    offset += frame.length;
  }
  return strip;
}

/** Animated GIF or WebP written by sharp from RGBA frames. */
async function encodeAnimated(
  frames: readonly Uint8Array[],
  width: number,
  height: number,
  format: 'gif' | 'webp',
  delays: readonly number[],
): Promise<Uint8Array> {
  const image = sharp(stackFrames(frames), {
    raw: { width, height: height * frames.length, channels: 4, pageHeight: height },
  });
  const encoded =
    format === 'gif'
      ? image.gif({ delay: [...delays], loop: 0 })
      : image.webp({ lossless: true, delay: [...delays], loop: 0 });
  return new Uint8Array(await encoded.toBuffer());
}

/** Detailed frame with hard edges and some transparency — neighbours differ at every border. */
function detailFrame(k: number, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set(
        [
          (x * 37 + k * 50) & 255,
          (y * 23 + k * 90) & 255,
          ((x ^ y) * 11) & 255,
          (x + y) % 7 ? 255 : 0,
        ],
        (y * width + x) * 4,
      );
    }
  }
  return rgba;
}

/** 64×64 frame whose every row is its own color — a one-row shift in sampling changes the output. */
function stripedFrame(k: number): Uint8Array {
  const rgba = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) rgba.set([y * 4, k * 80, 255 - y * 4, 255], (y * 64 + x) * 4);
  }
  return rgba;
}

/**
 * `size × size` red/blue checkerboard of 1-pixel cells, red at (0, 0) for phase 0. Any average of
 * two or more neighbouring source pixels is purple.
 */
function checkerboard(size: number, phase = 0): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      rgba.set((x + y + phase) % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * size + x) * 4);
    }
  }
  return rgba;
}

/** Pixels carrying both red and blue — on a red/blue checkerboard, only a blend of source pixels. */
function blendedCount(canvas: Canvas): number {
  let blended = 0;
  for (let i = 0; i < canvas.buffer.length; i += 4) {
    if (canvas.buffer[i]! > 64 && canvas.buffer[i + 2]! > 64) blended++;
  }
  return blended;
}

/** Which marked source frame a decoded `fill` frame shows, read from a pixel clear of the marker. */
function frameIndex(frame: Canvas): number {
  const [r, g, b] = frame.getPixel(frame.width - 1, frame.height - 1);
  return FRAME_COLORS.findIndex((c) => c[0] === r && c[1] === g && c[2] === b);
}

/**
 * `loadImage` of page `k` on its own: the page decoded with `{ page: k }` and re-encoded losslessly
 * as a still PNG or WebP. Both decode to the same pixels, so either is the page alone.
 */
async function loadPage(
  input: Uint8Array,
  k: number,
  still: 'png' | 'webp',
  opts: Parameters<typeof loadImage>[1],
): Promise<Canvas> {
  const page = sharp(input, { page: k });
  const bytes = await (still === 'png' ? page.png() : page.webp({ lossless: true })).toBuffer();
  return loadImage(new Uint8Array(bytes), opts);
}

/** Left, top, width, and height of each GIF image descriptor. */
function gifFrameRects(gif: Uint8Array): [number, number, number, number][] {
  const u16 = (o: number) => gif[o]! | (gif[o + 1]! << 8);
  const rects: [number, number, number, number][] = [];
  let o = 13 + (gif[10]! & 0x80 ? 3 * 2 ** ((gif[10]! & 7) + 1) : 0);
  const skipSubBlocks = () => {
    while (gif[o] !== 0) o += gif[o]! + 1;
    o++;
  };
  while (o < gif.length) {
    const marker = gif[o++]!;
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      o++;
      skipSubBlocks();
      continue;
    }
    rects.push([u16(o), u16(o + 2), u16(o + 4), u16(o + 6)]);
    o += 9 + (gif[o + 8]! & 0x80 ? 3 * 2 ** ((gif[o + 8]! & 7) + 1) : 0) + 1;
    skipSubBlocks();
  }
  return rects;
}

/**
 * GIF whose frames after the first are transparent except one new pixel each, with disposal 1
 * ("do not dispose") — every frame shows the base plus all pixels added so far.
 */
function accumulatingGif(frameCount: number): { gif: Uint8Array; expected: Uint8Array[] } {
  const width = 8;
  const height = 6;
  const gif = GIFEncoder();
  const composite = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) composite.set([40, 40, 40, 255], p * 4);
  const expected: Uint8Array[] = [];
  for (let k = 0; k < frameCount; k++) {
    const rgba = k === 0 ? new Uint8Array(composite) : new Uint8Array(width * height * 4);
    if (k > 0) {
      rgba.set([...FRAME_COLORS[k]!, 255], (3 * width + k) * 4);
      composite.set([...FRAME_COLORS[k]!, 255], (3 * width + k) * 4);
    }
    expected.push(new Uint8Array(composite));
    const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true });
    const transparentIndex = palette.findIndex((c) => (c as number[])[3] === 0);
    gif.writeFrame(applyPalette(rgba, palette, 'rgba4444'), width, height, {
      palette,
      delay: 40,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(transparentIndex, 0),
      dispose: 1,
    });
  }
  gif.finish();
  return { gif: gif.bytes(), expected };
}

const FITS = ['contain', 'cover', 'fill'] as const;
const KERNELS = ['nearest', 'lanczos3', 'mitchell'] as const;
const FIT_KERNELS = FITS.flatMap((fit) => KERNELS.map((kernel) => [fit, kernel] as const));

describe('loadAnimation', () => {
  it('returns every GIF frame in source order with its recorded delay', async () => {
    const anim = await loadAnimation(markedGif(GIF_DELAYS), { fit: 'fill' });

    expect(anim.sourceFrames).toBe(7);
    expect(anim.frames.map(frameIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(anim.delays).toEqual(GIF_DELAYS);
    expect(new Set(anim.frames).size).toBe(7);
    for (const frame of anim.frames) expect([frame.width, frame.height]).toEqual([64, 64]);
  });

  it('returns every animated WebP frame with its recorded delay', async () => {
    const frames = WEBP_DELAYS.map((_, k) => markedFrame(k, 8, 6));
    const webp = await encodeAnimated(frames, 8, 6, 'webp', WEBP_DELAYS);
    const anim = await loadAnimation(webp, { fit: 'fill', size: 16 });

    expect(anim.sourceFrames).toBe(7);
    expect(anim.frames.map(frameIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(anim.delays).toEqual(WEBP_DELAYS);
  });

  it('places each page on a fresh transparent size × size canvas', async () => {
    const anim = await loadAnimation(markedGif(GIF_DELAYS), { size: 32 });

    // 8×6 contained in 32×32: 32×24, rows 4–27.
    for (const frame of anim.frames) {
      expect([frame.width, frame.height]).toEqual([32, 32]);
      expect(paintedBounds(frame)).toEqual([0, 4, 31, 27]);
    }
    const placed = await loadAnimation(markedGif(GIF_DELAYS), {
      size: 16,
      width: 8,
      height: 6,
      x: 5,
      y: 7,
    });
    for (const frame of placed.frames) expect(paintedBounds(frame)).toEqual([5, 7, 12, 12]);
  });

  describe('each frame equals loadImage of its page alone', () => {
    it.each(FIT_KERNELS)('GIF, fit %s, kernel %s', async (fit, kernel) => {
      const gif = markedGif(GIF_DELAYS);
      const detailed = await encodeAnimated(
        [0, 1, 2, 3].map((k) => detailFrame(k, 40, 30)),
        40,
        30,
        'gif',
        [40, 40, 40, 40],
      );
      for (const [input, opts] of [
        [gif, { fit, kernel }],
        [gif, { fit, kernel, size: 16, width: 13, height: 7, x: 2, y: 3 }],
        [detailed, { fit, kernel, size: 16 }],
      ] as const) {
        const anim = await loadAnimation(input, opts);
        for (let k = 0; k < anim.sourceFrames; k++) {
          const page = await loadPage(input, k, 'png', opts);
          expect(anim.frames[k]!.buffer).toEqual(page.buffer);
        }
      }
    });

    it.each(FIT_KERNELS)('WebP, fit %s, kernel %s', async (fit, kernel) => {
      const marked = await encodeAnimated(
        WEBP_DELAYS.map((_, k) => markedFrame(k, 8, 6)),
        8,
        6,
        'webp',
        WEBP_DELAYS,
      );
      const detailed = await encodeAnimated(
        [0, 1, 2, 3].map((k) => detailFrame(k, 40, 30)),
        40,
        30,
        'webp',
        [40, 40, 40, 40],
      );
      for (const [input, opts] of [
        [marked, { fit, kernel }],
        [detailed, { fit, kernel, size: 16 }],
      ] as const) {
        const anim = await loadAnimation(input, opts);
        for (let k = 0; k < anim.sourceFrames; k++) {
          for (const still of ['webp', 'png'] as const) {
            const page = await loadPage(input, k, still, opts);
            expect([still, anim.frames[k]!.buffer]).toEqual([still, page.buffer]);
          }
        }
      }
    });

    it('keeps neighbouring frames out of each frame’s edge rows', async () => {
      const anim = await loadAnimation(markedGif(GIF_DELAYS), { fit: 'fill', kernel: 'lanczos3' });

      // Every frame is one solid color plus a black marker; a stacked resize would blend the
      // frames above and below into rows 0, 1, and 63.
      anim.frames.forEach((frame, k) => {
        for (const y of [0, 1, 62, 63]) {
          expect(frame.getPixel(63, y)).toEqual(FRAME_COLORS[k]);
        }
      });
    });

    // 64 → 20 rows (cover) and 64 → 30 rows (fill) each put one nearest sample exactly on a source
    // row boundary, where the resize must see the same kind of source for both paths to agree.
    it.each(['gif', 'webp'] as const)(
      '%s, where a nearest sample lands exactly on a source row boundary',
      async (format) => {
        const input = await encodeAnimated(
          [0, 1, 2].map(stripedFrame),
          64,
          64,
          format,
          [40, 40, 40],
        );
        for (const opts of [
          { width: 20, height: 10, fit: 'cover' },
          { width: 100, height: 30, fit: 'fill' },
        ] as const) {
          const anim = await loadAnimation(input, opts);
          for (let k = 0; k < anim.sourceFrames; k++) {
            const page = await loadPage(input, k, 'png', opts);
            expect([opts.fit, k, anim.frames[k]!.buffer]).toEqual([opts.fit, k, page.buffer]);
          }
        }
      },
    );
  });

  it('keeps an animated WebP checkerboard crisp on a 4× downscale', async () => {
    const webp = await encodeAnimated(
      [0, 1, 0].map((phase) => checkerboard(64, phase)),
      64,
      64,
      'webp',
      [40, 50, 60],
    );
    const anim = await loadAnimation(webp, { size: 16 });

    expect(anim.frames).toHaveLength(3);
    for (const frame of anim.frames) {
      expect(paintedBounds(frame)).toEqual([0, 0, 15, 15]);
      expect(blendedCount(frame)).toBe(0);
    }
    // Neighbouring frames are opposite phases of the board, so each lands on the other colours.
    expect(anim.frames[0]!.getPixel(0, 0)).not.toEqual(anim.frames[1]!.getPixel(0, 0));
    expect(anim.frames[0]!.buffer).toEqual(anim.frames[2]!.buffer);
  });

  it.each([1, 5, 12, 40])(
    'samples a 12-frame animated WebP down to maxFrames %i, each frame its page alone',
    async (maxFrames) => {
      const delays = Array.from({ length: 12 }, (_, k) => 20 + k * 10);
      const webp = await encodeAnimated(
        delays.map((_, k) => markedFrame(k, 12, 8)),
        12,
        8,
        'webp',
        delays,
      );
      const opts = { size: 16, fit: 'cover', kernel: 'lanczos3', maxFrames } as const;
      const anim = await loadAnimation(webp, opts);

      const keep = Math.min(12, maxFrames);
      const kept = Array.from({ length: keep }, (_, i) => Math.floor((i * 12) / keep));
      expect(anim.sourceFrames).toBe(12);
      expect(anim.delays.reduce((a, b) => a + b, 0)).toBe(delays.reduce((a, b) => a + b, 0));
      expect(anim.frames).toHaveLength(keep);
      for (const [i, k] of kept.entries()) {
        const page = await loadPage(webp, k, 'png', opts);
        expect([k, anim.frames[i]!.buffer]).toEqual([k, page.buffer]);
      }
    },
  );

  describe('other multi-page sources', () => {
    /** Multi-page TIFF (lossless) of the given pages, stacked when they share a size. */
    async function multiPageTiff(pages: readonly Uint8Array[], width: number, height: number) {
      return new Uint8Array(
        await sharp(stackFrames(pages), {
          raw: { width, height: height * pages.length, channels: 4, pageHeight: height },
        })
          .tiff({ compression: 'lzw' })
          .toBuffer(),
      );
    }

    it('returns each page of a same-size multi-page TIFF as loadImage places it', async () => {
      const tiff = await multiPageTiff(
        [0, 1, 2].map((k) => detailFrame(k, 40, 30)),
        40,
        30,
      );
      const opts = { size: 16, fit: 'fill', kernel: 'mitchell' } as const;
      const anim = await loadAnimation(tiff, opts);

      expect([anim.sourceFrames, anim.delays]).toEqual([3, [0, 0, 0]]);
      for (let k = 0; k < 3; k++) {
        expect(anim.frames[k]!.buffer).toEqual((await loadPage(tiff, k, 'png', opts)).buffer);
      }
    });

    it('rejects a multi-page TIFF whose pages differ in size', async () => {
      // A tiled pyramid stores 64×64, 32×32, and 16×16 pages.
      const pyramid = new Uint8Array(
        await sharp(Buffer.from(detailFrame(0, 64, 64)), {
          raw: { width: 64, height: 64, channels: 4 },
        })
          .tiff({ pyramid: true, tile: true, tileWidth: 16, tileHeight: 16, compression: 'lzw' })
          .toBuffer(),
      );
      expect((await sharp(pyramid).metadata()).pages).toBe(3);

      await expect(loadAnimation(pyramid)).rejects.toThrow('page 1 differs from page 0');
      // loadImage reads the first page alone.
      expect((await loadImage(pyramid)).width).toBe(64);
    });
  });

  it('composites delta-encoded GIF frames stored as sub-rectangles', async () => {
    const frames = Array.from({ length: 6 }, (_, k) => {
      const rgba = new Uint8Array(16 * 16 * 4);
      for (let p = 0; p < 256; p++) rgba.set([30, 60, 90, 255], p * 4);
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        rgba.set([250, 200, 0, 255], ((7 + dy) * 16 + 2 + k * 2 + dx) * 4);
      }
      return rgba;
    });
    const gif = await encodeAnimated(frames, 16, 16, 'gif', [80, 80, 80, 80, 80, 80]);

    // The fixture really is delta-encoded: every frame after the first is a small patch.
    const rects = gifFrameRects(gif);
    expect(rects[0]).toEqual([0, 0, 16, 16]);
    for (const [, , w, h] of rects.slice(1)) expect(w * h).toBeLessThan(16 * 16);

    const anim = await loadAnimation(gif, { size: 16, fit: 'fill' });
    expect(anim.frames.map((f) => f.buffer)).toEqual(frames);
  });

  it('accumulates transparent delta frames under "do not dispose"', async () => {
    const { gif, expected } = accumulatingGif(6);
    const anim = await loadAnimation(gif, { size: 16, fit: 'fill' });

    anim.frames.forEach((frame, k) => {
      const expectedFrame = Canvas.fromRgba(expected[k]!, 8, 6);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          expect(frame.getPixelRgba(x, y)).toEqual(
            expectedFrame.getPixelRgba(Math.floor(x / 2), Math.floor((y * 6) / 16)),
          );
        }
      }
    });
  });

  describe('maxFrames', () => {
    const sample = async (delays: readonly number[], maxFrames: number) =>
      loadAnimation(markedGif(delays), { size: 16, fit: 'fill', maxFrames });

    it('samples evenly from frame 0 and sums the delays each kept frame stands in for', async () => {
      const anim = await sample(GIF_DELAYS, 3);

      expect(anim.frames.map(frameIndex)).toEqual([0, 2, 4]);
      expect(anim.delays).toEqual([150, 200, 60]);
      expect(anim.sourceFrames).toBe(7);
    });

    it('spreads the kept frames across the whole source', async () => {
      const delays = Array.from({ length: 12 }, (_, k) => (k + 1) * 10);
      const anim = await sample(delays, 5);

      expect(anim.frames.map(frameIndex)).toEqual([0, 2, 4, 7, 9]);
      expect(anim.delays).toEqual([30, 70, 180, 170, 330]);
      expect(anim.delays.reduce((a, b) => a + b, 0)).toBe(780);
      expect(anim.sourceFrames).toBe(12);
    });

    it('keeps the total duration when one frame stands in for all', async () => {
      const anim = await sample(GIF_DELAYS, 1);

      expect(anim.frames.map(frameIndex)).toEqual([0]);
      expect(anim.delays).toEqual([410]);
    });

    it('drops one frame from just below the frame count', async () => {
      const anim = await sample(GIF_DELAYS, 6);

      expect(anim.frames.map(frameIndex)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(anim.delays).toEqual([100, 50, 200, 0, 10, 50]);
    });

    it.each([7, 8, 100])('returns every frame unchanged at maxFrames %i', async (maxFrames) => {
      const anim = await sample(GIF_DELAYS, maxFrames);

      expect(anim.frames.map(frameIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(anim.delays).toEqual(GIF_DELAYS);
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects %s with a RangeError before decoding',
      async (maxFrames) => {
        // Undecodable input: the RangeError proves validation runs first.
        const promise = loadAnimation(new Uint8Array([1, 2, 3]), { maxFrames });
        await expect(promise).rejects.toThrow(RangeError);
        await expect(promise).rejects.toThrow(
          `maxFrames must be a positive integer; got ${maxFrames}`,
        );
      },
    );
  });

  describe('still input', () => {
    it('returns one frame with delay 0 for a PNG, equal to loadImage', async () => {
      const png = await sourcePng();
      const opts = { size: 32, fit: 'cover', kernel: 'lanczos3' } as const;
      const anim = await loadAnimation(png, opts);

      expect(anim.sourceFrames).toBe(1);
      expect(anim.delays).toEqual([0]);
      expect(anim.frames).toHaveLength(1);
      expect(anim.frames[0]!.buffer).toEqual((await loadImage(png, opts)).buffer);
    });

    it('keeps a single-frame GIF’s recorded delay', async () => {
      const anim = await loadAnimation(markedGif([70]), { size: 16 });

      expect(anim.sourceFrames).toBe(1);
      expect(anim.delays).toEqual([70]);
      expect(anim.frames[0]!.buffer).toEqual(
        (await loadImage(markedGif([70]), { size: 16 })).buffer,
      );
    });

    it.each(['webp', 'jpeg'] as const)(
      'matches loadImage for a downscaled still %s',
      async (format) => {
        const encoded = sharp(Buffer.from(detailFrame(0, 64, 48)), {
          raw: { width: 64, height: 48, channels: 4 },
        });
        const bytes = new Uint8Array(
          await (format === 'webp' ? encoded.webp({ lossless: true }) : encoded.jpeg()).toBuffer(),
        );
        const anim = await loadAnimation(bytes, { size: 16 });

        expect(anim.sourceFrames).toBe(1);
        expect(anim.delays).toEqual([0]);
        expect(anim.frames[0]!.buffer).toEqual((await loadImage(bytes, { size: 16 })).buffer);
      },
    );

    it('treats a maxFrames above 1 as every frame', async () => {
      const anim = await loadAnimation(await sourcePng(), { maxFrames: 40 });
      expect([anim.frames.length, anim.sourceFrames, anim.delays]).toEqual([1, 1, [0]]);
    });
  });

  it.each(['gif', 'webp'] as const)(
    'decodes a %s path and its bytes identically',
    async (format) => {
      const bytes =
        format === 'gif'
          ? markedGif(GIF_DELAYS)
          : await encodeAnimated(
              WEBP_DELAYS.map((_, k) => markedFrame(k, 8, 6)),
              8,
              6,
              'webp',
              WEBP_DELAYS,
            );
      const opts = { size: 16, kernel: 'mitchell', maxFrames: 4 } as const;
      const snapshot = (anim: LoadedAnimation) => ({
        frames: anim.frames.map((f) => f.buffer),
        delays: anim.delays,
        sourceFrames: anim.sourceFrames,
      });
      const fromPath = await withFile(`anim.${format}`, bytes, (path) => loadAnimation(path, opts));

      for (const [, form] of byteForms(bytes)) {
        expect(snapshot(await loadAnimation(form, opts))).toEqual(snapshot(fromPath));
      }
    },
  );

  describe('undecodable input', () => {
    it.each([
      ['garbage', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
      ['an empty Uint8Array', new Uint8Array(0)],
      ['text', new TextEncoder().encode('not an image at all')],
    ])('rejects %s the way loadImage does', async (_label, bytes) => {
      const expected = await loadImage(bytes).then(
        () => 'resolved',
        (error: Error) => error.message,
      );
      expect(expected).not.toBe('resolved');
      await expect(loadAnimation(bytes)).rejects.toThrow(expected);
    });

    it('rejects a header-truncated GIF the way loadImage does', async () => {
      const truncated = markedGif(GIF_DELAYS).subarray(0, 40);
      await expect(loadImage(truncated)).rejects.toThrow('Input buffer has corrupt header');
      await expect(loadAnimation(truncated)).rejects.toThrow('Input buffer has corrupt header');
    });

    it('rejects a missing path and a non-image path the way loadImage does', async () => {
      await expect(loadAnimation('/nonexistent/pixoo/anim.gif')).rejects.toThrow(
        'Input file is missing: /nonexistent/pixoo/anim.gif',
      );
      await withFile('notes.txt', 'not an image at all', async (path) => {
        await expect(loadAnimation(path)).rejects.toThrow(
          'Input file contains unsupported image format',
        );
      });
    });
  });
});

// --- Full-resolution decode ------------------------------------------------------------------

type StillFormat = 'png' | 'webp' | 'lossy webp' | 'jpeg' | 'lossy jpeg';

/**
 * RGBA bytes encoded as a still. Lossless WebP keeps every pixel, the quality-100 4:4:4 JPEG stays
 * within a step or two of the source, and the lossy formats take sharp's defaults.
 */
async function encodeStill(
  rgba: Uint8Array,
  width: number,
  height: number,
  format: StillFormat,
): Promise<Uint8Array> {
  const image = sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } });
  const encoded = {
    png: () => image.png(),
    webp: () => image.webp({ lossless: true }),
    'lossy webp': () => image.webp(),
    jpeg: () => image.flatten().jpeg({ quality: 100, chromaSubsampling: '4:4:4' }),
    'lossy jpeg': () => image.flatten().jpeg(),
  }[format]();
  return new Uint8Array(await encoded.toBuffer());
}

/** The full-resolution decode of `bytes` as a PNG — the same image, in a format sharp never shrinks. */
async function asPng(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(bytes).png().toBuffer());
}

/** RGB triples in the full-resolution decode of `bytes`. */
async function decodedColors(bytes: Uint8Array): Promise<Set<string>> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const colors = new Set<string>();
  for (let i = 0; i < data.length; i += info.channels) {
    colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  return colors;
}

/** Assert identical canvases, reporting how many pixels differ rather than diffing every byte. */
function expectSamePixels(actual: Canvas, expected: Canvas, context: string): void {
  expect([actual.width, actual.height], context).toEqual([expected.width, expected.height]);
  let differing = 0;
  for (let i = 0; i < actual.buffer.length; i += 4) {
    if (actual.buffer.subarray(i, i + 4).join() !== expected.buffer.subarray(i, i + 4).join()) {
      differing++;
    }
  }
  expect(differing, `${context}: differing pixels`).toBe(0);
}

/** An opaque 64×64 checkerboard and a 40×30 hard-edged frame with transparent pixels. */
const FULL_RES_SOURCES = [
  ['checkerboard', checkerboard(64), 64, 64],
  ['detail', detailFrame(0, 40, 30), 40, 30],
] as const;

/** Placements that shrink those sources by 2× or more, where sharp can shrink while decoding, plus 1× and up. */
const DOWNSCALES = [
  { size: 16 },
  { size: 64, width: 20, height: 10, x: 5, y: 3 },
  { size: 32, width: 7, height: 13, x: -2, y: 4 },
  { size: 64 },
] as const;

describe('loadImage decodes at full resolution before resizing', () => {
  it.each(['webp', 'jpeg'] as const)(
    'keeps a %s checkerboard crisp on a 4× downscale with the default kernel',
    async (format) => {
      const canvas = await loadImage(await encodeStill(checkerboard(64), 64, 64, format), {
        size: 16,
      });

      expect(paintedBounds(canvas)).toEqual([0, 0, 15, 15]);
      expect(blendedCount(canvas)).toBe(0);
    },
  );

  it('gives a lossless WebP the pixels of the same image as PNG', async () => {
    for (const [label, rgba, width, height] of FULL_RES_SOURCES) {
      const png = await encodeStill(rgba, width, height, 'png');
      const webp = await encodeStill(rgba, width, height, 'webp');
      for (const [fit, kernel] of FIT_KERNELS) {
        for (const placement of DOWNSCALES) {
          const opts = { ...placement, fit, kernel };
          expectSamePixels(
            await loadImage(webp, opts),
            await loadImage(png, opts),
            `${label} ${JSON.stringify(opts)}`,
          );
        }
      }
    }
  });

  it.each(FIT_KERNELS)(
    'matches the PNG of its own full-resolution decode — fit %s, kernel %s',
    async (fit, kernel) => {
      for (const format of ['webp', 'lossy webp', 'jpeg', 'lossy jpeg'] as const) {
        for (const [label, rgba, width, height] of FULL_RES_SOURCES) {
          const bytes = await encodeStill(rgba, width, height, format);
          const png = await asPng(bytes);
          for (const placement of DOWNSCALES) {
            const opts = { ...placement, fit, kernel };
            expectSamePixels(
              await loadImage(bytes, opts),
              await loadImage(png, opts),
              `${format} ${label} ${JSON.stringify(opts)}`,
            );
          }
        }
      }
    },
  );

  it.each(['webp', 'lossy webp', 'jpeg', 'lossy jpeg'] as const)(
    'keeps nearest to the colors a %s decodes to',
    async (format) => {
      for (const [label, rgba, width, height] of FULL_RES_SOURCES) {
        const bytes = await encodeStill(rgba, width, height, format);
        const colors = await decodedColors(bytes);
        for (const fit of FITS) {
          for (const placement of DOWNSCALES) {
            const canvas = await loadImage(bytes, { ...placement, fit });
            const foreign = [...opaqueColors(canvas)].filter((c) => !colors.has(c));
            expect(foreign, `${label} ${fit} ${JSON.stringify(placement)}`).toEqual([]);
          }
        }
      }
    },
  );

  it('draws a WebP onto a supplied canvas like the same image as PNG', async () => {
    const place = async (format: StillFormat) =>
      loadImage(await encodeStill(checkerboard(64), 64, 64, format), {
        canvas: new Canvas(32).clear([9, 9, 9]),
        width: 16,
        height: 12,
        x: 3,
        y: -2,
        fit: 'cover',
      });

    expectSamePixels(await place('webp'), await place('png'), 'supplied canvas');
  });

  it.each(['png', 'webp'] as const)(
    'samples pixel centres on a 4× %s downscale',
    async (format) => {
      // Each source pixel names its own coordinates: R = 4x, G = 4y.
      const rgba = new Uint8Array(64 * 64 * 4);
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) rgba.set([x * 4, y * 4, 128, 255], (y * 64 + x) * 4);
      }
      const bytes = await encodeStill(rgba, 64, 64, format);

      for (const fit of FITS) {
        const canvas = await loadImage(bytes, { size: 16, fit });
        expect(canvas.buffer).toEqual(
          expectedCanvas(16, 16, (x, y) => [(4 * x + 2) * 4, (4 * y + 2) * 4, 128, 255]),
        );
      }
    },
  );

  describe('vector sources', () => {
    const CIRCLE = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="#f00"/></svg>',
    );
    /** The 16-unit SVG rendered by sharp at `density` dpi (72 → 16 px), as a PNG. */
    const rendered = async (density: number) =>
      new Uint8Array(await sharp(CIRCLE, { density }).png().toBuffer());

    it.each([
      ['a 64 px canvas', { size: 64 }, 288],
      ['an 8 px region', { size: 32, width: 8, height: 8, x: 4, y: 4 }, 36],
    ] as const)('renders an SVG at the resolution of %s', async (_label, opts, density) => {
      const expected = await loadImage(await rendered(density), opts);
      expectSamePixels(await loadImage(CIRCLE, opts), expected, `density ${density}`);
    });

    it('gives loadAnimation one frame of the SVG, as loadImage renders it', async () => {
      const anim = await loadAnimation(CIRCLE, { size: 64 });

      expect([anim.sourceFrames, anim.delays]).toEqual([1, [0]]);
      expectSamePixels(anim.frames[0]!, await loadImage(CIRCLE, { size: 64 }), 'frame 0');
    });
  });
});
