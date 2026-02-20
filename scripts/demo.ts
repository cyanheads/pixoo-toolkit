/**
 * Generates a pixel-art header image for the pixoo-toolkit README.
 * Static 64×64 canvas → 512×512 PNG.
 */
import {
  Canvas,
  Color,
  PixooClient,
  drawTextCentered,
  savePng,
  hslToRgb,
  dimColor,
  FONT_5x7,
  type RGB,
} from '../src/index.js';

const ip = process.env.PIXOO_IP;
if (!ip) throw new Error('PIXOO_IP environment variable is required');
const device = new PixooClient(ip);

// Deterministic PRNG for reproducible starfield
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Glowing orb: radial gradient within a circle, blending into existing pixels
function drawGlowOrb(
  canvas: Canvas,
  cx: number,
  cy: number,
  radius: number,
  coreColor: RGB,
  falloff = 2,
) {
  const r2 = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(63, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(63, Math.ceil(cx + radius)); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const t = Math.sqrt(d2) / radius;
      const alpha = Math.pow(1 - t, falloff);
      canvas.blendPixel(x, y, coreColor, alpha);
    }
  }
}

const canvas = new Canvas();

// --- Background: deep space radial gradient ---
canvas.gradientRadial(32, 28, 52, [18, 12, 42], [4, 2, 10]);

// --- Starfield ---
const rng = mulberry32(1337);
for (let i = 0; i < 60; i++) {
  const x = Math.floor(rng() * 64);
  const y = Math.floor(rng() * 64);
  const b = 30 + Math.floor(rng() * 140);
  const star: RGB = rng() > 0.7 ? [b, b, Math.min(255, b + 50)] : [b, b, b];
  canvas.setPixel(x, y, star);
}

// --- Glowing orbs (background visual elements) ---
drawGlowOrb(canvas, 32, 46, 14, [255, 130, 40], 1.8); // warm central orb
drawGlowOrb(canvas, 12, 38, 6, [60, 200, 180], 2.0); // teal accent left
drawGlowOrb(canvas, 52, 38, 6, [180, 100, 220], 2.0); // purple accent right

// --- Geometric accents ---
// Triangles flanking the orb
canvas.fillTriangle(4, 56, 10, 42, 16, 56, [40, 150, 200]);
canvas.fillTriangle(48, 56, 54, 42, 60, 56, [200, 70, 120]);

// Small diamond shapes
canvas.fillTriangle(22, 52, 25, 48, 28, 52, [220, 180, 60]);
canvas.fillTriangle(36, 52, 39, 48, 42, 52, [60, 220, 140]);

// Thin accent lines from orb
canvas.drawLine(20, 46, 8, 58, [80, 50, 20]);
canvas.drawLine(44, 46, 56, 58, [80, 50, 20]);

// --- Rainbow gradient bar ---
for (let x = 4; x < 60; x++) {
  const hue = ((x - 4) / 56) * 360;
  const c = hslToRgb([hue, 0.9, 0.55]);
  canvas.setPixel(x, 20, c);
  canvas.setPixel(x, 21, dimColor(c, 0.5));
}

// --- LED matrix motif (bottom corners) ---
for (let gx = 0; gx < 3; gx++) {
  for (let gy = 0; gy < 3; gy++) {
    const c = hslToRgb([(gx * 3 + gy) * 40, 0.8, 0.45]);
    canvas.setPixel(1 + gx * 2, 59 + gy * 2, c);
  }
}
for (let gx = 0; gx < 3; gx++) {
  for (let gy = 0; gy < 3; gy++) {
    const c = hslToRgb([180 + (gx * 3 + gy) * 40, 0.8, 0.45]);
    canvas.setPixel(57 + gx * 2, 59 + gy * 2, c);
  }
}

// --- Text ---
drawTextCentered(canvas, 'PIXOO', 4, Color.WHITE, { font: FONT_5x7, scale: 2 });
drawTextCentered(canvas, 'toolkit', 24, [140, 210, 255], { font: FONT_5x7 });

// --- Save & push ---
await savePng(canvas, 'output/readme_header.png');
console.log('Saved output/readme_header.png');

const res = await device.push(canvas);
console.log('Push:', res);
