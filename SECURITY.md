# Security Policy

## Supported Versions

Before 1.0, security fixes are applied to the current development line and the
most recent tagged release, when a release exists. Older pre-release versions
are not maintained.

| Version | Supported |
| --- | --- |
| Current `main` | Best effort |
| Most recent tagged release | Yes |
| Older releases | No |

## Reporting A Vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, or
pull request.

Use GitHub's private vulnerability reporting for
[`rand-monster/three-windline`](https://github.com/rand-monster/three-windline/security/advisories/new).
Include:

- the affected revision or version;
- the renderer backend and browser involved;
- a minimal reproduction;
- the expected and observed impact;
- any known mitigation.

If private vulnerability reporting is unavailable, contact a
[`rand-monster`](https://github.com/rand-monster) organization owner through
GitHub and request a private reporting channel. Do not include exploit details
in that first public message.

Maintainers will confirm receipt, reproduce the issue, determine affected
versions, and coordinate disclosure after a fix is available. Exact response
times are not guaranteed.

## Scope

Security-relevant reports may include:

- shader inputs that reliably hang, crash, or lose a supported GPU device;
- unsafe handling of untrusted wind-field or style values;
- dependency or build-chain compromise;
- vulnerabilities in the Cloudflare demo worker or its response headers;
- unexpected network or data access by the package or demo.

`three-windline` is a client-side rendering package. It does not implement
authentication, persistence, gameplay authority, or a network protocol. General
performance tuning, rendering artifacts, browser-driver defects, and unsupported
classic `WebGLRenderer` behavior should be reported as normal issues unless they
have a concrete security impact.

## Disclosure

Please allow maintainers a reasonable opportunity to investigate and release a
fix before public disclosure. Reports made in good faith to improve user safety
are appreciated.
