import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PixooClient, Channel, unwrap, type PixooResult } from '../src/client.js';
import { Canvas } from '../src/canvas.js';

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
      .mockRejectedValue(
        Object.assign(new DOMException('The operation was aborted', 'AbortError')),
      );
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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ error_code: 0 }),
      });
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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ error_code: 0 }),
      });
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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ error_code: 0 }),
      });
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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ error_code: 0 }),
      });
    });

    const canvas = new Canvas();
    canvas.setPixel(0, 0, [255, 128, 64]);
    const client = new PixooClient(TEST_IP);
    await client.push(canvas);

    const decoded = Buffer.from(bodies[1]!['PicData'] as string, 'base64');
    expect(decoded.length).toBe(64 * 64 * 3);
    expect([decoded[0], decoded[1], decoded[2]]).toEqual([255, 128, 64]);
  });

  it('returns the reset failure without sending the frame', async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body) as Record<string, unknown>;
      bodies.push(body);
      const errorCode = body['Command'] === 'Draw/ResetHttpGifId' ? 5 : 0;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ error_code: errorCode }),
      });
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

  it.each([16, 32, 64] as const)(
    'keeps %i frame dimensions in every device request',
    async (size) => {
      const bodies: Record<string, unknown>[] = [];
      globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
        bodies.push(JSON.parse(opts.body));
        return Promise.resolve(mockResponse({ error_code: 0 }));
      });

      const client = new PixooClient(TEST_IP, { retries: 0 });
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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ error_code: 0 }),
      });
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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ error_code: errorCode }),
      });
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
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ error_code: errorCode }),
      });
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

describe('Channel enum', () => {
  it('has correct values', () => {
    expect(Channel.Faces).toBe(0);
    expect(Channel.Cloud).toBe(1);
    expect(Channel.Visualizer).toBe(2);
    expect(Channel.Custom).toBe(3);
  });
});
