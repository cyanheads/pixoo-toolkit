import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import * as barrel from '../src/index.js';
import * as core from '../src/core.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Runtime exports of the pure modules: canvas, color, font, svg-path, animation. */
const PURE_EXPORTS = [
  'Animation',
  'Canvas',
  'Color',
  'DEFAULT_SIZE',
  'FONT_3x5',
  'FONT_5x7',
  'NAMED_COLORS',
  'buildAnimation',
  'dimColor',
  'drawText',
  'drawTextCentered',
  'fillPolygon',
  'fillSubpaths',
  'hexToRgb',
  'hslToRgb',
  'lerpColor',
  'measureText',
  'parseHexString',
  'parseSvgPath',
  'parseSvgPathSubpaths',
  'renderSvgPath',
  'resolveColor',
  'rgbToHex',
  'rgbToHsl',
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
