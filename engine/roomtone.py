#!/usr/bin/env python3
"""roomtone.py — room tone extraído do PRÓPRIO master, loopado até a duração alvo.

Corte publicável precisa de room tone sob os cortes (silêncio digital denuncia a
emenda). Em vez de gravar tone à parte: acha o MAIOR trecho de silêncio do master
(ffmpeg silencedetect), extrai esse trecho (com inset de segurança nas bordas) e
loopa (aloop) até a duração pedida. Master NUNCA é tocado — saída vai para:
USER_DIR/workspaces/<slug>/audio/roomtone.wav (48kHz stereo PCM16).

Uso:  python3 engine/roomtone.py "<master>" --duration S
        [--slug X] [--noise -35] [--min-silence 0.8]
Saída (última linha):
  ROOMTONE_WAV=<path>  SOURCE_GAP=<start>-<end>s  DURATION=<s>
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import workspace  # noqa: E402

INSET = 0.1  # segundos aparados de cada borda do gap (respiração/click residual)


def die(msg, code=1):
    print(f"ERRO: {msg}")
    sys.exit(code)


def detect_gaps(master: Path, noise_db: float, min_silence: float):
    """Pares (start, end) de silêncio via ffmpeg silencedetect (lê stderr)."""
    r = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(master), "-vn",
         "-af", f"silencedetect=noise={noise_db}dB:d={min_silence}", "-f", "null", "-"],
        capture_output=True, text=True)
    if r.returncode != 0:
        die(f"ffmpeg silencedetect falhou: {r.stderr[-300:]}")
    starts = [float(m) for m in re.findall(r"silence_start:\s*(-?[\d.]+)", r.stderr)]
    ends = [float(m) for m in re.findall(r"silence_end:\s*(-?[\d.]+)", r.stderr)]
    return list(zip(starts, ends))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("master")
    ap.add_argument("--duration", type=float, required=True, help="duração alvo do roomtone (s)")
    ap.add_argument("--slug", default=None)
    ap.add_argument("--noise", type=float, default=-35.0, help="threshold do silencedetect (dB)")
    ap.add_argument("--min-silence", type=float, default=0.8, help="silêncio mínimo p/ contar (s)")
    args = ap.parse_args()
    if args.duration <= 0:
        die("--duration precisa ser > 0")

    master = Path(args.master).expanduser()
    if not master.is_file():
        die(f"não existe: {master}")

    gaps = detect_gaps(master, args.noise, args.min_silence)
    if not gaps:
        die(f"nenhum silêncio ≥{args.min_silence}s a {args.noise}dB — tente --noise mais alto (ex. -30)")
    g_start, g_end = max(gaps, key=lambda g: g[1] - g[0])
    # inset de segurança nas bordas, se o gap comporta
    if (g_end - g_start) - 2 * INSET >= 0.4:
        g_start, g_end = g_start + INSET, g_end - INSET
    gap_dur = g_end - g_start

    slug = args.slug or workspace.slug_for_master(master)
    ws = workspace.resolve(slug)
    (ws / "audio").mkdir(exist_ok=True)
    out = ws / "audio" / "roomtone.wav"

    # extrai o gap e loopa até a duração alvo em UM ffmpeg (sem temporários):
    # aresample fixa 48kHz antes do aloop; size um pouco menor que o gap garante
    # que o buffer enche e o loop dispara mesmo com arredondamento de samples.
    loop_size = int(max(gap_dur - 0.02, 0.1) * 48000)
    r = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", f"{g_start:.3f}", "-t", f"{gap_dur:.3f}",
         "-i", str(master), "-vn", "-ac", "2",
         "-af", f"aresample=48000,aloop=loop=-1:size={loop_size}",
         "-t", f"{args.duration:.3f}", "-c:a", "pcm_s16le", str(out)],
        capture_output=True, text=True)
    if r.returncode != 0 or not out.is_file() or out.stat().st_size == 0:
        die(f"ffmpeg extração/loop falhou: {r.stderr[-300:]}")

    workspace.record_output(ws, master, "roomtone", out)
    print(f"room tone: gap de {gap_dur:.1f}s ({g_start:.1f}s→{g_end:.1f}s de {master.name}) "
          f"loopado p/ {args.duration:.1f}s → {out}")
    print(f"ROOMTONE_WAV={out}  SOURCE_GAP={g_start:.1f}-{g_end:.1f}s  DURATION={args.duration:.1f}")


if __name__ == "__main__":
    main()
