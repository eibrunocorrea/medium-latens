"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const REQUIREMENTS = path.join(RAIZ, "engine", "requirements.txt");

test("todas as dependências Python têm versão fixada e marcadores válidos", () => {
  const texto = fs.readFileSync(REQUIREMENTS, "utf8");
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  assert.ok(linhas.length >= 4, "esperava ao menos quatro dependências");
  for (const linha of linhas) {
    assert.match(linha, /^[A-Za-z0-9][A-Za-z0-9._-]*==\d+(\.\d+)+(\S*)?(\s*;\s*\S.*)?$/, `sem pin exato: ${linha}`);
  }
  const nomes = linhas.map((l) => l.split("==")[0].toLowerCase());
  for (const esperado of ["numpy", "opencv-python-headless", "mlx-whisper", "faster-whisper"]) {
    assert.ok(nomes.includes(esperado), `faltou ${esperado}`);
  }
  assert.match(texto, /mlx-whisper==[^;\n]+;\s*sys_platform == "darwin" and platform_machine == "arm64"/);
  assert.match(texto, /faster-whisper==[^;\n]+;\s*sys_platform != "darwin" or platform_machine != "arm64"/);
});

test("os bootstraps instalam a partir do requirements.txt, sem pacote solto", () => {
  const sh = fs.readFileSync(path.join(RAIZ, "installer", "bootstrap.sh"), "utf8");
  const ps1 = fs.readFileSync(path.join(RAIZ, "installer", "bootstrap.ps1"), "utf8");
  assert.match(sh, /pip" install --quiet -r "\$APP_DIR\/engine\/requirements\.txt"/);
  assert.doesNotMatch(sh, /pip" install --quiet[^\n]*\b(numpy|opencv-python-headless|mlx-whisper|faster-whisper)\b/);
  assert.match(ps1, /pip\.exe" install --quiet -r "\$AppDir\\engine\\requirements\.txt"/);
  assert.doesNotMatch(ps1, /pip\.exe" install --quiet[^\n]*\b(numpy|opencv-python-headless|faster-whisper)\b/);
});
