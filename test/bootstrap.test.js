"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..");
const BOOTSTRAP = path.join(REPO_ROOT, "installer", "bootstrap.sh");
const VERSIONS = path.join(REPO_ROOT, "installer", "versoes.env");
const SO_MACOS = process.platform === "darwin" ? false : "exercita dscl, launchctl e /bin/zsh do bootstrap bash do macOS";

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function createSandbox(t, options = {}) {
  const asRoot = options.asRoot === true;
  const healthMode = options.healthMode || "ok";
  const nodeInstalled = options.aliasOnlyNode ? false : options.nodeInstalled !== false;
  const userShell = options.userShell || "/bin/zsh";
  const mediaChmodFails = options.mediaChmodFails === true;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-bootstrap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const appDir = path.join(root, "app");
  const home = path.join(root, "home");
  const userDir = path.join(root, "user");
  const shims = path.join(root, "shims");
  const npmRoot = path.join(root, "npm-global", "node_modules");
  const callsLog = path.join(root, "calls.log");
  fs.mkdirSync(path.join(appDir, "panel"), { recursive: true });
  fs.mkdirSync(path.join(appDir, "installer"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(shims, { recursive: true });
  const profileShells = options.profileShells || ["zsh", "bash"];
  const profileLines = [`export PATH="${shims}:$PATH"`];
  if (options.loginBanner) profileLines.push("echo banner-do-perfil");
  if (options.aliasOnlyNode) {
    profileLines.push(`if [ ! -x "${path.join(shims, "node")}" ]; then alias node='printf alias-only'; fi`);
  }
  if (profileShells.includes("zsh")) {
    fs.writeFileSync(path.join(home, ".zprofile"), `${profileLines.join("\n")}\n`);
  }
  if (profileShells.includes("bash")) {
    fs.writeFileSync(path.join(home, ".bash_profile"), `${profileLines.join("\n")}\n`);
  }
  if (options.userDirIsSymlink) {
    fs.symlinkSync(home, userDir);
  } else if (options.precreateUserDir) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  fs.mkdirSync(path.join(npmRoot, "ffmpeg-static"), { recursive: true });
  fs.mkdirSync(path.join(npmRoot, "ffprobe-static", "bin", "darwin", process.arch), { recursive: true });
  fs.writeFileSync(path.join(appDir, "server.js"), "");
  fs.writeFileSync(path.join(appDir, "TERMOS.md"), "# Termos de uso do Medium Latens (versão 1.0)\n");
  fs.writeFileSync(path.join(appDir, "panel", "index.html"), "<!doctype html><title>Medium Latens</title>\n");
  if (fs.existsSync(VERSIONS)) {
    fs.copyFileSync(VERSIONS, path.join(appDir, "installer", "versoes.env"));
    const versionsFile = path.join(appDir, "installer", "versoes.env");
    if (options.missingVersionKey) {
      const contents = fs.readFileSync(versionsFile, "utf8").replace(
        new RegExp(`^${options.missingVersionKey}=.*\\n?`, "m"),
        "",
      );
      fs.writeFileSync(versionsFile, contents);
    }
    if (options.uppercaseFfmpegHash) {
      const contents = fs.readFileSync(versionsFile, "utf8").replace(
        /^(FFMPEG_SHA256_DARWIN_(?:ARM64|X64)=)([0-9a-f]+)$/gm,
        (_, key, hash) => `${key}${hash.toUpperCase()}`,
      );
      fs.writeFileSync(versionsFile, contents);
    }
  }
  fs.writeFileSync(callsLog, "");
  writeExecutable(path.join(npmRoot, "ffmpeg-static", "ffmpeg"), "#!/bin/sh\nexit 0\n");
  writeExecutable(
    path.join(npmRoot, "ffprobe-static", "bin", "darwin", process.arch, "ffprobe"),
    "#!/bin/sh\nexit 0\n",
  );

  if (asRoot) {
    writeExecutable(path.join(shims, "id"), `#!/bin/sh
case "$*" in
  -u) printf '0\\n' ;;
  -un) printf '%s\\n' "$SANDBOX_USER" ;;
  "-u $SANDBOX_USER") printf '%s\\n' "$SANDBOX_USER_UID" ;;
  *) exec /usr/bin/id "$@" ;;
esac
`);
    writeExecutable(path.join(shims, "stat"), `#!/bin/sh
case "$*" in
  *%Su*) printf '%s\\n' "$SANDBOX_USER_DIR_OWNER" ;;
  *) exec /usr/bin/stat "$@" ;;
esac
`);
    writeExecutable(path.join(shims, "mkdir"), `#!/bin/sh
printf 'mkdir via_sudo=%s %s\\n' "\${MEDIUM_LATENS_VIA_SUDO:-0}" "$*" >> "$CALLS_LOG"
exec /bin/mkdir "$@"
`);
    writeExecutable(path.join(shims, "tee"), `#!/bin/sh
printf 'tee via_sudo=%s %s\\n' "\${MEDIUM_LATENS_VIA_SUDO:-0}" "$*" >> "$CALLS_LOG"
exec /usr/bin/tee "$@"
`);
    writeExecutable(path.join(shims, "chown"), `#!/bin/sh
printf 'chown %s\\n' "$*" >> "$CALLS_LOG"
exit 0
`);
    const bashEnv = path.join(root, "bash-env");
    fs.writeFileSync(
      bashEnv,
      ["id", "stat", "dscl", "sudo", "curl", "shasum", "installer", "launchctl", "defaults", "osascript", "sleep"]
        .map((command) => `${command}() { "$SHIM_DIR/${command}" "$@"; }`)
        .join("\n") + "\n",
    );
    options.bashEnv = bashEnv;
  }

  writeExecutable(path.join(shims, "dscl"), `#!/bin/sh
printf 'dscl %s\\n' "$*" >> "$CALLS_LOG"
case "$*" in
  *UserShell*) printf 'UserShell: %s\\n' "$SANDBOX_USER_SHELL" ;;
  *NFSHomeDirectory*) printf 'NFSHomeDirectory: %s\\n' "$HOME" ;;
esac
`);

  const nodeAfterInstall = path.join(shims, "node-after-install");
  writeExecutable(nodeAfterInstall, `#!/bin/sh
printf 'node %s\\n' "$*" >> "$CALLS_LOG"
[ -z "\${MEDIUM_LATENS_USER_DIR:-}" ] || printf 'MEDIUM_LATENS_USER_DIR=%s\\n' "$MEDIUM_LATENS_USER_DIR" >> "$CALLS_LOG"
if [ "$1" = "-p" ]; then printf '26\\n'; fi
`);
  const nodeMajor = options.nodeMajor || "26";
  if (nodeInstalled) {
    writeExecutable(path.join(shims, "node"), `#!/bin/sh
printf 'node %s\\n' "$*" >> "$CALLS_LOG"
printf 'node-path via_sudo=%s path=%s\\n' "\${MEDIUM_LATENS_VIA_SUDO:-0}" "$PATH" >> "$CALLS_LOG"
[ -z "\${MEDIUM_LATENS_USER_DIR:-}" ] || printf 'MEDIUM_LATENS_USER_DIR=%s\\n' "$MEDIUM_LATENS_USER_DIR" >> "$CALLS_LOG"
if [ "$1" = "-p" ]; then printf '${nodeMajor}\\n'; fi
if [ "$1" = "-p" ] && [ "\${NODE_PROBE_STDERR:-0}" = "1" ]; then printf 'aviso-do-node\\n' >&2; fi
`);
  }

  writeExecutable(path.join(shims, "npm"), `#!/bin/sh
printf 'npm %s\\n' "$*" >> "$CALLS_LOG"
printf 'npm-context via_sudo=%s prefix=%s\\n' "\${MEDIUM_LATENS_VIA_SUDO:-0}" "\${npm_config_prefix:-}" >> "$CALLS_LOG"
[ "$*" = "root -g" ] && { printf '%s\\n' "$NPM_ROOT"; exit 0; }
case "$*" in
  *claude-code*) cli=claude ;;
  *openai/codex*) cli=codex ;;
  *gemini-cli*) cli=gemini ;;
  *premiere-pro-mcp*) cli=premiere-pro-mcp ;;
  *) cli="" ;;
esac
if [ -n "$cli" ] && [ -n "\${npm_config_prefix:-}" ]; then
  mkdir -p "$npm_config_prefix/bin"
  printf '#!/bin/sh\\nexit 0\\n' > "$npm_config_prefix/bin/$cli"
  chmod +x "$npm_config_prefix/bin/$cli"
fi
[ -z "\${NPM_TOKEN:-}" ] || printf 'NPM_TOKEN=%s\\n' "$NPM_TOKEN"
[ -z "\${NODE_AUTH_TOKEN:-}" ] || printf 'NODE_AUTH_TOKEN=%s\\n' "$NODE_AUTH_TOKEN"
[ -z "\${FAKE_API_KEY:-}" ] || printf 'FAKE_API_KEY=%s\\n' "$FAKE_API_KEY"
[ -z "\${npm_config_registry:-}" ] || printf 'npm_config_registry=%s\\n' "$npm_config_registry"
[ -z "\${NPM_CONFIG_USERCONFIG:-}" ] || printf 'NPM_CONFIG_USERCONFIG=%s\\n' "$NPM_CONFIG_USERCONFIG"
[ -z "\${NODE_OPTIONS:-}" ] || printf 'NODE_OPTIONS=%s\\n' "$NODE_OPTIONS"
[ -z "\${NODE_EXTRA_CA_CERTS:-}" ] || printf 'NODE_EXTRA_CA_CERTS=%s\\n' "$NODE_EXTRA_CA_CERTS"
[ -z "\${FFMPEG_BINARIES_URL:-}" ] || printf 'FFMPEG_BINARIES_URL=%s\\n' "$FFMPEG_BINARIES_URL"
exit 0
`);

  writeExecutable(path.join(shims, "curl"), `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$CALLS_LOG"
printf 'curl-context via_sudo=%s args=%s\\n' "\${MEDIUM_LATENS_VIA_SUDO:-0}" "$*" >> "$CALLS_LOG"
printf 'curl-path via_sudo=%s path=%s\\n' "\${MEDIUM_LATENS_VIA_SUDO:-0}" "$PATH" >> "$CALLS_LOG"
case "$*" in
  *127.0.0.1:8765/health*)
    [ "$HEALTH_MODE" = "ok" ] || exit 22
    printf '{"ok":true}\\n'
    ;;
  *nodejs.org/dist/index.json*) printf '[{"version":"v99.0.0","lts":false},{"version":"v26.0.0","lts":"Krypton"}]\\n' ;;
  *SHASUMS256.txt*)
    case "$SHASUMS_MODE" in
      ok) printf '%s  node-v26.0.0.pkg\\n' "$SOMA_PKG_VAZIO" ;;
      errada) printf '%s  node-v26.0.0.pkg\\n' "0000000000000000000000000000000000000000000000000000000000000000" ;;
      ausente) printf '%s  node-v26.0.0.tar.gz\\n' "$SOMA_PKG_VAZIO" ;;
    esac
    ;;
  *github.com/eugeneware/ffmpeg-static/releases/download/*)
    anterior=""
    saida=""
    for argumento in "$@"; do
      [ "$anterior" != "-o" ] || saida="$argumento"
      anterior="$argumento"
    done
    [ -n "$saida" ] || exit 2
    printf 'ffmpeg-sandbox' > "$saida"
    ;;
esac
`);

  writeExecutable(path.join(shims, "shasum"), `#!/bin/sh
printf 'shasum-context via_sudo=%s args=%s\\n' "\${MEDIUM_LATENS_VIA_SUDO:-0}" "$*" >> "$CALLS_LOG"
case "$*" in
  *ffmpeg.download*|*/bin/ffmpeg*)
    ultimo=""
    for argumento in "$@"; do ultimo="$argumento"; done
    printf '%s  %s\\n' "$FFMPEG_SANDBOX_SHA" "$ultimo"
    ;;
  *) exec /usr/bin/shasum "$@" ;;
esac
`);

  writeExecutable(path.join(shims, "installer"), `#!/bin/sh
printf 'installer %s\\n' "$*" >> "$CALLS_LOG"
if [ "\${INSTALL_NODE_SHIM:-0}" = "1" ]; then
  cp "$SHIM_DIR/node-after-install" "$SHIM_DIR/node"
  chmod +x "$SHIM_DIR/node"
fi
exit 0
`);

  for (const command of ["launchctl", "osascript"]) {
    writeExecutable(path.join(shims, command), `#!/bin/sh
printf '${command} %s\\n' "$*" >> "$CALLS_LOG"
exit 0
`);
  }
  writeExecutable(path.join(shims, "defaults"), `#!/bin/sh
printf 'defaults %s\\n' "$*" >> "$CALLS_LOG"
case "$*" in
  "read com.adobe.CSXS."*" PlayerDebugMode")
    versao="\${2#com.adobe.CSXS.}"
    case ",\${EXISTING_DEBUG_VERSIONS:-}," in
      *",$versao,"*) printf '1\\n'; exit 0 ;;
      *) exit 1 ;;
    esac
    ;;
esac
exit 0
`);

  for (const command of ["claude", "codex"]) {
    writeExecutable(path.join(shims, command), `#!/bin/sh
printf '${command} %s\\n' "$*" >> "$CALLS_LOG"
exit 0
`);
  }

  writeExecutable(path.join(shims, "pip"), `#!/bin/sh
printf 'pip %s\\n' "$*" >> "$CALLS_LOG"
exit 0
`);

  writeExecutable(path.join(shims, "python3"), `#!/bin/sh
printf 'python3 %s\\n' "$*" >> "$CALLS_LOG"
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
export MEDIUM_LATENS_VIA_SUDO=1
export PATH="$SHIM_DIR:$PATH"
exec "$@"
`);

  writeExecutable(path.join(shims, "sleep"), `#!/bin/sh
printf 'sleep %s\\n' "$*" >> "$CALLS_LOG"
exit 0
`);

  writeExecutable(path.join(shims, "chmod"), `#!/bin/sh
printf 'chmod %s\\n' "$*" >> "$CALLS_LOG"
case "$*" in
  *ffmpeg-static*|*ffprobe-static*) [ "$MEDIA_CHMOD_FAILS" = "1" ] && exit 1 ;;
esac
exec /bin/chmod "$@"
`);

  const shasumsMode = options.shasumsMode || "ok";
  const somaDoPacoteVazio = require("crypto").createHash("sha256").update("").digest("hex");
  const versoes = Object.fromEntries(
    fs.readFileSync(VERSIONS, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => line.split("=", 2)),
  );
  const ffmpegHash = process.arch === "arm64"
    ? versoes.FFMPEG_SHA256_DARWIN_ARM64
    : versoes.FFMPEG_SHA256_DARWIN_X64;
  const env = {
    ...process.env,
    PATH: `${shims}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    HOME: home,
    MEDIUM_LATENS_USER: os.userInfo().username,
    MEDIUM_LATENS_USER_DIR: userDir,
    CALLS_LOG: callsLog,
    SHIM_DIR: shims,
    NPM_ROOT: npmRoot,
    HEALTH_MODE: healthMode,
    SHASUMS_MODE: shasumsMode,
    SOMA_PKG_VAZIO: somaDoPacoteVazio,
    FFMPEG_SANDBOX_SHA: options.ffmpegHashMatches === false ? "0".repeat(64) : ffmpegHash,
    INSTALL_NODE_SHIM: (!nodeInstalled || Number(nodeMajor) < 22) ? "1" : "0",
    MEDIA_CHMOD_FAILS: mediaChmodFails ? "1" : "0",
    SANDBOX_USER: os.userInfo().username,
    SANDBOX_USER_UID: String(os.userInfo().uid),
    SANDBOX_USER_DIR_OWNER: options.userDirOwner || os.userInfo().username,
    SANDBOX_USER_SHELL: userShell,
    NPM_TOKEN: "npm-token-nao-pode-vazar",
    NODE_AUTH_TOKEN: "node-auth-token-nao-pode-vazar",
    FAKE_API_KEY: "fake-api-key-nao-pode-vazar",
    npm_config_registry: "https://registro-nao-pode-vazar.invalid",
    NPM_CONFIG_USERCONFIG: "/configuracao/nao-pode-vazar",
    NODE_OPTIONS: "--require modulo-nao-pode-vazar",
    NODE_EXTRA_CA_CERTS: "/certificado/nao-pode-vazar",
    FFMPEG_BINARIES_URL: "https://binarios-nao-pode-vazar.invalid",
    NODE_PROBE_STDERR: options.nodeProbeStderr ? "1" : "0",
    EXISTING_DEBUG_VERSIONS: (options.existingDebugVersions || []).join(","),
  };
  if (options.testPathEnabled !== false) env.MEDIUM_LATENS_TEST_PATH = shims;
  if (options.bashEnv) env.BASH_ENV = options.bashEnv;

  return { root, appDir, home, userDir, shims, callsLog, env };
}

function runBootstrap(sandbox) {
  return spawnSync("/bin/bash", [BOOTSTRAP, sandbox.appDir], {
    cwd: REPO_ROOT,
    env: sandbox.env,
    encoding: "utf8",
    timeout: 10_000,
  });
}

function assertEightSteps(output) {
  for (let step = 1; step <= 8; step += 1) {
    assert.match(output, new RegExp(`^PASSO ${step}/8: `, "m"));
  }
  assert.equal((output.match(/^PASSO \d\/8: /gm) || []).length, 8);
}

test("bootstrap do macOS conclui os oito passos sem chamar o sistema real", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t);

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assertEightSteps(result.stdout);
  assert.match(result.stdout, /^PRONTO$/m);

  const installLog = fs.readFileSync(path.join(sandbox.userDir, "logs", "install.log"), "utf8");
  assertEightSteps(installLog);
  assert.match(installLog, /^PRONTO$/m);
  assert.ok(fs.existsSync(path.join(sandbox.userDir, ".env")));
  assert.ok(fs.existsSync(path.join(sandbox.userDir, "hotwords.txt")));
  const ffmpeg = path.join(sandbox.userDir, "bin", "ffmpeg");
  const ffprobe = path.join(sandbox.userDir, "bin", "ffprobe");
  assert.equal(fs.lstatSync(ffmpeg).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(ffmpeg, "utf8"), "ffmpeg-sandbox");
  assert.equal(fs.lstatSync(ffprobe).isSymbolicLink(), false);
  assert.ok(fs.existsSync(path.join(sandbox.home, "Library", "Application Support", "Adobe", "CEP", "extensions", "MediumLatens", "index.html")));

  const plist = fs.readFileSync(
    path.join(sandbox.home, "Library", "LaunchAgents", "com.brunocorrea.mediumlatens.plist"),
    "utf8",
  );
  assert.match(plist, /<key>SuccessfulExit<\/key><false\/>/);
  assert.match(plist, /<key>PATH<\/key><string>/);
  assert.match(plist, /<key>MEDIUM_LATENS_SERVICE<\/key><string>1<\/string>/);

  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.match(calls, /node -e .*registrarAceite.* 1\.0$/m);
  assert.match(calls, new RegExp(`MEDIUM_LATENS_USER_DIR=.*${path.basename(sandbox.userDir)}`));

  assert.doesNotMatch(installLog, /API_KEY=|TOKEN=/);
  assert.doesNotMatch(installLog, /fake-api-key-nao-pode-vazar|npm-token-nao-pode-vazar|node-auth-token-nao-pode-vazar/);

  const source = fs.readFileSync(BOOTSTRAP, "utf8");
  assert.match(
    source,
    /com_log_usuario defaults write "com\.adobe\.CSXS\.\$v" PlayerDebugMode 1/,
  );
  assert.match(source, /VERSAO_TERMOS="\$\(sed -n '1s\/\.\*\(versão/);
  const acceptanceLine = source.split(/\r?\n/).find((line) => line.includes("registrarAceite"));
  assert.match(acceptanceLine, /"\$VERSAO_TERMOS"/);
  assert.doesNotMatch(acceptanceLine, /"1\.0"/);
  assert.match(source, /com_log_usuario rm -rf "\$DEST"/);
  assert.match(source, /com_log_usuario mkdir -p "\$DEST"/);
  assert.match(source, /com_log_usuario cp -R "\$APP_DIR\/panel\/\." "\$DEST\/"/);
  assert.match(source, /com_log_usuario mkdir -p "\$USER_HOME\/Library\/LaunchAgents"/);
});

test("pos-install root nunca toca arquivos do usuario nem confia no Homebrew", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { asRoot: true });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  const source = fs.readFileSync(BOOTSTRAP, "utf8");
  assert.doesNotMatch(calls, /^chown\b/m);
  assert.doesNotMatch(source, /chown(?:\s+-R)?\b/);
  assert.doesNotMatch(source, /export PATH="\/opt\/homebrew\/bin:\/usr\/local\/bin/);
  assert.match(source, /if \[ "\$ROOT_MODE" -eq 1 \][\s\S]*PATH="\/usr\/bin:\/bin:\/usr\/sbin:\/sbin"/);
  assert.doesNotMatch(source, /EUID[^\n]*localizar|localizar[^\n]*EUID/);
  assert.match(calls, new RegExp(`^sudo -u ${os.userInfo().username} -H /bin/zsh -lc `, "m"));
  const rootPaths = calls.split("\n").filter((line) => line.startsWith("curl-path via_sudo=0 "));
  assert.ok(rootPaths.length > 0, "PATH do root nao foi observado");
  assert.ok(rootPaths.every((line) => !line.includes("/opt/homebrew")), rootPaths.join("\n"));
  for (const command of ["mkdir", "tee"]) {
    const invocations = calls.split("\n").filter((line) => line.startsWith(`${command} `));
    assert.ok(invocations.length > 0, `${command} nao foi exercitado`);
    assert.ok(
      invocations.every((line) => line.includes("via_sudo=1")),
      `${command} fora de sudo -u:\n${invocations.join("\n")}`,
    );
  }
});

test("banner do perfil nao contamina o caminho absoluto de Node no plist", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { asRoot: true, loginBanner: true });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plist = fs.readFileSync(
    path.join(sandbox.home, "Library", "LaunchAgents", "com.brunocorrea.mediumlatens.plist"),
    "utf8",
  );
  assert.match(plist, new RegExp(`<string>${path.join(sandbox.shims, "node").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</string>`));
  assert.doesNotMatch(plist, /banner-do-perfil/);
});

test("alias de Node sem executavel absoluto dispara a instalacao oficial", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { asRoot: true, aliasOnlyNode: true });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.match(calls, /^installer -pkg .+ -target \/$/m);
  const source = fs.readFileSync(BOOTSTRAP, "utf8");
  assert.match(source, /case "\$[A-Z_]+" in\s*\/\*\)/);
  assert.match(source, /\[ -x "\$valor" \]/);
});

for (const [shell, profiles] of [["/bin/zsh", ["zsh"]], ["/bin/bash", ["bash"]]]) {
  test(`usa o shell real ${shell} e encontra Node pelo perfil correspondente`, { skip: SO_MACOS }, (t) => {
    const sandbox = createSandbox(t, {
      asRoot: true,
      userShell: shell,
      profileShells: profiles,
      testPathEnabled: false,
    });

    const result = runBootstrap(sandbox);
    const calls = fs.readFileSync(sandbox.callsLog, "utf8");

    assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${calls}`);
    assert.match(calls, new RegExp(`^dscl \\. -read /Users/${os.userInfo().username} UserShell$`, "m"));
    assert.match(calls, new RegExp(`^sudo -u ${os.userInfo().username} -H ${shell.replace(/\//g, "\\/")} -lc `, "m"));
    assert.doesNotMatch(calls, /nodejs\.org\/dist\/index\.json/);
    assert.doesNotMatch(calls, /^installer -pkg/m);
  });
}

test("npm do pos-install root roda como usuario com prefixo e versoes fixadas", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { asRoot: true });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  const contexts = calls.split("\n").filter((line) => line.startsWith("npm-context "));
  assert.ok(contexts.length >= 6, calls);
  assert.ok(contexts.every((line) => line.includes("via_sudo=1")), contexts.join("\n"));
  assert.ok(
    contexts.every((line) => line.endsWith(`prefix=${path.join(sandbox.userDir, "npm")}`)),
    contexts.join("\n"),
  );
  assert.match(calls, /^npm install -g @anthropic-ai\/claude-code@2\.1\.263$/m);
  assert.match(calls, /^npm install -g @openai\/codex@0\.153\.4$/m);
  assert.match(calls, /^npm install -g @google\/gemini-cli@0\.58\.0$/m);
  assert.match(calls, /^npm install -g --ignore-scripts premiere-pro-mcp@1\.14\.9$/m);
  assert.match(calls, /^npm install -g --ignore-scripts ffprobe-static@3\.1\.0$/m);

  const source = fs.readFileSync(BOOTSTRAP, "utf8");
  assert.doesNotMatch(source, /\. "\$VERSOES_ARQ"/);
  assert.match(source, /\[\[ "\$linha" =~ \^\(\[A-Z0-9_\]\+\)=\(\[A-Za-z0-9\._-\]\+\)\$ \]\]/);
  assert.match(source, /\$USER_DIR\/npm\/bin:\$NODE_DIR/);
});

