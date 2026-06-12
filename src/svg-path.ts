/**
 * Minimal SVG path parser + rasterizer.
 *
 * Parses SVG path `d` attributes (M/m, L/l, H/h, V/v, Z/z, C/c, S/s, Q/q,
 * T/t, A/a, and implicit lineTo after moveTo) into subpaths, then rasterizes
 * with even-odd scanline fill — multiple subpaths produce holes (donuts,
 * letter counters), matching SVG fill semantics.
 *
 * Cubic and quadratic Béziers (C/c, S/s, Q/q, T/t) are flattened by sampling
 * CURVE_SAMPLES points per segment, with smooth-command control-point
 * reflection. Elliptical arcs (A/a) are approximated by a straight line to
 * their endpoint.
 */

import { Canvas } from './canvas.js';
import { type ColorLike, resolveColor } from './color.js';

export interface Point {
  x: number;
  y: number;
}

/** Points sampled per Bézier segment — plenty at Pixoo resolutions. */
const CURVE_SAMPLES = 12;

/** Matches one SVG number, including compact decimals (`.5.5`) and exponents. */
const NUMBER_RE = /[+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?/g;

/** Tokenize an SVG path `d` string into commands + coordinate arrays. */
function tokenize(d: string): Array<{ cmd: string; args: number[] }> {
  const tokens: Array<{ cmd: string; args: number[] }> = [];
  const re = /([MmLlHhVvZzCcSsQqTtAa])([^MmLlHhVvZzCcSsQqTtAa]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    tokens.push({ cmd: match[1]!, args: match[2]!.match(NUMBER_RE)?.map(Number) ?? [] });
  }
  return tokens;
}

/**
 * Parse an SVG path into subpaths — one point ring per M/m or Z/z boundary.
 * Rings are NOT explicitly closed unless the path used Z/z; the fill
 * functions close each ring implicitly, per SVG fill semantics.
 */
export function parseSvgPathSubpaths(d: string): Point[][] {
  const tokens = tokenize(d);
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let cx = 0,
    cy = 0;
  let subpathStartX = 0,
    subpathStartY = 0;
  // Last control point of the previous C/S (or Q/T) segment, for smooth reflection
  let prevCubicCtrl: Point | null = null;
  let prevQuadCtrl: Point | null = null;

  const endSubpath = (): void => {
    if (current.length > 0) subpaths.push(current);
    current = [];
  };
  /** Ensure the current subpath includes its starting point before a draw command extends it. */
  const begin = (): void => {
    if (current.length === 0) current.push({ x: cx, y: cy });
  };
  const lineTo = (x: number, y: number): void => {
    begin();
    cx = x;
    cy = y;
    current.push({ x, y });
  };
  const cubicTo = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ): void => {
    begin();
    const x0 = cx,
      y0 = cy;
    for (let s = 1; s <= CURVE_SAMPLES; s++) {
      const t = s / CURVE_SAMPLES;
      const u = 1 - t;
      current.push({
        x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      });
    }
    cx = x3;
    cy = y3;
  };
  const quadTo = (x1: number, y1: number, x2: number, y2: number): void => {
    begin();
    const x0 = cx,
      y0 = cy;
    for (let s = 1; s <= CURVE_SAMPLES; s++) {
      const t = s / CURVE_SAMPLES;
      const u = 1 - t;
      current.push({
        x: u * u * x0 + 2 * u * t * x1 + t * t * x2,
        y: u * u * y0 + 2 * u * t * y1 + t * t * y2,
      });
    }
    cx = x2;
    cy = y2;
  };

  for (const { cmd, args } of tokens) {
    switch (cmd) {
      case 'M':
      case 'm': {
        const abs = cmd === 'M';
        endSubpath();
        if (args.length >= 2) {
          cx = abs ? args[0]! : cx + args[0]!;
          cy = abs ? args[1]! : cy + args[1]!;
          subpathStartX = cx;
          subpathStartY = cy;
          current.push({ x: cx, y: cy });
          // Implicit lineTo for remaining pairs
          for (let i = 2; i + 1 < args.length; i += 2) {
            cx = abs ? args[i]! : cx + args[i]!;
            cy = abs ? args[i + 1]! : cy + args[i + 1]!;
            current.push({ x: cx, y: cy });
          }
        }
        break;
      }
      case 'L':
      case 'l': {
        const abs = cmd === 'L';
        for (let i = 0; i + 1 < args.length; i += 2) {
          lineTo(abs ? args[i]! : cx + args[i]!, abs ? args[i + 1]! : cy + args[i + 1]!);
        }
        break;
      }
      case 'H':
      case 'h':
        for (const a of args) lineTo(cmd === 'H' ? a : cx + a, cy);
        break;
      case 'V':
      case 'v':
        for (const a of args) lineTo(cx, cmd === 'V' ? a : cy + a);
        break;
      case 'Z':
      case 'z':
        if (current.length > 0) {
          cx = subpathStartX;
          cy = subpathStartY;
          current.push({ x: cx, y: cy });
          endSubpath();
        }
        break;
      case 'C':
      case 'c': {
        const abs = cmd === 'C';
        for (let i = 0; i + 5 < args.length; i += 6) {
          const c2x = abs ? args[i + 2]! : cx + args[i + 2]!;
          const c2y = abs ? args[i + 3]! : cy + args[i + 3]!;
          cubicTo(
            abs ? args[i]! : cx + args[i]!,
            abs ? args[i + 1]! : cy + args[i + 1]!,
            c2x,
            c2y,
            abs ? args[i + 4]! : cx + args[i + 4]!,
            abs ? args[i + 5]! : cy + args[i + 5]!,
          );
          prevCubicCtrl = { x: c2x, y: c2y };
        }
        break;
      }
      case 'S':
      case 's': {
        const abs = cmd === 'S';
        for (let i = 0; i + 3 < args.length; i += 4) {
          // Reflect the previous cubic control point; fall back to the current point
          const c1x = prevCubicCtrl ? 2 * cx - prevCubicCtrl.x : cx;
          const c1y = prevCubicCtrl ? 2 * cy - prevCubicCtrl.y : cy;
          const c2x = abs ? args[i]! : cx + args[i]!;
          const c2y = abs ? args[i + 1]! : cy + args[i + 1]!;
          cubicTo(
            c1x,
            c1y,
            c2x,
            c2y,
            abs ? args[i + 2]! : cx + args[i + 2]!,
            abs ? args[i + 3]! : cy + args[i + 3]!,
          );
          prevCubicCtrl = { x: c2x, y: c2y };
        }
        break;
      }
      case 'Q':
      case 'q': {
        const abs = cmd === 'Q';
        for (let i = 0; i + 3 < args.length; i += 4) {
          const c1x = abs ? args[i]! : cx + args[i]!;
          const c1y = abs ? args[i + 1]! : cy + args[i + 1]!;
          quadTo(
            c1x,
            c1y,
            abs ? args[i + 2]! : cx + args[i + 2]!,
            abs ? args[i + 3]! : cy + args[i + 3]!,
          );
          prevQuadCtrl = { x: c1x, y: c1y };
        }
        break;
      }
      case 'T':
      case 't': {
        const abs = cmd === 'T';
        for (let i = 0; i + 1 < args.length; i += 2) {
          // Explicit annotations break the c1x -> prevQuadCtrl -> c1x inference cycle
          const c1x: number = prevQuadCtrl ? 2 * cx - prevQuadCtrl.x : cx;
          const c1y: number = prevQuadCtrl ? 2 * cy - prevQuadCtrl.y : cy;
          quadTo(c1x, c1y, abs ? args[i]! : cx + args[i]!, abs ? args[i + 1]! : cy + args[i + 1]!);
          prevQuadCtrl = { x: c1x, y: c1y };
        }
        break;
      }
      // Arc — approximated by a straight line to the endpoint (7 params per arc)
      case 'A':
      case 'a': {
        const abs = cmd === 'A';
        for (let i = 0; i + 6 < args.length; i += 7) {
          lineTo(abs ? args[i + 5]! : cx + args[i + 5]!, abs ? args[i + 6]! : cy + args[i + 6]!);
        }
        break;
      }
      default:
        break;
    }
    // Smooth reflection only chains off the matching curve type (SVG spec)
    if (cmd !== 'C' && cmd !== 'c' && cmd !== 'S' && cmd !== 's') prevCubicCtrl = null;
    if (cmd !== 'Q' && cmd !== 'q' && cmd !== 'T' && cmd !== 't') prevQuadCtrl = null;
  }
  endSubpath();

  return subpaths;
}

