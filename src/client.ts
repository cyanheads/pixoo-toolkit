import { Canvas, type PixooSize, DEFAULT_SIZE } from './canvas.js';
import { type ColorLike, resolveColor, rgbToHex } from './color.js';

/**
 * Why a client call failed. Transport kinds ('network', 'timeout', 'http')
 * are generally retryable; 'device' means the Pixoo received the command
 * and rejected it.
 */
export type PixooErrorKind = 'network' | 'timeout' | 'http' | 'device';

/** A failed client call. */
export interface PixooFailure {
  ok: false;
  kind: PixooErrorKind;
  message: string;
  /** HTTP status code (kind: 'http'). */
  status?: number;
  /** The device's non-zero error_code (kind: 'device'). */
  deviceCode?: number;
}

/**
 * Result of a client call. Narrowing on `ok` is the only way to reach the
 * response data, so failures can't be mistaken for success:
 *
 * ```ts
 * const res = await client.push(canvas);
 * if (!res.ok) console.error(`${res.kind}: ${res.message}`);
 * ```
 */
export type PixooResult<T = Record<string, unknown>> =
  | { ok: true; data: T & { error_code: 0 } }
  | PixooFailure;

/** Unwrap a PixooResult, throwing on failure — for scripts that prefer exceptions. */
export function unwrap<T>(result: PixooResult<T>): T & { error_code: 0 } {
  if (!result.ok) throw new Error(`[${result.kind}] ${result.message}`);
  return result.data;
}

/**
 * Device configuration returned by Channel/GetAllConf.
 *
 * All fields are optional — the response set varies by firmware (a current
 * Pixoo-64 omits `SelectIndex`, for example). For the current channel, use
 * `getChannel()` (Channel/GetIndex), which returns `SelectIndex` reliably.
 */
export interface DeviceConfig {
  Brightness?: number;
  RotationFlag?: number;
  ClockTime?: number;
  GalleryTime?: number;
  SingleGalleyTime?: number;
  PowerOnChannelId?: number;
  GalleryShowTimeFlag?: number;
  CurClockId?: number;
  Time24Flag?: number;
  TemperatureMode?: number;
  GyrateAngle?: number;
  MirrorFlag?: number;
  LightSwitch?: number;
  SelectIndex?: number;
}

/** A Pixoo device discovered on the local network. */
export interface DiscoveredDevice {
  name: string;
  id: number;
  ip: string;
}

export enum Channel {
  Faces = 0,
  Cloud = 1,
  Visualizer = 2,
  Custom = 3,
}

export interface PixooClientOptions {
  /** Display size in pixels (default: 64). Determines PicWidth for draw commands and default text width. */
  size?: PixooSize;
  /** Request timeout in ms (default: 5000). */
  timeout?: number;
  /** Number of retry attempts on transient failures (default: 1). */
  retries?: number;
  /** Base delay in ms before first retry, doubled on each subsequent attempt (default: 250). */
  retryDelay?: number;
}

/**
 * HTTP client for a Divoom Pixoo device.
 *
 * All commands go through `POST http://<ip>/post` with JSON bodies and
 * return a `PixooResult` — errors are values, never thrown.
 */
export class PixooClient {
  readonly url: string;
  readonly size: PixooSize;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly retryDelay: number;
  private picId = Date.now() % 10000;

  constructor(
    readonly ip: string,
    opts: PixooClientOptions = {},
  ) {
    this.url = `http://${ip}/post`;
    this.size = opts.size ?? DEFAULT_SIZE;
    this.timeout = opts.timeout ?? 5000;
    this.retries = opts.retries ?? 1;
    this.retryDelay = opts.retryDelay ?? 250;
  }

