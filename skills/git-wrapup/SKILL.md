---
name: git-wrapup
description: >
  Land verified working-tree changes in `@cyanheads/pixoo-toolkit` as a stack of logical commits — the work grouped by concern, then a release commit carrying the version bump and the CHANGELOG entry. In release PR mode (declared in `CLAUDE.md` `## Publishing`) the stack lands on `release/<version>` and the skill ends with that branch pushed and its PR open; otherwise it ends committed locally on `main`. No tag, no push to `main`, no publish — `release-and-publish` merges, tags, and ships from here.
metadata:
  author: cyanheads
  version: '2.0'
  audience: external
  type: workflow
---

## When to use

Changes in the working tree are complete and verified, and they are ready to become a released version of the npm package. Typical triggers: a bug fix landed against a tracked issue, a feature is finished, a dependency refresh is done.

This is not a "save my work" skill. A commit here means the version ships.

## Release PR mode

A release can route through a pull request — one PR per version, for the audit trail and a stable review target. The mode is declared in `CLAUDE.md`/`AGENTS.md` under `## Publishing`, or in the caller's brief; the brief wins when they differ.

| Mode | Wrapup ends at | Then |
|:--|:--|:--|
| *(none)* | commit stack on `main`, tree clean | `release-and-publish` tags HEAD and ships |
| **gated** | commit stack on `release/<version>`, branch pushed, PR open | `release-pr-review` reviews the PR, then a separate `release-and-publish` run fast-forwards `main`, tags, and ships |
| **straight-through** | same as gated | the same agent continues straight into `release-and-publish` |

Create `release/<version>` as soon as the version is known, before any commit; a caller-pinned version permits branching before step 1. Every work and release commit lands on that branch. If commits were accidentally made on an unpushed `main`, create the release branch at HEAD and continue without moving `main`; never reset, force a branch ref, or rewrite history. If those commits were already pushed to `main`, report the state before proceeding. The commit stack, release commit, and tag format are identical in every mode — the PR adds an audit artifact.

## Pre-wrapup gates

Every item must be true before you touch a version number. If one is red, fix it first — starting wrapup on a broken tree burns the version number and turns the fix into an extra commit on a stack that should have been green.

- [ ] **Changes exist** — uncommitted files, or commits since the last tag
- [ ] **Work is complete** — no half-finished units, no TODO placeholders
- [ ] **Code simplified** — for a diff past ~50 lines or 3+ source files, the `code-simplifier` pass has run
- [ ] **`bun run devcheck` is clean — exit 0 and zero warnings.** It runs typecheck, ESLint, Prettier, and the `CLAUDE.md`/`AGENTS.md` byte-identity check. An ESLint warning exits 0 but still blocks the release, pre-existing ones included: fix it, or get the maintainer's waiver in the maintainer's own words
- [ ] **`bun run test:all` passes** — clean rebuild plus the full Vitest suite
- [ ] **Regression test added** — a bug fix without a test that fails on the old code is not finished
- [ ] **Public API reviewed** — anything newly exported is in `src/index.ts`, or in `src/core.ts` when it comes from `canvas`, `color`, `font`, `svg-path`, `animation`, or `finish` (the barrel re-exports it), and no exported signature changed without the matching version tier
- [ ] **Issues updated** — GitHub issues this work addresses have a comment saying what landed
- [ ] **Docs updated** — surgical edits to `README.md` and `CLAUDE.md`, not rewrites

## Steps

### 1. Review what is shipping

```bash
git branch --show-current                 # empty output = detached HEAD
git status
git log v<latest-tag>..HEAD --oneline     # commits since the last release
git diff HEAD --stat                      # every uncommitted change, staged or not
git diff HEAD
git ls-files --others --exclude-standard  # new files, which never appear in the diff
```

**Check the branch first.** A detached HEAD is a halt. Start on `main`, or on `release/<version>` when the caller already pinned the version and created that branch.

Diff against `HEAD`, not the index: plain `git diff` omits staged changes, so a group staged before wrapup began never shows up in the review. Whatever is staged ships, and is grouped in step 3 like everything else.

**Read every untracked file in full.** New files ship through `git add` like any other change, but no diff shows their content, and `git status` collapses a new directory to one line.

**Ship only finished work no one is still writing.** Uncommitted changes outside the work being wrapped are candidates, not automatic exclusions. A complete, safe change that has sat idle for hours folds in as its own commit. A change this run didn't make, modified in the last few minutes (check mtimes) or visibly half-done, may belong to a session still writing it: leave it uncommitted and report it. Anything unsafe or secret-bearing stays out regardless.

