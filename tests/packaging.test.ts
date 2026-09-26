import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import * as barrel from '../src/index.js';
import * as core from '../src/core.js';
import type { GlyphMetrics } from '../src/core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Runtime exports of the pure modules: canvas, color, font, svg-path, animation, finish. */
const PURE_EXPORTS = [
  'Animation',
  'Canvas',
  'Color',
  'DEFAULT_SIZE',
  'FONT_3x5',
  'FONT_5x7',
  'FONT_DIGITS_11x18',
  'NAMED_COLORS',
  'buildAnimation',
  'correctForPanel',
  'dimColor',
  'downsample',
  'drawText',
  'drawTextCentered',
  'fillPolygon',
  'fillSubpaths',
  'hexToRgb',
  'hslToRgb',
  'lerpColor',
  'measureText',
  'parseBdf',
  'parseHexString',
  'parseSvgPath',
  'parseSvgPathSubpaths',
  'quantize',
  'renderSvgPath',
  'resolveColor',
  'rgbToHex',
  'rgbToHsl',
  'simulatePanel',
  'strokeSubpaths',
  'tryResolveColor',
];

/** Runtime exports that need Node: the device client, image loading, and file export. */
const NODE_EXPORTS = [
  'Channel',
  'PixooClient',
  'canvasToPng',
  'downsampleSprite',
  'encodeAnimationGif',
  'loadAnimation',
  'loadImage',
  'renderSprite',
  'saveAnimationGif',
  'saveAnimationPngs',
  'savePng',
  'unwrap',
];

describe('barrel entry', () => {
  it('exports the pure modules and the Node-bound ones', () => {
    expect(Object.keys(barrel).toSorted()).toEqual([...PURE_EXPORTS, ...NODE_EXPORTS].toSorted());
  });
});

describe('core entry', () => {
  it('exports the pure modules and nothing Node-bound', () => {
    expect(Object.keys(core).toSorted()).toEqual(PURE_EXPORTS.toSorted());
  });

  it('shares every binding with the barrel', () => {
    for (const [name, value] of Object.entries(core)) {
      expect(barrel[name as keyof typeof barrel], name).toBe(value);
    }
  });

  it('draws and encodes with the same Canvas the barrel pushes', () => {
    const viaCore = new core.Canvas(16);
    core.drawText(viaCore, 'HI', 1, 1, 'cyan', { font: core.FONT_5x7 });
    const viaBarrel = new barrel.Canvas(16);
    barrel.drawText(viaBarrel, 'HI', 1, 1, 'cyan', { font: barrel.FONT_5x7 });

    expect(viaCore).toBeInstanceOf(barrel.Canvas);
    expect(viaCore.toBase64()).toBe(viaBarrel.toBase64());
  });

  it('parses a BDF font and draws the numeral face identically through both entries', () => {
    const bdf = [
      'STARTFONT 2.1',
      'FONTBOUNDINGBOX 2 2 0 0',
      'STARTCHAR degree',
      'ENCODING 176',
      'DWIDTH 3 0',
      'BBX 2 2 0 0',
      'BITMAP',
      'C0',
      'C0',
      'ENDCHAR',
      'ENDFONT',
    ].join('\n');
    const placement: GlyphMetrics = { width: 2, x: 0, y: 0, advance: 3 };
    const viaCore = core.parseBdf(bdf);
    expect(viaCore).toEqual(barrel.parseBdf(bdf));
    expect(viaCore.metrics).toEqual({ '°': placement });

    const draw = (entry: typeof core) => {
      const c = new entry.Canvas(64);
      entry.drawText(c, '12:45', 1, 1, 'white', { font: entry.FONT_DIGITS_11x18 });
      entry.drawText(c, '°', 1, 30, 'white', { font: viaCore });
      return c.toBase64();
    };
    expect(draw(core)).toBe(draw(barrel));
  });

  it('finishes a render identically through both entries', () => {
    const response = [
      [0, 0],
      [4, 0],
      [255, 1],
    ] as const;
    const finish = (entry: typeof core) => {
      const render = new entry.Canvas(256, 256).gradientV('navy', 'gold');
      render.fillCircle(128, 128, 70, 'claude');
      const frame = entry.downsample(render, 64, 64);
      const posters = [
        entry.quantize(frame, { colors: 16, dither: 'bayer4' }),
        entry.quantize(frame, {
          palette: ['#000000', '#f0ead6', 'claude'],
          dither: 'floyd-steinberg',
        }),
      ];
      return [
        frame,
        ...posters,
        ...posters.flatMap((c) => [
          entry.correctForPanel(c, response),
          entry.simulatePanel(c, response),
        ]),
      ];
    };
    const viaCore = finish(core);
    for (const c of viaCore) expect(c).toBeInstanceOf(barrel.Canvas);
    expect(viaCore.map((c) => c.toBase64())).toEqual(finish(barrel).map((c) => c.toBase64()));
  });
});

