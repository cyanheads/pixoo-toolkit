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

/** Largest width or height a canvas accepts — a 4096×4096 buffer is 64 MiB. */
const MAX_DIMENSION = 4096;

/** Bytes passed to one `String.fromCharCode` call, well under engine argument limits. */
const BINARY_STRING_CHUNK = 0x8000;

function assertDimension(name: 'width' | 'height', value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) {
    throw new RangeError(
      `Canvas ${name} must be an integer from 1 to ${MAX_DIMENSION}; got ${value}`,
    );
  }
}

/**
 * Reject non-finite geometry before it reaches bounds arithmetic, where NaN
 * would collapse a shape into a silent no-op or a partial figure.
 */
function assertFinite(values: readonly number[], message: string): void {
  if (!values.every(Number.isFinite)) {
    throw new RangeError(message);
  }
}

/**
 * Reject a NaN alpha, which would store an invisible pixel or erase the
 * destination. `±Infinity` still clamps like any out-of-range alpha.
 */
function assertAlphaNotNaN(alpha: number, method: 'setPixel' | 'blendPixel'): void {
  if (Number.isNaN(alpha)) throw new RangeError(`${method} alpha must not be NaN`);
}

const BLEND_MODES = ['normal', 'add', 'screen', 'multiply'] as const;

/**
 * How `blit` combines a source pixel with the destination. `normal` is
 * source-over. `add` sums the light of both (Porter-Duff plus — Canvas 2D
 * `lighter`), clamped. `screen` and `multiply` are the W3C Compositing 1
 * separable blends, composited source-over.
 */
export type BlendMode = (typeof BLEND_MODES)[number];

/** Options for `Canvas.blit`. */
export interface BlitOptions {
  /** How source pixels combine with the destination (default `'normal'`). */
  mode?: BlendMode;
  /**
   * @deprecated Color key from the RGB-buffer era: source pixels matching
   * this RGB are skipped, in every mode. `null` is equivalent to omitting the
   * option. Real transparency now comes from source alpha.
   */
  transparentColor?: RGB | null;
}

/** Options for `fillRect`, `fillCircle`, and `fillTriangle`. */
export interface FillOptions {
  /**
   * Opacity from 0 to 1 (default 1), composited source-over onto the canvas —
   * `blendPixel`'s scale, not `setPixel`'s 0–255 byte.
   */
  alpha?: number;
}

/** Options for `drawLine` and `drawCircle`; `drawRect` takes all but `antialias`. */
export interface StrokeOptions extends FillOptions {
  /**
   * Stroke thickness in whole pixels (default 1). `drawRect` grows it inward,
   * inside the region `fillRect` fills; `drawLine` and `drawCircle` center it
   * on the path.
   */
  width?: number;
  /**
   * Shade each pixel by how much of it the stroke covers, from the exact
   * coordinates (default false: a pixel is lit or not — a line from its
   * floored endpoints, as the 1px line uses; a circle from its exact center
   * and radius).
   */
  antialias?: boolean;
}

/**
 * The `alpha` option, 1 when omitted.
 * @throws {RangeError} Unless it is a number from 0 to 1.
 */
function optionAlpha(method: string, opts: FillOptions | undefined): number {
  const alpha = opts?.alpha ?? 1;
  if (typeof alpha !== 'number' || !(alpha >= 0 && alpha <= 1)) {
    throw new RangeError(`${method} alpha must be a number from 0 to 1; got ${alpha}`);
  }
  return alpha;
}

/**
 * The `width` option, 1 when omitted.
 * @throws {RangeError} Unless it is a positive integer.
 */
function optionWidth(method: string, opts: StrokeOptions | undefined): number {
  const width = opts?.width ?? 1;
  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError(`${method} width must be a positive integer; got ${width}`);
  }
  return width;
}

/**
 * Composite straight-alpha source bytes onto the pixel at buffer index `i` in
 * a blend mode other than `normal`, on 0–1 floats rounded once to bytes.
 * `sa` is the source alpha byte, above 0.
 */
function blendInto(
  buf: Uint8Array,
  i: number,
  src: RGB,
  sa: number,
  mode: Exclude<BlendMode, 'normal'>,
): void {
  const as = sa / 255;
  const ab = buf[i + 3]! / 255;
  const ao = mode === 'add' ? Math.min(1, as + ab) : as + ab * (1 - as);
  for (let ch = 0; ch < 3; ch++) {
    const cs = src[ch]! / 255;
    const cb = buf[i + ch]! / 255;
    let co: number;
    if (mode === 'add') {
      co = Math.min(1, as * cs + ab * cb);
    } else {
      const mixed = mode === 'multiply' ? cb * cs : cb + cs - cb * cs;
      co = as * ((1 - ab) * cs + ab * mixed) + ab * cb * (1 - as);
    }
    buf[i + ch] = Math.round((co / ao) * 255);
  }
  buf[i + 3] = Math.round(ao * 255);
}

