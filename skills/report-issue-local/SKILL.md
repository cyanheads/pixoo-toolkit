---
name: report-issue-local
description: >
  File a bug or feature request against `cyanheads/pixoo-toolkit` — triage (toolkit, firmware, or upstream), dedup search, title and label conventions, a body that matches the repo's issue forms within a word budget, and the redaction rules for a public repo that talks to LAN devices.
metadata:
  author: cyanheads
  version: '1.2'
  audience: external
  type: workflow
---

## When to use

Something in this toolkit is wrong or missing: a drawing primitive produces incorrect pixels, `PixooClient` mishandles a device response, a color or font renders differently than documented, an export encoder emits a malformed file, or a capability the toolkit should have does not exist.

Triage first — not every Pixoo problem is a toolkit problem:

| Signal | Where it belongs |
|:---|:---|
| Wrong pixels from a pure function (`canvas`, `color`, `font`, `svg-path`, `finish`, `preview`) | Here |
| `PixooClient` builds a malformed request, or misreads a well-formed response | Here |
| Types wrong, export missing from `src/index.ts` or `src/core.ts`, packaging broken | Here |
| The device ignores or mangles a correctly formed request | Firmware — document it in `CLAUDE.md` under limits and quirks, not as a toolkit bug |
| Failure originates inside `sharp` or `gifenc` | Upstream — file there, and note the workaround here only if the toolkit can absorb it |

## Before filing

**1. Search existing issues** — including closed ones. This repo has a dense history of narrow, closed bug reports, and a new symptom is often a regression of one:

```bash
gh issue list --repo cyanheads/pixoo-toolkit --search "<symptom or function name>" --state all
gh issue view <number> --repo cyanheads/pixoo-toolkit --json title,body,comments
```

Read the body and the thread: piped, `gh issue view N --comments` prints only the comments, and `gh api .../issues/N` returns the body with a comment count but no comments. `--json title,body,comments` returns both.

If a close match exists, comment on it rather than filing a duplicate — unless the scope is genuinely distinct. A closed issue that has regressed gets a new issue labeled `regression`, cross-linked to the original.

**2. Reproduce it.** Reduce to the smallest snippet that shows the defect. A reproduction that needs a physical device is much weaker than one that does not — most of this toolkit is pure functions over a pixel buffer, so push the repro toward `Canvas` + `savePng()` and away from `PixooClient` wherever the defect allows.

**3. Confirm expected behavior against a source, not intuition.** For device commands that is the API reference in `CLAUDE.md`; for rendering it is the documented behavior in `README.md` or the existing test in `tests/`.

## Redact before posting

This repo is public and its subject is a device on a home network.

- **Never post a real device IP.** Use `<device-ip>` or a TEST-NET address (`192.0.2.1`), matching `.env.example`.
- Strip device IDs, MAC addresses, Divoom account identifiers, tokens, and Wi-Fi network names from logs and JSON payloads before pasting them.
- Do not partially mask — replace the whole value with `REDACTED`.

## Writing the body

Terse and fact-dense. **Budget: a bug reads in ~150 words, a feature in ~250, code and logs excluded.** Every section past the form's required fields must earn its place — a section you could delete without changing the fix is noise.

- **Lead with the specific.** Name the exported function and the input that triggers it in the first sentence.
- **Show the failing values.** "Returns `{ r: 260, g: 0, b: 0 }`" beats "returns wrong colors." For a rendering bug, state the coordinates and what is at them.
- **Make the reproduction runnable.** Fenced `typescript`, importing from the package, no local paths.
- **Cross-reference once.** `Related: #N` near the top, or in the body — not both. `owner/repo#N` for another repository.
- **Cut the noise.** No mechanism walkthroughs, no "This issue covers…", no conversation references, no "happy to open a PR" sign-offs. End at the last substantive point.

## Filing a bug

The repo ships YAML issue forms. `--web` fills the form interactively:

```bash
gh issue create --repo cyanheads/pixoo-toolkit --template "Bug Report" --web
```

Non-interactive, match the form's headings. **Always route the body through a quoted-delimiter heredoc or `--body-file`** — backticks inside a double-quoted argument run as command substitution and silently delete the code spans.

`Environment` is the form's one-row table: the installed toolkit version (from `node_modules/@cyanheads/pixoo-toolkit/package.json`, not the `^` range), the runtime with its version, the device model or `none`, and the OS. `Additional context` appears only when it changes the fix — a firmware version, a workaround, a related issue — and is omitted otherwise.

