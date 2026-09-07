"use strict";
/**
 * lib/telemetria.js, registro de como a pessoa trabalha, para aperfeiçoar o produto.
 * O que entra: prompt, resposta, ferramentas, alterações, erros, tempos, sequência.
 * O que NUNCA entra, sem exceção e sem opção de desligar: credencial e byte de mídia.
 * Enviar a chave de quem instalou para o servidor de coleta seria incidente de segurança.
 * Nada é gravado antes do aceite registrado na instalação.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { USER_DIR, ensureUserDir } = require("./paths");
const { redactSecrets, PADROES_SEGREDO } = require("./redacao");
const settings = require("./settings");

const DIR = path.join(USER_DIR, "telemetria");
const FILA = path.join(DIR, "fila.jsonl");
const ID = path.join(DIR, "instalacao");
const ACEITE = path.join(DIR, "aceite.json");
const MAX_ITENS = 5000;
const MAX_EVENTO_BYTES = 4096;
const MAX_TEXTO_BYTES = 2048;
const MAX_ENTRADA_REDACAO_BYTES = 8 * MAX_TEXTO_BYTES;
const MAX_TIPO_BYTES = 128;
const MIN_SEGREDO_BYTES = 8;
const MIN_SEGREDO_DINAMICO_BYTES = 16;
const MIN_AMOSTRAS = 16;
const MIN_BASE64_LONGO = 256;
const PROPORCAO_CONTROLES_BINARIO = 0.30;

const PROIBIDOS = PADROES_SEGREDO;

// Nomes de variável cujo valor jamais pode sair, mesmo no meio de um texto livre.
const VARS_SENSIVEIS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "ELEVENLABS_API_KEY",
  "META_PAGE_TOKEN", "MEDIUM_LATENS_TOKEN",
];
const NOME_SENSIVEL = /token|senha|password|secret|api[_-]?key|auth|authorization|chave|segredo|credencial/i;

function garantir() {
  ensureUserDir();
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(DIR, 0o700);
}

function instalacaoId() {
  try {
    const v = fs.readFileSync(ID, "utf8").trim();
    if (v.length === 36) return v;
  } catch {}
  garantir();
  const v = crypto.randomUUID();
  fs.writeFileSync(ID, v, { mode: 0o600 });
  return v;
}

function aceiteInfo() {
  try {
    const info = JSON.parse(fs.readFileSync(ACEITE, "utf8"));
    return info && info.em ? { em: info.em, termos: info.termos } : null;
  } catch {
    return null;
  }
}

function aceito() {
  return aceiteInfo() !== null;
}

function registrarAceite(versaoTermos) {
  garantir();
  fs.writeFileSync(ACEITE, JSON.stringify({ em: new Date().toISOString(), termos: versaoTermos }), { mode: 0o600 });
}

function variaveisSensiveis() {
  const nomes = new Map(VARS_SENSIVEIS.map((nome) => [nome, MIN_SEGREDO_BYTES]));
  for (const nome of Object.keys(process.env)) {
    if (NOME_SENSIVEL.test(nome) && !nomes.has(nome)) {
      nomes.set(nome, MIN_SEGREDO_DINAMICO_BYTES);
    }
  }
  return nomes;
}

function limitarTexto(s, maxBytes) {
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  const marcador = "[texto truncado]";
  const disponivel = maxBytes - Buffer.byteLength(marcador, "utf8");
  const prefixo = Buffer.from(s, "utf8").subarray(0, disponivel).toString("utf8").replace(/\uFFFD$/, "");
  return prefixo + marcador;
}

function limitarEntradaRedacao(s) {
  if (Buffer.byteLength(s, "utf8") <= MAX_ENTRADA_REDACAO_BYTES) return s;
  return Buffer.from(s, "utf8")
    .subarray(0, MAX_ENTRADA_REDACAO_BYTES)
    .toString("utf8")
    .replace(/\uFFFD$/, "");
}

function limparTexto(s, maxBytes = MAX_TEXTO_BYTES) {
  const original = String(s);
  const texto = limitarEntradaRedacao(original);
  const entradaFoiLimitada = texto !== original;
  if (stringBinaria(texto)) return "[binario removido]";
  let saida = texto;
  for (const [nome, minimo] of variaveisSensiveis()) {
    const valor = process.env[nome];
    if (valor && Buffer.byteLength(valor, "utf8") >= minimo) {
      saida = saida.split(valor).join("[removido]");
    }
  }
  saida = saida.replace(/data:(?:audio|image|video)\/[^\s"'<>]*/gi, "[binario removido]");
  const excediaLimite = entradaFoiLimitada || Buffer.byteLength(saida, "utf8") > maxBytes;
  saida = redigirTrechosBase64(saida);
  saida = redactSecrets(saida).replace(/\[oculto\]/g, "[removido]");
  if (excediaLimite && Buffer.byteLength(saida, "utf8") <= maxBytes) {
    saida += "[texto truncado]";
  }
  return limitarTexto(saida, maxBytes);
}