test("arquivo de versoes incompleto e recusado com mensagem amigavel", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { missingVersionKey: "CODEX" });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /O arquivo de versões do instalador está incompleto\. Reinstale o programa\./);
  assert.doesNotMatch(fs.readFileSync(BOOTSTRAP, "utf8"), /\. "\$VERSOES_ARQ"/);
});

test("ffmpeg oficial e baixado como usuario e aceito somente depois do SHA-256", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { asRoot: true });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.match(
    calls,
    /^curl-context via_sudo=1 args=.*github\.com\/eugeneware\/ffmpeg-static\/releases\/download\/b6\.1\.1\/ffmpeg-darwin-(?:arm64|x64)$/m,
  );
  assert.match(calls, /^shasum-context via_sudo=1 args=-a 256 .*ffmpeg\.download$/m);
  assert.doesNotMatch(calls, /^npm install -g ffmpeg-static/m);
});

test("ffmpeg ja verificado e reutilizado sem novo download", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { asRoot: true, existingFfmpeg: true });
  fs.mkdirSync(path.join(sandbox.userDir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(sandbox.userDir, "bin", "ffmpeg"), "ffmpeg-sandbox");

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.match(calls, /^shasum-context via_sudo=1 args=-a 256 .*\/bin\/ffmpeg$/m);
  assert.doesNotMatch(calls, /curl-context .*github\.com\/eugeneware\/ffmpeg-static/);
});

