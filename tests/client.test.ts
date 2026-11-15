import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest';
import {
  PixooClient,
  Channel,
  unwrap,
  type PixooClientOptions,
  type PixooResult,
} from '../src/client.js';
import { Canvas, type PixooSize } from '../src/canvas.js';

const TEST_IP = '192.0.2.1';

function mockResponse(response: Record<string, unknown>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(response),
  };
}

function mockFetch(response: Record<string, unknown>, status = 200) {
  return vi.fn().mockResolvedValue(mockResponse(response, status));
}

describe('PixooClient construction', () => {
  it('builds the correct URL', () => {
    const client = new PixooClient(TEST_IP);
    expect(client.url).toBe(`http://${TEST_IP}/post`);
  });

  it('exposes the IP', () => {
    const client = new PixooClient(TEST_IP);
    expect(client.ip).toBe(TEST_IP);
  });

  it.each<[string, PixooClientOptions, string]>([
    ['size 48', { size: 48 as PixooSize }, 'size must be 16, 32, or 64; got 48'],
    ['size 0', { size: 0 as PixooSize }, 'size must be 16, 32, or 64; got 0'],
    ['timeout 0', { timeout: 0 }, 'timeout must be a positive number; got 0'],
    ['timeout NaN', { timeout: Number.NaN }, 'timeout must be a positive number; got NaN'],
    [
      'timeout Infinity',
      { timeout: Number.POSITIVE_INFINITY },
      'timeout must be a positive number; got Infinity',
    ],
    ['retries -1', { retries: -1 }, 'retries must be a non-negative integer; got -1'],
    ['retries 1.5', { retries: 1.5 }, 'retries must be a non-negative integer; got 1.5'],
    ['retries NaN', { retries: Number.NaN }, 'retries must be a non-negative integer; got NaN'],
    ['retryDelay -1', { retryDelay: -1 }, 'retryDelay must be a non-negative number; got -1'],
    [
      'minPushInterval NaN',
      { minPushInterval: Number.NaN },
      'minPushInterval must be a non-negative number; got NaN',
    ],
    [
      'minPushInterval Infinity',
      { minPushInterval: Number.POSITIVE_INFINITY },
      'minPushInterval must be a non-negative number; got Infinity',
    ],
  ])('rejects %s, naming the option', (_name, opts, message) => {
    expect(() => new PixooClient(TEST_IP, opts)).toThrow(new RangeError(`PixooClient ${message}`));
  });

  it('accepts zero retries, retry delay, and push interval, and every panel size', () => {
    for (const size of [16, 32, 64] as const) {
      expect(
        new PixooClient(TEST_IP, { size, retries: 0, retryDelay: 0, minPushInterval: 0 }).size,
      ).toBe(size);
    }
  });
});

describe('PixooClient.send', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends POST with correct body', async () => {
    const fetchMock = mockFetch({ error_code: 0 });
    globalThis.fetch = fetchMock;

    const client = new PixooClient(TEST_IP);
    await client.send('Channel/GetAllConf');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://${TEST_IP}/post`);
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body);
    expect(body.Command).toBe('Channel/GetAllConf');
  });

  it('merges additional params into body', async () => {
    const fetchMock = mockFetch({ error_code: 0 });
    globalThis.fetch = fetchMock;

    const client = new PixooClient(TEST_IP);
    await client.send('Channel/SetBrightness', { Brightness: 50 });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toEqual({ Command: 'Channel/SetBrightness', Brightness: 50 });
  });

  it('keeps the positional command authoritative over a colliding raw param', async () => {
    const fetchMock = mockFetch({ error_code: 0 });
    globalThis.fetch = fetchMock;

    const client = new PixooClient(TEST_IP);
    await client.send('Expected/Command', {
      Command: 'Injected/Command',
      Preserved: 1,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toEqual({ Command: 'Expected/Command', Preserved: 1 });
  });

  it('returns ok with the parsed response data', async () => {
    globalThis.fetch = mockFetch({ error_code: 0, Brightness: 100 });
    const client = new PixooClient(TEST_IP);
    const res = await client.send('Channel/GetAllConf');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.error_code).toBe(0);
      expect(res.data['Brightness']).toBe(100);
    }
  });

  it('returns a device failure for non-zero error_code', async () => {
    globalThis.fetch = mockFetch({ error_code: 5 });
    const client = new PixooClient(TEST_IP);
    const res = await client.send('Draw/SendHttpGif');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('device');
      expect(res.deviceCode).toBe(5);
      expect(res.message).toContain('Draw/SendHttpGif');
    }
  });

  it('does not retry device rejections', async () => {
    const fetchMock = mockFetch({ error_code: 5 });
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 2, retryDelay: 10 });
    const res = await client.send('Channel/GetAllConf');
    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('returns an http failure for non-ok HTTP status', async () => {
    const fetchMock = mockFetch({ error_code: 0 }, 500);
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 0 });
    const res = await client.send('Channel/GetAllConf');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('http');
      expect(res.status).toBe(500);
      expect(res.message).toContain('500');
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([408, 429, 500, 502, 503, 504])(
    'retries HTTP %i through the configured attempt budget',
    async (status) => {
      const fetchMock = mockFetch({ error_code: 0 }, status);
      globalThis.fetch = fetchMock;
      const client = new PixooClient(TEST_IP, { retries: 2, retryDelay: 0 });

      const res = await client.send('Channel/GetAllConf');

      expect(res).toMatchObject({ ok: false, kind: 'http', status });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it.each([400, 401, 404, 409, 425, 501, 505])(
    'returns HTTP %i without retrying',
    async (status) => {
      const fetchMock = mockFetch({ error_code: 0 }, status);
      globalThis.fetch = fetchMock;
      const client = new PixooClient(TEST_IP, { retries: 2, retryDelay: 0 });

      const res = await client.send('Channel/GetAllConf');

      expect(res).toMatchObject({ ok: false, kind: 'http', status });
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('returns success after a retryable HTTP response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ error_code: 0 }, 503))
      .mockResolvedValueOnce(mockResponse({ error_code: 0, Brightness: 80 }));
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 1, retryDelay: 0 });

    const res = await client.send('Channel/GetAllConf');

    expect(res).toEqual({ ok: true, data: { error_code: 0, Brightness: 80 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns a network failure on fetch rejection', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 0 });
    const res = await client.send('Channel/GetAllConf');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('network');
      expect(res.message).toContain('ECONNREFUSED');
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('returns a timeout failure on AbortError', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { timeout: 100, retries: 0 });
    const res = await client.send('Channel/GetAllConf');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('timeout');
      expect(res.message).toBe('Request timed out');
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('handles unknown error type as a network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue('string error');
    const client = new PixooClient(TEST_IP, { retries: 0 });
    const res = await client.send('Channel/GetAllConf');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('network');
      expect(res.message).toBe('Unknown error');
    }
  });

  it('retries on transient failure then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('ECONNRESET'));
      return Promise.resolve(mockResponse({ error_code: 0 }));
    });
    const client = new PixooClient(TEST_IP, { retries: 1, retryDelay: 10 });
    const res = await client.send('Channel/GetAllConf');
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('exhausts retries and returns the last failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new PixooClient(TEST_IP, { retries: 2, retryDelay: 10 });
    const res = await client.send('Channel/GetAllConf');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('network');
      expect(res.message).toContain('ECONNREFUSED');
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('retries an AbortError timeout', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 1, retryDelay: 0 });

    const res = await client.send('Channel/GetAllConf');

    expect(res).toMatchObject({ ok: false, kind: 'timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns a response failure for a 200 reply that is not JSON, without retrying (issue repro)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
    });
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 2, retryDelay: 0 });

    const res = await client.send('Channel/GetAllConf');

    expect(res).toEqual({
      ok: false,
      kind: 'response',
      message: `Reply to Channel/GetAllConf is not JSON — is ${TEST_IP} a Pixoo?`,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each<[string, unknown]>([
    ['no error_code', { Brightness: 100 }],
    ['a string error_code', { error_code: 'Request data illegal json' }],
    ['a null body', null],
    ['an array body', [0]],
  ])('returns a response failure for JSON with %s, without retrying', async (_name, body) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(body),
    });
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 2, retryDelay: 0 });

    const res = await client.send('Channel/GetAllConf');

    expect(res).toEqual({
      ok: false,
      kind: 'response',
      message: `Reply to Channel/GetAllConf carries no numeric error_code — is ${TEST_IP} a Pixoo?`,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries a body that fails to read as a network failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.reject(new TypeError('terminated')),
    });
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 1, retryDelay: 0 });

    const res = await client.send('Channel/GetAllConf');

    expect(res).toEqual({ ok: false, kind: 'network', message: 'terminated' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("names the cause of Node's bare 'fetch failed'", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new TypeError('fetch failed', {
        cause: new Error(`connect ECONNREFUSED ${TEST_IP}:80`),
      }),
    );
    const client = new PixooClient(TEST_IP, { retries: 0 });

    const res = await client.send('Channel/GetAllConf');

    expect(res).toEqual({
      ok: false,
      kind: 'network',
      message: `fetch failed: connect ECONNREFUSED ${TEST_IP}:80`,
    });
  });
});

