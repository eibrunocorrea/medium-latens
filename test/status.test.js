"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const STATUS_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-status-user-"));
process.env.MEDIUM_LATENS_USER_DIR = STATUS_USER_DIR;

const statusPage = require("../lib/status");
const telemetria = require("../lib/telemetria");
const paths = require("../lib/paths");
const termos = require("../lib/termos");
const SEM_SPAWN_REAL_WIN32 = process.platform === "win32" ? "o probe executa <bin>.exe -version de verdade e um script shell não é executável Win32; o caso Windows está no teste seguinte, com stubs" : false;

test.after(() => fs.rmSync(STATUS_USER_DIR, { recursive: true, force: true }));

function temporaryTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-status-"));
  const appDir = path.join(root, "app");
  const userDir = path.join(root, "user");
  fs.mkdirSync(appDir);
  fs.mkdirSync(path.join(userDir, "logs"), { recursive: true });
  return { root, appDir, userDir };
}

test("escapa versão, caminho e mensagem de log antes de montar o HTML", () => {
  const special = '<script>"teste" & mais</script>';
  const data = {
    service: special,
    version: special,
    logsDir: special,
    logsUrl: "file:///logs",
    installLog: { found: true, message: special },
    modules: [{ name: special, present: false, detail: special, action: special }],
    latest: null,
  };

  const html = statusPage.renderStatusHtml(data);

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /"teste"/);
  assert.match(html, /&lt;script&gt;&quot;teste&quot; &amp; mais&lt;\/script&gt;/);
});

test("lê VERSION e detecta os quatro módulos ausentes sem quebrar", () => {
  const { appDir, userDir } = temporaryTree();
  fs.writeFileSync(path.join(appDir, "VERSION"), "0.1.0-alpha.7\n");

  const data = statusPage.collectStatus({
    appDir,
    userDir,
    pythonInterpreter: path.join(userDir, "venv", "bin", "python3"),
    commandAvailable: () => false,
  });

  assert.equal(data.version, "0.1.0-alpha.7");
  assert.deepEqual(data.modules.map((module) => module.present), [false, false, false, false]);
  assert.equal(data.installLog.found, false);
});

test("Remotion ausente informa que não é distribuído e não recomenda reinstalação", () => {
  const { appDir, userDir } = temporaryTree();
  const data = statusPage.collectStatus({
    appDir,
    userDir,
    pythonInterpreter: path.join(userDir, "venv", "bin", "python3"),
    commandAvailable: () => false,
  });

  const remotion = data.modules.find((module) => module.name === "Remotion");
  assert.equal(
    remotion.action,
    "Não distribuído nesta versão. Geração de vídeo por Remotion fica para uma versão futura.",
  );
  assert.doesNotMatch(remotion.action, /reinstal/i);
});

