// Canvas, color, text, animation, SVG — the browser-safe `./core` entry
export * from './core.js';

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

// Image
export {
  loadImage,
  loadAnimation,
  downsampleSprite,
  renderSprite,
  type LoadedAnimation,
  type SpriteCell,
} from './image.js';

// Preview
export {
  canvasToPng,
  savePng,
  saveAnimationPngs,
  encodeAnimationGif,
  saveAnimationGif,
  type PngOptions,
} from './preview.js';