test("hash configurado em maiusculas continua valido", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { uppercaseFfmpegHash: true });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(path.join(sandbox.userDir, "bin", "ffmpeg"), "utf8"), "ffmpeg-sandbox");
});

test("registra somente as versoes CSXS cujo PlayerDebugMode foi alterado", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { existingDebugVersions: [10, 12] });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    fs.readFileSync(path.join(sandbox.userDir, "cep-debug-ativado"), "utf8"),
    "9\n11\n",
  );
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  for (const version of [9, 10, 11, 12]) {
    assert.match(calls, new RegExp(`^defaults read com\\.adobe\\.CSXS\\.${version} PlayerDebugMode$`, "m"));
  }
  for (const version of [9, 11]) {
    assert.match(calls, new RegExp(`^defaults write com\\.adobe\\.CSXS\\.${version} PlayerDebugMode 1$`, "m"));
  }
  for (const version of [10, 12]) {
    assert.doesNotMatch(calls, new RegExp(`^defaults write com\\.adobe\\.CSXS\\.${version} PlayerDebugMode 1$`, "m"));
  }
});

test("npm recebe ambiente limpo e somente o prefixo configurado", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { asRoot: true });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  const installLog = fs.readFileSync(path.join(sandbox.userDir, "logs", "install.log"), "utf8");
  assert.doesNotMatch(
    `${calls}\n${installLog}`,
    /(?:NPM_TOKEN|NODE_AUTH_TOKEN|FAKE_API_KEY|npm_config_registry|NPM_CONFIG_USERCONFIG|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|FFMPEG_BINARIES_URL)=/,
  );
  assert.match(calls, new RegExp(`^npm-context via_sudo=1 prefix=${sandbox.userDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/npm$`, "m"));
});

