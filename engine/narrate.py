#!/usr/bin/env python3
"""narrate.py: narração empolgada para eventos de carta do usuário.

Uso:
    python3 engine/narrate.py "<cards.json>" [--style empolgado] [--voice VOZ]
                              [--model eleven_flash_v2_5]

cards.json: lista de eventos [{"t_start"|"t": s, "card": str, "foil": bool,
"rarity": str?}]. Gera 1-2 frases PT-BR por evento no estilo do usuário,
guiado pelo perfil editorial opcional em USER_DIR/perfil-narracao.md, via Gemini
(engine/gemini_client.generate_json, batch única), com
audio tags do Eleven v3 inline ([excited], [laughs], [whispers], ...).

TTS por frase via node genai/voice.mjs. Se eleven_v3 falhar com a voz
configurada pelo usuário, cai para eleven_multilingual_v2 SEM tags e registra em issues.

Saída: workspaces/<slug>/vo/NNN.mp3 + workspaces/<slug>/vo-manifest.json
    {"events": [{"t_start", "text", "file", "duration"}], ...}
Última linha do stdout: VO_MANIFEST=<path> LINES=<n>
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE))
import gemini_client  # noqa: E402

import workspace  # noqa: E402
from userpaths import PERFIL_NARRACAO  # noqa: E402

VOICE_MJS = Path(__file__).resolve().parent.parent / "genai" / "voice.mjs"
PROFILE = PERFIL_NARRACAO
FALLBACK_MODEL = "eleven_multilingual_v2"
TAG_RE = re.compile(r"\[[^\[\]]{1,40}\]\s*")


def load_events(cards_json: Path) -> list[dict]:
    data = json.loads(cards_json.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("events") or data.get("cards") or []
    events = []
    for i, e in enumerate(data):
        t = e.get("t_start", e.get("t"))
        card = e.get("card")
        if t is None or not card:
            raise SystemExit(f"evento {i} inválido (precisa de t_start/t e card): {e}")
        events.append({"t_start": float(t), "card": str(card),
                       "foil": bool(e.get("foil", False)),
                       "rarity": str(e.get("rarity", "") or "")})
    if not events:
        raise SystemExit(f"nenhum evento em {cards_json}")
    return sorted(events, key=lambda e: e["t_start"])


def slug_for(cards_json: Path) -> str:
    """Se o json já vive em workspaces/<slug>/, usa esse slug; senão, slug do nome."""
    try:
        rel = cards_json.resolve().relative_to(workspace.ROOT)
        return rel.parts[0]
    except ValueError:
        return workspace.slugify(cards_json.stem)


def build_prompt(events: list[dict], style: str) -> str:
    profile_section = ""
    if PROFILE.exists():
        profile = PROFILE.read_text(encoding="utf-8")
        profile_section = f"""Perfil e lei editorial do usuário (OBRIGATÓRIO respeitar):

--- PERFIL ---
{profile}
--- FIM DO PERFIL ---

"""
    return f"""Você escreve a narração em PT-BR do usuário para um vídeo de abertura de \
cartas TCG (Pokémon).

{profile_section}TAREFA: para cada evento abaixo (momento em que uma carta é revelada), escreva 1-2 frases \
curtas de narração faladas pelo usuário, estilo "{style}".

REGRAS:
1. Empolgação PROPORCIONAL à raridade (lei editorial: zero hype falso). Carta comum \
(foil=false, sem raridade) = tom casual/carinhoso, curiosidade, talvez um comentário \
afetuoso ou uma piada leve. Foil ou rara = explosão GENUÍNA de empolgação.
2. Verdade primeiro: nada de promessa financeira, valor de mercado inventado ou "essa \
carta vale ouro". Nunca fabricar fatos sobre a carta.
3. Fale o NOME da carta exatamente como dado no evento.
4. Use audio tags do ElevenLabs Eleven v3 inline no texto: palavras em inglês, minúsculas, \
entre colchetes, posicionadas antes do trecho que afetam. Exemplos válidos: [excited], \
[laughs], [whispers], [gasps], [sighs], [curious], [pause]. Use 1-2 tags por evento em \
cartas foil/raras (ex.: "[excited] NÃO ACREDITO! Wigglytuff FOIL!"), 0-1 tag discreta em \
comuns. As tags não são faladas; só dirigem a entrega.
5. PT-BR casual com gíria natural de TCG, uma ideia por frase, zero enrolação, sem bordão \
de locutor de anúncio.

EVENTOS (JSON):
{json.dumps(events, ensure_ascii=False, indent=2)}

