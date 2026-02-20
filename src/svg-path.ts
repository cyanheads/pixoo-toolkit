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
    const args =
      argStr.length > 0
        ? argStr
            .replace(/,/g, ' ')
            .replace(/(?<![eE])-/g, ' -')
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
  // Track subpath start for Z/z closePath
  let subpathStartX = 0,
    subpathStartY = 0;

  for (const { cmd, args } of tokens) {
    switch (cmd) {
      case 'M':
        cx = args[0]!;
        cy = args[1]!;
        subpathStartX = cx;
        subpathStartY = cy;
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
        subpathStartX = cx;
        subpathStartY = cy;
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
          cx = subpathStartX;
          cy = subpathStartY;
          points.push({ x: cx, y: cy });
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
      // Approximate quadratic bezier as line to endpoint
      case 'Q':
        for (let i = 0; i + 3 < args.length; i += 4) {
          cx = args[i + 2]!;
          cy = args[i + 3]!;
          points.push({ x: cx, y: cy });
        }
        break;
      case 'q':
        for (let i = 0; i + 3 < args.length; i += 4) {
          cx += args[i + 2]!;
          cy += args[i + 3]!;
          points.push({ x: cx, y: cy });
        }
        break;
      // Smooth cubic bezier — line to endpoint
      case 'S':
        for (let i = 0; i + 3 < args.length; i += 4) {
          cx = args[i + 2]!;
          cy = args[i + 3]!;
          points.push({ x: cx, y: cy });
        }
        break;
      case 's':
        for (let i = 0; i + 3 < args.length; i += 4) {
          cx += args[i + 2]!;
          cy += args[i + 3]!;
          points.push({ x: cx, y: cy });
        }
        break;
      // Smooth quadratic bezier — line to endpoint
      case 'T':
        for (let i = 0; i + 1 < args.length; i += 2) {
          cx = args[i]!;
          cy = args[i + 1]!;
          points.push({ x: cx, y: cy });
        }
        break;
      case 't':
        for (let i = 0; i + 1 < args.length; i += 2) {
          cx += args[i]!;
          cy += args[i + 1]!;
          points.push({ x: cx, y: cy });
        }
        break;
      // Arc — skip to endpoint (7 params per arc)
      case 'A':
        for (let i = 0; i + 6 < args.length; i += 7) {
          cx = args[i + 5]!;
          cy = args[i + 6]!;
          points.push({ x: cx, y: cy });
        }
        break;
      case 'a':
        for (let i = 0; i + 6 < args.length; i += 7) {
          cx += args[i + 5]!;
          cy += args[i + 6]!;
          points.push({ x: cx, y: cy });
        }
        break;
      default:
        break;
    }
  }

  return points;
}

/** Scanline fill a polygon onto a canvas. */
export function fillPolygon(canvas: Canvas, points: Point[], color: ColorLike): void {
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
  targetRect?: [number, number, number, number],
): void {
  const points = parseSvgPath(d);
  const [tx, ty, tw, th] = targetRect ?? [0, 0, canvas.width, canvas.height];
  const [vw, vh] = svgViewBox;
  if (vw === 0 || vh === 0) return;

  const scaled = points.map((p) => ({
    x: tx + (p.x / vw) * tw,
    y: ty + (p.y / vh) * th,
  }));

  fillPolygon(canvas, scaled, color);
}
