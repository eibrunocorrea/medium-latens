#!/bin/bash
# install-panel.sh — (re)instala o painel CEP no Premiere. Reinicie o Premiere depois.
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)/panel"
DST="$HOME/Library/Application Support/Adobe/CEP/extensions/ClaudePremierePanel"
rm -rf "$DST" && mkdir -p "$DST" && cp -R "$SRC/." "$DST/"
echo "✅ painel instalado em: $DST"
echo "→ Reinicie o Premiere e abra: Window > Extensões > Medium Latens"
