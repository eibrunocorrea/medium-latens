"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const termos = require("../lib/termos");

test("versão dos termos vem da primeira linha de TERMOS.md", () => {
  assert.equal(termos.ARQUIVO, path.join(__dirname, "..", "TERMOS.md"));
  assert.equal(termos.versao(), "2.0");
});

test("envio e status consultam a fonte única da versão dos termos", () => {
  const envio = fs.readFileSync(path.join(__dirname, "..", "lib", "envio.js"), "utf8");
  const status = fs.readFileSync(path.join(__dirname, "..", "lib", "status.js"), "utf8");

  assert.match(envio, /termos\.versao\(\)/);
  assert.match(status, /termos\.versao\(\)/);
  assert.doesNotMatch(envio, /const TERMOS\s*=/);
});

test("os termos 2.0 dizem o que a spec de abertura exige", () => {
  const texto = fs.readFileSync(termos.ARQUIVO, "utf8");
  assert.match(texto, /^# Termos de uso do Medium Latens \(versão 2\.0\)/);
  assert.match(texto, /AGPL-3\.0/);
  assert.match(texto, /https:\/\/github\.com\/eibrunocorrea\/medium-latens/);
  assert.match(texto, /## Código aberto e receptor de coleta/);
  assert.match(texto, /não é publicado/);
  assert.match(texto, /higienizados e publicados/);
  assert.match(texto, /## Builds a partir do código-fonte/);
  assert.match(texto, /MEDIUM_LATENS_COLETA=desligada/);
  assert.match(texto, /coleta\.torremaster\.com/);
  assert.match(texto, /contato@mediumlatens\.com/);
  assert.match(texto, /ENGLISH SUMMARY/);
  assert.match(texto, /aparência de segredo/);
  assert.doesNotMatch(texto, /chaves de API nunca são enviados/);
  assert.doesNotMatch(texto, /Proibido vender, redistribuir/);
  assert.doesNotMatch(texto, /\u2014/);
});
