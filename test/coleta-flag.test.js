"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-flag-"));
process.env.MEDIUM_LATENS_USER_DIR = USER_DIR;
const SEM_CARIMBO = path.join(USER_DIR, "BUILD-inexistente");
const CARIMBO = path.join(USER_DIR, "BUILD-oficial");
fs.writeFileSync(CARIMBO, '{"oficial": true, "data": "2026-09-06T20:00:00Z", "commit": "abc1234"}');
process.env.MEDIUM_LATENS_BUILD_FILE = SEM_CARIMBO;
delete process.env.MEDIUM_LATENS_COLETA;

const settings = require("../lib/settings");
const telemetria = require("../lib/telemetria");
const envio = require("../lib/envio");

test.after(() => fs.rmSync(USER_DIR, { recursive: true, force: true }));

function comoFonte() { process.env.MEDIUM_LATENS_BUILD_FILE = SEM_CARIMBO; }
function comoOficial() { process.env.MEDIUM_LATENS_BUILD_FILE = CARIMBO; }
function limparFila() { fs.rmSync(telemetria.FILA, { force: true }); }

test("build do fonte sem a variável: coleta ativa", () => {
  comoFonte();
  delete process.env.MEDIUM_LATENS_COLETA;
  const cfg = settings.load();
  assert.equal(cfg.coletaAtiva, true);
  assert.equal(cfg.coletaMotivo, settings.MOTIVOS.fonte);
});

test("build do fonte com MEDIUM_LATENS_COLETA=desligada: coleta desligada", () => {
  comoFonte();
  process.env.MEDIUM_LATENS_COLETA = "desligada";
  const cfg = settings.load();
  assert.equal(cfg.coletaAtiva, false);
  assert.equal(cfg.coletaMotivo, settings.MOTIVOS.desligada);
});

test("só a grafia exata desliga", () => {
  comoFonte();
  for (const valor of ["Desligada", "DESLIGADA", "off", "0", "false", " desligada", "desligada "]) {
    process.env.MEDIUM_LATENS_COLETA = valor;
    assert.equal(settings.load().coletaAtiva, true, `valor ${JSON.stringify(valor)} não deveria desligar`);
  }
});

test("build oficial ignora a variável", () => {
  comoOficial();
  process.env.MEDIUM_LATENS_COLETA = "desligada";
  const cfg = settings.load();
  assert.equal(cfg.coletaAtiva, true);
  assert.equal(cfg.coletaMotivo, settings.MOTIVOS.oficial);
});

test("load aceita env e build injetados", () => {
  const fonte = settings.load({ env: { MEDIUM_LATENS_COLETA: "desligada" }, build: { oficial: false } });
  assert.equal(fonte.coletaAtiva, false);
  const oficial = settings.load({ env: { MEDIUM_LATENS_COLETA: "desligada" }, build: { oficial: true } });
  assert.equal(oficial.coletaAtiva, true);
  assert.equal(oficial.coletaMotivo, "obrigatoria-build-oficial");
});

test("load aceita HTTPS e HTTP loopback, mas invalida outros destinos", () => {
  const aceitos = [
    "https://coleta.exemplo.test/v1/eventos",
    "http://127.0.0.1:1234/v1/eventos",
    "http://localhost:1234/v1/eventos",
  ];
  for (const coletaUrl of aceitos) {
    const cfg = settings.load({ env: { MEDIUM_LATENS_COLETA_URL: coletaUrl }, build: { oficial: false } });
    assert.equal(cfg.coletaUrl, coletaUrl);
    assert.equal(cfg.coletaUrlInvalida, false);
  }

  for (const coletaUrl of ["http://exemplo.com/v1/eventos", "ftp://exemplo.com/eventos", "não-é-url"]) {
    const cfg = settings.load({ env: { MEDIUM_LATENS_COLETA_URL: coletaUrl }, build: { oficial: false } });
    assert.equal(cfg.coletaUrl, null);
    assert.equal(cfg.coletaUrlInvalida, true);
  }
});

test("os três motivos têm os textos combinados com a spec", () => {
  assert.deepEqual(settings.MOTIVOS, {
    oficial: "obrigatoria-build-oficial",
    desligada: "desligada-por-ambiente",
    fonte: "ativa-build-fonte",
  });
});

test("com a coleta desligada, evento não grava nada mesmo depois do aceite", () => {
  comoFonte();
  process.env.MEDIUM_LATENS_COLETA = "desligada";
  limparFila();
  telemetria.registrarAceite("2.0");
  assert.equal(telemetria.ativa(), false);
  telemetria.evento("rota", { caminho: "/health" });
  assert.equal(telemetria.fila().length, 0);
  assert.equal(fs.existsSync(telemetria.FILA), false);
});

test("com a coleta ativa, o mesmo evento entra na fila", () => {
  comoFonte();
  delete process.env.MEDIUM_LATENS_COLETA;
  limparFila();
  telemetria.registrarAceite("2.0");
  assert.equal(telemetria.ativa(), true);
  telemetria.evento("rota", { caminho: "/health" });
  assert.equal(telemetria.fila().length, 1);
});

test("com a coleta desligada, enviarLote não chama a rede nem mexe na fila", async () => {
  comoFonte();
  delete process.env.MEDIUM_LATENS_COLETA;
  limparFila();
  telemetria.registrarAceite("2.0");
  telemetria.evento("rota", { caminho: "/health" });
  process.env.MEDIUM_LATENS_COLETA = "desligada";
  let chamadas = 0;
  const resultado = await envio.enviarLote({
    url: "http://127.0.0.1:1/v1/eventos",
    fetch: async () => { chamadas += 1; return { status: 200, json: async () => ({ ok: true, recebidos: 1 }) }; },
  });
  assert.deepEqual(resultado, { enviado: 0, motivo: "coleta_desligada" });
  assert.equal(chamadas, 0);
  assert.equal(telemetria.fila().length, 1, "a fila local não pode ser apagada por estar desligada");
});
