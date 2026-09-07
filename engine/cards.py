#!/usr/bin/env python3
"""cards.py: detecta cada carta revelada num master de unboxing TCG por visão (Gemini).

Fluxo: ffmpeg extrai frames em timestamps explícitos (scale 720px, jpeg q=5),
engine/gemini_client.py processa batches e o módulo agrupa frames
consecutivos com a mesma carta em eventos {t_start, t_end, card, foil, rarity,
confidence}. Nomes validados (fuzzy leve) contra o glossário TCG opcional.
O master NUNCA é tocado; frames cacheados em workspaces/<slug>/frames/cards/.

Uso:
  python3 engine/cards.py "<master>" \
      [--start S] [--end S] [--fps 0.5] [--slug X] [--model M] [--batch 5] [--force]

Saída (última linha): CARDS_JSON=<path> EVENTS=<n>
"""
import argparse
import difflib
import json
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gemini_client as gem  # noqa: E402
import workspace as ws  # noqa: E402
from userpaths import USER_DIR  # noqa: E402

GLOSSARY = USER_DIR / "tcg-glossary.json"
# probe 2026-07-25 (regra model-selection): gemini-3.6-flash = flash de visão
# mais capaz disponível na conta; lite fica p/ texto (correct.py).
# MEDIUM_LATENS_GEMINI_VISION_MODEL troca o modelo de visão pelo .env do usuário.
MODEL = gem.env_value("MEDIUM_LATENS_GEMINI_VISION_MODEL", "gemini-3.6-flash")
MIN_CONF = 0.5
FUZZY_CUTOFF = 0.87  # alto de propósito: Pidgey×Pidgeot ~0.77 NÃO pode colar

PROMPT = """Você analisa frames de uma gravação de unboxing de cartas Pokémon TCG do usuário (câmera zenital, vista de cima da mesa).

Recebeu {n} frames, na ordem, com estes timestamps (segundos no master):
{ts_lines}

TAREFA: para CADA frame, diga se há UMA carta Pokémon CLARAMENTE visível/em destaque (na mão, sendo mostrada à câmera ou isolada sobre a mesa) e identifique:
- name: nome do Pokémon/carta como impresso (ex.: "Wigglytuff ex", "Machop"). null se ilegível ou sem carta em destaque.
- foil: true se a carta é foil/holográfica (brilho, reflexo metálico), senão false.
- rarity: raridade aparente ("common", "uncommon", "rare", "holo rare", "ex", "full art", "special illustration rare", ...). null se incerto.
- confidence: 0-1, sua confiança na identificação do NOME.

REGRAS
- Booster fechado, embalagem, mão vazia, pilha de cartas viradas para baixo ou carta de costas → card_visible=false.
- Várias cartas espalhadas sem nenhuma em destaque → card_visible=false.
- Só dê name se conseguir ler/reconhecer a arte; NUNCA chute nome de carta que não dá para identificar (nesse caso name=null e confidence baixa).

Responda só com JSON:
{{"frames":[{{"i":<int 0-based>,"card_visible":<bool>,"name":<str|null>,"foil":<bool>,"rarity":<str|null>,"confidence":<float>}}]}}"""


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True)
    return float(json.loads(out.stdout)["format"]["duration"])


def extract_frame(master: Path, t: float, out: Path) -> bool:
    """Extrai UM frame no timestamp explícito t (720px, jpeg q=5). Cache por arquivo."""
    if out.exists() and out.stat().st_size > 0:
        return True
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(master),
         "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "5", "-y", str(out)],
        capture_output=True, text=True)
    return r.returncode == 0 and out.exists() and out.stat().st_size > 0


