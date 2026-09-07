"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const paths = require("../lib/paths");
const BITS_POSIX = process.platform !== "win32"; // NTFS não expõe bits de modo; a proteção vem da ACL do perfil do usuário

test("resolveUserDir: macOS usa ~/.medium-latens", () => {
  assert.equal(paths.resolveUserDir({}, "darwin", "/Users/ana"), "/Users/ana/.medium-latens");
});

test("resolveUserDir: Windows usa APPDATA", () => {
  const r = paths.resolveUserDir({ APPDATA: "C:\\Users\\Ana\\AppData\\Roaming" }, "win32", "C:\\Users\\Ana");
  assert.equal(r, path.win32.join("C:\\Users\\Ana\\AppData\\Roaming", "Medium Latens"));
});

test("resolveUserDir: Windows sem APPDATA usa AppData/Roaming do home", () => {
  const home = "C:\\Users\\Ana";
  assert.equal(
    paths.resolveUserDir({}, "win32", home),
    path.win32.join(home, "AppData", "Roaming", "Medium Latens"),
  );
});

test("resolveUserDir: variável de ambiente tem prioridade", () => {
  assert.equal(paths.resolveUserDir({ MEDIUM_LATENS_USER_DIR: "/tmp/x" }, "darwin", "/Users/ana"), "/tmp/x");
});

test("resolvePythonInterpreter: macOS usa o venv da pasta do usuário", () => {
  assert.equal(
    paths.resolvePythonInterpreter({}, "darwin", "/Users/ana"),
    path.posix.join("/Users/ana", ".medium-latens", "venv", "bin", "python3"),
  );
});

test("resolvePythonInterpreter: Windows usa Scripts e python.exe", () => {
  const appData = "C:\\Users\\Ana\\AppData\\Roaming";
  assert.equal(
    paths.resolvePythonInterpreter({ APPDATA: appData }, "win32", "C:\\Users\\Ana"),
    path.win32.join(appData, "Medium Latens", "venv", "Scripts", "python.exe"),
  );
});

test("APP_DIR é a raiz da instalação e contém o server.js", () => {
  assert.ok(fs.existsSync(path.join(paths.APP_DIR, "server.js")));
});

test("ensureUserDir cria e repara as pastas de estado com permissão 700", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-"));
  fs.chmodSync(tmp, 0o755);
  const dirs = paths.ensureUserDir(tmp);
  for (const dir of [tmp, path.join(tmp, "workspaces"), path.join(tmp, "data"), path.join(tmp, "logs")]) {
    assert.ok(fs.existsSync(dir));
    if (BITS_POSIX) {
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    }
  }
  assert.equal(dirs, tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("workspaceDir monta caminho dentro de workspaces", () => {
  assert.equal(paths.workspaceDir("meu-video", "/tmp/u"), path.join("/tmp/u", "workspaces", "meu-video"));
});

test("workspaceDir: slug guard contra path traversal", () => {
  assert.throws(() => paths.workspaceDir("../../etc/evil", "/Users/ana/.medium-latens"), /slug inválido/);
  assert.throws(() => paths.workspaceDir("/etc/passwd", "/Users/ana/.medium-latens"), /slug inválido/);
  assert.throws(() => paths.workspaceDir("", "/Users/ana/.medium-latens"), /slug inválido/);
  assert.throws(() => paths.workspaceDir(null, "/Users/ana/.medium-latens"), /slug inválido/);
  assert.equal(
    paths.workspaceDir("meu-video", "/Users/ana/.medium-latens"),
    path.join("/Users/ana/.medium-latens", "workspaces", "meu-video"),
  );
});
