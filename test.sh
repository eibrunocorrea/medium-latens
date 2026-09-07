#!/bin/bash
# test.sh — smoke test do Medium Latens. Uso: bash test.sh [--chat]
# --chat inclui um roundtrip real (assinatura Max via perfil ativo — mais lento)
set -u
API="http://127.0.0.1:8765"
fail() { echo "❌ $1"; exit 1; }

DIR="$(cd "$(dirname "$0")" && pwd)"
for f in "$DIR"/lib/*.js "$DIR"/server.js; do node --check "$f" || fail "syntax: $f"; done
echo "✅ node --check OK"
node --test "$DIR"/test/*.test.js || fail "unit tests (node --test test/)"
echo "✅ unit tests OK"

H=$(curl -s --max-time 5 "$API/health") || fail "server não responde em $API (inicie com: node $DIR/server.js)"
echo "$H" | grep -q '"ok":true' || fail "health sem ok:true → $H"
echo "$H" | grep -q "Medium Latens" || fail "health sem o nome novo → $H"
echo "✅ health: $(echo "$H" | head -c 160)…"

S=$(curl -s --max-time 5 "$API/settings") || fail "settings falhou"
echo "$S" | grep -q '"profile"' || fail "settings sem profile → $S"
echo "✅ settings OK"

P=$(curl -s --max-time 40 "$API/profiles") || fail "profiles falhou"
echo "$P" | grep -q '"active"' || fail "profiles sem active → $P"
echo "✅ profiles: $(echo "$P" | head -c 160)…"

V=$(curl -s --max-time 40 "$API/providers") || fail "providers falhou"
echo "$V" | grep -q '"claude"' || fail "providers sem grupo claude → $V"
echo "$V" | grep -q '"codex"' || fail "providers sem grupo codex → $V"
echo "✅ providers OK"

# SSE: conexão abre e recebe o comentário de saudação (macOS não tem `timeout` → --max-time)
curl -sN --max-time 3 "$API/stream" | head -c 20 | grep -q ":" || fail "SSE /stream não respondeu"
echo "✅ SSE /stream OK"

R=$(curl -s --max-time 5 "$API/new") || fail "new falhou"
echo "$R" | grep -q '"new":true' || fail "new inesperado → $R"
echo "✅ nova conversa OK"

if [ "${1:-}" = "--chat" ]; then
  PROFILES="${2:-}"
  [ -z "$PROFILES" ] && PROFILES=$(curl -s "$API/settings" | sed -n 's/.*"profile":"\([^"]*\)".*/\1/p')
  ORIG=$(curl -s "$API/settings" | sed -n 's/.*"profile":"\([^"]*\)".*/\1/p')
  [ -n "$ORIG" ] && trap 'curl -s "$API/profiles/use?p=$ORIG" > /dev/null 2>&1' EXIT
  for P in $(echo "$PROFILES" | tr ',' ' '); do
    curl -s "$API/profiles/use?p=$P" > /dev/null || fail "profiles/use $P"
    PROV=$(curl -s "$API/health" | sed -n 's/.*"provider":"\([^"]*\)".*/\1/p')
    echo "— chat no perfil $P (provider $PROV)…"
    EV="$(mktemp)"; (curl -sN --max-time 240 "$API/stream" > "$EV") & SSE_PID=$!
    C=$(curl -s -X POST "$API/chat" -H "content-type: application/json" \
        -d '{"message":"responda apenas: pong","wait":true}' --max-time 240) || fail "chat timeout ($P)"
    kill $SSE_PID 2>/dev/null
    echo "$C" | grep -qi "pong" || fail "chat sem pong no perfil $P → $(echo "$C" | head -c 200)"
    grep -q '"kind":"init"' "$EV" || fail "stream sem init ($P)"
    grep -q '"kind":"done"' "$EV" || fail "stream sem done ($P)"
    echo "✅ $P: roundtrip + $(grep -c '"kind"' "$EV") eventos"
    rm -f "$EV"
  done
  curl -s "$API/profiles/use?p=$ORIG" > /dev/null
fi
echo "🎬 Medium Latens: testes passaram"
