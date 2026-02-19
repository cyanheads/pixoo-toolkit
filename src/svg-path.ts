/**
 * Minimal SVG path parser + polygon rasterizer.
 *
 * Parses a subset of SVG path `d` attributes (M/m, L/l, H/h, V/v, Z/z,
 * and implicit lineTo after moveTo) into a point list, then rasterizes
 * with scanline fill.
 */

import { Canvas } from './canvas.js';
import { type ColorLike, resolveColor } from './color.js';

export interface Point {
  x: number;
  y: number;
}

/** Tokenize an SVG path `d` string into commands + coordinate arrays. */
function tokenize(d: string): Array<{ cmd: string; args: number[] }> {
  const tokens: Array<{ cmd: string; args: number[] }> = [];
  // Split on command letters, keeping the letter
  const re = /([MmLlHhVvZzCcSsQqTtAa])([^MmLlHhVvZzCcSsQqTtAa]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    const cmd = match[1]!;
    const argStr = match[2]!.trim();
    const args = argStr.length > 0
      ? argStr
          .replace(/,/g, ' ')
          .replace(/-/g, ' -')
          .split(/\s+/)
          .filter(Boolean)
          .map(Number)
      : [];
    tokens.push({ cmd, args });
  }
  return tokens;
}

/** Parse an SVG path into a polygon (array of points). */
export function parseSvgPath(d: string): Point[] {
  const tokens = tokenize(d);
  const points: Point[] = [];
  let cx = 0,
    cy = 0;

  for (const { cmd, args } of tokens) {
    switch (cmd) {
      case 'M':
        cx = args[0]!;
        cy = args[1]!;
        points.push({ x: cx, y: cy });
        // Implicit lineTo for remaining pairs
        for (let i = 2; i + 1 < args.length; i += 2) {
          cx = args[i]!;
          cy = args[i + 1]!;
          points.push({ x: cx, y: cy });
        }
        break;
      case 'm':
        cx += args[0]!;
        cy += args[1]!;
        points.push({ x: cx, y: cy });
        for (let i = 2; i + 1 < args.length; i += 2) {
          cx += args[i]!;
          cy += args[i + 1]!;
          points.push({ x: cx, y: cy });
        }
        break;
      case 'L':
        for (let i = 0; i + 1 < args.length; i += 2) {
          cx = args[i]!;
          cy = args[i + 1]!;
          points.push({ x: cx, y: cy });
        }
        break;
      case 'l':
        for (let i = 0; i + 1 < args.length; i += 2) {
          cx += args[i]!;
          cy += args[i + 1]!;
          points.push({ x: cx, y: cy });
        }
        break;
      case 'H':
        for (const a of args) {
          cx = a;
          points.push({ x: cx, y: cy });
        }
        break;
      case 'h':
        for (const a of args) {
          cx += a;
          points.push({ x: cx, y: cy });
        }
        break;
      case 'V':
        for (const a of args) {
          cy = a;
          points.push({ x: cx, y: cy });
        }
        break;
      case 'v':
        for (const a of args) {
          cy += a;
          points.push({ x: cx, y: cy });
        }
        break;
      case 'Z':
      case 'z':
        if (points.length > 0) {
          points.push({ x: points[0]!.x, y: points[0]!.y });
        }
        break;
      // Approximate curves as straight lines to endpoints
      case 'C':
        for (let i = 0; i + 5 < args.length; i += 6) {
          cx = args[i + 4]!;
          cy = args[i + 5]!;
          points.push({ x: cx, y: cy });
        }
        break;
      case 'c':
        for (let i = 0; i + 5 < args.length; i += 6) {
          cx += args[i + 4]!;
          cy += args[i + 5]!;
          points.push({ x: cx, y: cy });
        }
        break;
      default:
        // Skip unsupported commands
        break;
    }
  }

  return points;
}

/** Scanline fill a polygon onto a canvas. */
export function fillPolygon(
  canvas: Canvas,
  points: Point[],
  color: ColorLike,
): void {
  if (points.length < 3) return;
  const [r, g, b] = resolveColor(color);

  // Find bounding box
  let minY = Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(canvas.height - 1, Math.ceil(maxY));

  for (let y = yStart; y <= yEnd; y++) {
    const scanY = y + 0.5;
    const intersections: number[] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const bpt = points[i + 1]!;

      // Check if edge crosses this scanline
      if ((a.y <= scanY && bpt.y > scanY) || (bpt.y <= scanY && a.y > scanY)) {
        const t = (scanY - a.y) / (bpt.y - a.y);
        intersections.push(a.x + t * (bpt.x - a.x));
      }
    }

    intersections.sort((a, b) => a - b);

    // Fill between pairs
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const xStart = Math.max(0, Math.ceil(intersections[i]!));
      const xEnd = Math.min(canvas.width - 1, Math.floor(intersections[i + 1]!));
      for (let x = xStart; x <= xEnd; x++) {
        canvas.setPixel(x, y, [r, g, b]);
      }
    }
  }
}

/**
 * Render an SVG path onto a canvas, scaled and translated.
 *
 * @param svgViewBox - Original SVG viewBox dimensions [width, height]
 * @param targetRect - Where to render on canvas [x, y, width, height]
 */
export function renderSvgPath(
  canvas: Canvas,
  d: string,
  color: ColorLike,
  svgViewBox: [number, number] = [16, 16],
  targetRect: [number, number, number, number] = [0, 0, 64, 64],
): void {
  const points = parseSvgPath(d);
  const [tx, ty, tw, th] = targetRect;
  const [vw, vh] = svgViewBox;

  const scaled = points.map((p) => ({
    x: tx + (p.x / vw) * tw,
    y: ty + (p.y / vh) * th,
  }));

  fillPolygon(canvas, scaled, color);
}