/**
 * Parse an SVG path into a flat point list (subpaths concatenated).
 * For filling multi-subpath paths, prefer `parseSvgPathSubpaths` — the flat
 * list loses subpath boundaries.
 */
export function parseSvgPath(d: string): Point[] {
  return parseSvgPathSubpaths(d).flat();
}

/**
 * Even-odd scanline fill across one or more point rings.
 * Each ring is implicitly closed (last point connects back to the first),
 * so unclosed paths fill like their Z-terminated equivalents. Overlapping
 * rings produce holes, per SVG even-odd fill semantics.
 */
export function fillSubpaths(canvas: Canvas, subpaths: readonly Point[][], color: ColorLike): void {
  const rings = subpaths.filter((ring) => ring.length >= 3);
  if (rings.length === 0) return;
  const [r, g, b] = resolveColor(color);

  // Find bounding box
  let minY = Infinity,
    maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(canvas.height - 1, Math.ceil(maxY));

  for (let y = yStart; y <= yEnd; y++) {
    const scanY = y + 0.5;
    const intersections: number[] = [];

    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b2 = ring[(i + 1) % ring.length]!; // modulo edge implicitly closes the ring

        if ((a.y <= scanY && b2.y > scanY) || (b2.y <= scanY && a.y > scanY)) {
          const t = (scanY - a.y) / (b2.y - a.y);
          intersections.push(a.x + t * (b2.x - a.x));
        }
      }
    }

    intersections.sort((m, n) => m - n);

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

/** Scanline fill a single polygon ring (implicitly closed) onto a canvas. */
export function fillPolygon(canvas: Canvas, points: Point[], color: ColorLike): void {
  fillSubpaths(canvas, [points], color);
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
  const subpaths = parseSvgPathSubpaths(d);
  const [tx, ty, tw, th] = targetRect ?? [0, 0, canvas.width, canvas.height];
  const [vw, vh] = svgViewBox;
  if (vw === 0 || vh === 0) return;

  const scaled = subpaths.map((ring) =>
    ring.map((p) => ({
      x: tx + (p.x / vw) * tw,
      y: ty + (p.y / vh) * th,
    })),
  );

  fillSubpaths(canvas, scaled, color);
}
