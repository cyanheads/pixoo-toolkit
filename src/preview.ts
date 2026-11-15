import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import * as gifencNs from 'gifenc';
import { assertAnimationFrameDimensions } from './animation.js';
import { Canvas } from './canvas.js';

// gifenc is CJS with no exports map. Node resolves the CJS build and wraps it as a
// default-only ESM import; Bun resolves the `module` field (ESM build) with named
// exports at top level. The default-unwrap below handles the Node CJS interop path
// (default is the module object) while the fallback covers Bun / bundler ESM paths
// (named exports live directly on the namespace, default is the GIFEncoder function).
const defaultExport = (gifencNs as typeof gifencNs & { default?: unknown }).default;
const gifenc =
  typeof defaultExport === 'object' && defaultExport !== null
    ? (defaultExport as typeof gifencNs)
    : gifencNs;
const { GIFEncoder, quantize, applyPalette } = gifenc;

/**
 * Zero-dependency PNG encoder (only uses node:zlib for DEFLATE).
 *
 * Generates valid PNGs from raw RGB data. Supports optional
 * nearest-neighbor upscaling for crisp pixel-art previews.
 */

const TEXT_ENCODER = new TextEncoder();
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = TEXT_ENCODER.encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  writeU32BE(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeU32BE(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** Pixel channel count: 3 = RGB (color type 2), 4 = RGBA (color type 6). */
type Channels = 3 | 4;

/**
 * Reject a scale that is not a positive integer before any allocation or
 * encoding. Zero and NaN would emit a 0×0 PNG, a negative factor a header
 * declaring ~4 billion pixels per side, and a fraction uneven
 * nearest-neighbor blocks — all written to disk without an error.
 */
function assertScale(method: string, scale: number): void {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new RangeError(`${method} scale must be a positive integer`);
  }
}

/** Longest side, in pixels, a default-scaled preview stays within. */
const PREVIEW_MAX_SIDE = 4096;

/**
 * Default preview scale: the largest integer from 1 to 8 that keeps the
 * scaled output within 4096 px per side — 8 for every canvas up to 512 px, 1
 * from 2049 px up. An unbounded 8 would allocate ~3.2 GB for a 4096×4096 canvas.
 */
function defaultScale(canvas: Canvas): number {
  const longest = Math.max(canvas.width, canvas.height);
  return Math.max(1, Math.min(8, Math.floor(PREVIEW_MAX_SIDE / longest)));
}

function encodePng(
  width: number,
  height: number,
  pixels: Uint8Array,
  channels: Channels,
): Uint8Array {
  // IHDR
  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // color type: RGBA / RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: filter byte (0 = None) prepended to each row
  const stride = width * channels;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + stride);
    raw[rowOffset] = 0; // filter: None
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), rowOffset + 1);
  }
  const compressed = deflateSync(raw);

  const chunks = [
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', new Uint8Array(0)),
  ];

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const png = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}

/** Nearest-neighbor upscale of a `channels`-byte-per-pixel buffer (1 = GIF palette indices). */
function upscale(
  pixels: Uint8Array,
  srcW: number,
  srcH: number,
  scale: number,
  channels: 1 | Channels,
): Uint8Array {
  const dstW = srcW * scale;
  const dstH = srcH * scale;
  const out = new Uint8Array(dstW * dstH * channels);
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const si = (Math.floor(y / scale) * srcW + Math.floor(x / scale)) * channels;
      const di = (y * dstW + x) * channels;
      for (let c = 0; c < channels; c++) {
        out[di + c] = pixels[si + c]!;
      }
    }
  }
  return out;
}

/** PNG export options. */
export interface PngOptions {
  /**
   * Encode RGBA (color type 6) straight from the canvas buffer, preserving
   * transparency. The default flattens alpha over black — what the panel
   * shows — so a half-transparent pixel dims toward the unlit LED.
   */
  alpha?: boolean;
}

/**
 * Encode a Canvas as a PNG buffer.
 * @param scale - Nearest-neighbor upscale factor, a positive integer (default: 1).
 * @throws {RangeError} When the scale is not a positive integer.
 */
export function canvasToPng(canvas: Canvas, scale = 1, options?: PngOptions): Uint8Array {
  assertScale('canvasToPng', scale);
  const channels: Channels = options?.alpha ? 4 : 3;
  const source = options?.alpha ? canvas.buffer : canvas.toRgbBuffer();
  const pixels =
    scale === 1 ? source : upscale(source, canvas.width, canvas.height, scale, channels);
  return encodePng(canvas.width * scale, canvas.height * scale, pixels, channels);
}

/**
 * Save a Canvas as a PNG file.
 * @param scale - Nearest-neighbor upscale factor, a positive integer (default:
 *   the largest from 1 to 8 that keeps the output within 4096 px per side — 8
 *   for any canvas up to 512 px, so a 64×64 panel saves at 512×512).
 * @throws {RangeError} When the scale is not a positive integer — nothing is written.
 */
export async function savePng(
  canvas: Canvas,
  path: string,
  scale = defaultScale(canvas),
  options?: PngOptions,
): Promise<void> {
  assertScale('savePng', scale);
  const png = canvasToPng(canvas, scale, options);
  await writeFile(path, png);
}

