<div align="center">

# @cyanheads/pixoo-toolkit

**TypeScript toolkit for Divoom Pixoo displays**\
Pixel rendering, animations, and device control over the local HTTP API.\
Supports Pixoo-16, Pixoo-32, and Pixoo-64.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.3-f9f1e1?logo=bun&logoColor=black)](https://bun.sh/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

</div>

---

## Overview

Full programmatic control of Divoom Pixoo displays from TypeScript — bypassing the Divoom app entirely. Push custom visuals, animations, dashboards, and interactive displays to the RGB LED matrix over your local network. Supports all three Pixoo sizes: 16×16, 32×32, and 64×64.

### Highlights

| Module | What it does |
|---|---|
| **Canvas** | Square RGB pixel buffer (16/32/64) — rects, circles, lines, triangles, gradients, blending, scrolling |
| **Bitmap Fonts** | Two built-in sizes (5×7 full ASCII, 3×5 compact) with measurement and centered rendering |
| **Color System** | RGB/HSL types, 30+ named colors, interpolation, hex parsing |
| **Device Client** | Full Pixoo HTTP API — frames, animations, channels, brightness, text overlays, scoreboard, timer, buzzer |
| **Image Loading** | Resize any image to canvas via sharp, sprite downsampling with color classification |
| **Animation Builder** | Multi-frame sequences with per-frame render callbacks |
| **SVG Paths** | Parse SVG `d` attributes and rasterize with scanline fill |
| **PNG Export** | Zero-dependency encoder (using `node:zlib`) with nearest-neighbor upscaling |

## Getting Started

### Prerequisites

- **Bun** >= 1.0
- **Divoom Pixoo** (16, 32, or 64) on the same network

### Install

```bash
# npm
npm install @cyanheads/pixoo-toolkit

# bun
bun add @cyanheads/pixoo-toolkit
```

### Local Development

```bash
git clone https://github.com/cyanheads/pixoo-toolkit.git
cd pixoo-toolkit
bun install
bun run build
bun run test
```

> **Tip:** Set `PIXOO_IP` to your device's local IP address. Set `PIXOO_SIZE` to `16` or `32` for non-64 displays. See `.env.example`.

## Usage

### Quick Example

```typescript
import { PixooClient, Canvas, Color, drawTextCentered, FONT_5x7, savePng } from '@cyanheads/pixoo-toolkit';

// Set PIXOO_IP env var to your device's local IP (see .env.example)
const device = new PixooClient(process.env.PIXOO_IP!);
const canvas = new Canvas();

canvas.gradientV([10, 5, 30], [5, 15, 40]);
drawTextCentered(canvas, 'HELLO', 28, Color.WHITE, { font: FONT_5x7 });

await savePng(canvas, 'output/hello.png');
await device.push(canvas);
```

### Animation

```typescript
import { PixooClient, buildAnimation, drawTextCentered, hslToRgb, Color, FONT_5x7 } from '@cyanheads/pixoo-toolkit';

const device = new PixooClient(process.env.PIXOO_IP!);
const anim = buildAnimation(20, 120, (frame, i, total) => {
  frame.clear('black');
  const color = hslToRgb([(i / total) * 360, 0.9, 0.6]);
  frame.fillCircle(32, 32, 10 + i, color);
  drawTextCentered(frame, 'HI', 28, Color.WHITE, { font: FONT_5x7 });
});

await device.pushAnimation(anim.frames, anim.speed);
```

### Loading Images

```typescript
import { loadImage, downsampleSprite, renderSprite, Canvas, savePng } from '@cyanheads/pixoo-toolkit';

// Full-resolution resize to 64×64
const canvas = await loadImage('assets/photo.png');

// Or downsample into a pixel-art sprite grid
const sprite = await downsampleSprite('assets/clawd.png', 10, 8);
const c = new Canvas();
renderSprite(c, sprite.grid, { scale: 4, y: 24 });
await savePng(c, 'output/sprite.png');
```

## Project Structure

```
src/
  canvas.ts       Square pixel buffer (16/32/64) + drawing primitives
  client.ts       PixooClient — HTTP device control (all Pixoo sizes)
  color.ts        RGB/HSL types, named colors, utilities
  font.ts         Bitmap fonts, text rendering
  image.ts        Image loading (sharp), sprite downsampling
  animation.ts    Multi-frame animation builder
  preview.ts      Zero-dep PNG encoder
  svg-path.ts     SVG path parser + polygon rasterizer
  index.ts        Barrel export
tests/            Vitest tests (one per src module)
scripts/          Runnable display scripts
assets/           Source images (PNGs) for sprites
output/           Generated PNG previews (gitignored)
```

## Device API

All commands go to `POST http://<device-ip>/post` with a JSON body containing a `Command` field. The `PixooClient` class wraps this — use `client.send(command, params)` for raw access, or the typed convenience methods.

```typescript
// Raw command
await device.send('Channel/SetBrightness', { Brightness: 80 });

// Typed convenience
await device.setBrightness(80);
await device.setChannel(Channel.Custom);
await device.setScreen(true);
```

## License

[Apache 2.0](LICENSE)
