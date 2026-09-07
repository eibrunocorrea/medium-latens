"use strict";
/**
 * lib/userenv.js , carrega variáveis do .env DO USUÁRIO, e de nenhum outro lugar.
 * Antes da extração o servidor lia o .env do hub pessoal e injetava dezenas de chaves
 * no processo. Aqui o caminho é sempre explícito e vive dentro de USER_DIR.
 */
const fs = require("fs");
const { FILES } = require("./paths");

function valorDaLinha(bruto) {
  const valor = bruto.trim();
  const aspa = valor[0];
  if (aspa === '"' || aspa === "'") {
    const fechamento = valor.indexOf(aspa, 1);
    return valor.slice(1, fechamento === -1 ? undefined : fechamento);
  }
  const comentario = valor.search(/(?:^|[ \t])#/);
  return valor.slice(0, comentario === -1 ? undefined : comentario).trim();
}

function load(target, file) {
  const alvo = target || process.env;
  const caminho = file || FILES.env;
  let n = 0;
  let texto;
  try { texto = fs.readFileSync(caminho, "utf8"); } catch { return 0; }
  for (const linha of texto.split(/\r?\n/)) {
    const m = linha.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    if (alvo[m[1]] !== undefined) continue;
    alvo[m[1]] = valorDaLinha(m[2]);
    n++;
  }
  return n;
}

module.exports = { load };