If the tree is clean and there are no commits since the last tag, halt — nothing to wrap up.

### 2. Pick the version — and, in release PR mode, create its branch

Read `version` from `package.json`. The version is the caller's to set, not this skill's to pick:

1. **A version pinned in the caller's brief is binding.**
2. **Otherwise use semver, pre-1.0 rules.** This package is published and consumed, so the public surface (every export of `src/index.ts` and `src/core.ts`) is real API.

| Bump | When |
|:---|:---|
| **patch** | Bug fixes that keep every exported signature and return shape, dependency updates, docs, packaging metadata |
| **minor** | New export, new option on an existing export — and, below 1.0, any breaking change: a removed or renamed export, a changed signature or return shape, a newly thrown error, pixels a consumer may have pinned |

A change to an exported type — `PixooResult`, `Canvas`, `RGB` — is never a patch. When the diff doesn't settle which row applies, ask the caller rather than picking.

**In `gated` or `straight-through` mode, create the branch now, before step 3.** If the caller already created it, verify its name and skip the creation command:

```bash
git branch --show-current                 # must be main
git switch -c release/<version>           # uncommitted work rides along
```

If `git branch --no-merged main --list 'release/*'` prints a branch, a prior release PR was never merged — halt and report it rather than stacking a second release on top. A `release/*` branch already merged into `main` is a leftover: delete it with `git branch -d` and continue. Check the remote too:

```bash
git ls-remote --heads origin release/<version>          # must print nothing
gh pr list --head release/<version> --state all         # must print nothing
```

A hit means an abandoned run already claimed this version: halt and report the branch and PR. Never force-push past it.

### 3. Commit the work — one commit per concern

**Release PR mode: `git branch --show-current` must print `release/<version>` before every `git commit`.**

**The work is committed before the version is bumped.** A dependency refresh edits `package.json`, a doc edit lands in a `CLAUDE.md` that may pin a version, and the file is the atomic boundary — so whichever commit comes first takes the file whole. Committing the work first leaves the version hunk (step 4) as the only thing those files carry into the release commit.

Never `git add -A` into one blob. One commit per concern: two unrelated fixes are two commits, a dependency refresh is its own `chore(deps): …` commit carrying `package.json` and `bun.lock`. Work commits do not carry the version. Verify each proposed group with the snapshot gate below, then stage that unchanged group and commit it by pathspec:

```bash
git add <paths-for-this-concern>
git commit --only <paths-for-this-concern> -m "<subject>" -m "<body>"
# repeat per concern
```

**Commit by pathspec, never the bare index.** A bare `git commit` takes everything staged, so a change staged before wrapup began — or by a hook, or a concurrent session — rides into the first concern's commit. `--only` commits the named paths' working-tree content and leaves the rest of the index alone.

**The file is the atomic boundary.** Never split one file's changes across commits — not `git add -p`, not `git apply --cached`, not editing the file between commits. When a file serves two concerns, it ships whole in the commit of its dominant concern; a later commit touches it again only for changes made after the first (the version bump in step 4).

**Every commit builds and passes its tests on its own — verify before committing.** For each proposed group, build a snapshot with a temporary index:

```bash
export GIT_INDEX_FILE=<scratch>/index
git read-tree HEAD
git add -- <whole-file-paths>
git checkout-index -a --prefix=<scratch>/tree/
unset GIT_INDEX_FILE
ln -s "$PWD/node_modules" <scratch>/tree/node_modules
(cd <scratch>/tree && bun run typecheck && bun run test)
```

Use `git checkout-index`, not `git archive`, which drops `export-ignore` paths. Run only that pair per snapshot — `test:all` already passed on the finished tree and runs again in step 6. Wait for both to finish green before committing the same unchanged paths through the real index; the temporary index leaves real staging and the working tree untouched. If a candidate fails where the baseline passes, merge it with the group it depends on while both are still uncommitted, and re-test. Never create a commit to find out whether its grouping passes, and never rewrite history to repair grouping.

**A dependency bump lands before the commits that use it.** When a later commit relies on something the new versions introduce, `chore(deps)` is the first work commit, carrying `package.json`, `bun.lock`, and any source change the upgrade itself forces.

**Subjects:** Conventional Commits, scope = the `src/` module, no version — `fix(canvas): reject non-finite rect dimensions`, `feat(color): oklch parsing`, `docs: document discovery timeout`, `chore(deps): sharp ^0.35.5`.

**Every commit carries a body of one or two lines** — never subject-only, never a paragraph. One sentence of *why* or the load-bearing constraint:

