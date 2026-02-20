import {
  PixooClient,
  Canvas,
  Color,
  NAMED_COLORS,
  drawText,
  drawTextCentered,
  savePng,
  FONT_5x7,
  measureText,
  downsampleSprite,
  renderSprite,
} from '../src/index.js';

const ip = process.env.PIXOO_IP;
if (!ip) throw new Error('PIXOO_IP environment variable is required');
const device = new PixooClient(ip);
const canvas = new Canvas();

canvas.clear([12, 8, 20]);

// --- Clawd: load from actual PNG ---
const claudeOrange = NAMED_COLORS.claude;
const sprite = await downsampleSprite('assets/clawd.png', 10, 8);
renderSprite(canvas, sprite.grid, {
  scale: 4,
  y: 24,
  bodyColor: claudeOrange,
  originalBodyColor: sprite.bodyColor,
});

// --- Text ---
drawTextCentered(canvas, 'Hello', 2, Color.WHITE, { font: FONT_5x7 });

const fromW = measureText('from ', { font: FONT_5x7 });
const claudeW = measureText('Claude', { font: FONT_5x7 });
const totalW = fromW + claudeW;
const startX = Math.floor((64 - totalW) / 2);
drawText(canvas, 'from ', startX, 12, Color.WHITE, { font: FONT_5x7 });
drawText(canvas, 'Claude', startX + fromW, 12, claudeOrange, { font: FONT_5x7 });

// --- Push ---
await savePng(canvas, 'output/hello_claude.png');
const res = await device.push(canvas);
console.log('Push:', res);
