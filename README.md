# @cyanheads/pixoo

TypeScript toolkit for the Divoom Pixoo-64 — pixel rendering, animations, and device control over the local HTTP API.

## Features

- **Canvas**: 64×64 RGB pixel buffer with drawing primitives (rects, circles, lines, triangles, gradients, blending, scrolling)
- **Bitmap fonts**: Two built-in sizes (5×7 full ASCII, 3×5 compact) with text measurement and centered rendering
- **Color system**: RGB/HSL types, 30+ named colors, interpolation, hex parsing
- **Device client**: Full Pixoo-64 HTTP API — push frames, animations, channel/brightness control, text overlays, scoreboard, timer, buzzer
- **Image loading**: Resize any image to canvas via sharp, sprite downsampling with color classification
- **Animation builder**: Multi-frame sequences with per-frame render callbacks
- **SVG path rendering**: Parse SVG `d` attributes and rasterize with scanline fill
- **PNG export**: Zero-dependency encoder (only `node:zlib`) with nearest-neighbor upscaling for previews

## Requirements

- Node.js >= 20
- Divoom Pixoo-64 on the same network

## Install

```bash
npm install
```

## Usage

```bash
# Build
npx tsc

# Run a script
npx tsc && node dist/scripts/hello-claude.js

# Run the demo
npm run demo
```

### Quick example

```typescript
import { PixooClient, Canvas, Color, drawTextCentered, FONT_5x7, savePng } from '@cyanheads/pixoo';

const device = new PixooClient('10.1.20.114');
const canvas = new Canvas();

canvas.gradientV([10, 5, 30], [5, 15, 40]);
drawTextCentered(canvas, 'HELLO', 28, Color.WHITE, { font: FONT_5x7 });

await savePng(canvas, 'output/hello.png');
await device.push(canvas);
```

### Animation

```typescript
import { PixooClient, buildAnimation, drawTextCentered, hslToRgb, Color, FONT_5x7 } from '@cyanheads/pixoo';

const device = new PixooClient('10.1.20.114');
const anim = buildAnimation(20, 120, (frame, i, total) => {
  frame.clear('black');
  const color = hslToRgb([(i / total) * 360, 0.9, 0.6]);
  frame.fillCircle(32, 32, 10 + i, color);
  drawTextCentered(frame, 'HI', 28, Color.WHITE, { font: FONT_5x7 });
});

await device.pushAnimation(anim.frames, anim.speed);
```

### Loading images

```typescript
import { loadImage, downsampleSprite, renderSprite, Canvas, savePng } from '@cyanheads/pixoo';

// Full-resolution resize to 64×64
const canvas = await loadImage('assets/photo.png');

// Or downsample into a pixel-art sprite grid
const sprite = await downsampleSprite('assets/clawd.png', 10, 8);
const c = new Canvas();
renderSprite(c, sprite.grid, { scale: 4, y: 24 });
await savePng(c, 'output/sprite.png');
```

## Project structure

```
src/
  canvas.ts       64×64 pixel buffer + drawing primitives
  client.ts       PixooClient — HTTP device control
  color.ts        RGB/HSL types, named colors, utilities
  font.ts         Bitmap fonts, text rendering
  image.ts        Image loading (sharp), sprite downsampling
  animation.ts    Multi-frame animation builder
  preview.ts      Zero-dep PNG encoder
  svg-path.ts     SVG path parser + polygon rasterizer
  index.ts        Barrel export
scripts/          Runnable display scripts
assets/           Source images (PNGs) for sprites
output/           Generated PNG previews (gitignored)
```

## Device API

All commands go to `POST http://<device-ip>/post` with a JSON body containing a `Command` field. The `PixooClient` class wraps this — use `client.send(command, params)` for raw access, or the typed convenience methods.

## License

MIT