describe('input validation through both entries', () => {
  const ENTRIES = [
    ['core', core],
    ['barrel', barrel],
  ] as const;

  /** `[label, call, RangeError message]` — each runs against a fresh 16×16 canvas. */
  const REJECTED: [
    string,
    (entry: typeof core, c: InstanceType<typeof core.Canvas>) => unknown,
    string,
  ][] = [
    [
      'a NaN blit offset',
      (_e, c) => c.blit(c.clone(), Number.NaN, 0),
      'blit offsets must be finite',
    ],
    [
      'a NaN setPixel alpha',
      (_e, c) => c.setPixel(1, 1, 'red', Number.NaN),
      'setPixel alpha must not be NaN',
    ],
    [
      'a NaN blendPixel alpha',
      (_e, c) => c.blendPixel(1, 1, 'red', Number.NaN),
      'blendPixel alpha must not be NaN',
    ],
    [
      'a NaN drawTriangle vertex',
      (_e, c) => c.drawTriangle(Number.NaN, 0, 1, 1, 2, 2, 'red'),
      'drawTriangle vertex coordinates must be finite',
    ],
    [
      'a NaN point in a later strokeSubpaths ring',
      (e, c) =>
        e.strokeSubpaths(
          c,
          [
            [
              { x: 1, y: 1 },
              { x: 12, y: 1 },
            ],
            [
              { x: 2, y: 8 },
              { x: 13, y: 8 },
              { x: Number.NaN, y: 14 },
            ],
          ],
          'red',
        ),
      'strokeSubpaths point coordinates must be finite',
    ],
    [
      'an infinite point in a later fillSubpaths ring',
      (e, c) =>
        e.fillSubpaths(
          c,
          [
            [
              { x: 1, y: 1 },
              { x: 12, y: 1 },
              { x: 12, y: 6 },
            ],
            [
              { x: 2, y: 8 },
              { x: 13, y: 8 },
              { x: 13, y: Number.POSITIVE_INFINITY },
            ],
          ],
          'red',
        ),
      'fillSubpaths point coordinates must be finite',
    ],
    [
      'a NaN fillPolygon point',
      (e, c) =>
        e.fillPolygon(
          c,
          [
            { x: 1, y: 1 },
            { x: 12, y: 1 },
            { x: 6, y: Number.NaN },
          ],
          'red',
        ),
      'fillPolygon point coordinates must be finite',
    ],
    [
      'a renderSvgPath coordinate of 1e999',
      (e, c) => e.renderSvgPath(c, 'M0 0 L1e999 5 L0 10', 'red'),
      'renderSvgPath path coordinates must be finite',
    ],
    [
      'a NaN renderSvgPath svgViewBox entry',
      (e, c) => e.renderSvgPath(c, 'M0 0 L8 0 L8 8 Z', 'red', [Number.NaN, 16]),
      'renderSvgPath svgViewBox dimensions must be finite',
    ],
    [
      'an infinite renderSvgPath targetRect entry in stroke mode',
      (e, c) =>
        e.renderSvgPath(c, 'M0 0 L8 0 L8 8 Z', 'red', [16, 16], [0, 0, Infinity, 16], {
          mode: 'stroke',
        }),
      'renderSvgPath targetRect coordinates and dimensions must be finite',
    ],
    [
      'a drawText scale of 0',
      (e, c) => e.drawText(c, 'A', 0, 0, 'red', { scale: 0 }),
      'drawText scale must be a finite number of at least 1; got 0',
    ],
    [
      'a NaN measureText letterSpacing',
      (e) => e.measureText('AB', { letterSpacing: Number.NaN }),
      'measureText letterSpacing must be finite; got NaN',
    ],
    [
      'a downsample width past the source',
      (e, c) => e.downsample(c, 17, 8),
      'downsample width must be an integer from 1 to 16; got 17',
    ],
    [
      'a quantize colors of 1',
      (e, c) => e.quantize(c, { colors: 1 }),
      'quantize colors must be an integer from 2 to 256; got 1',
    ],
    [
      'a repeated drive in a panel response',
      (e, c) =>
        e.simulatePanel(c, [
          [0, 0],
          [128, 0.4],
          [128, 0.5],
          [255, 1],
        ]),
      'simulatePanel response drives must be rising integers; got 128 then 128',
    ],
  ];

  it.each(ENTRIES)('rejects invalid input through the %s entry', (_name, entry) => {
    for (const [label, call, message] of REJECTED) {
      const c = new entry.Canvas(16);
      expect(() => call(entry, c), label).toThrow(new RangeError(message));
      expect(
        c.buffer.every((byte) => byte === 0),
        label,
      ).toBe(true);
    }
  });

  it('draws the degenerate and fractional shapes identically through both entries', () => {
    const draw = (entry: typeof core) => {
      const c = new entry.Canvas(64);
      const src = new entry.Canvas(4).clear('lime');
      c.drawRect(10, 10, 0, 5, 'white');
      c.drawCircle(32, 32, 7.3, 'white');
      c.drawCircle(32, 32, 1e15, 'white');
      c.blit(src, 2.5, 40.75);
      return c.toBase64();
    };
    expect(draw(core)).toBe(draw(barrel));

    const floored = new core.Canvas(64);
    floored.drawCircle(32, 32, 7.3, 'white');
    floored.blit(new core.Canvas(4).clear('lime'), 2, 40);
    expect(draw(core)).toBe(floored.toBase64());
  });

  it('fills and outlines a disc identically through both entries, the ring on the fill', () => {
    const draw = (entry: typeof core) => {
      const fill = new entry.Canvas(32).fillCircle(16, 16, 12, 'white');
      const ring = new entry.Canvas(32).drawCircle(16, 16, 12, 'white');
      return { fill, ring };
    };
    const viaCore = draw(core);
    const viaBarrel = draw(barrel);
    expect(viaCore.fill.toBase64()).toBe(viaBarrel.fill.toBase64());
    expect(viaCore.ring.toBase64()).toBe(viaBarrel.ring.toBase64());

    const row4 = [...Array(32).keys()].filter((x) => viaCore.fill.getPixelRgba(x, 4)[3] !== 0);
    expect(row4).toEqual([13, 14, 15, 16, 17, 18, 19]);
    const outside = [...Array(32 * 32).keys()].filter(
      (i) =>
        viaCore.ring.getPixelRgba(i % 32, i >> 5)[3] !== 0 &&
        viaCore.fill.getPixelRgba(i % 32, i >> 5)[3] === 0,
    );
    expect(outside).toEqual([]);
  });

  it('outlines a disc about a fractional center identically through both entries, on the fill', () => {
    const outsideFill = (entry: typeof core) => {
      const fill = new entry.Canvas(32).fillCircle(10.7, 20.2, 5, 'white');
      const ring = new entry.Canvas(32).drawCircle(10.7, 20.2, 5, 'white');
      const outside = [...Array(32 * 32).keys()].filter(
        (i) =>
          ring.getPixelRgba(i % 32, i >> 5)[3] !== 0 && fill.getPixelRgba(i % 32, i >> 5)[3] === 0,
      );
      return { ring: ring.toBase64(), outside };
    };
    const viaCore = outsideFill(core);
    expect(viaCore).toEqual(outsideFill(barrel));
    expect(viaCore.outside).toEqual([]);
  });

  it("rejects a non-finite argument through the barrel's PixooClient before any request", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const promise = new barrel.PixooClient('192.0.2.1').setTimer(Number.NaN, 5);
      await expect(promise).rejects.toThrow(
        new RangeError('setTimer minutes must be a finite number; got NaN'),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/** The slice of a `bun build --metafile` report the browser checks read. */
interface Metafile {
  inputs: Record<string, { imports: { path: string; original?: string; external?: boolean }[] }>;
}

interface Bundle {
  metafile: Metafile;
  code: string;
}

/**
 * Bundle one entry for the browser. Throws when Bun rejects the build; a
 * build Bun accepts can still stub or polyfill Node, which
 * `browserViolations` reports.
 */
async function bundleForBrowser(entry: string): Promise<Bundle> {
  const directory = await mkdtemp(join(tmpdir(), 'pixoo-toolkit-bundle-'));
  try {
    const metafilePath = join(directory, 'meta.json');
    const outfile = join(directory, 'bundle.js');
    const build = spawnSync(
      'bun',
      ['build', entry, '--target=browser', `--metafile=${metafilePath}`, `--outfile=${outfile}`],
      { cwd: ROOT, encoding: 'utf8' },
    );
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error(`bun build ${entry} failed:\n${build.stderr}`);
    const [metafile, code] = await Promise.all([
      readFile(metafilePath, 'utf8').then((json) => JSON.parse(json) as Metafile),
      readFile(outfile, 'utf8'),
    ]);
    return { metafile, code };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Ways a bundle Bun accepted still depends on Node or a package. Bun exits 0
 * while stubbing an unsupported built-in to `{}` (an external import) and
 * while inlining a polyfill (a `node:` input), so the exit status proves
 * nothing on its own. An external under a relative specifier is an import
 * Bun elided because only types use it — never resolved, never emitted.
 */
function browserViolations({ metafile, code }: Bundle): string[] {
  const violations: string[] = [];
  for (const [input, { imports }] of Object.entries(metafile.inputs)) {
    if (input.startsWith('node:')) violations.push(`bundles a polyfill for ${input}`);
    if (input.includes('node_modules/')) violations.push(`bundles package file ${input}`);
    for (const { path, external } of imports) {
      if (external && !path.startsWith('.')) violations.push(`${input} leaves ${path} external`);
    }
  }
  for (const name of ['Buffer', 'process', 'require']) {
    if (new RegExp(`\\b${name}\\b`).test(code)) violations.push(`output references ${name}`);
  }
  return violations;
}

/** Bundle a throwaway module written to a temporary directory. */
async function bundleFixture(source: string): Promise<Bundle> {
  const directory = await mkdtemp(join(tmpdir(), 'pixoo-toolkit-fixture-'));
  try {
    const entry = join(directory, 'fixture.ts');
    await writeFile(entry, source);
    return await bundleForBrowser(entry);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('browser bundle of src/core.ts', () => {
  it('reaches only the pure src modules, through relative imports', async () => {
    const { metafile } = await bundleForBrowser('src/core.ts');

    expect(Object.keys(metafile.inputs).toSorted()).toEqual([
      'src/animation.ts',
      'src/canvas.ts',
      'src/color.ts',
      'src/core.ts',
      'src/finish.ts',
      'src/font.ts',
      'src/svg-path.ts',
    ]);
    for (const [input, { imports }] of Object.entries(metafile.inputs)) {
      for (const { path, original = path } of imports) {
        expect(original, `${input} → ${path}`).toMatch(/^\.\/[\w-]+\.js$/);
      }
    }
  });

  it('carries no Node built-in, package, or Node global', async () => {
    expect(browserViolations(await bundleForBrowser('src/core.ts'))).toEqual([]);
  });

  const gifenc = createRequire(import.meta.url).resolve('gifenc');

  it.each([
    [
      'stubs node:fs/promises',
      "import { writeFile } from 'node:fs/promises';\nexport const save = writeFile;\n",
      'leaves node:fs/promises external',
    ],
    [
      'polyfills node:buffer',
      "import { Buffer } from 'node:buffer';\nexport const encode = (b: Uint8Array) => Buffer.from(b).toString('base64');\n",
      'bundles a polyfill for node:buffer',
    ],
    [
      'inlines a package',
      `export { GIFEncoder } from ${JSON.stringify(gifenc)};\n`,
      'bundles package file node_modules/gifenc/',
    ],
    [
      'calls the Buffer global',
      "export const encode = (b: Uint8Array) => Buffer.from(b).toString('base64');\n",
      'output references Buffer',
    ],
    [
      'reads process',
      'export const version = () => process.versions.node;\n',
      'output references process',
    ],
    [
      'calls require',
      "export const load = () => require('node:fs');\n",
      'output references require',
    ],
  ])('flags a module Bun bundles although it %s', async (_name, source, violation) => {
    const violations = browserViolations(await bundleFixture(source));
    expect(violations).toContainEqual(expect.stringContaining(violation));
  });
});

/** Parsed `package.json` fields the packaging checks read. */
interface PackageJson {
  files: string[];
  exports: Record<string, Record<string, string>>;
}

/** The `tsconfig.json` compiler options that decide what `tsc` emits and where. */
interface CompilerOptions {
  outDir: string;
  rootDir: string;
  declaration?: boolean;
  sourceMap?: boolean;
  declarationMap?: boolean;
}

/** One file `tsc` emits; a map also carries the source file its `sources` entry names. */
interface Emitted {
  file: string;
  source?: string;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(join(ROOT, file), 'utf8')) as T;
}

/** Every file `tsc` emits for the `src` modules, derived from `tsconfig.json`. */
async function emittedFiles(): Promise<Emitted[]> {
  const [{ compilerOptions }, entries] = await Promise.all([
    readJson<{ compilerOptions: CompilerOptions }>('tsconfig.json'),
    readdir(join(ROOT, 'src')),
  ]);
  const { outDir, rootDir, declaration, sourceMap, declarationMap } = compilerOptions;
  return entries
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.d.ts'))
    .flatMap((entry) => {
      const source = `src/${entry}`;
      const base = posix.join(outDir, posix.relative(rootDir, source)).replace(/\.ts$/, '');
      return [
        { file: `${base}.js` },
        ...(sourceMap ? [{ file: `${base}.js.map`, source }] : []),
        ...(declaration ? [{ file: `${base}.d.ts` }] : []),
        ...(declaration && declarationMap ? [{ file: `${base}.d.ts.map`, source }] : []),
      ];
    });
}

/** Whether a package-relative path falls under an entry of `package.json` `files`. */
function isPacked(path: string, files: readonly string[]): boolean {
  return files.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

describe('package.json', () => {
  it('exports the barrel and the browser-safe ./core entry', async () => {
    const { exports } = await readJson<PackageJson>('package.json');
    expect(exports).toEqual({
      '.': { types: './dist/src/index.d.ts', default: './dist/src/index.js' },
      './core': { types: './dist/src/core.d.ts', default: './dist/src/core.js' },
    });
  });

  it('points every export at a packed file tsc emits', async () => {
    const [{ exports, files }, emitted] = await Promise.all([
      readJson<PackageJson>('package.json'),
      emittedFiles(),
    ]);
    for (const [subpath, conditions] of Object.entries(exports)) {
      for (const [condition, target] of Object.entries(conditions)) {
        const file = target.replace(/^\.\//, '');
        expect(
          emitted.map((e) => e.file),
          `${subpath} ${condition}`,
        ).toContain(file);
        expect(isPacked(file, files), `${subpath} ${condition}`).toBe(true);
      }
    }
  });

  it('packs every file tsc emits for src', async () => {
    const [{ files }, emitted] = await Promise.all([
      readJson<PackageJson>('package.json'),
      emittedFiles(),
    ]);
    for (const { file } of emitted) expect(isPacked(file, files), file).toBe(true);
  });

  it('packs the source file behind every emitted source map', async () => {
    const [{ files }, emitted] = await Promise.all([
      readJson<PackageJson>('package.json'),
      emittedFiles(),
    ]);
    for (const { file, source } of emitted) {
      if (source) expect(isPacked(source, files), `${file} → ${source}`).toBe(true);
    }
  });
});
