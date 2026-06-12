import { type RGB, type ColorLike, resolveColor, lerpColor } from './color.js';

/** Supported Pixoo display sizes. */
export type PixooSize = 16 | 32 | 64;

/** Default display size (Pixoo-64). */
export const DEFAULT_SIZE: PixooSize = 64;

const RGBA_BUFFER_SIZES = new Map<number, PixooSize>([
  [16 * 16 * 4, 16],
  [32 * 32 * 4, 32],
  [64 * 64 * 4, 64],
]);

const RGB_BUFFER_SIZES = new Map<number, PixooSize>([
  [16 * 16 * 3, 16],
  [32 * 32 * 3, 32],
  [64 * 64 * 3, 64],
]);

/**
 * Square RGBA pixel buffer with drawing primitives.
 *
 * The working buffer stores straight (non-premultiplied) RGBA — width ×
 * height × 4 bytes. A fresh canvas is fully transparent; drawing primitives
 * write opaque pixels (alpha 255) unless given an explicit alpha. Exports
 * flatten alpha over black at the edge (`toRgbBuffer`, `toBase64`), so a
 * partially transparent pixel dims toward the unlit LED.
 *
 * Coordinates: (0,0) = top-left, (size-1, size-1) = bottom-right.
 * All drawing methods mutate in-place and return `this` for chaining.
 */
export class Canvas {
  /** Raw RGBA byte buffer — width × height × 4 bytes, straight alpha. */
  readonly buffer: Uint8Array;
  readonly width: number;
  readonly height: number;

  /**
   * @param sizeOrSource - A display size (16/32/64, default 64), an RGBA
   *   buffer (width × height × 4), or an RGB buffer (width × height × 3,
   *   upconverted to fully opaque RGBA).
   */
  constructor(sizeOrSource?: PixooSize | Uint8Array) {
    if (sizeOrSource instanceof Uint8Array) {
      const rgbaSize = RGBA_BUFFER_SIZES.get(sizeOrSource.length);
      const rgbSize = RGB_BUFFER_SIZES.get(sizeOrSource.length);
      if (rgbaSize) {
        this.width = rgbaSize;
        this.height = rgbaSize;
        this.buffer = new Uint8Array(sizeOrSource);
      } else if (rgbSize) {
        this.width = rgbSize;
        this.height = rgbSize;
        this.buffer = new Uint8Array(rgbSize * rgbSize * 4);
        for (let i = 0, p = 0; i < sizeOrSource.length; i += 3, p += 4) {
          this.buffer[p] = sizeOrSource[i]!;
          this.buffer[p + 1] = sizeOrSource[i + 1]!;
          this.buffer[p + 2] = sizeOrSource[i + 2]!;
          this.buffer[p + 3] = 255;
        }
      } else {
        const valid = [...RGBA_BUFFER_SIZES.keys(), ...RGB_BUFFER_SIZES.keys()].join(', ');
        throw new Error(`Invalid buffer length ${sizeOrSource.length}; expected one of: ${valid}`);
      }
    } else {
      const size = sizeOrSource ?? DEFAULT_SIZE;
      this.width = size;
      this.height = size;
      this.buffer = new Uint8Array(size * size * 4);
    }
  }

  /** Clone this canvas into a new instance. */
  clone(): Canvas {
    return new Canvas(this.buffer);
  }

  // --- Pixel access ---

