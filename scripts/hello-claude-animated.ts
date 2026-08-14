import {
  PixooClient,
  Color,
  resolveColor,
  drawText,
  drawTextCentered,
  savePng,
  FONT_5x7,
  measureText,
  downsampleSprite,
  renderSprite,
  buildAnimation,
  type RGB,
} from '../src/index.js';
import { deviceFromEnv } from './env.js';

const { ip, size } = deviceFromEnv();
const device = new PixooClient(ip, { size });
const claudeOrange = resolveColor('claude');
const eyeColor: RGB = [20, 12, 12];

// Load base sprite
const sprite = await downsampleSprite('assets/clawd.png', 10, 8);

// Animation: 20 frames
// 0-3:   idle
// 4-5:   bounce up
// 6-7:   bounce down
// 8-9:   lean left
// 10-11: lean right
// 12-13: lean left
// 14-15: lean right
// 16-17: wink + bounce up
// 18:    wink
// 19:    idle

const FRAMES = 20;
const SPEED = 150;

const anim = buildAnimation(
  FRAMES,
  SPEED,
  (frame, i) => {
    frame.clear([12, 8, 20]);

    // Determine sprite variant and position offset
    let dx = 0;
    let dy = 0;
    const winking = i >= 16 && i <= 18;

    if (i === 4 || i === 5) {
      dy = -2; // bounce up
    } else if (i === 6 || i === 7) {
      dy = 1; // squash down
    } else if (i === 8 || i === 12) {
      dx = -2; // lean left
    } else if (i === 9 || i === 13) {
      dx = -3; // lean more left
    } else if (i === 10 || i === 14) {
      dx = 2; // lean right
    } else if (i === 11 || i === 15) {
      dx = 3; // lean more right
    } else if (i === 16 || i === 17) {
      dy = -2; // bounce up + wink
    }

    const spriteX = Math.floor((frame.width - 10 * 4) / 2) + dx;
    const spriteY = 24 + dy;

    renderSprite(frame, sprite.grid, {
      scale: 4,
      x: spriteX,
      y: spriteY,
      bodyColor: claudeOrange,
      originalBodyColor: sprite.bodyColor,
      darkColor: eyeColor,
      originalDarkColor: sprite.darkColor,
    });

    // Half-wink: cover bottom half of right eye with body color
    if (winking) {
      // Right eye is at grid col 7, row 2. At scale 4: pixel (7*4, 2*4) relative to sprite origin
      const eyeX = spriteX + 7 * 4;
      const eyeY = spriteY + 2 * 4;
      // Cover bottom 2px of the 4px-tall eye
      frame.fillRect(eyeX, eyeY + 2, 4, 2, claudeOrange);
    }

    // Text
    drawTextCentered(frame, 'Hello', 2, Color.WHITE, { font: FONT_5x7 });

    const fromW = measureText('from ', { font: FONT_5x7 });
    const claudeW = measureText('Claude', { font: FONT_5x7 });
    const totalW = fromW + claudeW;
    const startX = Math.floor((frame.width - totalW) / 2);
    drawText(frame, 'from ', startX, 12, Color.WHITE, { font: FONT_5x7 });
    drawText(frame, 'Claude', startX + fromW, 12, claudeOrange, { font: FONT_5x7 });
  },
  size,
);

// Save first frame preview
await savePng(anim.frames[0]!, 'output/hello_claude_animated.png');

// Push
const res = await device.pushAnimation(anim.frames, anim.speed);
console.log('Push:', res);
