"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const LICENSE = path.join(__dirname, "..", "LICENSE");

test("LICENSE é o texto oficial da AGPL-3.0", () => {
  const texto = fs.readFileSync(LICENSE, "utf8");
  assert.match(texto, /^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s*\n\s*Version 3, 19 November 2007/);
  assert.match(texto, /Copyright \(C\) 2007 Free Software Foundation, Inc\./);
  assert.match(texto, /13\. Remote Network Interaction; Use with the GNU General Public License\./);
  assert.match(texto, /END OF TERMS AND CONDITIONS/);
  assert.match(texto, /How to Apply These Terms to Your New Programs/);
  const linhas = texto.split("\n").length;
  assert.ok(linhas > 600 && linhas < 700, `tamanho inesperado: ${linhas} linhas`);
});

test("a licença própria de 2026-08-24 não existe mais", () => {
  const texto = fs.readFileSync(LICENSE, "utf8");
  assert.doesNotMatch(texto, /PROIBIDO, sem autorização escrita/);
  assert.doesNotMatch(texto, /Todos os direitos reservados/);
});
