# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] — 2026-02-20

### Changed

- Renamed package from `@cyanheads/pixoo` to `@cyanheads/pixoo-toolkit`.
- Moved test files from `src/` to dedicated `tests/` directory.
- Updated vitest, eslint, and tsconfig to reference `tests/` instead of colocated `src/*.test.ts`.
- Updated lint/format scripts to include `tests/` directory.

## [0.1.4] — 2026-02-19

### Added

- ESLint (v10, flat config with typescript-eslint strict) and Prettier (v3.8) tooling.
- `lint`, `format`, and `format:check` npm scripts.
- `Canvas.fillTriangle()` — scanline rasterization for filled triangles.
- `PixooClient` retry support — `retries` and `retryDelay` options with exponential backoff on transient failures.
- `resolveGlyph()` helper in font module — auto-uppercases characters when a font lacks lowercase glyphs (e.g. FONT_3x5).
- Tests for `fillTriangle`, `parseHexString` null validation, `resolveColor` fallback, client retry logic, and font auto-uppercase.

### Changed

- `parseHexString()` now returns `RGB | null` instead of silently coercing invalid input to zeros.
- `resolveColor()` returns white `[255, 255, 255]` for unresolvable color strings.
- `NAMED_COLORS` typed as `Readonly<Record<string, RGB>>`.
- `Canvas.clear()` optimized — uses `buffer.fill(0)` for black.
- `Canvas.blit()` optimized — direct buffer access with pre-clamped bounds instead of per-pixel `inBounds` checks.
- `saveAnimationPngs()` parallelized with `Promise.all`.
- Cached `TextEncoder` instance in preview module.
- `let` → `const` fix in `Canvas.drawLine()`.
- Applied Prettier formatting across all source, test, and script files.
- Removed `@types/sharp` devDependency (types bundled with sharp 0.34).

## [0.1.3] — 2026-02-19

### Added

- Vitest test suite with 192 tests across 8 colocated test files covering all source modules.
- `vitest.config.ts` configuration.
- `test` and `test:watch` npm scripts.

### Changed

- Excluded `*.test.ts` files from TypeScript build output in `tsconfig.json`.

## [0.1.2] — 2026-02-19

### Changed

- Migrated runtime from Node.js to Bun.
- Replaced `@types/node` with `@types/bun` in devDependencies.
- Removed `engines` field from package.json (Bun manages its own version).
- Updated all npm scripts to use `bun run` / `bun` instead of `npx` / `node`.
- Updated CLAUDE.md: runtime references, script run commands, added Scripts table and Maintenance section.
- Updated README.md: badge, prerequisites, install/build/run commands reflect Bun.

### Added

- `bun.lock` lockfile.

## [0.1.1] — 2026-02-19

### Fixed

- `PixooClient.pushAnimation()` now calls `resetGifId()` before sending frames, matching the behavior of `push()`. Previously, animations could be silently ignored by the device.
- `PixooClient.buzzer()` sent incorrect command name (`Device/PlayTFGif` → `Device/PlayBuzzer`).
- `PixooClient.send()` now returns a structured error on non-OK HTTP responses instead of throwing.
- `PixooClient.send()` now catches network/timeout errors gracefully instead of throwing unhandled exceptions.
- `PixooClient.pushAnimation()` returns an error immediately when given an empty frames array.
- `PixooClient.pushAnimation()` resets GIF ID on mid-animation errors for cleaner recovery.
- `PixooClient.picId` wraps at 10000 to prevent overflow after sustained use.
- `parseHexString` and `resolveColor` now guard against `NaN` from invalid hex input.
- `NAMED_COLORS.claude` corrected from `[230, 150, 60]` to `[230, 150, 70]`.
- `FONT_3x5` glyph for `V` was identical to `U`; corrected to taper at row 4.
- `measureText` / `drawText` now fall back to the `?` glyph for unknown characters instead of using nominal width.
- `Canvas.drawLine()` now floors input coordinates for correct Bresenham rendering.
- `dimColor()` output clamped to [0, 255] to prevent invalid RGB values.
- SVG path tokenizer no longer incorrectly splits negative signs after scientific notation exponents (e.g. `1e-5`).
- `renderSvgPath` guards against zero-dimension viewBox.
- SVG path `Z`/`z` closePath now returns to the subpath start instead of always the first point.
- `Canvas` constructor validates buffer size, throwing on mismatched input.
- Fixed `package.json` export paths (`dist/index.js` → `dist/src/index.js`).

### Changed

- Bumped `typescript` from `^5.7.0` to `^5.9.3`.
- Bumped `@types/sharp` from `^0.31.1` to `^0.32.0`.
- `PixooClient.sendText()` `color` option now accepts `ColorLike` (RGB tuple, hex number, named string) instead of only hex strings.
- `DeviceConfig` type now includes `SelectIndex`.
- `Canvas.blit()` accepts an optional `transparentColor` parameter (default: black); pass `null` to copy all pixels.
- `Animation` constructor validates `frameCount` (must be positive) and warns when exceeding 40 frames.
- `downsampleSprite` return type renamed `width`/`height` to `cols`/`rows` for clarity.
- `downsampleSprite` returns an empty grid instead of crashing when the source image has no visible pixels.
- Extracted shared `glyphWidth` helper in font module.
- All scripts read device IP from `PIXOO_IP` environment variable with fallback to `10.1.20.114`.
- Scripts use `NAMED_COLORS.claude` instead of hardcoded color tuples.
- Scripts import from barrel export instead of direct internal paths.
- Removed unused `run` script from package.json.
- Added `files` field to package.json for npm publishing.

### Added

- MIT `LICENSE` file.
- SVG path parser supports Q/q, S/s, T/t, A/a commands (quadratic bézier, smooth cubic/quadratic, arc).
- Barrel export (`src/index.ts`) now includes `parseSvgPath`, `fillPolygon`, `renderSvgPath`, and `Point` type.
- `scripts/color-test.ts`: Color calibration chart — 4×4 grid of 16 numbered swatches with auto-contrast labels for verifying LED color accuracy.
- `scripts/hello-claude-animated.ts`: Animated "Hello from Claude" display — 20-frame sequence with sprite bouncing, leaning, and winking.
- `.gitignore`: Added `.DS_Store` exclusion.

### Removed

- Deleted `bun.lock` lockfile (use npm instead).

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
