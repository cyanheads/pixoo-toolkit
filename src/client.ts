import { Canvas, type PixooSize, DEFAULT_SIZE } from './canvas.js';
import { type ColorLike, resolveColor, rgbToHex } from './color.js';
import { assertAnimationFrameDimensions } from './animation.js';

/**
 * Why a client call failed. Network failures and timeouts are retryable;
 * HTTP retryability depends on the status. 'device' means the Pixoo received
 * the command and rejected it. 'response' means a reply arrived but is not the
 * API's JSON envelope with a numeric `error_code` — usually another HTTP
 * server answering at that address.
 */
export type PixooErrorKind = 'network' | 'timeout' | 'http' | 'device' | 'response';

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
  { ok: true; data: T & { error_code: 0 } } | PixooFailure;

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

/** The device channels — `setChannel()` takes one, `getChannel()` reports one as `SelectIndex`. */
export const Channel = {
  Faces: 0,
  Cloud: 1,
  Visualizer: 2,
  Custom: 3,
} as const;

/** A device channel index, 0–3. */
export type Channel = (typeof Channel)[keyof typeof Channel];

export interface PixooClientOptions {
  /** Size in pixels of the display this client talks to (default: 64). Pushed canvases must match it; also the default text width. */
  size?: PixooSize;
  /** Request timeout in ms, per attempt (default: 5000). */
  timeout?: number;
  /** Number of retry attempts on transient failures (default: 1). */
  retries?: number;
  /** Base delay in ms before first retry, doubled on each subsequent attempt (default: 250). */
  retryDelay?: number;
  /**
   * Minimum ms between consecutive frame sends (default: 0 — no throttling).
   * Spaces the Draw/SendHttpGif requests of `push()` and `pushAnimation()`,
   * measured from when the previous frame send started, so the interval caps
   * the frame rate regardless of how long each request takes. The
   * Draw/ResetHttpGifId that precedes a push is not throttled — it is a
   * control command, and delaying it works against the ~300-push freeze the
   * interval exists to avoid.
   */
  minPushInterval?: number;
}

/** Per-call options for `send()` and the display pushes. */
export interface PixooCallOptions {
  /**
   * Cancels the call. Once it aborts, the call sends nothing further — no
   * retry, no next frame, no queued push — and rejects with the signal's
   * reason instead of returning a `PixooResult`. A request already on the
   * wire is aborted with it.
   */
  signal?: AbortSignal;
}

const PIXOO_SIZES: ReadonlySet<number> = new Set([16, 32, 64]);

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/** Longest Device/PlayTFGif FileName the device answers; a longer one reboots it. */
const MAX_GIF_URL_BYTES = 255;

/**
 * Throw RangeError for a `NaN` or infinite numeric argument before any
 * request — `JSON.stringify` would send it to the device as `null`. An
 * `undefined` entry is an omitted option and passes.
 */
function assertFiniteArgs(
  method: string,
  args: Readonly<Record<string, number | undefined>>,
): void {
  for (const [name, value] of Object.entries(args)) {
    if (value !== undefined && !Number.isFinite(value)) {
      throw new RangeError(`${method} ${name} must be a finite number; got ${value}`);
    }
  }
}

/** Throw RangeError naming a `PixooClient` option that breaks its rule. */
function assertOption(name: string, value: number, valid: boolean, rule: string): void {
  if (!valid) throw new RangeError(`PixooClient ${name} must be ${rule}; got ${value}`);
}

/** Wait `ms`, or reject with the signal's reason as soon as it aborts. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Wait for `turn` to settle, or reject with the signal's reason as soon as it
 * aborts. `turn` never rejects.
 */
