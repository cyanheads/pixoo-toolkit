/**
 * LED finishing: reduce a rendered canvas to what a panel can show.
 * `downsample` area-averages to panel size, `quantize` reduces to a palette
 * with optional dithering, and `correctForPanel` / `simulatePanel` map channel
 * values through a panel's measured drive-to-light response.
 *
 * Pixel values count as sRGB; averaging, error diffusion, and dither mixing
 * work in linear light. Every function returns a new Canvas and never mutates
 * its input. Imports only canvas and color, so `./core` carries it to the
 * browser.
 */

import { Canvas } from './canvas.js';
import { type ColorLike, type RGB, resolveColor } from './color.js';

const DITHERS = ['none', 'bayer4', 'floyd-steinberg'] as const;

/**
 * How `quantize` places palette colors. `none` maps each pixel to its nearest
 * color. `bayer4` picks between the two nearest colors by their linear-light
 * mix against a 4×4 ordered threshold. `floyd-steinberg` diffuses each
 * pixel's linear-light error to its unvisited neighbours in raster order,
 * the light a pixel carries capped one full range past black and white.
 */
export type Dither = (typeof DITHERS)[number];

/**
 * Options for `quantize`: exactly one of `colors` (build a palette of at most
 * that many colors from the canvas) and `palette` (map to these colors).
 */
export type QuantizeOptions = (
  { colors: number; palette?: never } | { palette: readonly ColorLike[]; colors?: never }
) & {
  /** Default `'none'`. */
  dither?: Dither;
};

/**
 * A panel's measured response: `[drive, light]` points from `[0, 0]` to
 * `[255, 1]`, drives rising integers and light non-decreasing. Light between
 * two points interpolates linearly.
 */
export type PanelResponse = readonly (readonly [drive: number, light: number])[];

/** Linear light of each sRGB byte (IEC 61966-2-1). */
const LINEAR = Float64Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** Linear light, clamped to 0–1, as an unrounded sRGB value on the 0–255 scale. */
function toSrgb(light: number): number {
  const l = light <= 0 ? 0 : light >= 1 ? 1 : light;
  return 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
}

/** 4×4 Bayer thresholds, row-major, each (rank + ½) / 16. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((m) => (m + 0.5) / 16);

/**
 * Bounds on the linear light Floyd–Steinberg carries into a pixel: one full
 * range past black and past white. A color the palette can't reach — blue
 * against warm colors only — otherwise builds error without limit and dumps
 * it on the pixels after it.
 */
const CARRY_MIN = -1;
const CARRY_MAX = 2;

// --- downsample ---

/**
 * The source pixels one output cell covers along an axis: the first one's
 * index and each one's overlap with the cell.
 */
interface Footprint {
  first: number;
  weights: number[];
}

/**
 * The footprints of `to` output cells over `from` source pixels. In units of
 * 1/`to` source pixel, cell o spans [o·from, (o + 1)·from) and source pixel s
 * spans [s·to, (s + 1)·to), so every overlap is an exact integer and each
 * cell's weights sum to `from`.
 */
function footprints(from: number, to: number): Footprint[] {
  return Array.from({ length: to }, (_, o) => {
    const start = o * from;
    const end = start + from;
    const first = Math.floor(start / to);
    const weights: number[] = [];
    for (let s = first; s * to < end; s++) {
      weights.push(Math.min(end, (s + 1) * to) - Math.max(start, s * to));
    }
    return { first, weights };
  });
}

function assertTargetSize(name: 'width' | 'height', value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`downsample ${name} must be an integer from 1 to ${max}; got ${value}`);
  }
}

/**
 * Shrink a canvas to `width × height` by exact area averaging: each output
 * pixel is the mean of the source region it covers, partial pixels weighted
 * by the fraction covered at a non-integer ratio. Color averages in linear
 * light, weighted by alpha (premultiplied); alpha averages as coverage. A
 * region with no alpha stays `[0, 0, 0, 0]`. No output channel leaves the
 * range of the source pixels its region covers, so hard edges don't ring. A
 * same-size call returns an equal copy.
 * @throws {RangeError} When `width` or `height` is not an integer from 1 to
 *   the source's own.
 */
