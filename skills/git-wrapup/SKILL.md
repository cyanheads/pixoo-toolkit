---
name: git-wrapup
description: >
  Land verified working-tree changes in `@cyanheads/pixoo-toolkit` as a stack of logical commits, bump the version, author the CHANGELOG entry, and cut an annotated tag. Stops at "committed and tagged locally" — no push, no publish; `release-and-publish` picks up from there.
metadata:
  author: cyanheads
  version: '1.0'
  audience: external
  type: workflow
---

## When to use

Changes in the working tree are complete and verified, and they are ready to become a released version of the npm package. Typical triggers: a bug fix landed against a tracked issue, a feature is finished, a dependency refresh is done.

This is not a "save my work" skill. A commit here means the version ships.

## Pre-wrapup gates

Every item must be true before you touch a version number. If one is red, fix it first — starting wrapup on a broken tree burns the version number and forces an amend.

- [ ] **Changes exist** — uncommitted files, or commits since the last tag
- [ ] **Work is complete** — no half-finished units, no TODO placeholders
- [ ] **Code simplified** — for a diff past ~50 lines or 3+ source files, the `code-simplifier` pass has run
- [ ] **`bun run devcheck` passes** — typecheck, ESLint, Prettier, and the `CLAUDE.md`/`AGENTS.md` byte-identity check
- [ ] **`bun run test:all` passes** — clean rebuild plus the full Vitest suite
- [ ] **Regression test added** — a bug fix without a test that fails on the old code is not finished
- [ ] **Public API reviewed** — anything newly exported is in `src/index.ts`, and no exported signature changed without a matching version bump tier
- [ ] **Issues updated** — GitHub issues this work addresses have a comment saying what landed
- [ ] **Docs updated** — surgical edits to `README.md` and `CLAUDE.md`, not rewrites

## Steps

### 1. Review what is shipping

```bash
git status
git log v<latest-tag>..HEAD --oneline
git diff --stat
git diff
```

If the tree is clean and there are no commits since the last tag, halt — nothing to wrap up.

### 2. Pick the version

Read `version` from `package.json` and apply the bump. This package is pre-1.0 but is published and consumed, so treat the public surface as real.

| Bump | When |
|:---|:---|
| **patch** | Bug fixes, dependency updates, docs, packaging metadata |
| **minor** | New exported function, new option on an existing export, new script |
| **major** | Removed or renamed export, changed exported signature or return shape, behavior change a consumer must code around |

Default to **patch**. A change to an exported type — `PixooResult`, `Canvas`, `RGB` — is never a patch.

### 3. Bump the version everywhere

- `package.json` — `version`
- `README.md` — any version badge or install snippet that pins a version
- `CLAUDE.md` **and** `AGENTS.md` — only if they pin a version string; they must stay byte-identical

Catch stragglers (substitute the outgoing version):

```bash
rg -n --hidden -g '!node_modules' -g '!dist' -g '!.git' -g '!CHANGELOG.md' '0\.7\.7' .
```

Historical `CHANGELOG.md` entries are correct as-is — that is why it is excluded. Resolve every other hit.

### 4. Author the CHANGELOG entry

`CHANGELOG.md` is a single hand-maintained file in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) order. Add the new entry directly under the header block, above the previous version.

```markdown
## [0.7.8] — 2026-08-13

### Fixed

- **canvas:** `drawRect()` now ... (#N).
```

Rules:

- **Never `[Unreleased]`.** Always a concrete version and an ISO date.
- Section order: Added / Changed / Deprecated / Removed / Fixed / Security. Include only sections with entries.
- Every bullet leads with a bold module symbol (`**canvas:**`, `**client:**`, `**svg-path:**`) matching the `src/` module it changed.
- One sentence per bullet, two at the absolute most. Name the exported function and what a consumer observes now. Backlink the issue as `(#N)`.
- **The diff is the source of truth.** Every concrete claim — function name, parameter, error type, threshold — is read out of the changed file, never recalled.
- Cut: mechanism walkthroughs, rationale defense, "X is unchanged" clauses, edge-case inventories.

### 5. Run the gate