/** A finite double as the exact fraction n / 2^e, n an integer. */
function toDyadic(value: number): [n: bigint, e: number] {
  let e = 0;
  while (!Number.isInteger(value)) {
    value *= 2;
    e++;
  }
  return [BigInt(value), e];
}

/** `num / den` for a positive `den`, rounded to a double. */
function ratioToNumber(num: bigint, den: bigint): number {
  const whole = num / den;
  const rest = num - whole * den;
  return Number(whole) + Number((rest << 64n) / den) / 2 ** 64;
}

/**
 * Where the line through (a0, b0) and (a1, b1) crosses the major coordinate
 * `p`: b0 + (p − a0)(b1 − b0)/(a1 − a0), computed exactly and rounded to a
 * double, so the point stays exact near the canvas however far away the
 * endpoints lie. Requires a0 ≠ a1.
 */
function lineMinorAt(p: number, a0: number, b0: number, a1: number, b1: number): number {
  const parts = [p, a0, b0, a1, b1].map(toDyadic);
  const shift = Math.max(...parts.map(([, e]) => e));
  const [P, A0, B0, A1, B1] = parts.map(([n, e]) => n << BigInt(shift - e)) as [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  let num = B0 * (A1 - A0) + (P - A0) * (B1 - B0);
  let den = (A1 - A0) << BigInt(shift);
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  return ratioToNumber(num, den);
}

/**
 * The `fillCircle` footprint of a circle of radius `radius` (0 or more) about
 * (cx, cy): every pixel whose offset (dx, dy) from the center meets
 * dx² + dy² ≤ r² + r. `bound` is r² + r. At an integer radius about an integer
 * center the midpoint circle of that radius lies inside it; the bound rises
 * with the radius, so each footprint contains every smaller one. It reaches
 * under r + ½ from the center, so the pixels from ⌊c − r⌋ to ⌈c + r⌉ on each
 * axis hold all of it.
 */
function circleFootprint(
  cx: number,
  cy: number,
  radius: number,
): { bound: number; inside: (x: number, y: number) => boolean } {
  const bound = radius * radius + radius;
  return {
    bound,
    inside: (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      return dx * dx + dy * dy <= bound;
    },
  };
}

/** Half the chord a circle of radius `r` cuts at distance `d` from its center. */
function halfChord(r: number, d: number): number {
  return d >= r ? 0 : Math.sqrt(r - d) * Math.sqrt(r + d);
}

/**
 * d − r for the distance d of (dx, dy) from the center of a ring of radius
 * `r`, in a form that stays precise when `r` dwarfs d − r.
 */
function ringOffset(dx: number, dy: number, r: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const long = Math.max(ax, ay);
  const short = Math.min(ax, ay);
  const sum = Math.hypot(dx, dy) + r;
  return sum === 0 ? 0 : ((long - r) * (long + r) + short * short) / sum;
}

/** Beyond this magnitude a ring's chord bounds lose sub-pixel precision. */
const PRECISE_RING_EXTENT = 2 ** 40;

/** Largest radius whose midpoint arithmetic stays exact in doubles: 4r² + 1 < 2⁵³. */
const MAX_EXACT_MIDPOINT_RADIUS = 2 ** 25;

/** Integer square root — the largest s with s² ≤ n — for 0 ≤ n < 2⁵³. */
function isqrt(n: number): number {
  let s = Math.floor(Math.sqrt(n));
  while (s * s > n) s--;
  while ((s + 1) * (s + 1) <= n) s++;
  return s;
}

/** Integer square root of a non-negative bigint, by Newton's method from above. */
function isqrtBig(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const next = (x + n / x) >> 1n;
    if (next >= x) return x;
    x = next;
  }
}

/**
 * Where the midpoint circle of an integer radius crosses one row (or column):
 * given the line and the center's coordinates along and across it, the two
 * pixels the ring's x-major (or y-major) octants put on that line, or
 * undefined when the line holds none of them.
 *
 * `k` lines from the center the ring sits `a` pixels out on either side, `a`
 * being the largest integer up to the radius with a(a − 1) + k² ≤ r² — the
 * pixel the midpoint loop settles on — and the octant holds it while a ≥ k.
 * Past a radius of 2²⁵, r² is no longer exact in a double, so the arithmetic
 * switches to bigint. Callers pass only lines within the radius of the center.
 */
function midpointCrossing(
  radius: number,
): (line: number, lineCenter: number, runCenter: number) => readonly [number, number] | undefined {
  if (radius <= MAX_EXACT_MIDPOINT_RADIUS) {
    const r2 = radius * radius;
    return (line, lineCenter, runCenter) => {
      const k = Math.abs(line - lineCenter);
      // The cap binds only at radius 0, where a = 1 also satisfies a(a − 1) ≤ 0
      const a = Math.min(radius, Math.floor((isqrt(4 * (r2 - k * k) + 1) + 1) / 2));
      return a < k ? undefined : [runCenter - a, runCenter + a];
    };
  }
  const r2 = BigInt(radius) ** 2n;
  return (line, lineCenter, runCenter) => {
    const offset = BigInt(line) - BigInt(lineCenter);
    const k = offset < 0n ? -offset : offset;
    const a = (isqrtBig(4n * (r2 - k * k) + 1n) + 1n) >> 1n;
    if (a < k) return undefined;
    const center = BigInt(runCenter);
    return [Number(center - a), Number(center + a)];
  };
}

