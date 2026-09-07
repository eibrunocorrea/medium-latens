#!/usr/bin/env python3
"""Shared Gemini 3.1 Flash Lite client (REST, no SDK dep) with key rotation.

Loads all GEMINI_API_KEY* from .env. On 400(expired)/403/429/5xx, rotates to the
next key and retries with backoff. Supports text + inline images + JSON mode.
"""
import base64
import json
import time
import urllib.error
import urllib.request

from userpaths import env_value, env_values
# MEDIUM_LATENS_GEMINI_TEXT_MODEL troca o modelo de texto pelo .env do usuário.
MODEL = "gemini-3.1-flash-lite-preview"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"


def _keys():
    return [value for key, value in env_values().items()
            if key.startswith("GEMINI_API_KEY") and value]


KEYS = _keys()
MODEL = env_value("MEDIUM_LATENS_GEMINI_TEXT_MODEL", MODEL)
_state = {"i": 0}


def generate(prompt, images=None, json_mode=False, temperature=0.2, model=MODEL, max_rotations=None):
    """images: list of (mime, bytes). Returns response text (str)."""
    parts = []
    for mime, raw in (images or []):
        parts.append({"inlineData": {"mimeType": mime, "data": base64.b64encode(raw).decode()}})
    parts.append({"text": prompt})
    body = {"contents": [{"parts": parts}],
            "generationConfig": {"temperature": temperature}}
    if json_mode:
        body["generationConfig"]["responseMimeType"] = "application/json"
    data = json.dumps(body).encode()

    keys = KEYS or _keys()
    if not keys:
        raise SystemExit("nenhuma GEMINI_API_KEY* no .env do usuário")
    n = len(keys)
    rotations = max_rotations or (n * 2)
    last_err = None
    for attempt in range(rotations):
        key = keys[_state["i"] % n]
        url = ENDPOINT.format(model=model, key=key)
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.load(r)
            cand = d.get("candidates", [])
            if not cand:
                last_err = d.get("promptFeedback") or "no candidates"
                _state["i"] += 1
                continue
            return "".join(p.get("text", "") for p in cand[0]["content"]["parts"])
        except urllib.error.HTTPError as e:
            last_err = e.read().decode()[:200]
            if e.code in (400, 401, 403, 429, 500, 503):
                _state["i"] += 1            # rotate key
                time.sleep(min(1.5 * (attempt + 1), 8))
                continue
            raise
        except Exception as e:
            last_err = str(e)
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"gemini failed after {rotations} attempts: {last_err}")


def generate_json(prompt, images=None, temperature=0.2, model=MODEL):
    """Returns parsed JSON (dict/list). Strips ```json fences if present."""
    txt = generate(prompt, images=images, json_mode=True, temperature=temperature, model=model).strip()
    if txt.startswith("```"):
        txt = txt.split("```", 2)[1]
        if txt.startswith("json"):
            txt = txt[4:]
        txt = txt.strip().rstrip("`").strip()
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        # Modelos com raciocínio às vezes anexam dados; extrai o primeiro objeto ou array.
        start = min([i for i in (txt.find("{"), txt.find("[")) if i != -1], default=0)
        return json.JSONDecoder().raw_decode(txt[start:])[0]


if __name__ == "__main__":
    print(f"keys loaded: {len(KEYS)}")
    print(generate("Responda em 3 palavras: o que e Pokemon TCG?"))
