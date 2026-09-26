/**
 * Browser-safe entry point, published as `@cyanheads/pixoo-toolkit/core`.
 *
 * Re-exports the modules whose import graph reaches no Node built-in or
 * package — canvas, color, font, svg-path, animation, and finish — so a
 * bundler can target the browser. The main barrel re-exports this module, so
 * both entry points share one `Canvas` class and one set of bindings.
 */

export {
  Canvas,
  type PixooSize,
  type BlendMode,
  type BlitOptions,
  type FillOptions,
  type StrokeOptions,
  DEFAULT_SIZE,
} from './canvas.js';
export {
  type RGB,
  type HSL,
  type ColorLike,
  Color,
  NAMED_COLORS,
  resolveColor,
  tryResolveColor,
  hslToRgb,
  rgbToHsl,
  rgbToHex,
  hexToRgb,
  parseHexString,
  lerpColor,
  dimColor,
} from './color.js';
export {
  type BitmapFont,
  type GlyphMetrics,
  type TextOptions,
  FONT_5x7,
  FONT_3x5,
  FONT_DIGITS_11x18,
  measureText,
  drawText,
  drawTextCentered,
  parseBdf,
} from './font.js';
export { Animation, buildAnimation } from './animation.js';
export {
  type Point,
  type RenderSvgPathOptions,
  parseSvgPath,
  parseSvgPathSubpaths,
  fillPolygon,
  fillSubpaths,
  strokeSubpaths,
  renderSvgPath,
} from './svg-path.js';
export {
  type Dither,
  type QuantizeOptions,
  type PanelResponse,
  downsample,
  quantize,
  correctForPanel,
  simulatePanel,
} from './finish.js';
