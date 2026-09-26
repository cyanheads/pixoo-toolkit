import sharp, { type Sharp } from 'sharp';
import { Canvas, type PixooSize } from './canvas.js';
import { type RGB } from './color.js';

/** Where and how a decoded image lands on its canvas. */
interface ImagePlacement {
  /** Target width on the canvas (default: canvas width). */
  width?: number;
  /** Target height on the canvas (default: canvas height). */
  height?: number;
  /** X offset on the canvas (default: 0). */
  x?: number;
  /** Y offset on the canvas (default: 0). */
  y?: number;
  /** Resize fit mode (default: 'contain'). */
  fit?: 'contain' | 'cover' | 'fill';
  /** Resize kernel (default: 'nearest' for pixel art). */
  kernel?: 'nearest' | 'lanczos3' | 'mitchell';
}

/** Formats sharp renders at the resolution a resize asks for — they have no pixel grid to decode. */
const VECTOR_FORMATS: ReadonlySet<string> = new Set(['svg', 'pdf']);

/** A decoded image, served one page at a time. */
interface DecodedImage {
  /** Pages decoded: the source's page count for an animation, else 1. */
  pages: number;
  /** Milliseconds each source page shows, where the format records it. */
  delay: number[] | undefined;
  /** A fresh pipeline over page `k` alone, ready to resize. */
  page(k: number): Sharp;
}

/**
 * Decode `input` for placement. A raster image decodes to full-resolution raw
 * pixels — every page stacked top to bottom when `animated`, else the first —
 * so the resize kernel sees source pixels, never the pre-blended output of
 * sharp's shrink-on-load (libwebp's scaled decode, JPEG DCT scaling), and every
 * format resizes from the same kind of source. The pages decode in one pass:
 * libvips composites a GIF or WebP page from the pages before it, so decoding
 * them one at a time costs O(k) for page k. A vector image has no pixel grid,
 * so sharp renders each page at the resolution its placement asks for.
 */
async function decodeImage(input: string | Uint8Array, animated: boolean): Promise<DecodedImage> {
  const { format, pages = 1, delay } = await sharp(input).metadata();
  const pageCount = animated ? pages : 1;
  if (VECTOR_FORMATS.has(format)) {
    return { pages: pageCount, delay, page: (k) => sharp(input, { page: k }) };
  }

  const { data, info } = await sharp(input, { animated })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  const height = info.pageHeight ?? info.height;
  const pageBytes = width * height * channels;
  return {
    pages: pageCount,
    delay,
    page: (k) =>
      sharp(data.subarray(k * pageBytes, (k + 1) * pageBytes), {
        raw: { width, height, channels },
      }),
  };
}

/**
 * Resize `image` into its placement and composite it source-over onto
 * `canvas`. The image decodes in full before the first pixel is drawn, so a
 * decode failure leaves the canvas untouched.
 */
async function drawImage(image: Sharp, canvas: Canvas, opts: ImagePlacement): Promise<void> {
  const ox = opts.x ?? 0;
  const oy = opts.y ?? 0;
  const { data, info } = await image
    .resize(opts.width ?? canvas.width, opts.height ?? canvas.height, {
      fit: opts.fit ?? 'contain',
      kernel: opts.kernel ?? 'nearest',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = channels >= 4 ? data[i + 3]! : 255;
      if (a === 0) continue;
      canvas.blendPixel(ox + x, oy + y, [r, g, b], a / 255);
    }
  }
}

/**
 * Load an image and render it onto a Canvas.
 *
 * Decodes at full resolution, then resizes with `kernel` — nearest-neighbor by
 * default, so every placed pixel is a source pixel and pixel art stays crisp in
 * any raster format. A vector source (SVG) renders at the placement's
 * resolution instead. Source alpha is preserved: pixels composite source-over
 * onto the canvas, so semi-transparent edges blend instead of hard-thresholding.
 * An animated source contributes its first frame — `loadAnimation` decodes them all.
 *
 * @param input - A file path, or encoded image bytes (a `Buffer` or any
 *   `Uint8Array`, views included) in any format sharp decodes.
 * @throws {Error} sharp's error when the input is missing or undecodable —
 *   the promise rejects before anything is drawn, so a supplied `canvas` is
 *   left untouched.
 */
export async function loadImage(
  input: string | Uint8Array,
  opts: ImagePlacement & {
    /** Canvas size when creating a new canvas (default: 64). Ignored if `canvas` is provided. */
    size?: PixooSize;
    /** If provided, draws onto this canvas instead of creating a new one. */
    canvas?: Canvas;
  } = {},
): Promise<Canvas> {
  const canvas = opts.canvas ?? new Canvas(opts.size);
  const image = await decodeImage(input, false);
  await drawImage(image.page(0), canvas, opts);
  return canvas;
}

