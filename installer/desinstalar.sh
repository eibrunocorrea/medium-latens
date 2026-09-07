#!/bin/bash
set -uo pipefail

[ -n "${HOME:-}" ] || { echo "FALHOU: HOME não definido"; exit 1; }

APP_DIR="${MEDIUM_LATENS_APP_DIR:-/Applications/Medium Latens}"
LANCADOR="${MEDIUM_LATENS_LAUNCHER:-/Applications/Medium Latens.app}"
APP_DIR="${APP_DIR%/}"
LANCADOR="${LANCADOR%/}"
USER_DIR="${MEDIUM_LATENS_USER_DIR:-$HOME/.medium-latens}"
PLIST="$HOME/Library/LaunchAgents/com.brunocorrea.mediumlatens.plist"
PAINEL="$HOME/Library/Application Support/Adobe/CEP/extensions/MediumLatens"
FALHAS=0

registrar_falha() {
  echo "$1"
  FALHAS=$((FALHAS + 1))
}

protege_dados_usuario() {
  local alvo="$1"
  case "$alvo" in
    "$USER_DIR"|"$USER_DIR"/*)
      registrar_falha "AVISO: recusei remover um caminho dentro da pasta do usuário: $alvo"
      return 1
      ;;
  esac
  case "$USER_DIR" in
    "$alvo"|"$alvo"/*)
      registrar_falha "AVISO: recusei remover um caminho que contém a pasta do usuário: $alvo"
      return 1
      ;;
  esac
  return 0
}

remover_aplicativo() {
  local caminho="$1"
  case "$caminho" in
    /*) ;;
    *)
      registrar_falha "AVISO: caminho recusado pela proteção do desinstalador: $caminho"
      return 1
      ;;
  esac
  case "$caminho" in
    "Medium Latens"|"Medium Latens.app"|*/"Medium Latens"|*/"Medium Latens.app") ;;
    *)
      registrar_falha "AVISO: caminho recusado pela proteção do desinstalador: $caminho"
      return 1
      ;;
  esac
  protege_dados_usuario "$caminho" || return
  if [ ! -e "$caminho" ] && [ ! -L "$caminho" ]; then
    echo "Já estava ausente: $caminho"
    return
  fi
  if [ -w "$caminho" ] && [ -w "$(dirname "$caminho")" ]; then
    rm -rf "$caminho" || sudo rm -rf "$caminho" || registrar_falha "AVISO: não consegui remover $caminho"
  else
    sudo rm -rf "$caminho" || registrar_falha "AVISO: não consegui remover $caminho"
  fi
}

echo "Removendo a inicialização automática."
launchctl bootout "gui/$(id -u)/com.brunocorrea.mediumlatens" >/dev/null 2>&1 || true
if protege_dados_usuario "$PLIST"; then
  rm -f "$PLIST" || registrar_falha "AVISO: não consegui remover $PLIST"
fi

echo "Removendo o painel do Premiere."
if protege_dados_usuario "$PAINEL"; then
  rm -rf "$PAINEL" || registrar_falha "AVISO: não consegui remover $PAINEL"
fi
DEBUG_MARKER="$USER_DIR/cep-debug-ativado"
if [ -f "$DEBUG_MARKER" ]; then
  while IFS= read -r v || [ -n "$v" ]; do
    case "$v" in
      9|10|11|12) defaults delete "com.adobe.CSXS.$v" PlayerDebugMode >/dev/null 2>&1 || true ;;
    esac
  done < "$DEBUG_MARKER"
fi

echo "Removendo os arquivos do programa."
remover_aplicativo "$APP_DIR"
remover_aplicativo "$LANCADOR"

echo "Esquecendo o recibo do instalador."
if ! pkgutil --forget com.brunocorrea.mediumlatens >/dev/null 2>&1; then
  sudo pkgutil --forget com.brunocorrea.mediumlatens >/dev/null 2>&1 || true
fi

if [ "$FALHAS" -eq 0 ]; then
  echo "Programa removido."
  CODIGO_SAIDA=0
else
  echo "A remoção não terminou: veja os avisos acima."
  CODIGO_SAIDA=1
fi
echo "Suas contas, chaves, projetos e o motor de cortes continuam em $USER_DIR."
echo "Os CLIs fixados continuam em $USER_DIR/npm, dentro da pasta preservada."
echo "Para apagar também esses dados, remova essa pasta manualmente."
exit "$CODIGO_SAIDA"
