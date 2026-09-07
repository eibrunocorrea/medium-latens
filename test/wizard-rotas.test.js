"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const httpReal = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-wizard-rotas-"));
const PROFILES_FILE = path.join(TMP, "profiles.json");
const CONFIG_FILE = path.join(TMP, "config.json");
const CREDENTIALS_FILE = path.join(TMP, "credentials.json");
const MCP_FILE = path.join(TMP, "mcp-config.json");
const TOKEN = "token-do-teste-de-rotas-com-tamanho-suficiente";
const ORIGINAL_HOME = process.env.HOME;
const BITS_POSIX = process.platform !== "win32"; // NTFS não expõe bits de modo; a proteção vem da ACL do perfil do usuário

process.env.HOME = TMP;
process.env.MEDIUM_LATENS_USER_DIR = TMP;
process.env.MEDIUM_LATENS_PROFILES_FILE = PROFILES_FILE;
process.env.MEDIUM_LATENS_CONFIG_FILE = CONFIG_FILE;
process.env.MEDIUM_LATENS_MCP_CONFIG = MCP_FILE;
fs.writeFileSync(MCP_FILE, JSON.stringify({
  mcpServers: { "premiere-pro": { command: "npx", args: ["premiere-pro-mcp"], env: {} } },
}));

const win = require("../lib/win");
const originalSpawnCli = win.spawnCli;
const spawnCalls = [];
let spawnExitCode = 0;
win.spawnCli = (cmd, args, opts) => {
  const chamada = { cmd, args, opts, entrada: "" };
  spawnCalls.push(chamada);
  const child = new EventEmitter();
  child.pid = 54321;
  child.unref = () => { child.solto = true; };
  child.stdin = {
    write(valor) { chamada.entrada += String(valor); },
    end(valor) {
      if (valor !== undefined) chamada.entrada += String(valor);
      queueMicrotask(() => {
        child.emit("exit", spawnExitCode);
        child.emit("close", spawnExitCode);
      });
    },
  };
  return child;
};

const auth = require("../lib/auth");
const wizard = require("../lib/wizard");
const credentials = require("../lib/credentials");
const profiles = require("../lib/profiles");
const settings = require("../lib/settings");
const statusPage = require("../lib/status");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const eventos = [];

test.after(() => {
  win.spawnCli = originalSpawnCli;
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
});

function carregarHandler() {
  const inicioHandler = serverSource.indexOf("const server = http.createServer");
  const inicioSemChave = serverSource.indexOf("function semChave(");
  const inicio = inicioSemChave >= 0 && inicioSemChave < inicioHandler ? inicioSemChave : inicioHandler;
  const fim = serverSource.indexOf('\n\nserver.on("error"', inicioHandler);
  assert.ok(inicioHandler >= 0 && fim > inicioHandler, "handler HTTP do servidor não encontrado");

  let handler;
  const sandbox = {
    http: { createServer(fn) { handler = fn; return {}; } },
    auth,
    telemetria: { evento(tipo, dados) { eventos.push({ tipo, dados }); } },
    wizard,
    credentials,
    profiles,
    settings,
    TOKEN,
    URL,
    process,
    fs,
    path,
    NAME: "Medium Latens",
    statusPage,
    sse: {},
    lastInit: null,
    lastQuota: null,
    busy: false,
    busySince: 0,
    child: null,
    session: null,
  };
  vm.runInNewContext(serverSource.slice(inicio, fim), sandbox);
  return handler;
}

