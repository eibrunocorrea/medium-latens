"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const REPO_ROOT = path.join(__dirname, "..");
const ISS = path.join(REPO_ROOT, "installer", "windows", "medium-latens.iss");
const BOOTSTRAP = path.join(REPO_ROOT, "installer", "bootstrap.ps1");
const VERSIONS = path.join(REPO_ROOT, "installer", "versoes.env");
const UNINSTALLER = path.join(REPO_ROOT, "installer", "desinstalar.ps1");
const BUILD = path.join(REPO_ROOT, "installer", "windows", "build.ps1");
const ABRIR = path.join(REPO_ROOT, "status", "abrir.ps1");
const ABRIR_HIDDEN = path.join(REPO_ROOT, "status", "abrir-hidden.vbs");

function findPwsh() {
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" });
  if (result.error && result.error.code === "ENOENT") return null;
  assert.equal(result.status, 0, result.stderr || result.stdout || "pwsh falhou");
  return "pwsh";
}

function windowsPathToLocal(base, value, origem) {
  const normalized = value.replace(/\\/g, path.sep);
  if (/^\{app\}[\\/]/i.test(value)) {
    return path.join(REPO_ROOT, normalized.replace(/^\{app\}[\\/]/i, ""));
  }
  if (/^\{#Origem\}[\\/]/i.test(value)) {
    const relative = normalized.replace(/^\{#Origem\}[\\/]/i, "");
    const withoutWildcard = relative.split(path.sep).filter((part) => !/[?*]/.test(part));
    return path.join(origem, ...withoutWildcard);
  }
  if (/^\.\.[\\/]/.test(value)) {
    const withoutWildcard = normalized.split(path.sep).filter((part) => !/[?*]/.test(part));
    return path.resolve(base, ...withoutWildcard);
  }
  return null;
}

function uninstallDeleteNames(source) {
  const uninstallDeleteStart = source.indexOf("[UninstallDelete]");
  assert.notEqual(uninstallDeleteStart, -1, "[UninstallDelete] ausente no .iss");
  const afterUninstallDelete = source.slice(uninstallDeleteStart + "[UninstallDelete]".length);
  const nextSection = afterUninstallDelete.search(/^\[[^\]\r\n]+\]\s*$/m);
  const uninstallDelete = nextSection === -1
    ? afterUninstallDelete
    : afterUninstallDelete.slice(0, nextSection);
  return [...uninstallDelete.matchAll(/\bName:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function openHealthServer() {
  for (;;) {
    const server = http.createServer((request, response) => {
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":true}\n');
        return;
      }
      response.writeHead(404);
      response.end();
    });
    const port = await listen(server);
    if (port !== 8765) return { server, port };
    await close(server);
  }
}

function runLauncher(pwsh, userDir, port) {
  assert.notEqual(port, 8765, "o teste nunca pode tocar a porta 8765");
  return new Promise((resolve, reject) => {
    const child = spawn(pwsh, ["-NoProfile", "-File", ABRIR, "-Simular"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        APPDATA: userDir,
        MEDIUM_LATENS_PORTA: String(port),
        MEDIUM_LATENS_USER_DIR: userDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`abrir.ps1 excedeu o tempo limite\n${stderr}${stdout}`));
    }, 20_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function probeHealth(pwsh, port) {
  assert.notEqual(port, 8765, "o teste nunca pode tocar a porta 8765");
  const health = `http://127.0.0.1:${port}/health`;
  const escaped = health.replace(/'/g, "''");
  return new Promise((resolve, reject) => {
    const child = spawn(pwsh, [
      "-NoProfile",
      "-Command",
      `try { Invoke-RestMethod '${escaped}' -TimeoutSec 2 -ErrorAction Stop | Out-Null; Write-Output 'OK' } catch { Write-Output $_.Exception.ToString(); exit 1 }`,
    ], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ status: code, stdout, stderr }));
  });
}

test("o Inno Setup referencia somente arquivos existentes e exclui dados locais", () => {
  const source = fs.readFileSync(ISS, "utf8");
  const issDir = path.dirname(ISS);
  const origemMatch = source.match(/^#define Origem "([^"]+)"$/m);
  assert.ok(origemMatch, "Origem padrao ausente no .iss");
  const origem = path.resolve(issDir, origemMatch[1].replace(/\\/g, path.sep));
  assert.match(source, /FileOpen\(Origem \+ "\\VERSION"\)/);
  assert.ok(fs.existsSync(path.join(origem, "VERSION")), "Origem + \\VERSION nao existe");

  const references = [];
  const property = /\b(Source|Filename|IconFilename)\s*:\s*"([^"]+)"|\bSetupIconFile\s*=\s*(?:"([^"]+)"|([^;\r\n]+))/g;
  for (const match of source.matchAll(property)) {
    const value = match[2] || match[3] || match[4].trim();
    const local = windowsPathToLocal(issDir, value, origem);
    if (local) references.push({ value, local });
  }
  for (const match of source.matchAll(/\{app\}\\([^"';\r\n]+)/gi)) {
    references.push({ value: match[0], local: path.join(REPO_ROOT, ...match[1].split("\\")) });
  }

  for (const { value, local } of references) {
    assert.ok(fs.existsSync(local), `referencia inexistente no .iss: ${value} -> ${local}`);
  }
  for (const relative of [
    "status/abrir.cmd",
    "assets/icon/icon.ico",
    "installer/bootstrap.ps1",
    "windows/uninstall-service.ps1",
  ]) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, relative)), `${relative} nao existe`);
  }

  const excludesMatch = source.match(/\bExcludes:\s*"([^"]+)"/);
  assert.ok(excludesMatch, "Excludes ausente no .iss");
  const excludes = new Set(excludesMatch[1].split(","));
  for (const required of [
    ".git\\*",
    "node_modules\\*",
    "test\\*",
    "dist\\*",
    "remotion\\*",
    "installer\\macos\\*",
    "install-panel.sh",
    "test.sh",
    ".gitignore",
    ".env",
    "config.json",
    "profiles.json",
    "credentials.json",
    "mcp-config.json",
    "data\\*",
    "workspaces\\*",
    "*.log",
    "__pycache__\\*",
    "*.pyc",
    "installer\\bootstrap.sh",
    "installer\\desinstalar.sh",
    "installer\\windows\\*",
  ]) {
    assert.ok(excludes.has(required), `Excludes nao contem ${required}`);
  }
  assert.match(source, /^PrivilegesRequired=lowest$/m);
  assert.match(source, /^AppVersion=\{#Versao\}$/m);
  assert.match(source, /^LicenseFile=\{#Origem\}\\TERMOS\.md$/m);
  assert.ok(fs.existsSync(path.join(origem, "TERMOS.md")), "TERMOS.md referenciado pela licença não existe");
  assert.match(source, /^\[Code\]$/m);
  assert.match(source, /\bExec\(/);
  assert.match(source, /\bMsgBox\(/);
  assert.doesNotMatch(source, /^\[Run\]$/m);
  assert.match(source, /^\[UninstallRun\][\s\S]*\bRunOnceId\s*:/m);

  const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
  assert.match(bootstrap, /MEDIUM_LATENS_USER_DIR/);
  assert.match(bootstrap, /Instalar-NpmGlobal "ffprobe-static@\$FFPROBE_STATIC" -IgnorarScripts/);
  assert.match(bootstrap, /npm root -g/);
  assert.doesNotMatch(bootstrap, /Instalar-NpmGlobal "ffmpeg-static/);
  assert.match(bootstrap, /ffmpeg-win32-x64/);
  assert.doesNotMatch(bootstrap, /ffmpeg-win32-arm64/);
  assert.match(bootstrap, /Get-FileHash -Algorithm SHA256 -Path \$ffmpegTemp/);
  assert.match(bootstrap, /Copy-Item .*ffprobe-static.*ffprobe\.exe.*\$UserDir\\bin\\ffprobe\.exe/);
  assert.match(bootstrap, /ffprobe-static\\bin\\win32\\\$midiaArch\\ffprobe\.exe/);
  assert.match(bootstrap, /\$midiaArch = "x64"/);
  const nodeBlock = bootstrap.slice(
    bootstrap.indexOf("if (-not $temNode)"),
    bootstrap.indexOf('Passo 3 "Instalando os componentes de IA"'),
  );
  const nodeTryEnd = nodeBlock.lastIndexOf("} catch {");
  const markerWrite = nodeBlock.indexOf("Set-Content $marcadorNode");
  assert.ok(markerWrite > nodeTryEnd, "o marcador do Node precisa ser gravado depois do try/catch");
  assert.match(nodeBlock, /\$marcadorNode = "\$dir\\\.medium-latens-instalou"/);
  assert.match(
    nodeBlock,
    /Set-Content \$marcadorNode "Medium Latens" -ErrorAction SilentlyContinue/,
  );
  assert.match(nodeBlock, /Aviso .*marcador/i);
  assert.match(
    bootstrap,
    /if \(\$LASTEXITCODE -ne 0\) \{\s*Aviso "Nao consegui habilitar o modo de depuracao do painel no CSXS \$v"/,
  );
  assert.doesNotMatch(bootstrap, /if \(\$LASTEXITCODE -ne 0\) \{ throw "registro" \}/);
  assert.match(bootstrap, /registrarAceite\(process\.argv\[2\]\)/);
  assert.match(bootstrap, /\$VersaoTermos\s*=\s*\$matchTermos\.Groups\[1\]\.Value/);
  const acceptanceLine = bootstrap.split(/\r?\n/).find((line) => line.includes("registrarAceite"));
  assert.ok(acceptanceLine, "linha de registrarAceite ausente");
  const evalArgument = acceptanceLine.match(/\s-e\s+(.+?)\s+\$AppDir\b/);
  assert.ok(evalArgument, "argumento do node -e não pôde ser extraído");
  assert.ok(evalArgument[1].startsWith('"') && evalArgument[1].endsWith('"'));
  assert.doesNotMatch(evalArgument[1].slice(1, -1), /"/);
  assert.match(acceptanceLine, /\$VersaoTermos/);
  assert.doesNotMatch(acceptanceLine, /"1\.0"/);

  const uninstallDeleteStart = source.indexOf("[UninstallDelete]");
  const afterUninstallDelete = source.slice(uninstallDeleteStart + "[UninstallDelete]".length);
  const nextSection = afterUninstallDelete.search(/^\[[^\]\r\n]+\]\s*$/m);
  const uninstallDelete = nextSection === -1
    ? afterUninstallDelete
    : afterUninstallDelete.slice(0, nextSection);
  assert.match(
    uninstallDelete,
    /^Type: filesandordirs; Name: "\{userappdata\}\\Adobe\\CEP\\extensions\\MediumLatens"$/m,
  );
  const uninstallNames = uninstallDeleteNames(source);
  assert.ok(uninstallNames.length > 0, "[UninstallDelete] precisa ter ao menos um Name");
  assert.deepEqual(
    uninstallNames.filter((name) => /Medium Latens/i.test(name) && !/Adobe\\CEP/i.test(name)),
    [],
    "[UninstallDelete] nao pode remover o USER_DIR",
  );

  assert.ok(fs.existsSync(ABRIR_HIDDEN), "status/abrir-hidden.vbs nao existe");
  assert.match(fs.readFileSync(ABRIR_HIDDEN, "utf8"), /abrir\.ps1/i);
  const launcher = fs.readFileSync(ABRIR, "utf8");
  assert.match(launcher, /Join-Path \$UserDir "status-abrir\.html"/);
  assert.match(launcher, /WriteAllText\(\$Alvo, \$Html/);
  assert.match(launcher, /Start-Process \$Alvo/);
  assert.ok(fs.existsSync(BUILD), "installer/windows/build.ps1 nao existe");
  const build = fs.readFileSync(BUILD, "utf8");
  const bom = build.indexOf("[System.IO.File]::WriteAllText");
  const iscc = build.indexOf("& $Iscc");
  assert.match(
    build,
    /\[System\.IO\.File\]::ReadAllText\(\$TermosStage, \[System\.Text\.Encoding\]::UTF8\)/,
  );
  assert.match(build, /WriteAllText\(\$TermosStage, \$texto, \(New-Object System\.Text\.UTF8Encoding \$true\)\)/);
  assert.ok(bom >= 0 && iscc > bom, "TERMOS.md precisa receber BOM no stage antes do ISCC");

  assert.match(
    bootstrap,
    /\[System\.IO\.File\]::ReadAllText\(\$caminhoTermos, \[System\.Text\.Encoding\]::UTF8\)/,
  );
  assert.match(bootstrap, /vers\.\{1,2\}o/);
  for (const [nome, script] of [["build.ps1", build], ["bootstrap.ps1", bootstrap]]) {
    const unsafeTermReads = script
      .split(/\r?\n/)
      .filter((line) => /Get-Content.*TERMOS/i.test(line) && !/-Encoding\b/i.test(line));
    assert.deepEqual(
      unsafeTermReads,
      [],
      `${nome} nao pode ler TERMOS com Get-Content sem encoding explicito`,
    );
  }

  assert.match(
    launcher,
    /if \(\$PSVersionTable\.PSEdition -eq "Core" -and \$PSVersionTable\.Platform -eq "Unix"\)/,
  );
  assert.match(launcher, /try \{[\s\S]*?SetUnixFileMode[\s\S]*?\} catch \{\}/);
  assert.doesNotMatch(launcher, /\$IsWindows/);
});

test("build.ps1 grava o carimbo BUILD depois de extrair o fonte e antes de chamar o ISCC", () => {
  const build = fs.readFileSync(BUILD, "utf8");
  const extracao = build.indexOf("Expand-Archive");
  const carimbo = build.indexOf('"oficial`": true');
  const iscc = build.indexOf("& $Iscc");
  assert.ok(extracao !== -1 && carimbo !== -1 && iscc !== -1, "faltou Expand-Archive, carimbo ou ISCC");
  assert.ok(extracao < carimbo && carimbo < iscc, "o carimbo precisa ser gravado entre a extração e o ISCC");
  assert.match(build, /Join-Path \$Origem "BUILD"/);
  const iss = fs.readFileSync(ISS, "utf8");
  assert.doesNotMatch(iss, /Excludes: "[^"]*\bBUILD\b/);
});

test("a guarda de UninstallDelete detecta o USER_DIR em uma secao sintetica", () => {
  const malicious = `[UninstallDelete]
Type: filesandordirs; Name: "{userappdata}\\Medium Latens"

[Code]
`;
  assert.deepEqual(uninstallDeleteNames(malicious), ["{userappdata}\\Medium Latens"]);
});

test("o desinstalador PowerShell aborta antes de qualquer remocao quando a guarda recusa", () => {
  const source = fs.readFileSync(UNINSTALLER, "utf8");
  assert.match(
    source,
    /if\s*\(\s*-not\s+\$appDirSafe\s*\)\s*\{[\s\S]*?Write-Warning[\s\S]*?exit 1[\s\S]*?\}/,
  );
  const guardExit = source.indexOf("exit 1");
  const service = source.indexOf("uninstall-service.ps1");
  const panel = source.indexOf("Adobe\\CEP\\extensions\\MediumLatens");
  assert.ok(guardExit !== -1 && guardExit < service && guardExit < panel);
});

test("a guarda PowerShell recusa contencao nos dois sentidos", () => {
  const source = fs.readFileSync(UNINSTALLER, "utf8");
  assert.match(source, /DirectorySeparatorChar/);
  assert.ok((source.match(/StartsWith\(/g) || []).length >= 2);
  assert.match(source, /OrdinalIgnoreCase/);
});

test("o desinstalador PowerShell verifica remocoes e reporta o resultado real", () => {
  const source = fs.readFileSync(UNINSTALLER, "utf8");
  assert.match(source, /MEDIUM_LATENS_USER_DIR/);
  assert.match(source, /\$falhas\s*=\s*0/);
  assert.ok((source.match(/Remove-Item[\s\S]{0,240}?Test-Path/g) || []).length >= 2);
  assert.match(source, /Start-Process[\s\S]{0,240}?ExitCode/);
  assert.match(source, /if\s*\(\s*\$falhas\s*-eq\s*0\s*\)/);
  assert.match(source, /continuam em \$userDir/);
  assert.match(source, /\.medium-latens-instalou/);
  assert.match(source, /GetEnvironmentVariable\("Path", "User"\)/);
  assert.match(source, /SetEnvironmentVariable\("Path", \$novoPathUsuario, "User"\)/);
  assert.match(source, /Node\.js instalado pelo Medium Latens foi removido/);
  assert.match(source, /Node\.js por usuario foi mantido/);
  assert.match(source, /exit 1/);
});

test("bootstrap.ps1 preserva nodejs existente sem marcador e usa diretorio alternativo", () => {
  const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
  const nodeBlock = bootstrap.slice(
    bootstrap.indexOf("if (-not $temNode)"),
    bootstrap.indexOf('Passo 3 "Instalando os componentes de IA"'),
  );
  assert.match(nodeBlock, /Programs\\nodejs"/);
  assert.match(nodeBlock, /Programs\\nodejs-medium-latens"/);
  assert.match(
    nodeBlock,
    /if \(\(Test-Path -LiteralPath \$nodeDirPadrao\) -and -not \(Test-Path -LiteralPath \$marcadorNodePadrao\)\)[\s\S]*?\$dir = \$nodeDirAlternativo/,
  );
  assert.match(
    nodeBlock,
    /if \(Test-Path -LiteralPath \$marcadorNode\) \{\s*Remove-Item -LiteralPath \$dir -Recurse -Force/,
  );
  assert.doesNotMatch(nodeBlock, /^\s*Remove-Item -Recurse -Force \$dir/m);
});

test("desinstalador remove somente diretorios Node marcados, inclusive o alternativo", () => {
  const source = fs.readFileSync(UNINSTALLER, "utf8");
  assert.match(source, /Programs\\nodejs"/);
  assert.match(source, /Programs\\nodejs-medium-latens"/);
  assert.match(source, /foreach \(\$nodeDir in \$nodeDirs\)/);
  assert.match(
    source,
    /if \(Test-Path -LiteralPath \$nodeMarker\) \{\s*Remove-Item -LiteralPath \$nodeDir -Recurse -Force/,
  );
});

test("bootstrap registra e desinstalador restaura somente PlayerDebugMode alterado", () => {
  const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
  const source = fs.readFileSync(UNINSTALLER, "utf8");
  assert.match(bootstrap, /reg query "HKCU\\Software\\Adobe\\CSXS\.\$v" \/v PlayerDebugMode/);
  assert.match(bootstrap, /cep-debug-ativado/);
  assert.match(bootstrap, /Add-Content .*\$v/);
  assert.match(source, /cep-debug-ativado/);
  assert.match(source, /Test-Path -LiteralPath \$debugMarker/);
  assert.match(
    source,
    /reg delete "HKCU\\Software\\Adobe\\CSXS\.\$v" \/v PlayerDebugMode \/f/,
  );
});

test("desinstalador remove o prefixo npm do Path sem apagar os CLIs", () => {
  const source = fs.readFileSync(UNINSTALLER, "utf8");
  assert.match(source, /Join-Path \$userDir "npm"/);
  assert.match(source, /SetEnvironmentVariable\("Path", \$novoPathUsuario, "User"\)/);
  assert.doesNotMatch(source, /Remove-Item[^\n]*\$npmPrefix/);
  assert.match(source, /CLIs fixados continuam em \$userDir\\npm/);
});

test("os scripts PowerShell passam no parser e o bootstrap nao usa msiexec", (t) => {
  const pwsh = findPwsh();
  if (!pwsh) {
    t.skip("pwsh nao esta disponivel nesta plataforma");
    return;
  }

  const files = [BOOTSTRAP, UNINSTALLER, BUILD, ABRIR];
  const parseCommands = files.map((file) => {
    const escaped = file.replace(/'/g, "''");
    return `$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }`;
  });
  const result = spawnSync(pwsh, ["-NoProfile", "-Command", parseCommands.join("; ")], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
  assert.match(bootstrap, /PROCESSOR_ARCHITEW6432/);
  assert.doesNotMatch(bootstrap, /SocketsHttpHandler|msiexec/i);
  assert.doesNotMatch(fs.readFileSync(ABRIR, "utf8"), /SocketsHttpHandler/i);
});

test("o lancador simula status autenticado e fallback sem abrir o navegador", async (t) => {
  const pwsh = findPwsh();
  if (!pwsh) {
    t.skip("pwsh nao esta disponivel nesta plataforma");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-windows-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const withToken = path.join(root, "with-token");
  const withoutToken = path.join(root, "without-token");
  fs.mkdirSync(withToken, { recursive: true });
  fs.mkdirSync(withoutToken, { recursive: true });
  const token = "token-windows-status-seguro";
  fs.writeFileSync(path.join(withToken, "token"), `${token}\n`);

  const healthy = await openHealthServer();
  try {
    const probe = await probeHealth(pwsh, healthy.port);
    const authenticated = await runLauncher(pwsh, withToken, healthy.port);
    assert.equal(authenticated.code, 0, authenticated.stderr || authenticated.stdout);
    if (probe.status === 0) {
      const redirect = path.join(withToken, "status-abrir.html");
      assert.equal(authenticated.stdout.trim(), redirect);
      assert.doesNotMatch(`${authenticated.stdout}\n${authenticated.stderr}`, new RegExp(token));
      assert.match(
        fs.readFileSync(redirect, "utf8"),
        new RegExp(`http://127\\.0\\.0\\.1:${healthy.port}/status\\?t=${token}`),
      );

      const missingToken = await runLauncher(pwsh, withoutToken, healthy.port);
      assert.equal(missingToken.code, 0, missingToken.stderr || missingToken.stdout);
      assert.match(missingToken.stdout.trim(), /status[\\/]index\.html$/);
    } else {
      assert.match(`${probe.stderr}\n${probe.stdout}`, /CookieContainer[\s\S]*GetDomainName/);
      assert.match(authenticated.stdout.trim(), /status[\\/]index\.html$/);
    }
  } finally {
    await close(healthy.server);
  }

  const closed = await openHealthServer();
  const closedPort = closed.port;
  await close(closed.server);
  const unavailable = await runLauncher(pwsh, withToken, closedPort);
  assert.equal(unavailable.code, 0, unavailable.stderr || unavailable.stdout);
  assert.match(unavailable.stdout.trim(), /status[\\/]index\.html$/);
});

test("bootstrap.ps1 exige Node 22 ou mais novo", () => {
  const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
  assert.match(bootstrap, /\[int\]\$v -ge 22/);
  assert.doesNotMatch(bootstrap, /\[int\]\$v -ge (1[0-9]|20|21)\b/);
});

test("bootstraps compartilham pins verificados e isolam o prefixo npm", () => {
  const versions = fs.readFileSync(VERSIONS, "utf8");
  assert.match(versions, /^CLAUDE_CODE=2\.1\.263$/m);
  assert.match(versions, /^CODEX=0\.153\.4$/m);
  assert.match(versions, /^GEMINI_CLI=0\.58\.0$/m);
  assert.match(versions, /^PREMIERE_PRO_MCP=1\.14\.9$/m);
  assert.match(versions, /^FFPROBE_STATIC=3\.1\.0$/m);
  assert.match(versions, /^FFMPEG_STATIC_TAG=b6\.1\.1$/m);
  assert.doesNotMatch(versions, /^FFMPEG_SHA256_WIN32_ARM64=/m);

  const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
  assert.match(bootstrap, /installer[\\/]versoes\.env/);
  assert.match(bootstrap, /npm_config_prefix/);
  assert.match(bootstrap, /@anthropic-ai\/claude-code@\$CLAUDE_CODE/);
  assert.match(bootstrap, /@openai\/codex@\$CODEX/);
  assert.match(bootstrap, /@google\/gemini-cli@\$GEMINI_CLI/);
  assert.match(bootstrap, /Instalar-NpmGlobal "premiere-pro-mcp@\$PREMIERE_PRO_MCP" -IgnorarScripts/);
  assert.match(bootstrap, /Instalar-NpmGlobal "ffprobe-static@\$FFPROBE_STATIC" -IgnorarScripts/);
  assert.match(bootstrap, /\$argumentosNpm \+= "--ignore-scripts"/);
  assert.ok([...bootstrap].every((character) => character.codePointAt(0) <= 0x7f), "bootstrap.ps1 deve permanecer ASCII");
});

test("bootstrap.ps1 baixa ffmpeg x64 oficial e verifica o hash antes de instalar", () => {
  const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
  const download = bootstrap.indexOf("ffmpeg-win32-x64");
  const hash = bootstrap.indexOf("Get-FileHash -Algorithm SHA256 -Path $ffmpegTemp");
  const install = bootstrap.indexOf("Move-Item $ffmpegTemp $ffmpegDestino");
  assert.ok(download !== -1 && hash !== -1 && install !== -1, "faltou download, hash ou instalacao do ffmpeg");
  assert.ok(download < hash && hash < install, "o hash precisa ser conferido antes de instalar o ffmpeg");
  assert.match(bootstrap, /\$FFMPEG_SHA256_WIN32_X64/);
  assert.match(bootstrap, /Remove-Item -LiteralPath \$ffmpegTemp -Force/);
  assert.match(bootstrap, /Aviso "O ffmpeg baixado nao confere com SHA-256 oficial/);
});

test("bootstrap.ps1 normaliza o hash e reutiliza ffmpeg existente verificado", () => {
  const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
  const existing = bootstrap.indexOf("Get-FileHash -Algorithm SHA256 -Path $ffmpegDestino");
  const download = bootstrap.indexOf("Invoke-WebRequest $ffmpegUrl -OutFile $ffmpegTemp");
  assert.ok(existing !== -1 && download > existing, "o ffmpeg existente precisa ser verificado antes do download");
  assert.match(bootstrap, /\$ffmpegEsperada = \$FFMPEG_SHA256_WIN32_X64\.ToLower\(\)/);
  assert.match(bootstrap, /\$ffmpegJaValido/);
  assert.match(bootstrap, /if \(-not \$ffmpegJaValido\)/);
});

test("bootstrap.ps1 limpa configuracao e segredos antes de cada npm", () => {
  const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
  const inicio = bootstrap.indexOf("function Limpar-SegredosNpm");
  const fim = bootstrap.indexOf("function Instalar-NpmGlobal");
  assert.ok(inicio !== -1 && fim > inicio, "funcao Limpar-SegredosNpm ausente");
  const limpeza = bootstrap.slice(inicio, fim);
  assert.match(limpeza, /npm_config_/i);
  assert.match(limpeza, /_API_KEY/);
  for (const nome of [
    "NODE_OPTIONS",
    "NODE_EXTRA_CA_CERTS",
    "FFMPEG_BINARIES_URL",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
  ]) {
    assert.match(limpeza, new RegExp(nome));
  }
  const instalar = bootstrap.slice(fim, bootstrap.indexOf('Passo 1 "Preparando'));
  assert.match(instalar, /Limpar-SegredosNpm[\s\S]*\$env:npm_config_prefix = \$NpmPrefix/);
});

test("bootstrap.ps1 confere o SHA-256 oficial do Node.js antes de extrair", () => {
  const bootstrap = fs.readFileSync(BOOTSTRAP, "utf8");
  const download = bootstrap.indexOf('Invoke-WebRequest "https://nodejs.org/dist/$lts/$pastaInterna.zip"');
  const somas = bootstrap.indexOf("SHASUMS256.txt");
  const hash = bootstrap.indexOf("Get-FileHash -Algorithm SHA256");
  const extracao = bootstrap.indexOf("Expand-Archive -Path $zip");
  assert.ok(download !== -1 && somas !== -1 && hash !== -1 && extracao !== -1, "faltou download, lista de somas, hash ou extração");
  assert.ok(download < somas && somas < hash && hash < extracao, "a verificação precisa ficar entre o download e a extração");
  assert.match(bootstrap, /nao confere com a verificacao oficial/);
  assert.match(bootstrap, /nao menciona \$pastaInterna\.zip/);
});