```
fix(canvas): reject non-finite rect dimensions

A NaN width reached the fill loop and wrote nothing while reporting success.
```

A body is too long the moment it lists the files touched, walks through the implementation, or narrates a fix's mechanism — that depth belongs in the CHANGELOG entry.

Rules:

- Plain `-m` strings only — no heredoc, no command substitution. Never put a backtick inside a double-quoted `-m`: the shell runs it as command substitution and the span silently disappears
- No `Co-authored-by` or `Generated with` trailers
- No marketing adjectives ("comprehensive", "robust", "enhanced", "improved")
- **No closing keywords** (`Fixes #N`, `Closes #N`) — they close the issue on push or merge, before the close-out comment recording what shipped. Use bare `(#N)` backlinks
- Each message stands alone in `git log` — no chat context, no "as discussed"

**Right-size it.** A single-concern change is one work commit with the release commit on top. Only when the version bump *is* the whole change does the release commit become the entire stack.

When every concern is committed, `git status` is clean apart from step 1's reported exclusions.

### 4. Bump the version everywhere

- `package.json` — `version`
- `README.md` — any version badge or install snippet that pins a version
- `CLAUDE.md` **and** `AGENTS.md` — only if they pin a version string; they must stay byte-identical

Catch stragglers (substitute the outgoing version):

```bash
rg -nF --hidden -g '!node_modules' -g '!dist' -g '!.git' -g '!CHANGELOG.md' -g '!bun.lock' '0.10.0' .
```

`-F` matches literally, so `0.10.0` does not also hit `10.10.0`. Historical `CHANGELOG.md` entries are correct as-is; resolve every other hit.

### 5. Author the CHANGELOG entry

`CHANGELOG.md` is one hand-maintained file in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) order. Add the new entry directly under the header block, above the previous version:

```markdown
## [0.10.1] — 2026-11-20

### Fixed

- **canvas:** `drawRect()` throws `RangeError` for a non-finite width or height (#N).
```

- **Never `[Unreleased]`.** Always a concrete version and an ISO date.
- Section order: Added / Changed / Deprecated / Removed / Fixed / Security. Include only sections with entries. Dependency arrows go under Changed as a `**deps:**` bullet — `pkg ^1.2.3 → ^1.4.5` for each package.
- Every bullet leads with a bold module prefix (`**canvas:**`, `**client:**`, `**svg-path:**`) naming the `src/` module it changed.
- One sentence per bullet, two at most. Name the exported function and what a consumer observes now. Backlink the issue as `(#N)`.
- **The diff is the source of truth.** Every function name, parameter, error type, and threshold is read out of the changed file, never recalled.
- Cut mechanism walkthroughs, rationale defense, "X is unchanged" clauses, and edge-case inventories.

**Credit outside reporters.** For every issue or PR the release addresses, read who opened it:

```bash
gh api repos/cyanheads/pixoo-toolkit/issues/<N> --jq '[.user.login, .user.type, .author_association] | @tsv'
```

An `author_association` of `NONE`, `CONTRIBUTOR`, `FIRST_TIMER`, or `FIRST_TIME_CONTRIBUTOR` on a `User` (not a `Bot`) is an outside reporter: that bullet ends `(#N, thanks @user!)`. `OWNER`, `MEMBER`, and `COLLABORATOR` get no thanks. The PR body and the tag carry the same credit.

**Re-read the entry, then sweep for harness markup:** `rg -nF -e '</invoke>' -e '</content>' CHANGELOG.md` must print nothing. A stray closing tag is the authoring tool's syntax bleeding into the file.

### 6. Run the gate

Run both raw — do not filter the output:

```bash
bun run devcheck
bun run test:all
```

**If either fails, halt** and report the failing output. A failure that isn't a formatter fix — a red test, a type error — is the caller's to diagnose; don't chase it by editing source or tests. The work is already committed, so a fix lands as a new commit on top under step 3's conventions — never `--amend`, never a rebase or reset.

Only the version bump and the CHANGELOG entry may still be uncommitted when this step goes green.

### 7. Commit the release artifacts

One commit, on top of the work stack, carrying only what steps 4–5 produced:

```bash
git add package.json CHANGELOG.md <other-version-bearing-paths>
git commit --only package.json CHANGELOG.md <other-version-bearing-paths> -m "chore(release): <version> — <theme>" -m "<body>"
```

**Subject leads with the version:** `chore(release): 0.10.1 — non-finite rect dimensions`. Step 3's conventions carry over — pathspec, a one- or two-line body, no closing keywords, no trailers. Anything else still uncommitted (a formatter fix from the gate) is committed on its own first, never folded in.