function binario(valor) {
  return Buffer.isBuffer(valor)
    || ArrayBuffer.isView(valor)
    || valor instanceof ArrayBuffer
    || (typeof SharedArrayBuffer !== "undefined" && valor instanceof SharedArrayBuffer)
    || (typeof Blob !== "undefined" && valor instanceof Blob);
}

function bufferSerializado(valor) {
  return valor && typeof valor === "object"
    && valor.type === "Buffer"
    && Array.isArray(valor.data);
}

function comecaCom(bytes, assinatura, deslocamento = 0) {
  if (bytes.length < deslocamento + assinatura.length) return false;
  return assinatura.every((byte, indice) => bytes[deslocamento + indice] === byte);
}

function temAssinaturaMidia(bytes) {
  return comecaCom(bytes, [137, 80, 78, 71]) // PNG
    || comecaCom(bytes, [255, 216, 255]) // JPEG
    || comecaCom(bytes, [71, 73, 70, 56]) // GIF8
    || comecaCom(bytes, [82, 73, 70, 70]) // RIFF: WebP, WAV e AVI
    || comecaCom(bytes, [102, 116, 121, 112], 4) // MP4 e MOV: ftyp
    || comecaCom(bytes, [73, 68, 51]) // MP3: ID3
    || comecaCom(bytes, [255, 251]) // MP3: quadro MPEG
    || comecaCom(bytes, [37, 80, 68, 70]) // PDF
    || comecaCom(bytes, [80, 75]); // ZIP: PK
}

function decodificarBase64(valor) {
  const compacto = valor.replace(/\s/g, "");
  if (compacto.length < 4 || compacto.length % 4 === 1) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compacto)) return null;
  const semPadding = compacto.replace(/=+$/, "");
  try {
    const bytes = Buffer.from(compacto, "base64");
    if (bytes.toString("base64").replace(/=+$/, "") !== semPadding) return null;
    return bytes;
  } catch {
    return null;
  }
}

function redigirTrechosBase64(valor) {
  return valor.replace(
    /[A-Za-z0-9+/=](?:[A-Za-z0-9+/=]|\s){254,}[A-Za-z0-9+/=]/g,
    (trecho) => {
      const compacto = trecho.replace(/\s/g, "");
      return compacto.length >= MIN_BASE64_LONGO && decodificarBase64(compacto)
        ? "[binario removido]"
        : trecho;
    },
  );
}

function stringBinaria(valor) {
  if (!valor.length) return false;

  const base64 = decodificarBase64(valor);
  if (base64 && (temAssinaturaMidia(base64) || valor.length >= MIN_BASE64_LONGO)) return true;

  let somenteLatin1 = true;
  let controles = 0;
  for (let i = 0; i < valor.length; i++) {
    const codigo = valor.charCodeAt(i);
    if (codigo > 255) somenteLatin1 = false;
    if ((codigo <= 8) || (codigo >= 11 && codigo <= 12)
      || (codigo >= 14 && codigo <= 31) || (codigo >= 127 && codigo <= 159)) {
      controles++;
    }
  }
  if (somenteLatin1 && temAssinaturaMidia(Buffer.from(valor, "latin1"))) return true;
  return controles / valor.length > PROPORCAO_CONTROLES_BINARIO;
}

