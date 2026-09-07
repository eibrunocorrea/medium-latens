"""workspace.py: workspaces de edição por projeto em USER_DIR/workspaces/<slug>/.

Todo cache derivado de um master vive em workspaces/<slug>/, com manifesto
project.json. Cache key = path+size+mtime do master.
O master NUNCA é tocado. frames/ e renders/ são gitignored (pesados); manifestos e
transcripts são versionados.
"""
import json
import re
import time
import unicodedata
from pathlib import Path

from userpaths import WORKSPACES

ROOT = WORKSPACES


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "projeto"


def slug_for_master(master: Path) -> str:
    """Slug default: nome da pasta do master (ex.: 'SHORTS PKM - BASE SET 2')."""
    parent = master.parent.name
    # Pastas 'Câmera - 01' etc. são subpastas, então sobe um nível.
    if re.match(r"(?i)^c[âa]mera\b", parent) and master.parent.parent.name:
        parent = master.parent.parent.name
    return slugify(parent)


def cache_key(master: Path) -> dict:
    st = master.stat()
    return {"path": str(master), "size": st.st_size, "mtime": int(st.st_mtime)}


def resolve(slug: str) -> Path:
    ws = ROOT / slug
    (ws / "transcript").mkdir(parents=True, exist_ok=True)
    return ws


def load_manifest(ws: Path) -> dict:
    p = ws / "project.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"slug": ws.name, "created": time.strftime("%Y-%m-%d %H:%M:%S"), "masters": {}}


def save_manifest(ws: Path, manifest: dict) -> None:
    manifest["updated"] = time.strftime("%Y-%m-%d %H:%M:%S")
    (ws / "project.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cached_output(ws: Path, master: Path, kind: str) -> Path | None:
    """Devolve o output cacheado de `kind` (ex.: 'transcript') se o master não mudou."""
    m = load_manifest(ws)["masters"].get(master.stem)
    if not m:
        return None
    key, cur = m.get("cache_key", {}), cache_key(master)
    if key.get("size") != cur["size"] or key.get("mtime") != cur["mtime"]:
        return None
    rel = m.get(kind)
    if not rel:
        return None
    out = ws / rel
    return out if out.exists() and out.stat().st_size > 0 else None


def record_output(ws: Path, master: Path, kind: str, out: Path) -> None:
    manifest = load_manifest(ws)
    entry = manifest["masters"].setdefault(master.stem, {})
    entry["cache_key"] = cache_key(master)
    entry[kind] = str(out.relative_to(ws))
    save_manifest(ws, manifest)
