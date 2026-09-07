"use strict";
/**
 * lib/build.js, o carimbo de build oficial.
 * installer/macos/build.sh e installer/windows/build.ps1 gravam BUILD ao lado de VERSION dentro
 * do pacote. Um checkout do código-fonte nunca tem esse arquivo (está no .gitignore), e é essa
 * ausência que distingue "build do fonte" de "build oficial" (spec de abertura, seção 6.2).
 */
const fs = require("fs");
const path = require("path");
const { APP_DIR } = require("./paths");

const ARQUIVO = path.join(APP_DIR, "BUILD");
const NAO_OFICIAL = Object.freeze({ oficial: false });

function arquivoDoBuild(appDir) {
  if (appDir) return path.join(appDir, "BUILD");
  return process.env.MEDIUM_LATENS_BUILD_FILE || ARQUIVO;
}

function lerBuild(appDir) {
  let bruto;
  try { bruto = fs.readFileSync(arquivoDoBuild(appDir), "utf8"); } catch { return NAO_OFICIAL; }
  let dados;
  try { dados = JSON.parse(bruto); } catch { return NAO_OFICIAL; }
  if (!dados || typeof dados !== "object" || Array.isArray(dados) || dados.oficial !== true) return NAO_OFICIAL;
  return {
    oficial: true,
    data: typeof dados.data === "string" ? dados.data : null,
    commit: typeof dados.commit === "string" ? dados.commit : null,
  };
}

module.exports = { ARQUIVO, lerBuild };
