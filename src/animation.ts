import { Canvas, type PixooSize } from './canvas.js';

/**
 * Multi-frame animation builder.
 *
 * Build up frames using the Canvas API, then push the whole
 * sequence to the device in one go.
 */
export class Animation {
  readonly frames: Canvas[];
  readonly speed: number;
  readonly size: PixooSize | undefined;

  /**
   * @param frameCount - Number of frames to pre-allocate.
   * @param speed - Milliseconds per frame (default: 100).
   * @param size - Canvas size per frame (default: 64).
   */
  constructor(frameCount: number, speed = 100, size?: PixooSize) {
    if (frameCount <= 0) throw new RangeError('frameCount must be positive');
    if (frameCount > 40) {
      console.warn(`Animation has ${frameCount} frames; Pixoo may become unstable above 40`);
    }
    this.frames = Array.from({ length: frameCount }, () => new Canvas(size));
    this.speed = speed;
    this.size = size;
  }

  /** Get a specific frame canvas for drawing. */
  frame(index: number): Canvas {
    const f = this.frames[index];
    if (!f) throw new RangeError(`Frame index ${index} out of range (0–${this.frames.length - 1})`);
    return f;
  }

  /** Number of frames. */
  get length(): number {
    return this.frames.length;
  }

  /**
   * Build frames by calling a render function for each.
   * The callback receives the canvas and the frame index.
   */
  render(fn: (canvas: Canvas, frameIndex: number, totalFrames: number) => void): this {
    for (let i = 0; i < this.frames.length; i++) {
      fn(this.frames[i]!, i, this.frames.length);
    }
    return this;
  }

  /** Add a new frame at the end, returns the new canvas. */
  addFrame(): Canvas {
    const frame = new Canvas(this.size);
    this.frames.push(frame);
    return frame;
  }
}

/**
 * Helper to build an animation from a render function.
 *
 * @example
 * ```ts
 * const anim = buildAnimation(20, 80, (canvas, i, total) => {
 *   canvas.clear('black');
 *   canvas.fillCircle(i * 3, 32, 5, 'red');
 * });
 * await device.pushAnimation(anim.frames, anim.speed);
 * ```
 */
export function buildAnimation(
  frameCount: number,
  speed: number,
  fn: (canvas: Canvas, frameIndex: number, totalFrames: number) => void,
  size?: PixooSize,
): Animation {
  return new Animation(frameCount, speed, size).render(fn);
}
