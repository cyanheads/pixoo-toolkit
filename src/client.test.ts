import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PixooClient, Channel, type PixooResponse } from './client.js';
import { Canvas } from './canvas.js';

const TEST_IP = '192.168.1.100';

function mockFetch(response: PixooResponse, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(response),
  });
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
    expect(body.Command).toBe('Channel/SetBrightness');
    expect(body.Brightness).toBe(50);
  });

  it('returns parsed JSON response', async () => {
    globalThis.fetch = mockFetch({ error_code: 0, Brightness: 100 });
    const client = new PixooClient(TEST_IP);
    const res = await client.send('Channel/GetAllConf');
    expect(res.error_code).toBe(0);
    expect(res['Brightness']).toBe(100);
  });

  it('returns error for non-ok HTTP status', async () => {
    globalThis.fetch = mockFetch({ error_code: 0 }, 500);
    const client = new PixooClient(TEST_IP);
    const res = await client.send('Channel/GetAllConf');
    expect(res.error_code).toBe(-1);
    expect(res['message']).toContain('500');
  });

  it('returns error on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new PixooClient(TEST_IP);
    const res = await client.send('Channel/GetAllConf');
    expect(res.error_code).toBe(-1);
    expect(res['message']).toContain('ECONNREFUSED');
  });

  it('handles timeout via AbortController', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new DOMException('The operation was aborted', 'AbortError')),
    );
    const client = new PixooClient(TEST_IP, { timeout: 100 });
    const res = await client.send('Channel/GetAllConf');
    expect(res.error_code).toBe(-1);
    expect(res['message']).toBe('Request timed out');
  });

  it('handles unknown error type', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue('string error');
    const client = new PixooClient(TEST_IP);
    const res = await client.send('Channel/GetAllConf');
    expect(res.error_code).toBe(-1);
    expect(res['message']).toBe('Unknown error');
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
    expect(body.Command).toBe('Draw/CommandList');
    expect(body.CommandList).toEqual(commands);
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
    await client.push(new Canvas());
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
});

describe('PixooClient.pushAnimation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns error for empty frames', async () => {
    const client = new PixooClient(TEST_IP);
    const res = await client.pushAnimation([]);
    expect(res.error_code).toBe(-1);
    expect(res['message']).toContain('No frames');
  });

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
    await client.pushAnimation(frames, 80);

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

  it('stops and resets on frame error', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: { body: string }) => {
      callCount++;
      const body = JSON.parse(opts.body);
      // Fail on the second SendHttpGif (3rd call overall: reset, frame0, frame1)
      const errorCode = callCount === 3 ? -1 : 0;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ error_code: errorCode }),
      });
    });

    const frames = [new Canvas(), new Canvas(), new Canvas()];
    const client = new PixooClient(TEST_IP);
    const res = await client.pushAnimation(frames);
    expect(res.error_code).toBe(-1);
    // Should have called: reset, frame0 (ok), frame1 (fail), reset (cleanup) = 4 calls
    expect(callCount).toBe(4);
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
