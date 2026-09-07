"use strict";

const LIMITE_ENTROPIA = 3.5;
const TAMANHO_MINIMO_ENTROPIA = 24;
const MINIMO_DIGITOS_ENTROPIA = 2;
const MINIMO_ALTERNANCIAS_CAIXA = 6;
const MINIMO_SEQUENCIAS_DIGITOS_INTERIORES = 2;
const MARCADOR_PADRAO = "[removido]";

const HOMOGLIFOS = Object.freeze({
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O",
  "Р": "P", "С": "C", "Т": "T", "Х": "X", "а": "a", "е": "e", "к": "k",
  "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j",
  "Α": "A", "Β": "B", "Ε": "E", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M",
  "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Χ": "X", "Υ": "Y", "α": "a",
  "ι": "i", "κ": "k", "ο": "o", "ρ": "p", "τ": "t", "υ": "y", "χ": "x",
});

const PADROES_SEGREDO = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,16384}?-----END [A-Z ]*PRIVATE KEY-----/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,16384}/g,
  /\beyJ[A-Za-z0-9_-]{7,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/g,
  /\bya29\.[A-Za-z0-9_-]{10,}\b/g,
  /\bGOCSPX-[A-Za-z0-9_-]{10,}\b/g,
  /\bnpm_[A-Za-z0-9_-]{10,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{10,}\b/g,
  /\bxapp-[A-Za-z0-9_-]{10,}\b/g,
  /\bdop_v1_[A-Za-z0-9_-]{10,}\b/g,
  /\bhf_[A-Za-z0-9_-]{10,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:sk|key)-[A-Za-z0-9_-]{12,}\b/g,
  /sk[-_][A-Za-z0-9_-]{16,}/g,
  /AIza[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /gh[pousr]_[A-Za-z0-9_-]{16,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\b[a-f0-9]{32,}\b/gi,
  /EAA[A-Za-z0-9][A-Za-z0-9_-]{12,}/g,
  /X-Amz-Signature=[0-9a-f]{16,}/gi,
];

const HOSTS_WEBHOOK = Object.freeze([
  "hooks.slack.com",
  "discord.com/api/webhooks",
  "discordapp.com/api/webhooks",
  "hooks.zapier.com",
  "outlook.office.com/webhook",
]);
const PADRAO_TOKEN_ENTROPIA = new RegExp(
  `[A-Za-z0-9_-]{${TAMANHO_MINIMO_ENTROPIA},}`,
  "g",
);
const PADRAO_BASE64 = /[A-Za-z0-9+/]{40,}={0,2}/g;
const PADRAO_BASE64_INTEIRO = /^[A-Za-z0-9+/]{40,}={0,2}$/;

const SECRET_NAME_PATTERN = "(?:(?:[A-Za-z0-9]+[_-])+(?:api[_-]?key|apikey|key|token|secret|password|passwd|credential|authorization|auth|chave|senha|segredo|credencial)(?:[_-][A-Za-z0-9]+)*|(?:api[_-]?key|apikey|key|token|secret|password|passwd|credential|authorization|auth|chave|senha|segredo|credencial))";

function normalizar(texto) {
  return String(texto)
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[^\x00-\x7F]/gu, (caractere) => HOMOGLIFOS[caractere] || caractere);
}

function entropiaShannon(token) {
  const valor = String(token);
  if (!valor.length) return 0;
  const frequencias = new Map();
  for (const caractere of valor) {
    frequencias.set(caractere, (frequencias.get(caractere) || 0) + 1);
  }
  let total = 0;
  for (const quantidade of frequencias.values()) {
    const probabilidade = quantidade / valor.length;
    total -= probabilidade * Math.log2(probabilidade);
  }
  return total;
}

function contarDigitos(token) {
  return (String(token).match(/[0-9]/g) || []).length;
}

function contarAlternanciasCaixa(token) {
  let anterior = null;
  let total = 0;
  for (const caractere of String(token)) {
    const atual = /[A-Z]/.test(caractere) ? "maiuscula" : (/[a-z]/.test(caractere) ? "minuscula" : null);
    if (!atual) {
      anterior = null;
      continue;
    }
    if (anterior && atual !== anterior) total += 1;
    anterior = atual;
  }
  return total;
}

function contarSequenciasDigitosInteriores(token) {
  const valor = String(token);
  let total = 0;
  for (const casamento of valor.matchAll(/[0-9]+/g)) {
    const inicio = casamento.index;
    const fim = inicio + casamento[0].length;
    if (/[A-Za-z]/.test(valor[inicio - 1] || "") && /[A-Za-z]/.test(valor[fim] || "")) {
      total += 1;
    }
  }
  return total;
}

// A rede de segurança por entropia exige sinais de aleatoriedade em conjunto:
// alta entropia, alternâncias de caixa e dígitos intercalados entre letras.
function deveRedigirPorEntropia(token) {
  return entropiaShannon(token) > LIMITE_ENTROPIA
    && contarAlternanciasCaixa(token) >= MINIMO_ALTERNANCIAS_CAIXA
    && contarSequenciasDigitosInteriores(token) >= MINIMO_SEQUENCIAS_DIGITOS_INTERIORES;
}

// Base64 requires entropy and a digit, plus case alternations with two interior digit runs, "+", or "=" padding.
function deveRedigirBase64(token) {
  const valor = String(token);
  return entropiaShannon(valor) > LIMITE_ENTROPIA
    && contarDigitos(valor) >= 1
    && (
      (
        contarAlternanciasCaixa(valor) >= valor.length / 4
        && contarSequenciasDigitosInteriores(valor) >= 2
      )
      || valor.includes("+")
      || valor.endsWith("=")
    );
}

function urlDeWebhook(valor) {
  try {
    const url = new URL(valor);
    const host = url.hostname.toLowerCase();
    const caminho = url.pathname.toLowerCase();
    return HOSTS_WEBHOOK.some((destino) => {
      const [hostEsperado, ...partes] = destino.split("/");
      const prefixo = partes.length ? `/${partes.join("/")}` : "";
      return host === hostEsperado
        && (!prefixo || caminho === prefixo || caminho.startsWith(`${prefixo}/`));
    });
  } catch {
    return false;
  }
}

function escaparRegex(valor) {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redigirVizinhanca(texto, marcador) {
  const literal = escaparRegex(marcador);
  return texto
    .replace(new RegExp(`([A-Za-z0-9_-]{8,})\\s?${literal}`, "g"), (trecho, vizinho) => (
      entropiaShannon(vizinho) > LIMITE_ENTROPIA ? marcador : trecho
    ))
    .replace(new RegExp(`${literal}\\s?([A-Za-z0-9_-]{8,})`, "g"), (trecho, vizinho) => (
      entropiaShannon(vizinho) > LIMITE_ENTROPIA ? marcador : trecho
    ))
    .replace(new RegExp(`${literal}\\s?${literal}`, "g"), marcador);
}

function redigirValores(texto, marcador = MARCADOR_PADRAO) {
  let saida = normalizar(texto);
  saida = saida.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => (
    urlDeWebhook(url) ? marcador : url
  ));
  for (const padrao of PADROES_SEGREDO) {
    saida = saida.replace(padrao, marcador);
  }
  saida = saida.replace(PADRAO_BASE64, (token) => (
    deveRedigirBase64(token) ? marcador : token
  ));
  saida = saida.replace(PADRAO_TOKEN_ENTROPIA, (token) => {
    const deveRedigir = deveRedigirPorEntropia(token)
      || (PADRAO_BASE64_INTEIRO.test(token) && deveRedigirBase64(token));
    return deveRedigir ? marcador : token;
  });
  return redigirVizinhanca(saida, marcador);
}

function redactSecrets(valor) {
  const marcador = "[oculto]";
  const saida = normalizar(valor)
    .replace(/\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/g, `$1${marcador}@`)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${marcador}`)
    .replace(new RegExp(`((["'])${SECRET_NAME_PATTERN}\\2\\s*:\\s*)(["'])[^\\r\\n]*?\\3`, "gi"), `$1$3${marcador}$3`)
    .replace(new RegExp(`(\\b${SECRET_NAME_PATTERN}\\s*[:= ]\\s*)(["'])[^\\r\\n]*?\\2`, "gi"), `$1$2${marcador}$2`)
    .replace(new RegExp(`(^|[^\\w-])(--${SECRET_NAME_PATTERN}\\s+)(["'])[^\\r\\n]*?\\3`, "gim"), `$1$2$3${marcador}$3`)
    .replace(new RegExp(`(^|[^\\w-])(--${SECRET_NAME_PATTERN}\\s+)(?!["'])[^\\s,;]+`, "gim"), `$1$2${marcador}`)
    .replace(
      new RegExp(`(\\b(${SECRET_NAME_PATTERN})\\s*([:=])\\s*)(?!["'])([^\\s,;]+)((?:[ \\t]+[^\\r\\n]+)?)`, "gi"),
      (_, prefixo, nome, separador, primeiro, resto) => (
        nome.toLowerCase() === "authorization" && separador === ":" && resto
          ? `${prefixo}${primeiro} ${marcador}`
          : `${prefixo}${marcador}${resto}`
      ),
    );
  return redigirValores(saida, marcador);
}

module.exports = {
  normalizar,
  redigirValores,
  redactSecrets,
  entropiaShannon,
  contarDigitos,
  contarAlternanciasCaixa,
  contarSequenciasDigitosInteriores,
  deveRedigirPorEntropia,
  deveRedigirBase64,
  PADROES_SEGREDO,
  PADRAO_BASE64,
  HOSTS_WEBHOOK,
  PADRAO_TOKEN_ENTROPIA,
  SECRET_NAME_PATTERN,
  LIMITE_ENTROPIA,
  TAMANHO_MINIMO_ENTROPIA,
  MINIMO_DIGITOS_ENTROPIA,
  MINIMO_ALTERNANCIAS_CAIXA,
  MINIMO_SEQUENCIAS_DIGITOS_INTERIORES,
};