export function downsample(canvas: Canvas, width: number, height: number): Canvas {
  assertTargetSize('width', width, canvas.width);
  assertTargetSize('height', height, canvas.height);
  if (width === canvas.width && height === canvas.height) return canvas.clone();
  const columns = footprints(canvas.width, width);
  const rows = footprints(canvas.height, height);
  const area = canvas.width * canvas.height;
  const src = canvas.buffer;
  const out = new Canvas(width, height);
  let o = 0;
  for (const row of rows) {
    for (const column of columns) {
      let alpha = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < row.weights.length; j++) {
        const rowStart = (row.first + j) * canvas.width;
        for (let k = 0; k < column.weights.length; k++) {
          const i = (rowStart + column.first + k) * 4;
          const w = row.weights[j]! * column.weights[k]! * src[i + 3]!;
          if (w === 0) continue;
          alpha += w;
          r += w * LINEAR[src[i]!]!;
          g += w * LINEAR[src[i + 1]!]!;
          b += w * LINEAR[src[i + 2]!]!;
        }
      }
      if (alpha > 0) {
        out.buffer[o] = Math.round(toSrgb(r / alpha));
        out.buffer[o + 1] = Math.round(toSrgb(g / alpha));
        out.buffer[o + 2] = Math.round(toSrgb(b / alpha));
        out.buffer[o + 3] = Math.round(alpha / area);
      }
      o += 4;
    }
  }
  return out;
}

// --- quantize ---

/** Pixel count of each distinct RGB among pixels with a non-zero alpha, keyed 0xRRGGBB. */
function visibleHistogram(canvas: Canvas): Map<number, number> {
  const histogram = new Map<number, number>();
  const buf = canvas.buffer;
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] === 0) continue;
    const key = (buf[i]! << 16) | (buf[i + 1]! << 8) | buf[i + 2]!;
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  return histogram;
}

/** Channel 0 (red), 1 (green), or 2 (blue) of a 0xRRGGBB key. */
function channelOf(key: number, channel: number): number {
  return (key >> (16 - 8 * channel)) & 0xff;
}

/** A box of distinct colors with the pixel-weighted sums its squared error derives from. */
interface Box {
  keys: number[];
  count: number;
  sum: [number, number, number];
  /** Σ count · (r² + g² + b²). */
  squares: number;
}

function boxOf(keys: number[], histogram: Map<number, number>): Box {
  const box: Box = { keys, count: 0, sum: [0, 0, 0], squares: 0 };
  for (const key of keys) {
    const n = histogram.get(key)!;
    box.count += n;
    for (let ch = 0; ch < 3; ch++) {
      const v = channelOf(key, ch);
      box.sum[ch]! += n * v;
      box.squares += n * v * v;
    }
  }
  return box;
}

/** Squared sRGB error of a box's pixels about its mean. */
function squaredError({ count, sum, squares }: Box): number {
  return squares - (sum[0] * sum[0] + sum[1] * sum[1] + sum[2] * sum[2]) / count;
}

/**
 * The cut of a box, holding at least two colors, whose halves carry the
 * least squared error: a channel and a value, colors at or below it going
 * left. Ties go to the earlier channel, then the lower value.
 */
