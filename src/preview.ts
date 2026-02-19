import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { Canvas } from './canvas.js';

/**
 * Zero-dependency PNG encoder (only uses node:zlib for DEFLATE).
 *
 * Generates valid PNGs from raw RGB data. Supports optional
 * nearest-neighbor upscaling for crisp pixel-art previews.
 */

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

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

function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  writeU32BE(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  writeU32BE(chunk, 8 + data.length, crc32(crcInput));
  return chunk;
}

function encodePng(
  width: number,
  height: number,
  rgb: Uint8Array,
): Uint8Array {
  const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: filter byte (0 = None) prepended to each row
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    raw[rowOffset] = 0; // filter: None
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), rowOffset + 1);
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

/** Nearest-neighbor upscale. */
function upscale(rgb: Uint8Array, srcW: number, srcH: number, scale: number): Uint8Array {
  const dstW = srcW * scale;
  const dstH = srcH * scale;
  const out = new Uint8Array(dstW * dstH * 3);
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const si = (Math.floor(y / scale) * srcW + Math.floor(x / scale)) * 3;
      const di = (y * dstW + x) * 3;
      out[di] = rgb[si]!;
      out[di + 1] = rgb[si + 1]!;
      out[di + 2] = rgb[si + 2]!;
    }
  }
  return out;
}

/**
 * Encode a Canvas as a PNG buffer.
 * @param scale - Nearest-neighbor upscale factor (default: 1).
 */
export function canvasToPng(canvas: Canvas, scale = 1): Uint8Array {
  const w = canvas.width * scale;
  const h = canvas.height * scale;
  const rgb =
    scale === 1
      ? canvas.buffer
      : upscale(canvas.buffer, canvas.width, canvas.height, scale);
  return encodePng(w, h, rgb);
}

/**
 * Save a Canvas as a PNG file.
 * @param scale - Nearest-neighbor upscale factor (default: 8 → 512×512).
 */
export async function savePng(canvas: Canvas, path: string, scale = 8): Promise<void> {
  const png = canvasToPng(canvas, scale);
  await writeFile(path, png);
}

/**
 * Save animation frames as individual PNGs.
 * Files named `{basePath}_000.png`, `{basePath}_001.png`, etc.
 */
export async function saveAnimationPngs(
  frames: Canvas[],
  basePath: string,
  scale = 8,
): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    const framePath = `${basePath}_${String(i).padStart(3, '0')}.png`;
    await savePng(frames[i]!, framePath, scale);
    paths.push(framePath);
  }
  return paths;
}