function requisicao(handler, metodo, caminho, body) {
  return new Promise((resolve, reject) => {
    const req = {
      method: metodo,
      url: caminho,
      headers: { host: "127.0.0.1:8765", "x-medium-latens-token": TOKEN },
      socket: { localPort: 8765 },
      on(evento, callback) {
        if (evento === "data" && body !== undefined) callback(JSON.stringify(body));
        if (evento === "end") queueMicrotask(callback);
        return this;
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(nome, valor) { this.headers[nome.toLowerCase()] = valor; },
      end(conteudo) { resolve({ status: this.statusCode, body: String(conteudo || ""), headers: this.headers }); },
    };
    try { handler(req, res); } catch (error) { reject(error); }
  });
}

function json(resposta) { return JSON.parse(resposta.body); }

function semSegredo(resposta, segredo) {
  assert.doesNotMatch(resposta.body, /"key"\s*:/i);
  if (segredo) assert.ok(!resposta.body.includes(segredo), "a resposta não pode conter a chave");
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("GET /wizard lista trilhos, perfis resumidos e contas mascaradas", async () => {
  settings.save({ profile: "padrao" });
  const segredo = "segredo-apenas-no-arquivo";
  credentials.save({ id: "conta-listada", provider: "openai", model: "gpt-teste", key: segredo });
  const handler = carregarHandler();

  const resposta = await requisicao(handler, "GET", "/wizard");
  const corpo = json(resposta);

  assert.equal(resposta.status, 200);
  assert.equal(corpo.ok, true);
  assert.equal(corpo.trilhos.length, 3);
  assert.equal(corpo.ativo, "padrao");
  assert.deepEqual(Object.keys(corpo.perfis[0]).sort(), ["authMode", "credencialId", "label", "name", "provider"]);
  assert.equal(corpo.contas[0].masked.endsWith("uivo"), true);
  semSegredo(resposta, segredo);
  credentials.remove("conta-listada");
});

test("POST /wizard/validar traduz a rejeição sem código cru nem chave", async () => {
  const segredo = "chave-invalida-da-rota";
  const provedor = httpReal.createServer((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end('{"error":"invalid_api_key"}');
  });
  const port = await listen(provedor);
  assert.notEqual(port, 8765);

  try {
    const resposta = await requisicao(carregarHandler(), "POST", "/wizard/validar", {
      provider: "compativel", endpoint: `http://127.0.0.1:${port}/v1`, key: segredo,
    });
    const corpo = json(resposta);
    assert.equal(resposta.status, 400);
    assert.equal(corpo.ok, false);
    assert.match(corpo.motivo, /chave/i);
    assert.doesNotMatch(corpo.motivo, /401|invalid_api_key/);
    semSegredo(resposta, segredo);
  } finally {
    await close(provedor);
  }
});

test("POST /wizard/salvar persiste 0600, cria e ativa o perfil, e envFor injeta a chave", async () => {
  const segredo = "chave-valida-da-rota";
  const provedor = httpReal.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${segredo}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"data":[{"id":"modelo-da-rota"}]}');
  });
  const port = await listen(provedor);
  assert.notEqual(port, 8765);

  try {
    const endpointNormalizado = `http://127.0.0.1:${port}/v1`;
    const resposta = await requisicao(carregarHandler(), "POST", "/wizard/salvar", {
      id: "Conta Rota", provider: "compativel", endpoint: `http://127.0.0.1:${port}/api/../v1/`,
      model: "modelo-da-rota", key: segredo,
    });
    const corpo = json(resposta);
    assert.equal(resposta.status, 200);
    assert.equal(corpo.ok, true);
    assert.equal(corpo.conta.masked.endsWith("rota"), true);
    assert.equal(corpo.conta.id, "conta-rota");
    assert.equal(corpo.perfil.credencialId, "conta-rota");
    assert.equal(settings.load().profile, "conta-rota");
    assert.equal(profiles.get("conta-rota").credencialId, "conta-rota");
    assert.equal(credentials.get("conta-rota").endpoint, endpointNormalizado);
    assert.equal(profiles.get("conta-rota").endpoint, endpointNormalizado);
    assert.equal(profiles.envFor("conta-rota").OPENROUTER_API_KEY, segredo);
    if (BITS_POSIX) {
      assert.equal(fs.statSync(CREDENTIALS_FILE).mode & 0o777, 0o600);
    }
    semSegredo(resposta, segredo);

    const estado = await requisicao(carregarHandler(), "GET", "/wizard/estado?id=conta-rota");
    assert.equal(json(estado).auth.loggedIn, true);
    semSegredo(estado, segredo);

    const originalCliStatus = profiles.cliStatus;
    const originalAuthStatus = profiles.authStatus;
    profiles.cliStatus = async () => ({ claude: {}, codex: {}, gemini: {} });
    profiles.authStatus = async (name) => ({ loggedIn: name === "conta-rota" });
    try {
      const provedores = json(await requisicao(carregarHandler(), "GET", "/providers"));
      const perfilPainel = provedores.providers.codex.profiles.find((perfil) => perfil.name === "conta-rota");
      assert.equal(perfilPainel.keyMissing, null);
    } finally {
      profiles.cliStatus = originalCliStatus;
      profiles.authStatus = originalAuthStatus;
    }
  } finally {
    await close(provedor);
  }
});

test("POST /wizard/salvar registra chave OpenAI pelo stdin sem expor em argv", async () => {
  const segredo = "sk-chave-openai-apenas-stdin-123456";
  const originalValidar = wizard.validar;
  wizard.validar = async () => ({ ok: true, modelos: ["gpt-teste"] });
  spawnCalls.length = 0;
  spawnExitCode = 0;
  settings.save({ profile: "padrao" });

  try {
    const resposta = await requisicao(carregarHandler(), "POST", "/wizard/salvar", {
      id: "OpenAI pelo painel", provider: "openai", model: "gpt-teste", key: segredo,
    });
    const corpo = json(resposta);

    assert.equal(resposta.status, 200);
    assert.equal(corpo.ok, true);
    assert.equal(settings.load().profile, "openai-pelo-painel");
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].cmd, "codex");
    assert.deepEqual(spawnCalls[0].args, ["login", "--with-api-key"]);
    assert.equal(spawnCalls[0].entrada, segredo);
    assert.equal(spawnCalls[0].opts.stdio[0], "pipe");
    assert.ok(!spawnCalls[0].args.some((arg) => String(arg).includes(segredo)));
    semSegredo(resposta, segredo);
  } finally {
    wizard.validar = originalValidar;
    credentials.remove("openai-pelo-painel");
    profiles.remove("openai-pelo-painel");
    settings.save({ profile: "padrao" });
  }
});

