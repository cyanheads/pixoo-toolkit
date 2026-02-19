import { describe, it, expect, vi } from 'vitest';
import { Animation, buildAnimation } from './animation.js';
import { Canvas } from './canvas.js';

describe('Animation construction', () => {
  it('creates the specified number of frames', () => {
    const anim = new Animation(10);
    expect(anim.frames).toHaveLength(10);
    expect(anim.length).toBe(10);
  });

  it('uses default speed of 100ms', () => {
    const anim = new Animation(5);
    expect(anim.speed).toBe(100);
  });

  it('accepts custom speed', () => {
    const anim = new Animation(5, 50);
    expect(anim.speed).toBe(50);
  });

  it('creates Canvas instances for each frame', () => {
    const anim = new Animation(3);
    for (const frame of anim.frames) {
      expect(frame).toBeInstanceOf(Canvas);
    }
  });

  it('frames are independent canvases', () => {
    const anim = new Animation(2);
    anim.frame(0).setPixel(0, 0, [255, 0, 0]);
    expect(anim.frame(1).getPixel(0, 0)).toEqual([0, 0, 0]);
  });

  it('throws RangeError for frameCount <= 0', () => {
    expect(() => new Animation(0)).toThrow(RangeError);
    expect(() => new Animation(-1)).toThrow(RangeError);
  });

  it('warns for frameCount > 40', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new Animation(41);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('41');
    warn.mockRestore();
  });

  it('does not warn for frameCount <= 40', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new Animation(40);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('Animation.frame', () => {
  it('returns the correct frame', () => {
    const anim = new Animation(5);
    const f2 = anim.frame(2);
    expect(f2).toBe(anim.frames[2]);
  });

  it('throws RangeError for out-of-bounds index', () => {
    const anim = new Animation(5);
    expect(() => anim.frame(-1)).toThrow(RangeError);
    expect(() => anim.frame(5)).toThrow(RangeError);
    expect(() => anim.frame(100)).toThrow(RangeError);
  });
});

describe('Animation.render', () => {
  it('calls the function for each frame', () => {
    const anim = new Animation(5);
    const calls: number[] = [];
    anim.render((_canvas, i, total) => {
      calls.push(i);
      expect(total).toBe(5);
    });
    expect(calls).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns this for chaining', () => {
    const anim = new Animation(3);
    const result = anim.render(() => {});
    expect(result).toBe(anim);
  });

  it('passes the correct canvas to each call', () => {
    const anim = new Animation(3);
    anim.render((canvas, i) => {
      canvas.setPixel(0, 0, [i * 80, 0, 0]);
    });
    expect(anim.frame(0).getPixel(0, 0)).toEqual([0, 0, 0]);
    expect(anim.frame(1).getPixel(0, 0)).toEqual([80, 0, 0]);
    expect(anim.frame(2).getPixel(0, 0)).toEqual([160, 0, 0]);
  });
});

describe('Animation.addFrame', () => {
  it('appends a new frame', () => {
    const anim = new Animation(2);
    expect(anim.length).toBe(2);
    const newFrame = anim.addFrame();
    expect(anim.length).toBe(3);
    expect(newFrame).toBeInstanceOf(Canvas);
    expect(anim.frames[2]).toBe(newFrame);
  });
});

describe('buildAnimation', () => {
  it('creates and renders in one call', () => {
    const anim = buildAnimation(10, 80, (canvas, i) => {
      canvas.setPixel(i, 0, [255, 0, 0]);
    });
    expect(anim).toBeInstanceOf(Animation);
    expect(anim.length).toBe(10);
    expect(anim.speed).toBe(80);
    // Verify the render function was applied
    expect(anim.frame(5).getPixel(5, 0)).toEqual([255, 0, 0]);
    expect(anim.frame(5).getPixel(4, 0)).toEqual([0, 0, 0]);
  });
});
