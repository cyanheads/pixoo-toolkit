import sharp from 'sharp';
import { Canvas, DISPLAY_SIZE } from './canvas.js';
import { type RGB } from './color.js';

/**
 * Load an image file and render it onto a 64×64 Canvas.
 *
 * Resizes using nearest-neighbor (sharp) to preserve pixel-art crispness.
 * Transparent pixels are left as-is (black by default, or whatever the canvas already has).
 */
export async function loadImage(
  path: string,
  opts: {
    /** Target width on the canvas (default: 64). */
    width?: number;
    /** Target height on the canvas (default: 64). */
    height?: number;
    /** X offset on the canvas (default: 0). */
    x?: number;
    /** Y offset on the canvas (default: 0). */
    y?: number;
    /** Resize fit mode (default: 'contain'). */
    fit?: 'contain' | 'cover' | 'fill';
    /** Resize kernel (default: 'nearest' for pixel art). */
    kernel?: 'nearest' | 'lanczos3' | 'mitchell';
    /** If provided, draws onto this canvas instead of creating a new one. */
    canvas?: Canvas;
  } = {},
): Promise<Canvas> {
  const targetW = opts.width ?? DISPLAY_SIZE;
  const targetH = opts.height ?? DISPLAY_SIZE;
  const ox = opts.x ?? 0;
  const oy = opts.y ?? 0;
  const fit = opts.fit ?? 'contain';
  const kernel = opts.kernel ?? 'nearest';
  const canvas = opts.canvas ?? new Canvas();

  const resized = await sharp(path)
    .resize(targetW, targetH, {
      fit,
      kernel,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = resized;
  const { width, height, channels } = info;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = channels >= 4 ? data[i + 3]! : 255;
      if (a > 128) {
        canvas.setPixel(ox + x, oy + y, [r, g, b]);
      }
    }
  }

  return canvas;
}

/** A downsampled sprite cell. */
export interface SpriteCell {
  color: RGB | null;
}

/**
 * Downsample an image into a grid of sprite cells.
 *
 * Reads the image, finds the bounding box of non-transparent content,
 * divides it into a grid of `cols × rows`, and samples the center of
 * each cell to determine its color.
 *
 * Returns the grid plus metadata for rendering.
 */
export async function downsampleSprite(
  path: string,
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
  width: number;
  height: number;
}> {
  const alphaThresh = opts.alphaThreshold ?? 128;
  const whiteThresh = opts.whiteThreshold ?? 220;
  const darkThresh = opts.darkThreshold ?? 50;

  const { data, info } = await sharp(path)
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

  const isVisible = (x: number, y: number) => {
    const p = px(x, y);
    return p.a > alphaThresh && !(p.r > whiteThresh && p.g > whiteThresh && p.b > whiteThresh);
  };

  // Find bounding box of visible content
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isVisible(x, y)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const cellW = bw / cols;
  const cellH = bh / rows;

  // Collect colors to find the dominant body color
  const colorCounts = new Map<string, { color: RGB; count: number }>();
  let darkR = 0, darkG = 0, darkB = 0, darkCount = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!isVisible(x, y)) continue;
      const p = px(x, y);
      if (p.r < darkThresh && p.g < darkThresh && p.b < darkThresh) {
        darkR += p.r;
        darkG += p.g;
        darkB += p.b;
        darkCount++;
      } else {
        // Quantize to reduce noise from anti-aliasing
        const qr = Math.round(p.r / 10) * 10;
        const qg = Math.round(p.g / 10) * 10;
        const qb = Math.round(p.b / 10) * 10;
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

  const darkColor: RGB = darkCount > 0
    ? [Math.round(darkR / darkCount), Math.round(darkG / darkCount), Math.round(darkB / darkCount)]
    : [20, 12, 12];

  // Sample grid
  const grid: SpriteCell[][] = [];
  for (let gy = 0; gy < rows; gy++) {
    const row: SpriteCell[] = [];
    for (let gx = 0; gx < cols; gx++) {
      const sx = Math.floor(minX + (gx + 0.5) * cellW);
      const sy = Math.floor(minY + (gy + 0.5) * cellH);

      if (!isVisible(sx, sy)) {
        row.push({ color: null });
      } else {
        const p = px(sx, sy);
        if (p.r < darkThresh && p.g < darkThresh && p.b < darkThresh) {
          row.push({ color: darkColor });
        } else {
          row.push({ color: bodyColor });
        }
      }
    }
    grid.push(row);
  }

  return { grid, bodyColor, darkColor, width: cols, height: rows };
}

/**
 * Render a downsampled sprite grid onto a Canvas at a given scale and position.
 */
export function renderSprite(
  canvas: Canvas,
  grid: SpriteCell[][],
  opts: {
    /** Pixel scale factor. */
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
  const scale = opts.scale ?? Math.floor(DISPLAY_SIZE / Math.max(cols, rows));
  const ox = opts.x ?? Math.floor((DISPLAY_SIZE - cols * scale) / 2);
  const oy = opts.y ?? 0;

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cell = grid[gy]![gx]!;
      if (!cell.color) continue;

      let color = cell.color;
      // Allow color overrides
      if (opts.bodyColor && opts.originalBodyColor &&
          color[0] === opts.originalBodyColor[0] &&
          color[1] === opts.originalBodyColor[1] &&
          color[2] === opts.originalBodyColor[2]) {
        color = opts.bodyColor;
      }
      if (opts.darkColor && opts.originalDarkColor &&
          color[0] === opts.originalDarkColor[0] &&
          color[1] === opts.originalDarkColor[1] &&
          color[2] === opts.originalDarkColor[2]) {
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
