/**
 * Color calibration chart for the Pixoo-64.
 *
 * Displays a 4×4 grid of numbered color swatches so we can map
 * what the software sends vs. what the LED panel actually shows.
 */

import {
  Canvas,
  PixooClient,
  drawText,
  measureText,
  savePng,
  FONT_3x5,
  type RGB,
} from '../src/index.js';

const DEVICE_IP = process.env.PIXOO_IP;
if (!DEVICE_IP) throw new Error('PIXOO_IP environment variable is required');

// 16 colors to test — good spread across hue/saturation/value
const TEST_COLORS: Array<{ label: string; rgb: RGB }> = [
  { label: 'RED', rgb: [255, 0, 0] },
  { label: 'GREEN', rgb: [0, 255, 0] },
  { label: 'BLUE', rgb: [0, 0, 255] },
  { label: 'YELLOW', rgb: [255, 255, 0] },
  { label: 'CYAN', rgb: [0, 255, 255] },
  { label: 'MAGENTA', rgb: [255, 0, 255] },
  { label: 'ORANGE', rgb: [255, 165, 0] },
  { label: 'PINK', rgb: [255, 105, 180] },
  { label: 'PURPLE', rgb: [128, 0, 128] },
  { label: 'TEAL', rgb: [0, 128, 128] },
  { label: 'CORAL', rgb: [255, 127, 80] },
  { label: 'GOLD', rgb: [255, 215, 0] },
  { label: 'WHITE', rgb: [255, 255, 255] },
  { label: 'GRAY', rgb: [128, 128, 128] },
  { label: 'VIOLET', rgb: [238, 130, 238] },
  { label: 'BROWN', rgb: [139, 69, 19] },
];

function luminance([r, g, b]: RGB): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

const canvas = new Canvas();
canvas.clear([0, 0, 0]);

const COLS = 4;
const CELL_W = 16; // 64 / 4
const CELL_H = 16;

for (let i = 0; i < TEST_COLORS.length; i++) {
  const { rgb } = TEST_COLORS[i]!;
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const x = col * CELL_W;
  const y = row * CELL_H;

  // Fill swatch
  canvas.fillRect(x, y, CELL_W, CELL_H, rgb);

  // Draw 1px black border for separation
  canvas.drawRect(x, y, CELL_W, CELL_H, [0, 0, 0]);

  // Number label — white on dark, black on light
  const num = String(i + 1);
  const textColor: RGB = luminance(rgb) > 140 ? [0, 0, 0] : [255, 255, 255];

  // Center the number in the cell
  const textW = measureText(num, { font: FONT_3x5 });
  const textH = FONT_3x5.height;
  const tx = x + Math.floor((CELL_W - textW) / 2);
  const ty = y + Math.floor((CELL_H - textH) / 2);

  drawText(canvas, num, tx, ty, textColor, { font: FONT_3x5 });
}

// Save preview and push
await savePng(canvas, 'output/color-test.png');

const client = new PixooClient(DEVICE_IP);
const res = await client.push(canvas);
console.log('Pushed color test chart:', res);
console.log('\nColor key:');
TEST_COLORS.forEach((c, i) => {
  console.log(`  ${String(i + 1).padStart(2)}. ${c.label.padEnd(8)} RGB(${c.rgb.join(', ')})`);
});
