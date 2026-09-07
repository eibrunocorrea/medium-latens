<div align="center">

# Medium Latens

**An editing assistant that lives inside Adobe Premiere Pro.**

You describe the edit. It works on your open sequence, one visible step at a time. You stay the editor.

[![CI](https://github.com/eibrunocorrea/medium-latens/actions/workflows/ci.yml/badge.svg)](https://github.com/eibrunocorrea/medium-latens/actions/workflows/ci.yml)
[![Segurança](https://github.com/eibrunocorrea/medium-latens/actions/workflows/seguranca.yml/badge.svg)](https://github.com/eibrunocorrea/medium-latens/actions/workflows/seguranca.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange)](#status)

Versão em português: [README.pt-BR.md](README.pt-BR.md)

</div>

> [!WARNING]
> This is an alpha, made by one independent developer who is still learning. It has real bugs, some of them will bite, and a few features only work on one platform. Read [Status](#status) before installing, and open an issue when something breaks.

Criado por Bruno Correa. Free software under the [AGPL-3.0](LICENSE).

## What it does

| Feature | What happens |
|---|---|
| **Prompt-driven editing** | Ask in plain language. The assistant plans, acts on the open sequence through the Premiere scripting bridge, and shows every tool call as it happens. |
| **Creative Brief** | From the transcript of your narration it proposes a plan per segment and plants it as colored markers on the timeline, so the cut follows the story. |
| **Auto Zoom for multicam** | Finds the moments that deserve emphasis and applies dynamic zooms with tracking, following the editing rules kept in your presets. |
| **Optional engine** | A Python engine transcribes, corrects the transcript with your glossary, proposes cuts and writes FCPXML. Image and voice generators plug in through your own API keys. |

## Principles

- **You stay the editor.** Nothing runs without you asking, and every action is a tool call you can watch. The assistant does the mechanical part; the taste, the story and the final word are yours.
- **Made to fit your niche.** Presets, rules and glossaries are meant to be tuned to how you edit. The goal is to help your kind of editing, not to chop every video into catchy phrases.
- **Local first.** The server listens only on your machine, media never leaves it, and everything of yours lives in your user directory.

## Status

`0.1.0-alpha.1` is in preparation. Installers for macOS and Windows will be published on the Releases page; until then, run it from source. The alpha collects usage data under the [terms of use](TERMOS.md).

Known limitations:

- The optional engine's transcription runs only on Apple Silicon Macs; the Windows and Intel path is not wired yet.
- On Windows ARM64 the media tools run under x64 emulation.
- The installer keeps the AI command-line tools in its own folder (`~/.medium-latens/npm/bin` or `%APPDATA%\Medium Latens\npm`) and does not add them to your shell on macOS.
- Many things still need fixing before this is comfortable for daily work. The [issues page](https://github.com/eibrunocorrea/medium-latens/issues) is the honest list.

## Requirements

- Adobe Premiere Pro 22 or newer, on macOS or Windows.
- An AI account: Claude or ChatGPT by subscription, or an API key of your own. The account wizard in the panel sets it up; you never touch a terminal.
- For source builds only: Node.js 22 or newer.

## Install

### Official installer (soon)

Download the `.pkg` or `.exe` from Releases and run it. The installer resolves Node.js, the Premiere panel, the background service and the optional engine, step by step, with a status page you can open any time. Installers are not code-signed yet; the first run asks for confirmation ("Open anyway" on macOS, "Run anyway" on Windows).

### From source

```sh
git clone https://github.com/eibrunocorrea/medium-latens.git
cd medium-latens
node --test test/*.test.js
bash installer/bootstrap.sh "$PWD"
```

On Windows, the last line is:

```powershell
powershell -ExecutionPolicy Bypass -File installer\bootstrap.ps1 -AppDir "$PWD"
```

Details, including how to turn usage collection off in a source build, are in [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

| Piece | Where it runs | What it does |
|---|---|---|
| CEP panel | Inside Premiere | Chat, Creative Brief and Auto Zoom tabs. Talks to the local server with a per-installation token from your user directory. |
| Local server | `127.0.0.1:8765` | Runs the assistant turn through the CLI of your provider (Claude, Codex or Gemini) and streams the result back as server-sent events. |
| Scripting bridge | Premiere | Executes tool calls on the open sequence and records timeline changes for the session summary. |
| Python engine | Your machine, optional | Transcription, glossary correction, cut proposals, FCPXML. |
| Remotion module | Your machine, optional | Motion graphics. |
| User directory | Your machine | Keys, settings, workspaces and the usage queue. Updates and uninstalls never touch it. |

## Usage collection and privacy

The official build records what you do inside Medium Latens (prompts, replies, tools, decisions, timeline changes) and sends it to the author's server to improve the product and train AI models. Each event is capped at 4 KB. Media bytes never leave your machine, and credentials are removed before upload by format recognition plus a randomness heuristic; neither protection has an off switch, and the limits of the heuristic are listed in SECURITY.md. The queue is a plain file you can open before anything is uploaded, and the status page shows its path, the pending count, your anonymous installation id and whether collection is mandatory, active or off.

- Official installers keep collection mandatory, accepted on the terms screen.
- Source builds can turn it off with `MEDIUM_LATENS_COLETA=desligada`.
- The collector's source is not published, to reduce the risk of leaking the collected data. Collected data will be periodically sanitized and published in this repository.

Full text: [TERMOS.md](TERMOS.md) (Portuguese, governing) and [docs/coleta.md](docs/coleta.md) (what is captured, how it is filtered, bilingual).

## Origins

Medium Latens was born on an editing desk, not in a lab.

Bruno Correa records more than he can edit. At some point the pile of unedited videos reached a few hundred, and the question changed. It stopped being "how do I edit faster" and became "how much of this work actually needs me". The honest answer: the taste, the story and the choice of what stays need an editor. Trimming silences, hunting for the second the guest laughs, placing the twentieth zoom on a card being turned over: that part does not.

So he built an assistant for himself. Something that lives inside Premiere, understands the sequence that is open, does the mechanical part when asked, and shows every step so the editor keeps the last word. It cut his own videos for a year. In 2026 he pulled it out of his personal workflow, removed everything that was his, and put it here so other editors could use it, break it and make it better.

The intent has not changed. Medium Latens is not here to replace an editor, and it does not try to. It exists to give freedom and accessibility to people who already edit: to give back evenings, to turn a two-day cut into a one-day cut, to let a small team punch above its weight. Tools that only chop a video into catchy phrases flatten every channel into the same shape. This one is meant to be tuned to different niches, each with its own rules of editing, so that it helps your kind of work instead of imposing one.

It is also, plainly, the work of one independent developer with little experience, learning in public. There are bugs, and some will be embarrassing. If you find one, an issue is the kindest thing you can open. The [CHANGELOG](CHANGELOG.md) tells how it has been built so far.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: how to run from source, how tests work, what we do not accept, and the [Contributor License Agreement](CLA.md) the bot will ask you to sign. Security problems go through [SECURITY.md](SECURITY.md), never a public issue. This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## License

Copyright (c) 2026 Bruno Correa.

Medium Latens is free software: you can use, study, modify and redistribute it under the GNU Affero General Public License, version 3. If you distribute a modified version, or run one as a network service, you must publish its source under the same license. See [LICENSE](LICENSE).

Criado por Bruno Correa.
