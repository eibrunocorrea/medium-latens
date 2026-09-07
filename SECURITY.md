# Security policy

Versão em português: [SECURITY.pt-BR.md](SECURITY.pt-BR.md).

## Supported versions

Medium Latens is in alpha. Only the latest release on the `main` branch receives fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems.

1. Preferred: use GitHub private vulnerability reporting on this repository ("Report a vulnerability" under the Security tab).
2. Alternative: email `contato@mediumlatens.com` with the subject `[security] Medium Latens`.

Include what you found, how to reproduce it, the version (the `VERSION` file or the status page) and your operating system. You will get a first reply within 7 days. Once a fix is available, the report and the fix are credited in `CHANGELOG.md` unless you ask otherwise.

## Scope

In scope: the local server (`server.js`, `lib/`), the Premiere panel (`panel/`), the installers (`installer/`, `status/`, `windows/`), the usage collection client (`lib/telemetria.js`, `lib/envio.js`) and the Python engine (`engine/`).

Out of scope: the collection receiver (closed source, hosted by the author; report issues about it by email), the AI providers' own services, and Adobe Premiere Pro itself.

## What the design guarantees

- The local server listens on `127.0.0.1` only and requires a local token on every route except `/health`; browser origins other than loopback or `null` are rejected.
- Every route of the local server validates the Host header (421 outside loopback) and the Origin header (403 outside the panel).
- Media bytes never enter the usage collection, and each event is capped at 4 KB. Credentials and tokens are removed before anything is queued by format recognition plus a randomness heuristic; see Known limitations for what that does not cover.
- The installer verifies the Node.js download against the official SHA-256 list, installs the four direct Python dependencies at pinned versions, and runs npm only as the user with pinned package versions.
- No path in the code climbs above the application directory; updates and uninstalls never touch the user directory.

## Known limitations

- **Secret redaction in usage collection relies on format recognition plus heuristics, not an absolute guarantee (F4.1, F4.4, Medium).** The client removes known key formats, webhook addresses, PEM blocks and values that look like random tokens (entropy, case alternation and interspersed digits) before writing any event. A secret in a new format, entirely lowercase or without interspersed digits may pass through. Mitigation: do not paste passwords or keys into the assistant; the local queue can be read before sending. Planned: review the list of formats in every release.
- **Orphaned base64 lines from private keys may partly escape redaction (F4.1, Low).** A complete PEM block is removed in full (up to 16 KB of body). Base64 fragments without a header, without `+` and without `=`, with few case alternations, survive in about one in five cases. Mitigation: the block rule and the entropy screen cover the real case; do not paste private keys into the assistant.
- **Transitive Python dependencies have neither pinned versions nor hashes (F6.5, Medium).** `engine/requirements.txt` pins the four direct packages; the dozens of indirect dependencies resolve to the newest compatible version at installation time. Mitigation: `pip-audit` in CI on every push and weekly Dependabot for `pip`. Planned: a lockfile with per-platform hashes when the engine is no longer optional.
- **The installation identifier comes from the client (F7.8, Medium).** The `x-instalacao` header is a locally generated UUID; anyone who controls the client can forge as many as they want, so the receiver's per-installation rate is not an abuse control, only an error control. Mitigation: rate limiting per IP, a 1 MB body limit and a 20 GB cap on the receiver. The sanitized dataset that will be published will have its own specification with poisoning detection before the first publication.
- **Gitleaks does not scan `test/` (F7.16, Low).** The fake key fixtures in tests are assembled from parts and the directory is on the `.gitleaks.toml` allowlist. Mitigation: GitHub secret scanning and push protection scan everything, including `test/`.
- **The status URL containing the token remains in browser history (F3.6, residual Low).** The launcher opens `/status?t=<token>`; the server exchanges the token for an `HttpOnly; SameSite=Lax` cookie and redirects, but the original URL remains in the machine's history. The token is valid only on loopback. Planned mitigation: a single-use code instead of the token.
- **The panel CSP was verified statically, not in Premiere (F2.1).** The CEP panel loads the policy through `<meta>`; if CEF ignores it, the panel works as before (without the extra defense); if it blocks `token.js`, the panel does not authenticate. The `file:` source was included for the second case. Pending: load the panel in Premiere once before the first release.
- **On Windows ARM64, ffmpeg runs under x64 emulation (F6.2).** The ffmpeg-static release does not publish an ARM64 binary for Windows; the installer downloads the x64 binary and verifies its SHA-256. It works, but more slowly.
- **The Python engine's transcription works only on macOS Apple Silicon (pre-existing, found in Task 9).** `engine/transcribe.py` imports `mlx_whisper` without a branch for `faster_whisper`, even though the Windows installer installs `faster-whisper`. The rest of the product works; transcription on Windows and Intel Macs is future work (a public issue after opening).
- **The entropy screen does not catch a random token that is entirely lowercase or has digits only at the ends (F4.1, Low).** The three signals (entropy, case alternation and interspersed digits) were chosen to preserve file names, paths and camelCase identifiers. Known formats remain covered by their own rules.
- **A login profile that prints text after the command (`~/.zlogout`) makes the installer unable to find the user's Node (F3.3, Low).** The path is validated as absolute and executable; when in doubt, the installer downloads official Node. Effect: a second Node, never an incorrect path in the service.
- **Running `installer/bootstrap.sh` without root does not honor the caller's PATH (F3.3).** The supported flow is the `.pkg` package; anyone running from source must have Node visible through their own shell's login profile.
- **The SSE token travels in the `/stream` query string (F2.5, Informational).** Browser EventSource does not send headers; the token is valid only on loopback and the route requires the panel origin.

## Workflow permissions

`.github/workflows/cla.yml` uses `pull_request_target` so the CLA check can comment on pull requests from forks. It checks out only the `cla-signatures` branch of this repository, fetches its own script from the protected `main`, never checks out or executes code from the pull request, and uses only the workflow token, whose write access is limited to unprotected branches (`cla-signatures`).