function numeroFinito(valor) {
  return typeof valor === "number" && Number.isFinite(valor);
}

function stringNumerica(valor) {
  return typeof valor === "string"
    && valor.trim() !== ""
    && Number.isFinite(Number(valor));
}

function arrayDeAmostras(valor) {
  if (!Array.isArray(valor)) return false;
  const numeros = valor.every(numeroFinito);
  if (valor.length >= MIN_AMOSTRAS
    && valor.every((item) => numeroFinito(item) || stringNumerica(item))) return true;
  return numeros
    && valor.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
    && temAssinaturaMidia(valor);
}

function objetoDeAmostras(valor) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  const chaves = Object.keys(valor);
  return chaves.length >= MIN_AMOSTRAS
    && chaves.every(stringNumerica)
    && chaves.every((chave) => numeroFinito(valor[chave]));
}

function limpar(valor, vistos) {
  vistos = vistos || new Set();
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "string") return limparTexto(valor);
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (typeof valor === "function") return "[funcao removida]";
  if (binario(valor)) return "[binario removido]";
  if (bufferSerializado(valor) || arrayDeAmostras(valor) || objetoDeAmostras(valor)) {
    return "[binario removido]";
  }
  if (typeof valor !== "object") return limparTexto(String(valor));
  if (vistos.has(valor)) return "[circular]";
  vistos.add(valor);
  if (Array.isArray(valor)) return valor.map((v) => limpar(v, vistos));
  const saida = {};
  for (const chave of Object.keys(valor)) {
    const chaveLimpa = limparTexto(chave);
    if (chaveLimpa !== chave) continue;
    if (NOME_SENSIVEL.test(chave)) { saida[chave] = "[removido]"; continue; }
    saida[chave] = limpar(valor[chave], vistos);
  }
  return saida;
}

function tamanhoJson(valor) {
  const serializado = JSON.stringify(valor);
  return serializado === undefined ? 0 : Buffer.byteLength(serializado, "utf8");
}

function serializarTruncado(item, bytesOriginais) {
  item.truncado = { bytesOriginais, bytesDescartados: 0 };

  // O próprio número de bytes descartados altera o tamanho da linha. Em uma fronteira
  // decimal pode não existir ponto fixo sem um espaço JSON insignificante no fim.
  for (let espacos = 0; espacos <= 1; espacos++) {
    let bytesDescartados = bytesOriginais
      - Buffer.byteLength(JSON.stringify(item) + " ".repeat(espacos), "utf8");
    const vistos = new Set();
    while (!vistos.has(bytesDescartados)) {
      vistos.add(bytesDescartados);
      item.truncado.bytesDescartados = bytesDescartados;
      const linha = JSON.stringify(item) + " ".repeat(espacos);
      const exato = bytesOriginais - Buffer.byteLength(linha, "utf8");
      if (bytesDescartados === exato) return linha;
      bytesDescartados = exato;
    }
  }
  return null;
}

function limitarItem(item, bytesOriginais) {
  const dadosOriginais = item.dados;
  if (dadosOriginais && typeof dadosOriginais === "object" && !Array.isArray(dadosOriginais)) {
    const digitos = String(bytesOriginais).length;
    const maiorNumero = "9".repeat(digitos);
    const sobrecargaTruncado = Buffer.byteLength(
      `,"truncado":{"bytesOriginais":${maiorNumero},"bytesDescartados":${maiorNumero}}`,
      "utf8",
    );
    const campos = Object.entries(dadosOriginais)
      .map(([chave, valor]) => {
        const bytes = tamanhoJson(valor);
        const marcador = `[campo truncado: ${bytes} bytes descartados]`;
        return { chave, valor, bytes, marcador, bytesMarcador: tamanhoJson(marcador) };
      })
      .sort((a, b) => b.bytes - a.bytes);
    item.dados = { ...dadosOriginais };
    let atual = bytesOriginais;
    let tentativas = 0;

    for (const campo of campos) {
      if (campo.bytes <= campo.bytesMarcador) continue;
      item.dados[campo.chave] = campo.marcador;
      atual -= campo.bytes - campo.bytesMarcador;
      if (atual + sobrecargaTruncado > MAX_EVENTO_BYTES) continue;

      const linha = serializarTruncado(item, bytesOriginais);
      tentativas++;
      if (linha && Buffer.byteLength(linha, "utf8") <= MAX_EVENTO_BYTES) return linha;
      if (tentativas >= 3) break;
    }
  }

  const bytesDados = tamanhoJson(dadosOriginais);
  item.dados = `[evento truncado: ${bytesDados} bytes descartados]`;
  const linha = serializarTruncado(item, bytesOriginais);
  return linha && Buffer.byteLength(linha, "utf8") <= MAX_EVENTO_BYTES ? linha : null;
}