````bash
gh issue create \
  --repo cyanheads/pixoo-toolkit \
  --title "bug(canvas): drawRect ignores non-finite dimensions" \
  --label "bug" \
  --assignee "cyanheads" \
  --body "$(cat <<'ISSUE'
### Environment

| pixoo-toolkit | Runtime | Device | OS |
|---|---|---|---|
| 0.7.7 | Bun 1.3.x | none | macOS 15.x |

### Description

`drawRect()` accepts a `NaN` width and returns normally without writing any pixels, so a bad computed dimension becomes a silent no-op instead of an error.

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
ISSUE
)"
````

## Filing a feature request

```bash
gh issue create --repo cyanheads/pixoo-toolkit --template "Feature Request" --web
```

Non-interactive, the body carries the form's headings: `### Use case` (two or three sentences — the problem and who hits it), `### Proposed API` (the consumer-facing TypeScript, not a description of it), and `### Alternatives considered` and `### Additional context` only when they carry something.

````markdown
### Use case

A notification longer than one row has to be split by hand: the caller loops over words, calls `measureText()` on each candidate line, and tracks the y offset per font.

### Proposed API

```typescript
drawTextWrapped(canvas, message, 0, 0, '#ffffff', { maxWidth: 64, lineSpacing: 1 });
```

### Alternatives considered

Pre-splitting at a fixed character count breaks with proportional BDF fonts, whose glyph widths vary.
````

**Every issue is assigned to `cyanheads` at creation.** Pass `--assignee cyanheads` on every `gh issue create` in this repo.

## Titles

Format: `type(scope): description`

- **type:** `bug`, `feat`, `docs`, `chore`, `security`
- **scope:** the `src/` module — `canvas`, `client`, `color`, `font`, `image`, `animation`, `preview`, `svg-path`, `finish` — or `deps`, `packaging`, `types`

Describe the observable defect, not the suspected cause. `bug(color): hslToRgb returns out-of-range values for hues above 360` beats `bug(color): modulo bug`.

- `bug(svg-path): compact decimal coordinates parse to NaN ('l.5.5')`
- `feat(client): LAN device discovery`
- `bug(animation): mixed frame sizes produce invalid payloads`

## Labels

Exactly one primary label, plus any secondary that applies. Combine with repeated flags: `--label "bug" --label "regression"`.

| Primary (pick one) | When |
|:---|:---|
| `bug` | Something isn't working |
| `enhancement` | New feature or improvement |
| `documentation` | Docs are wrong, missing, or misleading |

| Secondary (stack on top) | When |
|:---|:---|
| `regression` | Worked before, broken after a change |
| `performance` | Memory, CPU, latency, or resource usage |
| `security` | Vulnerability, CVE, or hardening work |
| `breaking-change` | Change will break public API |
| `surplus-token-idea` | Worth exploring when token budget allows |

The repo carries exactly these plus `duplicate`. If `gh` reports `label not found`, the set has drifted — recreate the missing label with its canonical color and description:

```bash
gh label create regression --color e99695 --description "Worked before, broken after a change"
gh label create performance --color 5319e7 --description "Memory, CPU, latency, or resource usage"
gh label create security --color b60205 --description "Vulnerability, CVE, or hardening work"
gh label create breaking-change --color d93f0b --description "Change will break public API; requires a major bump"
gh label create surplus-token-idea --color FF10F0 --description "Worth exploring when token budget allows"
```

## Attaching logs

`--body-file` replaces the whole body, so a log passed that way loses the form structure. File the issue first, then add the redacted log as a comment:

```bash
gh issue comment <number> --repo cyanheads/pixoo-toolkit --body-file <scratch>/device-log.txt
```

## Following up

```bash
gh issue view <number> --repo cyanheads/pixoo-toolkit --json title,body,comments
gh issue comment <number> --repo cyanheads/pixoo-toolkit --body-file <scratch>/comment.md
gh issue close <number> --repo cyanheads/pixoo-toolkit --reason completed --comment "Fixed in v<version>."
```

## Checklist

- [ ] Triaged — the defect is in this toolkit, not firmware or an upstream dependency
- [ ] Searched open **and closed** issues; close matches commented rather than duplicated
- [ ] Device IPs, IDs, and credentials redacted
- [ ] Title follows `type(scope): description` with a `src/` module scope
- [ ] Exactly one primary label; `regression` added if it previously worked
- [ ] `--assignee cyanheads` passed
- [ ] Body sent via heredoc or `--body-file`, never a quoted markdown argument
- [ ] Bug: Environment table, runnable repro, actual vs expected
- [ ] Feature: use case first, Proposed API in TypeScript
- [ ] Inside the budget — ~150 words for a bug, ~250 for a feature, code and logs excluded
