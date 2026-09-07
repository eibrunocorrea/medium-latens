"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ARQUIVO = path.join(__dirname, "..", "TERMOS.md");

function versao() {
  const primeiraLinha = fs.readFileSync(ARQUIVO, "utf8").split(/\r?\n/, 1)[0];
  const match = primeiraLinha.match(/\(versão ([0-9]+(?:\.[0-9]+)*)\)/);
  if (!match) {
    throw new Error(`Não foi possível identificar a versão dos termos em ${ARQUIVO}.`);
  }
  return match[1];
}

module.exports = { ARQUIVO, versao };
