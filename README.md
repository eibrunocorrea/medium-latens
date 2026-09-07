# Medium Latens

Versão em português: [README.pt-BR.md](README.pt-BR.md).

[![CI](https://github.com/eibrunocorrea/medium-latens/actions/workflows/ci.yml/badge.svg)](https://github.com/eibrunocorrea/medium-latens/actions/workflows/ci.yml) [![Segurança](https://github.com/eibrunocorrea/medium-latens/actions/workflows/seguranca.yml/badge.svg)](https://github.com/eibrunocorrea/medium-latens/actions/workflows/seguranca.yml)

Medium Latens is an editing assistant that works inside Adobe Premiere Pro. You talk to it in a panel, and it acts on your timeline: it cuts, moves and labels, builds a Creative Brief as colored markers, and applies Auto Zoom to multicam sequences.

Criado por Bruno Correa. Free software under the [AGPL-3.0](LICENSE).

## Status

Alpha. Version `0.1.0-alpha.1` is in preparation. Installers for macOS and Windows will be published on the Releases page; until then, run it from source (see below). The alpha collects usage data under the [terms of use](TERMOS.md).

Known limitations of this alpha: the optional engine's transcription runs only on Apple Silicon Macs (the Windows and Intel path is not wired yet); on Windows ARM64 the media tools run under x64 emulation; the installer keeps the AI command-line tools in its own folder (`~/.medium-latens/npm/bin` or `%APPDATA%\Medium Latens\npm`) and does not add them to your shell on macOS.

## What it does

- **Prompt-driven editing.** Ask in plain language; the assistant plans and executes on the open sequence through the Premiere scripting bridge, and shows every tool call as it happens.
- **Creative Brief.** From the transcript of your narration it proposes a plan per segment and plants it as colored markers on the timeline, so the edit follows the story.
- **Auto Zoom for multicam.** Detects moments that deserve emphasis and applies dynamic zooms with tracking, following the editing rules baked into the presets.
- **Optional engine.** A Python engine transcribes, corrects the transcript with your glossary, proposes cuts and generates FCPXML; media generators for image and voice plug in through your own API keys.

## Requirements

- Adobe Premiere Pro 22 or newer, on macOS or Windows.
- An AI account: Claude or ChatGPT by subscription, or an API key of your own. The account wizard in the panel sets it up; you never touch a terminal.
- For source builds only: Node.js 22 or newer.

## Install

**Official installer (soon):** download the `.pkg` or `.exe` from Releases and run it. The installer resolves Node.js, the Premiere panel, the background service and the optional engine, step by step, with a status page you can open any time. Installers are not code-signed yet; the first run asks for confirmation ("Open anyway" on macOS, "Run anyway" on Windows).

**From source:**

```sh
git clone https://github.com/eibrunocorrea/medium-latens.git
cd medium-latens
node --test test/*.test.js
bash installer/bootstrap.sh "$PWD"          # macOS; on Windows: powershell -ExecutionPolicy Bypass -File installer\bootstrap.ps1 -AppDir "$PWD"
```

Details, including how to turn usage collection off in a source build, are in [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

1. A CEP panel inside Premiere talks to a local server on `127.0.0.1:8765`, authenticated by a token that lives in your user directory.
2. The server runs the assistant turn through the CLI of your provider (Claude, Codex or Gemini) and streams the result back as server-sent events.
3. Tool calls reach Premiere through a scripting bridge; timeline changes are recorded for the session summary.
4. The Python engine (transcription, cuts, FCPXML) and the Remotion module (motion graphics) are optional and live outside the server process.
5. Program files live in the application directory; everything of yours (keys, settings, workspaces, queue) lives in the user directory, untouched by updates and uninstalls.
6. Usage events go to a local queue you can read, and are uploaded in batches. See below.

## Usage collection and privacy

The official build records what you do inside Medium Latens (prompts, replies, tools, decisions, timeline changes) and sends it to the author's server to improve the product and train AI models. Each event is capped at 4 KB. Media bytes never leave your machine, and credentials are removed before upload by format recognition plus a randomness heuristic; neither protection has an off switch, and the limits of the heuristic are listed in SECURITY.md. The queue is a plain file you can open before anything is uploaded, and the status page shows its path, the pending count, your anonymous installation id and whether collection is mandatory, active or off.

- Official installers keep collection mandatory, accepted on the terms screen.
- Source builds can turn it off with `MEDIUM_LATENS_COLETA=desligada`.
- The collector's source is not published, to reduce the risk of leaking the collected data. Collected data will be periodically sanitized and published in this repository.

Full text: [TERMOS.md](TERMOS.md) (Portuguese, governing) and [docs/coleta.md](docs/coleta.md) (what is captured, how it is filtered, bilingual).

## Origins

Medium Latens descends from AutoCutClone, a cutting tool, and from a personal editing assistant that Bruno Correa built for his own YouTube channel between 2025 and 2026 to get through a backlog of hundreds of recorded videos. In August 2026 the assistant was extracted into this standalone product: isolated from any personal data, hardened with a local token and secret redaction, given installers for both systems, and put under a usage-collection program so it can learn from how editors actually work. The [CHANGELOG](CHANGELOG.md) tells that story phase by phase.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: how to run from source, how tests work, what we do not accept, and the [Contributor License Agreement](CLA.md) the bot will ask you to sign. Security problems go through [SECURITY.md](SECURITY.md), never a public issue. This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## License

Copyright (c) 2026 Bruno Correa.

Medium Latens is free software: you can use, study, modify and redistribute it under the GNU Affero General Public License, version 3. If you distribute a modified version, or run one as a network service, you must publish its source under the same license. See [LICENSE](LICENSE).

Criado por Bruno Correa.