  private idx(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Set a single pixel. Out-of-bounds calls are silently ignored.
   * @param alpha - Stored alpha byte, 0–255 (default: 255, fully opaque).
   */
  setPixel(x: number, y: number, color: ColorLike, alpha = 255): this {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return this;
    const [r, g, b] = resolveColor(color);
    const i = this.idx(ix, iy);
    this.buffer[i] = r;
    this.buffer[i + 1] = g;
    this.buffer[i + 2] = b;
    this.buffer[i + 3] = alpha <= 0 ? 0 : alpha >= 255 ? 255 : Math.round(alpha);
    return this;
  }

  /**
   * Get a pixel's stored RGB (ignoring alpha — see `getPixelRgba`).
   * Returns [0,0,0] for out-of-bounds.
   */
  getPixel(x: number, y: number): RGB {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return [0, 0, 0];
    const i = this.idx(ix, iy);
    return [this.buffer[i]!, this.buffer[i + 1]!, this.buffer[i + 2]!];
  }

  /** Get a pixel's stored RGBA. Returns [0,0,0,0] for out-of-bounds. */
  getPixelRgba(x: number, y: number): readonly [number, number, number, number] {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return [0, 0, 0, 0];
    const i = this.idx(ix, iy);
    return [this.buffer[i]!, this.buffer[i + 1]!, this.buffer[i + 2]!, this.buffer[i + 3]!];
  }

  // --- Fill operations ---

  /**
   * Fill the entire canvas with an opaque color — or erase to fully
   * transparent when called with no argument.
   */
  clear(color?: ColorLike): this {
    if (color === undefined) {
      this.buffer.fill(0);
      return this;
    }
    const [r, g, b] = resolveColor(color);
    for (let i = 0; i < this.buffer.length; i += 4) {
      this.buffer[i] = r;
      this.buffer[i + 1] = g;
      this.buffer[i + 2] = b;
      this.buffer[i + 3] = 255;
    }
    return this;
  }

  /** Fill a rectangular region. */
  fillRect(x: number, y: number, w: number, h: number, color: ColorLike): this {
    const [r, g, b] = resolveColor(color);
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.floor(x + w));
    const y1 = Math.min(this.height, Math.floor(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = this.idx(px, py);
        this.buffer[i] = r;
        this.buffer[i + 1] = g;
        this.buffer[i + 2] = b;
        this.buffer[i + 3] = 255;
      }
    }
    return this;
  }