/**
 * RGBA pixel buffer with drawing primitives, any width and height from 1 to
 * 4096. `PixooClient` only pushes canvases the size of its panel; other sizes
 * serve as off-screen layers, strips, and supersampled renders.
 *
 * The working buffer stores straight (non-premultiplied) RGBA — width ×
 * height × 4 bytes. A fresh canvas is fully transparent; drawing primitives
 * write opaque pixels (alpha 255) unless given an explicit alpha — an
 * `alpha` option on the fills and strokes composites source-over instead, as
 * do anti-aliased stroke edges. Exports flatten alpha over black at the edge
 * (`toRgbBuffer`, `toBase64`), so a partially transparent pixel dims toward
 * the unlit LED.
 *
 * Coordinates: (0,0) = top-left, (width-1, height-1) = bottom-right.
 * All drawing methods mutate in-place and return `this` for chaining.
 */
export class Canvas {
  /** Raw RGBA byte buffer — width × height × 4 bytes, straight alpha. */
  readonly buffer: Uint8Array;
  readonly width: number;
  readonly height: number;

  /**
   * A transparent canvas: `new Canvas()` is 64×64 (the Pixoo-64 panel),
   * `new Canvas(size)` is `size × size`, and `new Canvas(width, height)` is
   * `width × height`.
   * @throws {RangeError} When a dimension is not an integer from 1 to 4096.
   */
  constructor(width?: number, height?: number);
  /**
   * A copy of a panel-size buffer, its size inferred from the length: RGBA
   * (16/32/64 × same × 4) or RGB (× 3, upconverted to fully opaque RGBA).
   * Use `Canvas.fromRgba` for any other dimensions.
   * @throws {RangeError} When the length matches no panel size.
   */
  constructor(source: Uint8Array);
  constructor(sizeOrSource?: number | Uint8Array, height?: number) {
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
        throw new RangeError(
          `Invalid buffer length ${sizeOrSource.length}; expected one of: ${valid} — use Canvas.fromRgba(buffer, width, height) for other dimensions`,
        );
      }
    } else {
      const w = sizeOrSource ?? DEFAULT_SIZE;
      const h = height ?? w;
      assertDimension('width', w);
      assertDimension('height', h);
      this.width = w;
      this.height = h;
      this.buffer = new Uint8Array(w * h * 4);
    }
  }

  /**
   * Create a canvas of any valid dimensions from straight-alpha RGBA bytes.
   * The bytes are copied.
   * @throws {RangeError} When either dimension is not an integer from 1 to
   *   4096, or `rgba.length` is not `width × height × 4`.
   */
  static fromRgba(rgba: Uint8Array, width: number, height: number): Canvas {
    const canvas = new Canvas(width, height);
    if (rgba.length !== canvas.buffer.length) {
      throw new RangeError(
        `Canvas.fromRgba expected ${canvas.buffer.length} bytes (${width}×${height}×4); got ${rgba.length}`,
      );
    }
    canvas.buffer.set(rgba);
    return canvas;
  }

  /** Clone this canvas — dimensions and alpha included — into a new instance. */
  clone(): Canvas {
    return Canvas.fromRgba(this.buffer, this.width, this.height);
  }

  // --- Pixel access ---

  private idx(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Source-over composite a color onto the pixel at buffer index `i` —
   * `blendPixel`'s math. `alpha` is above 0; at 1 or more the color replaces
   * the pixel.
   */
  private composite(i: number, [r, g, b]: RGB, alpha: number): void {
    const buf = this.buffer;
    if (alpha >= 1) {
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
      return;
    }
    const da = buf[i + 3]! / 255;
    const outA = alpha + da * (1 - alpha);
    buf[i] = Math.round((r * alpha + buf[i]! * da * (1 - alpha)) / outA);
    buf[i + 1] = Math.round((g * alpha + buf[i + 1]! * da * (1 - alpha)) / outA);
    buf[i + 2] = Math.round((b * alpha + buf[i + 2]! * da * (1 - alpha)) / outA);
    buf[i + 3] = Math.round(outA * 255);
  }

  /**
   * Set a single pixel. Out-of-bounds calls are silently ignored.
   * @param alpha - Stored alpha byte, 0–255 (default: 255, fully opaque).
   *   Rounds to an integer; values past either end, `±Infinity` included,
   *   clamp to it.
   * @throws {RangeError} When alpha is NaN, on or off the canvas.
   */
  setPixel(x: number, y: number, color: ColorLike, alpha = 255): this {
    assertAlphaNotNaN(alpha, 'setPixel');
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
    const [r, g, b] = this.getPixelRgba(x, y);
    return [r, g, b];
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

  /**
   * Fill a rectangular region — opaque, or composited at `opts.alpha`.
   * @throws {RangeError} When any coordinate or dimension is not finite, or
   *   `alpha` is not a number from 0 to 1 — before the color resolves.
   */
  fillRect(x: number, y: number, w: number, h: number, color: ColorLike, opts?: FillOptions): this {
    assertFinite([x, y, w, h], 'fillRect coordinates and dimensions must be finite');
    const alpha = optionAlpha('fillRect', opts);
    const c = resolveColor(color);
    if (alpha === 0) return this;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.floor(x + w));
    const y1 = Math.min(this.height, Math.floor(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) this.composite(this.idx(px, py), c, alpha);
    }
    return this;
  }

  /**
   * Fill a circle (solid) — opaque, or composited once per pixel at
   * `opts.alpha`. The disc is every pixel whose offset (dx, dy) from the
   * center meets dx² + dy² ≤ r² + r, at any radius. At an integer radius
   * about an integer center it has no one-pixel nub at the ends of its axes.
   * The 1px `drawCircle` ring of the same center and radius lies inside it,
   * whatever the center and radius. The disc grows with the radius, each one
   * containing every smaller one. A negative radius draws nothing.
   * @throws {RangeError} When the center or radius is not finite, or `alpha`
   *   is not a number from 0 to 1 — before the color resolves.
   */
  fillCircle(cx: number, cy: number, radius: number, color: ColorLike, opts?: FillOptions): this {
    assertFinite([cx, cy, radius], 'fillCircle center and radius must be finite');
    const alpha = optionAlpha('fillCircle', opts);
    const c = resolveColor(color);
    if (radius < 0 || alpha === 0) return this;
    const { inside } = circleFootprint(cx, cy, radius);
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        if (inside(px, py)) this.composite(this.idx(px, py), c, alpha);
      }
    }
    return this;
  }

  // --- Stroke shapes ---

  /**
   * Draw a rectangle outline inside the region `fillRect` fills for the same
   * arguments: the pixels of that region within `opts.width` (default 1) of
   * its edge, opaque or composited once each at `opts.alpha`. A width that
   * reaches the middle fills the region. A zero or negative width or height
   * leaves that region empty, and draws nothing. Validated here, so the
   * error names the method the caller invoked.
   * @throws {RangeError} When any coordinate or dimension is not finite,
   *   `alpha` is not a number from 0 to 1, or `width` is not a positive
   *   integer — before the color resolves.
   */
  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: ColorLike,
    opts?: Omit<StrokeOptions, 'antialias'>,
  ): this {
    assertFinite([x, y, w, h], 'drawRect coordinates and dimensions must be finite');
    const alpha = optionAlpha('drawRect', opts);
    const width = optionWidth('drawRect', opts);
    const c = resolveColor(color);
    const left = Math.floor(x);
    const top = Math.floor(y);
    const right = Math.floor(x + w);
    const bottom = Math.floor(y + h);
    if (right <= left || bottom <= top || alpha === 0) return this;
    // Pixels inside [innerLeft, innerRight) × [innerTop, innerBottom) are the unpainted middle
    const innerLeft = left + width;
    const innerRight = right - width;
    const innerTop = top + width;
    const innerBottom = bottom - width;
    const x0 = Math.max(0, left);
    const x1 = Math.min(this.width, right);
    const y1 = Math.min(this.height, bottom);
    for (let py = Math.max(0, top); py < y1; py++) {
      const edgeRow = py < innerTop || py >= innerBottom;
      for (let px = x0; px < x1; px++) {
        if (!edgeRow && px >= innerLeft && px < innerRight) {
          px = innerRight - 1;
          continue;
        }
        this.composite(this.idx(px, py), c, alpha);
      }
    }
    return this;
  }

  /**
   * Draw a circle outline. With the default `width` of 1 and no
   * `antialias`, an integer center and radius draw the midpoint (Bresenham)
   * circle, which lies inside the `fillCircle` disc of that center and
   * radius. Any other center or radius draws the edge of the `fillCircle`
   * footprint (dx² + dy² ≤ r² + r) about the exact center — the footprint
   * pixels with a horizontal or vertical neighbour outside it — so the ring
   * is symmetric about its center and stays on the fill.
   *
   * A wider or anti-aliased ring covers the band `r − width/2 ≤ d < r +
   * width/2`, `d` a pixel center's distance from the circle's exact center.
   * Aliased, a pixel is lit when its center lies in the band, so an even
   * width adds its extra pixel inward, and the band holds the 1px ring of the
   * same center and radius. Anti-aliased, a pixel's coverage is
   * `clamp(width/2 + ½ − |d − r|, 0, 1)`.
   *
   * Every pixel is written once, composited at `opts.alpha` times its
   * coverage. The cost is bounded by the canvas, however large the radius or
   * width. A negative radius draws nothing.
   * @throws {RangeError} When the center or radius is not finite, `alpha` is
   *   not a number from 0 to 1, or `width` is not a positive integer — before
   *   the color resolves.
   */
  drawCircle(cx: number, cy: number, radius: number, color: ColorLike, opts?: StrokeOptions): this {
    assertFinite([cx, cy, radius], 'drawCircle center and radius must be finite');
    const alpha = optionAlpha('drawCircle', opts);
    const width = optionWidth('drawCircle', opts);
    const antialias = opts?.antialias ?? false;
    const c = resolveColor(color);
    if (radius < 0 || alpha === 0) return this;
    if (width > 1 || antialias) {
      this.strokeRing(cx, cy, radius, width, antialias, c, alpha);
      return this;
    }
    // The tracers reach some pixels more than once; each is composited once
    const ring = new Set<number>();
    const plot = (x: number, y: number) => {
      if (this.inBounds(x, y)) ring.add(this.idx(x, y));
    };
    if (Number.isInteger(radius) && Number.isInteger(cx) && Number.isInteger(cy)) {
      this.strokeMidpointCircle(cx, cy, radius, plot);
    } else {
      this.strokeFootprintEdge(cx, cy, radius, plot);
    }
    for (const i of ring) this.composite(i, c, alpha);
    return this;
  }

  /**
   * The midpoint circle of an integer radius about an integer center: each
   * row within the radius carries the ring's x-major pixels, each column its
   * y-major ones — the pixels the circumference walk of Bresenham's loop
   * visits, found without the walk. The two passes share the octant-boundary
   * pixels, so `plot` sees those twice.
   */
  private strokeMidpointCircle(
    cx: number,
    cy: number,
    radius: number,
    plot: (x: number, y: number) => void,
  ): void {
    const crossing = midpointCrossing(radius);
    const trace = (
      lines: number,
      lineCenter: number,
      runCenter: number,
      paint: (line: number, at: number) => void,
    ) => {
      const last = Math.min(lines - 1, lineCenter + radius);
      for (let line = Math.max(0, lineCenter - radius); line <= last; line++) {
        const ends = crossing(line, lineCenter, runCenter);
        if (ends === undefined) continue;
        paint(line, ends[0]);
        paint(line, ends[1]);
      }
    };
    trace(this.height, cy, cx, (y, x) => plot(x, y));
    trace(this.width, cx, cy, plot);
  }

  /**
   * The edge of the `fillCircle` footprint: every row and column of the
   * footprint is one run, whose edge pixels are its two ends. Each end is
   * sought within a pixel of the analytic crossing and confirmed with
   * `fillCircle`'s own inside test. A pixel ending both a row and a column
   * reaches `plot` twice.
   */
  private strokeFootprintEdge(
    cx: number,
    cy: number,
    radius: number,
    plot: (x: number, y: number) => void,
  ): void {
    const { bound, inside } = circleFootprint(cx, cy, radius);
    const trace = (
      lines: number,
      runLength: number,
      lineCenter: number,
      runCenter: number,
      isInside: (line: number, at: number) => boolean,
      paint: (line: number, at: number) => void,
    ) => {
      const last = Math.min(lines - 1, Math.ceil(lineCenter + radius));
      for (let line = Math.max(0, Math.floor(lineCenter - radius)); line <= last; line++) {
        const d = line - lineCenter;
        if (d * d > bound) continue;
        const half = Math.sqrt(bound - d * d);
        for (const end of [Math.ceil(runCenter - half), Math.floor(runCenter + half)]) {
          const to = Math.min(runLength - 1, end + 1);
          for (let at = Math.max(0, end - 1); at <= to; at++) {
            if (isInside(line, at) && !(isInside(line, at - 1) && isInside(line, at + 1))) {
              paint(line, at);
            }
          }
        }
      }
    };
    trace(
      this.height,
      this.width,
      cy,
      cx,
      (y, x) => inside(x, y),
      (y, x) => plot(x, y),
    );
    trace(this.width, this.height, cx, cy, inside, plot);
  }

  /**
   * A ring of `width` pixels about the circle of `radius`, each pixel written
   * once — see `drawCircle`. Rows and columns are bounded by the ring's
   * chords, and past `PRECISE_RING_EXTENT`, where those lose sub-pixel
   * precision, by the canvas.
   */
  private strokeRing(
    cx: number,
    cy: number,
    radius: number,
    width: number,
    antialias: boolean,
    c: RGB,
    alpha: number,
  ): void {
    const halfWidth = width / 2;
    // A pixel whose center lies farther than `reach` from the circle is untouched
    const reach = antialias ? halfWidth + 0.5 : halfWidth;
    const outer = radius + reach;
    const inner = radius - reach;
    const precise = Math.max(Math.abs(cx), Math.abs(cy)) + outer < PRECISE_RING_EXTENT;
    const yFirst = precise ? Math.max(0, Math.floor(cy - outer) - 1) : 0;
    const yLast = precise ? Math.min(this.height - 1, Math.ceil(cy + outer) + 1) : this.height - 1;
    for (let y = yFirst; y <= yLast; y++) {
      const dy = y - cy;
      let xFirst = 0;
      let xLast = this.width - 1;
      // Columns strictly inside the inner circle, skipped: none unless precise
      let holeFirst = 1;
      let holeLast = 0;
      if (precise) {
        const across = Math.abs(dy);
        const span = halfChord(outer, across);
        xFirst = Math.max(0, Math.floor(cx - span) - 1);
        xLast = Math.min(this.width - 1, Math.ceil(cx + span) + 1);
        if (inner > across) {
          const hole = halfChord(inner, across);
          holeFirst = Math.ceil(cx - hole) + 1;
          holeLast = Math.floor(cx + hole) - 1;
        }
      }
      for (let x = xFirst; x <= xLast; x++) {
        if (x >= holeFirst && x <= holeLast) {
          x = holeLast;
          continue;
        }
        const off = ringOffset(x - cx, dy, radius);
        const coverage = antialias
          ? Math.min(1, reach - Math.abs(off))
          : off >= -halfWidth && off < halfWidth
            ? 1
            : 0;
        if (coverage > 0) this.composite(this.idx(x, y), c, alpha * coverage);
      }
    }
  }

  /**
   * Draw a line between two points. With the default `width` of 1 and no
   * `antialias`, it is the Bresenham line between the floored endpoints.
   *
   * A wider or anti-aliased line steps the major axis from one endpoint's
   * pixel to the other's, as the 1px line does (butt ends), and at each step
   * covers the minor-axis span
   * `m ± (width/2)·√(1 + k²)` — `m` the centerline's minor coordinate, `k`
   * the slope — so `width` is the thickness across the line. Aliased, the
   * endpoints are floored and a pixel is lit when its center falls in the
   * half-open span, so an even width adds its extra pixel up or left.
   * Anti-aliased, the endpoints are exact and a pixel's coverage is the
   * overlap of its own `[q − ½, q + ½]` with the span (`q` its minor
   * coordinate), which on an axis-aligned 1px line is Wu's two-pixel split.
   *
   * Every pixel is written once, composited at `opts.alpha` times its
   * coverage. The cost is bounded by the canvas, however distant the
   * endpoints or wide the line.
   * @throws {RangeError} When any endpoint coordinate is not finite, `alpha`
   *   is not a number from 0 to 1, or `width` is not a positive integer —
   *   before the color resolves.
   */
  drawLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: ColorLike,
    opts?: StrokeOptions,
  ): this {
    assertFinite([x0, y0, x1, y1], 'drawLine endpoint coordinates must be finite');
    const alpha = optionAlpha('drawLine', opts);
    const width = optionWidth('drawLine', opts);
    const antialias = opts?.antialias ?? false;
    const c = resolveColor(color);
    if (alpha === 0) return this;
    if (width > 1 || antialias) {
      this.strokeLine(x0, y0, x1, y1, width, antialias, c, alpha);
      return this;
    }
    this.bresenham(Math.floor(x0), Math.floor(y0), Math.floor(x1), Math.floor(y1), (x, y) =>
      this.composite(this.idx(x, y), c, alpha),
    );
    return this;
  }

  /**
   * A wide or anti-aliased line — see `drawLine`. The centerline is placed
   * exactly at the first canvas step and advanced by the slope from there.
   */
  private strokeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    width: number,
    antialias: boolean,
    c: RGB,
    alpha: number,
  ): void {
    if (!antialias) {
      x0 = Math.floor(x0);
      y0 = Math.floor(y0);
      x1 = Math.floor(x1);
      y1 = Math.floor(y1);
    }
    // Halved differences cannot overflow, however far apart the endpoints
    const halfDx = x1 / 2 - x0 / 2;
    const halfDy = y1 / 2 - y0 / 2;
    const xMajor = Math.abs(halfDx) >= Math.abs(halfDy);
    const [a0, b0, a1, b1] = xMajor ? [x0, y0, x1, y1] : [y0, x0, y1, x1];
    const [halfDa, halfDb] = xMajor ? [halfDx, halfDy] : [halfDy, halfDx];
    const majorLength = xMajor ? this.width : this.height;
    const minorLength = xMajor ? this.height : this.width;
    const first = Math.max(0, Math.floor(Math.min(a0, a1)));
    const last = Math.min(majorLength - 1, Math.floor(Math.max(a0, a1)));
    if (first > last) return;
    const slope = halfDa === 0 ? 0 : halfDb / halfDa;
    const half = (width / 2) * Math.sqrt(1 + slope * slope);
    const start = a0 === a1 ? b0 : lineMinorAt(first, a0, b0, a1, b1);
    for (let p = first; p <= last; p++) {
      const m = start + (p - first) * slope;
      const lo = m - half;
      const hi = m + half;
      const qLast = Math.min(minorLength - 1, Math.ceil(hi + 0.5));
      for (let q = Math.max(0, Math.floor(lo - 0.5)); q <= qLast; q++) {
        const coverage = antialias
          ? Math.min(q + 0.5, hi) - Math.max(q - 0.5, lo)
          : q >= lo && q < hi
            ? 1
            : 0;
        if (coverage > 0) {
          this.composite(xMajor ? this.idx(p, q) : this.idx(q, p), c, alpha * coverage);
        }
      }
    }
  }

  /**
   * The Bresenham line between integer endpoints, passing each on-canvas
   * pixel to `plot` once. Endpoints off the canvas are clipped in bigint, so
   * the cost is bounded by the canvas however distant they are.
   */
  private bresenham(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    plot: (x: number, y: number) => void,
  ): void {
    if (!this.inBounds(x0, y0) || !this.inBounds(x1, y1)) {
      const bx0 = BigInt(x0);
      const by0 = BigInt(y0);
      const bx1 = BigInt(x1);
      const by1 = BigInt(y1);
      const maxX = BigInt(this.width - 1);
      const maxY = BigInt(this.height - 1);
      const dx = bx1 >= bx0 ? bx1 - bx0 : bx0 - bx1;
      const dy = by1 >= by0 ? by1 - by0 : by0 - by1;
      const sx = bx0 < bx1 ? 1n : -1n;
      const sy = by0 < by1 ? 1n : -1n;

      let stepStart: bigint;
      let stepEnd: bigint;
      if (dx >= dy) {
        if (dx === 0n) return;
        stepStart = sx > 0n ? -bx0 : bx0 - maxX;
        stepEnd = sx > 0n ? maxX - bx0 : bx0;
        stepStart = stepStart > 0n ? stepStart : 0n;
        stepEnd = stepEnd < dx ? stepEnd : dx;
      } else {
        stepStart = sy > 0n ? -by0 : by0 - maxY;
        stepEnd = sy > 0n ? maxY - by0 : by0;
        stepStart = stepStart > 0n ? stepStart : 0n;
        stepEnd = stepEnd < dy ? stepEnd : dy;
      }
      if (stepStart > stepEnd) return;

      const major = dx >= dy ? dx : dy;
      const minor = dx >= dy ? dy : dx;
      const minorSteps = (stepStart * minor + major / 2n) / major;
      let cx = bx0 + (dx >= dy ? sx * stepStart : sx * minorSteps);
      let cy = by0 + (dx >= dy ? sy * minorSteps : sy * stepStart);
      let err =
        dx - dy + (dx >= dy ? -stepStart * dy + minorSteps * dx : stepStart * dx - minorSteps * dy);

      for (let step = stepStart; step <= stepEnd; step++) {
        if (cx >= 0n && cx <= maxX && cy >= 0n && cy <= maxY) plot(Number(cx), Number(cy));
        if (step === stepEnd) break;
        const e2 = 2n * err;
        if (e2 >= -dy) {
          err -= dy;
          cx += sx;
        }
        if (e2 <= dx) {
          err += dx;
          cy += sy;
        }
      }
      return;
    }

    const dx = Math.abs(x1 - x0),
      dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let cx = x0,
      cy = y0;
    for (;;) {
      plot(cx, cy);
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
  }

  /**
   * Horizontal line (fast path).
   * @throws {RangeError} When any coordinate or the length is not finite.
   */
  drawLineH(x: number, y: number, length: number, color: ColorLike): this {
    assertFinite([x, y, length], 'drawLineH coordinates and length must be finite');
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

  /**
   * Vertical line (fast path).
   * @throws {RangeError} When any coordinate or the length is not finite.
   */
  drawLineV(x: number, y: number, length: number, color: ColorLike): this {
    assertFinite([x, y, length], 'drawLineV coordinates and length must be finite');
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

  /**
   * Draw a triangle outline. Validated here rather than in the delegated
   * `drawLine` calls, so the error names the method the caller invoked and
   * no edge is drawn before a later vertex is rejected.
   * @throws {RangeError} When any vertex coordinate is not finite.
   */
  drawTriangle(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: ColorLike,
  ): this {
    assertFinite([x0, y0, x1, y1, x2, y2], 'drawTriangle vertex coordinates must be finite');
    const c = resolveColor(color);
    this.drawLine(x0, y0, x1, y1, c);
    this.drawLine(x1, y1, x2, y2, c);
    this.drawLine(x2, y2, x0, y0, c);
    return this;
  }

  /**
   * Fill a solid triangle (scanline rasterization) — opaque, or composited at
   * `opts.alpha`, each pixel once.
   * @throws {RangeError} When any vertex coordinate is not finite, or `alpha`
   *   is not a number from 0 to 1 — before the color resolves.
   */
  fillTriangle(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: ColorLike,
    opts?: FillOptions,
  ): this {
    assertFinite([x0, y0, x1, y1, x2, y2], 'fillTriangle vertex coordinates must be finite');
    const alpha = optionAlpha('fillTriangle', opts);
    const rgb = resolveColor(color);
    if (alpha === 0) return this;
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
        for (let x = xl; x <= xr; x++) this.composite((y * w + x) * 4, rgb, alpha);
      }
    };

    const lerp = (y: number, ya: number, xa: number, yb: number, xb: number) =>
      ya === yb ? xa : xa + ((y - ya) / (yb - ya)) * (xb - xa);

    // Upper half: ay -> by. Ends on the last row strictly above `by`, which
    // meets the lower half's `Math.ceil(by)` start with neither a gap nor an
    // overlap for a fractional middle vertex as well as an integer one.
    if (by > ay) {
      scanline(
        ay,
        Math.ceil(by) - 1,
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
   * Source-over composite a color onto a pixel. alpha: 0–1; at or below 0
   * nothing changes, at or above 1 the color replaces the pixel.
   * The destination's stored alpha participates (compositing onto a
   * transparent pixel stores the color at the given alpha).
   * @throws {RangeError} When alpha is NaN, on or off the canvas.
   */
  blendPixel(x: number, y: number, color: ColorLike, alpha: number): this {
    assertAlphaNotNaN(alpha, 'blendPixel');
    if (alpha <= 0) return this;
    if (alpha >= 1) return this.setPixel(x, y, color);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return this;
    this.composite(this.idx(ix, iy), resolveColor(color), alpha);
    return this;
  }

  /**
   * Composite another canvas on top at an offset, combining each pixel by
   * `opts.mode` — source-over by default; `add`, `screen`, and `multiply`
   * per `BlendMode` — on straight alpha, rounded once to bytes. Undrawn
   * (fully transparent) source pixels leave the destination untouched in
   * every mode; drawn pixels — including true black — land. Offsets are
   * floored to integer pixel coordinates, as in `scroll()`.
   * @throws {RangeError} When either offset is not finite, or `mode` is not
   *   a `BlendMode` — before anything is drawn.
   */
  blit(source: Canvas, dx = 0, dy = 0, opts?: BlitOptions): this {
    assertFinite([dx, dy], 'blit offsets must be finite');
    const mode = opts?.mode ?? 'normal';
    if (!BLEND_MODES.includes(mode)) {
      throw new RangeError(`blit mode must be one of ${BLEND_MODES.join(', ')}; got ${mode}`);
    }
    const ox = Math.floor(dx);
    const oy = Math.floor(dy);
    const key = opts?.transparentColor ?? null;
    const src = source.buffer;
    // Clamp iteration to the overlapping region
    const syStart = Math.max(0, -oy);
    const syEnd = Math.min(source.height, this.height - oy);
    const sxStart = Math.max(0, -ox);
    const sxEnd = Math.min(source.width, this.width - ox);
    for (let sy = syStart; sy < syEnd; sy++) {
      for (let sx = sxStart; sx < sxEnd; sx++) {
        const si = (sy * source.width + sx) * 4;
        const sa = src[si + 3]!;
        if (sa === 0) continue;
        const r = src[si]!;
        const g = src[si + 1]!;
        const b = src[si + 2]!;
        if (key && r === key[0] && g === key[1] && b === key[2]) continue;
        const di = ((oy + sy) * this.width + (ox + sx)) * 4;
        if (mode === 'normal') this.composite(di, [r, g, b], sa / 255);
        else blendInto(this.buffer, di, [r, g, b], sa, mode);
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

  /**
   * Fill the canvas with a radial gradient from center. At radius 0 the exact
   * center pixel takes the inner color and every other pixel the outer one.
   * @throws {RangeError} When the center or radius is not finite.
   */
  gradientRadial(
    cx: number,
    cy: number,
    radius: number,
    innerColor: ColorLike,
    outerColor: ColorLike,
  ): this {
    assertFinite([cx, cy, radius], 'gradientRadial center and radius must be finite');
    const inner = resolveColor(innerColor);
    const outer = resolveColor(outerColor);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const dx = x - cx,
          dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // The center resolves to the inner color outright — at radius 0 the
        // ratio would otherwise be 0 / 0.
        const t = dist === 0 ? 0 : Math.min(1, dist / radius);
        const c = lerpColor(inner, outer, t);
        this.setPixel(x, y, c);
      }
    }
    return this;
  }

  // --- Transform ---

  /**
   * Shift all pixels by dx, dy. Offsets are floored to integer pixel
   * coordinates; vacated pixels become transparent.
   * @throws {RangeError} When either offset is not finite — every destination
   *   would fall out of bounds and the frame would be erased rather than
   *   shifted.
   */
  scroll(dx: number, dy: number): this {
    assertFinite([dx, dy], 'scroll offsets must be finite');
    const offsetX = Math.floor(dx);
    const offsetY = Math.floor(dy);
    const copy = new Uint8Array(this.buffer);
    this.clear();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const nx = x + offsetX,
          ny = y + offsetY;
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

  /**
   * Base64-encode the flattened RGB pixel data (for Draw/SendHttpGif). Encodes
   * with the web-standard `btoa`, so it runs in a browser as well as in Node
   * and Bun.
   */
  toBase64(): string {
    const rgb = this.toRgbBuffer();
    let binary = '';
    for (let i = 0; i < rgb.length; i += BINARY_STRING_CHUNK) {
      binary += String.fromCharCode(...rgb.subarray(i, i + BINARY_STRING_CHUNK));
    }
    return btoa(binary);
  }
}