def load_glossary_names() -> list[str]:
    if not GLOSSARY.exists():
        return []
    try:
        g = json.loads(GLOSSARY.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(g, dict):
        return []
    pokemon = g.get("pokemon", [])
    canonical_terms = g.get("canonical_terms", [])
    if not isinstance(pokemon, list):
        pokemon = []
    if not isinstance(canonical_terms, list):
        canonical_terms = []
    names, seen = [], set()
    for n in pokemon + canonical_terms:
        if not isinstance(n, str):
            continue
        if n.casefold() not in seen:
            seen.add(n.casefold())
            names.append(n)
    return names


def validate_name(name: str, gloss: list[str]) -> tuple[str, bool]:
    """Fuzzy leve: canonicaliza cada palavra do nome contra o glossário quando o
    match é forte (>= FUZZY_CUTOFF). Nunca descarta; devolve (nome, matched?)."""
    if not gloss:
        return name, False
    low = {g.casefold(): g for g in gloss}
    words, matched = [], False
    for w in name.split():
        wl = w.casefold()
        if wl in low:
            words.append(low[wl])
            matched = True
            continue
        close = difflib.get_close_matches(wl, list(low), n=1, cutoff=FUZZY_CUTOFF)
        if close:
            words.append(low[close[0]])
            matched = True
        else:
            words.append(w)
    return " ".join(words), matched


def detect_batches(frames: list[dict], batch: int, model: str) -> list[dict]:
    """frames: [{t, path}] → devolve detections por frame (mesma ordem)."""
    detections = [None] * len(frames)
    for i0 in range(0, len(frames), batch):
        chunk = frames[i0:i0 + batch]
        ts_lines = "\n".join(f"frame {j}: t={f['t']:.1f}s" for j, f in enumerate(chunk))
        images = [("image/jpeg", Path(f["path"]).read_bytes()) for f in chunk]
        print(f"batch {i0}-{i0 + len(chunk) - 1} "
              f"(t={chunk[0]['t']:.0f}-{chunk[-1]['t']:.0f}s)…", flush=True)
        try:
            res = gem.generate_json(
                PROMPT.format(n=len(chunk), ts_lines=ts_lines),
                images=images, model=model)
        except Exception as e:
            print(f"  batch falhou (mantendo frames sem detecção): {e}", file=sys.stderr)
            continue
        for item in res.get("frames", []):
            j = item.get("i")
            if isinstance(j, int) and 0 <= j < len(chunk):
                detections[i0 + j] = item
    return detections


def merge_events(frames: list[dict], detections: list[dict],
                 gloss: list[str], step: float) -> list[dict]:
    """Frames consecutivos (tolerância de 1 sample perdido) com a mesma carta → evento."""
    hits = []
    for f, d in zip(frames, detections):
        if not d or not d.get("card_visible") or not d.get("name"):
            continue
        conf = float(d.get("confidence") or 0)
        if conf < MIN_CONF:
            continue
        name, matched = validate_name(str(d["name"]).strip(), gloss)
        hits.append({"t": f["t"], "card": name, "key": name.casefold(),
                     "foil": bool(d.get("foil")), "rarity": d.get("rarity"),
                     "confidence": conf, "glossary_match": matched})

    events, cur = [], None
    gap = 2 * step + 0.01  # ponte de 1 sample perdido
    for h in hits:
        if cur and h["key"] == cur["key"] and h["t"] - cur["_last_t"] <= gap:
            cur["_last_t"] = h["t"]
            cur["_frames"].append(h)
        else:
            if cur:
                events.append(cur)
            cur = {"key": h["key"], "_last_t": h["t"], "_frames": [h]}
    if cur:
        events.append(cur)

    out = []
    for ev in events:
        fs = ev["_frames"]
        rarities = Counter(f["rarity"] for f in fs if f.get("rarity"))
        out.append({
            "t_start": round(fs[0]["t"], 2),
            "t_end": round(fs[-1]["t"], 2),
            "card": Counter(f["card"] for f in fs).most_common(1)[0][0],
            "foil": sum(f["foil"] for f in fs) * 2 >= len(fs),
            "rarity": rarities.most_common(1)[0][0] if rarities else None,
            "confidence": round(max(f["confidence"] for f in fs), 2),
            "frames": len(fs),
            "glossary_match": any(f["glossary_match"] for f in fs),
        })
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("master", help="path do master (NUNCA é modificado)")
    ap.add_argument("--start", type=float, default=0.0, help="janela: início (s)")
    ap.add_argument("--end", type=float, default=None, help="janela: fim (s, default: duração)")
    ap.add_argument("--fps", type=float, default=0.5, help="amostragem (default 0.5)")
    ap.add_argument("--slug", default=None, help="workspace slug (default: pasta do master)")
    ap.add_argument("--model", default=MODEL, help=f"modelo Gemini (default {MODEL})")
    ap.add_argument("--batch", type=int, default=5, help="frames por chamada (default 5)")
    ap.add_argument("--force", action="store_true", help="ignora cards.json cacheado")
    args = ap.parse_args()

    master = Path(args.master).expanduser()
    if not master.is_file():
        print(f"ERRO: master não existe: {master}", file=sys.stderr)
        sys.exit(1)
    end = args.end if args.end is not None else probe_duration(master)
    if end <= args.start:
        print("ERRO: --end deve ser > --start", file=sys.stderr)
        sys.exit(1)

    slug = args.slug or ws.slug_for_master(master)
    wdir = ws.resolve(slug)
    out_path = wdir / "cards.json"
    params = {"master": master.stem, "start": args.start, "end": round(end, 3),
              "fps": args.fps, "model": args.model}

    if out_path.exists() and not args.force:
        try:
            old = json.loads(out_path.read_text(encoding="utf-8"))
            if (old.get("params") == params
                    and old.get("cache_key") == ws.cache_key(master)):
                n = len(old.get("events", []))
                print(f"cache HIT: {n} eventos já detectados")
                print(f"CARDS_JSON={out_path} EVENTS={n}")
                return
        except Exception:
            pass

    # 1) frames em timestamps explícitos
    fdir = wdir / "frames" / "cards" / master.stem
    fdir.mkdir(parents=True, exist_ok=True)
    step = 1.0 / args.fps
    frames, t = [], args.start
    while t < end:
        fp = fdir / f"t{t:08.2f}.jpg"
        if extract_frame(master, t, fp):
            frames.append({"t": round(t, 2), "path": str(fp)})
        else:
            print(f"  frame t={t:.2f}s falhou na extração; pulado", file=sys.stderr)
        t += step
    print(f"{len(frames)} frames extraídos em {fdir.relative_to(wdir)} "
          f"(janela {args.start:.0f}-{end:.0f}s, fps {args.fps})")
    if not frames:
        print("ERRO: nenhum frame extraído", file=sys.stderr)
        sys.exit(1)

    # 2) visão em batches + 3) merge em eventos
    gloss = load_glossary_names()
    detections = detect_batches(frames, max(1, args.batch), args.model)
    events = merge_events(frames, detections, gloss, step)

    payload = {
        "master_path": str(master),
        "slug": slug,
        "params": params,
        "cache_key": ws.cache_key(master),
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "frames_analyzed": len(frames),
        "frames_detected": sum(1 for d in detections if d and d.get("card_visible")),
        "min_confidence": MIN_CONF,
        "events": events,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n",
                        encoding="utf-8")
    ws.record_output(wdir, master, "cards", out_path)

    print(f"OK: {len(events)} eventos de carta")
    for ev in events:
        flags = ("foil " if ev["foil"] else "") + (ev["rarity"] or "")
        print(f"  {ev['t_start']:7.1f}-{ev['t_end']:7.1f}s  {ev['card']}"
              f"  [{flags.strip()}]  conf={ev['confidence']:.2f}  x{ev['frames']}")
    print(f"CARDS_JSON={out_path} EVENTS={len(events)}")


if __name__ == "__main__":
    main()
