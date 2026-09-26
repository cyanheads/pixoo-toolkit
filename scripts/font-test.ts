/**
 * Font test sheet, two frames the device alternates between. Frame 1: mixed
 * case and ASCII symbols in FONT_5x7 and FONT_3x5. Frame 2: the glyphs past
 * ASCII in both fonts, then FONT_DIGITS_11x18.
 */

import {
  PixooClient,
  Canvas,
  Color,
  drawText,
  drawTextCentered,
  savePng,
  FONT_5x7,
  FONT_3x5,
  FONT_DIGITS_11x18,
} from '../src/index.js';
import { deviceFromEnv } from './env.js';

const { ip, size } = deviceFromEnv();
const device = new PixooClient(ip, { size });

// --- Frame 1: ASCII ---
const ascii = new Canvas(size);
ascii.clear([8, 6, 18]);

// FONT_5x7 mixed case
drawText(ascii, '5x7:', 1, 0, Color.GRAY, { font: FONT_3x5 });
drawText(ascii, 'Hello World', 1, 6, Color.WHITE, { font: FONT_5x7 });
drawText(ascii, 'abcdefghij', 1, 14, Color.CYAN, { font: FONT_5x7 });

// FONT_3x5 mixed case + full symbol coverage
drawText(ascii, '3x5:', 1, 22, Color.GRAY, { font: FONT_3x5 });
drawText(ascii, 'Hello World', 1, 28, Color.WHITE, { font: FONT_3x5 });
drawText(ascii, 'ABCDEFGHIJKLM', 1, 34, 'claude', { font: FONT_3x5 });
drawText(ascii, 'abcdefghijklm', 1, 40, 'gold', { font: FONT_3x5 });
drawText(ascii, 'nopqrstuvwxyz', 1, 46, 'lime', { font: FONT_3x5 });
drawText(ascii, '"#$%&\'*;<=>?', 1, 52, 'turquoise', { font: FONT_3x5 });
drawText(ascii, '@[\\]^_`{|}~', 1, 58, 'violet', { font: FONT_3x5 });

// --- Frame 2: glyphs past ASCII, then the numeral face ---
const symbols = new Canvas(size);
symbols.clear([8, 6, 18]);

drawText(symbols, '72°F ▲▼ ♥', 1, 0, Color.WHITE, { font: FONT_5x7 });
drawText(symbols, '←↑→↓ ·…', 1, 8, Color.CYAN, { font: FONT_5x7 });
drawText(symbols, '72°F ▲▼♥ ←↑→↓ ·…', 1, 16, 'gold', { font: FONT_3x5 });
drawTextCentered(symbols, '12:45', 23, 'claude', { font: FONT_DIGITS_11x18 });
drawTextCentered(symbols, '-12.5°', 44, 'turquoise', { font: FONT_DIGITS_11x18 });

await savePng(ascii, 'output/font_test.png', 8);
await savePng(symbols, 'output/font_test_2.png', 8);
const res = await device.pushAnimation([ascii, symbols], 4000);
console.log('Push:', res);
