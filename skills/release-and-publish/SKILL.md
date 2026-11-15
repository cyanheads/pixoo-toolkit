---
name: release-and-publish
description: >
  Ship a committed release of `@cyanheads/pixoo-toolkit` — run the gate, fast-forward `main` when the release rode a release PR, create the annotated tag on the commit `main` now points at, push `main` and the tag, publish to npm, and cut the GitHub Release from the tag message. Picks up where `git-wrapup` (and, in gated mode, `release-pr-review`) stops. Retries transient network failures; halts with a partial-state report when a failure is terminal.
metadata:
  author: cyanheads
  version: '2.0'
  audience: external
  type: workflow
---

## Preconditions

`git-wrapup` has finished. By the time this runs:

- `package.json` carries the new version and `CHANGELOG.md` its entry
- The release commit (`chore(release): <version> — <theme>`) is at HEAD — or, in gated mode, in the stack with only `release-pr-review`'s commits above it
- No `v<version>` tag exists yet — this skill creates it (step 4)
- The working tree is clean
- Release PR mode (`CLAUDE.md` `## Publishing`): HEAD is on `release/<version>`, the branch is pushed, the PR is open, and — in gated mode — the caller has confirmed the review pass is finished. Without that confirmation, halt: this skill never decides on its own that a review is done.

If any are missing, halt and say what wrapup left undone. Do not redo wrapup work from inside this skill.

Every step from step 5 on is public and most of it is irreversible: a pushed tag is visible immediately, and an npm version can never be republished.

## Failure protocol

Steps 5–7 are network-bound. **Retry a transient failure up to 2 times** (~5 s before the first retry, ~15 s before the second), then halt. Every other step halts on the first non-zero exit.

Transient — retry: `ECONNRESET`, `EAI_AGAIN`, `ETIMEDOUT`, `ENOTFOUND`, `connection reset`, `timed out`, `integrity check failed`, HTTP `502` / `503` / `504`.

Already done — treat as success and move on:

- npm: `version already exists`, `You cannot publish over the previously published versions`
- Tag: `already exists` with the tag pointing at HEAD (a tag pointing elsewhere is a conflict — step 4)
- GitHub Release: `release already exists` — fix the title with `gh release edit` (step 7)

On a terminal failure, report the step, the exact error, the retry count, and which destinations already have the release (`main` pushed? tag pushed? npm? GitHub Release?). On re-invocation the finished destinations hit the already-done signals and skip themselves.

## Steps

### 1. Sanity-check wrapup's output

```bash
git status --short                          # empty
git branch --show-current                   # main, or release/<version> in release PR mode
git log -1 --format=%s                      # chore(release): <version> — …  (or a review commit above it)
git log main..HEAD --format=%s              # release PR mode: the stack, release commit near the top
gh pr view --json number,state,headRefOid   # release PR mode: OPEN, headRefOid == git rev-parse HEAD
npm whoami && gh auth status
```

In gated mode, only `release-pr-review`'s commits may sit above the release commit; any other commit there — a second version, unreviewed work — is a halt. A PR head that differs from local HEAD is a halt: report both SHAs. Keep `number` and `headRefOid` — step 3 and step 4 need them after the checkout moves to `main`.

### 2. Run the gate

`prepublishOnly` runs the same gate inside `bun publish`, but run it first so a failure costs a local minute rather than a half-published release:

```bash
bun run devcheck
bun run test:all
```

Run both raw. Any non-zero exit, or a lint warning, is a halt.

### 3. Merge the release branch (release PR mode only)

Skip when HEAD is on `main`.

```bash
git switch main
git merge --ff-only release/<version>
git rev-parse HEAD                      # must equal the PR's headRefOid from step 1
```

**Fast-forward only, locally.** The stack lands on `main` byte-identical — same SHAs, same signatures, release commit at the tip — and GitHub marks the PR merged on its own once its head is reachable from `main`. Never merge through the GitHub UI or `gh pr merge`: squash destroys the stack, rebase-and-merge rewrites every SHA and strips the signatures, and a merge commit breaks the linear history.

If `--ff-only` refuses, `main` moved underneath the release branch. Halt and report — rebasing would change the SHAs the review approved, so that call belongs to the caller.

### 4. Create the annotated tag

The tag goes on HEAD — `main`'s tip after step 3. Write the message to a scratch file outside the repo through a quoted-delimiter heredoc, and pass it with `-F`:

```bash
cat > <scratch>/tag-v<version>.md <<'TAG'
<tag message>
TAG
git tag -a v<version> --cleanup=whitespace -F <scratch>/tag-v<version>.md
```

Never inline with `-m`: the body carries backticks, which a double-quoted string runs as command substitution, and apostrophes, which end a single-quoted one. `--cleanup=whitespace` is load-bearing — the default `strip` deletes `#`-leading lines as comments, and `verbatim` appends the signature flush against the last line, where git can no longer parse it and the whole signature block publishes into the release body.

If `v<version>` already exists and points at HEAD, a prior run created it — proceed. If it points anywhere else, **halt and report** the version, the tag SHA, and HEAD. Never move or delete a pushed tag.

**Release PR mode: the tag body is the PR body's `## Changes` bullets plus its final changelog link, verbatim.** Fetch it with `gh pr view <N> --json body -q .body`; drop the theme line, `## Gates`, and the headers. That digest was reviewed on the PR, and re-authoring it here would publish unreviewed words. Append ` · release PR #<N>` to the changelog line so the release links its audit trail. Without a PR, write the bullets from the `CHANGELOG.md` entry — every claim in the tag must appear there.

Format — a **headline digest**, never a CHANGELOG mirror:

