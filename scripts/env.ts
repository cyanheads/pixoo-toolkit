/**
 * Device configuration for the display scripts, read from the environment
 * documented in `.env.example`.
 */

import { DEFAULT_SIZE, type PixooSize } from '../src/index.js';

const VALID_SIZES: readonly PixooSize[] = [16, 32, 64];

export interface DeviceConfig {
  ip: string;
  size: PixooSize;
}

/**
 * Resolve `PIXOO_IP` and `PIXOO_SIZE`. An unset size falls back to the 64-pixel
 * default; anything outside 16/32/64 fails naming the variable, rather than
 * reaching the client as an arbitrary number.
 */
export function deviceFromEnv(): DeviceConfig {
  const ip = process.env.PIXOO_IP;
  if (!ip) throw new Error('PIXOO_IP environment variable is required');

  const raw = process.env.PIXOO_SIZE;
  if (raw === undefined || raw.trim() === '') return { ip, size: DEFAULT_SIZE };

  const size = VALID_SIZES.find((candidate) => candidate === Number(raw));
  if (size === undefined) {
    throw new Error(
      `PIXOO_SIZE must be one of ${VALID_SIZES.join(', ')} — got ${JSON.stringify(raw)}`,
    );
  }
  return { ip, size };
}
