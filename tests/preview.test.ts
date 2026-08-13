import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { canvasToPng, encodeAnimationGif, saveAnimationGif } from '../src/preview.js';
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
