#!/bin/bash
# Medium Latens: instalação. Idempotente, pode rodar de novo com segurança.
set -uo pipefail

# O instalador .pkg roda como root. Nesse caso, somente utilitários do sistema
# podem ser resolvidos pelo PATH. O teste simula root com um shim de id.
ROOT_MODE=0
if [ "${EUID:-1}" -eq 0 ]; then
  ROOT_MODE=1
elif [ "$(id -u)" -eq 0 ]; then
  ROOT_MODE=1
fi
if [ "$ROOT_MODE" -eq 1 ]; then
  PATH="/usr/bin:/bin:/usr/sbin:/sbin"
  export PATH
fi

APP_DIR="${1:-/Applications/Medium Latens}"
VERSOES_ARQ="$APP_DIR/installer/versoes.env"
VERSOES_ESPERADAS="CLAUDE_CODE CODEX GEMINI_CLI PREMIERE_PRO_MCP FFPROBE_STATIC FFMPEG_STATIC_TAG FFMPEG_SHA256_DARWIN_ARM64 FFMPEG_SHA256_DARWIN_X64 FFMPEG_SHA256_WIN32_X64"
versoes_incompletas() {
  echo "FALHOU: O arquivo de versões do instalador está incompleto. Reinstale o programa."
  exit 1
}
[ -f "$VERSOES_ARQ" ] || versoes_incompletas
for chave in $VERSOES_ESPERADAS; do
  unset "$chave"
done
while IFS= read -r linha || [ -n "$linha" ]; do
  if [[ "$linha" =~ ^([A-Z0-9_]+)=([A-Za-z0-9._-]+)$ ]]; then
    chave="${BASH_REMATCH[1]}"
    valor="${BASH_REMATCH[2]}"
    case " $VERSOES_ESPERADAS " in
      *" $chave "*) printf -v "$chave" '%s' "$valor" ;;
    esac
  fi
done < "$VERSOES_ARQ"
for chave in $VERSOES_ESPERADAS; do
  [ -n "${!chave:-}" ] || versoes_incompletas
done
USER_NAME="${MEDIUM_LATENS_USER:-$(stat -f%Su /dev/console)}"
case "$USER_NAME" in
  *[!A-Za-z0-9._-]*|"") echo "FALHOU: usuário inválido"; exit 1 ;;
esac
USER_UID="$(id -u "$USER_NAME")"
if { [ "$ROOT_MODE" -ne 1 ] && [ "$USER_NAME" = "$(id -un)" ]; } \
  || { [ "$ROOT_MODE" -eq 1 ] && [ "${EUID:-1}" -ne 0 ]; }; then
  USER_HOME="$HOME"
else
  USER_HOME="$(eval echo "~$USER_NAME")"
fi
SHELL_USUARIO="$(dscl . -read "/Users/$USER_NAME" UserShell 2>/dev/null | awk 'NF { valor=$NF } END { print valor }')"
case "$SHELL_USUARIO" in
  /bin/zsh|/bin/bash|/bin/sh) ;;
  *) SHELL_USUARIO="/bin/zsh" ;;
esac
USER_DIR="${MEDIUM_LATENS_USER_DIR:-$USER_HOME/.medium-latens}"
LOG="$USER_DIR/logs/install.log"
TOTAL=8

como_usuario() {
  if [ "$ROOT_MODE" -eq 1 ]; then
    sudo -u "$USER_NAME" -H "$@"
  else
    "$@"
  fi
}

passo() {
  echo "PASSO $1/$TOTAL: $2" | como_usuario tee -a "$LOG"
  como_usuario osascript -e "display notification \"$2\" with title \"Instalando o Medium Latens\"" >/dev/null 2>&1 || true
}

erro() {
  echo "FALHOU: $1" | como_usuario tee -a "$LOG"
  echo "Log completo em $LOG"
  exit 1
}

aviso() {
  echo "AVISO: $1" | como_usuario tee -a "$LOG"
}

com_log() {
  "$@" 2>&1 | como_usuario tee -a "$LOG"
}

com_log_usuario() {
  como_usuario "$@" 2>&1 | como_usuario tee -a "$LOG"
}

