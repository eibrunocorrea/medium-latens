"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("node:vm");

// A chave falsa é montada em tempo de execução para não acionar o verificador de segredos.
const CHAVE_FALSA = "sk-" + "ant-api03-CHAVE-DE-TESTE-1234567890";
const TOKEN = "token-de-integracao-com-tamanho-suficiente";

process.env.MEDIUM_LATENS_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-int-"));
process.env.ANTHROPIC_API_KEY = CHAVE_FALSA;

const tel = require("../lib/telemetria");
const provider = require("../lib/provider");
tel.registrarAceite("1.0");

const serverFile = path.join(__dirname, "..", "server.js");
const serverSource = fs.readFileSync(serverFile, "utf8");

test("o trabalho é registrado, mas a chave colada no prompt não", () => {
  tel.evento("turno_inicio", {
    prompt: "corta os silêncios, e minha chave é " + CHAVE_FALSA,
    provider: "claude",
  });
  const ultimo = tel.fila().pop();
  assert.ok(ultimo.dados.prompt.includes("corta os silêncios"), "o trabalho tem que ser registrado");
  assert.ok(!ultimo.dados.prompt.includes("CHAVE-DE-TESTE"), "a credencial não pode ser registrada");
});

test("nenhum item da fila contém dado binário", () => {
  tel.evento("frame", { imagem: Buffer.from([0, 1, 2, 3]) });
  assert.equal(tel.fila().pop().dados.imagem, "[binario removido]");
});

function carregarHandler(sobrescritas = {}) {
  const inicio = serverSource.indexOf("const server = http.createServer");
  const fim = serverSource.indexOf('\n\nserver.on("error"', inicio);
  assert.ok(inicio >= 0 && fim > inicio, "handler HTTP do servidor não encontrado");

  let handler;
  const sandbox = {
    http: { createServer(fn) { handler = fn; return {}; } },
    auth: require("../lib/auth"),
    telemetria: tel,
    statusPage: {
      renderStatusPage: async () => "<html>Status do Medium Latens</html>",
      renderErrorPage: () => "<html>erro</html>",
    },
    TOKEN,
    settings: {
      load: () => ({ profile: "default", provider: "falso", model: "" }),
      save: (patch) => patch,
    },
    profiles: {
      get: () => ({ name: "default", label: "Default", provider: "falso", authMode: "assinatura" }),
      cliStatus: async () => ({}),
      envFor: () => ({}),
    },
    sse: {
      count: () => 0,
      handle: (_req, res) => res.end("stream"),
    },
    NAME: "Medium Latens",
    URL,
    process,
    lastInit: null,
    lastQuota: null,
    busy: false,
    busySince: 0,
    child: null,
    session: null,
    emit: () => {},
    lembrarSlug: (slug) => slug,
    agentCwd: () => process.cwd(),
    iniciarAtividadeResumo: () => {},
    concluirAtividadeResumo: () => {},
    workspaceDir: (slug) => path.join(process.cwd(), "workspaces", slug),
    fs,
    path,
    Date,
  };
  Object.assign(sandbox, sobrescritas);
  vm.runInNewContext(serverSource.slice(inicio, fim), sandbox);
  return { handler, sandbox };
}

