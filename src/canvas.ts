import { type RGB, type ColorLike, resolveColor, lerpColor } from './color.js';

export const DISPLAY_SIZE = 64;
const PIXEL_COUNT = DISPLAY_SIZE * DISPLAY_SIZE;
const BUFFER_SIZE = PIXEL_COUNT * 3;

/**
 * 64×64 RGB pixel buffer with drawing primitives.
 *
 * Coordinates: (0,0) = top-left, (63,63) = bottom-right.
 * All drawing methods mutate in-place and return `this` for chaining.
 */
export class Canvas {
  /** Raw RGB byte buffer — 64×64×3 = 12,288 bytes. */
  readonly buffer: Uint8Array;
  readonly width = DISPLAY_SIZE;
  readonly height = DISPLAY_SIZE;

  constructor(source?: Uint8Array) {
    if (source && source.length !== BUFFER_SIZE) {
      throw new Error(`Canvas buffer must be exactly ${BUFFER_SIZE} bytes, got ${source.length}`);
    }
    this.buffer = source ? new Uint8Array(source) : new Uint8Array(BUFFER_SIZE);
  }

  /** Clone this canvas into a new instance. */
  clone(): Canvas {
    return new Canvas(this.buffer);
  }

  // --- Pixel access ---

  private idx(x: number, y: number): number {
    return (y * DISPLAY_SIZE + x) * 3;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < DISPLAY_SIZE && y >= 0 && y < DISPLAY_SIZE;
  }

  /** Set a single pixel. Out-of-bounds calls are silently ignored. */
  setPixel(x: number, y: number, color: ColorLike): this {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return this;
    const [r, g, b] = resolveColor(color);
    const i = this.idx(ix, iy);
    this.buffer[i] = r;
    this.buffer[i + 1] = g;
    this.buffer[i + 2] = b;
    return this;
  }

  /** Get a pixel's color. Returns [0,0,0] for out-of-bounds. */
  getPixel(x: number, y: number): RGB {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return [0, 0, 0];
    const i = this.idx(ix, iy);
    return [this.buffer[i]!, this.buffer[i + 1]!, this.buffer[i + 2]!];
  }

  // --- Fill operations ---

  /** Fill entire canvas with a color. */
  clear(color: ColorLike = [0, 0, 0]): this {
    const [r, g, b] = resolveColor(color);
    if (r === 0 && g === 0 && b === 0) {
      this.buffer.fill(0);
    } else {
      for (let i = 0; i < BUFFER_SIZE; i += 3) {
        this.buffer[i] = r;
        this.buffer[i + 1] = g;
        this.buffer[i + 2] = b;
      }
    }
    return this;
  }

