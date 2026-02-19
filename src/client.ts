import { Canvas } from './canvas.js';

/** Response from the Pixoo device. */
export interface PixooResponse {
  error_code: number;
  [key: string]: unknown;
}

/** Device configuration returned by Channel/GetAllConf. */
export interface DeviceConfig {
  Brightness: number;
  RotationFlag: number;
  ClockTime: number;
  GalleryTime: number;
  SingleGalleyTime: number;
  PowerOnChannelId: number;
  GalleryShowTimeFlag: number;
  CurClockId: number;
  Time24Flag: number;
  TemperatureMode: number;
  GyrateAngle: number;
  MirrorFlag: number;
  LightSwitch: number;
}

export enum Channel {
  Faces = 0,
  Cloud = 1,
  Visualizer = 2,
  Custom = 3,
}

export interface PixooClientOptions {
  /** Request timeout in ms (default: 5000). */
  timeout?: number;
}

/**
 * HTTP client for a Divoom Pixoo-64 device.
 *
 * All commands go through `POST http://<ip>/post` with JSON bodies.
 */
export class PixooClient {
  readonly url: string;
  private readonly timeout: number;
  private picId = Date.now() % 10000;

  constructor(
    readonly ip: string,
    opts: PixooClientOptions = {},
  ) {
    this.url = `http://${ip}/post`;
    this.timeout = opts.timeout ?? 5000;
  }

  /** Send a raw command and return the parsed response. */
  async send(command: string, params: Record<string, unknown> = {}): Promise<PixooResponse> {
    const body = JSON.stringify({ Command: command, ...params });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      return (await res.json()) as PixooResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Display ---

  /** Reset the device's internal GIF ID counter. Call before pushing if stale. */
  async resetGifId(): Promise<PixooResponse> {
    return this.send('Draw/ResetHttpGifId');
  }

  /** Push a single canvas frame to the display. */
  async push(canvas: Canvas, speed = 100): Promise<PixooResponse> {
    await this.resetGifId();
    this.picId++;
    return this.send('Draw/SendHttpGif', {
      PicNum: 1,
      PicWidth: 64,
      PicOffset: 0,
      PicID: this.picId,
      PicSpeed: speed,
      PicData: canvas.toBase64(),
    });
  }

  /**
   * Push a multi-frame animation to the display.
   * @param frames - Array of Canvas instances (one per frame).
   * @param speed - Milliseconds per frame.
   */
  async pushAnimation(frames: Canvas[], speed = 100): Promise<PixooResponse> {
    this.picId++;
    let lastResponse: PixooResponse = { error_code: -1 };
    for (let i = 0; i < frames.length; i++) {
      lastResponse = await this.send('Draw/SendHttpGif', {
        PicNum: frames.length,
        PicWidth: 64,
        PicOffset: i,
        PicID: this.picId,
        PicSpeed: speed,
        PicData: frames[i]!.toBase64(),
      });
      if (lastResponse.error_code !== 0) return lastResponse;
    }
    return lastResponse;
  }

  // --- Channel / display control ---

  async getConfig(): Promise<DeviceConfig & PixooResponse> {
    return this.send('Channel/GetAllConf') as Promise<DeviceConfig & PixooResponse>;
  }

  async getChannel(): Promise<{ SelectIndex: number } & PixooResponse> {
    return this.send('Channel/GetIndex') as Promise<{ SelectIndex: number } & PixooResponse>;
  }

  async setChannel(channel: Channel): Promise<PixooResponse> {
    return this.send('Channel/SetIndex', { SelectIndex: channel });
  }

  async setBrightness(brightness: number): Promise<PixooResponse> {
    return this.send('Channel/SetBrightness', {
      Brightness: Math.max(0, Math.min(100, Math.round(brightness))),
    });
  }

  async setScreen(on: boolean): Promise<PixooResponse> {
    return this.send('Channel/OnOffScreen', { OnOff: on ? 1 : 0 });
  }

  async setClock(clockId: number): Promise<PixooResponse> {
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
    color?: string;
    align?: number;
  }): Promise<PixooResponse> {
    return this.send('Draw/SendHttpText', {
      TextId: opts.id,
      x: opts.x,
      y: opts.y,
      dir: opts.dir ?? 0,
      font: opts.font ?? 0,
      TextWidth: opts.width ?? 64,
      TextString: opts.text,
      speed: opts.speed ?? 0,
      color: opts.color ?? '#FFFFFF',
      align: opts.align ?? 1,
    });
  }

  async clearText(id: number): Promise<PixooResponse> {
    return this.send('Draw/ClearHttpText', { TextId: id });
  }

  // --- Tools ---

  async setScoreboard(blue: number, red: number): Promise<PixooResponse> {
    return this.send('Tools/SetScoreBoard', { BlueScore: blue, RedScore: red });
  }

  async setTimer(minutes: number, seconds: number, start = true): Promise<PixooResponse> {
    return this.send('Tools/SetTimer', {
      Minute: minutes,
      Second: seconds,
      Status: start ? 1 : 0,
    });
  }

  async setStopwatch(action: 'start' | 'stop' | 'reset'): Promise<PixooResponse> {
    const status = action === 'start' ? 1 : action === 'stop' ? 0 : 2;
    return this.send('Tools/SetStopWatch', { Status: status });
  }

  async setNoise(on: boolean): Promise<PixooResponse> {
    return this.send('Tools/SetNoiseStatus', { NoiseStatus: on ? 1 : 0 });
  }

  // --- System ---

  async playBuzzer(
    activeCycleMs = 500,
    offCycleMs = 500,
    totalMs = 3000,
  ): Promise<PixooResponse> {
    return this.send('Device/PlayTFGif', {
      ActiveTimeInCycle: activeCycleMs,
      OffTimeInCycle: offCycleMs,
      PlayTotalTime: totalMs,
    });
  }

  /** Send a batch of commands in a single request. */
  async batch(
    commands: Array<{ Command: string; [key: string]: unknown }>,
  ): Promise<PixooResponse> {
    return this.send('Draw/CommandList', { CommandList: commands });
  }
}