  /** Fill a circle (solid). */
  fillCircle(cx: number, cy: number, radius: number, color: ColorLike): this {
    const [r, g, b] = resolveColor(color);
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx,
          dy = py - cy;
        if (dx * dx + dy * dy <= r2) {
          const i = this.idx(px, py);
          this.buffer[i] = r;
          this.buffer[i + 1] = g;
          this.buffer[i + 2] = b;
          this.buffer[i + 3] = 255;
        }
      }
    }
    return this;
  }

  // --- Stroke shapes ---

  /** Draw a 1px rectangle outline. */
  drawRect(x: number, y: number, w: number, h: number, color: ColorLike): this {
    this.drawLineH(x, y, w, color);
    this.drawLineH(x, y + h - 1, w, color);
    this.drawLineV(x, y, h, color);
    this.drawLineV(x + w - 1, y, h, color);
    return this;
  }

  /** Draw a circle outline (Bresenham's midpoint algorithm). */
  drawCircle(cx: number, cy: number, radius: number, color: ColorLike): this {
    const c = resolveColor(color);
    let x = radius,
      y = 0,
      d = 1 - radius;
    while (x >= y) {
      this.setPixel(cx + x, cy + y, c);
      this.setPixel(cx - x, cy + y, c);
      this.setPixel(cx + x, cy - y, c);
      this.setPixel(cx - x, cy - y, c);
      this.setPixel(cx + y, cy + x, c);
      this.setPixel(cx - y, cy + x, c);
      this.setPixel(cx + y, cy - x, c);
      this.setPixel(cx - y, cy - x, c);
      y++;
      if (d <= 0) {
        d += 2 * y + 1;
      } else {
        x--;
        d += 2 * (y - x) + 1;
      }
    }
    return this;
  }

  /** Draw an arbitrary line (Bresenham). */
  drawLine(x0: number, y0: number, x1: number, y1: number, color: ColorLike): this {
    x0 = Math.floor(x0);
    y0 = Math.floor(y0);
    x1 = Math.floor(x1);
    y1 = Math.floor(y1);
    const c = resolveColor(color);
    const dx = Math.abs(x1 - x0),
      dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let cx = x0,
      cy = y0;
    for (;;) {
      this.setPixel(cx, cy, c);
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        cx += sx;
      }
      if (e2 <= dx) {
        err += dx;
        cy += sy;
      }
    }
    return this;
  }

  /** Horizontal line (fast path). */
  drawLineH(x: number, y: number, length: number, color: ColorLike): this {
    const [r, g, b] = resolveColor(color);
    const iy = Math.floor(y);
    if (iy < 0 || iy >= this.height) return this;
    const x0 = Math.max(0, Math.floor(x));
    const x1 = Math.min(this.width, Math.floor(x + length));
    for (let px = x0; px < x1; px++) {
      const i = this.idx(px, iy);
      this.buffer[i] = r;
      this.buffer[i + 1] = g;
      this.buffer[i + 2] = b;
      this.buffer[i + 3] = 255;
    }
    return this;
  }

  /** Vertical line (fast path). */
  drawLineV(x: number, y: number, length: number, color: ColorLike): this {
    const [r, g, b] = resolveColor(color);
    const ix = Math.floor(x);
    if (ix < 0 || ix >= this.width) return this;
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(this.height, Math.floor(y + length));
    for (let py = y0; py < y1; py++) {
      const i = this.idx(ix, py);
      this.buffer[i] = r;
      this.buffer[i + 1] = g;
      this.buffer[i + 2] = b;
      this.buffer[i + 3] = 255;
    }
    return this;
  }

  /** Draw a triangle outline. */
  drawTriangle(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: ColorLike,
  ): this {
    this.drawLine(x0, y0, x1, y1, color);
    this.drawLine(x1, y1, x2, y2, color);
    this.drawLine(x2, y2, x0, y0, color);
    return this;
  }

  /** Fill a solid triangle (scanline rasterization). */
  fillTriangle(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: ColorLike,
  ): this {
    const [r, g, b] = resolveColor(color);
    const w = this.width;
    const h = this.height;
    // Sort vertices by y-coordinate ascending
    let ax = x0,
      ay = y0,
      bx = x1,
      by = y1,
      cx = x2,
      cy = y2;
    if (ay > by) {
      [ax, ay, bx, by] = [bx, by, ax, ay];
    }
    if (ay > cy) {
      [ax, ay, cx, cy] = [cx, cy, ax, ay];
    }
    if (by > cy) {
      [bx, by, cx, cy] = [cx, cy, bx, by];
    }

    const scanline = (
      ya: number,
      yb: number,
      xLeft: (y: number) => number,
      xRight: (y: number) => number,
    ) => {
      const yStart = Math.max(0, Math.ceil(ya));
      const yEnd = Math.min(h - 1, Math.floor(yb));
      for (let y = yStart; y <= yEnd; y++) {
        const xl = Math.max(0, Math.ceil(xLeft(y)));
        const xr = Math.min(w - 1, Math.floor(xRight(y)));
        for (let x = xl; x <= xr; x++) {
          const i = (y * w + x) * 4;
          this.buffer[i] = r;
          this.buffer[i + 1] = g;
          this.buffer[i + 2] = b;
          this.buffer[i + 3] = 255;
        }
      }
    };

    const lerp = (y: number, ya: number, xa: number, yb: number, xb: number) =>
      ya === yb ? xa : xa + ((y - ya) / (yb - ya)) * (xb - xa);

    // Upper half: ay -> by
    if (by > ay) {
      scanline(
        ay,
        by - 1,
        (y) => {
          const e1 = lerp(y, ay, ax, by, bx);
          const e2 = lerp(y, ay, ax, cy, cx);
          return Math.min(e1, e2);
        },
        (y) => {
          const e1 = lerp(y, ay, ax, by, bx);
          const e2 = lerp(y, ay, ax, cy, cx);
          return Math.max(e1, e2);
        },
      );
    }
    // Lower half: by -> cy
    if (cy > by) {
      scanline(
        by,
        cy,
        (y) => {
          const e1 = lerp(y, by, bx, cy, cx);
          const e2 = lerp(y, ay, ax, cy, cx);
          return Math.min(e1, e2);
        },
        (y) => {
          const e1 = lerp(y, by, bx, cy, cx);
          const e2 = lerp(y, ay, ax, cy, cx);
          return Math.max(e1, e2);
        },
      );
    }
    return this;
  }

  // --- Compositing ---

  /**
   * Source-over composite a color onto a pixel. alpha: 0–1.
   * The destination's stored alpha participates (compositing onto a
   * transparent pixel stores the color at the given alpha).
   */
  blendPixel(x: number, y: number, color: ColorLike, alpha: number): this {
    if (alpha <= 0) return this;
    if (alpha >= 1) return this.setPixel(x, y, color);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return this;
    const [sr, sg, sb] = resolveColor(color);
    const i = this.idx(ix, iy);
    const sa = alpha;
    const da = this.buffer[i + 3]! / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) return this;
    const blend = (s: number, d: number): number => Math.round((s * sa + d * da * (1 - sa)) / outA);
    this.buffer[i] = blend(sr, this.buffer[i]!);
    this.buffer[i + 1] = blend(sg, this.buffer[i + 1]!);
    this.buffer[i + 2] = blend(sb, this.buffer[i + 2]!);
    this.buffer[i + 3] = Math.round(outA * 255);
    return this;
  }

  /**
   * Composite another canvas on top at an offset using source-over alpha
   * blending. Undrawn (fully transparent) source pixels leave the
   * destination untouched; drawn pixels — including true black — land.
   */
  blit(
    source: Canvas,
    dx = 0,
    dy = 0,
    opts?: {
      /**
       * @deprecated Color key from the RGB-buffer era: source pixels
       * matching this RGB are skipped. `null` is equivalent to omitting
       * the option. Real transparency now comes from source alpha.
       */
      transparentColor?: RGB | null;
    },
  ): this {
    const key = opts?.transparentColor ?? null;
    const src = source.buffer;
    // Clamp iteration to the overlapping region
    const syStart = Math.max(0, -dy);
    const syEnd = Math.min(source.height, this.height - dy);
    const sxStart = Math.max(0, -dx);
    const sxEnd = Math.min(source.width, this.width - dx);
    for (let sy = syStart; sy < syEnd; sy++) {
      for (let sx = sxStart; sx < sxEnd; sx++) {
        const si = (sy * source.width + sx) * 4;
        const sa = src[si + 3]!;
        if (sa === 0) continue;
        const r = src[si]!;
        const g = src[si + 1]!;
        const b = src[si + 2]!;
        if (key && r === key[0] && g === key[1] && b === key[2]) continue;
        if (sa === 255) {
          const di = ((dy + sy) * this.width + (dx + sx)) * 4;
          this.buffer[di] = r;
          this.buffer[di + 1] = g;
          this.buffer[di + 2] = b;
          this.buffer[di + 3] = 255;
        } else {
          this.blendPixel(dx + sx, dy + sy, [r, g, b], sa / 255);
        }
      }
    }
    return this;
  }

  // --- Gradients ---

  /** Fill the canvas with a vertical gradient. */
  gradientV(topColor: ColorLike, bottomColor: ColorLike): this {
    const top = resolveColor(topColor);
    const bottom = resolveColor(bottomColor);
    for (let y = 0; y < this.height; y++) {
      const t = y / (this.height - 1);
      const c = lerpColor(top, bottom, t);
      this.drawLineH(0, y, this.width, c);
    }
    return this;
  }

  /** Fill the canvas with a horizontal gradient. */
  gradientH(leftColor: ColorLike, rightColor: ColorLike): this {
    const left = resolveColor(leftColor);
    const right = resolveColor(rightColor);
    for (let x = 0; x < this.width; x++) {
      const t = x / (this.width - 1);
      const c = lerpColor(left, right, t);
      this.drawLineV(x, 0, this.height, c);
    }
    return this;
  }

  /** Fill the canvas with a radial gradient from center. */
  gradientRadial(
    cx: number,
    cy: number,
    radius: number,
    innerColor: ColorLike,
    outerColor: ColorLike,
  ): this {
    const inner = resolveColor(innerColor);
    const outer = resolveColor(outerColor);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const dx = x - cx,
          dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const t = Math.min(1, dist / radius);
        const c = lerpColor(inner, outer, t);
        this.setPixel(x, y, c);
      }
    }
    return this;
  }

  // --- Transform ---

  /** Shift all pixels by dx, dy. Vacated pixels become transparent. */
  scroll(dx: number, dy: number): this {
    const copy = new Uint8Array(this.buffer);
    this.clear();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const nx = x + dx,
          ny = y + dy;
        if (this.inBounds(nx, ny)) {
          const si = (y * this.width + x) * 4;
          const di = (ny * this.width + nx) * 4;
          this.buffer[di] = copy[si]!;
          this.buffer[di + 1] = copy[si + 1]!;
          this.buffer[di + 2] = copy[si + 2]!;
          this.buffer[di + 3] = copy[si + 3]!;
        }
      }
    }
    return this;
  }

  // --- Export ---

  /**
   * Flatten to a width × height × 3 RGB copy, compositing alpha over black
   * (an unlit LED). This is the device wire layout.
   */
  toRgbBuffer(): Uint8Array {
    const out = new Uint8Array(this.width * this.height * 3);
    for (let i = 0, p = 0; p < out.length; i += 4, p += 3) {
      const a = this.buffer[i + 3]!;
      if (a === 255) {
        out[p] = this.buffer[i]!;
        out[p + 1] = this.buffer[i + 1]!;
        out[p + 2] = this.buffer[i + 2]!;
      } else if (a > 0) {
        out[p] = Math.round((this.buffer[i]! * a) / 255);
        out[p + 1] = Math.round((this.buffer[i + 1]! * a) / 255);
        out[p + 2] = Math.round((this.buffer[i + 2]! * a) / 255);
      }
    }
    return out;
  }

  /** Base64-encode the flattened RGB pixel data (for Draw/SendHttpGif). */
  toBase64(): string {
    return Buffer.from(this.toRgbBuffer()).toString('base64');
  }
}
