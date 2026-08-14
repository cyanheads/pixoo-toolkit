import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import {
  canvasToPng,
  encodeAnimationGif,
  saveAnimationGif,
  saveAnimationPngs,
  savePng,
} from '../src/preview.js';
import { Canvas } from '../src/canvas.js';

function readGifDimensions(gif: Uint8Array): {
  screen: [number, number];
  frames: Array<[number, number]>;
} {
  const readU16 = (offset: number) => gif[offset]! | (gif[offset + 1]! << 8);
  const screen: [number, number] = [readU16(6), readU16(8)];
  const frames: Array<[number, number]> = [];
  const globalTableSize = gif[10]! & 0x80 ? 3 * 2 ** ((gif[10]! & 0x07) + 1) : 0;
  let offset = 13 + globalTableSize;

  const skipSubBlocks = (): void => {
    while (gif[offset] !== 0) offset += gif[offset]! + 1;
    offset++;
  };

  while (offset < gif.length) {
    const marker = gif[offset++]!;
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      offset++; // extension label
      skipSubBlocks();
      continue;
    }
    if (marker !== 0x2c) throw new Error(`Unexpected GIF block marker 0x${marker.toString(16)}`);

    frames.push([readU16(offset + 4), readU16(offset + 6)]);
    const localTableSize = gif[offset + 8]! & 0x80 ? 3 * 2 ** ((gif[offset + 8]! & 0x07) + 1) : 0;
    offset += 9 + localTableSize;
    offset++; // LZW minimum code size
    skipSubBlocks();
  }

  return { screen, frames };
}

interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  channels: number;
  /** Inflated IDAT stream — one filter byte per row followed by the row's samples. */
  raw: Uint8Array;
  filterBytes: number[];
  pixel: (x: number, y: number) => number[];
}

/** Parse a PNG down to its inflated pixel bytes — no decoding shortcuts. */
function decodePng(png: Uint8Array): DecodedPng {
  const readU32 = (offset: number) =>
    ((png[offset]! << 24) >>> 0) +
    (png[offset + 1]! << 16) +
    (png[offset + 2]! << 8) +
    png[offset + 3]!;

  const idat: Uint8Array[] = [];
  let offset = 8; // PNG signature
  let ihdr: Uint8Array | undefined;
  while (offset < png.length) {
    const length = readU32(offset);
    const type = String.fromCharCode(
      png[offset + 4]!,
      png[offset + 5]!,
      png[offset + 6]!,
      png[offset + 7]!,
    );
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  if (!ihdr) throw new Error('PNG has no IHDR chunk');

  const width = readU32(16);
  const height = readU32(20);
  const colorType = ihdr[9]!;
  const channels = colorType === 6 ? 4 : 3;
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c)))));
  const stride = 1 + width * channels;

  return {
    width,
    height,
    bitDepth: ihdr[8]!,
    colorType,
    channels,
    raw,
    filterBytes: Array.from({ length: height }, (_, y) => raw[y * stride]!),
    pixel: (x, y) =>
      Array.from(raw.subarray(y * stride + 1 + x * channels, y * stride + 1 + (x + 1) * channels)),
  };
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

async function withTempDir<T>(fn: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'pixoo-toolkit-preview-'));
  try {
    return await fn(directory);
  } finally {
    await rm(directory, { recursive: true });
  }
}

/**
 * Non-trivial canvas mixing opaque fills with the exact pair #33 names: a
 * half-transparent white pixel at (3,12) and an opaque mid-grey at (4,12).
 */
function figureCanvas(): Canvas {
  return new Canvas(16)
    .fillRect(0, 0, 16, 8, [10, 20, 30])
    .fillCircle(8, 4, 3, 'red')
    .blendPixel(3, 12, 'white', 0.5)
    .setPixel(4, 12, [128, 128, 128]);
}

const INVALID_SCALES = [0, -1, 1.5, NaN, Infinity, -Infinity];

