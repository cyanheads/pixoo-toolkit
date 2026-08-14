import { PixooClient, Canvas, Color, drawText, savePng, FONT_5x7, FONT_3x5 } from '../src/index.js';
import { deviceFromEnv } from './env.js';

const { ip, size } = deviceFromEnv();
const device = new PixooClient(ip, { size });
const canvas = new Canvas(size);

canvas.clear([8, 6, 18]);

// --- FONT_5x7 mixed case ---
drawText(canvas, '5x7:', 1, 0, Color.GRAY, { font: FONT_3x5 });
drawText(canvas, 'Hello World', 1, 6, Color.WHITE, { font: FONT_5x7 });
drawText(canvas, 'abcdefghij', 1, 14, Color.CYAN, { font: FONT_5x7 });

// --- FONT_3x5 mixed case + full symbol coverage ---
drawText(canvas, '3x5:', 1, 22, Color.GRAY, { font: FONT_3x5 });
drawText(canvas, 'Hello World', 1, 28, Color.WHITE, { font: FONT_3x5 });
drawText(canvas, 'ABCDEFGHIJKLM', 1, 34, 'claude', { font: FONT_3x5 });
drawText(canvas, 'abcdefghijklm', 1, 40, 'gold', { font: FONT_3x5 });
drawText(canvas, 'nopqrstuvwxyz', 1, 46, 'lime', { font: FONT_3x5 });
drawText(canvas, '"#$%&\'*;<=>?', 1, 52, 'turquoise', { font: FONT_3x5 });
drawText(canvas, '@[\\]^_`{|}~', 1, 58, 'violet', { font: FONT_3x5 });

await savePng(canvas, 'output/font_test.png', 8);
const res = await device.push(canvas);
console.log('Push:', res);