function bestCut(box: Box, histogram: Map<number, number>): { channel: number; at: number } {
  let best = { channel: 0, at: 0 };
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let channel = 0; channel < 3; channel++) {
    const counts = new Float64Array(256);
    const sums = new Float64Array(256 * 3);
    for (const key of box.keys) {
      const n = histogram.get(key)!;
      const v = channelOf(key, channel);
      counts[v]! += n;
      for (let ch = 0; ch < 3; ch++) sums[v * 3 + ch]! += n * channelOf(key, ch);
    }
    let count = 0;
    const sum = [0, 0, 0];
    for (let at = 0; at < 255; at++) {
      count += counts[at]!;
      for (let ch = 0; ch < 3; ch++) sum[ch]! += sums[at * 3 + ch]!;
      if (count === 0 || count === box.count) continue;
      // Minimizing the halves' squared error maximizes Σ|sum|² / count over them
      let score = 0;
      for (let ch = 0; ch < 3; ch++) {
        const rest = box.sum[ch]! - sum[ch]!;
        score += (sum[ch]! * sum[ch]!) / count + (rest * rest) / (box.count - count);
      }
      if (score > bestScore) {
        bestScore = score;
        best = { channel, at };
      }
    }
  }
  return best;
}

/**
 * A palette of exactly `colors` colors by variance split: repeatedly cut the
 * box with the largest squared error at its best cut, then take each box's
 * mean. Requires more distinct colors in the histogram than `colors`.
 */
function varianceSplit(histogram: Map<number, number>, colors: number): RGB[] {
  const boxes = [boxOf([...histogram.keys()], histogram)];
  while (boxes.length < colors) {
    let pick = -1;
    let worst = Number.NEGATIVE_INFINITY;
    boxes.forEach((box, i) => {
      if (box.keys.length < 2) return;
      const error = squaredError(box);
      if (error > worst) {
        worst = error;
        pick = i;
      }
    });
    const box = boxes[pick]!;
    const { channel, at } = bestCut(box, histogram);
    const left = box.keys.filter((key) => channelOf(key, channel) <= at);
    const right = box.keys.filter((key) => channelOf(key, channel) > at);
    boxes.splice(pick, 1, boxOf(left, histogram), boxOf(right, histogram));
  }
  return boxes.map(({ count, sum }) => [
    Math.round(sum[0] / count),
    Math.round(sum[1] / count),
    Math.round(sum[2] / count),
  ]);
}