  /**
   * Discover Pixoo devices on the local network.
   *
   * Calls Divoom's cloud discovery endpoint (`app.divoom-gz.com`) — the
   * request leaves your network, so Divoom's servers see it. Requires
   * internet access; intended for one-shot setup, not hot paths. Throws on
   * network failure or timeout.
   */
  static async discover(timeoutMs = 5000): Promise<DiscoveredDevice[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('https://app.divoom-gz.com/Device/ReturnSameLANDevice', {
        method: 'POST',
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Discovery failed: HTTP ${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as {
        DeviceList?: Array<{ DeviceName?: string; DeviceId?: number; DevicePrivateIP?: string }>;
      };
      return (json.DeviceList ?? [])
        .filter((d) => typeof d.DevicePrivateIP === 'string' && d.DevicePrivateIP.length > 0)
        .map((d) => ({ name: d.DeviceName ?? '', id: d.DeviceId ?? 0, ip: d.DevicePrivateIP! }));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Send a raw command. Retries transient transport failures with
   * exponential backoff; device rejections (non-zero error_code) are
   * returned immediately — retrying a rejected command won't change it.
   */
  async send<T = Record<string, unknown>>(
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<PixooResult<T>> {
    const body = JSON.stringify({ Command: command, ...params });
    let lastFailure: PixooFailure = { ok: false, kind: 'network', message: 'No attempts made' };

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay * (1 << (attempt - 1))));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        if (!res.ok) {
          lastFailure = {
            ok: false,
            kind: 'http',
            status: res.status,
            message: `HTTP ${res.status} ${res.statusText}`,
          };
          continue;
        }
        const json = (await res.json()) as { error_code: number } & Record<string, unknown>;
        if (json.error_code !== 0) {
          return {
            ok: false,
            kind: 'device',
            deviceCode: json.error_code,
            message: `Device rejected ${command} (error_code ${json.error_code})`,
          };
        }
        return { ok: true, data: json as T & { error_code: 0 } };
      } catch (err) {
        const isTimeout = err instanceof DOMException && err.name === 'AbortError';
        lastFailure = isTimeout
          ? { ok: false, kind: 'timeout', message: 'Request timed out' }
          : {
              ok: false,
              kind: 'network',
              message: err instanceof Error ? err.message : 'Unknown error',
            };
      } finally {
        clearTimeout(timer);
      }
    }

    return lastFailure;
  }

  // --- Display ---

  /** Reset the device's internal GIF ID counter. Call before pushing if stale. */
  async resetGifId(): Promise<PixooResult> {
    return this.send('Draw/ResetHttpGifId');
  }

  /** Push a single canvas frame to the display. */
  async push(canvas: Canvas, speed = 100): Promise<PixooResult> {
    // A failed reset means the device will silently ignore the frame — surface it
    const reset = await this.resetGifId();
    if (!reset.ok) return reset;
    this.picId = (this.picId + 1) % 10000;
    return this.send('Draw/SendHttpGif', {
      PicNum: 1,
      PicWidth: canvas.width,
      PicOffset: 0,
      PicID: this.picId,
      PicSpeed: speed,
      PicData: canvas.toBase64(),
    });
  }

  /**
   * Push a multi-frame animation to the display.
   * @param frames - Array of Canvas instances (one per frame). Must be non-empty.
   * @param speed - Milliseconds per frame.
   */
  async pushAnimation(frames: Canvas[], speed = 100): Promise<PixooResult> {
    if (frames.length === 0) {
      throw new RangeError('pushAnimation requires at least one frame');
    }
    const reset = await this.resetGifId();
    if (!reset.ok) return reset;
    this.picId = (this.picId + 1) % 10000;
    let last: PixooResult = reset; // overwritten on the first iteration — frames is non-empty
    for (let i = 0; i < frames.length; i++) {
      last = await this.send('Draw/SendHttpGif', {
        PicNum: frames.length,
        PicWidth: frames[0]!.width,
        PicOffset: i,
        PicID: this.picId,
        PicSpeed: speed,
        PicData: frames[i]!.toBase64(),
      });
      if (!last.ok) {
        await this.resetGifId();
        return last;
      }
    }
    return last;
  }

  // --- Channel / display control ---

  async getConfig(): Promise<PixooResult<DeviceConfig>> {
    return this.send<DeviceConfig>('Channel/GetAllConf');
  }

  async getChannel(): Promise<PixooResult<{ SelectIndex: number }>> {
    return this.send<{ SelectIndex: number }>('Channel/GetIndex');
  }

  async setChannel(channel: Channel): Promise<PixooResult> {
    return this.send('Channel/SetIndex', { SelectIndex: channel });
  }

  async setBrightness(brightness: number): Promise<PixooResult> {
    return this.send('Channel/SetBrightness', {
      Brightness: Math.max(0, Math.min(100, Math.round(brightness))),
    });
  }

  async setScreen(on: boolean): Promise<PixooResult> {
    return this.send('Channel/OnOffScreen', { OnOff: on ? 1 : 0 });
  }

  async setClock(clockId: number): Promise<PixooResult> {
    return this.send('Channel/SetClockSelectId', { ClockId: clockId });
  }

  // --- Text overlay ---

  async sendText(opts: {
    id: number;
    x: number;
    y: number;
    text: string;
    dir?: number;
    font?: number;
    width?: number;
    speed?: number;
    color?: ColorLike;
    align?: number;
  }): Promise<PixooResult> {
    const rgb = resolveColor(opts.color ?? [255, 255, 255]);
    const hex = rgbToHex(rgb);
    const colorStr = `#${hex.toString(16).padStart(6, '0')}`;
    return this.send('Draw/SendHttpText', {
      TextId: opts.id,
      x: opts.x,
      y: opts.y,
      dir: opts.dir ?? 0,
      font: opts.font ?? 0,
      TextWidth: opts.width ?? this.size,
      TextString: opts.text,
      speed: opts.speed ?? 0,
      color: colorStr,
      align: opts.align ?? 1,
    });
  }

  async clearText(id: number): Promise<PixooResult> {
    return this.send('Draw/ClearHttpText', { TextId: id });
  }

  // --- Tools ---

  async setScoreboard(blue: number, red: number): Promise<PixooResult> {
    return this.send('Tools/SetScoreBoard', { BlueScore: blue, RedScore: red });
  }

  async setTimer(minutes: number, seconds: number, start = true): Promise<PixooResult> {
    return this.send('Tools/SetTimer', {
      Minute: minutes,
      Second: seconds,
      Status: start ? 1 : 0,
    });
  }

  async setStopwatch(action: 'start' | 'stop' | 'reset'): Promise<PixooResult> {
    const status = action === 'start' ? 1 : action === 'stop' ? 0 : 2;
    return this.send('Tools/SetStopWatch', { Status: status });
  }

  async setNoise(on: boolean): Promise<PixooResult> {
    return this.send('Tools/SetNoiseStatus', { NoiseStatus: on ? 1 : 0 });
  }

  // --- System ---

  async playBuzzer(activeCycleMs = 500, offCycleMs = 500, totalMs = 3000): Promise<PixooResult> {
    return this.send('Device/PlayBuzzer', {
      ActiveTimeInCycle: activeCycleMs,
      OffTimeInCycle: offCycleMs,
      PlayTotalTime: totalMs,
    });
  }

  /**
   * Send a batch of commands in a single request via Draw/CommandList.
   * Note: multi-frame Draw/SendHttpGif calls cannot be batched — use pushAnimation() instead.
   */
  async batch(commands: Array<{ Command: string; [key: string]: unknown }>): Promise<PixooResult> {
    return this.send('Draw/CommandList', { CommandList: commands });
  }
}