/**
 * Save animation frames as individual PNGs.
 * Files named `{basePath}_000.png`, `{basePath}_001.png`, etc.
 * @param scale - Forwarded to `savePng`, which validates it (default: `savePng`'s
 *   rule — the largest from 1 to 8 that keeps each frame within 4096 px per side).
 */
export async function saveAnimationPngs(
  frames: Canvas[],
  basePath: string,
  scale?: number,
): Promise<string[]> {
  const paths = frames.map((_, i) => `${basePath}_${String(i).padStart(3, '0')}.png`);
  await Promise.all(frames.map((frame, i) => savePng(frame, paths[i]!, scale)));
  return paths;
}

/** Convert 3-byte-per-pixel RGB to 4-byte-per-pixel RGBA (alpha = 255). */
function rgbToRgba(rgb: Uint8Array): Uint8Array {
  const pixelCount = rgb.length / 3;
  const rgba = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const si = i * 3;
    const di = i * 4;
    rgba[di] = rgb[si]!;
    rgba[di + 1] = rgb[si + 1]!;
    rgba[di + 2] = rgb[si + 2]!;
    rgba[di + 3] = 255;
  }
  return rgba;
}

/** GIF stores its logical screen and frame dimensions as unsigned 16-bit fields. */
const GIF_MAX_DIMENSION = 0xffff;

/** Longest frame delay a GIF holds: a 16-bit count of centiseconds. */
const GIF_MAX_DELAY_MS = 0xffff * 10;

/**
 * Reject a frame delay or palette size the GIF format cannot hold. A negative
 * delay wraps to 655 s in the 16-bit field and NaN encodes as 0; more than
 * 256 colors overflows the color table and corrupts the file.
 */
function assertGifOptions(method: string, speed: number, maxColors: number): void {
  if (!(speed >= 0 && speed <= GIF_MAX_DELAY_MS)) {
    throw new RangeError(
      `${method} speed must be a delay from 0 to ${GIF_MAX_DELAY_MS} ms; got ${speed}`,
    );
  }
  if (!Number.isInteger(maxColors) || maxColors < 1 || maxColors > 256) {
    throw new RangeError(`${method} maxColors must be an integer from 1 to 256; got ${maxColors}`);
  }
}

/**
 * Encode animation frames as an animated GIF buffer. Each frame is quantized
 * to its own palette at source resolution, then upscaled.
 * @param speed - Delay between frames in milliseconds, 0 to 655350 (GIF
 *   stores it rounded to centiseconds).
 * @param scale - Nearest-neighbor upscale factor, a positive integer (default:
 *   the largest from 1 to 8 that keeps the output within 4096 px per side — 8
 *   for any frame up to 512 px, so 64×64 frames encode at 512×512).
 * @param maxColors - Max palette colors per frame, an integer from 1 to 256 (default: 256).
 * @throws {RangeError} When the scale is not a positive integer, the speed or
 *   maxColors is out of range, or the scaled frame exceeds 65535 pixels on
 *   either side.
 */
export function encodeAnimationGif(
  frames: Canvas[],
  speed: number,
  scale?: number,
  maxColors = 256,
): Uint8Array {
  if (scale !== undefined) assertScale('encodeAnimationGif', scale);
  assertGifOptions('encodeAnimationGif', speed, maxColors);
  const first = frames[0];
  if (!first) throw new Error('encodeAnimationGif requires at least one frame');
  assertAnimationFrameDimensions(frames);

  scale ??= defaultScale(first);
  const w = first.width * scale;
  const h = first.height * scale;
  if (w > GIF_MAX_DIMENSION || h > GIF_MAX_DIMENSION) {
    throw new RangeError(
      `GIF dimensions are 16-bit: ${first.width}x${first.height} frames at scale ${scale} would be ${w}x${h}; the limit is ${GIF_MAX_DIMENSION} per side`,
    );
  }
  const gif = GIFEncoder();

  for (const frame of frames) {
    const rgba = rgbToRgba(frame.toRgbBuffer());
    const palette = quantize(rgba, maxColors);
    const index = applyPalette(rgba, palette);
    const scaled = scale === 1 ? index : upscale(index, frame.width, frame.height, scale, 1);
    gif.writeFrame(scaled, w, h, { palette, delay: speed });
  }

  gif.finish();
  return gif.bytes();
}

/**
 * Save animation frames as an animated GIF file.
 * @param speed - Delay between frames in milliseconds, 0 to 655350.
 * @param scale - Nearest-neighbor upscale factor, a positive integer (default:
 *   the largest from 1 to 8 that keeps the output within 4096 px per side — 8
 *   for any frame up to 512 px, so 64×64 frames save at 512×512).
 * @param maxColors - Max palette colors per frame, an integer from 1 to 256 (default: 256).
 * @throws {RangeError} When the scale is not a positive integer, the speed or
 *   maxColors is out of range, or the scaled frame exceeds 65535 pixels on
 *   either side — nothing is written.
 */
export async function saveAnimationGif(
  frames: Canvas[],
  path: string,
  speed: number,
  scale?: number,
  maxColors = 256,
): Promise<void> {
  if (scale !== undefined) assertScale('saveAnimationGif', scale);
  assertGifOptions('saveAnimationGif', speed, maxColors);
  const gif = encodeAnimationGif(frames, speed, scale, maxColors);
  await writeFile(path, gif);
}
