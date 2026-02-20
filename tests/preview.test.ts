import { describe, it, expect } from 'vitest';
import { canvasToPng } from '../src/preview.js';
import { Canvas } from '../src/canvas.js';

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
