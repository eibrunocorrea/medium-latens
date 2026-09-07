"use strict";
/**
 * lib/credentials.js , chaves de API que o usuário cadastrou pelo assistente.
 * Regras: arquivo com permissão 600, chave nunca sai daqui para o painel, nunca
 * entra em log e nunca aparece em relatório de erro. Só o próprio servidor lê,
 * e só para falar com o provedor que o usuário escolheu.
 */
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { FILES, ensurePrivateDir } = require("./paths");
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const IDS_RESERVADOS = new Set(["__proto__", "constructor", "prototype"]);

function mask(key) {
  const s = String(key || "");
  return s.length < 12 ? "••••" : "••••" + s.slice(-4);
}

function idValido(id) {
  return typeof id === "string" && ID_PATTERN.test(id) && !IDS_RESERVADOS.has(id);
}

function validarId(id, tipo = "conta") {
  if (!idValido(id)) {
    throw new Error(`identificador de ${tipo} inválido`);
  }
  return id;
}

function ler(file) {
  const alvo = file || FILES.credentials;
  try {
    const dados = JSON.parse(fs.readFileSync(alvo, "utf8"));
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw new Error("formato inválido");
    return Object.assign(Object.create(null), dados);
  } catch (erro) {
    if (erro && erro.code === "ENOENT") return Object.create(null);
    throw new Error(`O arquivo de credenciais não pôde ser lido: ${alvo}`);
  }
}

function ajustarPermissao(alvo, caminhoExibido) {
  try {
    fs.chmodSync(alvo, 0o600);
  } catch (erro) {
    console.error(`Aviso: não foi possível ajustar a permissão do arquivo de credenciais: ${caminhoExibido}`);
    throw erro;
  }
}

function gravar(dados, file) {
  const alvo = file || FILES.credentials;
  const temporario = path.join(
    path.dirname(alvo),
    `.${path.basename(alvo)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  ensurePrivateDir(path.dirname(alvo));
  try {
    fs.writeFileSync(temporario, JSON.stringify(dados, null, 2), { mode: 0o600, flag: "wx" });
    ajustarPermissao(temporario, alvo);
    fs.renameSync(temporario, alvo);
  } catch (erro) {
    try {
      fs.unlinkSync(temporario);
    } catch (limpezaErro) {
      if (!limpezaErro || limpezaErro.code !== "ENOENT") {
        console.error(`Aviso: não foi possível remover o arquivo temporário de credenciais: ${temporario}`);
      }
    }
    throw erro;
  }
}

function publico(id, e) {
  return { id, provider: e.provider, endpoint: e.endpoint || null, model: e.model || null, masked: mask(e.key) };
}

function save(entrada, file) {
  validarId(entrada && entrada.id);
  const dados = ler(file);
  dados[entrada.id] = {
    provider: entrada.provider,
    endpoint: entrada.endpoint || null,
    model: entrada.model || null,
    key: entrada.key,
  };
  gravar(dados, file);
  return publico(entrada.id, dados[entrada.id]);
}

function get(id, file) {
  if (!idValido(id)) return null;
  const e = ler(file)[id];
  return e ? { id, provider: e.provider, endpoint: e.endpoint, model: e.model, key: e.key } : null;
}

function list(file) {
  const dados = ler(file);
  return Object.keys(dados).map((id) => publico(id, dados[id]));
}

function remove(id, file) {
  if (!idValido(id)) return false;
  const dados = ler(file);
  if (!dados[id]) return false;
  delete dados[id];
  gravar(dados, file);
  return true;
}

module.exports = { save, get, list, remove, mask, idValido, validarId, ID_PATTERN, IDS_RESERVADOS };