describe('canvasToPng', () => {
  it('produces valid PNG signature', () => {
    const c = new Canvas();
    const png = canvasToPng(c);
    // PNG magic bytes: 137 80 78 71 13 10 26 10
    expect(png[0]).toBe(137);
    expect(png[1]).toBe(80); // P
    expect(png[2]).toBe(78); // N
    expect(png[3]).toBe(71); // G
    expect(png[4]).toBe(13);
    expect(png[5]).toBe(10);
    expect(png[6]).toBe(26);
    expect(png[7]).toBe(10);
  });

  it('contains IHDR chunk with correct dimensions', () => {
    const c = new Canvas();
    const png = canvasToPng(c);
    // After 8-byte signature, first chunk is IHDR
    // Chunk: 4 bytes length + 4 bytes type + data + 4 bytes CRC
    // IHDR type at offset 12-15
    const ihdrType = String.fromCharCode(png[12]!, png[13]!, png[14]!, png[15]!);
    expect(ihdrType).toBe('IHDR');
    // Width at offset 16-19 (big-endian u32)
    const width = (png[16]! << 24) | (png[17]! << 16) | (png[18]! << 8) | png[19]!;
    const height = (png[20]! << 24) | (png[21]! << 16) | (png[22]! << 8) | png[23]!;
    expect(width).toBe(64);
    expect(height).toBe(64);
  });

  it('produces larger output with scale > 1', () => {
    const c = new Canvas();
    const png1x = canvasToPng(c, 1);
    const png2x = canvasToPng(c, 2);
    // Scaled PNG should be larger
    expect(png2x.length).toBeGreaterThan(png1x.length);
  });

  it('encodes correct dimensions at scale 4', () => {
    const c = new Canvas();
    const png = canvasToPng(c, 4);
    const width = (png[16]! << 24) | (png[17]! << 16) | (png[18]! << 8) | png[19]!;
    const height = (png[20]! << 24) | (png[21]! << 16) | (png[22]! << 8) | png[23]!;
    expect(width).toBe(256);
    expect(height).toBe(256);
  });

  it('contains IEND chunk', () => {
    const c = new Canvas();
    const png = canvasToPng(c);
    // Last 12 bytes: 4 length (0) + 4 type (IEND) + 4 CRC
    const endOffset = png.length - 8;
    const iendType = String.fromCharCode(
      png[endOffset]!,
      png[endOffset + 1]!,
      png[endOffset + 2]!,
      png[endOffset + 3]!,
    );
    expect(iendType).toBe('IEND');
  });

  it('produces different output for different canvas content', () => {
    const c1 = new Canvas();
    const c2 = new Canvas();
    c2.clear([255, 0, 0]);
    const png1 = canvasToPng(c1);
    const png2 = canvasToPng(c2);
    expect(Buffer.from(png1).equals(Buffer.from(png2))).toBe(false);
  });

  it('returns Uint8Array', () => {
    const c = new Canvas();
    const png = canvasToPng(c);
    expect(png).toBeInstanceOf(Uint8Array);
  });
});