localizar_binario() {
  nome="$1"
  # O shell real lê .zprofile no zsh, onde o Homebrew configura o PATH no Apple Silicon.
  saida="$(como_usuario "$SHELL_USUARIO" -lc '
    if [ -n "${MEDIUM_LATENS_TEST_PATH:-}" ]; then
      PATH="$MEDIUM_LATENS_TEST_PATH:$PATH"
    fi
    command -v "$1"
  ' _ "$nome" 2>/dev/null || true)"
  valor="$(printf '%s\n' "$saida" | awk 'NF { ultima=$0 } END { print ultima }')"
  case "$valor" in
    /*) [ -x "$valor" ] || valor="" ;;
    *) valor="" ;;
  esac
  printf '%s\n' "$valor"
}

localizar_node() {
  localizar_binario node
}

localizar_npm() {
  localizar_binario npm
}

npm_sem_segredos() (
  nome=""
  while IFS= read -r nome; do
    case "$nome" in
      [Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_*|\
      *_[Aa][Pp][Ii]_[Kk][Ee][Yy]|\
      NODE_OPTIONS|NODE_EXTRA_CA_CERTS|FFMPEG_BINARIES_URL|FFMPEG_BINARY_RELEASE|\
      NPM_TOKEN|NODE_AUTH_TOKEN) unset "$nome" ;;
    esac
  done < <(compgen -e)
  como_usuario env npm_config_prefix="$USER_DIR/npm" "$NPM_BIN" "$@"
)

instalar_ffmpeg() {
  case "$(uname -m)" in
    arm64)
      FFMPEG_ASSET="ffmpeg-darwin-arm64"
      FFMPEG_ESPERADA="$(printf '%s' "$FFMPEG_SHA256_DARWIN_ARM64" | tr 'A-F' 'a-f')"
      ;;
    x86_64)
      FFMPEG_ASSET="ffmpeg-darwin-x64"
      FFMPEG_ESPERADA="$(printf '%s' "$FFMPEG_SHA256_DARWIN_X64" | tr 'A-F' 'a-f')"
      ;;
    *)
      aviso "Arquitetura sem ffmpeg disponível. O restante do app funciona normalmente."
      return 1
      ;;
  esac
  FFMPEG_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_STATIC_TAG/$FFMPEG_ASSET"
  FFMPEG_DESTINO="$USER_DIR/bin/ffmpeg"
  FFMPEG_TEMP="$USER_DIR/bin/.ffmpeg.download"
  como_usuario mkdir -p "$USER_DIR/bin" || return 1
  if [ -f "$FFMPEG_DESTINO" ]; then
    FFMPEG_EXISTENTE="$(como_usuario shasum -a 256 "$FFMPEG_DESTINO" 2>/dev/null | awk '{ print $1 }' | tr 'A-F' 'a-f')"
    if [ "$FFMPEG_EXISTENTE" = "$FFMPEG_ESPERADA" ]; then
      como_usuario chmod +x "$FFMPEG_DESTINO"
      return 0
    fi
  fi
  como_usuario rm -f "$FFMPEG_TEMP"
  if ! com_log_usuario curl -fsSL -o "$FFMPEG_TEMP" "$FFMPEG_URL"; then
    como_usuario rm -f "$FFMPEG_TEMP"
    aviso "Não consegui baixar o ffmpeg verificado. O restante do app funciona normalmente."
    return 1
  fi
  FFMPEG_OBTIDA="$(como_usuario shasum -a 256 "$FFMPEG_TEMP" | awk '{ print $1 }' | tr 'A-F' 'a-f')"
  if [ "$FFMPEG_OBTIDA" != "$FFMPEG_ESPERADA" ]; then
    como_usuario rm -f "$FFMPEG_TEMP" "$FFMPEG_DESTINO"
    aviso "O ffmpeg baixado não confere com o SHA-256 oficial. O restante do app funciona normalmente."
    return 1
  fi
  como_usuario chmod +x "$FFMPEG_TEMP" \
    && como_usuario mv -f "$FFMPEG_TEMP" "$FFMPEG_DESTINO"
}

case "$USER_HOME" in
  /*) ;;
  *) erro "Não encontrei a pasta do usuário $USER_NAME" ;;
esac
[ -d "$USER_HOME" ] || erro "Não encontrei a pasta do usuário $USER_NAME"

if [ -e "$USER_DIR" ] || [ -L "$USER_DIR" ]; then
  [ ! -L "$USER_DIR" ] || {
    echo "FALHOU: A pasta de configuração $USER_DIR não pode ser um link simbólico"
    exit 1
  }
  DONO_USER_DIR="$(stat -f %Su "$USER_DIR" 2>/dev/null || true)"
  [ "$DONO_USER_DIR" = "$USER_NAME" ] || {
    echo "FALHOU: A pasta de configuração $USER_DIR não pertence ao usuário $USER_NAME"
    exit 1
  }
fi

if ! como_usuario mkdir -p "$USER_DIR/logs" "$USER_DIR/workspaces" "$USER_DIR/data"; then
  echo "FALHOU: Não consegui criar a pasta de configuração $USER_DIR"
  exit 1
fi
if ! como_usuario touch "$LOG"; then
  echo "FALHOU: Não consegui criar o log $LOG"
  exit 1
fi

passo 1 "Preparando os arquivos do programa"
[ -f "$APP_DIR/server.js" ] || erro "Os arquivos do programa não foram encontrados em $APP_DIR"

passo 2 "Verificando o Node.js"
TEM_NODE=0
NODE_BIN="$(localizar_node 2>/dev/null || true)"
if [ -n "$NODE_BIN" ]; then
  NODE_MAJOR="$(como_usuario "$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  case "$NODE_MAJOR" in
    ""|*[!0-9]*) ;;
    *) [ "$NODE_MAJOR" -ge 22 ] && TEM_NODE=1 ;;
  esac
fi
if [ "$TEM_NODE" -ne 1 ]; then
  INDICE="$(curl -fsSL https://nodejs.org/dist/index.json)" \
    || erro "Não consegui descobrir a versão do Node.js. Verifique sua conexão."
  VER="$(printf '%s' "$INDICE" \
    | tr '{' '\n' \
    | awk -F'"' '/"lts"[[:space:]]*:[[:space:]]*"/ { for (i = 1; i <= NF; i++) if ($i == "version") { print $(i + 2); exit } }')"
  [ -n "$VER" ] || erro "Não consegui descobrir a versão do Node.js. Verifique sua conexão."
  PKG_TMP="$(mktemp -t medium-latens-node.XXXXXX)" || erro "Não consegui criar arquivo temporário"
  if ! curl -fsSL -o "$PKG_TMP" "https://nodejs.org/dist/$VER/node-$VER.pkg"; then
    rm -f "$PKG_TMP"
    erro "Não consegui baixar o Node.js"
  fi
  # Integridade: a lista oficial de somas do mesmo release tem que citar este pacote e bater.
  SOMAS="$(curl -fsSL "https://nodejs.org/dist/$VER/SHASUMS256.txt")" || {
    rm -f "$PKG_TMP"
    erro "Não consegui baixar a lista de verificação do Node.js"
  }
  ESPERADA="$(printf '%s\n' "$SOMAS" | awk -v nome="node-$VER.pkg" '$2 == nome { print tolower($1); exit }')"
  if [ -z "$ESPERADA" ]; then
    rm -f "$PKG_TMP"
    erro "A lista de verificação do Node.js não menciona node-$VER.pkg"
  fi
  OBTIDA="$(shasum -a 256 "$PKG_TMP" | awk '{ print tolower($1) }')"
  if [ "$OBTIDA" != "$ESPERADA" ]; then
    rm -f "$PKG_TMP"
    erro "O instalador do Node.js baixado não confere com a verificação oficial. Tente de novo mais tarde."
  fi
  echo "Node.js $VER verificado (SHA-256 confere)" | como_usuario tee -a "$LOG" >/dev/null
  if ! com_log installer -pkg "$PKG_TMP" -target /; then
    rm -f "$PKG_TMP"
    erro "A instalação do Node.js falhou"
  fi
  rm -f "$PKG_TMP"
  hash -r
  NODE_BIN="$(localizar_node 2>/dev/null || true)"
fi
[ -n "$NODE_BIN" ] || erro "Não encontrei o Node.js depois da instalação"
NPM_BIN="$(localizar_npm 2>/dev/null || true)"
[ -n "$NPM_BIN" ] || erro "Não encontrei o npm depois da instalação do Node.js"

passo 3 "Instalando os componentes de IA"
npm_sem_segredos install -g "@anthropic-ai/claude-code@$CLAUDE_CODE" 2>&1 | como_usuario tee -a "$LOG" || aviso "Claude CLI não instalou"
npm_sem_segredos install -g "@openai/codex@$CODEX" 2>&1 | como_usuario tee -a "$LOG" || aviso "Codex CLI não instalou"
npm_sem_segredos install -g --ignore-scripts "premiere-pro-mcp@$PREMIERE_PRO_MCP" 2>&1 | como_usuario tee -a "$LOG" || erro "O componente que fala com o Premiere não instalou"
como_usuario env PATH="$USER_DIR/npm/bin:$PATH" /bin/bash -c 'command -v claude >/dev/null 2>&1 || command -v codex >/dev/null 2>&1' \
  || erro "Nenhum assistente de IA pôde ser instalado"
npm_sem_segredos install -g "@google/gemini-cli@$GEMINI_CLI" 2>&1 | como_usuario tee -a "$LOG" || aviso "Gemini CLI não instalou"

passo 4 "Preparando o motor de transcrição e cortes (opcional, pode demorar)"
# Em um macOS limpo, python3 pode abrir a instalação das ferramentas de linha de comando do Xcode.
{
  como_usuario python3 -m venv "$USER_DIR/venv" \
    && como_usuario "$USER_DIR/venv/bin/pip" install --quiet --upgrade pip \
    && como_usuario "$USER_DIR/venv/bin/pip" install --quiet -r "$APP_DIR/engine/requirements.txt" \
    && npm_sem_segredos install -g --ignore-scripts "ffprobe-static@$FFPROBE_STATIC" \
    && RAIZ_NPM="$(npm_sem_segredos root -g)" \
    && ARQ_FFPROBE="$(uname -m)" \
    && { [ "$ARQ_FFPROBE" != "x86_64" ] || ARQ_FFPROBE="x64"; } \
    && {
      como_usuario chmod +x "$RAIZ_NPM/ffprobe-static/bin/darwin/$ARQ_FFPROBE/ffprobe" || true
      como_usuario mkdir -p "$USER_DIR/bin" \
        && como_usuario cp -f \
          "$RAIZ_NPM/ffprobe-static/bin/darwin/$ARQ_FFPROBE/ffprobe" "$USER_DIR/bin/ffprobe"
    }
} 2>&1 | como_usuario tee -a "$LOG" || aviso "Motor de cortes indisponível. O restante do app funciona normalmente."
instalar_ffmpeg || true

passo 5 "Instalando o painel dentro do Premiere"
CEP_ROOT="$USER_HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$CEP_ROOT/MediumLatens"
com_log_usuario rm -rf "$DEST" \
  && com_log_usuario mkdir -p "$DEST" \
  && com_log_usuario cp -R "$APP_DIR/panel/." "$DEST/" \
  || erro "Não consegui instalar o painel"
[ -f "$DEST/index.html" ] || erro "Não consegui instalar o painel"
CEP_DEBUG_MARKER="$USER_DIR/cep-debug-ativado"
como_usuario touch "$CEP_DEBUG_MARKER" \
  || erro "Não consegui preparar o registro do modo de depuração do painel"
for v in 9 10 11 12; do
  DEBUG_ATUAL="$(como_usuario defaults read "com.adobe.CSXS.$v" PlayerDebugMode 2>/dev/null || true)"
  if [ "$DEBUG_ATUAL" = "1" ]; then
    continue
  fi
  if com_log_usuario defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; then
    if ! como_usuario grep -Fxq "$v" "$CEP_DEBUG_MARKER"; then
      printf '%s\n' "$v" | como_usuario tee -a "$CEP_DEBUG_MARKER" >/dev/null \
        || erro "Não consegui registrar o modo de depuração do painel no CSXS $v"
    fi
  else
    aviso "Não consegui habilitar o modo de depuração do painel no CSXS $v"
  fi
done

passo 6 "Configurando a inicialização automática"
NODE_BIN="$(localizar_node 2>/dev/null || true)"
[ -n "$NODE_BIN" ] || erro "Não encontrei o Node.js depois da instalação"
NODE_DIR="$(dirname "$NODE_BIN")"
PLIST="$USER_HOME/Library/LaunchAgents/com.brunocorrea.mediumlatens.plist"
com_log_usuario mkdir -p "$USER_HOME/Library/LaunchAgents"
como_usuario tee "$PLIST" >/dev/null <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.brunocorrea.mediumlatens</string>
  <key>ProgramArguments</key><array>
    <string>$NODE_BIN</string><string>$APP_DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/><key>Crashed</key><true/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$USER_DIR/npm/bin:$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$USER_HOME</string>
    <key>MEDIUM_LATENS_SERVICE</key><string>1</string>
  </dict>
  <key>StandardOutPath</key><string>$USER_DIR/logs/out.log</string>
  <key>StandardErrorPath</key><string>$USER_DIR/logs/err.log</string>
</dict></plist>
PL
[ "$?" -eq 0 ] || erro "Não consegui escrever a configuração de inicialização"
if [ "$ROOT_MODE" -eq 1 ]; then
  com_log launchctl asuser "$USER_UID" launchctl bootout "gui/$USER_UID/com.brunocorrea.mediumlatens" || true
  com_log launchctl asuser "$USER_UID" launchctl bootstrap "gui/$USER_UID" "$PLIST" \
    || erro "Não consegui configurar a inicialização"
else
  com_log launchctl bootout "gui/$USER_UID/com.brunocorrea.mediumlatens" || true
  com_log launchctl bootstrap "gui/$USER_UID" "$PLIST" \
    || erro "Não consegui configurar a inicialização"
fi

passo 7 "Criando sua pasta de configuração"
if [ ! -f "$USER_DIR/.env" ]; then
  como_usuario tee "$USER_DIR/.env" >/dev/null <<ENVF
# Chaves opcionais, para gerar imagem e voz. O assistente do painel preenche isto para você.
# GEMINI_API_KEY=
# ELEVENLABS_API_KEY=
ENVF
  [ "$?" -eq 0 ] || erro "Não consegui criar o arquivo de configuração"
fi
if [ ! -f "$USER_DIR/hotwords.txt" ]; then
  echo "# Um termo por linha: nomes e jargões do seu canal." \
    | como_usuario tee "$USER_DIR/hotwords.txt" >/dev/null \
    || erro "Não consegui criar o arquivo de termos"
fi
[ -f "$USER_DIR/.env" ] && [ -f "$USER_DIR/hotwords.txt" ] \
  || erro "A pasta de configuração ficou incompleta"
VERSAO_TERMOS="$(sed -n '1s/.*(versão \([0-9.]*\)).*/\1/p' "$APP_DIR/TERMOS.md")"
[ -n "$VERSAO_TERMOS" ] || erro "Não consegui identificar a versão em $APP_DIR/TERMOS.md"
com_log_usuario env MEDIUM_LATENS_USER_DIR="$USER_DIR" "$NODE_BIN" -e 'require(process.argv[1] + "/lib/telemetria").registrarAceite(process.argv[2])' "$APP_DIR" "$VERSAO_TERMOS" \
  || erro "Não consegui registrar o aceite dos termos"

passo 8 "Conferindo se está no ar"
for _ in $(seq 1 15); do
  sleep 1
  if curl -fsS http://127.0.0.1:8765/health >/dev/null 2>&1; then
    echo "PRONTO" | como_usuario tee -a "$LOG"
    exit 0
  fi
done
erro "O serviço não respondeu. Veja $USER_DIR/logs/err.log."
