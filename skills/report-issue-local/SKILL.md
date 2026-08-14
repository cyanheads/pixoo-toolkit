---
name: report-issue-local
description: >
  File a bug or feature request against `cyanheads/pixoo-toolkit` — dedup search, title and label conventions, body structure matching the repo's issue forms, and the redaction rules for a public repo that talks to LAN devices.
metadata:
  author: cyanheads
  version: '1.0'
  audience: external
  type: workflow
---

## When to use

Something in this toolkit is wrong or missing: a drawing primitive produces incorrect pixels, `PixooClient` mishandles a device response, a color or font renders differently than documented, an export encoder emits a malformed file, or a capability the toolkit should have does not exist.

Triage first — not every Pixoo problem is a toolkit problem:

| Signal | Where it belongs |
|:---|:---|
| Wrong pixels from a pure function (`canvas`, `color`, `font`, `svg-path`, `preview`) | Here |
| `PixooClient` builds a malformed request, or misreads a well-formed response | Here |
| Types wrong, export missing from `src/index.ts`, packaging broken | Here |
| The device ignores or mangles a correctly-formed request | Firmware — document it in `CLAUDE.md` under limits and quirks, not as a toolkit bug |
| Failure originates inside `sharp` or `gifenc` | Upstream — file there, and note the workaround here only if the toolkit can absorb it |

## Before filing

**1. Search existing issues** — including closed ones. This repo has a dense history of narrow, closed bug reports, and a new symptom is often a regression of one:

```bash
gh issue list --repo cyanheads/pixoo-toolkit --search "<symptom or function name>" --state all
gh issue view <number> --comments
```

If a close match exists, comment on it rather than filing a duplicate — unless the scope is genuinely distinct. A previously closed issue that has regressed gets a new issue labeled `regression`, cross-linked to the original.

**2. Reproduce it.** Reduce to the smallest snippet that shows the defect. A reproduction that needs a physical device is much weaker than one that does not — most of this toolkit is pure functions over a pixel buffer, so push the repro toward `Canvas` + `savePng()` and away from `PixooClient` wherever the defect allows.

**3. Confirm expected behavior against a source, not intuition.** For device commands that is the API reference in `CLAUDE.md`; for rendering it is the documented behavior in `README.md` or the existing test in `tests/`.

## Redact before posting

This repo is public and its subject is a device on a home network.

- **Never post a real device IP.** Use `<device-ip>` or a TEST-NET address (`192.0.2.1`), matching `.env.example`.
- Strip device IDs, MAC addresses, Divoom account identifiers, tokens, and Wi-Fi network names from logs and JSON payloads before pasting them.
- Do not partially mask — replace the whole value with `REDACTED`.

## Filing

The repo ships YAML issue forms. Use `--web` to fill the form interactively, or match its field headings in a `--body` for non-interactive filing.

```bash
gh issue create --repo cyanheads/pixoo-toolkit --template "Bug Report" --web
```

Non-interactive — **always route the body through a quoted-delimiter heredoc or `--body-file`.** Passing markdown as a quoted argument corrupts it: backticks inside double quotes run as command substitution and silently delete the code spans.

````bash
gh issue create \
  --title "bug(canvas): drawRect ignores non-finite dimensions" \
  --label "bug" \
  --assignee "cyanheads" \
  --body "$(cat <<'ISSUE'
### Toolkit version

0.7.7

### Runtime

Bun

### Runtime version

Bun 1.3.x

### Subsystem

Canvas and drawing

### Device model

Not device-related

### Description

`drawRect()` accepts a `NaN` width and returns normally without writing any pixels, so a caller with a bad computed dimension sees a silent no-op instead of an error.

### Reproduction

```typescript
import { Canvas } from '@cyanheads/pixoo-toolkit';

const canvas = new Canvas(64);
canvas.drawRect(0, 0, NaN, 10, 'red');
```

### Actual behavior

```
No pixels written, no error thrown.
```

### Expected behavior