test("POST /wizard/salvar desfaz credencial e perfil quando o login OpenAI falha", async () => {
  const segredo = "sk-chave-openai-falha-123456789";
  const originalValidar = wizard.validar;
  wizard.validar = async () => ({ ok: true, modelos: ["gpt-teste"] });
  spawnCalls.length = 0;
  spawnExitCode = 1;
  settings.save({ profile: "padrao" });

  try {
    const resposta = await requisicao(carregarHandler(), "POST", "/wizard/salvar", {
      id: "OpenAI com falha", provider: "openai", model: "gpt-teste", key: segredo,
    });
    const corpo = json(resposta);

    assert.equal(resposta.status, 400);
    assert.equal(corpo.motivo, "Não consegui registrar a chave no assistente do ChatGPT. Confira a chave e tente de novo.");
    assert.equal(credentials.get("openai-com-falha"), null);
    assert.equal(profiles.load()["openai-com-falha"], undefined);
    assert.equal(settings.load().profile, "padrao");
    assert.ok(!spawnCalls[0].args.some((arg) => String(arg).includes(segredo)));
    semSegredo(resposta, segredo);
  } finally {
    spawnExitCode = 0;
    wizard.validar = originalValidar;
  }
});

test("POST /wizard/salvar não abre processo para chave Anthropic", async () => {
  const originalValidar = wizard.validar;
  wizard.validar = async () => ({ ok: true, modelos: ["claude-teste"] });
  spawnCalls.length = 0;

  try {
    const resposta = await requisicao(carregarHandler(), "POST", "/wizard/salvar", {
      id: "Anthropic pelo painel", provider: "anthropic", model: "claude-teste", key: "chave-anthropic-teste",
    });

    assert.equal(resposta.status, 200);
    assert.equal(spawnCalls.length, 0);
  } finally {
    wizard.validar = originalValidar;
    credentials.remove("anthropic-pelo-painel");
    profiles.remove("anthropic-pelo-painel");
    settings.save({ profile: "padrao" });
  }
});

test("POST /wizard/salvar rejeita nome ausente, não textual ou sem slug", async () => {
  const originalValidar = wizard.validar;
  wizard.validar = async () => ({ ok: true, modelos: ["modelo-teste"] });

  try {
    for (const id of [undefined, {}, "   ", "!!!"]) {
      const resposta = await requisicao(carregarHandler(), "POST", "/wizard/salvar", {
        id, provider: "anthropic", model: "modelo-teste", key: "chave-nome-invalido",
      });
      assert.equal(resposta.status, 400);
      assert.equal(json(resposta).motivo, "Dê um nome para a conta.");
    }
  } finally {
    wizard.validar = originalValidar;
  }
});

test("POST /wizard/remover apaga conta e perfil e volta o ativo para padrao", async () => {
  const resposta = await requisicao(carregarHandler(), "POST", "/wizard/remover", { id: "conta-rota" });
  assert.equal(resposta.status, 200);
  assert.equal(settings.load().profile, "padrao");
  assert.equal(profiles.load()["conta-rota"], undefined);
  assert.equal(credentials.get("conta-rota"), null);
  semSegredo(resposta);
});

test("POST /wizard/assinatura abre o CLI isolado sem ativar antes da conexão", async () => {
  spawnCalls.length = 0;
  settings.save({ profile: "padrao" });
  const resposta = await requisicao(carregarHandler(), "POST", "/wizard/assinatura", {
    id: "claude-assinatura", provider: "claude",
  });
  const corpo = json(resposta);

  assert.equal(resposta.status, 200);
  assert.equal(corpo.pid, 54321);
  assert.equal(corpo.perfil.name, "claude-assinatura");
  assert.equal(settings.load().profile, "padrao");
  assert.equal(spawnCalls.length, 1);
  assert.deepEqual(spawnCalls[0].args, ["auth", "login"]);
  assert.equal(spawnCalls[0].opts.detached, true);
  semSegredo(resposta);
});

test("POST /wizard/assinatura normaliza nome humano com o slug compartilhado", async () => {
  spawnCalls.length = 0;
  settings.save({ profile: "padrao" });
  try {
    const resposta = await requisicao(carregarHandler(), "POST", "/wizard/assinatura", {
      id: "Conta Rota", provider: "claude",
    });
    const corpo = json(resposta);

    assert.equal(resposta.status, 200);
    assert.equal(corpo.perfil.name, "conta-rota");
    assert.equal(profiles.load()["conta-rota"].provider, "claude");
  } finally {
    profiles.remove("conta-rota");
  }
});