// A coleta só existe quando a configuração diz que está ativa: obrigatória no build oficial,
// desligável por MEDIUM_LATENS_COLETA=desligada num checkout do fonte (spec de abertura, 6.2).
function ativa() {
  return settings.load().coletaAtiva === true;
}

function evento(tipo, dados) {
  try {
    if (!ativa()) return;
    if (!aceito()) return;
    garantir();
    const item = {
      em: new Date().toISOString(),
      instalacao: instalacaoId(),
      tipo: limparTexto(tipo, MAX_TIPO_BYTES),
      dados: limpar(dados),
    };
    let linha = JSON.stringify(item);
    const bytesOriginais = Buffer.byteLength(linha, "utf8");
    if (bytesOriginais > MAX_EVENTO_BYTES) linha = limitarItem(item, bytesOriginais);
    if (!linha || Buffer.byteLength(linha, "utf8") > MAX_EVENTO_BYTES) return;
    try { fs.chmodSync(FILA, 0o600); } catch (erro) { if (erro.code !== "ENOENT") throw erro; }
    fs.appendFileSync(FILA, linha + "\n", { mode: 0o600 });
    fs.chmodSync(FILA, 0o600);
    podar();
  } catch {}
}

function fila() {
  return linhasValidas().map((linha) => JSON.parse(linha));
}

function linhasValidas() {
  try {
    return fs.readFileSync(FILA, "utf8").split("\n").filter(Boolean)
      .filter((linha) => {
        if (Buffer.byteLength(linha, "utf8") > MAX_EVENTO_BYTES) return false;
        try { JSON.parse(linha); return true; } catch { return false; }
      });
  } catch { return []; }
}

function podar() {
  try {
    garantir();
    const linhas = fs.readFileSync(FILA, "utf8").split("\n").filter(Boolean);
    const validas = linhasValidas();
    if (validas.length <= MAX_ITENS && validas.length === linhas.length) return;
    const cortadas = validas.slice(-MAX_ITENS);
    try { fs.chmodSync(FILA, 0o600); } catch (erro) { if (erro.code !== "ENOENT") throw erro; }
    fs.writeFileSync(FILA, cortadas.join("\n") + "\n", { mode: 0o600 });
    fs.chmodSync(FILA, 0o600);
  } catch {}
}

function remover(linhas) {
  try {
    garantir();
    const lote = Array.isArray(linhas) ? linhas : [];
    const atuais = linhasValidas();
    const prefixoIgual = lote.length <= atuais.length
      && lote.every((linha, indice) => linha === atuais[indice]);
    if (!prefixoIgual) return { removidas: 0, motivo: "prefixo mudou" };
    const restantes = atuais.slice(lote.length);
    try { fs.chmodSync(FILA, 0o600); } catch (erro) { if (erro.code !== "ENOENT") throw erro; }
    fs.writeFileSync(FILA, restantes.length ? restantes.join("\n") + "\n" : "", { mode: 0o600 });
    fs.chmodSync(FILA, 0o600);
    return { removidas: lote.length };
  } catch {
    return { removidas: 0, motivo: "erro" };
  }
}

module.exports = {
  instalacaoId, aceiteInfo, aceito, ativa, registrarAceite, limpar, evento, fila, linhasValidas, podar, remover,
  MAX_ITENS, MAX_EVENTO_BYTES, PROIBIDOS, DIR, FILA,
};
