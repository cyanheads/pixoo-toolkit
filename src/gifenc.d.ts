/** Type declarations for gifenc (no shipped types). */
declare module 'gifenc' {
  type RGB = [number, number, number];

  interface GIFEncoderInstance {
    reset(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    readonly buffer: ArrayBuffer;
    writeHeader(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: {
        transparent?: boolean;
        transparentIndex?: number;
        delay?: number;
        palette?: RGB[];
        repeat?: number;
        colorDepth?: number;
        dispose?: number;
        first?: boolean;
      },
    ): void;
  }

  export function GIFEncoder(opts?: {
    initialCapacity?: number;
    auto?: boolean;
  }): GIFEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number },
  ): RGB[];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: RGB[],
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array;

  export function nearestColorIndex(palette: RGB[], pixel: number[]): number;
  export function nearestColor(palette: RGB[], pixel: number[]): RGB;
  export function prequantize(
    rgba: Uint8Array | Uint8ClampedArray,
    opts?: { roundRGB?: number; roundAlpha?: number; oneBitAlpha?: boolean | number },
  ): void;
}
