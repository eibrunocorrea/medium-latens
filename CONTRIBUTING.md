# Contributing to Medium Latens

Versão em português: [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md).

Medium Latens is an editing assistant that runs inside Adobe Premiere Pro. The code, identifiers, comments and tests are written in Portuguese; documentation is bilingual. Contributions in either language are welcome. Commit messages are in English.

## Before you start

- Read the [README](README.md), the [terms of use](TERMOS.md) and [docs/coleta.md](docs/coleta.md), which explains what the usage collection records and how to turn it off in a source build.
- Search the open issues. If none matches, open one describing the problem before writing a large change.
- Every pull request requires a signed [Contributor License Agreement](CLA.md). The bot asks for it on your first PR; one signature covers future contributions.

## Running from source

Requirements: Node.js 22 or newer, Adobe Premiere Pro 22 or newer, Python 3.10 or newer for the optional cutting engine.

```sh
git clone https://github.com/eibrunocorrea/medium-latens.git
cd medium-latens
node --test test/*.test.js          # the suite must be green before you change anything
node server.js                      # local server on 127.0.0.1:8765
```

On first startup, the server writes `mcp-config.json` in the user directory pointing to the `premiere-pro-mcp` package that the bootstrap installs under `npm/`; without running the bootstrap, you must install that package there yourself first, otherwise the assistant cannot reach Premiere.

To install the Premiere panel, the LaunchAgent or Windows service, the Python environment and the media tools exactly as the installer does, run the bootstrap against your checkout:

```sh
bash installer/bootstrap.sh "$PWD"                                                  # macOS
powershell -ExecutionPolicy Bypass -File installer\bootstrap.ps1 -AppDir "$PWD"      # Windows
```

The installer keeps the AI command-line tools in its own folder (~/.medium-latens/npm/bin on macOS, %APPDATA%\Medium Latens\npm on Windows) and does not add them to your shell.

The bootstrap writes user state to `~/.medium-latens` (macOS) or `%APPDATA%\Medium Latens` (Windows) and never inside the repository.

### Usage collection in a source build

A checkout has no `BUILD` stamp, so it is a source build. To turn collection off, add this line to the `.env` file inside your user directory and restart the server:

```
MEDIUM_LATENS_COLETA=desligada
```

The status page (`status/abrir.sh` or the tray shortcut) shows which state is in effect. Official installers carry the `BUILD` stamp and keep collection mandatory, as the terms say.

## Tests

- Diagnostic first: `node --check lib/*.js server.js`, then `node --test test/*.test.js`. The glob is required.
- Write the failing test before the fix. Platform-specific tests declare their platform with the `skip` option of `node:test` and a reason; never skip a failing test to make CI green.
- Never put a real key, token or password in a test, even an expired one. Build fake ones from parts, as the existing tests do; the secret scanner runs on every push.

## Pull requests

- Branch from `main`; keep one concern per PR.
- Conventional commits in English: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `test: ...`, `chore: ...`.
- Fill in the PR template: what changed, why, how you tested it, and a line for `CHANGELOG.md` under `Unreleased`.
- CI runs the suite on Ubuntu, macOS and Windows with Node 22, 24 and 26, plus gitleaks and `npm audit`. All checks must pass.
- The maintainer reviews every PR. Expect questions about edge cases and about what the tests do not cover.

## What we do not accept

- Changes that send media bytes or credentials anywhere. The guards in `lib/telemetria.js` and `lib/status.js` exist for that and have tests.
- Paths that climb above the application directory (see `test/isolation.test.js`).
- Dependencies added to the local server. It runs on the Node standard library only.
- Model names hardcoded in the code. The provider lists them at runtime.

## Security issues

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