describe('encodeAnimationGif', () => {
  it('encodes complete frames with the canvas dimensions', () => {
    const first = new Canvas().clear([255, 0, 0]);
    const second = new Canvas().clear([0, 0, 255]);

    const gif = encodeAnimationGif([first, second], 100, 1);

    expect(String.fromCharCode(...gif.subarray(0, 6))).toBe('GIF89a');
    expect(gif[6]! | (gif[7]! << 8)).toBe(64);
    expect(gif[8]! | (gif[9]! << 8)).toBe(64);
    expect(gif.at(-1)).toBe(0x3b);
  });

  it.each([
    [16, 64, 1],
    [64, 16, 1],
    [16, 64, 2],
    [64, 16, 2],
  ] as const)('rejects mixed %i then %i frames at scale %i', (firstSize, secondSize, scale) => {
    const encode = () =>
      encodeAnimationGif([new Canvas(firstSize), new Canvas(secondSize)], 100, scale);
    expect(encode).toThrow(RangeError);
    expect(encode).toThrow(
      `Animation frame 1 is ${secondSize}x${secondSize}; expected ${firstSize}x${firstSize}`,
    );
  });

  it.each([
    [16, 1],
    [16, 2],
    [32, 1],
    [32, 2],
    [64, 1],
    [64, 2],
  ] as const)('keeps %i frame dimensions at scale %i', (size, scale) => {
    const gif = encodeAnimationGif([new Canvas(size), new Canvas(size)], 100, scale);
    const dimensions = readGifDimensions(gif);
    const expected = size * scale;

    expect(dimensions.screen).toEqual([expected, expected]);
    expect(dimensions.frames).toEqual([
      [expected, expected],
      [expected, expected],
    ]);
  });

  it('keeps the existing empty-frame error', () => {
    expect(() => encodeAnimationGif([], 100, 1)).toThrow(
      new Error('encodeAnimationGif requires at least one frame'),
    );
  });

  it('does not create a destination for mixed-size frames', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pixoo-toolkit-gif-'));
    const path = join(directory, 'animation.gif');
    try {
      await expect(
        saveAnimationGif([new Canvas(16), new Canvas(64)], path, 100, 1),
      ).rejects.toThrow('Animation frame 1 is 64x64; expected 16x16');
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('does not overwrite a destination for mixed-size frames', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pixoo-toolkit-gif-'));
    const path = join(directory, 'animation.gif');
    const original = Buffer.from('existing file');
    try {
      await writeFile(path, original);
      await expect(
        saveAnimationGif([new Canvas(16), new Canvas(64)], path, 100, 2),
      ).rejects.toThrow('Animation frame 1 is 64x64; expected 16x16');
      expect(await readFile(path)).toEqual(original);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

describe('canvasToPng default RGB output', () => {
  it('encodes the recorded RGB byte stream', () => {
    const decoded = decodePng(canvasToPng(figureCanvas()));

    expect(decoded.colorType).toBe(2);
    expect(decoded.bitDepth).toBe(8);
    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);
    expect(decoded.channels).toBe(3);
    expect(decoded.raw.length).toBe(16 * (1 + 16 * 3));
    expect(decoded.filterBytes).toEqual(Array(16).fill(0));
    expect(sha256(decoded.raw)).toBe(
      'a92689b64a8468e64b1fb929703c9ad50e31b763514f8553864e5fbf165ddfe7',
    );
  });

  it('keeps flattening alpha over black', () => {
    const decoded = decodePng(canvasToPng(figureCanvas()));

    expect(decoded.pixel(0, 0)).toEqual([10, 20, 30]);
    expect(decoded.pixel(8, 4)).toEqual([255, 0, 0]);
    // Untouched pixels flatten to the unlit LED.
    expect(decoded.pixel(0, 15)).toEqual([0, 0, 0]);
  });

  it('renders a half-transparent white pixel identically to an opaque mid-grey', () => {
    const decoded = decodePng(canvasToPng(figureCanvas()));

    expect(decoded.pixel(3, 12)).toEqual([128, 128, 128]);
    expect(decoded.pixel(3, 12)).toEqual(decoded.pixel(4, 12));
  });

  it('encodes the recorded RGB byte stream at scale 4', () => {
    const decoded = decodePng(canvasToPng(figureCanvas(), 4));

    expect(decoded.colorType).toBe(2);
    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(64);
    expect(decoded.raw.length).toBe(64 * (1 + 64 * 3));
    expect(sha256(decoded.raw)).toBe(
      'e1075f2fa340061b641b09123345a3883a73235360fa67ce851afe7aa84aaa92',
    );
  });
});

describe('canvasToPng alpha mode', () => {
  it('encodes RGBA color type 6 with a 4-channel stride', () => {
    const decoded = decodePng(canvasToPng(figureCanvas(), 1, { alpha: true }));

    expect(decoded.colorType).toBe(6);
    expect(decoded.bitDepth).toBe(8);
    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);
    expect(decoded.raw.length).toBe(16 * (1 + 16 * 4));
    expect(decoded.filterBytes).toEqual(Array(16).fill(0));
  });

  it('preserves a half-transparent pixel through the round trip', () => {
    const decoded = decodePng(canvasToPng(figureCanvas(), 1, { alpha: true }));

    expect(decoded.pixel(3, 12)).toEqual([255, 255, 255, 128]);
    expect(decoded.pixel(4, 12)).toEqual([128, 128, 128, 255]);
    expect(decoded.pixel(0, 0)).toEqual([10, 20, 30, 255]);
    // Never-drawn pixels stay fully transparent rather than flattening to black.
    expect(decoded.pixel(0, 15)).toEqual([0, 0, 0, 0]);
  });

  it('distinguishes the pixels the default mode collapses', () => {
    const flattened = decodePng(canvasToPng(figureCanvas()));
    const rgba = decodePng(canvasToPng(figureCanvas(), 1, { alpha: true }));

    expect(flattened.pixel(3, 12)).toEqual(flattened.pixel(4, 12));
    expect(rgba.pixel(3, 12)).not.toEqual(rgba.pixel(4, 12));
  });

  it('upscales all four channels', () => {
    const decoded = decodePng(canvasToPng(figureCanvas(), 3, { alpha: true }));

    expect(decoded.colorType).toBe(6);
    expect(decoded.width).toBe(48);
    expect(decoded.height).toBe(48);
    expect(decoded.raw.length).toBe(48 * (1 + 48 * 4));
    for (const [x, y] of [
      [9, 36],
      [11, 38],
    ] as const) {
      expect(decoded.pixel(x, y)).toEqual([255, 255, 255, 128]);
    }
    expect(decoded.pixel(12, 36)).toEqual([128, 128, 128, 255]);
  });

  it('leaves the default output untouched when alpha is not requested', () => {
    const implicit = canvasToPng(figureCanvas());
    const explicit = canvasToPng(figureCanvas(), 1, { alpha: false });

    expect(Buffer.from(explicit).equals(Buffer.from(implicit))).toBe(true);
  });

  it('writes an RGBA file through savePng', async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, 'alpha.png');
      await savePng(figureCanvas(), path, 1, { alpha: true });
      const decoded = decodePng(new Uint8Array(await readFile(path)));

      expect(decoded.colorType).toBe(6);
      expect(decoded.pixel(3, 12)).toEqual([255, 255, 255, 128]);
    });
  });

  it('writes a flattened RGB file through savePng by default', async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, 'device.png');
      await savePng(figureCanvas(), path, 1);
      const decoded = decodePng(new Uint8Array(await readFile(path)));

      expect(decoded.colorType).toBe(2);
      expect(decoded.pixel(3, 12)).toEqual([128, 128, 128]);
    });
  });
});