/** Frames decoded by `loadAnimation`, with their timing. */
export interface LoadedAnimation {
  /** One `size × size` canvas per kept frame, transparent outside the placed page. */
  frames: Canvas[];
  /**
   * Milliseconds each frame shows, one per frame — as the source records them
   * (a GIF's 0 stays 0), summed over the source frames a sampled frame stands in for.
   */
  delays: number[];
  /** The source's frame count, before `maxFrames` sampling. */
  sourceFrames: number;
}

/**
 * Load every frame of an animated GIF or WebP, each placed on its own canvas
 * exactly as `loadImage` places a still — the source decodes once, and every
 * page is resized on its own, since resizing the stacked pages in one pass
 * bleeds neighboring frames into each frame's edge rows. A still image
 * returns one frame.
 *
 * `maxFrames` samples a longer source evenly: source frames
 * `floor(k × sourceFrames / maxFrames)` for `k = 0 … maxFrames − 1`, frame 0
 * first. A kept frame's delay sums the source delays it stands in for, so the
 * loop keeps its duration. The device takes one speed per animation and turns
 * unstable above ~40 frames: cap with `maxFrames` and pick the speed from `delays`.
 *
 * @param input - A file path, or encoded image bytes (a `Buffer` or any
 *   `Uint8Array`, views included) in any format sharp decodes.
 * @throws {RangeError} When `maxFrames` is not a positive integer.
 * @throws {Error} sharp's error when the input is missing or undecodable, or
 *   is a multi-page file whose pages differ in size (a TIFF pyramid) — every
 *   frame of a GIF or WebP shares one size.
 */
export async function loadAnimation(
  input: string | Uint8Array,
  opts: ImagePlacement & {
    /** Frame canvas size (default: 64). */
    size?: PixooSize;
    /** Keep at most this many frames, sampled evenly (default: every frame). */
    maxFrames?: number;
  } = {},
): Promise<LoadedAnimation> {
  const { maxFrames } = opts;
  if (maxFrames !== undefined && (!Number.isInteger(maxFrames) || maxFrames < 1)) {
    throw new RangeError(`maxFrames must be a positive integer; got ${maxFrames}`);
  }

  const image = await decodeImage(input, true);
  const sourceFrames = image.pages;
  const keep = Math.min(sourceFrames, maxFrames ?? sourceFrames);
  const kept = Array.from({ length: keep }, (_, k) => Math.floor((k * sourceFrames) / keep));

  const frames = await Promise.all(
    kept.map(async (k) => {
      const canvas = new Canvas(opts.size);
      await drawImage(image.page(k), canvas, opts);
      return canvas;
    }),
  );

  const delays = kept.map((start, i) => {
    let total = 0;
    for (let k = start; k < (kept[i + 1] ?? sourceFrames); k++) total += image.delay?.[k] ?? 0;
    return total;
  });

  return { frames, delays, sourceFrames };
}

/** A downsampled sprite cell. */
export interface SpriteCell {
  color: RGB | null;
}

/**
 * Downsample an image into a grid of sprite cells.
 *
 * Decodes the image, finds the bounding box of non-transparent content,
 * divides it into a grid of `cols × rows`, and samples the center of
 * each cell to determine its color.
 *
 * Returns the grid plus metadata for rendering.
 *
 * @param input - A file path, or encoded image bytes (a `Buffer` or any
 *   `Uint8Array`, views included) in any format sharp decodes.
 * @throws {Error} sharp's error when the input is missing or undecodable.
 */