describe('PixooClient cancellation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** A fetch that answers `{ error_code: 0 }` and records each command and its signal. */
  function recordingFetch(onSend?: (command: string, offset: number | undefined) => void) {
    const sent: Array<{ command: string; offset?: number; signal: AbortSignal }> = [];
    const fn = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      sent.push({ command: body.Command, offset: body.PicOffset, signal: init.signal! });
      onSend?.(body.Command, body.PicOffset);
      return Promise.resolve(mockResponse({ error_code: 0 }));
    });
    return { fn, sent };
  }

  it('rejects with the reason of an already-aborted signal and sends nothing', async () => {
    const { fn } = recordingFetch();
    globalThis.fetch = fn;
    const reason = new Error('scene replaced');
    const signal = AbortSignal.abort(reason);
    const client = new PixooClient(TEST_IP);

    await expect(client.send('Channel/GetAllConf', {}, { signal })).rejects.toBe(reason);
    await expect(client.push(new Canvas(), 100, { signal })).rejects.toBe(reason);
    await expect(client.pushAnimation([new Canvas()], 100, { signal })).rejects.toBe(reason);
    await expect(client.playGifUrl('http://192.0.2.10/a.gif', { signal })).rejects.toBe(reason);
    expect(fn).not.toHaveBeenCalled();
  });

  it('aborts the request on the wire with the caller signal', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
          controller.abort(new Error('stop'));
        }),
    );
    const client = new PixooClient(TEST_IP, { retries: 3, retryDelay: 0 });

    await expect(
      client.send('Channel/GetAllConf', {}, { signal: controller.signal }),
    ).rejects.toThrow('stop');
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('sends no retry once the signal aborts after a failed attempt', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn().mockImplementation(() => {
      controller.abort(new Error('stop'));
      return Promise.reject(new Error('ECONNRESET'));
    });
    const client = new PixooClient(TEST_IP, { retries: 3, retryDelay: 0 });

    await expect(
      client.send('Channel/GetAllConf', {}, { signal: controller.signal }),
    ).rejects.toThrow('stop');
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('sends no frame, and no trailing reset, after the signal aborts mid-animation', async () => {
    const controller = new AbortController();
    const { fn, sent } = recordingFetch((command, offset) => {
      if (command === 'Draw/SendHttpGif' && offset === 1) controller.abort(new Error('stop'));
    });
    globalThis.fetch = fn;
    const client = new PixooClient(TEST_IP);
    const frames = [new Canvas(), new Canvas(), new Canvas(), new Canvas()];

    await expect(client.pushAnimation(frames, 100, { signal: controller.signal })).rejects.toThrow(
      'stop',
    );
    expect(sent.map((s) => `${s.command}${s.offset === undefined ? '' : `#${s.offset}`}`)).toEqual([
      'Draw/ResetHttpGifId',
      'Draw/SendHttpGif#0',
      'Draw/SendHttpGif#1',
    ]);
  });

  it('passes a signal to every request of a push, aborted with the caller', async () => {
    const controller = new AbortController();
    const { fn, sent } = recordingFetch();
    globalThis.fetch = fn;
    const client = new PixooClient(TEST_IP);

    await client.push(new Canvas(), 100, { signal: controller.signal });
    controller.abort();

    expect(sent).toHaveLength(2);
    for (const { signal } of sent) expect(signal.aborted).toBe(true);
  });
});