SAÍDA: APENAS um array JSON, mesma ordem dos eventos, formato:
[{{"t_start": <número do evento>, "text": "<frase(s) com as tags>"}}]"""


def gen_lines(events: list[dict], style: str) -> list[dict]:
    out = gemini_client.generate_json(build_prompt(events, style), temperature=0.7)
    if not isinstance(out, list) or len(out) != len(events):
        raise SystemExit(f"gemini devolveu formato inesperado ({type(out).__name__}, "
                         f"{len(out) if isinstance(out, list) else '?'} itens p/ {len(events)} eventos)")
    lines = []
    for ev, item in zip(events, out):
        text = str(item.get("text", "")).strip()
        if not text:
            raise SystemExit(f"gemini devolveu texto vazio p/ t={ev['t_start']}")
        lines.append({"t_start": ev["t_start"], "text": text})
    return lines


def strip_tags(text: str) -> str:
    return re.sub(r"\s{2,}", " ", TAG_RE.sub("", text)).strip()


def tts(text: str, voice: str, model: str, out: Path, issues: list[str], t: float) -> str:
    """Gera o mp3; devolve o modelo efetivamente usado. Fallback sem tags se v3 falhar."""
    def run(txt: str, mdl: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["node", str(VOICE_MJS), txt if mdl == "eleven_v3" else strip_tags(txt),
             "--voice", voice, "--model", mdl, "-o", str(out)],
            capture_output=True, text=True, timeout=300)

    r = run(text, model)
    if r.returncode == 0 and out.exists() and out.stat().st_size > 0:
        return model
    if model != FALLBACK_MODEL:
        err = (r.stderr or r.stdout).strip().splitlines()
        issues.append(f"t={t:g}: {model} falhou ({err[-1] if err else 'sem detalhe'}); "
                      f"fallback {FALLBACK_MODEL} sem tags")
        r = run(text, FALLBACK_MODEL)
        if r.returncode == 0 and out.exists() and out.stat().st_size > 0:
            return FALLBACK_MODEL
    raise SystemExit(f"TTS falhou p/ t={t:g}: {(r.stderr or r.stdout).strip()[:300]}")


def duration_of(mp3: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(mp3)], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        raise SystemExit(f"ffprobe falhou p/ {mp3}: {r.stderr.strip()[:200]}")
    return round(float(r.stdout.strip()), 3)


def main() -> None:
    ap = argparse.ArgumentParser(description="Narração de eventos de carta do usuário")
    ap.add_argument("cards_json")
    ap.add_argument("--style", default="empolgado")
    ap.add_argument("--voice", default="principal")
    ap.add_argument("--model", default="eleven_flash_v2_5",  # v3 pode soar artificial em algumas vozes
    
                    choices=["eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"])
    args = ap.parse_args()

    cards_json = Path(args.cards_json).expanduser()
    if not cards_json.exists():
        raise SystemExit(f"não achei {cards_json}")
    events = load_events(cards_json)
    slug = slug_for(cards_json)
    ws = workspace.resolve(slug)
    vo_dir = ws / "vo"
    vo_dir.mkdir(parents=True, exist_ok=True)

    print(f"[narrate] {len(events)} eventos → workspaces/{slug}/vo/ (style={args.style}, "
          f"voice={args.voice}, model={args.model})")
    lines = gen_lines(events, args.style)
    for ln in lines:
        print(f"  t={ln['t_start']:g}: {ln['text']}")

    issues: list[str] = []
    manifest_events = []
    models_used = set()
    for i, ln in enumerate(lines, 1):
        out = vo_dir / f"{i:03d}.mp3"
        used = tts(ln["text"], args.voice, args.model, out, issues, ln["t_start"])
        models_used.add(used)
        text_spoken = ln["text"] if used == "eleven_v3" else strip_tags(ln["text"])
        dur = duration_of(out)
        print(f"  [{i:03d}] {out.name} model={used} dur={dur}s")
        manifest_events.append({"t_start": ln["t_start"], "text": text_spoken,
                                "file": f"vo/{out.name}", "duration": dur})

    manifest_path = ws / "vo-manifest.json"
    manifest = {"events": manifest_events, "style": args.style, "voice": args.voice,
                "model": sorted(models_used)[0] if len(models_used) == 1 else sorted(models_used),
                "source": str(cards_json), "issues": issues}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")
    for iss in issues:
        print(f"  [issue] {iss}")
    print(f"VO_MANIFEST={manifest_path} LINES={len(manifest_events)}")


if __name__ == "__main__":
    main()