/** Colors in order, each after its first occurrence dropped. */
function distinctColors(colors: readonly RGB[]): RGB[] {
  const seen = new Set<number>();
  return colors.filter(([r, g, b]) => {
    const key = (r << 16) | (g << 8) | b;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Indices of the nearest and second-nearest palette colors to an sRGB point
 * by squared distance, the lower index winning a tie. The second is -1 for a
 * one-color palette.
 */
function nearestTwo(palette: readonly RGB[], r: number, g: number, b: number): [number, number] {
  let first = -1;
  let second = -1;
  let firstDistance = Number.POSITIVE_INFINITY;
  let secondDistance = Number.POSITIVE_INFINITY;
  for (let k = 0; k < palette.length; k++) {
    const [pr, pg, pb] = palette[k]!;
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (distance < firstDistance) {
      second = first;
      secondDistance = firstDistance;
      first = k;
      firstDistance = distance;
    } else if (distance < secondDistance) {
      second = k;
      secondDistance = distance;
    }
  }
  return [first, second];
}

/**
 * Where the linear-light point `p` projects on the segment from `a` to `b`,
 * clamped to 0–1: the share of `b` in the mix of the two nearest to `p`.
 * `a` and `b` differ.
 */
function mixFraction(a: readonly number[], b: readonly number[], p: readonly number[]): number {
  let along = 0;
  let length = 0;
  for (let ch = 0; ch < 3; ch++) {
    const d = b[ch]! - a[ch]!;
    along += (p[ch]! - a[ch]!) * d;
    length += d * d;
  }
  return Math.min(1, Math.max(0, along / length));
}

/** Write an opaque-or-not pixel's RGB, leaving its alpha. */
function writeRgb(buf: Uint8Array, i: number, [r, g, b]: RGB): void {
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}

/**
 * Reduce a canvas to a palette. With `colors`, the palette is built from the
 * canvas's visible pixels by variance split — the box of colors with the
 * largest squared error is cut where its halves carry the least, until there
 * are `colors` boxes — each box's mean a palette color; a frame already
 * within `colors` distinct visible colors returns unchanged. With `palette`,
 * the given colors are used as they are.
 *
 * Without dithering each pixel takes the nearest palette color by squared
 * sRGB distance, the lowest index winning a tie; `dither` spreads the
 * difference instead (see `Dither`). Alpha bytes pass through, and alpha-0
 * pixels are skipped and left as they are.
 * @throws {TypeError} Unless exactly one of `colors` and `palette` is given.
 * @throws {RangeError} When `colors` is not an integer from 2 to 256, the
 *   palette holds 0 or more than 256 entries, or `dither` is unknown.
 * @throws {Error} From `resolveColor`, for an unresolvable palette entry.
 */
export function quantize(canvas: Canvas, options: QuantizeOptions): Canvas {
  const { colors, palette, dither = 'none' } = options;
  if ((colors === undefined) === (palette === undefined)) {
    throw new TypeError(
      `quantize takes exactly one of colors and palette; got ${colors === undefined ? 'neither' : 'both'}`,
    );
  }
  if (colors !== undefined && !(Number.isInteger(colors) && colors >= 2 && colors <= 256)) {
    throw new RangeError(`quantize colors must be an integer from 2 to 256; got ${colors}`);
  }
  if (palette !== undefined && !(palette.length >= 1 && palette.length <= 256)) {
    throw new RangeError(`quantize palette must hold 1 to 256 colors; got ${palette.length}`);
  }
  if (!DITHERS.includes(dither)) {
    throw new RangeError(`quantize dither must be one of ${DITHERS.join(', ')}; got ${dither}`);
  }

  let entries: RGB[];
  if (palette === undefined) {
    const histogram = visibleHistogram(canvas);
    if (histogram.size <= colors!) return canvas.clone();
    entries = varianceSplit(histogram, colors!);
  } else {
    entries = distinctColors(palette.map((color) => resolveColor(color)));
  }
  const light = entries.map(([r, g, b]) => [LINEAR[r]!, LINEAR[g]!, LINEAR[b]!]);

  const out = canvas.clone();
  const buf = out.buffer;
  const { width, height } = out;

  if (dither === 'floyd-steinberg') {
    // Linear light per channel, carrying the error diffused so far
    const work = new Float64Array(width * height * 3);
    for (let p = 0; p < width * height; p++) {
      for (let ch = 0; ch < 3; ch++) work[p * 3 + ch] = LINEAR[buf[p * 4 + ch]!]!;
    }
    const spread = (x: number, y: number, error: readonly number[], share: number) => {
      if (x < 0 || x >= width || y >= height) return;
      const p = (y * width + x) * 3;
      for (let ch = 0; ch < 3; ch++) work[p + ch]! += error[ch]! * share;
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (buf[p * 4 + 3] === 0) continue;
        const want = [0, 1, 2].map((ch) =>
          Math.min(CARRY_MAX, Math.max(CARRY_MIN, work[p * 3 + ch]!)),
        );
        const [k] = nearestTwo(entries, toSrgb(want[0]!), toSrgb(want[1]!), toSrgb(want[2]!));
        writeRgb(buf, p * 4, entries[k]!);
        const error = want.map((v, ch) => v - light[k]![ch]!);
        spread(x + 1, y, error, 7 / 16);
        spread(x - 1, y + 1, error, 3 / 16);
        spread(x, y + 1, error, 5 / 16);
        spread(x + 1, y + 1, error, 1 / 16);
      }
    }
    return out;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (buf[i + 3] === 0) continue;
      const [near, next] = nearestTwo(entries, buf[i]!, buf[i + 1]!, buf[i + 2]!);
      let k = near;
      if (dither === 'bayer4' && next >= 0) {
        const p = [LINEAR[buf[i]!]!, LINEAR[buf[i + 1]!]!, LINEAR[buf[i + 2]!]!];
        const threshold = BAYER4[(y & 3) * 4 + (x & 3)]!;
        if (mixFraction(light[near]!, light[next]!, p) > threshold) k = next;
      }
      writeRgb(buf, i, entries[k]!);
    }
  }
  return out;
}

// --- panel response ---

/**
 * The light of every drive 0–255 under a response, interpolated linearly
 * between its points.
 * @throws {RangeError} Naming `method`, for a malformed response.
 */
function responseCurve(method: string, response: PanelResponse): Float64Array {
  if (!Array.isArray(response) || response.length < 2) {
    throw new RangeError(
      `${method} response must be an array of at least two [drive, light] points`,
    );
  }
  response.forEach((point, i) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new RangeError(`${method} response point ${i} must be a [drive, light] pair`);
    }
  });
  const first = response[0]!;
  const last = response[response.length - 1]!;
  if (first[0] !== 0 || first[1] !== 0 || last[0] !== 255 || last[1] !== 1) {
    throw new RangeError(
      `${method} response must run from [0, 0] to [255, 1]; got [${first.join(', ')}] to [${last.join(', ')}]`,
    );
  }
  for (let i = 1; i < response.length; i++) {
    const [d0, l0] = response[i - 1]!;
    const [d1, l1] = response[i]!;
    if (!Number.isInteger(d1) || !(d1 > d0)) {
      throw new RangeError(
        `${method} response drives must be rising integers; got ${d0} then ${d1}`,
      );
    }
    if (!(l1 >= l0)) {
      throw new RangeError(
        `${method} response light must be a non-decreasing number; got ${l0} then ${l1}`,
      );
    }
  }
  const curve = new Float64Array(256);
  for (let i = 1; i < response.length; i++) {
    const [d0, l0] = response[i - 1]!;
    const [d1, l1] = response[i]!;
    for (let d = d0; d <= d1; d++) curve[d] = l0 + ((d - d0) * (l1 - l0)) / (d1 - d0);
  }
  return curve;
}