describe('scale validation', () => {
  it.each(INVALID_SCALES)('canvasToPng rejects scale %s', (scale) => {
    const encode = () => canvasToPng(new Canvas(16), scale);
    expect(encode).toThrow(RangeError);
    expect(encode).toThrow('canvasToPng scale must be a positive integer');
  });

  it.each(INVALID_SCALES)('encodeAnimationGif rejects scale %s', (scale) => {
    const encode = () => encodeAnimationGif([new Canvas(16)], 100, scale);
    expect(encode).toThrow(RangeError);
    expect(encode).toThrow('encodeAnimationGif scale must be a positive integer');
  });

  it.each(INVALID_SCALES)('savePng rejects scale %s without writing a file', async (scale) => {
    await withTempDir(async (directory) => {
      const path = join(directory, 'frame.png');
      await expect(savePng(new Canvas(16), path, scale)).rejects.toThrow(RangeError);
      await expect(savePng(new Canvas(16), path, scale)).rejects.toThrow(
        'savePng scale must be a positive integer',
      );
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it.each(INVALID_SCALES)(
    'saveAnimationGif rejects scale %s without writing a file',
    async (scale) => {
      await withTempDir(async (directory) => {
        const path = join(directory, 'animation.gif');
        await expect(saveAnimationGif([new Canvas(16)], path, 100, scale)).rejects.toThrow(
          RangeError,
        );
        await expect(saveAnimationGif([new Canvas(16)], path, 100, scale)).rejects.toThrow(
          'saveAnimationGif scale must be a positive integer',
        );
        await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
      });
    },
  );

  it.each(INVALID_SCALES)(
    'saveAnimationPngs inherits the savePng guard for scale %s',
    async (scale) => {
      await withTempDir(async (directory) => {
        const basePath = join(directory, 'frame');
        await expect(
          saveAnimationPngs([new Canvas(16), new Canvas(16)], basePath, scale),
        ).rejects.toThrow('savePng scale must be a positive integer');
        expect(await readdir(directory)).toEqual([]);
      });
    },
  );

  it('does not overwrite an existing file when the scale is invalid', async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, 'frame.png');
      const original = Buffer.from('existing file');
      await writeFile(path, original);
      await expect(savePng(new Canvas(16), path, 0)).rejects.toThrow(RangeError);
      expect(await readFile(path)).toEqual(original);
    });
  });

  it.each([1, 3])('accepts scale %i', (scale) => {
    const decoded = decodePng(canvasToPng(new Canvas(16), scale));
    expect(decoded.width).toBe(16 * scale);
    expect(decoded.height).toBe(16 * scale);

    const gif = readGifDimensions(encodeAnimationGif([new Canvas(16)], 100, scale));
    expect(gif.screen).toEqual([16 * scale, 16 * scale]);
  });

  it('writes files for a valid scale', async () => {
    await withTempDir(async (directory) => {
      const path = join(directory, 'frame.png');
      await savePng(new Canvas(16), path, 2);
      expect(decodePng(new Uint8Array(await readFile(path))).width).toBe(32);

      const paths = await saveAnimationPngs(
        [new Canvas(16), new Canvas(16)],
        join(directory, 'anim'),
        2,
      );
      expect(paths).toHaveLength(2);
      for (const framePath of paths) {
        expect(decodePng(new Uint8Array(await readFile(framePath))).width).toBe(32);
      }
    });
  });
});
