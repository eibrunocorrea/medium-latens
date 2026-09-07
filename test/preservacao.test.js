"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.join(__dirname, "..");
const BOOTSTRAP = path.join(REPO_ROOT, "installer", "bootstrap.sh");
const UNINSTALLER = path.join(REPO_ROOT, "installer", "desinstalar.sh");
const WINDOWS_UNINSTALLER = path.join(REPO_ROOT, "installer", "desinstalar.ps1");
const SO_MACOS = process.platform === "darwin" ? false : "exercita stat -f %Su do macOS";
const SEM_BASH_MACOS = process.platform === "win32" ? "executa o desinstalador bash do macOS por /bin/bash" : false;

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function writeFile(root, relative, contents, mode) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, mode === undefined ? undefined : { mode });
}

function listFiles(root, base = root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute, base));
    else files.push(path.relative(base, absolute));
  }
  return files.sort();
}

function snapshotFiles(root) {
  return new Map(listFiles(root).map((relative) => {
    const file = path.join(root, relative);
    const contents = fs.readFileSync(file);
    return [relative, {
      sha256: crypto.createHash("sha256").update(contents).digest("hex"),
      mode: fs.statSync(file).mode & 0o777,
    }];
  }));
}

function assertSnapshot(root, expected) {
  for (const [relative, metadata] of expected) {
    const file = path.join(root, relative);
    assert.ok(fs.existsSync(file), `${relative} foi removido`);
    assert.equal(
      crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      metadata.sha256,
      `${relative} foi alterado`,
    );
    assert.equal(fs.statSync(file).mode & 0o777, metadata.mode, `${relative} mudou de modo`);
  }
}

function findPwsh() {
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" });
  if (result.error && result.error.code === "ENOENT") return null;
  assert.equal(result.status, 0, result.stderr || result.stdout || "pwsh falhou");
  return "pwsh";
}