async function awaitTurn(turn: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return turn;
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
  });
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await Promise.race([turn, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * A fetch failure's message, with its cause — Node reports every connection
 * failure as `fetch failed` and keeps the reason (`ECONNREFUSED`, a DNS miss)
 * on `cause`.
 */
function networkMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error';
  const cause = err.cause instanceof Error ? err.cause.message : undefined;
  return cause && !err.message.includes(cause) ? `${err.message}: ${cause}` : err.message;
}

/** Whether a fetch rejection is an abort — the per-attempt timeout, when the caller's signal is clear. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

/**
 * HTTP client for a Divoom Pixoo device.
 *
 * All commands go through `POST http://<ip>/post` with JSON bodies and
 * return a `PixooResult` — errors are values, never thrown. The display
 * pushes (`push()`, `pushAnimation()`, `playGifUrl()`) take turns: a push
 * made while another is still sending waits for it, so frames of two pushes
 * never interleave and `minPushInterval` spaces every frame.
 */
export class PixooClient {
  readonly ip: string;
  readonly url: string;
  readonly size: PixooSize;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly retryDelay: number;
  private readonly minPushInterval: number;
  private lastFrameSentAt = 0;
  private picId = Date.now() % 10000;
  /** Settles when every display push queued so far has finished. Never rejects. */
  private displayQueue: Promise<void> = Promise.resolve();

  /**
   * @throws RangeError when `size` is not 16, 32, or 64, `timeout` is not a
   *   positive finite number, `retries` is not a non-negative integer, or
   *   `retryDelay` or `minPushInterval` is not a non-negative finite number.
   */
  constructor(ip: string, opts: PixooClientOptions = {}) {
    const {
      size = DEFAULT_SIZE,
      timeout = 5000,
      retries = 1,
      retryDelay = 250,
      minPushInterval = 0,
    } = opts;
    assertOption('size', size, PIXOO_SIZES.has(size), '16, 32, or 64');
    assertOption('timeout', timeout, Number.isFinite(timeout) && timeout > 0, 'a positive number');
    assertOption(
      'retries',
      retries,
      Number.isInteger(retries) && retries >= 0,
      'a non-negative integer',
    );
    assertOption(
      'retryDelay',
      retryDelay,
      Number.isFinite(retryDelay) && retryDelay >= 0,
      'a non-negative number',
    );
    assertOption(
      'minPushInterval',
      minPushInterval,
      Number.isFinite(minPushInterval) && minPushInterval >= 0,
      'a non-negative number',
    );
    this.ip = ip;
    this.url = `http://${ip}/post`;
    this.size = size;
    this.timeout = timeout;
    this.retries = retries;
    this.retryDelay = retryDelay;
    this.minPushInterval = minPushInterval;
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
   * Send a raw command. The positional command overrides a top-level
   * `params.Command`; all other parameters are sent unchanged.
   *
   * Retries network failures, timeouts, and HTTP 408, 429, 500, 502, 503,
   * and 504 with exponential backoff. Other HTTP failures, replies that are
   * not the API's JSON envelope, and device rejections (non-zero error_code)
   * are returned immediately.
   *
   * @throws The signal's reason once `opts.signal` aborts.
   */
  async send<T = Record<string, unknown>>(
    command: string,
    params: Record<string, unknown> = {},
    opts: PixooCallOptions = {},
  ): Promise<PixooResult<T>> {
    const { signal } = opts;
    signal?.throwIfAborted();
    const body = JSON.stringify({ ...params, Command: command });
    let lastFailure: PixooFailure = { ok: false, kind: 'network', message: 'No attempts made' };

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await delay(this.retryDelay * (1 << (attempt - 1)), signal);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        });
        if (!res.ok) {
          lastFailure = {
            ok: false,
            kind: 'http',
            status: res.status,
            message: `HTTP ${res.status} ${res.statusText}`,
          };
          if (!RETRYABLE_HTTP_STATUSES.has(res.status)) return lastFailure;
          continue;
        }
        let json: unknown;
        try {
          json = await res.json();
        } catch (err) {
          // A body read in full that does not parse; a failed read rethrows as a network error
          if (!(err instanceof SyntaxError)) throw err;
          return {
            ok: false,
            kind: 'response',
            message: `Reply to ${command} is not JSON — is ${this.ip} a Pixoo?`,
          };
        }
        const errorCode = (json as { error_code?: unknown } | null)?.error_code;
        if (typeof errorCode !== 'number') {
          return {
            ok: false,
            kind: 'response',
            message: `Reply to ${command} carries no numeric error_code — is ${this.ip} a Pixoo?`,
          };
        }
        if (errorCode !== 0) {
          return {
            ok: false,
            kind: 'device',
            deviceCode: errorCode,
            message: `Device rejected ${command} (error_code ${errorCode})`,
          };
        }
        return { ok: true, data: json as T & { error_code: 0 } };
      } catch (err) {
        if (signal?.aborted) throw signal.reason;
        lastFailure = isAbort(err)
          ? { ok: false, kind: 'timeout', message: 'Request timed out' }
          : { ok: false, kind: 'network', message: networkMessage(err) };
      } finally {
        clearTimeout(timer);
      }
    }

    return lastFailure;
  }

  // --- Display ---

  /**
   * Reject a canvas the configured display cannot render. Both sides are fixed
   * at construction, so a mismatch is a coding error rather than a device or
   * network failure — it throws instead of returning a PixooResult.
   */
  private assertMatchesDisplay(canvas: Canvas, subject: string): void {
    if (canvas.width !== this.size || canvas.height !== this.size) {
      throw new RangeError(
        `${subject} is ${canvas.width}x${canvas.height}; client is configured for a ${this.size}x${this.size} display`,
      );
    }
  }

  /**
   * Run a display push once every push queued before it has finished. A
   * signal that aborts while the push waits its turn rejects it unsent.
   */
  private async takeTurn<T>(signal: AbortSignal | undefined, push: () => Promise<T>): Promise<T> {
    const previous = this.displayQueue;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.displayQueue = previous.then(() => finished);
    try {
      await awaitTurn(previous, signal);
      return await push();
    } finally {
      finish();
    }
  }

  /** The PicID for the next animation: the device groups frames by it. */
  private nextPicId(): number {
    this.picId = (this.picId + 1) % 10000;
    return this.picId;
  }

  /**
   * Send one frame, held back until `minPushInterval` has passed since the
   * previous frame send started. The timestamp is taken at the start of the
   * send, so request latency counts toward the interval rather than adding
   * to it.
   */
  private async sendFrame(
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<PixooResult> {
    if (this.minPushInterval > 0) {
      const wait = this.lastFrameSentAt + this.minPushInterval - Date.now();
      if (wait > 0) await delay(wait, signal);
      this.lastFrameSentAt = Date.now();
    }
    return this.send('Draw/SendHttpGif', params, { signal });
  }

  /**
   * Reset the device's internal GIF ID counter. `push()` and
   * `pushAnimation()` send it before their frames.
   * @throws The signal's reason once `opts.signal` aborts.
   */
  async resetGifId(opts: PixooCallOptions = {}): Promise<PixooResult> {
    return this.send('Draw/ResetHttpGifId', {}, opts);
  }

  /**
   * Push a single canvas frame to the display. The frame is read when the
   * call is made, so the canvas can be redrawn while the push waits its turn.
   * @param canvas - Canvas matching the client's configured size.
   * @param speed - Milliseconds per frame.
   * @throws RangeError if `speed` is not finite or the canvas does not match
   *   the client's configured size, before any request.
   * @throws The signal's reason once `opts.signal` aborts.
   */
  async push(canvas: Canvas, speed = 100, opts: PixooCallOptions = {}): Promise<PixooResult> {
    assertFiniteArgs('push', { speed });
    this.assertMatchesDisplay(canvas, 'Canvas');
    const picData = canvas.toBase64();
    return this.takeTurn(opts.signal, async () => {
      // A failed reset means the device will silently ignore the frame — surface it
      const reset = await this.resetGifId(opts);
      if (!reset.ok) return reset;
      return this.sendFrame(
        {
          PicNum: 1,
          PicWidth: this.size,
          PicOffset: 0,
          PicID: this.nextPicId(),
          PicSpeed: speed,
          PicData: picData,
        },
        opts.signal,
      );
    });
  }

  /**
   * Push a multi-frame animation to the display. The frames are read when the
   * call is made, so they can be redrawn while the push waits its turn.
   * @param frames - Non-empty array of equal-size Canvas instances (one per frame),
   *   each matching the client's configured size.
   * @param speed - Milliseconds per frame.
   * @throws RangeError if `speed` is not finite, the array is empty, the
   *   frames disagree with each other, or they do not match the client's
   *   configured size, before any request.
   * @throws The signal's reason once `opts.signal` aborts — no frame after it is sent.
   */
  async pushAnimation(
    frames: Canvas[],
    speed = 100,
    opts: PixooCallOptions = {},
  ): Promise<PixooResult> {
    assertFiniteArgs('pushAnimation', { speed });
    if (frames.length === 0) {
      throw new RangeError('pushAnimation requires at least one frame');
    }
    assertAnimationFrameDimensions(frames);
    this.assertMatchesDisplay(frames[0]!, 'Animation frame 0');
    const picData = frames.map((frame) => frame.toBase64());
    return this.takeTurn(opts.signal, async () => {
      const reset = await this.resetGifId(opts);
      if (!reset.ok) return reset;
      const picId = this.nextPicId();
      let last: PixooResult = reset; // overwritten on the first iteration — frames is non-empty
      for (let i = 0; i < picData.length; i++) {
        last = await this.sendFrame(
          {
            PicNum: picData.length,
            PicWidth: this.size,
            PicOffset: i,
            PicID: picId,
            PicSpeed: speed,
            PicData: picData[i]!,
          },
          opts.signal,
        );
        if (!last.ok) {
          await this.resetGifId(opts);
          return last;
        }
      }
      return last;
    });
  }

  // --- Channel / display control ---

  async getConfig(): Promise<PixooResult<DeviceConfig>> {
    return this.send<DeviceConfig>('Channel/GetAllConf');
  }

  async getChannel(): Promise<PixooResult<{ SelectIndex: number }>> {
    return this.send<{ SelectIndex: number }>('Channel/GetIndex');
  }

  /** @throws RangeError for a non-finite `channel`, before any request. */
  async setChannel(channel: Channel): Promise<PixooResult> {
    assertFiniteArgs('setChannel', { channel });
    return this.send('Channel/SetIndex', { SelectIndex: channel });
  }

  /**
   * Set the display brightness. Rounds to an integer and clamps to 0–100,
   * `±Infinity` included.
   * @throws RangeError for `NaN`, before any request — it would serialize as
   *   `"Brightness": null`.
   */
  async setBrightness(brightness: number): Promise<PixooResult> {
    if (Number.isNaN(brightness)) {
      throw new RangeError(`setBrightness brightness must be a number; got ${brightness}`);
    }
    return this.send('Channel/SetBrightness', {
      Brightness: Math.max(0, Math.min(100, Math.round(brightness))),
    });
  }

  async setScreen(on: boolean): Promise<PixooResult> {
    return this.send('Channel/OnOffScreen', { OnOff: on ? 1 : 0 });
  }

  /** @throws RangeError for a non-finite `clockId`, before any request. */
  async setClock(clockId: number): Promise<PixooResult> {
    assertFiniteArgs('setClock', { clockId });
    return this.send('Channel/SetClockSelectId', { ClockId: clockId });
  }

  // --- Text overlay ---

  /**
   * Show a text overlay (Draw/SendHttpText). `width` defaults to the
   * client's display size.
   * @throws RangeError for a non-finite number among `id`, `x`, `y`, `dir`,
   *   `font`, `width`, `speed`, and `align`, before any request.
   */
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
    const { id, x, y, dir, font, width, speed, align } = opts;
    assertFiniteArgs('sendText', { id, x, y, dir, font, width, speed, align });
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

  /** @throws RangeError for a non-finite `id`, before any request. */
  async clearText(id: number): Promise<PixooResult> {
    assertFiniteArgs('clearText', { id });
    return this.send('Draw/ClearHttpText', { TextId: id });
  }

  // --- Tools ---

  /** @throws RangeError for a non-finite score, before any request. */
  async setScoreboard(blue: number, red: number): Promise<PixooResult> {
    assertFiniteArgs('setScoreboard', { blue, red });
    return this.send('Tools/SetScoreBoard', { BlueScore: blue, RedScore: red });
  }

  /** @throws RangeError for non-finite `minutes` or `seconds`, before any request. */
  async setTimer(minutes: number, seconds: number, start = true): Promise<PixooResult> {
    assertFiniteArgs('setTimer', { minutes, seconds });
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

  /** @throws RangeError for a non-finite timing, before any request. */
  async playBuzzer(activeCycleMs = 500, offCycleMs = 500, totalMs = 3000): Promise<PixooResult> {
    assertFiniteArgs('playBuzzer', { activeCycleMs, offCycleMs, totalMs });
    return this.send('Device/PlayBuzzer', {
      ActiveTimeInCycle: activeCycleMs,
      OffTimeInCycle: offCycleMs,
      PlayTotalTime: totalMs,
    });
  }

  /**
   * Play a GIF the device downloads from `url` and loops (Device/PlayTFGif,
   * FileType 2). One command replaces a `Draw/SendHttpGif` request per frame,
   * so the frame ceiling of `pushAnimation()` does not apply. The caller hosts
   * the file; http and https both work.
   *
   * `ok: true` means only that the device accepted the command. It replies
   * before it downloads, and still reports success for a 404, an unreachable
   * host, or a file that is not a GIF — never that the GIF downloaded or played.
   * A GIF that is not 16×16, 32×32, or 64×64 reboots the device once it has
   * downloaded; `encodeAnimationGif(frames, speed, 1)` writes one at the
   * panel's own size.
   *
   * It waits its turn behind a push still sending, but is not held back by
   * `minPushInterval`, and does not delay the next frame send.
   *
   * @param url - URL of the GIF, at most 255 bytes as UTF-8.
   * @throws RangeError if `url` is over 255 bytes as UTF-8, before any request —
   *   the device gives no reply to a longer FileName and reboots.
   * @throws The signal's reason once `opts.signal` aborts.
   */
  async playGifUrl(url: string, opts: PixooCallOptions = {}): Promise<PixooResult> {
    const bytes = new TextEncoder().encode(url).length;
    if (bytes > MAX_GIF_URL_BYTES) {
      throw new RangeError(
        `GIF URL is ${bytes} bytes as UTF-8; Device/PlayTFGif accepts at most ${MAX_GIF_URL_BYTES}, and a longer FileName reboots the device`,
      );
    }
    return this.takeTurn(opts.signal, () =>
      this.send('Device/PlayTFGif', { FileType: 2, FileName: url }, opts),
    );
  }

  /**
   * Send a batch of commands in a single request via Draw/CommandList.
   * Note: multi-frame Draw/SendHttpGif calls cannot be batched — use pushAnimation() instead.
   */
  async batch(commands: Array<{ Command: string; [key: string]: unknown }>): Promise<PixooResult> {
    return this.send('Draw/CommandList', { CommandList: commands });
  }
}