test("pos-install root recusa USER_DIR simbolico antes de criar o log", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { asRoot: true, userDirIsSymlink: true });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /não pode ser um link simbólico/);
  assert.equal(fs.existsSync(path.join(sandbox.home, "logs", "install.log")), false);
});

test("pos-install root recusa USER_DIR de outro dono", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, {
    asRoot: true,
    precreateUserDir: true,
    userDirOwner: "outro-usuario",
  });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /não pertence ao usuário/);
  assert.equal(fs.existsSync(path.join(sandbox.userDir, "logs", "install.log")), false);
});

test("segunda execucao repara sem duplicar nem reescrever configuracao do usuario", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t);
  const first = runBootstrap(sandbox);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const envFile = path.join(sandbox.userDir, ".env");
  const hotwordsFile = path.join(sandbox.userDir, "hotwords.txt");
  fs.writeFileSync(envFile, "CONFIGURACAO_DO_USUARIO=preservada\n");
  fs.writeFileSync(hotwordsFile, "Medium Latens\n");

  const second = runBootstrap(sandbox);

  assert.equal(second.status, 0, second.stderr || second.stdout);
  assertEightSteps(second.stdout);
  assert.match(second.stdout, /^PRONTO$/m);
  assert.equal(fs.readFileSync(envFile, "utf8"), "CONFIGURACAO_DO_USUARIO=preservada\n");
  assert.equal(fs.readFileSync(hotwordsFile, "utf8"), "Medium Latens\n");

  const installLog = fs.readFileSync(path.join(sandbox.userDir, "logs", "install.log"), "utf8");
  for (let step = 1; step <= 8; step += 1) {
    assert.equal((installLog.match(new RegExp(`^PASSO ${step}/8: `, "gm")) || []).length, 2);
  }
  assert.equal((installLog.match(/^PRONTO$/gm) || []).length, 2);

  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  const userUid = os.userInfo().uid;
  const plistPath = path.join(sandbox.home, "Library", "LaunchAgents", "com.brunocorrea.mediumlatens.plist");
  const escapedPlistPath = plistPath.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  assert.equal((calls.match(new RegExp("^launchctl bootout gui/" + userUid + "/com\\.brunocorrea\\.mediumlatens$", "gm")) || []).length, 2);
  assert.equal((calls.match(new RegExp("^launchctl bootstrap gui/" + userUid + " " + escapedPlistPath + "$", "gm")) || []).length, 2);

  const panelDir = path.join(sandbox.home, "Library", "Application Support", "Adobe", "CEP", "extensions", "MediumLatens");
  assert.deepEqual(fs.readdirSync(panelDir).sort(), ["index.html"]);
  const launchAgents = path.join(sandbox.home, "Library", "LaunchAgents");
  assert.deepEqual(fs.readdirSync(launchAgents).sort(), ["com.brunocorrea.mediumlatens.plist"]);
});