describe('unwrap', () => {
  it('returns the data for ok results', () => {
    const res: PixooResult = { ok: true, data: { error_code: 0, Brightness: 80 } };
    expect(unwrap(res)['Brightness']).toBe(80);
  });

  it('throws with kind and message for failures', () => {
    const res: PixooResult = { ok: false, kind: 'timeout', message: 'Request timed out' };
    expect(() => unwrap(res)).toThrow('[timeout] Request timed out');
  });
});

describe('PixooClient convenience methods', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = mockFetch({ error_code: 0 });
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getConfig sends Channel/GetAllConf', async () => {
    const client = new PixooClient(TEST_IP);
    await client.getConfig();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.Command).toBe('Channel/GetAllConf');
  });

  it('getChannel returns typed SelectIndex data', async () => {
    globalThis.fetch = mockFetch({ error_code: 0, SelectIndex: 3 });
    const client = new PixooClient(TEST_IP);
    const res = await client.getChannel();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.SelectIndex).toBe(3);
  });

  it('setChannel sends correct SelectIndex', async () => {
    const client = new PixooClient(TEST_IP);
    await client.setChannel(Channel.Custom);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.Command).toBe('Channel/SetIndex');
    expect(body.SelectIndex).toBe(3);
  });

  it('setBrightness clamps to 0-100', async () => {
    const client = new PixooClient(TEST_IP);
    await client.setBrightness(150);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.Brightness).toBe(100);
  });

  it('setBrightness clamps negative to 0', async () => {
    const client = new PixooClient(TEST_IP);
    await client.setBrightness(-10);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.Brightness).toBe(0);
  });

  it.each([
    [Number.POSITIVE_INFINITY, 100],
    [Number.NEGATIVE_INFINITY, 0],
    [100, 100],
    [0, 0],
    [49.5, 50],
    [50.4, 50],
    [-0.4, 0],
    [100.4, 100],
  ])('setBrightness(%d) sends Brightness %i', async (input, sent) => {
    const client = new PixooClient(TEST_IP);
    const res = await client.setBrightness(input);
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      Command: 'Channel/SetBrightness',
      Brightness: sent,
    });
  });

  it('setBrightness(NaN) throws RangeError without sending a request', async () => {
    const client = new PixooClient(TEST_IP);
    const promise = client.setBrightness(Number.NaN);
    await expect(promise).rejects.toThrow(RangeError);
    await expect(promise).rejects.toThrow('setBrightness brightness must be a number; got NaN');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('setScreen sends OnOff flag', async () => {
    const client = new PixooClient(TEST_IP);
    await client.setScreen(true);
    let body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.OnOff).toBe(1);

    await client.setScreen(false);
    body = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(body.OnOff).toBe(0);
  });

  it('setClock sends ClockId', async () => {
    const client = new PixooClient(TEST_IP);
    await client.setClock(42);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.ClockId).toBe(42);
  });

  it('sendText formats color as hex string', async () => {
    const client = new PixooClient(TEST_IP);
    await client.sendText({ id: 1, x: 0, y: 0, text: 'Hello', color: [255, 0, 0] });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.color).toBe('#ff0000');
    expect(body.TextString).toBe('Hello');
  });

  it('clearText sends correct TextId', async () => {
    const client = new PixooClient(TEST_IP);
    await client.clearText(5);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.Command).toBe('Draw/ClearHttpText');
    expect(body.TextId).toBe(5);
  });

  it('setScoreboard sends scores', async () => {
    const client = new PixooClient(TEST_IP);
    await client.setScoreboard(10, 20);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.BlueScore).toBe(10);
    expect(body.RedScore).toBe(20);
  });

  it('setTimer sends minutes, seconds, status', async () => {
    const client = new PixooClient(TEST_IP);
    await client.setTimer(5, 30, true);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.Minute).toBe(5);
    expect(body.Second).toBe(30);
    expect(body.Status).toBe(1);
  });

  it('setStopwatch maps action to status', async () => {
    const client = new PixooClient(TEST_IP);
    await client.setStopwatch('start');
    let body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.Status).toBe(1);

    await client.setStopwatch('stop');
    body = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(body.Status).toBe(0);

    await client.setStopwatch('reset');
    body = JSON.parse(fetchMock.mock.calls[2]![1].body);
    expect(body.Status).toBe(2);
  });

  it('setNoise sends NoiseStatus', async () => {
    const client = new PixooClient(TEST_IP);
    await client.setNoise(true);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.NoiseStatus).toBe(1);
  });

  it('playBuzzer sends timing params', async () => {
    const client = new PixooClient(TEST_IP);
    await client.playBuzzer(100, 200, 1000);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.ActiveTimeInCycle).toBe(100);
    expect(body.OffTimeInCycle).toBe(200);
    expect(body.PlayTotalTime).toBe(1000);
  });

  it('playGifUrl sends only Device/PlayTFGif with FileType 2 and the URL', async () => {
    const client = new PixooClient(TEST_IP);
    const url = 'http://192.0.2.10:8765/a.gif';

    const res = await client.playGifUrl(url);

    expect(res).toEqual({ ok: true, data: { error_code: 0 } });
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toEqual({ Command: 'Device/PlayTFGif', FileType: 2, FileName: url });
  });

  it('batch sends CommandList', async () => {
    const client = new PixooClient(TEST_IP);
    const commands = [
      { Command: 'Channel/SetBrightness', Brightness: 50 },
      { Command: 'Channel/OnOffScreen', OnOff: 1 },
    ];
    await client.batch(commands);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toEqual({ Command: 'Draw/CommandList', CommandList: commands });
  });

  /** Finite arguments go out unchanged — fractional and negative ones included. */
  it.each<[string, (c: PixooClient) => Promise<PixooResult>, Record<string, unknown>]>([
    [
      'setTimer',
      (c) => c.setTimer(2.5, -1, false),
      { Command: 'Tools/SetTimer', Minute: 2.5, Second: -1, Status: 0 },
    ],
    [
      'setScoreboard',
      (c) => c.setScoreboard(0, 999.5),
      { Command: 'Tools/SetScoreBoard', BlueScore: 0, RedScore: 999.5 },
    ],
    ['setClock', (c) => c.setClock(-7), { Command: 'Channel/SetClockSelectId', ClockId: -7 }],
    [
      'playBuzzer',
      (c) => c.playBuzzer(0.5, 0, 12345),
      {
        Command: 'Device/PlayBuzzer',
        ActiveTimeInCycle: 0.5,
        OffTimeInCycle: 0,
        PlayTotalTime: 12345,
      },
    ],
    [
      'playBuzzer defaults',
      (c) => c.playBuzzer(),
      {
        Command: 'Device/PlayBuzzer',
        ActiveTimeInCycle: 500,
        OffTimeInCycle: 500,
        PlayTotalTime: 3000,
      },
    ],
    [
      'sendText defaults',
      (c) => c.sendText({ id: 1, x: 0, y: 0, text: 'hi' }),
      {
        Command: 'Draw/SendHttpText',
        TextId: 1,
        x: 0,
        y: 0,
        dir: 0,
        font: 0,
        TextWidth: 64,
        TextString: 'hi',
        speed: 0,
        color: '#ffffff',
        align: 1,
      },
    ],
    [
      'sendText with every option',
      (c) =>
        c.sendText({
          id: 3,
          x: -2.5,
          y: 40,
          text: 'score',
          dir: 1,
          font: 18,
          width: 32,
          speed: 100,
          color: 'cyan',
          align: 2,
        }),
      {
        Command: 'Draw/SendHttpText',
        TextId: 3,
        x: -2.5,
        y: 40,
        dir: 1,
        font: 18,
        TextWidth: 32,
        TextString: 'score',
        speed: 100,
        color: '#00ffff',
        align: 2,
      },
    ],
    [
      'setChannel',
      (c) => c.setChannel(Channel.Faces),
      { Command: 'Channel/SetIndex', SelectIndex: 0 },
    ],
    ['clearText', (c) => c.clearText(-1.5), { Command: 'Draw/ClearHttpText', TextId: -1.5 }],
  ])('%s sends its finite arguments unchanged', async (_name, call, body) => {
    const client = new PixooClient(TEST_IP);
    const res = await call(client);
    expect(res).toEqual({ ok: true, data: { error_code: 0 } });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual(body);
  });
});