function requisicao(handler, metodo, caminho, headers, body) {
  return new Promise((resolve, reject) => {
    const req = {
      method: metodo,
      url: caminho,
      headers: { host: "127.0.0.1:8765", ...(headers || {}) },
      socket: { localPort: 8765 },
      on(evento, callback) {
        if (evento === "data" && body) callback(body);
        if (evento === "end") queueMicrotask(callback);
        return this;
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(nome, valor) { this.headers[nome.toLowerCase()] = valor; },
      end(conteudo) {
        resolve({ status: this.statusCode, body: conteudo || "", headers: this.headers });
      },
    };
    try { handler(req, res); } catch (erro) { reject(erro); }
  });
}

test("handler registra somente rotas autenticadas e permitidas sem vazar token ou query", async () => {
  const { handler } = carregarHandler();
  const headers = { "x-medium-latens-token": TOKEN };
  const antes = tel.fila().length;

  const settings = await requisicao(
    handler, "POST", `/settings?token=${encodeURIComponent(TOKEN)}`, headers, JSON.stringify({ model: "teste" }),
  );
  const health = await requisicao(handler, "GET", "/health");
  const status = await requisicao(handler, "GET", `/status?token=${encodeURIComponent(TOKEN)}`, headers);
  const stream = await requisicao(handler, "GET", "/stream", headers);
  const antesSemToken = tel.fila().length;
  const semToken = await requisicao(handler, "GET", "/settings");

  assert.equal(settings.status, 200);
  assert.equal(health.status, 200);
  assert.equal(status.status, 200);
  assert.equal(stream.status, 200);
  assert.equal(semToken.status, 401);
  assert.equal(tel.fila().length, antesSemToken, "requisição sem token não pode gerar evento");

  const novos = tel.fila().slice(antes);
  assert.equal(novos.length, 1, "somente a rota autenticada e não excluída deve gerar evento");
  const rotas = novos.filter((item) => item.tipo === "rota");
  assert.deepEqual(rotas.map((item) => item.dados), [{ caminho: "/settings", metodo: "POST" }]);

  const cru = fs.readFileSync(tel.FILA, "utf8");
  assert.ok(!cru.includes(TOKEN), "o token não pode aparecer no arquivo da fila");
  assert.ok(!cru.includes("?token="), "a query não pode aparecer no arquivo da fila");
});

test("autozoom registra a falha real do apply", async () => {
  const { handler } = carregarHandler({
    autozoom: { apply: async () => { throw new Error("falha no apply"); } },
  });
  const antes = tel.fila().length;
  const resposta = await requisicao(
    handler, "POST", "/autozoom/apply", { "x-medium-latens-token": TOKEN }, JSON.stringify({}),
  );

  assert.equal(resposta.status, 500);
  const eventos = tel.fila().slice(antes).filter((item) => item.tipo === "autozoom_apply");
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].dados.ok, false);
  assert.match(eventos[0].dados.erro, /falha no apply/);
});

test("autozoom registra o resultado real do apply", async () => {
  const { handler } = carregarHandler({
    autozoom: { apply: async () => ({ applied: 2, skipped: 1, errors: 0, report: [] }) },
  });
  const antes = tel.fila().length;
  const resposta = await requisicao(
    handler, "POST", "/autozoom/apply", { "x-medium-latens-token": TOKEN }, JSON.stringify({}),
  );

  assert.equal(resposta.status, 200);
  const eventos = tel.fila().slice(antes).filter((item) => item.tipo === "autozoom_apply");
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].dados.ok, true);
  assert.equal(eventos[0].dados.aplicados, 2);
});

function briefingFalso(generate) {
  return {
    activeProjectInfo: async () => ({ path: "/tmp/projeto.prproj", fps: 30 }),
    projectSlug: () => "projeto",
    parseCsv: () => [{ tcStart: "00:00:00:00", tcEnd: "00:00:01:00", text: "fala" }],
    generate,
    saveBrief: () => {},
  };
}

test("brief generate registra o resultado real", async () => {
  const resultado = {
    brief: { tema_identificado: "tema", musica_global: "musica" },
    trechos: [{ id: 1 }, { id: 2 }],
    unmatched: [],
    semResposta: [],
  };
  const { handler } = carregarHandler({ briefing: briefingFalso(async () => resultado) });
  const antes = tel.fila().length;
  const resposta = await requisicao(
    handler, "POST", "/brief/generate", { "x-medium-latens-token": TOKEN },
    JSON.stringify({ source: "csv", csv: "conteúdo" }),
  );

  assert.equal(resposta.status, 200);
  const eventos = tel.fila().slice(antes).filter((item) => item.tipo === "brief_generate");
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].dados.ok, true);
  assert.equal(eventos[0].dados.trechos, 2);
});

test("brief generate registra a falha real", async () => {
  const { handler } = carregarHandler({
    briefing: briefingFalso(async () => { throw new Error("falha ao gerar brief"); }),
  });
  const antes = tel.fila().length;
  const resposta = await requisicao(
    handler, "POST", "/brief/generate", { "x-medium-latens-token": TOKEN },
    JSON.stringify({ source: "csv", csv: "conteúdo" }),
  );

  assert.equal(resposta.status, 500);
  const eventos = tel.fila().slice(antes).filter((item) => item.tipo === "brief_generate");
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].dados.ok, false);
  assert.match(eventos[0].dados.erro, /falha ao gerar brief/);
});

