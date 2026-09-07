#!/usr/bin/env python3
"""
sync_cams.py — offset de sincronização entre 2 câmeras por áudio (estágio 1 do pipeline).
Método validado no spike PKM-01 / spec 2026-07-12: bbc/audio-offset-finder (MFCC, Apache-2.0)
com gate de confiança (>10 aceita; 5–10 aviso; <5 rejeita).

Uso:  python3 helpers/sync_cams.py "<video_ou_audio_1>" "<video_ou_audio_2>"
      (use o interpretador em USER_DIR/venv criado pelo instalador)

Saída (última linha, para agentes parsearem):
  OFFSET_SECONDS=<float>  CONFIDENCE=<float>  APLICAR=<instrução>
Convenção: offset POSITIVO = o arquivo 2 começa DEPOIS do arquivo 1 → para alinhar,
mova o clipe do arquivo 2 para começar em t=OFFSET na timeline (com clipe 1 em t=0).
"""
import subprocess, sys, tempfile, os

def die(msg, code=1):
    print(f"ERRO: {msg}"); sys.exit(code)

if len(sys.argv) != 3:
    die("uso: sync_cams.py <arquivo1> <arquivo2>")
f1, f2 = sys.argv[1], sys.argv[2]
for f in (f1, f2):
    if not os.path.isfile(f): die(f"arquivo não existe: {f}")

def extract_wav(src, dst):
    # 90s de áudio mono 16k bastam para o MFCC e mantêm o cálculo rápido
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-t", "90",
                        "-vn", "-ac", "1", "-ar", "16000", dst],
                       capture_output=True, text=True)
    if r.returncode != 0: die(f"ffmpeg falhou em {os.path.basename(src)}: {r.stderr[:200]}")

with tempfile.TemporaryDirectory() as td:
    w1, w2 = os.path.join(td, "a1.wav"), os.path.join(td, "a2.wav")
    print(f"extraindo áudio (90s, mono 16k): {os.path.basename(f1)} / {os.path.basename(f2)}")
    extract_wav(f1, w1); extract_wav(f2, w2)

    from audio_offset_finder.audio_offset_finder import find_offset_between_files
    res = find_offset_between_files(w1, w2)
    offset, score = float(res["time_offset"]), float(res["standard_score"])

    print(f"offset bruto: {offset:+.3f}s | confiança (standard score): {score:.1f}")
    if score < 5:
        die(f"confiança {score:.1f} < 5 — áudios podem não ser da mesma cena. NÃO aplicar.", 2)
    if score < 10:
        print("⚠️ confiança entre 5 e 10 — conferir visualmente após aplicar.")

    # find_offset_between_files: offset = quanto o ARQUIVO 2 está adiantado dentro do arquivo 1
    # convenção de saída: positivo → clipe2 começa DEPOIS → posicionar clipe2 em t=offset
    print(f"OFFSET_SECONDS={offset:.3f}  CONFIDENCE={score:.1f}  "
          f"APLICAR=posicionar o clipe do arquivo 2 em t={offset:.3f}s (arquivo 1 em t=0)"
          if offset >= 0 else
          f"OFFSET_SECONDS={offset:.3f}  CONFIDENCE={score:.1f}  "
          f"APLICAR=posicionar o clipe do arquivo 1 em t={abs(offset):.3f}s (arquivo 2 em t=0)")
