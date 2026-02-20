import {
  PixooClient,
  Color,
  NAMED_COLORS,
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

const ip = process.env.PIXOO_IP;
if (!ip) throw new Error('PIXOO_IP environment variable is required');
const device = new PixooClient(ip);
const claudeOrange = NAMED_COLORS.claude;
const eyeColor: RGB = [20, 12, 12];

// Load base sprite
const sprite = await downsampleSprite('assets/clawd.png', 10, 8);

// Wink flag — drawn as a post-processing step so we can do half-eye
let winking = false;

// Shift the whole sprite left/right by nudging the render offset
// Bounce: shift Y offset

// Animation: 20 frames
// 0-3:   idle
// 4-5:   bounce up
// 6-7:   bounce down
// 8-9:   lean left
// 10-11: lean right
// 12-13: lean left
// 14-15: lean right
// 16-17: wink + bounce up
// 18-19: idle

const FRAMES = 20;
const SPEED = 150;

const anim = buildAnimation(FRAMES, SPEED, (frame, i) => {
  frame.clear([12, 8, 20]);

  // Determine sprite variant and position offset
  const grid = sprite.grid;
  let dx = 0;
  let dy = 0;
  winking = false;

  if (i >= 0 && i <= 3) {
    // idle
  } else if (i === 4 || i === 5) {
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
  } else if (i >= 16 && i <= 18) {
    if (i === 16 || i === 17) dy = -2; // bounce up + wink
    winking = true;
  }

  renderSprite(frame, grid, {
    scale: 4,
    x: Math.floor((64 - 10 * 4) / 2) + dx,
    y: 24 + dy,
    bodyColor: claudeOrange,
    originalBodyColor: sprite.bodyColor,
    darkColor: eyeColor,
    originalDarkColor: sprite.darkColor,
  });

  // Half-wink: cover bottom half of right eye with body color
  if (winking) {
    const spriteOx = Math.floor((64 - 10 * 4) / 2) + dx;
    const spriteOy = 24 + dy;
    // Right eye is at grid col 7, row 2. At scale 4: pixel (7*4, 2*4) relative to sprite origin
    const eyeX = spriteOx + 7 * 4;
    const eyeY = spriteOy + 2 * 4;
    // Cover bottom 2px of the 4px-tall eye
    frame.fillRect(eyeX, eyeY + 2, 4, 2, claudeOrange);
  }

  // Text
  drawTextCentered(frame, 'Hello', 2, Color.WHITE, { font: FONT_5x7 });

  const fromW = measureText('from ', { font: FONT_5x7 });
  const claudeW = measureText('Claude', { font: FONT_5x7 });
  const totalW = fromW + claudeW;
  const startX = Math.floor((64 - totalW) / 2);
  drawText(frame, 'from ', startX, 12, Color.WHITE, { font: FONT_5x7 });
  drawText(frame, 'Claude', startX + fromW, 12, claudeOrange, { font: FONT_5x7 });
});

// Save first frame preview
await savePng(anim.frames[0]!, 'output/hello_claude_animated.png');

// Push
const res = await device.pushAnimation(anim.frames, anim.speed);
console.log('Push:', res);
