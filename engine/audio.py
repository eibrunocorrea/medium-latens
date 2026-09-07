#!/usr/bin/env python3
"""audio.py — tratamento de áudio broadcast (F3 do research, item 3).

Três subcomandos, todos com saída wav 48 kHz e última linha parseável:

  clean  limpeza de voz: highpass 80 Hz → afftdn (denoise) → deesser →
         acompressor → alimiter -1 dB. Presets leve|medio|forte variam a
         redução de ruído (nr 6/12/20 dB) e a compressão.
         Uso:  python3 engine/audio.py clean "<media>" [--preset medio] [-o out.wav]
         Linha: CLEAN_WAV=<path>  PRESET=<preset>

  duck   sidechain: a MÚSICA é comprimida pela VOZ (sidechaincompress
         threshold=0.03:ratio=8:attack=20:release=400). SEM mixdown — a
         saída é só a música duckada (vai para A3 no Premiere). O ganho
         makeup é derivado de --amount (dB → linear, clamp 1..64).
         Uso:  audio.py duck "<musica>" "<voz>" [-o out.wav] [--amount 12]
         Linha: DUCKED_WAV=<path>

  norm   loudness 2-pass (EBU R128 loudnorm): 1ª passada mede I/TP/LRA/
         thresh (json), 2ª aplica com linear=true e measured_*, 3ª passada
         verifica o LUFS real do arquivo final.
         Uso:  audio.py norm "<media>" [--target -14] [-o out.wav]
         Linha: NORM_WAV=<path>  LUFS_IN=<in>  LUFS_OUT=<out>

Masters nunca são tocados: toda saída é arquivo NOVO (wav). Sem -o, o wav
nasce ao lado da entrada com sufixo (.clean-<preset>.wav / .ducked.wav /
.norm.wav) — prefira apontar -o para USER_DIR/workspaces/<slug>/audio/.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

FFMPEG = "ffmpeg"

# preset -> (afftdn nr em dB, threshold do acompressor em dB, ratio, deesser i)
CLEAN_PRESETS = {
    "leve":  {"nr": 6,  "comp_thresh_db": -16.0, "comp_ratio": 2.0, "deess_i": 0.05},
    "medio": {"nr": 12, "comp_thresh_db": -18.0, "comp_ratio": 3.0, "deess_i": 0.10},
    "forte": {"nr": 20, "comp_thresh_db": -20.0, "comp_ratio": 4.0, "deess_i": 0.15},
}


def db_to_lin(db: float) -> float:
    return 10.0 ** (db / 20.0)


def run_ffmpeg(args: list, capture: bool = False) -> str:
    """Roda ffmpeg; falha aborta com o stderr. Retorna stderr se capture."""
    cmd = [FFMPEG, "-hide_banner", "-nostdin", "-y"] + args
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        sys.exit(f"ffmpeg falhou (exit {proc.returncode}): {' '.join(cmd)}")
    return proc.stderr if capture else ""


def out_path(inp: Path, explicit: str, suffix: str) -> Path:
    if explicit:
        p = Path(explicit).expanduser().resolve()
    else:
        p = inp.with_name(f"{inp.stem}{suffix}.wav")
    if p.resolve() == inp.resolve():
        sys.exit("saída não pode sobrescrever a entrada (masters são intocados)")
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def require(path_str: str, label: str) -> Path:
    p = Path(path_str).expanduser()
    if not p.is_file():
        sys.exit(f"{label} não encontrado: {p}")
    return p


# ---------------------------------------------------------------- clean

def cmd_clean(args) -> None:
    inp = require(args.media, "media")
    out = out_path(inp, args.output, f".clean-{args.preset}")
    p = CLEAN_PRESETS[args.preset]
    chain = ",".join([
        "highpass=f=80",
        f"afftdn=nr={p['nr']}",
        f"deesser=i={p['deess_i']}",
        (
            f"acompressor=threshold={db_to_lin(p['comp_thresh_db']):.6f}"
            f":ratio={p['comp_ratio']}:attack=5:release=120"
        ),
        f"alimiter=limit={db_to_lin(-1.0):.6f}",  # -1 dBFS
    ])
    run_ffmpeg([
        "-i", str(inp), "-vn", "-af", chain,
        "-ar", "48000", "-c:a", "pcm_s24le", str(out),
    ])
    print(f"CLEAN_WAV={out} PRESET={args.preset}")


# ----------------------------------------------------------------- duck

def cmd_duck(args) -> None:
    music = require(args.musica, "musica")
    voice = require(args.voz, "voz")
    out = out_path(music, args.output, ".ducked")
    makeup = min(max(db_to_lin(args.amount), 1.0), 64.0)
    fc = (
        "[0:a][1:a]sidechaincompress="
        "threshold=0.03:ratio=8:attack=20:release=400"
        f":makeup={makeup:.6f}[ducked]"
    )
    run_ffmpeg([
        "-i", str(music), "-i", str(voice),
        "-filter_complex", fc, "-map", "[ducked]",
        "-ar", "48000", "-c:a", "pcm_s24le", str(out),
    ])
    print(f"DUCKED_WAV={out}")


# ----------------------------------------------------------------- norm

LOUDNORM_KEYS = ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")


def measure_loudnorm(media: Path, target: float) -> dict:
    """Passada de medição: loudnorm print_format=json sobre -f null."""
    stderr = run_ffmpeg([
        "-i", str(media), "-vn",
        "-af", f"loudnorm=I={target}:TP=-1.5:LRA=11:print_format=json",
        "-f", "null", "-",
    ], capture=True)
    blocks = re.findall(r"\{[^{}]*\}", stderr, flags=re.DOTALL)
    for block in reversed(blocks):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        if "input_i" in data:
            return data
    sys.exit("não achei o json do loudnorm na medição")


def cmd_norm(args) -> None:
    inp = require(args.media, "media")
    out = out_path(inp, args.output, ".norm")
    target = args.target

    m = measure_loudnorm(inp, target)  # 1ª passada: mede
    missing = [k for k in LOUDNORM_KEYS if k not in m]
    if missing:
        sys.exit(f"medição loudnorm incompleta, faltam: {missing}")

    second = (
        f"loudnorm=I={target}:TP=-1.5:LRA=11"
        f":measured_I={m['input_i']}:measured_TP={m['input_tp']}"
        f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}"
        f":offset={m['target_offset']}:linear=true:print_format=json"
    )
    run_ffmpeg([  # 2ª passada: aplica
        "-i", str(inp), "-vn", "-af", second,
        "-ar", "48000", "-c:a", "pcm_s24le", str(out),
    ])

    check = measure_loudnorm(out, target)  # 3ª passada: verifica o real
    print(f"NORM_WAV={out} LUFS_IN={m['input_i']} LUFS_OUT={check['input_i']}")


# ------------------------------------------------------------------ cli

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("clean", help="limpeza broadcast de voz")
    c.add_argument("media")
    c.add_argument("--preset", choices=sorted(CLEAN_PRESETS), default="medio")
    c.add_argument("-o", "--output", default="")
    c.set_defaults(fn=cmd_clean)

    d = sub.add_parser("duck", help="sidechain: música duckada pela voz (sem mixdown)")
    d.add_argument("musica")
    d.add_argument("voz")
    d.add_argument("--amount", type=float, default=12.0, help="makeup em dB (default 12)")
    d.add_argument("-o", "--output", default="")
    d.set_defaults(fn=cmd_duck)

    n = sub.add_parser("norm", help="loudnorm 2-pass EBU R128")
    n.add_argument("media")
    n.add_argument("--target", type=float, default=-14.0, help="LUFS alvo (default -14)")
    n.add_argument("-o", "--output", default="")
    n.set_defaults(fn=cmd_norm)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
