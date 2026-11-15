# Skills

Agent Skills for `@cyanheads/pixoo-toolkit`. Each subdirectory holds a `SKILL.md` following the [Agent Skills specification](https://agentskills.io/specification).

These encode the procedures this repo actually runs — its gates, its version surfaces, its issue conventions — so an agent arriving with no prior context can execute them without re-deriving them from the source tree.

| Skill | Use when |
|:---|:---|
| [`code-simplifier`](code-simplifier/SKILL.md) | A working session left changes in the tree, or a module needs a cleanup pass. Edits the tree; never commits. |
| [`git-wrapup`](git-wrapup/SKILL.md) | Working-tree changes are verified and ready to become a version. Ends at a commit stack on `release/<version>` with its PR open (release PR mode) or on `main`. |
| [`release-pr-review`](release-pr-review/SKILL.md) | A release PR is open and gated mode calls for a review before it ships. Lands fixes as commits on the release branch. |
| [`release-and-publish`](release-and-publish/SKILL.md) | The release is committed (and, in gated mode, reviewed): fast-forward `main`, tag, push, npm publish, GitHub Release. |
| [`report-issue-local`](report-issue-local/SKILL.md) | Filing a bug or feature request against this repo. |

A release runs `code-simplifier` → `git-wrapup` → `release-pr-review` → `release-and-publish`. The release PR mode — gated or straight-through — is declared in `CLAUDE.md` under `## Publishing`.

## Conventions

- **Read the whole `SKILL.md` before acting on it.** The steps assume the constraints stated above them.
- A sub-agent does not inherit the parent session's skill registry. Run `bun run list-skills` to print this index with absolute paths, then read the relevant file.
- Skills describe procedure. Device API facts, module layout, and command references live in `CLAUDE.md` / `AGENTS.md`, which are kept byte-identical and gated by `bun run docs:check`.
