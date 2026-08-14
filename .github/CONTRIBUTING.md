# Contributing

Hi, and thanks for using `@cyanheads/pixoo-toolkit`! If you've hit a bug or want something the toolkit doesn't do yet, an issue is the most useful thing you can send. Let me know about any rough edge or new ideas.

Issues are the contribution path here: bugs, feature requests, and documentation gaps all land there, and code changes go through my workflows, so a precise issue with a reproduction is the fastest route to a fix.

- [Report a bug](https://github.com/cyanheads/pixoo-toolkit/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/cyanheads/pixoo-toolkit/issues/new?template=feature_request.yml)
- [Float an idea or ask a question](https://github.com/cyanheads/pixoo-toolkit/issues/new) — free-form, no template, no need to be sure it's a bug first

The bug and feature forms are structured, and filling in the fields is what makes those actionable. Anything that fits neither can just be a plain issue — a half-formed idea in your own words is fine.

## Before filing

A few things that save a round-trip:

1. **Work out whether it's the toolkit or the device.** Most of this package is pure functions over a pixel buffer, so try to reproduce without a Pixoo: render to a `Canvas`, write it with `savePng()`, and look at the output. If the pixels are right and only the display is wrong, it's firmware — the known quirks are listed in `CLAUDE.md`.
2. **Check you're on the latest release.** `bun outdated @cyanheads/pixoo-toolkit` — fixes land on the current version, older ones aren't patched.
3. **Search existing issues, including closed ones.** `gh issue list -R cyanheads/pixoo-toolkit --search "<keyword>" --state all`. A lot of narrow bugs here are already filed and fixed; if one has come back, say so and link it.
4. **Redact your network.** Issues are public and permanent — no device IPs, device IDs, MAC addresses, Divoom account details, or Wi-Fi names in code, logs, or payloads. Use `<device-ip>` or `192.0.2.1`, the way `.env.example` does.

## What makes an issue actionable

- Toolkit version, runtime (Bun or Node) and version, and the device model if the bug involves one.
- A minimal reproduction — real TypeScript importing from the package, not a description of code.
- Actual vs expected behavior, verbatim: the values you got, the values you expected, error messages and stack traces as they appeared.
- For a rendering bug, the coordinates and colors involved — a PNG from `savePng()` is worth attaching.
- For features: the use case first, then the API as you'd want to call it.

## For agents

Use one of the two forms and do the triage first. The free-form path is for humans thinking out loud, not for skipping the checklist — an unverified report costs more to read than it saves to file.

The full workflow lives in [`skills/report-issue-local/SKILL.md`](../skills/report-issue-local/SKILL.md) — triage table, `gh` invocations with bodies that match the issue forms, title scopes, label conventions, and the redaction rules. Read it before filing on someone's behalf.

## Security

Don't open a public issue for a vulnerability. See [SECURITY.md](./SECURITY.md) for private disclosure.