The tree being committed must pass. Run both raw — do not filter the output:

```bash
bun run devcheck
bun run test:all
```

**If either fails, halt.** Fix, then re-run this step.

### 6. Commit — group by concern, release artifacts on top

Never `git add -A` into one blob. Stage each concern explicitly, commit, move on:

1. **The work** — one commit per concern. Two unrelated fixes are two commits. Work commits do not carry the version.
2. **The release commit** — last, on top: `package.json`, `CHANGELOG.md`, and any README/docs version strings.

```bash
git add <paths-for-this-concern>
git commit -m "<subject>"
# repeat per concern; version + changelog land last
```

**The file is the atomic boundary.** Never split one file's changes across commits. When a file serves two concerns, it ships whole in the commit of its dominant concern.

**Subjects** — Conventional Commits, scope = the `src/` module:

- Work: `fix(canvas): reject non-finite rect dimensions`, `feat(color): oklch parsing`, `docs: document discovery timeout`
- Release: `fix(canvas): 0.7.8 — reject non-finite rect dimensions`

When the change and its version bump are inseparable for a small patch, a single commit whose subject leads with the version is correct — that is the shape most of this repo's history takes.

**Every commit carries a body of one or two lines** — never subject-only, never a paragraph. One sentence of *why* or the load-bearing constraint:

```
fix(canvas): reject non-finite rect dimensions

A NaN width reached the fill loop and wrote nothing while reporting success.
```

Rules:

- Plain `-m` strings only — no heredoc, no command substitution
- No `Co-authored-by` or `Generated with` trailers
- No marketing adjectives ("comprehensive", "robust", "enhanced", "improved")
- **No closing keywords** (`Fixes #N`, `Closes #N`) — they close the issue on push, before the close-out comment recording what shipped. Use bare `(#N)` backlinks; closing is a deliberate later step.
- Each message stands alone in `git log` — no chat context, no "as discussed"

### 7. Cut an annotated tag

```bash
git tag -a v<version> --cleanup=whitespace -m "<subject>

- <notable change> (#N)
- <notable change> (#N)"
```

`--cleanup=whitespace` is load-bearing: the default `strip` mode deletes `#`-leading lines as comments, silently removing markdown headers from the tag body that `release-and-publish` renders as the GitHub Release.

Format — a headline digest, not a CHANGELOG mirror:

- **Subject omits the version.** GitHub prepends `v<VERSION>:` to the release title, so including it stutters.
- Flat bullets only — never `Added:` / `Fixed:` section headers.
- Complete at headline granularity: notable changes get a bullet, minor and internal items share one grouped bullet. The CHANGELOG carries depth; the tag carries existence.
- Deps get one line at most, naming only what earns it.
- Issue backlinks as `(#N)` — they render as links in the Release body.

### 8. Verify the end state

```bash
git log --oneline -8
git show v<version> --stat | head -20
git status
```

The tag must point at HEAD and the tree must be clean. If not, investigate before going further.

**Do not push.** This skill stops here.

## Constraints

- **Local only.** No `git push`, no remote operations. `release-and-publish` owns those.
- **Never `git stash`** — not for a quick check, not for a clean baseline, not for any reason.
- **Never destructive** — no `git reset --hard`, `git restore .`, `git clean -f`, `git checkout -- .`.
- Drive every git operation through Bash `git`.
- If `v<version>` already exists as a tag, **halt and report** the version string, the existing tag SHA, and the current HEAD SHA. Do not move or delete tags without explicit authorization.

## Checklist

- [ ] Diff reviewed end-to-end before the version bump
- [ ] Version bumped in `package.json` and every other file that pins it
- [ ] `CLAUDE.md` and `AGENTS.md` still byte-identical
- [ ] `CHANGELOG.md` entry added with a concrete version and date, bullets backlinked to issues
- [ ] `bun run devcheck` passes
- [ ] `bun run test:all` passes
- [ ] Work grouped into logical commits; version + changelog on top
- [ ] Every commit body is one or two lines
- [ ] Annotated tag `v<version>` created with `--cleanup=whitespace`
- [ ] Working tree clean, tag points at HEAD
- [ ] Nothing pushed
