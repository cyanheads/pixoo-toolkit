---
name: code-simplifier
description: >
  Cleanup pass that edits the working tree of `@cyanheads/pixoo-toolkit` — over a session's uncommitted changes, or a named path or the whole codebase. Reads `git diff` (or the named target) and simplifies, consolidates, and aligns code with the rest of the toolkit — modernize syntax, cut unnecessary complexity and slop, consolidate duplicated logic, catch efficiency issues. Not a bug hunt: defects are reported, not fixed. Use after a substantive working session, or when asked to clean up, simplify, consolidate, modernize, tighten up, or scan the codebase.
metadata:
  author: cyanheads
  version: '1.0'
  audience: external
  type: workflow
---

# Code Simplifier

Cleanup pass over a session's changes or a named target. Reviews the code in scope, understands how it fits the existing codebase, and makes targeted improvements — modernizing syntax, removing unnecessary complexity, consolidating duplicated logic, catching efficiency issues. Prioritizes codebase cohesion over local perfection.

## Core philosophy

**Every change must earn its keep.** A simplification that doesn't meaningfully improve clarity, correctness, or cohesion is noise. Don't refactor for refactoring's sake. Don't create new files, abstractions, or utilities unless they solve a demonstrated problem. If the existing code works and is readable, leave it alone. The goal is a cohesive codebase, not a pristine one.

## Procedure

### Phase 1: Set the scope

Two scopes; the caller's wording picks one, and the diff is the default.

- **Diff** (nothing named): run `git status` to see the shape of the working tree, then `git diff HEAD` for all uncommitted changes (staged and unstaged). Untracked files never appear in the diff — list them with `git ls-files --others --exclude-standard` and read them directly. If the diff is empty and there are no untracked files, review the last commit (`git show HEAD`); if there is none, say the tree is clean and stop. Don't go hunting through the codebase for files to improve.
  - **The tree may hold more than one writer's work.** When the caller names the files this session touched, scope to those. Otherwise, changes you don't recognize that were modified in the last few minutes (check mtimes) are another writer's work in progress: leave them out and list them in the summary.
- **Target** (a named path, module, or "the whole codebase"): the named files are the scope, whatever their git state. Work one module at a time and re-run the gate after each, so a large scan never becomes one unverifiable diff.

### Phase 2: Understand the surrounding codebase

Don't review changes in isolation. Before any modifications:

