# engine/ — pipeline "edit-outside-Premiere" do Medium Latens

Operações pesadas rodam AQUI (fora do Premiere) e entram no Premiere como arquivo.
Python do ambiente: `USER_DIR/venv/bin/python3` no macOS ou
`USER_DIR\venv\Scripts\python.exe` no Windows. Cache por projeto em `USER_DIR/workspaces/<slug>/`
(manifesto `project.json`; key = path+size+mtime do master — master NUNCA é tocado).
Todos os scripts terminam com uma linha parseável (`CHAVE=valor`), para o agente do painel.

## F2 — transcription-first (2026-07-25)

| Script | O quê | Saída |
|---|---|---|
| `transcribe.py <master> [--slug X] [--force] [--limit s]` | mlx-whisper large-v3-turbo local (23× tempo real medido), PT-BR, word timestamps, glossário TCG, anti-alucinação em silêncio (rips!), idempotente | `transcript/<stem>.whisper.json` · `TRANSCRIPT_JSON= SEGMENTS= WORDS= DURATION= CACHED=` |
| `correct.py <*.whisper.json> [--context] [--force]` | correção de entidades TCG via Gemini (rotação multi-key de `scripts/gemini_client.py`), timestamps intocados | `transcript/<stem>.corrected.json` · `CORRECTED_JSON= CORRECTIONS=` |
| `adobe_transcript.py <*.corrected.json>` | converte p/ spec Adobe v1.0.0 (validado contra `schemas/adobe-transcript-v1.0.0.schema.json`) + SRT sentence-level | `<stem>.adobe-transcript.json` + `<stem>.srt` · `ADOBE_JSON= SRT= VALID=` |

`workspace.py` — helpers de workspace/cache compartilhados (slug, manifesto, cache key).

### Levar o transcript ao Premiere

- **Text panel (Text-Based Editing)** — 1 clique do usuário: Source Monitor com o clip
  aberto → painel Text → aba Transcript → menu `…` → Import > Import static transcript
  → escolher o `.adobe-transcript.json`. (Automação total só existe via UXP
  `Transcript.importFromJSON` — mini-plugin UXP registrado como melhoria futura;
  ExtendScript não tem API de transcript.)
- **Legendas** — 100% automático pela bridge: importar o `.srt` (`import_media`) +
  `create_caption_track`.

## F3 — cortes por transcript → sequência nova (2026-07-25)

| Script | O quê | Saída |
|---|---|---|
| `cuts.py <transcript.json> [--min-gap 2.5] [--pad 0.25] [--margin S] [--start-at/--end-at] [--name]` | tempos mortos por gaps de WORDS (nunca corta palavra; min-gap 2,5s preserva rips; corte só se ≥0,5s) + plano legível; `--margin` = alias de `--pad`; keeps consecutivos nunca sobrepõem (clamp) | `<stem>.cuts.json` · `CUTS_JSON= KEEP= CUTS= REMOVED= FINAL=` |
| `fcpxml.py <cuts.json> [-o out.xml] [--audio-xfade N]` | cuts JSON → **XMEML (FCP7 XML)** frame-accurate no fps real; V1+A1 = base emendado; V2 = `overlays` multicam (`{file, tl_start, src_in, dur}` em tempo de timeline pós-corte); `--audio-xfade N` = crossfade "Constant Power" de N frames centrado em cada junção interna de A1 (só onde o source tem handle de N/2; senão junção fica seca); campo opcional `music` `{file, tl_start}` no JSON vira A3 contínua (A2 fica vazia p/ SFX) | `<stem>.xml` · `XMEML= SEGMENTS= OVERLAYS= DURATION= XFADES= MUSIC=` |
| `roomtone.py <master> --duration S [--slug X] [--noise -35] [--min-silence 0.8]` | room tone do PRÓPRIO master: maior gap de silêncio (silencedetect) → extrai com inset 0,1s → aloop até a duração alvo (48kHz stereo PCM16); master intocado | `workspaces/<slug>/audio/roomtone.wav` · `ROOMTONE_WAV= SOURCE_GAP= DURATION=` |

Import no Premiere: **`import_media` com o .xml** (vira sequência nova no bin).
⚠️ `import_fcp_xml`/`app.openFCPXML` NÃO funciona no 26.3 ("Not Enough Parameters").
Fluxo do agente: transcribe → cuts (declara o plano) → fcpxml → import_media →
`set_active_sequence` (id COMPLETO) → verificação via `get_full_sequence_info`.

Verificação de corte: comparar in/out dos clips importados com o cuts JSON via
`get_full_sequence_info` — o caminho XMEML não re-encoda nada, então drift A/V
(o `verify_cut` do claude-youtube-editor) não se aplica; é conferência estrutural.

### Decisões de implementação (não regredir)

- mlx-whisper NÃO tem o `vad_filter` do faster-whisper → anti-alucinação é
  `condition_on_previous_text=False` + `hallucination_silence_threshold=2.0` +
  filtro de segments sem words (sem isso: 60/77 segments eram loops alucinados
  sobre o silêncio dos rips). Silêncio é conteúdo — o filtro só remove TEXTO
  alucinado, nunca mexe em mídia/timing.
- `--limit N` (testes) não grava o cache oficial.
- Runs de correção usam texto do segment; words mantêm o texto original a menos
  que a contagem de tokens bata (aí ganham as entidades corrigidas com o timing intacto).

## Dependências

As dependências Python vivem em `requirements.txt`, com versão fixada. O instalador cria o
ambiente em `USER_DIR/venv` e roda `pip install -r engine/requirements.txt`. O marcador de
plataforma escolhe `mlx-whisper` em Apple Silicon e `faster-whisper` nos demais sistemas. Para
atualizar uma versão, consulte o PyPI, edite a linha e rode `node --test test/*.test.js`.