test("instala o Node quando ele ainda nao existe e continua o bootstrap", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { nodeInstalled: false });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assertEightSteps(result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.match(calls, /^curl .*nodejs\.org\/dist\/index\.json/m);
  assert.match(calls, /^curl .*node-v26\.0\.0\.pkg/m);
  assert.doesNotMatch(calls, /node-v99\.0\.0\.pkg/);
  const pkgMatch = calls.match(/^installer -pkg (.+) -target \/$/m);
  assert.ok(pkgMatch, calls);
  assert.match(pkgMatch[1], /medium-latens-node\./);
  assert.equal(fs.existsSync(pkgMatch[1]), false);
});

test("hash divergente remove ffmpeg e vira aviso sem impedir o restante", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { ffmpegHashMatches: false });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(sandbox.userDir, "bin", "ffmpeg")), false);
  assert.ok(fs.existsSync(path.join(sandbox.userDir, "bin", "ffprobe")));
  assert.match(result.stdout, /AVISO:.*ffmpeg.*SHA-256/i);
});

test("falha de health encerra com codigo 1 e aponta os dois logs", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { healthMode: "fail" });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /^FALHOU: /m);
  assert.match(result.stdout, new RegExp(path.join(sandbox.userDir, "logs", "install.log").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.stdout, new RegExp(path.join(sandbox.userDir, "logs", "err.log").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const installLog = fs.readFileSync(path.join(sandbox.userDir, "logs", "install.log"), "utf8");
  assert.match(installLog, /^FALHOU: /m);
  assert.match(installLog, /err\.log/);
});

test("Node 20 instalado é tratado como ausente por estar fora de suporte", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { nodeMajor: "20" });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.match(calls, /^curl .*nodejs\.org\/dist\/index\.json/m);
  assert.match(calls, /^installer -pkg .+ -target \/$/m);
});

