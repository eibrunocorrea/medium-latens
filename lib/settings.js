"use strict";
/**
 * lib/settings.js — settings do painel persistidos server-side (config.json, gitignored).
 * O CEP perde localStorage ao reinstalar o painel; o server é a fonte da verdade.
 * F6 adiciona providers de imagem/voz aqui; F7 adiciona o provider LLM.
 */
const fs = require("fs");
const { FILES, ensureUserDir } = require("./paths");
const build = require("./build");

ensureUserDir();
const FILE = process.env.MEDIUM_LATENS_CONFIG_FILE || FILES.config;
const DEFAULTS = {
  model: "",
  effort: "high",
  profile: "padrao",
  provider: "claude",
  coletaUrl: "https://coleta.torremaster.com/v1/eventos",
};
// Motivos do estado da coleta (spec de abertura, seção 6.2). A página de status traduz cada um.
const MOTIVOS = Object.freeze({
  oficial: "obrigatoria-build-oficial",
  desligada: "desligada-por-ambiente",
  fonte: "ativa-build-fonte",
});
let cache = null;

function readStored() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return {}; }
}

function loadFile() {
  if (cache) return cache;
  cache = { ...DEFAULTS, ...readStored() };
  return cache;
}

function estadoColeta(env, oficial) {
  if (oficial) return { coletaAtiva: true, coletaMotivo: MOTIVOS.oficial };
  if (env.MEDIUM_LATENS_COLETA === "desligada") return { coletaAtiva: false, coletaMotivo: MOTIVOS.desligada };
  return { coletaAtiva: true, coletaMotivo: MOTIVOS.fonte };
}

function validarColetaUrl(valor) {
  if (valor === "") return { coletaUrl: "", coletaUrlInvalida: false };
  if (typeof valor !== "string" || /\s/.test(valor)) {
    return { coletaUrl: null, coletaUrlInvalida: true };
  }
  try {
    const url = new URL(valor);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      return { coletaUrl: null, coletaUrlInvalida: true };
    }
    return { coletaUrl: url.href, coletaUrlInvalida: false };
  } catch {
    return { coletaUrl: null, coletaUrlInvalida: true };
  }
}

function load(opcoes) {
  const opts = opcoes || {};
  const env = opts.env || process.env;
  const config = { ...loadFile() };
  if (Object.prototype.hasOwnProperty.call(env, "MEDIUM_LATENS_COLETA_URL")) {
    config.coletaUrl = env.MEDIUM_LATENS_COLETA_URL;
  }
  Object.assign(config, validarColetaUrl(config.coletaUrl));
  const oficial = opts.build ? opts.build.oficial === true : build.lerBuild().oficial === true;
  Object.assign(config, estadoColeta(env, oficial));
  return config;
}

function save(patch) {
  const stored = { ...readStored(), ...patch };
  fs.writeFileSync(FILE, JSON.stringify(stored, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(FILE, 0o600);
  cache = { ...DEFAULTS, ...stored };
  return load();
}

module.exports = { load, save, validarColetaUrl, DEFAULTS, MOTIVOS };