1. **Read the full files** containing changes — not just the diff hunks. Understand imports, surrounding logic, module structure.
2. **Read `CLAUDE.md`'s Conventions section, then survey adjacent code.** The stated conventions outrank whatever the nearest file happens to do. Then look at sibling modules and shared helpers in `src/` — you need to know what already exists before deciding something is missing.
3. **Run the gate once before editing** to establish a baseline: `bun run devcheck` (typecheck, ESLint, Prettier, docs sync) and `bun run test` (Vitest — never bare `bun test`, which runs Bun's own runner). If the gate is already red, say so in the summary and don't attribute the failure to your changes.

### Phase 3: Review

Evaluate the changes across these dimensions. Not every dimension applies to every diff — skip what's irrelevant.

#### Codebase cohesion

- **Reuse** — Search for existing helpers that could replace newly written code. `color.ts` already resolves, converts, and blends colors; `canvas.ts` already clips, blends, and blits; each module carries its own `assert*` argument validators. If a function already does what the new code does, use it.
- **Consolidation** — Flag copy-paste-with-variation: near-duplicate blocks that should be unified. Only unify if the shared abstraction is genuinely simpler than the duplicated code.
- **Consistency** — New code follows the patterns of the rest of the toolkit: naming, error style, import style, type annotation style. Normalize toward the better variant when the code is inconsistent.
- **Stringly-typed code** — Flag raw strings where a string-union type or a constant already exists (`PixooErrorKind`, `BlendMode`, `Dither`, `Channel`).
- **Unneeded dependencies** — A package that duplicates a platform built-in (`fetch`, `structuredClone`, `crypto.randomUUID()`, `Object.groupBy`). If this session added it, replace its calls and remove it with `bun remove` so the lockfile follows; if it predates the session, recommend the removal in the summary.

#### Code quality

- **Redundant state** — State that duplicates existing state, cached values that could be derived, and a cache added to hide work the code could stop repeating — remove the repetition instead.
- **Unnecessary complexity** — Deep nesting that could be guard clauses, premature abstractions, over-engineered solutions to simple problems.
- **Speculative generality** — Options, parameters, generic type parameters, and branches no caller exercises. Remove them internally; on the public surface they are API — note them instead (see Dead code).
- **Pass-through layers** — Apply the deletion test: if deleting a wrapper and inlining its body makes the complexity vanish, it was a pass-through — inline it. If the same logic would reappear across several callers, it earns its keep.
- **Test-only reach** — A function exported only so a test can reach it is a shape problem, not a cleanup: name it in the summary with the module it belongs to. Don't restructure it here.
- **Weakened tests** — In tests the session changed: `.only`, `.skip`; assertions deleted or loosened (`toBeDefined()`, `expect.anything()`, a partial `toMatchObject` replacing an exact match); snapshots rewritten wholesale; tests removed along with the code they covered. Report each as a defect with `file:line` and don't fix it here.
- **Dead code** — Unreachable branches, unused variables, commented-out code, and debug leftovers (`console.log`, `debugger`) outside `scripts/`. An internal export nothing imports is dead; an export of `src/index.ts` or `src/core.ts` is API — leave it and note it.
- **Defensive code for impossible states** — Guards for cases the type system already prevents. Drop them.
- **Type escapes** — `any`, `as` casts that paper over a mismatch, `@ts-ignore`. Replace with a narrowed type, a type guard, or a parse at the boundary. Keep the ones documenting a genuine type-system or third-party-types limitation, and prefer `@ts-expect-error` with a one-line reason over `@ts-ignore`. The `!` assertion is allowed by the ESLint config for `noUncheckedIndexedAccess` reads the code has already bounded.
- **Swallowed errors** — Empty `catch {}`, `catch { return null }`, and `try` blocks that log and continue. Rethrow or let it propagate; when wrapping, preserve the chain with `{ cause }`.
- **Masking defaults** — `?? ''`, `|| []`, `?? 0` standing in for a value that must exist. When the type already rules out absence, the default is dead — drop it; when the value is optional in the type but required in fact, throw an error that names what's missing.
- **Comment noise** — Strip comments that restate the code and comments describing behavior the diff removed. Keep file headers, export JSDoc, and any comment carrying a *why* — a constraint, a firmware quirk, an upstream bug.
- **Outdated patterns** — Verbose or legacy syntax where modern equivalents exist. See the table below.

#### Efficiency

- **Redundant work** — Repeated computations and duplicate reads. Setup that comes out the same on every call — a lookup table, a palette, a `Set` built from a constant list — belongs at module scope, not inside a per-pixel loop. Anything holding per-call state stays put, including a `/g` regex, whose `lastIndex` carries between calls.
- **Hot loops** — Drawing primitives run per pixel. An allocation, a color re-parse, or a closure inside the inner loop of a 64×64 fill is real cost; hoist it.
- **Missed concurrency** — Independent async operations run sequentially that could run with `Promise.all`. Device sends are deliberately sequential — see the pixoo-toolkit rules below.
- **No-op updates** — State updates inside loops that fire unconditionally when nothing changed.
- **TOCTOU** — Pre-checking a file's existence before reading it. Operate directly and handle the error instead.

#### pixoo-toolkit-specific

- **Gate** — `bun run devcheck` plus `bun run test` is the gate in Phase 2 and Phase 4.
- **`/core` stays browser-safe** — `canvas`, `color`, `font`, `svg-path`, `animation`, and `finish` (everything `src/core.ts` re-exports) must not import a Node built-in, `Buffer`, `process`, or a package; `tests/packaging.test.ts` bundles them for the browser. A helper they need lives in one of those modules, never in `image.ts`, `preview.ts`, or `client.ts`.
- **Argument errors are `RangeError`s that name the call** — a bad caller argument throws `RangeError` whose message names the function the caller invoked and what was wrong (`fillRect coordinates and dimensions must be finite`), checked before any color resolves or pixel is drawn. Reuse the module's existing `assert*` helper rather than writing a new check.
- **Device failures are values, coding errors throw** — `PixooClient` returns a `PixooResult` for every device and network failure (`'network'`, `'timeout'`, `'http'`, `'device'`, `'response'`), and throws only for caller mistakes (a bad argument, a canvas of the wrong size) and for an aborted `signal`, which rejects with the signal's reason. Don't turn one into the other.
- **Pushes take turns** — `push()`, `pushAnimation()`, and `playGifUrl()` run through the client's display queue so frames never interleave and `minPushInterval` holds. Never parallelize device sends with `Promise.all`.
- **Public surface** — every export of `src/index.ts` and `src/core.ts` is public API for the "API compatibility" rule below; changing one is a version decision, not a refactor.
- **Tests** — expectations are independent literals (pixel coordinates and colors worked out by hand, known digests), never the code's own output; timing uses Vitest fake timers, never sleeps or elapsed-time bounds.

### Phase 4: Apply transformations

1. **Filter findings ruthlessly.** If a finding is a false positive or not worth the churn, skip it.
2. **Stay in scope.** Edit only files inside the Phase 1 scope. Touch a file outside it only when a finding requires it — importing an existing helper, deleting a private export the diff just orphaned — and only on the lines that finding names. Anything broader goes in the summary as a recommendation.
3. **Correctness bugs are not this pass's job.** A real defect doesn't get folded into a cleanup diff — name it in the summary with file and line so it can be handled as its own change.
4. **Transform incrementally** — one category of change at a time.
5. **Verify equivalence** — functionality, types, and public interfaces stay unchanged. Re-run the gate after transforming; a simplification that breaks the build is worse than the verbosity it removed.
6. **Keep the diff minimal.** Only touch lines that have a real reason to change. Formatting belongs to Prettier: never hand-adjust whitespace, quotes, or import order. Hunks the formatter writes during a gate run stay; mention them in the summary.
7. **Never stage, commit, tag, push, or stash.** This pass ends with a dirty working tree and a summary; landing the changes is the caller's call. Compare against the baseline with `git diff`, never by setting work aside.

When done, report:

- **Gate** — the result before and after the pass.
- **Fixed** — what changed, grouped by category.
- **Skipped** — findings deliberately left, each with its reason, plus any other writer's changes excluded from scope.
- **Defects and recommendations** — correctness bugs and out-of-scope changes, each with `file:line`.

When nothing earned a change, say the code was already clean.

## Common transformations

Check `tsconfig.json` (`target`, `lib`) before applying a version-gated row.

| Before | After | Why |
| --- | --- | --- |
| `const x: Foo = { ... } as Foo` | `const x = { ... } satisfies Foo` | Type-checked without assertion |
| `if (x !== null && x !== undefined)` | `if (x != null)` | Idiomatic null/undefined check |
| `arr.filter(x => x !== null) as T[]` | `arr.filter(x => x != null)` | TS 5.5+ infers the type predicate |
| `import { foo } from './index.js'` (inside `src/`) | `import { foo } from './foo.js'` | Import from the declaring file; the barrel is for consumers |
| `import { readFile } from 'fs/promises'` | `import { readFile } from 'node:fs/promises'` | `node:` protocol is unambiguous |
| `Object.prototype.hasOwnProperty.call(obj, key)` | `Object.hasOwn(obj, key)` | ES2022 — also correct on null-prototype objects |
| `path.dirname(fileURLToPath(import.meta.url))` | `import.meta.dirname` | Node 20.11+ and Bun |
| `s.replace(/foo/g, 'bar')` with a literal pattern | `s.replaceAll('foo', 'bar')` | ES2021 — no regex escaping for a literal match |
| `value \|\| fallback` | `value ?? fallback` | `\|\|` also swallows `0`, `''`, and `false` — and `0` is a valid coordinate, channel, and alpha |
| `if (a) { if (b) { if (c) { ... } } }` | Guard clauses with early returns | Reduce nesting |
| `catch (err) { throw new Error('load failed') }` | `throw new Error('load failed', { cause: err })` | Preserve the cause chain |
| `[...arr].sort(cmp)` | `arr.toSorted(cmp)` | Non-mutating array methods (ES2023) |
| `arr[arr.length - 1]` | `arr.at(-1)` | ES2022 — typed `T \| undefined` |
| `const c = new AbortController(); setTimeout(() => c.abort(), ms)` | `AbortSignal.timeout(ms)` | Combine with a caller's signal via `AbortSignal.any([...])` |
| `JSON.parse(JSON.stringify(x))` | `structuredClone(x)` | Deep clone that keeps typed arrays, Maps, and Sets |
| `enum Status { A, B }` | `const Status = { A: 0, B: 1 } as const` + a union type | `tsconfig.json` sets `erasableSyntaxOnly`; keep numeric values stable when the device protocol carries them |
| `function f(a: string, b: string, c: string, d?: string)` | `function f(opts: FnOptions)` | Internal functions only — an exported signature is API |

## When NOT to simplify

- **It works and is readable.** "I would have written it differently" is not a reason to change it.
- **The change is cosmetic.** Renaming `data` to `result` isn't worth the churn.
- **Performance-critical paths.** A per-pixel loop may be written for measured speed — check before simplifying.
- **API compatibility.** Don't change public function signatures, export shapes, or return types that callers depend on.
- **Tests.** Don't DRY up test code aggressively — readability and isolation matter more than deduplication.
- **The abstraction isn't proven.** Don't create a shared helper for two similar blocks. Wait until there are three, and even then only if the abstraction is genuinely simpler.
- **`return await` inside `try` / `finally`.** Collapsing it to `return` is not equivalent — the promise settles outside the block, so `catch` never fires and `finally` runs early.
- **Awaits that only look independent.** Device sends are sequential on purpose. Confirm independence from the code, not from the shape of the calls.
- **Generated and vendored files.** `bun.lock` and anything under `dist/` are regenerated, not edited.
