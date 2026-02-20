/**
 * Demo: Exercises the full Pixoo toolkit — canvas, text, colors, animation, preview.
 *
 * Sends a short animation to the device and saves preview PNGs.
 */
import {
  PixooClient,
  Canvas,
  Color,
  buildAnimation,
  drawText,
  drawTextCentered,
  savePng,
  hslToRgb,
  FONT_3x5,
  FONT_5x7,
} from '../src/index.js';

const DEVICE_IP = process.env.PIXOO_IP;
if (!DEVICE_IP) throw new Error('PIXOO_IP environment variable is required');
const device = new PixooClient(DEVICE_IP);

// --- Static frame demo ---
console.log('Drawing static frame...');
const canvas = new Canvas();

// Background gradient
canvas.gradientV([10, 5, 30], [5, 15, 40]);

// Starfield
for (let i = 0; i < 40; i++) {
  const x = Math.floor(Math.random() * 64);
  const y = Math.floor(Math.random() * 64);
  const brightness = 60 + Math.floor(Math.random() * 180);
  canvas.setPixel(x, y, [brightness, brightness, brightness]);
}

// Draw shapes
canvas.fillCircle(32, 36, 12, [0, 80, 180]);
canvas.drawCircle(32, 36, 14, [40, 120, 220]);

// Text
drawTextCentered(canvas, 'PIXOO', 4, Color.WHITE, { font: FONT_5x7 });
drawTextCentered(canvas, 'TOOLKIT', 14, [100, 200, 255], { font: FONT_3x5 });
drawText(canvas, 'v0.1', 23, 56, [80, 80, 100], { font: FONT_3x5 });

// Save preview
await savePng(canvas, 'output/demo_static.png');
console.log('Saved output/demo_static.png');

// Push to device
const res = await device.push(canvas);
console.log('Push result:', res);

// --- Animation demo ---
console.log('\nBuilding animation...');
const anim = buildAnimation(20, 120, (frame, i, total) => {
  frame.gradientV([10, 5, 30], [5, 15, 40]);

  // Orbiting dot
  const angle = (i / total) * Math.PI * 2;
  const ox = 32 + Math.cos(angle) * 20;
  const oy = 36 + Math.sin(angle) * 16;
  const color = hslToRgb([(i / total) * 360, 0.9, 0.6]);
  frame.fillCircle(ox, oy, 4, color);

  // Trail
  for (let t = 1; t <= 5; t++) {
    const trailAngle = ((i - t) / total) * Math.PI * 2;
    const tx = 32 + Math.cos(trailAngle) * 20;
    const ty = 36 + Math.sin(trailAngle) * 16;
    const alpha = 1 - t / 6;
    frame.blendPixel(tx, ty, color, alpha * 0.6);
    frame.blendPixel(tx + 1, ty, color, alpha * 0.3);
    frame.blendPixel(tx, ty + 1, color, alpha * 0.3);
  }

  // Center text
  drawTextCentered(frame, 'HELLO', 6, Color.WHITE, { font: FONT_5x7 });
  drawTextCentered(frame, 'WORLD', 16, [100, 200, 255], { font: FONT_3x5 });
});

// Save first frame preview
await savePng(anim.frames[0]!, 'output/demo_anim_frame0.png');
console.log('Saved output/demo_anim_frame0.png');

// Push animation to device
const animRes = await device.pushAnimation(anim.frames, anim.speed);
console.log('Animation push result:', animRes);

console.log('\nDone!');
