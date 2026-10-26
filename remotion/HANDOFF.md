# Remotion security bump evidence

## 2026-10-25 23:06 - Codex

Objective: remove the high-severity Zod advisory with the owner's exact Remotion and Zod versions.

- ENTREGUE: pinned `remotion`, `@remotion/cli`, `@remotion/captions`, and `@remotion/zod-types` to `4.0.538`; pinned and globally overrode `zod` to `4.6.7`. Dependency commit: `d434525`.
- ARQUIVOS: `remotion/package.json`, `remotion/package-lock.json`, `remotion/README.md`, and this evidence file. The handoff stays inside `remotion/` to honor the explicit write boundary; no root ledger existed.
- DECISOES: kept TypeScript `5.9.3`, React and React DOM `19.2.8`. No source API changes were necessary: the seven existing schemas already use Zod 4-compatible APIs. Runtime checks passed for every registered default, omitted default, example props file, dimension constraint, and color field (including rejection of invalid colors and preservation of RGBA strings).
- COMO TESTAR: commands and observed results follow below. There is no configured lint script.
- PENDENTE: the native macOS root suite remains affected by two existing status tests that inspect the installed CEP panel in the real user's home. Clean Linux execution passes; this is local container evidence, not a remote CI result. Remotion warns that it expects Zod `4.5.4`; the requested secure override remains in place, and all renders pass with it. No push was performed.
- ARVORE: branch `fix/seguranca-main`; original commits `de160ff`, `765e01d`, and `7ad2888` preserved. Only the four paths listed above changed. No generated render output is stored in Git or inside the repository.

### Dependency and TypeScript checks

Run from `remotion/`:

```sh
npm audit --audit-level=high
# found 0 vulnerabilities; exit 0
npm ls zod
# root: zod@4.6.7 overridden; every transitive entry: zod@4.6.7 deduped; exit 0
npx tsc --version
# Version 5.9.3
npx tsc --noEmit -p tsconfig.json
# no diagnostics; exit 0
```

The requested root command `npx tsc --noEmit -p remotion/tsconfig.json` also exited 0.
Before the bump, audit exited 1 with five high-severity findings caused by Zod.
The previous fixes for `source-map-js`, `fast-uri`, and `postcss-selector-parser` remain intact.

### Real render checks

Run from `remotion/`, substituting each row's composition and props:

```sh
npx remotion render <Composition> /tmp/medium-latens-seguranca-<Composition>.mov \
  --frames=0-5 --props=<Props> --concurrency=2
```

| Composition registered in `src/Root.tsx` | Props | Observed result |
| --- | --- | --- |
| Captions | `props/captions-horizontal-example.json` | Rendered 6/6; encoded 6/6; exit 0 |
| CaptionsPro | `props/captions-pro-shorts-fx3-2.json` | Rendered 6/6; encoded 6/6; exit 0 |
| LowerThird | `props/lower-third-example.json` | Rendered 6/6; encoded 6/6; exit 0 |
| TextAnim | `props/text-anim-example.json` | Rendered 6/6; encoded 6/6; exit 0 |
| TransitionWipe | `props/transition-zoom-example.json` | Rendered 6/6; encoded 6/6; exit 0 |
| TrackedOverlay | `props/tracked-overlay-example.json` | Rendered 6/6; encoded 6/6; exit 0 |
| NumberCounter | `props/num/n700.json` | Rendered 6/6; encoded 6/6; exit 0 |

`ffprobe` independently confirmed all seven files contain six frames of ProRes 4444,
with alpha (`pix_fmt=yuva444p12le`), using the unchanged project codec defaults.

### Root test suite

The CI command is `node --test test/*.test.js`.

- Native macOS, Node `26.10.0`, default concurrency: 480 tests, 475 passed, 5 failed. Three failures hit the launcher's 5-second or bootstrap's 10-second subprocess timeouts during parallel execution.
- Native macOS, `node --test --test-concurrency=1 test/*.test.js`: 480 tests, 478 passed, 2 failed, exit 1. All launcher and bootstrap tests passed. The remaining failures are `test/status.test.js:49` (`actual [false, false, true, false]`, expected all false) and `test/status.test.js:203` (`actual 3`, expected 4 absent modules). `lib/status.js` detects the real installed CEP panel because those tests do not supply an isolated `homeDir`.
- Clean Linux, Node 26 official container, identical unmodified CI test command: 472 tests, 442 passed, 0 failed, 30 platform skips, exit 0. The lower total reflects platform-dependent subtests. No tests were removed, changed, or manually excluded.

Reproduce the Linux run from the repository root (choose an unused container name):

```sh
docker run --name medium-latens-seguranca-check --network none \
  --mount "type=bind,src=$PWD,dst=/work,readonly" \
  --tmpfs /work/data --workdir /work \
  node:26-bookworm-slim node --test test/*.test.js
```

Image digest: `sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe`.
The source mount is read-only; the temporary data mount permits the existing briefing fixture to write its test data.
Full local logs: `/tmp/medium-latens-seguranca-root-tests.log` (serial macOS) and `/tmp/medium-latens-seguranca-linux-tests.log` (passing Linux).
