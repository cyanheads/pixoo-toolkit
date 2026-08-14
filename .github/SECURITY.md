# Security Policy

## Supported Versions

Security fixes land on the latest release of `@cyanheads/pixoo-toolkit`. Older
versions are not patched — upgrade to the current release.

## Scope

This toolkit talks to a Divoom Pixoo on your local network over unauthenticated
HTTP — that is what the device firmware exposes, and the toolkit cannot add
transport security the device does not implement. Treat a Pixoo as an untrusted
LAN peer and do not expose its HTTP port to the internet.

In scope for a report: anything the toolkit itself does wrong — unsafe handling
of a device response, a parser that can be driven into unbounded memory or CPU
by hostile input (image, SVG path, or device JSON), a dependency advisory, or a
leak of configuration into logs or exported files.

Out of scope: the Pixoo firmware's own lack of authentication, and Divoom's
cloud API.

## Reporting a Vulnerability

Please do not open a public issue for security reports. Instead:

- Report privately via GitHub: **Security** tab → **Report a vulnerability**, or
- Email **security@caseyjhand.com**

Include a minimal reproduction where possible, and redact any device
identifiers or network addresses. You'll receive an acknowledgment within a few
days, and credit in the release notes if the report leads to a fix (unless you
prefer otherwise).
