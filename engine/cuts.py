#!/usr/bin/env python3
"""cuts.py — cortes por transcript: tempos mortos viram cortes, fala fica (F3).

Transcription-first: os gaps entre PALAVRAS (word timestamps do engine/transcribe.py)
definem os tempos mortos. Regras da especificação do produto codificadas:
- nunca cortar dentro de palavra (por construção — corte só existe entre words);
- pad de segurança nas bordas (default 0,25s, range 30–200ms+ da spec);
- silêncio de RIPPING é conteúdo: --min-gap default 2,5s preserva os ~2s de rip;
- corte só se sobrar ≥0,5s depois dos pads (evita micro-cortes).

Uso:  python3 engine/cuts.py "<transcript .whisper|.corrected .json>"
        [--min-gap 2.5] [--pad 0.25] [--start-at S] [--end-at S] [--name "Seq"] [-o cuts.json]

--margin S é ALIAS de --pad (mesmo comportamento, nome mais claro: margem de
respiro em segundos que cada keep ganha nas bordas). Se ambos forem passados,
--margin vence. Pads nunca geram overlap entre keeps consecutivos: os keeps são
o complemento dos cortes com cursor monotônico + clamp explícito no final.

Saída: cuts JSON p/ engine/fcpxml.py + plano legível. Última linha:
  CUTS_JSON=<path>  KEEP=<n>  CUTS=<n>  REMOVED=<s>  FINAL=<s>
"""
import argparse
import json
import sys
from pathlib import Path


def die(msg, code=1):
    print(f"ERRO: {msg}")
    sys.exit(code)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("transcript")
    ap.add_argument("--min-gap", type=float, default=2.5)
    ap.add_argument("--pad", type=float, default=0.25)
    ap.add_argument("--margin", type=float, default=None,
                    help="alias de --pad (margem de respiro em segundos nas bordas dos keeps)")
    ap.add_argument("--start-at", type=float, default=0.0)
    ap.add_argument("--end-at", type=float, default=None)
    ap.add_argument("--name", default=None)
    ap.add_argument("-o", "--output", default=None)
    args = ap.parse_args()
    if args.margin is not None:
        args.pad = args.margin
    if not 0.03 <= args.pad <= 1.0:
        die("--pad/--margin fora do range são (0.03–1.0s)")

    tpath = Path(args.transcript).expanduser()
    if not tpath.is_file():
        die(f"não existe: {tpath}")
    tr = json.loads(tpath.read_text(encoding="utf-8"))
    master = tr.get("master_path")
    if not master:
        die("transcript sem master_path — gere com engine/transcribe.py")

    words = [w for s in tr["segments"] for w in s.get("words", [])]
    words.sort(key=lambda w: w["start"])
    if not words:
        die("transcript sem words")

    end_bound = args.end_at if args.end_at is not None else float(tr.get("duration", words[-1]["end"]))
    start_bound = args.start_at
    words = [w for w in words if w["end"] > start_bound and w["start"] < end_bound]
    if not words:
        die("nenhuma palavra na janela pedida")

    # gaps entre words (e das bordas) maiores que min_gap viram cortes, com pad
    cuts = []
    def add_cut(a, b):
        a, b = a + args.pad, b - args.pad
        if b - a >= 0.5:
            cuts.append((round(max(a, start_bound), 3), round(min(b, end_bound), 3)))

    if words[0]["start"] - start_bound > args.min_gap:
        add_cut(start_bound - args.pad, words[0]["start"])  # borda inicial: sem pad esquerdo
    for w1, w2 in zip(words, words[1:]):
        gap = w2["start"] - w1["end"]
        if gap > args.min_gap:
            add_cut(w1["end"], w2["start"])
    if end_bound - words[-1]["end"] > args.min_gap:
        add_cut(words[-1]["end"], end_bound + args.pad)  # borda final: sem pad direito

    # keep = complemento dos cortes dentro de [start,end]
    keep, cursor = [], start_bound
    for a, b in cuts:
        if a > cursor:
            keep.append({"in": round(cursor, 3), "out": round(a, 3)})
        cursor = max(cursor, b)
    if end_bound > cursor:
        keep.append({"in": round(cursor, 3), "out": round(end_bound, 3)})

    # clamp: pads NUNCA podem produzir overlap entre keeps consecutivos
    for k1, k2 in zip(keep, keep[1:]):
        if k2["in"] < k1["out"]:
            k2["in"] = k1["out"]
    keep = [k for k in keep if k["out"] > k["in"]]

    removed = sum(b - a for a, b in cuts)
    final = sum(s["out"] - s["in"] for s in keep)
    name = args.name or f"{Path(master).stem} — IA cut v1"
    out = {
        "sequence_name": name,
        "base": {"file": master, "segments": keep},
        "stats": {"window": [start_bound, round(end_bound, 3)], "min_gap": args.min_gap,
                  "pad": args.pad, "cuts": [[a, b] for a, b in cuts],
                  "removed_seconds": round(removed, 1), "final_seconds": round(final, 1)},
    }
    opath = Path(args.output) if args.output else tpath.parent / f"{Path(master).stem}.cuts.json"
    opath.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"PLANO — janela {start_bound:.1f}s→{end_bound:.1f}s de {Path(master).name}:")
    for a, b in cuts:
        print(f"  corte {a:7.1f} → {b:7.1f}  (−{b-a:4.1f}s)")
    print(f"  {len(cuts)} cortes, −{removed:.1f}s | resultado: {final:.1f}s em {len(keep)} segments")
    print(f"CUTS_JSON={opath}  KEEP={len(keep)}  CUTS={len(cuts)}  REMOVED={removed:.1f}  FINAL={final:.1f}")


if __name__ == "__main__":
    main()
