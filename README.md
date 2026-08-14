<div align="center">

<img src="assets/readme_header.png" width="256" />

# @cyanheads/pixoo-toolkit

**TypeScript toolkit for Divoom Pixoo displays**\
Pixel rendering, animations, and device control over the local HTTP API.\
Supports Pixoo-16, Pixoo-32, and Pixoo-64.

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.3-f9f1e1?logo=bun&logoColor=black)](https://bun.sh/) [![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

</div>

---

> **Building for AI agents?** [`@cyanheads/pixoo-mcp-server`](https://github.com/cyanheads/pixoo-mcp-server) is built on this toolkit — it exposes Pixoo rendering, scene composition, and device control as Model Context Protocol tools.

## Overview

Full programmatic control of Divoom Pixoo displays from TypeScript — bypassing the Divoom app entirely. Push custom visuals, animations, dashboards, and interactive displays to the RGB LED matrix over your local network. Supports all three Pixoo sizes: 16×16, 32×32, and 64×64.

### Highlights

| Module | What it does |
|---|---|
| **Canvas** | Square RGBA pixel buffer (16/32/64) — alpha-aware source-over compositing, pixel access, rects, circles, lines, triangles, 3 gradient modes, clone, scrolling; exports flatten to device RGB |
| **Bitmap Fonts** | Two built-in sizes (5×7 full ASCII, 3×5 compact with lowercase) with tight proportional metrics, measurement, and centered rendering |
| **Color System** | RGB/HSL types, 30+ named colors, interpolation, hex parsing — strict resolution (typos throw, `tryResolveColor` to probe) |
| **Device Client** | Full Pixoo HTTP API — frames, animations, channels, brightness, screen on/off, clock faces, text overlays, scoreboard, timer, stopwatch, noise meter, buzzer, batch commands, LAN discovery. Every call returns a discriminated `PixooResult` — failures can't be mistaken for success. Pushed canvases must match the configured display size, and `minPushInterval` spaces frames to respect the firmware's push limit |
| **Image Loading** | Alpha-preserving resize to canvas via sharp, sprite downsampling with color classification |
| **Animation Builder** | Multi-frame sequences with per-frame render callbacks |
| **SVG Paths** | Parse SVG `d` attributes (lines + sampled Bézier curves and elliptical arcs) and rasterize with even-odd scanline fill — multi-subpath holes — or as 1-pixel strokes, for the `fill="none"` outline icons most icon sets ship |
| **PNG & GIF Export** | Zero-dependency PNG encoder (using `node:zlib`), animated GIF encoder (via gifenc), nearest-neighbor upscaling at any positive integer scale. PNG defaults to alpha flattened over black — what the panel shows — with `{ alpha: true }` to keep the alpha channel instead |

## Getting Started

### Prerequisites

- **Bun** >= 1.3 or **Node.js** >= 20.9
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
bun run devcheck
bun run test:all
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
const res = await device.push(canvas);
if (!res.ok) console.error(`push failed — ${res.kind}: ${res.message}`);
```

### Finding Your Device

No IP handy? Discover Pixoo devices on your LAN (calls Divoom's cloud discovery endpoint, so it needs internet access):

```typescript
const [found] = await PixooClient.discover();
const device = new PixooClient(found.ip);
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

Animation frames passed to `pushAnimation()`, `encodeAnimationGif()`, or `saveAnimationGif()` must all have the same dimensions.

### Colors

String colors accept case-insensitive named colors or an optional single `#` followed by exactly 3 or 6 ASCII hexadecimal digits. `resolveColor()` throws for every other string; use `tryResolveColor()` when an invalid string should return `null` instead.

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

### SVG Paths

Pass the `d` attribute and the source `viewBox`; the path is scaled into the target rect.

```typescript
import { Canvas, renderSvgPath } from '@cyanheads/pixoo-toolkit';

const canvas = new Canvas();

// Filled path — even-odd, so nested subpaths cut holes
renderSvgPath(canvas, filledIcon, 'cyan', [24, 24], [8, 8, 24, 24]);

// Outline path — 1px stroke along the segments
renderSvgPath(canvas, outlineIcon, 'cyan', [24, 24], [32, 8, 24, 24], { mode: 'stroke' });
```

Fill is the default. Reach for `{ mode: 'stroke' }` when the source path is `fill="none" stroke="..."` — the outline style Lucide, Feather, and Heroicons outline ship — since filling one of those paints the region the outline encloses rather than the outline itself. Stroke is 1 pixel wide; `stroke-width`, joins, caps, and dashes are not interpreted.

## Project Structure

```
src/
  canvas.ts       Square pixel buffer (16/32/64) + drawing primitives
  client.ts       PixooClient — HTTP device control (all Pixoo sizes)
  color.ts        RGB/HSL types, named colors, utilities
  font.ts         Bitmap fonts, text rendering
  image.ts        Image loading (sharp), sprite downsampling
  animation.ts    Multi-frame animation builder
  preview.ts      PNG + animated GIF encoder
  svg-path.ts     SVG path parser + polygon rasterizer (fill and stroke)
  index.ts        Barrel export
tests/            Vitest tests (one per src module)
scripts/          Runnable display scripts
assets/           Source images (PNGs) for sprites
output/           Generated PNG previews (gitignored)
```

## Device API

All commands go to `POST http://<device-ip>/post` with a JSON body containing a `Command` field. The `PixooClient` class wraps this — use `client.send(command, params)` for raw access, or the typed convenience methods.

For raw calls, the positional `command` is authoritative if `params` also contains a top-level `Command`; other parameters, including nested `CommandList` entries, are preserved. The client retries network failures, abort-driven timeouts, and HTTP 408, 429, 500, 502, 503, and 504 with exponential backoff. Other HTTP failures and device rejections return immediately; `retries: 0` makes one attempt.

Every call returns a `PixooResult`: `{ ok: true, data }` or `{ ok: false, kind, message }` where `kind` is `'network' | 'timeout' | 'http' | 'device'` — narrow on `ok` to reach the data, or use `unwrap()` to throw on failure.

`size` tells the client which panel it is talking to. `push()` and `pushAnimation()` throw `RangeError` for a canvas that doesn't match it, before any request goes out — the device would render a mismatched frame garbled or not at all, and that failure is invisible from the calling side. A `PixooResult` is reserved for what the device and network do; a canvas sized wrong at construction is a coding error.

The firmware can freeze after roughly 300 consecutive pushes, so pushes should be spaced about a second apart. `minPushInterval` enforces that spacing across `push()` and `pushAnimation()` — including between the frames of one animation, which is where the pushes accumulate fastest:

```typescript
const device = new PixooClient(process.env.PIXOO_IP!, { size: 64, minPushInterval: 1000 });
```

It is off by default. The interval covers the `Draw/SendHttpGif` frames only, measured from when each send starts; the `Draw/ResetHttpGifId` that precedes a push and every non-drawing command go out unthrottled.

```typescript
import { PixooClient, Channel, unwrap } from '@cyanheads/pixoo-toolkit';

const device = new PixooClient(process.env.PIXOO_IP!);

// Raw command
const res = await device.send('Channel/SetBrightness', { Brightness: 80 });
if (!res.ok) throw new Error(res.message);

// Typed convenience
await device.setBrightness(80);
await device.setChannel(Channel.Custom);

// unwrap() for scripts that prefer exceptions
const { SelectIndex } = unwrap(await device.getChannel());
```

## License

[Apache 2.0](LICENSE)
