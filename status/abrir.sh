#!/bin/bash
# Medium Latens: abre a página de status local ou a ajuda estática.
set -uo pipefail

USER_DIR="${MEDIUM_LATENS_USER_DIR:-$HOME/.medium-latens}"
PORTA="${MEDIUM_LATENS_PORTA:-8765}"
HEALTH="http://127.0.0.1:$PORTA/health"
SAUDAVEL=0

if curl -fsS --max-time 2 "$HEALTH" >/dev/null 2>&1; then
  SAUDAVEL=1
else
  if ! launchctl kickstart -k "gui/$(id -u)/com.brunocorrea.mediumlatens" >/dev/null 2>&1; then
    launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.brunocorrea.mediumlatens.plist" >/dev/null 2>&1 || true
  fi
  for _ in $(seq 1 10); do
    sleep 1
    if curl -fsS --max-time 2 "$HEALTH" >/dev/null 2>&1; then
      SAUDAVEL=1
      break
    fi
  done
fi

if [ "$SAUDAVEL" -eq 1 ] && [ -f "$USER_DIR/token" ]; then
  TOKEN="$(cat "$USER_DIR/token" 2>/dev/null)"
  REDIRECT="$USER_DIR/status-abrir.html"
  umask 077
  printf '%s\n' \
    '<!doctype html><meta charset="utf-8">' \
    "<meta http-equiv=\"refresh\" content=\"0;url=http://127.0.0.1:$PORTA/status?t=$TOKEN\">" \
    >"$REDIRECT"
  chmod 600 "$REDIRECT"
  open "$REDIRECT" >/dev/null 2>&1 || true
else
  open "$(dirname "$0")/index.html" >/dev/null 2>&1 || true
fi

exit 0
