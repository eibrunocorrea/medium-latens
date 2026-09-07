#!/usr/bin/env python3
"""adobe_transcript.py — converte nosso transcript p/ o Premiere (Text panel + SRT).

Gera, a partir de um .corrected.json (preferido) ou .whisper.json do workspace:
  1. <stem>.adobe-transcript.json — spec oficial Adobe v1.0.0 (validado contra
     schemas/adobe-transcript-v1.0.0.schema.json). Import no Premiere (1 clique):
     Source Monitor com o CLIP do master aberto → painel Text → aba Transcript →
     menu "…" → Import > Import static transcript → escolher este arquivo.
     (Automação total só via UXP — melhoria futura registrada no README.)
  2. <stem>.srt — legendas sentence-level; 100% automatizável via bridge:
     importFiles([srt]) + activeSequence.createCaptionTrack(item, 0).

Uso:  python3 engine/adobe_transcript.py "<transcript .corrected|.whisper .json>"
Saída (última linha): ADOBE_JSON=<path>  SRT=<path>  SEGMENTS=<n>  VALID=<1|0>
"""
import json
import sys
import uuid
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent / "schemas" / "adobe-transcript-v1.0.0.schema.json"
SPEAKER_NAME = "Locutor"
EOS_CHARS = ".?!…"


def die(msg, code=1):
    print(f"ERRO: {msg}")
    sys.exit(code)


def seg_text(seg):
    return (seg.get("text_corrected") or seg.get("text") or "").strip()


def seg_words(seg):
    """Words com timing do Whisper; se o texto corrigido tiver o MESMO nº de tokens,
    usa as palavras corrigidas (ganha entidades certas sem perder timing)."""
    words = seg.get("words", [])
    fixed = seg_text(seg).split()
    texts = [w["word"].strip() for w in words]
    if seg.get("text_corrected") and len(fixed) == len(texts):
        texts = fixed
    return words, texts


def srt_ts(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    if len(sys.argv) != 2:
        die("uso: adobe_transcript.py <transcript.json>")
    tpath = Path(sys.argv[1]).expanduser()
    if not tpath.is_file():
        die(f"não existe: {tpath}")
    tr = json.loads(tpath.read_text(encoding="utf-8"))
    segs = [s for s in tr["segments"] if s.get("words")]
    if not segs:
        die("transcript sem words — rode engine/transcribe.py primeiro")

    stem = tpath.name.replace(".corrected.json", "").replace(".whisper.json", "")
    out_json = tpath.parent / f"{stem}.adobe-transcript.json"
    out_srt = tpath.parent / f"{stem}.srt"
    speaker_id = str(uuid.uuid4())

    # --- spec Adobe v1.0.0 (additionalProperties:false em tudo — só os campos exatos) ---
    a_segments = []
    for seg in segs:
        words, texts = seg_words(seg)
        a_words = []
        for w, text in zip(words, texts):
            text = text.strip()
            if not text:
                continue
            start, end = float(w["start"]), float(w["end"])
            a_words.append({
                "text": text,
                "start": round(start, 3),
                "duration": round(max(0.0, end - start), 3),
                "confidence": round(min(1.0, max(0.0, float(w.get("probability", 1.0)))), 3),
                "eos": text[-1] in EOS_CHARS,
                "tags": [],
                "type": "word",
            })
        if not a_words:
            continue
        a_words[-1]["eos"] = True  # fim de segment fecha sentença
        seg_start = a_words[0]["start"]
        seg_end = a_words[-1]["start"] + a_words[-1]["duration"]
        a_segments.append({
            "start": seg_start,
            "duration": round(max(0.0, seg_end - seg_start), 3),
            "language": "pt-br",
            "speaker": speaker_id,
            "words": a_words,
        })
    doc = {"language": "pt-br",
           "speakers": [{"id": speaker_id, "name": SPEAKER_NAME}],
           "segments": a_segments}

    valid = 0
    try:
        import jsonschema
        jsonschema.validate(doc, json.loads(SCHEMA.read_text(encoding="utf-8")))
        valid = 1
        print("validação contra o schema oficial Adobe: OK")
    except Exception as e:
        print(f"⚠️ validação falhou: {str(e)[:300]}")
    out_json.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    # --- SRT sentence-level (texto corrigido) ---
    lines = []
    for n, seg in enumerate(segs, 1):
        start, end = float(seg["start"]), float(seg["end"])
        lines.append(f"{n}\n{srt_ts(start)} --> {srt_ts(end)}\n{seg_text(seg)}\n")
    out_srt.write_text("\n".join(lines), encoding="utf-8")

    print(f"Import no Premiere (1 clique): Source Monitor com o clip aberto → Text → "
          f"Transcript → … → Import > Import static transcript → {out_json.name}")
    print(f"ADOBE_JSON={out_json}  SRT={out_srt}  SEGMENTS={len(a_segments)}  VALID={valid}")


if __name__ == "__main__":
    main()