`RangeError`, matching how `drawCircle()` and `drawLine()` reject non-finite input.

### Additional context

Sibling primitives gained non-finite guards in #17, #23, and #24; `drawRect()` was not covered.
ISSUE
)"
````

**Every issue is assigned to `cyanheads` at creation.** Pass `--assignee cyanheads` on every `gh issue create` call in this repo.

### Titles

Format: `type(scope): description`

- **type:** `bug`, `feat`, `docs`, `chore`, `security`
- **scope:** the `src/` module — `canvas`, `client`, `color`, `font`, `image`, `animation`, `preview`, `svg-path` — or `deps`, `packaging`, `types`

Describe the observable defect, not the suspected cause. `bug(color): hslToRgb returns out-of-range values for hues above 360` beats `bug(color): modulo bug`.

Examples:

- `bug(svg-path): compact decimal coordinates parse to NaN ('l.5.5')`
- `feat(client): LAN device discovery`
- `bug(animation): mixed frame sizes produce invalid payloads`

### Labels

Exactly one primary label, plus any secondary that applies.

| Primary (pick one) | When |
|:---|:---|
| `bug` | Something is broken |
| `enhancement` | New capability or improvement |
| `documentation` | Docs are wrong, missing, or misleading |

| Secondary (stack on top) | When |
|:---|:---|
| `regression` | Worked before, broken after a change |
| `performance` | Memory, CPU, or latency |
| `security` | Vulnerability, CVE, or hardening |
| `breaking-change` | Requires a major bump — changes an exported signature or shape |

If `gh` reports `label not found`, create it once:

```bash
gh label create regression --color e99695 --description "Worked before, broken after a change"
gh label create performance --color 5319e7 --description "Memory, CPU, or latency"
gh label create security --color b60205 --description "Vulnerability, CVE, or hardening work"
gh label create breaking-change --color d93f0b --description "Requires a major bump"
```

## Writing the body

Terse and fact-dense. One or two sentences per bullet; if a bullet runs long, split it or cut it.

- **Lead with the specific.** Name the exported function and the input that triggers it in the first sentence.
- **Show the failing values.** "Returns `{ r: 260, g: 0, b: 0 }`" beats "returns wrong colors." For a rendering bug, state the coordinates and what is at them.
- **Make the reproduction runnable.** Fenced `typescript`, importing from the package barrel, no local paths.
- **Separate `### Scope` from `### Out of scope`** on feature requests. The boundary pre-empts scope debate in the comments.
- **Cross-reference once.** Link a related issue in one place — `Related: #N` near the top, or in the body — not in three.
- **Cut the noise.** No mechanism walkthroughs, no "This issue covers…", no conversation references, no "happy to open a PR" sign-offs. End at the last substantive point.

For a feature request, the form asks for a **Proposed API** — write the consumer-facing TypeScript, not a description of it:

```typescript
// what the caller writes
canvas.drawPolygon([[0, 0], [10, 0], [5, 8]], 'cyan', { fill: true });
```

## Following up

```bash
gh issue view <number> --comments
gh issue comment <number> --body "Additional findings..."
gh issue close <number> --reason completed --comment "Fixed in v0.7.8."
```

Reading an issue means the body *and* the thread — `gh issue view N --comments` shows only the comments, so run both, or `gh api repos/cyanheads/pixoo-toolkit/issues/N` for the combined view.

## Checklist

- [ ] Triaged — the defect is in this toolkit, not firmware or an upstream dependency
- [ ] Searched open **and closed** issues; close matches commented rather than duplicated
- [ ] Device IPs, IDs, and credentials redacted
- [ ] Title follows `type(scope): description` with a `src/` module scope
- [ ] Exactly one primary label; `regression` added if it previously worked
- [ ] `--assignee cyanheads` passed
- [ ] Body sent via heredoc or `--body-file`, never a quoted markdown argument
- [ ] Bug: version, runtime, runnable repro, actual vs expected
- [ ] Feature: Proposed API in TypeScript, Scope and Out of scope defined