describe('PixooClient non-finite arguments', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = mockFetch({ error_code: 0 });
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const NON_FINITE: [string, number][] = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ];

  type Call = (c: PixooClient, v: number) => Promise<PixooResult>;

  const GUARDED: [method: string, param: string, call: Call][] = [
    ['setTimer', 'minutes', (c, v) => c.setTimer(v, 5)],
    ['setTimer', 'seconds', (c, v) => c.setTimer(1, v)],
    ['setScoreboard', 'blue', (c, v) => c.setScoreboard(v, 1)],
    ['setScoreboard', 'red', (c, v) => c.setScoreboard(1, v)],
    ['setClock', 'clockId', (c, v) => c.setClock(v)],
    ['playBuzzer', 'activeCycleMs', (c, v) => c.playBuzzer(v, 500, 1000)],
    ['playBuzzer', 'offCycleMs', (c, v) => c.playBuzzer(500, v, 1000)],
    ['playBuzzer', 'totalMs', (c, v) => c.playBuzzer(500, 500, v)],
    ['sendText', 'id', (c, v) => c.sendText({ id: v, x: 0, y: 0, text: 'hi' })],
    ['sendText', 'x', (c, v) => c.sendText({ id: 1, x: v, y: 0, text: 'hi' })],
    ['sendText', 'y', (c, v) => c.sendText({ id: 1, x: 0, y: v, text: 'hi' })],
    ['sendText', 'dir', (c, v) => c.sendText({ id: 1, x: 0, y: 0, text: 'hi', dir: v })],
    ['sendText', 'font', (c, v) => c.sendText({ id: 1, x: 0, y: 0, text: 'hi', font: v })],
    ['sendText', 'width', (c, v) => c.sendText({ id: 1, x: 0, y: 0, text: 'hi', width: v })],
    ['sendText', 'speed', (c, v) => c.sendText({ id: 1, x: 0, y: 0, text: 'hi', speed: v })],
    ['sendText', 'align', (c, v) => c.sendText({ id: 1, x: 0, y: 0, text: 'hi', align: v })],
    ['setChannel', 'channel', (c, v) => c.setChannel(v as Channel)],
    ['clearText', 'id', (c, v) => c.clearText(v)],
    ['push', 'speed', (c, v) => c.push(new Canvas(), v)],
    ['pushAnimation', 'speed', (c, v) => c.pushAnimation([new Canvas(), new Canvas()], v)],
  ];

  const cases = GUARDED.flatMap(([method, param, call]) =>
    NON_FINITE.map(
      ([valueName, value]) =>
        [method, param, valueName, call, value] as [string, string, string, Call, number],
    ),
  );

  it.each(cases)(
    '%s rejects %s = %s before any request',
    async (method, param, valueName, call, value) => {
      const promise = call(new PixooClient(TEST_IP), value);
      await expect(promise).rejects.toThrow(RangeError);
      await expect(promise).rejects.toThrow(
        `${method} ${param} must be a finite number; got ${valueName}`,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('sends nothing for the reproduction calls, which went out with null before (issue repro)', async () => {
    const device = new PixooClient(TEST_IP);
    const calls = [
      () => device.setTimer(Number.NaN, 5),
      () => device.setScoreboard(Number.NaN, 1),
      () => device.setClock(Number.NaN),
      () => device.playBuzzer(Number.NaN, 500, 1000),
      () => device.sendText({ id: 1, x: Number.NaN, y: 0, text: 'hi' }),
      () => device.setChannel(Number.NaN as Channel),
      () => device.clearText(Number.NaN),
      () => device.push(new Canvas(), Number.NaN),
      () => device.pushAnimation([new Canvas(), new Canvas()], Number.POSITIVE_INFINITY),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks sendText numbers before resolving its color', async () => {
    const promise = new PixooClient(TEST_IP).sendText({
      id: 1,
      x: Number.NaN,
      y: 0,
      text: 'hi',
      color: 'not-a-color',
    });
    await expect(promise).rejects.toThrow('sendText x must be a finite number; got NaN');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PixooClient.playGifUrl', () => {
  /** 26 ASCII bytes; each test pads it to the byte length under test. */
  const BASE = 'http://192.0.2.10/a.gif?q=';
  const utf8Length = (s: string) => new TextEncoder().encode(s).length;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    ['ASCII', BASE + 'x'.repeat(229)],
    ['2-byte characters', BASE + 'é'.repeat(114) + 'x'],
    ['4-byte characters', BASE + '🎞'.repeat(57) + 'x'],
  ])('sends a 255-byte URL of %s unchanged', async (_label, url) => {
    expect(utf8Length(url)).toBe(255);
    const fetchMock = mockFetch({ error_code: 0 });
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 0 });

    const res = await client.playGifUrl(url);

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).FileName).toBe(url);
  });

  /** The multi-byte rows stay under 256 UTF-16 code units, so only a byte count rejects them. */
  it.each([
    ['ASCII', BASE + 'x'.repeat(230), 256, 256],
    ['2-byte characters', BASE + 'é'.repeat(115), 141, 256],
    ['4-byte characters', BASE + '🎞'.repeat(58), 142, 258],
    ['ASCII, far over the limit', BASE + 'x'.repeat(300), 326, 326],
  ])('rejects a URL of %s before making a request', async (_label, url, units, bytes) => {
    expect(url.length).toBe(units);
    expect(utf8Length(url)).toBe(bytes);
    const fetchMock = mockFetch({ error_code: 0 });
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 0 });

    const promise = client.playGifUrl(url);

    await expect(promise).rejects.toThrow(RangeError);
    await expect(promise).rejects.toThrow(
      `GIF URL is ${bytes} bytes as UTF-8; Device/PlayTFGif accepts at most 255`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a device failure for a non-zero error_code', async () => {
    globalThis.fetch = mockFetch({ error_code: 1 });
    const client = new PixooClient(TEST_IP, { retries: 0 });

    const res = await client.playGifUrl('http://192.0.2.10/a.gif');

    expect(res).toEqual({
      ok: false,
      kind: 'device',
      deviceCode: 1,
      message: 'Device rejected Device/PlayTFGif (error_code 1)',
    });
  });

  it('returns a non-retryable HTTP failure after one request', async () => {
    const fetchMock = mockFetch({ error_code: 0 }, 404);
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 2, retryDelay: 0 });

    const res = await client.playGifUrl('http://192.0.2.10/a.gif');

    expect(res).toMatchObject({ ok: false, kind: 'http', status: 404 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries transient failures with the same command until one succeeds', async () => {
    const url = 'https://192.0.2.10/a.gif';
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'))
      .mockResolvedValueOnce(mockResponse({ error_code: 0 }, 503))
      .mockResolvedValueOnce(mockResponse({ error_code: 0 }));
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 2, retryDelay: 0 });

    const res = await client.playGifUrl(url);

    expect(res).toEqual({ ok: true, data: { error_code: 0 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, opts] of fetchMock.mock.calls) {
      expect(JSON.parse(opts.body)).toEqual({
        Command: 'Device/PlayTFGif',
        FileType: 2,
        FileName: url,
      });
    }
  });

  it('returns the last failure once the retry budget is spent', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 2, retryDelay: 0 });

    const res = await client.playGifUrl('http://192.0.2.10/a.gif');

    expect(res).toEqual({ ok: false, kind: 'timeout', message: 'Request timed out' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('PixooClient.push', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('resets GIF ID before pushing', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body);
      calls.push(body.Command);
      return Promise.resolve(mockResponse({ error_code: 0 }));
    });

    const client = new PixooClient(TEST_IP);
    const res = await client.push(new Canvas());
    expect(res.ok).toBe(true);
    expect(calls[0]).toBe('Draw/ResetHttpGifId');
    expect(calls[1]).toBe('Draw/SendHttpGif');
  });

  it('sends correct PicData params', async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      bodies.push(JSON.parse(opts.body));
      return Promise.resolve(mockResponse({ error_code: 0 }));
    });

    const canvas = new Canvas();
    const client = new PixooClient(TEST_IP);
    await client.push(canvas, 200);

    const gifCmd = bodies[1]!;
    expect(gifCmd['PicNum']).toBe(1);
    expect(gifCmd['PicWidth']).toBe(64);
    expect(gifCmd['PicOffset']).toBe(0);
    expect(gifCmd['PicSpeed']).toBe(200);
    expect(typeof gifCmd['PicData']).toBe('string');
    expect(typeof gifCmd['PicID']).toBe('number');
  });

  it('encodes PicData as flattened RGB (device wire format)', async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      bodies.push(JSON.parse(opts.body));
      return Promise.resolve(mockResponse({ error_code: 0 }));
    });

    const canvas = new Canvas();
    canvas.setPixel(0, 0, [255, 128, 64]);
    const client = new PixooClient(TEST_IP);
    await client.push(canvas);

    const decoded = Buffer.from(bodies[1]!['PicData'] as string, 'base64');
    expect(decoded.length).toBe(64 * 64 * 3);
    expect([decoded[0], decoded[1], decoded[2]]).toEqual([255, 128, 64]);
  });

  it.each([
    [32, 64],
    [64, 16],
  ] as const)(
    'rejects a %i-pixel client being handed a %i-pixel canvas before making a request',
    async (clientSize, canvasSize) => {
      const fetchMock = mockFetch({ error_code: 0 });
      globalThis.fetch = fetchMock;
      const client = new PixooClient(TEST_IP, { size: clientSize, retries: 0 });

      const promise = client.push(new Canvas(canvasSize));
      await expect(promise).rejects.toThrow(RangeError);
      await expect(promise).rejects.toThrow(
        `Canvas is ${canvasSize}x${canvasSize}; client is configured for a ${clientSize}x${clientSize} display`,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [64, 7],
    [7, 64],
    [320, 7],
    [64, 65],
  ] as const)(
    'rejects a %i×%i canvas on a 64-pixel client before making a request',
    async (width, height) => {
      const fetchMock = mockFetch({ error_code: 0 });
      globalThis.fetch = fetchMock;
      const client = new PixooClient(TEST_IP, { retries: 0 });

      const promise = client.push(new Canvas(width, height));
      await expect(promise).rejects.toThrow(
        new RangeError(`Canvas is ${width}x${height}; client is configured for a 64x64 display`),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([16, 32, 64] as const)('sends a matching %i-pixel canvas', async (size) => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      bodies.push(JSON.parse(opts.body));
      return Promise.resolve(mockResponse({ error_code: 0 }));
    });

    const client = new PixooClient(TEST_IP, { size, retries: 0 });
    const res = await client.push(new Canvas(size));

    expect(res.ok).toBe(true);
    expect(bodies[1]!['PicWidth']).toBe(size);
    expect(Buffer.from(bodies[1]!['PicData'] as string, 'base64')).toHaveLength(size * size * 3);
  });

  it('returns the reset failure without sending the frame', async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body) as Record<string, unknown>;
      bodies.push(body);
      const errorCode = body['Command'] === 'Draw/ResetHttpGifId' ? 5 : 0;
      return Promise.resolve(mockResponse({ error_code: errorCode }));
    });

    const client = new PixooClient(TEST_IP, { retries: 0 });
    const res = await client.push(new Canvas());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('device');
      expect(res.deviceCode).toBe(5);
    }
    expect(bodies).toHaveLength(1); // no SendHttpGif after a failed reset
  });
});