### 8. Open the release PR (release PR mode only)

Skip when no release PR mode applies — go to step 9.

```bash
git push -u origin release/<version>
gh pr create --base main --head release/<version> --title "<release commit subject>" --assignee @me --body-file <scratch>/pr-body.md
```

**Title:** the release commit's subject, verbatim. **Assignee:** `--assignee @me`, so the PR lands in the maintainer's queue; no reviewer is set, since GitHub drops a review request aimed at the PR's own author — the review record is the summary comment `release-pr-review` leaves.

**Body — always via `--body-file`, written outside the repo.** It is the release digest: the `## Changes` bullets and changelog link the tag will carry, under a theme line and above a gates record that both stay on the PR.

```
<theme — one line of plain prose naming what this release does, derived from the CHANGELOG entry>

## Changes

- <notable consumer-facing change> (#N)
- <notable consumer-facing change> (#N, thanks @user!)
- <ONE grouped line for minor or internal changes>
- deps: sharp ^0.35.4 → ^0.35.5 (+ dev-dep bumps)

## Gates

- `bun run devcheck` — clean
- `bun run test:all` — <N> passed

[CHANGELOG v<version>](https://github.com/cyanheads/pixoo-toolkit/blob/v<version>/CHANGELOG.md)
```

- **`## Changes` follows the tag rules exactly** (`release-and-publish` step 4): flat bullets, never Keep a Changelog section headers; notable changes get their own bullet, minor items share one grouped bullet; deps one line at most; no narrative, no marketing adjectives.
- **Every claim traces to the diff and to the CHANGELOG entry** authored in step 5, never written independently of it.
- **`## Gates` carries the gate results** from step 6 and never enters the tag.
- **Issue references are bare `(#N)`** — a closing keyword would close the issue at merge, before its close-out comment.
- **Changelog link is the final line**, blank line above it. It resolves once the tag is pushed.

**Gated mode: halt here.** Report the PR URL, the branch, and the commit stack. Do not tag, do not merge, do not touch `main`. **Straight-through mode:** continue into `release-and-publish`.

### 9. Verify the end state

```bash
git log --oneline -8                  # work commits, release commit on top
git status                            # clean, apart from step 1's reported exclusions
git tag --points-at HEAD              # must print nothing — tagging is release-and-publish's job
git branch --show-current             # main, or release/<version> in release PR mode
gh pr view --json number,url,state    # release PR mode: OPEN
```

If the tree holds anything beyond those exclusions, or the release commit isn't at HEAD, investigate before going further.

## Constraints

- **No push to `main`, no tag, no publish.** The only remote writes are the release-branch push and the PR create in release PR mode.
- **Never `git stash`** — not for a quick check, not for a clean baseline, not for any reason.
- **Never destructive** — no `git reset --hard`, `git restore .`, `git clean -f`, `git checkout -- .`, no force-push.
- **Never `--no-verify`.** A failing hook is a red gate: fix the cause and commit again, never `--amend`.
- Drive every git operation through Bash `git`.
- If `v<version>` already exists as a tag, **halt and report** the version string, the existing tag SHA, and the current HEAD SHA. Do not move or delete tags without explicit authorization.

## Checklist

- [ ] Started on `main` or the caller-created `release/<version>`; no conflicting release branch or PR exists
- [ ] Diff and every untracked file reviewed before the first commit; unfinished changes this run didn't make left out and reported
- [ ] Version from the brief, else semver pre-1.0 rules — asked when the row was unclear
- [ ] Release PR mode: every commit on `release/<version>`, never on `main`
- [ ] Work committed by concern, by pathspec, before the version bump; each group's snapshot passed `typecheck` + `test` before its commit
- [ ] `chore(deps)` first whenever a later commit uses what the new versions introduce
- [ ] Every commit body is one or two lines; no closing keywords, no trailers, no backticks in `-m`
- [ ] Version bumped in `package.json` and every file that pins it; `CLAUDE.md` and `AGENTS.md` still byte-identical
- [ ] `CHANGELOG.md` entry with a concrete version and date, bullets backlinked, outside reporters thanked, no harness markup
- [ ] `bun run devcheck` clean and `bun run test:all` green on the stack; any fix landed as a new commit
- [ ] Release commit `chore(release): <version> — <theme>` on top, carrying only release artifacts
- [ ] Release PR mode: branch pushed, PR open — title = release commit subject; body = theme, `## Changes`, `## Gates`, changelog link last, via `--body-file`
- [ ] Tree clean, no tag at HEAD, nothing pushed to `main`