function carregarStartTurn(sobrescritas = {}) {
  const inicio = serverSource.indexOf("function startTurn(");
  const fim = serverSource.indexOf("// ---------- resumo da sessão ----------", inicio);
  assert.ok(inicio >= 0 && fim > inicio, "startTurn do servidor não encontrado");

  const sandbox = {
    settings: { load: () => ({ profile: "teste", provider: "falso", model: "modelo-falso", effort: "medio" }) },
    profiles: {
      get: () => ({ provider: "falso", model: "modelo-falso" }),
      envFor: () => ({}),
    },
    emit: () => {},
    SYSTEM: "sistema",
    ALLOWED: "ferramentas",
    MCP_CONFIG: "mcp-config.json",
    FULL_CAPS: "todas",
    agentCwd: () => process.cwd(),
    busy: false,
    busySince: 0,
    child: null,
    session: null,
    lastInit: null,
    lastQuota: null,
    Date,
    provider,
    telemetria: tel,
    iniciarAtividadeResumo: () => {},
    concluirAtividadeResumo: () => {},
  };
  Object.assign(sandbox, sobrescritas);
  vm.runInNewContext(`${serverSource.slice(inicio, fim)}\nthis.startTurn = startTurn;`, sandbox);
  return sandbox;
}

test("startTurn registra o ciclo real do provider na ordem e sem credencial", async () => {
  let concluir;
  const concluido = new Promise((resolve) => { concluir = resolve; });
  provider.register({
    name: "falso",
    run(_opts, onEvent) {
      queueMicrotask(() => {
        onEvent({ kind: "init", session: "sessao-falsa", model: "modelo-falso" });
        onEvent({ kind: "tool_start", id: "f1", name: "cortar" });
        onEvent({ kind: "tool_input", id: "f1", name: "cortar", input: "entrada " + CHAVE_FALSA });
        onEvent({ kind: "tool_end", id: "f1", ok: true, summary: "corte aplicado" });
        onEvent({
          kind: "done", ok: true, reply: "resposta " + CHAVE_FALSA,
          session: "sessao-falsa", cost: 0.42, turns: 3, durationMs: 1250,
        });
        concluir();
      });
      return { kill() {} };
    },
  });

  const sandbox = carregarStartTurn();
  const antes = tel.fila().length;
  sandbox.startTurn("corta os silêncios, minha chave é " + CHAVE_FALSA, null, false);
  assert.equal(sandbox.busy, true);
  assert.ok(sandbox.child);
  await concluido;

  const eventos = tel.fila().slice(antes);
  assert.deepEqual(eventos.map((item) => item.tipo), [
    "turno_inicio", "ferramenta", "ferramenta_fim", "turno_fim",
  ]);
  assert.equal(eventos[0].dados.provider, "falso");
  assert.equal(eventos[0].dados.modelo, "modelo-falso");
  assert.ok(eventos[0].dados.prompt.includes("corta os silêncios"));
  assert.deepEqual(eventos[1].dados, { id: "f1", nome: "cortar", entrada: "entrada [removido]" });
  assert.deepEqual(eventos[2].dados, { id: "f1", ok: true, resumo: "corte aplicado" });
  assert.deepEqual(eventos[3].dados, {
    ok: true, erro: null, cancelado: false, custo: 0.42,
    turnos: 3, duracaoMs: 1250, resposta: "resposta [removido]",
  });
  assert.equal(sandbox.busy, false);
  assert.equal(sandbox.child, null);

  const cru = fs.readFileSync(tel.FILA, "utf8");
  assert.ok(!cru.includes(CHAVE_FALSA), "a chave falsa não pode aparecer no arquivo da fila");
});

test("startTurn registra MISSING_KEY sem iniciar o turno", () => {
  const sandbox = carregarStartTurn({
    profiles: {
      get: () => ({ provider: "falso", model: "modelo-falso" }),
      envFor: () => { throw new Error("MISSING_KEY: chave ausente"); },
    },
  });
  const antes = tel.fila().length;

  assert.doesNotThrow(() => sandbox.startTurn("mensagem", null, false));
  assert.equal(sandbox.busy, false);

  const eventos = tel.fila().slice(antes);
  assert.deepEqual(eventos.map((item) => item.tipo), ["turno_fim"]);
  assert.equal(eventos[0].dados.ok, false);
  assert.match(eventos[0].dados.erro, /MISSING_KEY/);
  assert.equal(eventos.some((item) => item.tipo === "turno_inicio"), false);
});
