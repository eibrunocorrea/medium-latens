"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const build = require("../lib/build");

function pastaTemporaria(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-build-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("sem arquivo BUILD o build não é oficial", (t) => {
  const dir = pastaTemporaria(t);
  assert.deepEqual(build.lerBuild(dir), { oficial: false });
});

test("BUILD válido é oficial e traz data e commit", (t) => {
  const dir = pastaTemporaria(t);
  fs.writeFileSync(path.join(dir, "BUILD"), '{"oficial": true, "data": "2026-09-06T20:00:00Z", "commit": "abc1234"}\n');
  assert.deepEqual(build.lerBuild(dir), { oficial: true, data: "2026-09-06T20:00:00Z", commit: "abc1234" });
});

test("BUILD sem data ou commit continua oficial, com os campos nulos", (t) => {
  const dir = pastaTemporaria(t);
  fs.writeFileSync(path.join(dir, "BUILD"), '{"oficial": true}');
  assert.deepEqual(build.lerBuild(dir), { oficial: true, data: null, commit: null });
});

test("BUILD corrompido, com oficial falso, string, lista ou vazio não é oficial", (t) => {
  const dir = pastaTemporaria(t);
  for (const conteudo of ["{ não é json", '{"oficial": false}', '{"oficial": "true"}', "[true]", "null", ""]) {
    fs.writeFileSync(path.join(dir, "BUILD"), conteudo);
    assert.deepEqual(build.lerBuild(dir), { oficial: false }, `conteúdo: ${JSON.stringify(conteudo)}`);
  }
});

test("MEDIUM_LATENS_BUILD_FILE aponta o carimbo quando appDir não é informado", (t) => {
  const dir = pastaTemporaria(t);
  const arquivo = path.join(dir, "carimbo.json");
  fs.writeFileSync(arquivo, '{"oficial": true}');
  const anterior = process.env.MEDIUM_LATENS_BUILD_FILE;
  process.env.MEDIUM_LATENS_BUILD_FILE = arquivo;
  t.after(() => {
    if (anterior === undefined) delete process.env.MEDIUM_LATENS_BUILD_FILE;
    else process.env.MEDIUM_LATENS_BUILD_FILE = anterior;
  });
  assert.deepEqual(build.lerBuild(), { oficial: true, data: null, commit: null });
});

test("o repositório não versiona BUILD e um checkout do fonte não o possui", () => {
  const gitignore = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
  assert.match(gitignore, /^BUILD$/m);
  assert.equal(build.ARQUIVO, path.join(__dirname, "..", "BUILD"));
  assert.equal(fs.existsSync(build.ARQUIVO), false);
});
