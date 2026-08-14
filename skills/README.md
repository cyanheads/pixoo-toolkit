# Skills

Agent Skills for `@cyanheads/pixoo-toolkit`. Each subdirectory holds a `SKILL.md` following the [Agent Skills specification](https://agentskills.io/specification).

These encode the procedures this repo actually runs — its gates, its version surfaces, its issue conventions — so an agent arriving with no prior context can execute them without re-deriving them from the source tree.

| Skill | Use when |
|:---|:---|
| [`git-wrapup`](git-wrapup/SKILL.md) | Working-tree changes are verified and ready to become a version. Ends at a local commit stack + annotated tag. |
| [`release-and-publish`](release-and-publish/SKILL.md) | A tag exists locally and the release goes public: push, npm publish, GitHub Release. |
| [`report-issue-local`](report-issue-local/SKILL.md) | Filing a bug or feature request against this repo. |

## Conventions

- **Read the whole `SKILL.md` before acting on it.** The steps assume the constraints stated above them.
- A sub-agent does not inherit the parent session's skill registry. Run `bun run list-skills` to print this index with absolute paths, then read the relevant file.
- Skills describe procedure. Device API facts, module layout, and command references live in `CLAUDE.md` / `AGENTS.md`, which are kept byte-identical and gated by `bun run docs:check`.
