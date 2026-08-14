---
name: release-and-publish
description: >
  Take a locally committed and tagged version of `@cyanheads/pixoo-toolkit` public — push the commits and tag, publish to npm, and cut the GitHub Release from the tag message. Picks up exactly where `git-wrapup` stops.
metadata:
  author: cyanheads
  version: '1.0'
  audience: external
  type: workflow
---

## When to use

`git-wrapup` has finished: the work is committed, `package.json` and `CHANGELOG.md` carry the new version, and an annotated `v<version>` tag points at HEAD. Nothing is pushed yet.

Every step here is externally visible and most of it is irreversible. An npm version cannot be republished, and a pushed tag is public immediately.

## Before starting

```bash
git status                  # must be clean
git log --oneline -5
git describe --exact-match --tags HEAD    # must print v<version>
npm whoami                  # confirms npm auth
gh auth status              # confirms GitHub auth
```

If the tag does not point at HEAD, or the tree is dirty, stop and return to `git-wrapup`.

### If a previous attempt partially succeeded

Publishing is not atomic across destinations. Before retrying, establish which destinations already have the release, and skip those:

```bash
npm view @cyanheads/pixoo-toolkit version
git ls-remote --tags origin | rg 'v<version>'
gh release view v<version>
```

These errors mean "already done — move on", not "failed":

- npm: `version already exists`, `You cannot publish over the previously published versions`
- GitHub Release: `release already exists`

## Steps

### 1. Re-run the gate

`prepublishOnly` runs `devcheck` and `test:all` automatically, but run them first so a failure costs a local minute rather than a half-published release:

```bash
bun run devcheck
bun run test:all
```

Run both raw. Do not filter the output.

### 2. Push commits and tag

```bash
git push origin main
git push origin v<version>
```

Push the branch before the tag. A tag pointing at a commit the remote does not have creates a GitHub Release referencing nothing.

### 3. Publish to npm

```bash
bun publish --access public
```

`files` in `package.json` is `["dist/src"]`, so the published tarball carries only the compiled library — not `scripts/`, `tests/`, or `assets/`. `prepublishOnly` rebuilds from clean, so `dist/` is regenerated as part of this command.

Confirm the contents before trusting the publish:

```bash
npm view @cyanheads/pixoo-toolkit version
npm pack --dry-run
```

If the npm account has 2FA enabled, the command prompts for an OTP — that is expected and the operator completes it interactively. With the 1Password CLI available, `bun publish --access public --otp="$(op item get 'npm' --otp)"` avoids the prompt.

### 4. Cut the GitHub Release

The tag message is the release body:

```bash
gh release create v<version> --verify-tag --notes-from-tag --title "v<version>: <tag subject>"
```

`--notes-from-tag` publishes the tag message verbatim, so anything wrong in it is now public. `--verify-tag` fails rather than creating a tag that does not exist on the remote — do not drop it.

### 5. Verify every destination

A zero exit code is not proof the artifact is reachable; registry propagation is real.

```bash
npm view @cyanheads/pixoo-toolkit version            # matches the new version
gh release view v<version> --json tagName,name       # exists, titled correctly
git ls-remote --tags origin | rg 'v<version>'        # tag on the remote
```

Read the rendered release body on github.com once. If the tag message had a markdown problem, this is where it shows.

### 6. Close out the issues

For each issue this release addressed:

```bash
gh issue comment <number> --body "Fixed in v<version>."
gh issue close <number> --reason completed
```

Comment first, then close — closing without a record of what shipped leaves the next reader guessing. Keep the comment to one or two lines naming the version and the observable change; the CHANGELOG carries the detail.

## Constraints

- **Never `git push --force`** to `main` or over a tag.
- **Never republish or unpublish an npm version.** A mistake ships as the next patch.
- If a step fails, halt and report which destinations succeeded before retrying. Do not blindly re-run the whole sequence.
- Everything in a tag message, release body, or issue comment is public. No internal paths, hostnames, device IPs, or planning context.

## Checklist

- [ ] Working tree clean, `v<version>` points at HEAD
- [ ] `bun run devcheck` and `bun run test:all` pass
- [ ] `git push origin main` succeeded
- [ ] `git push origin v<version>` succeeded
- [ ] `bun publish --access public` succeeded
- [ ] `npm view` reports the new version
- [ ] GitHub Release created from the tag and rendered correctly
- [ ] Addressed issues commented and closed
