"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("node:vm");
const paths = require("../lib/paths");

const serverFile = path.join(paths.APP_DIR, "server.js");
const serverSource = fs.readFileSync(serverFile, "utf8");

test("PATH começa em USER_DIR/bin depois de carregar a configuração do servidor", () => {
  const assignment = serverSource.match(/^process\.env\.PATH = .*$/m);
  assert.ok(assignment, "configuração do PATH não encontrada");
  const userDir = path.join(os.tmpdir(), "medium-latens-path-test");
  const sandbox = {
    path,
    USER_DIR: userDir,
    process: { env: { PATH: "/usr/bin:/bin" } },
  };

  vm.runInNewContext(assignment[0], sandbox);

  assert.equal(sandbox.process.env.PATH, `${path.join(userDir, "bin")}${path.delimiter}/usr/bin:/bin`);
});

function loadWorkspaceState(userDir) {
  const start = serverSource.indexOf("let busy = false");
  const end = serverSource.indexOf("function emit(ev)");
  assert.ok(start >= 0 && end > start, "bloco de estado do servidor não encontrado");

  const sandbox = {
    fs,
    FILES: { workspaces: path.join(userDir, "workspaces") },
    workspaceDir: (slug) => paths.workspaceDir(slug, userDir),
  };
  vm.runInNewContext(`${serverSource.slice(start, end)}\n` +
    "globalThis.workspaceState = { lembrarSlug, agentCwd, getLastSlug: () => lastSlug };", sandbox);
  return sandbox.workspaceState;
}

test("slug válido vira o projeto ativo", () => {
  const state = loadWorkspaceState(fs.mkdtempSync(path.join(os.tmpdir(), "mlat-cwd-")));
  assert.equal(state.lembrarSlug("meu-projeto-a1b2c3d4"), "meu-projeto-a1b2c3d4");
  assert.equal(state.getLastSlug(), "meu-projeto-a1b2c3d4");
});

test("slug com travessia não vira o projeto ativo nem lança", () => {
  const state = loadWorkspaceState(fs.mkdtempSync(path.join(os.tmpdir(), "mlat-cwd-")));
  assert.doesNotThrow(() => state.lembrarSlug("../../etc"));
  assert.equal(state.getLastSlug(), null);
});

test("slug com maiúscula ou sublinhado não vira o projeto ativo nem lança", () => {
  const state = loadWorkspaceState(fs.mkdtempSync(path.join(os.tmpdir(), "mlat-cwd-")));
  assert.doesNotThrow(() => state.lembrarSlug("Meu-Projeto"));
  assert.equal(state.getLastSlug(), null);
  assert.doesNotThrow(() => state.lembrarSlug("meu_projeto"));
  assert.equal(state.getLastSlug(), null);
});

test("slug null não vira o projeto ativo", () => {
  const state = loadWorkspaceState(fs.mkdtempSync(path.join(os.tmpdir(), "mlat-cwd-")));
  assert.equal(state.lembrarSlug(null), null);
  assert.equal(state.getLastSlug(), null);
});

test("sem projeto ativo, cwd é a raiz de workspaces", () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-cwd-"));
  const state = loadWorkspaceState(userDir);
  assert.equal(state.agentCwd(), path.join(userDir, "workspaces"));
  assert.equal((serverSource.match(/cwd: agentCwd\(\)/g) || []).length, 3,
    "chat, geração de brief e resumo devem usar o cwd do projeto ativo");
});

test("com projeto ativo, cwd é a pasta do projeto e ela é criada", () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-cwd-"));
  const state = loadWorkspaceState(userDir);
  state.lembrarSlug("meu-projeto-a1b2c3d4");

  const cwd = state.agentCwd();

  assert.equal(cwd, path.join(userDir, "workspaces", "meu-projeto-a1b2c3d4"));
  assert.ok(fs.statSync(cwd).isDirectory());
});