```
<subject — one short theme, ~60 characters at most, no version>

- <notable consumer-facing change> (#N)
- <notable consumer-facing change> (#N, thanks @user!)
- <ONE grouped line for minor or internal changes>
- deps: sharp ^0.35.4 → ^0.35.5 (+ dev-dep bumps)

[CHANGELOG v<version>](https://github.com/cyanheads/pixoo-toolkit/blob/v<version>/CHANGELOG.md) · release PR #<N>
```

- **Subject: one theme, ~60 characters at most, no semicolons, no clauses, no version.** It becomes the release title after `v<version>: `, which GitHub prepends. Write it for this tag; the release commit's theme after the version and dash is usually it already.
- **Flat bullets only** — never `Added:` / `Fixed:` section headers.
- **Complete at headline granularity** — notable changes get a bullet, minor items share one grouped bullet. The CHANGELOG carries depth; the tag carries existence.
- **Deps one line at most**, naming only what earns it.
- **No gates line**, no narrative preamble, no marketing adjectives.
- **Issue backlinks** as `(#N)` render as links in the release. An outside reporter's change keeps its own bullet with `(#N, thanks @user!)`.
- **Changelog link last**, blank line above it; ` · release PR #<N>` only in release PR mode.

Verify before pushing:

```bash
git show v<version> --stat | head -20
git tag -l v<version> --format='%(if)%(contents:signature)%(then)signed%(else)unsigned%(end)'
git tag -l v<version> --format='%(contents:subject)'
```

With tag signing enabled the second line must print `signed`. Check the subject and body against the rules above by hand. A failure here means delete and recreate the tag now — the one deletion that needs no authorization, since the tag is local, seconds old, and yours.

### 5. Push `main`, then the tag

```bash
git push origin main
git push origin v<version>
```

The branch goes first: a tag pointing at a commit the remote lacks creates a release referencing nothing.

**Release PR mode, after both pushes:** `gh pr view <N> --json state` must report `MERGED`. Then delete the branch — `git push origin --delete release/<version>` and `git branch -d release/<version>`. A PR still `OPEN` or `CLOSED` means the pushed `main` lacks its head commit — stop and report before publishing anything.

### 6. Publish to npm

```bash
bun publish --access public
```

`files` in `package.json` is `["dist/src", "src"]`, so the tarball carries the compiled library and the TypeScript sources its source maps point at — not `scripts/`, `tests/`, or `assets/`. `prepublishOnly` rebuilds from clean, so `dist/` is regenerated as part of this command.

If the npm account has 2FA, the command prompts for an OTP — the operator completes it. To avoid the prompt: an npm granular access token with "Bypass 2FA for publish" in `~/.npmrc`, or the 1Password CLI — `bun publish --access public --otp="$(op item get 'npm' --otp)"`.

### 7. Cut the GitHub Release

```bash
gh release create v<version> --verify-tag --notes-from-tag --title "v<version>: <tag subject>"
```

`--notes-from-tag` publishes the tag message verbatim, so anything wrong in it is now public. `--verify-tag` fails rather than creating a tag that isn't on the remote — never drop it. On `release already exists`, a prior run made it: `gh release edit v<version> --title "v<version>: <tag subject>"` and move on.

### 8. Verify every destination

A zero exit code is not proof the artifact is reachable:

```bash
npm view @cyanheads/pixoo-toolkit@<version> version     # prints the version
gh release view v<version> --json tagName,name          # exists, titled correctly
git ls-remote --tags origin v<version>                   # tag on the remote
git rev-parse main origin/main                           # equal
```

Read the rendered release body on github.com once — a markdown problem in the tag shows here. Report the npm and release URLs:

- `https://www.npmjs.com/package/@cyanheads/pixoo-toolkit/v/<version>`
- `https://github.com/cyanheads/pixoo-toolkit/releases/tag/v<version>`

### 9. Close out the issues

For each issue this release addressed:

```bash
gh issue comment <number> --body "Fixed in v<version>."
gh issue close <number> --reason completed
```

Comment first, then close — closing without a record of what shipped leaves the next reader guessing. Keep the comment to one or two lines naming the version and the observable change.

## Constraints

- **Never force-push** `main`, a release branch, or a tag.
- **Never the GitHub merge button or `gh pr merge`** — the merge is the local fast-forward in step 3.
- **Never republish or unpublish an npm version.** A mistake ships as the next patch.
- **Never stash. Never destructive** — no `git reset --hard`, `git restore .`, `git clean -f`, `git checkout -- .`.
- On a failure, report which destinations succeeded before retrying. Do not blindly re-run the whole sequence.
- Everything in a tag message, release body, or issue comment is public: no local paths, hostnames, device IPs, or planning context.

## Checklist

- [ ] Tree clean; release commit in the stack (gated: only review commits above it); release PR mode: PR open, head == local HEAD, review confirmed finished
- [ ] `bun run devcheck` clean and `bun run test:all` green
- [ ] Release PR mode: `git merge --ff-only` onto `main` locally; HEAD == the PR's `headRefOid`
- [ ] Annotated tag `v<version>` on HEAD from a `-F` file with `--cleanup=whitespace`; subject fresh, ~60 characters, no version, no `;`; body = the PR's `## Changes` + changelog link + ` · release PR #<N>`; signature parses
- [ ] `main` pushed, then the tag
- [ ] Release PR mode: PR reports `MERGED`; remote and local `release/<version>` deleted
- [ ] `bun publish --access public` succeeded
- [ ] GitHub Release created from the tag and rendered correctly
- [ ] npm, release, tag, and `main` verified on the remote; URLs reported
- [ ] Addressed issues commented, then closed