test("POST /wizard/ativar exige conexão e só então ativa a assinatura", async () => {
  const originalAuthStatus = profiles.authStatus;
  settings.save({ profile: "padrao" });

  try {
    profiles.authStatus = async () => ({ loggedIn: false, detail: "sem login" });
    const desconectada = await requisicao(carregarHandler(), "POST", "/wizard/ativar", {
      id: "claude-assinatura",
    });
    assert.equal(desconectada.status, 400);
    assert.equal(settings.load().profile, "padrao");

    profiles.authStatus = async () => ({ loggedIn: true, detail: "conectada" });
    const conectada = await requisicao(carregarHandler(), "POST", "/wizard/ativar", {
      id: "claude-assinatura",
    });
    assert.equal(conectada.status, 200);
    assert.equal(settings.load().profile, "claude-assinatura");
    semSegredo(conectada);
  } finally {
    profiles.authStatus = originalAuthStatus;
    profiles.remove("claude-assinatura");
    settings.save({ profile: "padrao" });
  }
});

test("GET /wizard/estado devolve apenas estado seguro com detalhe redigido", async () => {
  const originalAuthStatus = profiles.authStatus;
  const segredo = "sk-ant-segredo-estado-123456789";
  profiles.authStatus = async () => ({
    loggedIn: true,
    email: "conta@exemplo.com",
    apiKey: segredo,
    detail: `token ${segredo} ok ${"x".repeat(200)}`,
  });

  try {
    const resposta = await requisicao(carregarHandler(), "GET", "/wizard/estado?id=conta-segura");
    const authSeguro = json(resposta).auth;

    assert.equal(resposta.status, 200);
    assert.deepEqual(Object.keys(authSeguro).sort(), ["detail", "email", "loggedIn"]);
    assert.equal(authSeguro.loggedIn, true);
    assert.equal(authSeguro.email, "conta@exemplo.com");
    assert.ok(authSeguro.detail.length <= 160);
    assert.match(authSeguro.detail, /\[oculto\]/);
    semSegredo(resposta, segredo);
  } finally {
    profiles.authStatus = originalAuthStatus;
  }
});

test("GET /wizard responde 500 em português quando credenciais estão corrompidas", async () => {
  fs.writeFileSync(CREDENTIALS_FILE, "{");
  try {
    const resposta = await requisicao(carregarHandler(), "GET", "/wizard");
    assert.equal(resposta.status, 500);
    assert.match(json(resposta).motivo, /Não foi possível/);
  } finally {
    fs.writeFileSync(CREDENTIALS_FILE, "{}");
  }

  const viva = await requisicao(carregarHandler(), "GET", "/wizard");
  assert.equal(viva.status, 200);
});

test("GET /wizard/estado responde 500 em português quando credenciais estão corrompidas", async () => {
  profiles.addProfile({
    name: "estado-corrompido", provider: "claude", authMode: "api-key", credencialId: "inexistente",
  });
  fs.writeFileSync(CREDENTIALS_FILE, "{");
  try {
    const resposta = await requisicao(carregarHandler(), "GET", "/wizard/estado?id=estado-corrompido");
    assert.equal(resposta.status, 500);
    assert.match(json(resposta).motivo, /Não foi possível/);
  } finally {
    fs.writeFileSync(CREDENTIALS_FILE, "{}");
    profiles.remove("estado-corrompido");
  }
});

test("POST /wizard/remover rejeita id ausente ou não textual", async () => {
  for (const id of [undefined, null, {}, 123]) {
    const resposta = await requisicao(carregarHandler(), "POST", "/wizard/remover", { id });
    assert.equal(resposta.status, 400);
    assert.match(json(resposta).motivo, /conta/i);
  }
});

test("semChave bloqueia em profundidade uma resposta contaminada", async () => {
  const original = wizard.catalogo;
  wizard.catalogo = () => [{ id: "contaminado", key: "nao-pode-sair" }];
  try {
    const resposta = await requisicao(carregarHandler(), "GET", "/wizard");
    assert.equal(resposta.status, 500);
    semSegredo(resposta, "nao-pode-sair");
  } finally {
    wizard.catalogo = original;
  }
});

test("telemetria das rotas nunca recebe o corpo com a chave", () => {
  const serializado = JSON.stringify(eventos);
  assert.ok(eventos.some((evento) => evento.tipo === "rota" && evento.dados.caminho === "/wizard/salvar"));
  assert.doesNotMatch(serializado, /chave-(?:valida|invalida)-da-rota/);
  assert.doesNotMatch(serializado, /"key"\s*:/i);
});