describe('PixooClient.pushAnimation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws RangeError for empty frames', async () => {
    const client = new PixooClient(TEST_IP);
    const promise = client.pushAnimation([]);
    await expect(promise).rejects.toThrow(RangeError);
    await expect(promise).rejects.toThrow('pushAnimation requires at least one frame');
  });

  it.each([
    [16, 64],
    [64, 16],
  ] as const)(
    'rejects mixed %i then %i frames before making a request',
    async (firstSize, secondSize) => {
      const fetchMock = mockFetch({ error_code: 0 });
      globalThis.fetch = fetchMock;
      const client = new PixooClient(TEST_IP, { retries: 0 });

      const promise = client.pushAnimation([new Canvas(firstSize), new Canvas(secondSize)]);
      await expect(promise).rejects.toThrow(RangeError);
      await expect(promise).rejects.toThrow(
        `Animation frame 1 is ${secondSize}x${secondSize}; expected ${firstSize}x${firstSize}`,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('reports the first mismatch in a longer frame sequence', async () => {
    const fetchMock = mockFetch({ error_code: 0 });
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 0 });

    const promise = client.pushAnimation([new Canvas(16), new Canvas(32), new Canvas(64)]);
    await expect(promise).rejects.toThrow('Animation frame 1 is 32x32; expected 16x16');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [32, 64],
    [64, 16],
  ] as const)(
    'rejects a %i-pixel client being handed %i-pixel frames before making a request',
    async (clientSize, frameSize) => {
      const fetchMock = mockFetch({ error_code: 0 });
      globalThis.fetch = fetchMock;
      const client = new PixooClient(TEST_IP, { size: clientSize, retries: 0 });

      const promise = client.pushAnimation([new Canvas(frameSize), new Canvas(frameSize)]);
      await expect(promise).rejects.toThrow(RangeError);
      await expect(promise).rejects.toThrow(
        `Animation frame 0 is ${frameSize}x${frameSize}; client is configured for a ${clientSize}x${clientSize} display`,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [64, 7],
    [7, 64],
    [320, 7],
  ] as const)(
    'rejects %i×%i frames on a 64-pixel client before making a request',
    async (width, height) => {
      const fetchMock = mockFetch({ error_code: 0 });
      globalThis.fetch = fetchMock;
      const client = new PixooClient(TEST_IP, { retries: 0 });

      const promise = client.pushAnimation([new Canvas(width, height), new Canvas(width, height)]);
      await expect(promise).rejects.toThrow(
        new RangeError(
          `Animation frame 0 is ${width}x${height}; client is configured for a 64x64 display`,
        ),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects frames that disagree only in height', async () => {
    const fetchMock = mockFetch({ error_code: 0 });
    globalThis.fetch = fetchMock;
    const client = new PixooClient(TEST_IP, { retries: 0 });

    const promise = client.pushAnimation([new Canvas(64), new Canvas(64, 7)]);
    await expect(promise).rejects.toThrow(
      new RangeError('Animation frame 1 is 64x7; expected 64x64'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([16, 32, 64] as const)(
    'keeps %i frame dimensions in every device request',
    async (size) => {
      const bodies: Record<string, unknown>[] = [];
      globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
        bodies.push(JSON.parse(opts.body));
        return Promise.resolve(mockResponse({ error_code: 0 }));
      });

      const client = new PixooClient(TEST_IP, { size, retries: 0 });
      await client.pushAnimation([new Canvas(size), new Canvas(size)]);

      expect(bodies).toHaveLength(3);
      for (const body of bodies.slice(1)) {
        expect(body['PicWidth']).toBe(size);
        expect(Buffer.from(body['PicData'] as string, 'base64')).toHaveLength(size * size * 3);
      }
    },
  );

  it('sends each frame sequentially', async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      bodies.push(JSON.parse(opts.body));
      return Promise.resolve(mockResponse({ error_code: 0 }));
    });

    const frames = [new Canvas(), new Canvas(), new Canvas()];
    const client = new PixooClient(TEST_IP);
    const res = await client.pushAnimation(frames, 80);
    expect(res.ok).toBe(true);

    // First call: ResetHttpGifId, then 3 SendHttpGif calls
    expect(bodies).toHaveLength(4);
    expect(bodies[0]!['Command']).toBe('Draw/ResetHttpGifId');
    for (let i = 1; i <= 3; i++) {
      expect(bodies[i]!['Command']).toBe('Draw/SendHttpGif');
      expect(bodies[i]!['PicNum']).toBe(3);
      expect(bodies[i]!['PicOffset']).toBe(i - 1);
      expect(bodies[i]!['PicSpeed']).toBe(80);
    }
  });

  it('returns the reset failure without sending any frames', async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body) as Record<string, unknown>;
      bodies.push(body);
      const errorCode = body['Command'] === 'Draw/ResetHttpGifId' ? 5 : 0;
      return Promise.resolve(mockResponse({ error_code: errorCode }));
    });

    const client = new PixooClient(TEST_IP, { retries: 0 });
    const res = await client.pushAnimation([new Canvas(), new Canvas()]);
    expect(res.ok).toBe(false);
    expect(bodies).toHaveLength(1);
  });

  it('stops and resets on frame error', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      // Fail on the second SendHttpGif (3rd call overall: reset, frame0, frame1)
      const errorCode = callCount === 3 ? 5 : 0;
      return Promise.resolve(mockResponse({ error_code: errorCode }));
    });

    const frames = [new Canvas(), new Canvas(), new Canvas()];
    const client = new PixooClient(TEST_IP);
    const res = await client.pushAnimation(frames);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('device');
    // Should have called: reset, frame0 (ok), frame1 (fail), reset (cleanup) = 4 calls
    expect(callCount).toBe(4);
  });
});

