// Core
export { Canvas, type PixooSize, DEFAULT_SIZE } from './canvas.js';
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

// Text
export {
  type BitmapFont,
  type TextOptions,
  FONT_5x7,
  FONT_3x5,
  measureText,
  drawText,
  drawTextCentered,
} from './font.js';

// Device
export {
  PixooClient,
  type PixooClientOptions,
  type PixooResult,
  type PixooFailure,
  type PixooErrorKind,
  type DeviceConfig,
  type DiscoveredDevice,
  unwrap,
  Channel,
} from './client.js';

// Animation
export { Animation, buildAnimation } from './animation.js';

// Image
export { loadImage, downsampleSprite, renderSprite, type SpriteCell } from './image.js';

// Preview
export {
  canvasToPng,
  savePng,
  saveAnimationPngs,
  encodeAnimationGif,
  saveAnimationGif,
} from './preview.js';

// SVG
export {
  type Point,
  parseSvgPath,
  parseSvgPathSubpaths,
  fillPolygon,
  fillSubpaths,
  renderSvgPath,
} from './svg-path.js';
