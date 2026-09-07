#!/usr/bin/env python3
"""transcribe.py: transcrição LOCAL word-level de um master (estágio 1 do transcription-first).

mlx-whisper large-v3-turbo (Apple Silicon; pré-voo F2: 13× tempo real num FX3 real),
PT-BR, word timestamps e preparação com o glossário TCG opcional do usuário.

Uso: python3 engine/transcribe.py "<master>" [--slug X] [--force] [--limit SEGUNDOS]

Idempotente: cache em USER_DIR/workspaces/<slug>/ (key = path+size+mtime do master).
Master NUNCA é modificado. Saída (última linha, para agentes parsearem):
  TRANSCRIPT_JSON=<path>  SEGMENTS=<n>  WORDS=<n>  DURATION=<s>  CACHED=<0|1>
"""
import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import workspace  # noqa: E402
from userpaths import HOTWORDS, env_value  # noqa: E402


# MEDIUM_LATENS_WHISPER_MODEL troca o modelo local pelo .env do usuário.
MODEL = env_value("MEDIUM_LATENS_WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")


def die(msg, code=1):
    print(f"ERRO: {msg}")
    sys.exit(code)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("master")
    ap.add_argument("--slug", default=None)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--limit", type=float, default=None, help="transcrever só os N primeiros segundos (teste)")
    args = ap.parse_args()

    master = Path(args.master).expanduser()
    if not master.is_file():
        die(f"master não existe: {master}")
    slug = args.slug or workspace.slug_for_master(master)
    ws = workspace.resolve(slug)
    suffix = f".first{int(args.limit)}s" if args.limit else ""
    out_json = ws / "transcript" / f"{master.stem}{suffix}.whisper.json"

    if not args.force and not args.limit:
        cached = workspace.cached_output(ws, master, "transcript")
        if cached:
            j = json.loads(cached.read_text(encoding="utf-8"))
            words = sum(len(s.get("words", [])) for s in j["segments"])
            print(f"cache HIT: master não mudou desde {j.get('created')}")
            print(f"TRANSCRIPT_JSON={cached}  SEGMENTS={len(j['segments'])}  "
                  f"WORDS={words}  DURATION={j.get('duration', 0):.1f}  CACHED=1")
            return

    prompt = HOTWORDS.read_text(encoding="utf-8").strip() if HOTWORDS.exists() else None
    print(f"workspace: {ws.name}  |  glossário: {'ok' if prompt else 'ausente'}")

    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "audio.wav"
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(master)]
        if args.limit:
            cmd += ["-t", str(args.limit)]
        cmd += ["-vn", "-ac", "1", "-ar", "16000", str(wav)]
        print(f"extraindo áudio de {master.name}…", flush=True)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            die(f"ffmpeg falhou: {r.stderr[:300]}")

        print(f"transcrevendo com {MODEL} (PT-BR, word timestamps)…", flush=True)
        t0 = time.time()
        import mlx_whisper
        # Anti-alucinação em silêncio (unboxing tem rips de ~2s mudos): substitui o
        # vad_filter do faster-whisper (Titan) que o mlx não tem. Validado na F2:
        # sem isso, 60/77 segments eram loops alucinados sem words.
        res = mlx_whisper.transcribe(
            str(wav),
            path_or_hf_repo=MODEL,
            language="pt",
            word_timestamps=True,
            initial_prompt=prompt,
            condition_on_previous_text=False,
            hallucination_silence_threshold=2.0,
        )
        took = time.time() - t0

    segments, dropped = [], 0
    for seg in res.get("segments", []):
        if not seg.get("words"):  # segment sem nenhuma word = alucinação sobre silêncio
            dropped += 1
            continue
        segments.append({
            "start": round(float(seg["start"]), 3),
            "end": round(float(seg["end"]), 3),
            "text": seg["text"],
            "words": [{"start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3),
                       "word": w["word"], "probability": round(float(w.get("probability", 0)), 3)}
                      for w in seg.get("words", [])],
        })
    duration = segments[-1]["end"] if segments else 0.0
    out = {
        "file": master.name, "master_path": str(master),
        "duration": duration, "language": res.get("language", "pt"),
        "model": MODEL, "created": time.strftime("%Y-%m-%d %H:%M:%S"),
        "transcribe_seconds": round(took, 1), "limit": args.limit,
        "segments": segments,
    }
    out_json.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not args.limit:  # runs de teste (--limit) não viram o cache oficial
        workspace.record_output(ws, master, "transcript", out_json)

    words = sum(len(s["words"]) for s in segments)
    rt = duration / took if took else 0
    if dropped:
        print(f"filtrados {dropped} segments alucinados (sem words, silêncio)")
    print(f"OK: {len(segments)} segments, {words} words, {duration:.0f}s de áudio em {took:.1f}s ({rt:.0f}× tempo real)")
    print(f"TRANSCRIPT_JSON={out_json}  SEGMENTS={len(segments)}  WORDS={words}  "
          f"DURATION={duration:.1f}  CACHED=0")


if __name__ == "__main__":
    main()