test("instalacao, atualizacao e desinstalacao preservam todos os dados do usuario", { skip: SO_MACOS }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-preservacao-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const home = path.join(root, "home");
  const userDir = path.join(root, "dados-do-usuario");
  const appDir = path.join(root, "Medium Latens");
  const launcher = path.join(root, "Medium Latens.app");
  const shims = path.join(root, "shims");
  const npmRoot = path.join(root, "npm-global", "node_modules");
  const callsLog = path.join(root, "calls.log");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(appDir, "panel"), { recursive: true });
  fs.mkdirSync(launcher, { recursive: true });
  fs.mkdirSync(shims, { recursive: true });
  fs.mkdirSync(path.join(npmRoot, "ffmpeg-static"), { recursive: true });
  fs.mkdirSync(path.join(npmRoot, "ffprobe-static", "bin", "darwin", process.arch), { recursive: true });
  fs.writeFileSync(callsLog, "");
  fs.writeFileSync(path.join(home, ".zprofile"), `export PATH="${shims}:$PATH"\n`);
  writeExecutable(path.join(npmRoot, "ffmpeg-static", "ffmpeg"), "#!/bin/sh\nexit 0\n");
  writeExecutable(
    path.join(npmRoot, "ffprobe-static", "bin", "darwin", process.arch, "ffprobe"),
    "#!/bin/sh\nexit 0\n",
  );

  writeFile(userDir, "config.json", JSON.stringify({ profile: "minha-conta" }));
  writeFile(userDir, "profiles.json", JSON.stringify({ "minha-conta": { provider: "claude" } }));
  const fakeKey = ["sk", "teste", "nao-real"].join("-");
  writeFile(userDir, "credentials.json", JSON.stringify({ principal: { key: fakeKey } }), 0o600);
  writeFile(userDir, "token", "token-local-de-teste\n");
  writeFile(userDir, ".env", "CONFIGURACAO_DO_USUARIO=preservada\n");
  writeFile(userDir, "hotwords.txt", "Medium Latens\n");
  writeFile(userDir, "telemetria/fila.jsonl", '{"evento":"teste"}\n');
  writeFile(userDir, "workspaces/projeto/x.txt", "arquivo do projeto\n");
  const original = snapshotFiles(userDir);

  writeFile(appDir, "server.js", "// versao 1\n");
  writeFile(appDir, "TERMOS.md", "# Termos de uso do Medium Latens (versão 1.0)\n");
  writeFile(appDir, "panel/index.html", "<!doctype html><title>Medium Latens</title>\n");
  writeFile(appDir, "installer/versoes.env", fs.readFileSync(path.join(REPO_ROOT, "installer", "versoes.env")));

  writeExecutable(path.join(shims, "node"), `#!/bin/sh
printf 'node %s\\n' "$*" >> "$CALLS_LOG"
if [ "$1" = "-p" ]; then printf '26\\n'; fi
`);
  writeExecutable(path.join(shims, "npm"), `#!/bin/sh
printf 'npm %s\\n' "$*" >> "$CALLS_LOG"
[ "$*" = "root -g" ] && printf '%s\\n' "$NPM_ROOT"
exit 0
`);
  writeExecutable(path.join(shims, "curl"), `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$CALLS_LOG"
case "$*" in
  *127.0.0.1:8765/health*) printf '{"ok":true}\\n' ;;
  *) exit 22 ;;
esac
`);
  writeExecutable(path.join(shims, "dscl"), `#!/bin/sh
printf 'dscl %s\\n' "$*" >> "$CALLS_LOG"
printf 'UserShell: /bin/zsh\\n'
`);
  for (const command of ["launchctl", "defaults", "osascript", "pkgutil"]) {
    writeExecutable(path.join(shims, command), `#!/bin/sh
printf '${command} %s\\n' "$*" >> "$CALLS_LOG"
exit 0
`);
  }
  for (const command of ["claude", "codex"]) {
    writeExecutable(path.join(shims, command), "#!/bin/sh\nexit 0\n");
  }
  writeExecutable(path.join(shims, "pip"), "#!/bin/sh\nexit 0\n");
  writeExecutable(path.join(shims, "python3"), `#!/bin/sh
last=""
for arg in "$@"; do last="$arg"; done
mkdir -p "$last/bin"
cp "$SHIM_DIR/pip" "$last/bin/pip"
chmod +x "$last/bin/pip"
`);
  writeExecutable(path.join(shims, "sudo"), `#!/bin/sh
printf 'sudo %s\\n' "$*" >> "$CALLS_LOG"
if [ "$1" = "-u" ]; then shift 2; fi
if [ "\${1:-}" = "-H" ]; then shift; fi
exec "$@"
`);
  writeExecutable(path.join(shims, "sleep"), "#!/bin/sh\nexit 0\n");
  writeExecutable(path.join(shims, "installer"), "#!/bin/sh\nexit 1\n");

  const env = {
    ...process.env,
    PATH: `${shims}:/usr/bin:/bin`,
    HOME: home,
    MEDIUM_LATENS_USER: os.userInfo().username,
    MEDIUM_LATENS_USER_DIR: userDir,
    MEDIUM_LATENS_APP_DIR: appDir,
    MEDIUM_LATENS_LAUNCHER: launcher,
    MEDIUM_LATENS_TEST_PATH: shims,
    CALLS_LOG: callsLog,
    SHIM_DIR: shims,
    NPM_ROOT: npmRoot,
  };

  for (const version of ["versao 1", "versao 2"]) {
    fs.writeFileSync(path.join(appDir, "server.js"), `// ${version}\n`);
    const result = spawnSync("/bin/bash", [BOOTSTRAP, appDir], {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertSnapshot(userDir, original);
  }

  const extraFiles = listFiles(userDir).filter((relative) => !original.has(relative));
  assert.ok(extraFiles.length > 0, "o bootstrap nao criou seus arquivos operacionais esperados");
  for (const relative of extraFiles) {
    assert.match(relative, /^(?:(?:bin|data|logs|venv)(?:\/|$)|cep-debug-ativado$)/, `arquivo extra inesperado: ${relative}`);
  }
  const beforeUninstall = snapshotFiles(userDir);

  assert.ok(fs.existsSync(UNINSTALLER), "installer/desinstalar.sh nao existe");
  const uninstall = spawnSync("/bin/bash", [UNINSTALLER], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
  assert.match(uninstall.stdout, /^Programa removido\.$/m);
  assert.match(uninstall.stdout, new RegExp(userDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(uninstall.stdout, /CLIs fixados continuam em .*\/npm, dentro da pasta preservada/);
  assert.equal(fs.existsSync(appDir), false, "a pasta do programa nao foi removida");
  assert.equal(fs.existsSync(launcher), false, "o lancador nao foi removido");
  assert.equal(
    fs.existsSync(path.join(home, "Library", "Application Support", "Adobe", "CEP", "extensions", "MediumLatens")),
    false,
    "o painel CEP nao foi removido",
  );
  assert.equal(
    fs.existsSync(path.join(home, "Library", "LaunchAgents", "com.brunocorrea.mediumlatens.plist")),
    false,
    "o LaunchAgent nao foi removido",
  );

  const calls = fs.readFileSync(callsLog, "utf8");
  assert.match(calls, new RegExp(`^launchctl bootout gui/${os.userInfo().uid}/com\\.brunocorrea\\.mediumlatens$`, "m"));
  assert.match(calls, /^pkgutil --forget com\.brunocorrea\.mediumlatens$/m);
  for (const version of [9, 10, 11, 12]) {
    assert.match(
      calls,
      new RegExp(`^defaults delete com\\.adobe\\.CSXS\\.${version} PlayerDebugMode$`, "m"),
    );
  }
  assertSnapshot(userDir, original);
  assertSnapshot(userDir, beforeUninstall);
  assert.deepEqual(listFiles(userDir), [...beforeUninstall.keys()]);
  assert.equal(fs.statSync(path.join(userDir, "credentials.json")).mode & 0o777, 0o600);

  assert.ok(fs.existsSync(WINDOWS_UNINSTALLER), "installer/desinstalar.ps1 nao existe");
  const pwsh = findPwsh();
  if (!pwsh) {
    t.diagnostic("pwsh nao esta disponivel; parser do desinstalador Windows ignorado");
    return;
  }
  const escaped = WINDOWS_UNINSTALLER.replace(/'/g, "''");
  const parse = spawnSync(pwsh, [
    "-NoProfile",
    "-Command",
    `$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }`,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(parse.status, 0, parse.stderr || parse.stdout);
});

test("desinstalador sem marcador nao altera PlayerDebugMode", { skip: SEM_BASH_MACOS }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-sem-marcador-cep-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const userDir = path.join(root, "dados-do-usuario");
  const appDir = path.join(root, "Medium Latens");
  const launcher = path.join(root, "Medium Latens.app");
  const shims = path.join(root, "shims");
  const callsLog = path.join(root, "calls.log");
  for (const directory of [home, userDir, appDir, launcher, shims]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(callsLog, "");
  for (const command of ["launchctl", "pkgutil"]) {
    writeExecutable(path.join(shims, command), "#!/bin/sh\nexit 0\n");
  }
  writeExecutable(path.join(shims, "defaults"), `#!/bin/sh
printf 'defaults %s\\n' "$*" >> "$CALLS_LOG"
exit 0
`);

  const result = spawnSync("/bin/bash", [UNINSTALLER], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${shims}:/usr/bin:/bin`,
      HOME: home,
      MEDIUM_LATENS_USER_DIR: userDir,
      MEDIUM_LATENS_APP_DIR: appDir,
      MEDIUM_LATENS_LAUNCHER: launcher,
      CALLS_LOG: callsLog,
    },
    encoding: "utf8",
    timeout: 10_000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(fs.readFileSync(callsLog, "utf8"), /^defaults delete /m);
});

test("desinstalador informa falha e sai com codigo 1 quando a remocao falha", { skip: SEM_BASH_MACOS }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-remocao-falha-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const home = path.join(root, "home");
  const userDir = path.join(root, "dados-do-usuario");
  const appDir = path.join(root, "Medium Latens");
  const launcher = path.join(root, "Medium Latens.app");
  const shims = path.join(root, "shims");
  for (const directory of [home, userDir, appDir, launcher, shims]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  for (const command of ["rm", "sudo"]) {
    writeExecutable(path.join(shims, command), "#!/bin/sh\nexit 1\n");
  }
  for (const command of ["launchctl", "pkgutil"]) {
    writeExecutable(path.join(shims, command), "#!/bin/sh\nexit 0\n");
  }

  const result = spawnSync("/bin/bash", [UNINSTALLER], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PATH: `${shims}:/usr/bin:/bin`,
      HOME: home,
      MEDIUM_LATENS_USER_DIR: userDir,
      MEDIUM_LATENS_APP_DIR: appDir,
      MEDIUM_LATENS_LAUNCHER: launcher,
    },
    encoding: "utf8",
    timeout: 10_000,
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /A remoção não terminou: veja os avisos acima\./);
  assert.doesNotMatch(result.stdout, /^Programa removido\.$/m);
  assert.ok(fs.existsSync(appDir), "a pasta do programa deveria continuar apos a falha");
  assert.ok(fs.existsSync(launcher), "o lancador deveria continuar apos a falha");
});

test("desinstalador recusa executar sem HOME", { skip: SEM_BASH_MACOS }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-sem-home-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.HOME;

  const result = spawnSync("/bin/bash", [UNINSTALLER], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 10_000,
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FALHOU: HOME não definido$/m);
});

test("desinstalador normaliza barra final e exige caminhos absolutos", { skip: SEM_BASH_MACOS }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-caminhos-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const userDir = path.join(root, "dados-do-usuario");
  const appDir = path.join(root, "Medium Latens");
  const launcher = path.join(root, "Medium Latens.app");
  const shims = path.join(root, "shims");
  for (const directory of [home, userDir, appDir, launcher, shims]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  for (const command of ["launchctl", "pkgutil"]) {
    writeExecutable(path.join(shims, command), "#!/bin/sh\nexit 0\n");
  }
  const baseEnv = {
    ...process.env,
    PATH: `${shims}:/usr/bin:/bin`,
    HOME: home,
    MEDIUM_LATENS_USER_DIR: userDir,
  };

  const withTrailingSlash = spawnSync("/bin/bash", [UNINSTALLER], {
    cwd: root,
    env: {
      ...baseEnv,
      MEDIUM_LATENS_APP_DIR: `${appDir}/`,
      MEDIUM_LATENS_LAUNCHER: `${launcher}/`,
    },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(withTrailingSlash.status, 0, withTrailingSlash.stderr || withTrailingSlash.stdout);
  assert.equal(fs.existsSync(appDir), false);
  assert.equal(fs.existsSync(launcher), false);

  const relativeApp = path.join(root, "Medium Latens");
  fs.mkdirSync(relativeApp);
  const withRelativePath = spawnSync("/bin/bash", [UNINSTALLER], {
    cwd: root,
    env: {
      ...baseEnv,
      MEDIUM_LATENS_APP_DIR: "Medium Latens",
      MEDIUM_LATENS_LAUNCHER: path.join(root, "Medium Latens.app"),
    },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(withRelativePath.status, 1, withRelativePath.stderr || withRelativePath.stdout);
  assert.ok(fs.existsSync(relativeApp), "o caminho relativo nao pode ser removido");
});

test("desinstalador recusa aplicativo dentro da pasta do usuario", { skip: SEM_BASH_MACOS }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-contencao-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const userDir = path.join(root, "dados-do-usuario");
  const appDir = path.join(userDir, "Medium Latens");
  const launcher = path.join(root, "Medium Latens.app");
  const shims = path.join(root, "shims");
  for (const directory of [home, appDir, launcher, shims]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  for (const command of ["launchctl", "pkgutil"]) {
    writeExecutable(path.join(shims, command), "#!/bin/sh\nexit 0\n");
  }

  const result = spawnSync("/bin/bash", [UNINSTALLER], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${shims}:/usr/bin:/bin`,
      HOME: home,
      MEDIUM_LATENS_USER_DIR: userDir,
      MEDIUM_LATENS_APP_DIR: appDir,
      MEDIUM_LATENS_LAUNCHER: launcher,
    },
    encoding: "utf8",
    timeout: 10_000,
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /recusei remover um caminho dentro da pasta do usuário/);
  assert.doesNotMatch(result.stdout, /^Programa removido\.$/m);
  assert.ok(fs.existsSync(appDir), "a pasta dentro do USER_DIR precisa continuar");
});