test("ffmpeg e ffprobe instalados em USER_DIR/bin aparecem presentes", { skip: SEM_SPAWN_REAL_WIN32 }, () => {
  const { appDir, userDir } = temporaryTree();
  const binDir = path.join(userDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  for (const command of ["ffmpeg", "ffprobe"]) {
    fs.writeFileSync(path.join(binDir, command), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }

  const data = statusPage.collectStatus({ appDir, userDir, spawn: spawnSync });
  const media = data.modules.find((module) => module.name === "ffmpeg e ffprobe");

  assert.equal(media.present, true);
  assert.match(media.action, new RegExp(`${userDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/bin`));
});

test("ffmpeg e ffprobe usam o sufixo .exe do USER_DIR no Windows", () => {
  const { appDir, userDir } = temporaryTree();
  const binDir = path.join(userDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  for (const command of ["ffmpeg.exe", "ffprobe.exe"]) {
    fs.writeFileSync(path.join(binDir, command), "binario\n");
  }
  const calls = [];

  const data = statusPage.collectStatus({
    appDir,
    userDir,
    platform: "win32",
    commandAvailable(command) {
      calls.push(command);
      return true;
    },
  });
  const media = data.modules.find((module) => module.name === "ffmpeg e ffprobe");

  assert.equal(media.present, true);
  assert.deepEqual(calls, [path.join(binDir, "ffmpeg.exe"), path.join(binDir, "ffprobe.exe")]);
});

test("status tolera TERMOS.md ausente e informa versão nula", () => {
  const { appDir, userDir } = temporaryTree();
  const original = termos.versao;
  termos.versao = () => { throw new Error(`TERMOS.md ausente em ${appDir}`); };

  try {
    const data = statusPage.collectStatus({ appDir, userDir, commandAvailable: () => false });
    assert.equal(data.telemetria.termos, null);
  } finally {
    termos.versao = original;
  }
});

test("painel no Premiere aceita PlayerDebugMode 1 somente no CSXS 11 do macOS", () => {
  const { appDir, userDir, root } = temporaryTree();
  const panel = path.join(
    root,
    "home",
    "Library",
    "Application Support",
    "Adobe",
    "CEP",
    "extensions",
    "MediumLatens",
    "index.html",
  );
  fs.mkdirSync(path.dirname(panel), { recursive: true });
  fs.writeFileSync(panel, "<!doctype html>\n");
  const calls = [];

  const data = statusPage.collectStatus({
    appDir,
    userDir,
    homeDir: path.join(root, "home"),
    platform: "darwin",
    commandAvailable: () => false,
    spawn(command, args) {
      calls.push([command, args]);
      return { status: 0, stdout: args.includes("com.adobe.CSXS.11") ? "1\n" : "0\n" };
    },
  });
  const panelModule = data.modules.find((module) => module.name === "Painel no Premiere");

  assert.equal(panelModule.present, true);
  assert.deepEqual(calls, [
    ["defaults", ["read", "com.adobe.CSXS.9", "PlayerDebugMode"]],
    ["defaults", ["read", "com.adobe.CSXS.10", "PlayerDebugMode"]],
    ["defaults", ["read", "com.adobe.CSXS.11", "PlayerDebugMode"]],
  ]);
  assert.match(panelModule.action, /modo de depuração CEP 9 a 12/);
});

test("painel no Premiere aceita PlayerDebugMode 1 somente no CSXS 11 do Windows", () => {
  const { appDir, userDir, root } = temporaryTree();
  const appData = path.join(root, "appdata");
  const panel = path.join(appData, "Adobe", "CEP", "extensions", "MediumLatens", "index.html");
  fs.mkdirSync(path.dirname(panel), { recursive: true });
  fs.writeFileSync(panel, "<!doctype html>\n");
  const calls = [];

  const data = statusPage.collectStatus({
    appDir,
    userDir,
    appData,
    platform: "win32",
    commandAvailable: () => false,
    spawn(command, args) {
      calls.push([command, args]);
      const enabled = args.some((arg) => arg.includes("CSXS.11"));
      return { status: 0, stdout: enabled ? "PlayerDebugMode    REG_SZ    1\n" : "" };
    },
  });
  const panelModule = data.modules.find((module) => module.name === "Painel no Premiere");

  assert.equal(panelModule.present, true);
  assert.deepEqual(calls, [
    ["reg", ["query", "HKCU\\Software\\Adobe\\CSXS.9", "/v", "PlayerDebugMode"]],
    ["reg", ["query", "HKCU\\Software\\Adobe\\CSXS.10", "/v", "PlayerDebugMode"]],
    ["reg", ["query", "HKCU\\Software\\Adobe\\CSXS.11", "/v", "PlayerDebugMode"]],
  ]);
});

test("sem VERSION, install.log e módulos opcionais a página ainda monta", async () => {
  const { appDir, userDir } = temporaryTree();
  let fetchCalled = false;

  const html = await statusPage.renderStatusPage({
    appDir,
    userDir,
    pythonInterpreter: path.join(userDir, "venv", "bin", "python3"),
    commandAvailable: () => false,
    fetch: async () => { fetchCalled = true; throw new Error("não deveria consultar"); },
  });

  assert.match(html, /Versão instalada: <strong>não informada<\/strong>/);
  assert.match(html, /Esta instalação não passou pelo instalador/);
  assert.equal((html.match(/>Ausente<\/span>/g) || []).length, 4);
  assert.equal(fetchCalled, false);
});

test("install.log tem segredos ocultados antes do escape HTML", () => {
  const { appDir, userDir } = temporaryTree();
  const secret = "valor-super-secreto-123456";
  fs.writeFileSync(
    path.join(userDir, "logs", "install.log"),
    `PASSO 1/8: Preparando os arquivos do programa\nAVISO: token=${secret} <script>&\nmensagem=linha-livre-nao-renderizada\n`,
  );

  const data = statusPage.collectStatus({ appDir, userDir, commandAvailable: () => false });
  const html = statusPage.renderStatusHtml({ ...data, latest: null });

  assert.doesNotMatch(html, new RegExp(secret));
  assert.match(html, /token=\[oculto\] &lt;script&gt;&amp;/);
  assert.doesNotMatch(html, /linha-livre-nao-renderizada/);
  assert.doesNotMatch(html, /<script>/);
});

test("oculta atribuições sensíveis reais sem apagar linhas normais", () => {
  const secrets = [
    ["GEMINI_API_KEY", "AIzaSyD-1234567890abcdefghijklmnopqrst"],
    ["ANTHROPIC_API_KEY", "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz"],
    ["OPENAI_API_KEY", "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456"],
    ["ELEVENLABS_API_KEY", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"],
    ["META_PAGE_TOKEN_X", "EAAG1234567890abcdefghijklmnop"],
  ];
  const sensitiveLines = [
    ...secrets.flatMap(([name, value]) => [
      [`${name}=${value}`, value],
      [`${name} : ${value}`, value],
    ]),
    [`--api-key ${secrets[0][1]}`, secrets[0][1]],
    [`--token ${secrets[4][1]}`, secrets[4][1]],
    [`{"api_key":"${secrets[0][1]}"}`, secrets[0][1]],
    [`{"api_key": "${secrets[0][1]}"}`, secrets[0][1]],
    [`"key": "${secrets[0][1]}"`, secrets[0][1]],
    [`'api_key': '${secrets[0][1]}'`, secrets[0][1]],
    [`--token "${secrets[4][1]} com espaço interno"`, `${secrets[4][1]} com espaço interno`],
    ["x-medium-latens-token: deadbeefdeadbeef", "deadbeefdeadbeef"],
    ["Authorization: Bearer sk-live-9999999999999", "sk-live-9999999999999"],
    ["Authorization: Basic dGVzdHVzZXI6dGVzdHBhc3N3b3JkMTIzNDU2", "dGVzdHVzZXI6dGVzdHBhc3N3b3JkMTIzNDU2"],
    ["Authorization: Digest digest-secreto-123", "digest-secreto-123"],
    ["https://user:senha@host/path", "user:senha"],
    ["chave=VALOR", "VALOR"],
    ["senha=VALOR", "VALOR"],
    ["segredo: VALOR", "VALOR"],
  ];

  for (const [line, secret] of sensitiveLines) {
    const redacted = statusPage.redactSecrets(line);
    assert.ok(!redacted.includes(secret), `valor ainda visível em ${line.slice(0, line.indexOf(secret))}`);
    assert.match(redacted, /\[oculto\]/);
  }

  const authorizationLines = [
    ["Authorization: Basic dGVzdA==", "Authorization: Basic [oculto]", "dGVzdA=="],
    ["Authorization: Digest digest-secreto-123", "Authorization: Digest [oculto]", "digest-secreto-123"],
    ["Authorization: Bearer bearer-secreto-123", "Authorization: Bearer [oculto]", "bearer-secreto-123"],
    ["Authorization: abcdef1234567890", "Authorization: [oculto]", "abcdef1234567890"],
    ["Authorization \t:  onlyonetoken", "Authorization \t:  [oculto]", "onlyonetoken"],
  ];

  for (const [line, expected, secret] of authorizationLines) {
    const redacted = statusPage.redactSecrets(line);
    assert.equal(redacted, expected);
    assert.ok(!redacted.includes(secret), `valor de Authorization ainda visível em ${line}`);
  }

  const normalLines = [
    "erro no passo 4: timeout",
    "instalando numpy e opencv-python-headless",
    "MONKEY=banana",
    "/Users/ana/.medium-latens/logs/install.log",
    "baixando node-v22.11.0-darwin-arm64.tar.gz",
    "Warning: key features missing in this build",
    "o chaveiro do sistema foi consultado",
    "senhas antigas não são aceitas",
    "https://exemplo.com/caminho",
  ];

  for (const line of normalLines) {
    assert.equal(statusPage.redactSecrets(line), line);
  }
});

test("redige segredo solto pelo mesmo catálogo usado na telemetria", () => {
  const aws = ["AK", "IA", "Q7W8E9R0T1Y2U3I4"].join("");
  const github = ["github", "_pat_", "R7qLm2XvKp9wTz4NbHc1JdYg"].join("");

  assert.equal(statusPage.redactSecrets(aws), "[oculto]");
  assert.equal(statusPage.redactSecrets(github), "[oculto]");
});

test("nenhum formato real de chave do install.log chega ao HTML final", async () => {
  const { appDir, userDir } = temporaryTree();
  const secrets = [
    ["GEMINI_API_KEY: AIzaSyD-1234567890abcdefghijklmnopqrst", "AIzaSyD-1234567890abcdefghijklmnopqrst"],
    ["ANTHROPIC_API_KEY: sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz", "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz"],
    ["OPENAI_API_KEY: sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456", "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456"],
    ["ELEVENLABS_API_KEY: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"],
    ["META_PAGE_TOKEN_X: EAAG1234567890abcdefghijklmnop", "EAAG1234567890abcdefghijklmnop"],
    ["x-medium-latens-token: deadbeefdeadbeef", "deadbeefdeadbeef"],
    ["Authorization: Bearer sk-live-9999999999999", "sk-live-9999999999999"],
  ];
  const installLog = ["PASSO 1/8: Preparando os arquivos do programa", ...secrets.map(([line]) => `AVISO: ${line}`)].join("\n");
  fs.writeFileSync(path.join(userDir, "logs", "install.log"), installLog);

  const html = await statusPage.renderStatusPage({
    appDir,
    userDir,
    commandAvailable: () => false,
  });

  for (const [, value] of secrets) {
    assert.ok(!html.includes(value), "um valor sensível chegou ao HTML final");
  }
  assert.ok((html.match(/\[oculto\]/g) || []).length >= secrets.length);
});

test("nenhuma forma de flag ou campo JSON do install.log chega ao HTML final", async () => {
  const { appDir, userDir } = temporaryTree();
  const secrets = [
    ["--api-key AIzaSyD-1111111111abcdefghijklmnopqrst", "AIzaSyD-1111111111abcdefghijklmnopqrst"],
    ["--token AIzaSyD-2222222222abcdefghijklmnopqrst", "AIzaSyD-2222222222abcdefghijklmnopqrst"],
    ['{"api_key":"AIzaSyD-3333333333abcdefghijklmnopqrst"}', "AIzaSyD-3333333333abcdefghijklmnopqrst"],
    ['{"api_key": "AIzaSyD-4444444444abcdefghijklmnopqrst"}', "AIzaSyD-4444444444abcdefghijklmnopqrst"],
    ['"key": "AIzaSyD-5555555555abcdefghijklmnopqrst"', "AIzaSyD-5555555555abcdefghijklmnopqrst"],
    ["'api_key': 'AIzaSyD-6666666666abcdefghijklmnopqrst'", "AIzaSyD-6666666666abcdefghijklmnopqrst"],
    ['--token "AIzaSyD-7777777777abcdefghij klmnopqrst"', "AIzaSyD-7777777777abcdefghij klmnopqrst"],
  ];
  fs.writeFileSync(
    path.join(userDir, "logs", "install.log"),
    ["PASSO 1/8: Preparando os arquivos do programa", ...secrets.map(([line]) => `AVISO: ${line}`)].join("\n"),
  );

  const html = await statusPage.renderStatusPage({
    appDir,
    userDir,
    commandAvailable: () => false,
  });

  for (const [, value] of secrets) {
    assert.ok(!html.includes(value), "um valor sensível do round 2 chegou ao HTML final");
  }
  assert.ok((html.match(/\[oculto\]/g) || []).length >= secrets.length);
});

test("com endereço configurado mostra somente uma versão realmente maior", async () => {
  const distributionUrl = new URL("manifest", "http:" + "//127.0.0.1").href;
  const fetch = async () => ({
    ok: true,
    json: async () => ({ version: "0.1.0" }),
  });

  const latest = await statusPage.checkLatestVersion("0.1.0-alpha.1", distributionUrl, fetch);
  const same = await statusPage.checkLatestVersion("0.1.0", distributionUrl, fetch);

  assert.deepEqual(latest, { version: "0.1.0", url: distributionUrl });
  assert.equal(same, null);
});

test("falha na consulta de versão não quebra nem mostra aviso", async () => {
  const distributionUrl = new URL("manifest", "http:" + "//127.0.0.1").href;
  const latest = await statusPage.checkLatestVersion("0.1.0-alpha.1", distributionUrl, async () => {
    throw new Error("consulta indisponível");
  });

  assert.equal(latest, null);
});

test("mostra a coleta sem expor conteúdo da fila nem token do servidor", () => {
  const { appDir } = temporaryTree();
  const marcador = "PROMPT-DE-CLIENTE-NAO-EXIBIR";
  const tokenServidor = "token-local-nao-exibir";
  const fila = telemetria.FILA;
  fs.mkdirSync(path.dirname(fila), { recursive: true });
  fs.writeFileSync(fila, `${JSON.stringify({ prompt: marcador })}\n`);
  fs.writeFileSync(path.join(STATUS_USER_DIR, "token"), tokenServidor);
  telemetria.registrarAceite("1.7");

  const data = statusPage.collectStatus({
    appDir,
    userDir: STATUS_USER_DIR,
    commandAvailable: () => false,
    coletaUrl: "https://coleta.torremaster.com/v1/eventos",
    envio: {
      estado: () => ({
        ultimoEnvio: "2026-08-26T12:00:00.000Z",
        ultimoResultado: "ok",
        ultimaMensagem: "2 itens enviados",
        enviados: 2,
        descartados: 0,
        proximaTentativa: null,
      }),
    },
  });
  const html = statusPage.renderStatusHtml({ ...data, latest: null });

  assert.match(html, /<h2>Coleta de uso<\/h2>/);
  assert.match(html, /informe este identificador ao pedir exclusão/i);
  assert.match(html, /1 item aguardando envio/);
  assert.match(html, new RegExp(fila.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /contato@mediumlatens\.com/);
  assert.match(html, /coleta\.torremaster\.com/);
  assert.doesNotMatch(html, new RegExp(marcador));
  assert.doesNotMatch(html, new RegExp(tokenServidor));
  assert.equal(data.telemetria.aceite, true);
  assert.equal(data.telemetria.termos, "2.0");
  assert.equal(paths.USER_DIR, STATUS_USER_DIR);
  assert.notEqual(paths.USER_DIR, path.join(os.homedir(), ".medium-latens"));
  const statusSource = fs.readFileSync(path.join(__dirname, "..", "lib", "status.js"), "utf8");
  assert.doesNotMatch(statusSource, /localInstallationId|localQueueLength/);
});

test("redige o endereço de coleta e a última mensagem de envio", () => {
  const { appDir } = temporaryTree();
  const senha = ["segredo", "-do-endpoint"].join("");
  const token = ["github", "_pat_", "R7qLm2XvKp9wTz4NbHc1JdYg"].join("");
  const data = statusPage.collectStatus({
    appDir,
    userDir: STATUS_USER_DIR,
    commandAvailable: () => false,
    coletaUrl: `https://usuario:${senha}@coleta.exemplo.test/v1/eventos`,
    envio: {
      estado: () => ({
        ultimoEnvio: null,
        ultimoResultado: "falha",
        ultimaMensagem: `falhou com ${token}`,
      }),
    },
  });

  const html = statusPage.renderStatusHtml({ ...data, latest: null });

  assert.ok(!html.includes(senha));
  assert.ok(!html.includes(token));
  assert.match(html, /\[oculto\]/);
});

test("página de emergência é estática e mostra os caminhos dos dois sistemas", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "status", "index.html"), "utf8");

  assert.match(html, /O serviço não está respondendo/);
  assert.match(html, /~\/.medium-latens\/logs\//);
  assert.match(html, /%APPDATA%\\Medium Latens\\logs\\/);
  assert.match(html, /Como reinstalar/);
  assert.match(html, /Executar assim mesmo/);
  assert.match(html, /Abrir mesmo assim/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test("READMEs explicam a primeira abertura dos instaladores não assinados", () => {
  const en = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  const pt = fs.readFileSync(path.join(__dirname, "..", "README.pt-BR.md"), "utf8");

  assert.match(en, /Run anyway/);
  assert.match(en, /Open anyway/);
  assert.match(en, /not code-signed yet/);
  assert.match(pt, /Executar assim mesmo/);
  assert.match(pt, /Abrir mesmo assim/);
  assert.match(pt, /ainda não são assinados/);
});

test("a página diz em qual estado a coleta está", () => {
  const { appDir } = temporaryTree();
  const base = {
    appDir,
    userDir: STATUS_USER_DIR,
    commandAvailable: () => false,
    coletaUrl: "https://coleta.torremaster.com/v1/eventos",
    envio: {
      estado: () => ({
        ultimoEnvio: null, ultimoResultado: "nunca", ultimaMensagem: "Nenhuma tentativa de envio foi feita.",
        enviados: 0, descartados: 0, proximaTentativa: null,
      }),
    },
  };
  const casos = [
    ["obrigatoria-build-oficial", true, /Coleta: obrigatória \(build oficial\)\./],
    ["desligada-por-ambiente", false, /Coleta: desligada por MEDIUM_LATENS_COLETA \(build a partir do fonte\)\./],
    ["ativa-build-fonte", true, /Coleta: ativa \(build a partir do fonte\)\./],
  ];
  for (const [motivo, ativa, frase] of casos) {
    const data = statusPage.collectStatus({ ...base, coleta: { ativa, motivo } });
    assert.equal(data.telemetria.ativa, ativa);
    assert.equal(data.telemetria.motivo, motivo);
    assert.match(statusPage.renderStatusHtml({ ...data, latest: null }), frase);
  }
});

test("a página avisa quando o endereço de coleta é inválido", () => {
  const { appDir } = temporaryTree();
  const anterior = process.env.MEDIUM_LATENS_COLETA_URL;
  process.env.MEDIUM_LATENS_COLETA_URL = "http://exemplo.com/v1/eventos";
  try {
    const data = statusPage.collectStatus({
      appDir,
      userDir: STATUS_USER_DIR,
      commandAvailable: () => false,
    });
    const html = statusPage.renderStatusHtml({ ...data, latest: null });

    assert.equal(data.telemetria.url, null);
    assert.equal(data.telemetria.urlInvalida, true);
    assert.match(html, /Endereço de coleta inválido/);
    assert.doesNotMatch(html, /http:\/\/exemplo\.com/);
  } finally {
    if (anterior === undefined) delete process.env.MEDIUM_LATENS_COLETA_URL;
    else process.env.MEDIUM_LATENS_COLETA_URL = anterior;
  }
});

test("sem opção injetada, o estado da coleta vem das configurações", () => {
  const { appDir } = temporaryTree();
  const data = statusPage.collectStatus({ appDir, userDir: STATUS_USER_DIR, commandAvailable: () => false, coletaUrl: "" });
  assert.equal(typeof data.telemetria.ativa, "boolean");
  assert.match(data.telemetria.motivo, /^(obrigatoria-build-oficial|desligada-por-ambiente|ativa-build-fonte)$/);
});

test("a página mostra só o resumo por passo do install.log, nunca o log bruto", () => {
  const { appDir, userDir } = temporaryTree();
  const livre = "linha-livre-do-npm-que-nao-pode-aparecer";
  fs.writeFileSync(path.join(userDir, "logs", "install.log"), [
    "PASSO 1/8: Preparando os arquivos do programa",
    "PASSO 2/8: Verificando o Node.js",
    livre,
    "AVISO: Claude CLI não instalou",
    "PASSO 3/8: Instalando os componentes de IA",
    "FALHOU: O componente que fala com o Premiere não instalou",
    "",
  ].join("\n"));

  const data = statusPage.collectStatus({ appDir, userDir, commandAvailable: () => false });
  const html = statusPage.renderStatusHtml({ ...data, latest: null });

  assert.equal(data.installLog.found, true);
  assert.equal(data.installLog.resumo.total, 8);
  assert.deepEqual(data.installLog.resumo.passos.map((p) => p.estado), ["concluído", "concluído com aviso", "falhou"]);
  assert.deepEqual(data.installLog.resumo.passos[1].avisos, ["Claude CLI não instalou"]);
  assert.equal(data.installLog.resumo.passos[2].falha, "O componente que fala com o Premiere não instalou");
  assert.equal(data.installLog.message, "A instalação parou no passo 3 de 8.");
  assert.match(html, /1\/8<\/strong> Preparando os arquivos do programa: concluído/);
  assert.match(html, /Claude CLI não instalou/);
  assert.match(html, /A instalação parou no passo 3 de 8\./);
  assert.doesNotMatch(html, new RegExp(livre));
  assert.doesNotMatch(html, /<pre class="log/);
});

test("redige e limita títulos, passos e avisos do install.log", () => {
  const { appDir, userDir } = temporaryTree();
  const segredo = ["s", "k", "-proj-", "R7qLm2XvKp9wTz4NbHc1JdYg"].join("");
  const linhas = [
    `PASSO 1/120: OPENAI_API_KEY=${segredo}${"x".repeat(240)}`,
    ...Array.from({ length: 30 }, (_, indice) => `AVISO: aviso ${indice}`),
    ...Array.from({ length: 119 }, (_, indice) => `PASSO ${indice + 2}/120: Passo ${indice + 2}`),
    "PRONTO",
  ];
  fs.writeFileSync(path.join(userDir, "logs", "install.log"), linhas.join("\n"));

  const data = statusPage.collectStatus({ appDir, userDir, commandAvailable: () => false });
  const html = statusPage.renderStatusHtml({ ...data, latest: null });

  assert.ok(!html.includes(segredo));
  assert.ok(data.installLog.resumo.passos[0].titulo.length <= 200);
  assert.equal(data.installLog.resumo.passos[0].avisos.length, 20);
  assert.equal(data.installLog.resumo.passos.length, 100);
});

test("o resumo considera só a última execução do instalador", () => {
  const { appDir, userDir } = temporaryTree();
  const passos = (n) => Array.from({ length: n }, (_, i) => `PASSO ${i + 1}/8: Passo ${i + 1}`);
  fs.writeFileSync(path.join(userDir, "logs", "install.log"), [
    ...passos(3), "FALHOU: primeira tentativa",
    ...passos(8), "PRONTO", "",
  ].join("\n"));

  const data = statusPage.collectStatus({ appDir, userDir, commandAvailable: () => false });

  assert.equal(data.installLog.resumo.pronto, true);
  assert.equal(data.installLog.resumo.passos.length, 8);
  assert.ok(data.installLog.resumo.passos.every((p) => p.estado === "concluído"));
  assert.equal(data.installLog.message, "Instalação concluída.");
});

test("log sem passo nenhum é dito como tal e um passo sem fim fica em andamento", () => {
  const { appDir, userDir } = temporaryTree();
  fs.writeFileSync(path.join(userDir, "logs", "install.log"), "só ruído\n");
  let data = statusPage.collectStatus({ appDir, userDir, commandAvailable: () => false });
  assert.equal(data.installLog.message, "O install.log existe, mas não registra nenhum passo.");
  assert.equal(data.installLog.resumo.passos.length, 0);

  fs.writeFileSync(path.join(userDir, "logs", "install.log"), "PASSO 1/8: Preparando\nPASSO 2/8: Verificando o Node.js\n");
  data = statusPage.collectStatus({ appDir, userDir, commandAvailable: () => false });
  assert.deepEqual(data.installLog.resumo.passos.map((p) => p.estado), ["concluído", "em andamento"]);
  assert.equal(data.installLog.message, "A instalação parou no passo 2 de 8 sem registrar conclusão.");
});