  /** Fill a rectangular region. */
  fillRect(x: number, y: number, w: number, h: number, color: ColorLike): this {
    const [r, g, b] = resolveColor(color);
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(DISPLAY_SIZE, Math.floor(x + w));
    const y1 = Math.min(DISPLAY_SIZE, Math.floor(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = this.idx(px, py);
        this.buffer[i] = r;
        this.buffer[i + 1] = g;
        this.buffer[i + 2] = b;
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
    const x1 = Math.min(DISPLAY_SIZE - 1, Math.ceil(cx + radius));
    const y1 = Math.min(DISPLAY_SIZE - 1, Math.ceil(cy + radius));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx,
          dy = py - cy;
        if (dx * dx + dy * dy <= r2) {
          const i = this.idx(px, py);
          this.buffer[i] = r;
          this.buffer[i + 1] = g;
          this.buffer[i + 2] = b;
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
    if (iy < 0 || iy >= DISPLAY_SIZE) return this;
    const x0 = Math.max(0, Math.floor(x));
    const x1 = Math.min(DISPLAY_SIZE, Math.floor(x + length));
    for (let px = x0; px < x1; px++) {
      const i = this.idx(px, iy);
      this.buffer[i] = r;
      this.buffer[i + 1] = g;
      this.buffer[i + 2] = b;
    }
    return this;
  }

  /** Vertical line (fast path). */
  drawLineV(x: number, y: number, length: number, color: ColorLike): this {
    const [r, g, b] = resolveColor(color);
    const ix = Math.floor(x);
    if (ix < 0 || ix >= DISPLAY_SIZE) return this;
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(DISPLAY_SIZE, Math.floor(y + length));
    for (let py = y0; py < y1; py++) {
      const i = this.idx(ix, py);
      this.buffer[i] = r;
      this.buffer[i + 1] = g;
      this.buffer[i + 2] = b;
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
      const yEnd = Math.min(DISPLAY_SIZE - 1, Math.floor(yb));
      for (let y = yStart; y <= yEnd; y++) {
        const xl = Math.max(0, Math.ceil(xLeft(y)));
        const xr = Math.min(DISPLAY_SIZE - 1, Math.floor(xRight(y)));
        for (let x = xl; x <= xr; x++) {
          const i = (y * DISPLAY_SIZE + x) * 3;
          this.buffer[i] = r;
          this.buffer[i + 1] = g;
          this.buffer[i + 2] = b;
        }
      }
    };

    const lerp = (y: number, ya: number, xa: number, yb: number, xb: number) =>
      ya === yb ? xa : xa + ((y - ya) / (yb - ya)) * (xb - xa);

    // Upper half: ay → by
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
    // Lower half: by → cy
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

  /** Alpha-blend a color onto a pixel. alpha: 0–1. */
  blendPixel(x: number, y: number, color: ColorLike, alpha: number): this {
    if (alpha <= 0) return this;
    if (alpha >= 1) return this.setPixel(x, y, color);
    const bg = this.getPixel(Math.floor(x), Math.floor(y));
    const fg = resolveColor(color);
    return this.setPixel(x, y, lerpColor(bg, fg, alpha));
  }

  /**
   * Composite another canvas on top at an offset.
   * By default, black pixels ([0,0,0]) are treated as transparent and skipped.
   * Pass `transparentColor: null` to copy all pixels, or a custom RGB to use as the transparent key.
   */
  blit(source: Canvas, dx = 0, dy = 0, opts?: { transparentColor?: RGB | null }): this {
    const skip =
      opts?.transparentColor === undefined ? ([0, 0, 0] as const) : opts.transparentColor;
    const src = source.buffer;
    const dst = this.buffer;
    // Clamp iteration to the overlapping region
    const syStart = Math.max(0, -dy);
    const syEnd = Math.min(source.height, DISPLAY_SIZE - dy);
    const sxStart = Math.max(0, -dx);
    const sxEnd = Math.min(source.width, DISPLAY_SIZE - dx);
    for (let sy = syStart; sy < syEnd; sy++) {
      for (let sx = sxStart; sx < sxEnd; sx++) {
        const si = (sy * DISPLAY_SIZE + sx) * 3;
        const r = src[si]!;
        const g = src[si + 1]!;
        const b = src[si + 2]!;
        if (skip && r === skip[0] && g === skip[1] && b === skip[2]) continue;
        const di = ((dy + sy) * DISPLAY_SIZE + (dx + sx)) * 3;
        dst[di] = r;
        dst[di + 1] = g;
        dst[di + 2] = b;
      }
    }
    return this;
  }

  // --- Gradients ---

  /** Fill the canvas with a vertical gradient. */
  gradientV(topColor: ColorLike, bottomColor: ColorLike): this {
    const top = resolveColor(topColor);
    const bottom = resolveColor(bottomColor);
    for (let y = 0; y < DISPLAY_SIZE; y++) {
      const t = y / (DISPLAY_SIZE - 1);
      const c = lerpColor(top, bottom, t);
      this.drawLineH(0, y, DISPLAY_SIZE, c);
    }
    return this;
  }

  /** Fill the canvas with a horizontal gradient. */
  gradientH(leftColor: ColorLike, rightColor: ColorLike): this {
    const left = resolveColor(leftColor);
    const right = resolveColor(rightColor);
    for (let x = 0; x < DISPLAY_SIZE; x++) {
      const t = x / (DISPLAY_SIZE - 1);
      const c = lerpColor(left, right, t);
      this.drawLineV(x, 0, DISPLAY_SIZE, c);
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
    for (let y = 0; y < DISPLAY_SIZE; y++) {
      for (let x = 0; x < DISPLAY_SIZE; x++) {
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

  /** Shift all pixels by dx, dy. Vacated pixels become black. */
  scroll(dx: number, dy: number): this {
    const copy = new Uint8Array(this.buffer);
    this.clear();
    for (let y = 0; y < DISPLAY_SIZE; y++) {
      for (let x = 0; x < DISPLAY_SIZE; x++) {
        const nx = x + dx,
          ny = y + dy;
        if (this.inBounds(nx, ny)) {
          const si = (y * DISPLAY_SIZE + x) * 3;
          const di = (ny * DISPLAY_SIZE + nx) * 3;
          this.buffer[di] = copy[si]!;
          this.buffer[di + 1] = copy[si + 1]!;
          this.buffer[di + 2] = copy[si + 2]!;
        }
      }
    }
    return this;
  }

  /** Base64-encode the raw pixel buffer (for Draw/SendHttpGif). */
  toBase64(): string {
    return Buffer.from(this.buffer).toString('base64');
  }
}
