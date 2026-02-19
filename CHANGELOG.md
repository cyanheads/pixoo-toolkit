# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `PixooClient.pushAnimation()` now calls `resetGifId()` before sending frames, matching the behavior of `push()`. Previously, animations could be silently ignored by the device.

### Changed

- Bumped `typescript` from `^5.7.0` to `^5.9.3`.
- Bumped `@types/sharp` from `^0.31.1` to `^0.32.0`.
- Added `bun.lock` lockfile.

### Added

- `scripts/color-test.ts`: Color calibration chart — 4×4 grid of 16 numbered swatches with auto-contrast labels for verifying LED color accuracy.
- `scripts/hello-claude-animated.ts`: Animated "Hello from Claude" display — 20-frame sequence with sprite bouncing, leaning, and winking.
- `.gitignore`: Added `.DS_Store` exclusion.

## [0.1.0] — 2026-02-18

### Added

- **Canvas** (`src/canvas.ts`): 64×64 RGB pixel buffer with drawing primitives — `setPixel`, `fillRect`, `fillCircle`, `drawRect`, `drawCircle`, `drawLine`, `drawTriangle`, `blendPixel`, `blit`, `scroll`, vertical/horizontal/radial gradients, and `toBase64` encoding for device payloads.
- **Color** (`src/color.ts`): `RGB`, `HSL`, and `ColorLike` types with full conversion utilities — `hslToRgb`, `rgbToHsl`, `rgbToHex`, `hexToRgb`, `parseHexString`, `resolveColor`, `lerpColor`, `dimColor`. Includes 30+ named color constants and a `Color` convenience object.
- **Font** (`src/font.ts`): Two bitmap fonts — `FONT_5x7` (full printable ASCII 32–126) and `FONT_3x5` (digits, uppercase, basic punctuation). Text rendering via `drawText`, `drawTextCentered`, and `measureText` with configurable letter spacing and pixel scaling.
- **Client** (`src/client.ts`): `PixooClient` HTTP client for Divoom Pixoo-64 devices — `push` (single frame), `pushAnimation` (multi-frame), channel/brightness/screen control, text overlays, scoreboard, timer, stopwatch, noise meter, buzzer, and raw `send`/`batch` command support. Uses native `fetch` with `AbortController` timeouts.
- **Animation** (`src/animation.ts`): `Animation` class and `buildAnimation` helper for constructing multi-frame sequences with per-frame render callbacks.
- **Image** (`src/image.ts`): `loadImage` for resizing any image to canvas via sharp (nearest-neighbor default), `downsampleSprite` for analyzing images into color-classified grids, and `renderSprite` for rendering grids with color overrides.
- **Preview** (`src/preview.ts`): Zero-dependency PNG encoder using only `node:zlib` — `canvasToPng`, `savePng`, and `saveAnimationPngs` with nearest-neighbor upscaling.
- **SVG Path** (`src/svg-path.ts`): SVG path `d` attribute parser supporting M/m, L/l, H/h, V/v, C/c, Z/z commands, scanline polygon fill via `fillPolygon`, and `renderSvgPath` with viewBox-to-canvas coordinate mapping.
- **Scripts**: `hello-claude.ts` (sprite + text demo) and `demo.ts` (static frame, starfield, shapes, animation with orbiting dot trail).
- **Assets**: `clawd.png` sprite source image.
- Project configuration: TypeScript strict mode, ESM, Node 20+, sharp dependency.
