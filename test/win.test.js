"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const win = require("../lib/win");
const SO_FORA_WINDOWS = process.platform === "win32" ? "testa o caminho fora do Windows" : false;

// Shim real do cmd-shim do npm (formato padrão): contém "%dp0%\node.exe"
// ANTES da linha de invocação — o parser tem que pular o .exe e capturar o JS.
const SHIM_PADRAO = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  "IF EXIST \"%dp0%\\node.exe\" (",
  "  SET \"_prog=%dp0%\\node.exe\"",
  ") ELSE (",
  "  SET \"_prog=node\"",
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  "endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js\" %*",
  "",
].join("\r\n");

test("parseShimJsRelpath: shim padrão do npm captura o cli.js, não o node.exe", () => {
  const rel = win.parseShimJsRelpath(SHIM_PADRAO);
  assert.equal(rel, "node_modules\\@anthropic-ai\\claude-code\\cli.js");
});

test("parseShimJsRelpath: variante %~dp0 de alguns geradores também casa", () => {
  const shim = "@\"%~dp0\\node_modules\\codex\\bin\\codex.js\" %*\r\n";
  assert.equal(win.parseShimJsRelpath(shim), "node_modules\\codex\\bin\\codex.js");
});

test("parseShimJsRelpath: shim sem token %dp0% devolve null", () => {
  const shim = "@ECHO off\r\nnode \"C:\\ferramentas\\cli.js\" %*\r\n";
  assert.equal(win.parseShimJsRelpath(shim), null);
  assert.equal(win.parseShimJsRelpath(""), null);
  assert.equal(win.parseShimJsRelpath(null), null);
});

test("resolveWinJsEntry: PATH sem shim devolve null, nunca lança", () => {
  assert.equal(win.resolveWinJsEntry("comando-inexistente-xyz", "/tmp;/usr/bin"), null);
  assert.equal(win.resolveWinJsEntry("claude", ""), null);
  assert.equal(win.resolveWinJsEntry("claude", null), null);
});

test("winTarget resolve executável sem shell e preserva argumento com metacaractere", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-win-exe-"));
  const executable = path.join(dir, "claude.exe");
  fs.writeFileSync(executable, "");
  const dangerous = "texto & calc";

  const target = win.winTarget("claude", [dangerous], { env: { PATH: dir }, shell: true });

  assert.equal(target.cmd, executable);
  assert.deepEqual(target.args, [dangerous]);
  assert.equal(target.opts.shell, undefined);
});

test("winTarget recusa cmd não padrão em vez de depender de shell", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-win-cmd-"));
  fs.writeFileSync(path.join(dir, "gemini.cmd"), "@echo off\r\ngemini.exe %*\r\n");

  assert.throws(
    () => win.winTarget("gemini", ["prompt & calc"], { env: { PATH: dir } }),
    /Não encontrei o comando gemini\. Execute o instalador de novo\./,
  );
});

test("winTarget falha claramente quando não encontra comando", () => {
  assert.throws(
    () => win.winTarget("claude", ["prompt & calc"], { env: { PATH: "/não-existe" } }),
    /Não encontrei o comando claude\. Execute o instalador de novo\./,
  );
});

test("spawnCli fora do win32: passthrough puro de spawn (stdout intacto)", { skip: SO_FORA_WINDOWS }, async () => {
  assert.equal(win.IS_WIN, false);
  const child = win.spawnCli(process.execPath, ["-e", "console.log(1)"], { stdio: ["ignore", "pipe", "pipe"] });
  const saida = await new Promise((resolve, reject) => {
    let buf = "";
    child.stdout.on("data", (chunk) => { buf += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(buf) : reject(new Error("exit " + code))));
  });
  assert.equal(saida.trim(), "1");
});