/** Flatten over black as `toRgbBuffer` does, map each channel through `table`, and return it opaque. */
function mapFlattened(canvas: Canvas, table: Uint8Array): Canvas {
  const rgb = canvas.toRgbBuffer();
  const out = new Canvas(canvas.width, canvas.height);
  for (let p = 0, i = 0; p < rgb.length; p += 3, i += 4) {
    out.buffer[i] = table[rgb[p]!]!;
    out.buffer[i + 1] = table[rgb[p + 1]!]!;
    out.buffer[i + 2] = table[rgb[p + 2]!]!;
    out.buffer[i + 3] = 255;
  }
  return out;
}

/**
 * The frame to push so the panel shows `canvas`: each channel becomes the
 * drive whose light under `response` is nearest the sRGB value's light, the
 * lower drive winning a tie. Flattens over black as `toRgbBuffer` does; the
 * result is opaque. Correction can't create dark levels the panel lacks.
 * @throws {RangeError} When `response` is not `[drive, light]` points from
 *   `[0, 0]` to `[255, 1]` with rising integer drives and non-decreasing light.
 */
export function correctForPanel(canvas: Canvas, response: PanelResponse): Canvas {
  const curve = responseCurve('correctForPanel', response);
  const table = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const target = LINEAR[v]!;
    let best = 0;
    for (let d = 1; d < 256; d++) {
      if (Math.abs(curve[d]! - target) < Math.abs(curve[best]! - target)) best = d;
    }
    table[v] = best;
  }
  return mapFlattened(canvas, table);
}

/**
 * What the panel shows when `canvas` is pushed as it is: each channel, taken
 * as a drive, becomes the sRGB value of its light under `response`. Flattens
 * over black as `toRgbBuffer` does; the result is opaque.
 * @throws {RangeError} When `response` is not `[drive, light]` points from
 *   `[0, 0]` to `[255, 1]` with rising integer drives and non-decreasing light.
 */
export function simulatePanel(canvas: Canvas, response: PanelResponse): Canvas {
  const curve = responseCurve('simulatePanel', response);
  return mapFlattened(
    canvas,
    Uint8Array.from(curve, (light) => Math.round(toSrgb(light))),
  );
}
