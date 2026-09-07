"use strict";
/**
 * lib/paths.js , as duas raízes do app.
 * APP_DIR  = onde o programa está instalado. Substituível a cada atualização.
 * USER_DIR = onde vive o estado do usuário. Nunca tocado por atualização nem desinstalação.
 * Regra inegociável: nenhum caminho deste app sobe acima de APP_DIR.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_DIR = path.join(__dirname, "..");

function resolveUserDir(env, platform, home) {
  env = env || process.env;
  platform = platform || process.platform;
  home = home || os.homedir();
  const p = platform === "win32" ? path.win32 : path.posix;
  if (env.MEDIUM_LATENS_USER_DIR) return env.MEDIUM_LATENS_USER_DIR;
  if (platform === "win32") {
    const base = env.APPDATA || p.join(home, "AppData", "Roaming");
    return p.join(base, "Medium Latens");
  }
  return p.join(home, ".medium-latens");
}

const USER_DIR = resolveUserDir();

function resolvePythonInterpreter(env, platform, home) {
  platform = platform || process.platform;
  const p = platform === "win32" ? path.win32 : path.posix;
  const dir = resolveUserDir(env, platform, home);
  return platform === "win32"
    ? p.join(dir, "venv", "Scripts", "python.exe")
    : p.join(dir, "venv", "bin", "python3");
}

const PYTHON_INTERPRETER = resolvePythonInterpreter();

function filesFor(dir) {
  return {
    config: path.join(dir, "config.json"),
    profiles: path.join(dir, "profiles.json"),
    credentials: path.join(dir, "credentials.json"),
    env: path.join(dir, ".env"),
    hotwords: path.join(dir, "hotwords.txt"),
    token: path.join(dir, "token"),
    mcpConfig: path.join(dir, "mcp-config.json"),
    workspaces: path.join(dir, "workspaces"),
    data: path.join(dir, "data"),
    logs: path.join(dir, "logs"),
  };
}

const FILES = filesFor(USER_DIR);

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

function ensureUserDir(dir) {
  const target = dir || USER_DIR;
  const f = filesFor(target);
  for (const d of [target, f.workspaces, f.data, f.logs]) ensurePrivateDir(d);
  return target;
}

function workspaceDir(slug, dir) {
  const normalized = String(slug);
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error("slug inválido");
  }
  return path.join(dir || USER_DIR, "workspaces", normalized);
}

module.exports = {
  APP_DIR,
  USER_DIR,
  PYTHON_INTERPRETER,
  FILES,
  filesFor,
  resolveUserDir,
  resolvePythonInterpreter,
  ensurePrivateDir,
  ensureUserDir,
  workspaceDir,
};
