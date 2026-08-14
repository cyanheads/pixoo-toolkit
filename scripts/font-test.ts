import {
  PixooClient,
  Canvas,
  Color,
  NAMED_COLORS,
  drawText,
  savePng,
  FONT_5x7,
  FONT_3x5,
} from '../src/index.js';

const ip = process.env.PIXOO_IP;
if (!ip) throw new Error('PIXOO_IP environment variable is required');
const device = new PixooClient(ip);
const canvas = new Canvas();

canvas.clear([8, 6, 18]);

// --- FONT_5x7 mixed case ---
drawText(canvas, '5x7:', 1, 0, NAMED_COLORS.gray, { font: FONT_3x5 });
drawText(canvas, 'Hello World', 1, 6, Color.WHITE, { font: FONT_5x7 });
drawText(canvas, 'abcdefghij', 1, 14, NAMED_COLORS.cyan, { font: FONT_5x7 });

// --- FONT_3x5 mixed case + full symbol coverage ---
drawText(canvas, '3x5:', 1, 22, NAMED_COLORS.gray, { font: FONT_3x5 });
drawText(canvas, 'Hello World', 1, 28, Color.WHITE, { font: FONT_3x5 });
drawText(canvas, 'ABCDEFGHIJKLM', 1, 34, NAMED_COLORS.claude, { font: FONT_3x5 });
drawText(canvas, 'abcdefghijklm', 1, 40, NAMED_COLORS.gold, { font: FONT_3x5 });
drawText(canvas, 'nopqrstuvwxyz', 1, 46, NAMED_COLORS.lime, { font: FONT_3x5 });
drawText(canvas, '"#$%&\'*;<=>?', 1, 52, NAMED_COLORS.turquoise, { font: FONT_3x5 });
drawText(canvas, '@[\\]^_`{|}~', 1, 58, NAMED_COLORS.violet, { font: FONT_3x5 });

await savePng(canvas, 'output/font_test.png', 8);
const res = await device.push(canvas);
console.log('Push:', res);