export async function downsampleSprite(
  input: string | Uint8Array,
  cols: number,
  rows: number,
  opts: {
    /** Alpha threshold for considering a pixel visible (default: 128). */
    alphaThreshold?: number;
    /** Lightness threshold for ignoring near-white pixels like outlines (default: 220). */
    whiteThreshold?: number;
    /** Darkness threshold for classifying as "eye" / dark feature (default: 50). */
    darkThreshold?: number;
  } = {},
): Promise<{
  grid: SpriteCell[][];
  bodyColor: RGB;
  darkColor: RGB;
  cols: number;
  rows: number;
}> {
  const alphaThresh = opts.alphaThreshold ?? 128;
  const whiteThresh = opts.whiteThreshold ?? 220;
  const darkThresh = opts.darkThreshold ?? 50;

  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  const px = (x: number, y: number) => {
    const i = (y * width + x) * channels;
    return {
      r: data[i]!,
      g: data[i + 1]!,
      b: data[i + 2]!,
      a: channels >= 4 ? data[i + 3]! : 255,
    };
  };

  const isVisible = (p: ReturnType<typeof px>) =>
    p.a > alphaThresh && !(p.r > whiteThresh && p.g > whiteThresh && p.b > whiteThresh);

  const isDark = (p: ReturnType<typeof px>) =>
    p.r < darkThresh && p.g < darkThresh && p.b < darkThresh;

  // Find bounding box of visible content
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = px(x, y);
      if (isVisible(p)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  // No visible pixels — return empty grid
  if (minX > maxX || minY > maxY) {
    const emptyGrid: SpriteCell[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ color: null })),
    );
    return { grid: emptyGrid, bodyColor: [0, 0, 0], darkColor: [0, 0, 0], cols, rows };
  }

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const cellW = bw / cols;
  const cellH = bh / rows;

  // Collect colors to find the dominant body color
  const colorCounts = new Map<string, { color: RGB; count: number }>();
  let darkR = 0,
    darkG = 0,
    darkB = 0,
    darkCount = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p = px(x, y);
      if (!isVisible(p)) continue;
      if (isDark(p)) {
        darkR += p.r;
        darkG += p.g;
        darkB += p.b;
        darkCount++;
      } else {
        // Quantize to reduce noise from anti-aliasing
        const qr = Math.min(255, Math.round(p.r / 10) * 10);
        const qg = Math.min(255, Math.round(p.g / 10) * 10);
        const qb = Math.min(255, Math.round(p.b / 10) * 10);
        const key = `${qr},${qg},${qb}`;
        const entry = colorCounts.get(key);
        if (entry) {
          entry.count++;
        } else {
          colorCounts.set(key, { color: [qr, qg, qb], count: 1 });
        }
      }
    }
  }

  // Most frequent color = body
  let bodyColor: RGB = [200, 120, 90];
  let maxCount = 0;
  for (const { color, count } of colorCounts.values()) {
    if (count > maxCount) {
      maxCount = count;
      bodyColor = color;
    }
  }

  const darkColor: RGB =
    darkCount > 0
      ? [
          Math.round(darkR / darkCount),
          Math.round(darkG / darkCount),
          Math.round(darkB / darkCount),
        ]
      : [20, 12, 12];

  // Sample grid
  const grid: SpriteCell[][] = [];
  for (let gy = 0; gy < rows; gy++) {
    const row: SpriteCell[] = [];
    for (let gx = 0; gx < cols; gx++) {
      const sx = Math.floor(minX + (gx + 0.5) * cellW);
      const sy = Math.floor(minY + (gy + 0.5) * cellH);
      const p = px(sx, sy);

      if (!isVisible(p)) {
        row.push({ color: null });
      } else {
        row.push({ color: isDark(p) ? darkColor : bodyColor });
      }
    }
    grid.push(row);
  }

  return { grid, bodyColor, darkColor, cols, rows };
}

const sameRgb = (a: RGB, b: RGB): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * Reject a grid whose rows disagree in length. Column count comes from the
 * first row, so a shorter row would read past its end and a longer one would
 * lose its trailing cells without a word.
 */
function assertRectangularGrid(grid: readonly SpriteCell[][], cols: number): void {
  for (let gy = 1; gy < grid.length; gy++) {
    const width = grid[gy]!.length;
    if (width !== cols) {
      throw new RangeError(
        `Sprite grid row ${gy} has ${width} ${width === 1 ? 'cell' : 'cells'}; expected ${cols}`,
      );
    }
  }
}

/**
 * Render a downsampled sprite grid onto a Canvas at a given scale and position.
 * @throws {RangeError} When the grid's rows are not all the same length.
 */
export function renderSprite(
  canvas: Canvas,
  grid: SpriteCell[][],
  opts: {
    /** Pixel scale factor (default: the largest that fits the grid inside the canvas). */
    scale?: number;
    /** X offset on canvas (default: centered). */
    x?: number;
    /** Y offset on canvas. */
    y?: number;
    /** Override body color. */
    bodyColor?: RGB;
    /** Override dark/eye color. */
    darkColor?: RGB;
    /** Original body color from downsample (for replacement). */
    originalBodyColor?: RGB;
    /** Original dark color from downsample (for replacement). */
    originalDarkColor?: RGB;
  } = {},
): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  assertRectangularGrid(grid, cols);
  const scale = opts.scale ?? Math.floor(Math.min(canvas.width / cols, canvas.height / rows));
  const ox = opts.x ?? Math.floor((canvas.width - cols * scale) / 2);
  const oy = opts.y ?? 0;

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cell = grid[gy]![gx]!;
      if (!cell.color) continue;

      let color = cell.color;
      // Allow color overrides
      if (opts.bodyColor && opts.originalBodyColor && sameRgb(color, opts.originalBodyColor)) {
        color = opts.bodyColor;
      }
      if (opts.darkColor && opts.originalDarkColor && sameRgb(color, opts.originalDarkColor)) {
        color = opts.darkColor;
      }

      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          canvas.setPixel(ox + gx * scale + dx, oy + gy * scale + dy, color);
        }
      }
    }
  }
}
