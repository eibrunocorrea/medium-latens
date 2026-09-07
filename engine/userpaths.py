"""Raiz de estado do usuário, espelhando lib/paths.js do lado Node."""
import os
from pathlib import Path


def user_dir() -> Path:
    env = os.environ.get("MEDIUM_LATENS_USER_DIR")
    if env:
        return Path(env)
    if os.name == "nt":
        base = os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming")
        return Path(base) / "Medium Latens"
    return Path.home() / ".medium-latens"


USER_DIR = user_dir()
WORKSPACES = USER_DIR / "workspaces"
HOTWORDS = USER_DIR / "hotwords.txt"
ENV_FILE = USER_DIR / ".env"

PERFIL_NARRACAO = USER_DIR / "perfil-narracao.md"


def env_values() -> dict[str, str]:
    values = {}
    if ENV_FILE.exists():
        for raw_line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            key, separator, value = raw_line.strip().partition("=")
            if separator and key and not key.startswith("#"):
                values[key] = value.strip().strip("\"'")
    values.update({key: value for key, value in os.environ.items() if value})
    return values


def env_value(name: str, default: str) -> str:
    return env_values().get(name) or default
