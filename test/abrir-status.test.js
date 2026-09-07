"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..");
const ABRIR_STATUS = path.join(REPO_ROOT, "status", "abrir.sh");
const SEM_LANCADOR_BASH_MACOS = process.platform === "win32" ? "executa o lançador bash do macOS com shims de launchctl" : false;

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function createSandbox(t, healthMode, token, launchctlMode = "ok") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const home = path.join(root, "home");
  const userDir = path.join(root, "user");
  const shims = path.join(root, "shims");
  const callsLog = path.join(root, "calls.log");
  const started = path.join(root, "started");
  const port = 48765;
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(shims, { recursive: true });
  fs.writeFileSync(callsLog, "");
  fs.writeFileSync(path.join(userDir, "token"), token);

  writeExecutable(path.join(shims, "curl"), `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$CALLS_LOG"
case "$HEALTH_MODE" in
  ok) exit 0 ;;
  after-kickstart) [ -f "$STARTED" ] ;;
  *) exit 22 ;;
esac
`);
  writeExecutable(path.join(shims, "launchctl"), `#!/bin/sh
printf 'launchctl %s\\n' "$*" >> "$CALLS_LOG"
case "$LAUNCHCTL_MODE:$1" in
  fail-kickstart:kickstart) exit 1 ;;
  fail-kickstart:bootstrap) touch "$STARTED"; exit 0 ;;
  *) touch "$STARTED"; exit 0 ;;
esac
`);
  writeExecutable(path.join(shims, "open"), `#!/bin/sh
printf 'open %s\\n' "$*" >> "$CALLS_LOG"
exit 0
`);
  writeExecutable(path.join(shims, "sleep"), `#!/bin/sh
printf 'sleep %s\\n' "$*" >> "$CALLS_LOG"
exit 0
`);

  const env = {
    ...process.env,
    PATH: `${shims}:/usr/bin:/bin`,
    HOME: home,
    MEDIUM_LATENS_USER_DIR: userDir,
    MEDIUM_LATENS_PORTA: String(port),
    CALLS_LOG: callsLog,
    HEALTH_MODE: healthMode,
    LAUNCHCTL_MODE: launchctlMode,
    STARTED: started,
  };
  return { env, callsLog, home, userDir, port };
}

function runLauncher(sandbox) {
  return spawnSync("/bin/bash", [ABRIR_STATUS], {
    cwd: REPO_ROOT,
    env: sandbox.env,
    encoding: "utf8",
    timeout: 5_000,
  });
}

function assertTokenNotPrinted(result, token) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, new RegExp(token));
  assert.doesNotMatch(result.stderr, new RegExp(token));
}

function assertLocalRedirect(sandbox, token, calls) {
  const redirect = path.join(sandbox.userDir, "status-abrir.html");
  assert.match(calls, new RegExp(`^open ${redirect.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.doesNotMatch(calls, new RegExp(token));
  assert.equal(fs.statSync(redirect).mode & 0o777, 0o600);
  assert.match(
    fs.readFileSync(redirect, "utf8"),
    new RegExp(`http://127\\.0\\.0\\.1:${sandbox.port}/status\\?t=${token}`),
  );
}

test("health disponível abre a página de status autenticada sem kickstart", { skip: SEM_LANCADOR_BASH_MACOS }, (t) => {
  const token = "token-health-ok-nao-pode-aparecer";
  const sandbox = createSandbox(t, "ok", token);

  const result = runLauncher(sandbox);

  assertTokenNotPrinted(result, token);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assertLocalRedirect(sandbox, token, calls);
  assert.doesNotMatch(calls, /^launchctl /m);
});

test("health indisponível tenta o serviço uma vez e abre status quando ele responde", { skip: SEM_LANCADOR_BASH_MACOS }, (t) => {
  const token = "token-depois-do-kickstart";
  const sandbox = createSandbox(t, "after-kickstart", token);

  const result = runLauncher(sandbox);

  assertTokenNotPrinted(result, token);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.match(calls, new RegExp(`^launchctl kickstart -k gui/${process.getuid()}/com\\.brunocorrea\\.mediumlatens$`, "m"));
  assert.equal((calls.match(/^launchctl /gm) || []).length, 1);
  assertLocalRedirect(sandbox, token, calls);
});

test("kickstart falha, faz bootstrap do agente e abre status quando ele responde", { skip: SEM_LANCADOR_BASH_MACOS }, (t) => {
  const token = "token-depois-do-bootstrap";
  const sandbox = createSandbox(t, "after-kickstart", token, "fail-kickstart");

  const result = runLauncher(sandbox);

  assertTokenNotPrinted(result, token);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.match(calls, new RegExp(`^launchctl kickstart -k gui/${process.getuid()}/com\\.brunocorrea\\.mediumlatens$`, "m"));
  assert.match(
    calls,
    new RegExp(`^launchctl bootstrap gui/${process.getuid()} ${sandbox.home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/Library/LaunchAgents/com\\.brunocorrea\\.mediumlatens\\.plist$`, "m"),
  );
  assert.equal((calls.match(/^launchctl /gm) || []).length, 2);
  assertLocalRedirect(sandbox, token, calls);
});

test("health nunca responde e abre a página estática sem imprimir o token", { skip: SEM_LANCADOR_BASH_MACOS }, (t) => {
  const token = "token-fallback-nao-pode-aparecer";
  const sandbox = createSandbox(t, "never", token);

  const result = runLauncher(sandbox);

  assertTokenNotPrinted(result, token);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.equal((calls.match(/^launchctl /gm) || []).length, 1);
  assert.equal((calls.match(/^sleep 1$/gm) || []).length, 10);
  const fallback = path.join(path.dirname(ABRIR_STATUS), "index.html");
  assert.match(calls, new RegExp(`^open ${fallback.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.doesNotMatch(calls, new RegExp(token));
});
