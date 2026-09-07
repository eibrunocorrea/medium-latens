#!/usr/bin/env python3
"""correct.py: corrige termos mal transcritos (Gemini) preservando timestamps.

Port do validado scripts/05-correct-transcript.py para o workspace da F2:
entrada = um .whisper.json do engine/transcribe.py; saída = <stem>.corrected.json
ao lado, com text_original/text_corrected por segment + lista de corrections.
Reusa engine/gemini_client.py (rotação multi-key) e o glossário TCG opcional do
usuário. Nunca parafraseia; words/timestamps intocados.

Uso: python3 engine/correct.py "<transcript.whisper.json>" [--context "..."] [--force]
Saída (última linha): CORRECTED_JSON=<path>  CORRECTIONS=<n>
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gemini_client as gem  # noqa: E402
from userpaths import USER_DIR  # noqa: E402

GLOSSARY = USER_DIR / "tcg-glossary.json"
BATCH = 40

PROMPT = """Você corrige uma transcrição automática (Whisper, PT-BR) de uma GRAVAÇÃO BRUTA de unboxing/abertura de cartas Pokémon TCG do usuário.

CONTEXTO DA GRAVAÇÃO: {context}
Termos canônicos conhecidos (DICAS, não é lista exaustiva): {gloss}

TAREFA: Corrija QUALQUER termo mal transcrito: nomes de Pokémon, nomes de cartas, nomes de coleções/sets, jargão de TCG (booster, ETB, alt art, full art, holo, PSA, god pack, VMAX...), marcas, nomes de pessoas, lugares, produtos e números de carta. Use as dicas do glossário E seu conhecimento de Pokémon TCG.

REGRAS RÍGIDAS
- NÃO parafraseie, NÃO mude gramática, NÃO altere o sentido, NÃO remova hesitações/fillers, NÃO junte nem divida segmentos.
- Corrija APENAS entidades nomeadas / termos de domínio mal transcritos.
- Se o segmento não tem erro, devolva o texto IDÊNTICO.

SEGMENTOS (índice: texto)
{segs}

Responda só com JSON:
{{"segments":[{{"i":<int>,"text":"<texto corrigido>"}}], "corrections":[{{"from":"<errado>","to":"<certo>","reason":"<curto>"}}]}}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("transcript")
    ap.add_argument("--context", default="abertura de boosters/produtos ao vivo, multicam")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    tpath = Path(args.transcript).expanduser()
    if not tpath.is_file():
        print(f"ERRO: transcript não existe: {tpath}")
        sys.exit(1)
    out = tpath.with_name(tpath.name.replace(".whisper.json", "") + ".corrected.json")
    if out.exists() and out.stat().st_size > 0 and not args.force:
        j = json.loads(out.read_text(encoding="utf-8"))
        print(f"cache HIT: já corrigido ({len(j.get('corrections', []))} corrections)")
        print(f"CORRECTED_JSON={out}  CORRECTIONS={len(j.get('corrections', []))}  CACHED=1")
        return

    gloss_hint = ""
    if GLOSSARY.exists():
        try:
            glossary = json.loads(GLOSSARY.read_text(encoding="utf-8"))
            canonical_terms = glossary.get("canonical_terms", []) if isinstance(glossary, dict) else []
            if isinstance(canonical_terms, list):
                gloss_hint = ", ".join(
                    term for term in canonical_terms if isinstance(term, str))
        except (OSError, json.JSONDecodeError, KeyError):
            pass

    tr = json.loads(tpath.read_text(encoding="utf-8"))
    segs = tr["segments"]
    corrected_text, all_corrections = {}, []

    for i0 in range(0, len(segs), BATCH):
        batch = segs[i0:i0 + BATCH]
        seg_lines = "\n".join(f"{i0+j}: {s['text'].strip()}" for j, s in enumerate(batch))
        print(f"batch {i0}-{i0+len(batch)-1}…", flush=True)
        try:
            res = gem.generate_json(PROMPT.format(context=args.context, gloss=gloss_hint, segs=seg_lines))
        except Exception as e:
            for j, s in enumerate(batch):  # falhou o batch → mantém originais
                corrected_text[i0 + j] = s["text"]
            all_corrections.append({"from": "", "to": "", "reason": f"batch {i0} failed: {e}"[:120]})
            continue
        for item in res.get("segments", []):
            corrected_text[item["i"]] = item["text"]
        all_corrections.extend(res.get("corrections", []))

    out_segs = [{
        "start": s["start"], "end": s["end"],
        "text_original": s["text"],
        "text_corrected": corrected_text.get(idx, s["text"]),
        "words": s.get("words", []),
    } for idx, s in enumerate(segs)]
    real_corr = [c for c in all_corrections if c.get("from") and c.get("to")]

    out.write_text(json.dumps({
        "file": tr.get("file"), "master_path": tr.get("master_path"),
        "duration": tr.get("duration"), "language": tr.get("language", "pt"),
        "segments": out_segs, "corrections": real_corr,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"OK: {len(out_segs)} segments, {len(real_corr)} corrections")
    for c in real_corr[:8]:
        print(f"  {c['from']!r} → {c['to']!r} ({c.get('reason', '')})")
    print(f"CORRECTED_JSON={out}  CORRECTIONS={len(real_corr)}  CACHED=0")


if __name__ == "__main__":
    main()