test("Node 22 instalado é aceito sem download", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { nodeMajor: "22" });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.doesNotMatch(calls, /nodejs\.org\/dist\/index\.json/);
  assert.doesNotMatch(calls, /^installer -pkg/m);
});

test("stderr do probe de Node nao contamina a versao capturada", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { nodeMajor: "22", nodeProbeStderr: true });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.doesNotMatch(calls, /nodejs\.org\/dist\/index\.json/);
  assert.match(fs.readFileSync(BOOTSTRAP, "utf8"), /como_usuario "\$NODE_BIN" -p [^\n]+ 2>\/dev\/null/);
});

function caminhoDoPkgBaixado(calls) {
  const m = calls.match(/^curl .*-o (\S+) https:\/\/nodejs\.org\/dist\/v26\.0\.0\/node-v26\.0\.0\.pkg$/m);
  assert.ok(m, `download do pkg não encontrado em:\n${calls}`);
  return m[1];
}

test("instala o Node só depois de conferir o SHA-256 oficial", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { nodeInstalled: false });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  const somas = calls.indexOf("nodejs.org/dist/v26.0.0/SHASUMS256.txt");
  const installer = calls.indexOf("installer -pkg");
  assert.ok(somas !== -1, "a lista de somas não foi baixada");
  assert.ok(installer !== -1 && somas < installer, "a lista de somas precisa vir antes do installer");
  const installLog = fs.readFileSync(path.join(sandbox.userDir, "logs", "install.log"), "utf8");
  assert.match(installLog, /^Node\.js v26\.0\.0 verificado \(SHA-256 confere\)$/m);
});

test("soma diferente da oficial interrompe a instalação sem rodar o installer", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { nodeInstalled: false, shasumsMode: "errada" });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /não confere com a verificação oficial/);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.doesNotMatch(calls, /^installer -pkg/m);
  assert.equal(fs.existsSync(caminhoDoPkgBaixado(calls)), false, "o pacote rejeitado tem que ser apagado");
});

test("lista oficial sem a linha do pacote interrompe a instalação", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t, { nodeInstalled: false, shasumsMode: "ausente" });

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /não menciona node-v26\.0\.0\.pkg/);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  assert.doesNotMatch(calls, /^installer -pkg/m);
  assert.equal(fs.existsSync(caminhoDoPkgBaixado(calls)), false);
});

test("o motor Python é instalado a partir do requirements.txt do programa", { skip: SO_MACOS }, (t) => {
  const sandbox = createSandbox(t);

  const result = runBootstrap(sandbox);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(sandbox.callsLog, "utf8");
  const appDir = sandbox.appDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(calls, new RegExp(`^pip install --quiet -r ${appDir}/engine/requirements\\.txt$`, "m"));
  assert.doesNotMatch(calls, /^pip install --quiet (--upgrade pip )?(numpy|opencv|mlx-whisper|faster-whisper)/m);
});
