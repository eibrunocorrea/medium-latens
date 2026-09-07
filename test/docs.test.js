"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const DOCS = [
  "README.md", "README.pt-BR.md", "CONTRIBUTING.md", "CONTRIBUTING.pt-BR.md",
  "SECURITY.md", "SECURITY.pt-BR.md", "CLA.md", "TERMOS.md", "docs/coleta.md", "CHANGELOG.md",
];
const PARES = [
  ["README.md", "README.pt-BR.md"],
  ["CONTRIBUTING.md", "CONTRIBUTING.pt-BR.md"],
  ["SECURITY.md", "SECURITY.pt-BR.md"],
  ["CODE_OF_CONDUCT.md", "CODE_OF_CONDUCT.pt-BR.md"],
];

function linksRelativos(texto) {
  const links = [];
  for (const m of texto.matchAll(/\]\(([^)\s]+)\)/g)) {
    const alvo = m[1];
    if (/^(https?:|mailto:|#)/.test(alvo)) continue;
    links.push(alvo.split("#")[0]);
  }
  return links;
}

test("todo link relativo da documentação aponta para um arquivo que existe", () => {
  for (const doc of DOCS) {
    const texto = fs.readFileSync(path.join(RAIZ, doc), "utf8");
    for (const alvo of linksRelativos(texto)) {
      const resolvido = path.resolve(path.dirname(path.join(RAIZ, doc)), alvo);
      assert.ok(fs.existsSync(resolvido), `${doc}: link quebrado para ${alvo}`);
    }
  }
});

test("cada par bilíngue aponta para o outro lado", () => {
  for (const [ingles, portugues] of PARES) {
    assert.match(fs.readFileSync(path.join(RAIZ, ingles), "utf8"), new RegExp(portugues.replace(/\./g, "\\.")));
    assert.match(fs.readFileSync(path.join(RAIZ, portugues), "utf8"), new RegExp(ingles.replace(/\./g, "\\.")));
  }
});

test("documentos de autoria do projeto não têm travessão nem caminho de máquina", () => {
  for (const doc of DOCS) {
    const texto = fs.readFileSync(path.join(RAIZ, doc), "utf8");
    assert.doesNotMatch(texto, /\u2014/, `${doc} tem travessão`);
    assert.doesNotMatch(texto, /\/Users\/[a-z]/i, `${doc} tem caminho de máquina`);
    assert.doesNotMatch(texto, /159\.65\.|personamovies|Redes Sociais/, `${doc} tem identificador pessoal`);
  }
});

test("o README fala de licença, coleta, origem e contribuição, nos dois idiomas", () => {
  const en = fs.readFileSync(path.join(RAIZ, "README.md"), "utf8");
  const pt = fs.readFileSync(path.join(RAIZ, "README.pt-BR.md"), "utf8");
  for (const [texto, secoes] of [[en, ["## What it does", "## Usage collection and privacy", "## Origins", "## Contributing", "## License"]], [pt, ["## O que ele faz", "## Coleta de uso e privacidade", "## Origem", "## Como contribuir", "## Licença"]]]) {
    for (const secao of secoes) assert.match(texto, new RegExp(`^${secao.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    assert.match(texto, /AGPL-3\.0/);
    assert.match(texto, /Criado por Bruno Correa/);
    assert.match(texto, /docs\/coleta\.md/);
  }
});

test("o CLA mantém títulos e instruções de assinatura nos dois idiomas", () => {
  const cla = fs.readFileSync(path.join(RAIZ, "CLA.md"), "utf8");
  assert.match(cla, /^# Acordo de Licença de Contribuidor Individual/m);
  assert.match(cla, /^## Como assinar$/m);
  assert.match(cla, /^# Medium Latens Individual Contributor License Agreement/m);
  assert.match(cla, /^## How to sign$/m);
});