describe('PixooClient frame throttling', () => {
  const INTERVAL = 1000;
  let originalFetch: typeof globalThis.fetch;
  let sends: Array<{ command: string; at: number }>;

  /** Timestamps of the Draw/SendHttpGif requests, in send order. */
  function frameTimes(): number[] {
    return sends.filter((s) => s.command === 'Draw/SendHttpGif').map((s) => s.at);
  }

  /** Elapsed ms between consecutive frame sends. */
  function frameGaps(): number[] {
    const times = frameTimes();
    return times.slice(1).map((at, i) => at - times[i]!);
  }

  /** Run `work` to completion, firing every timer it sets; resolves to the fake ms it took. */
  async function elapsedMs(work: () => Promise<unknown>): Promise<number> {
    const started = Date.now();
    const done = work();
    await vi.runAllTimersAsync();
    await done;
    return Date.now() - started;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    originalFetch = globalThis.fetch;
    sends = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      sends.push({ command: JSON.parse(opts.body).Command as string, at: Date.now() });
      return Promise.resolve(mockResponse({ error_code: 0 }));
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  /** Timing stays as it was before the option existed unless it is asked for. */
  it.each([
    ['omitted', {}],
    ['zero', { minPushInterval: 0 }],
  ])('sends frames back to back when minPushInterval is %s', async (_label, opts) => {
    const client = new PixooClient(TEST_IP, { retries: 0, ...opts });

    const elapsed = await elapsedMs(() =>
      client.pushAnimation([new Canvas(), new Canvas(), new Canvas()]),
    );

    expect(frameGaps()).toEqual([0, 0]);
    expect(elapsed).toBe(0);
  });

  it('spaces animation frames by minPushInterval', async () => {
    const client = new PixooClient(TEST_IP, { retries: 0, minPushInterval: INTERVAL });

    await elapsedMs(() => client.pushAnimation([new Canvas(), new Canvas(), new Canvas()]));

    expect(frameGaps()).toEqual([INTERVAL, INTERVAL]);
  });

  it('does not delay the first frame behind its own reset', async () => {
    const client = new PixooClient(TEST_IP, { retries: 0, minPushInterval: INTERVAL });

    const elapsed = await elapsedMs(() => client.push(new Canvas()));

    expect(sends.map((s) => s.command)).toEqual(['Draw/ResetHttpGifId', 'Draw/SendHttpGif']);
    expect(elapsed).toBe(0);
  });

  it('spaces consecutive pushes without delaying the intervening reset', async () => {
    const client = new PixooClient(TEST_IP, { retries: 0, minPushInterval: INTERVAL });

    await elapsedMs(() => client.push(new Canvas()));
    await elapsedMs(() => client.push(new Canvas()));

    expect(sends.map((s) => s.command)).toEqual([
      'Draw/ResetHttpGifId',
      'Draw/SendHttpGif',
      'Draw/ResetHttpGifId',
      'Draw/SendHttpGif',
    ]);
    expect(sends[2]!.at - sends[1]!.at).toBe(0);
    expect(frameGaps()).toEqual([INTERVAL]);
  });

  it('spaces the next animation from the previous frame across the reset', async () => {
    const client = new PixooClient(TEST_IP, { retries: 0, minPushInterval: INTERVAL });

    await elapsedMs(() => client.pushAnimation([new Canvas(), new Canvas()]));
    await elapsedMs(() => client.push(new Canvas()));

    expect(frameGaps()).toEqual([INTERVAL, INTERVAL]);
  });

  it('does not delay a GIF URL play behind a frame', async () => {
    const client = new PixooClient(TEST_IP, { retries: 0, minPushInterval: INTERVAL });

    await elapsedMs(() => client.push(new Canvas()));
    const elapsed = await elapsedMs(() => client.playGifUrl('http://192.0.2.10/a.gif'));

    expect(sends.map((s) => s.command)).toEqual([
      'Draw/ResetHttpGifId',
      'Draw/SendHttpGif',
      'Device/PlayTFGif',
    ]);
    expect(elapsed).toBe(0);
  });

  it('does not delay the next frame behind a GIF URL play', async () => {
    const client = new PixooClient(TEST_IP, { retries: 0, minPushInterval: INTERVAL });

    await elapsedMs(() => client.playGifUrl('http://192.0.2.10/a.gif'));
    const elapsed = await elapsedMs(() => client.push(new Canvas()));

    expect(sends.map((s) => s.command)).toEqual([
      'Device/PlayTFGif',
      'Draw/ResetHttpGifId',
      'Draw/SendHttpGif',
    ]);
    expect(elapsed).toBe(0);
  });

  it('keeps spacing frames from the previous frame across a GIF URL play', async () => {
    const client = new PixooClient(TEST_IP, { retries: 0, minPushInterval: INTERVAL });

    await elapsedMs(() => client.push(new Canvas()));
    await elapsedMs(() => client.playGifUrl('http://192.0.2.10/a.gif'));
    await elapsedMs(() => client.push(new Canvas()));

    expect(frameGaps()).toEqual([INTERVAL]);
  });

  it('does not delay non-draw commands behind a frame', async () => {
    const client = new PixooClient(TEST_IP, { retries: 0, minPushInterval: INTERVAL });

    await elapsedMs(() => client.push(new Canvas()));
    const elapsed = await elapsedMs(async () => {
      await client.getConfig();
      await client.setBrightness(50);
    });

    expect(sends.map((s) => s.command).slice(2)).toEqual([
      'Channel/GetAllConf',
      'Channel/SetBrightness',
    ]);
    expect(elapsed).toBe(0);
  });
});

describe('PixooClient display pushes take turns', () => {
  let originalFetch: typeof globalThis.fetch;
  let sent: Array<{ command: string; picId?: number; offset?: number; data?: string; at: number }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    sent = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      sent.push({
        command: body.Command,
        picId: body.PicID,
        offset: body.PicOffset,
        data: body.PicData,
        at: Date.now(),
      });
      return Promise.resolve(mockResponse({ error_code: 0 }));
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  /** `command` or `command#offset@picId` per request, in send order. */
  const wire = () =>
    sent.map((s) => (s.offset === undefined ? s.command : `GIF#${s.offset}@${s.picId}`));

  it('sends overlapping animations one after the other, each under one PicID (issue repro)', async () => {
    const client = new PixooClient(TEST_IP, { retries: 0 });
    const a = client.pushAnimation([new Canvas(), new Canvas(), new Canvas()]);
    const b = client.pushAnimation([new Canvas(), new Canvas(), new Canvas()]);
    await Promise.all([a, b]);

    const [idA, idB] = [sent[1]!.picId, sent[5]!.picId];
    expect(idA).not.toBe(idB);
    expect(wire()).toEqual([
      'Draw/ResetHttpGifId',
      `GIF#0@${idA}`,
      `GIF#1@${idA}`,
      `GIF#2@${idA}`,
      'Draw/ResetHttpGifId',
      `GIF#0@${idB}`,
      `GIF#1@${idB}`,
      `GIF#2@${idB}`,
    ]);
  });

  it('holds a push and a GIF URL play behind an animation still sending', async () => {
    const client = new PixooClient(TEST_IP, { retries: 0 });
    const anim = client.pushAnimation([new Canvas(), new Canvas()]);
    const frame = client.push(new Canvas());
    const play = client.playGifUrl('http://192.0.2.10/a.gif');
    await Promise.all([anim, frame, play]);

    expect(sent.map((s) => s.command)).toEqual([
      'Draw/ResetHttpGifId',
      'Draw/SendHttpGif',
      'Draw/SendHttpGif',
      'Draw/ResetHttpGifId',
      'Draw/SendHttpGif',
      'Device/PlayTFGif',
    ]);
  });

  it('spaces the frames of overlapping pushes by minPushInterval', async () => {
    vi.useFakeTimers();
    const client = new PixooClient(TEST_IP, { retries: 0, minPushInterval: 1000 });
    const pushes = Promise.all([client.push(new Canvas()), client.push(new Canvas())]);
    await vi.advanceTimersByTimeAsync(1000);
    await pushes;

    const frames = sent.filter((s) => s.command === 'Draw/SendHttpGif').map((s) => s.at);
    expect(frames).toHaveLength(2);
    expect(frames[1]! - frames[0]!).toBe(1000);
  });

  it('sends what the canvas held when push was called', async () => {
    const client = new PixooClient(TEST_IP, { retries: 0 });
    const canvas = new Canvas().clear('blue');
    const expected = canvas.toBase64();
    const anim = client.pushAnimation([new Canvas()]);
    const frame = client.push(canvas);
    canvas.clear('red');
    await Promise.all([anim, frame]);

    expect(sent.at(-1)!.data).toBe(expected);
  });

  it('drops a queued push whose signal aborts before its turn, and keeps the queue moving', async () => {
    vi.useFakeTimers();
    const client = new PixooClient(TEST_IP, { retries: 0, minPushInterval: 1000 });
    const controller = new AbortController();
    const anim = client.pushAnimation([new Canvas(), new Canvas()]);
    const dropped = client.push(new Canvas(), 100, { signal: controller.signal });
    const rejected = expect(dropped).rejects.toThrow('superseded');
    controller.abort(new Error('superseded'));
    await rejected;
    const after = client.push(new Canvas());
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([anim, after]);

    expect(sent.map((s) => s.command)).toEqual([
      'Draw/ResetHttpGifId',
      'Draw/SendHttpGif',
      'Draw/SendHttpGif',
      'Draw/ResetHttpGifId',
      'Draw/SendHttpGif',
    ]);
  });

  it('rejects a push whose signal aborts during the minPushInterval wait, sending no frame', async () => {
    vi.useFakeTimers();
    const client = new PixooClient(TEST_IP, { retries: 0, minPushInterval: 1000 });
    await client.push(new Canvas());
    const controller = new AbortController();
    const second = client.push(new Canvas(), 100, { signal: controller.signal });
    const rejected = expect(second).rejects.toThrow('stop');
    await vi.advanceTimersByTimeAsync(500);
    controller.abort(new Error('stop'));
    await rejected;

    expect(sent.map((s) => s.command)).toEqual([
      'Draw/ResetHttpGifId',
      'Draw/SendHttpGif',
      'Draw/ResetHttpGifId',
    ]);
  });
});

describe('PixooClient.discover', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('maps the Divoom DeviceList to typed devices', async () => {
    const fetchMock = mockFetch({
      ReturnCode: 0,
      DeviceList: [
        { DeviceName: 'Pixoo64', DeviceId: 300012345, DevicePrivateIP: '192.0.2.2' },
        { DeviceName: 'NoIp', DeviceId: 1 }, // dropped — no usable IP
      ],
    });
    globalThis.fetch = fetchMock;

    const devices = await PixooClient.discover();
    expect(devices).toEqual([{ name: 'Pixoo64', id: 300012345, ip: '192.0.2.2' }]);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://app.divoom-gz.com/Device/ReturnSameLANDevice');
    expect(opts.method).toBe('POST');
  });

  it('returns an empty array when no devices are found', async () => {
    globalThis.fetch = mockFetch({ ReturnCode: 0, DeviceList: [] });
    await expect(PixooClient.discover()).resolves.toEqual([]);
  });

  it('throws on HTTP failure', async () => {
    globalThis.fetch = mockFetch({}, 503);
    await expect(PixooClient.discover()).rejects.toThrow('Discovery failed: HTTP 503');
  });
});

describe('Channel', () => {
  it('has correct values', () => {
    expect(Channel).toEqual({ Faces: 0, Cloud: 1, Visualizer: 2, Custom: 3 });
  });

  it('types a channel as its index', () => {
    expectTypeOf<Channel>().toEqualTypeOf<0 | 1 | 2 | 3>();
  });
});
