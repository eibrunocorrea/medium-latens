"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const net = require("node:net");
const http = require("node:http");
const vm = require("node:vm");
process.env.MEDIUM_LATENS_USER_DIR = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "mlat-auth-"));
const { APP_DIR } = require("../lib/paths");
const version = fs.readFileSync(path.join(APP_DIR, "VERSION"), "utf8").trim();

const serverFile = path.join(__dirname, "..", "server.js");
const serverSource = fs.readFileSync(serverFile, "utf8");
const corsSources = [
  ["server.js", serverSource],
  ["lib/sse.js", fs.readFileSync(path.join(__dirname, "..", "lib", "sse.js"), "utf8")],
];

function loadHandler(token, overrides = {}) {
  const start = serverSource.indexOf("const server = http.createServer");
  const end = serverSource.indexOf('\n\nserver.on("error"', start);
  assert.ok(start >= 0 && end > start, "handler HTTP do servidor não encontrado");

  let handler;
  const sandbox = {
    http: { createServer(fn) { handler = fn; return {}; } },
    auth: require("../lib/auth"),
    telemetria: require("../lib/telemetria"),
    statusPage: require("../lib/status"),
    APP_DIR,
    path,
    TOKEN: token,
    settings: overrides.settings || {
      load: () => ({ profile: "default", provider: "claude", model: "" }),
      save: (patch) => patch,
    },
    profiles: {
      get: () => ({ name: "default", label: "Default", provider: "claude", authMode: "assinatura" }),
      cliStatus: async () => ({}),
      ...(overrides.profiles || {}),
    },
    sse: {
      count: () => 0,
      handle(req, res) { res.end("stream conectado"); },
    },
    NAME: "Medium Latens",
    URL,
    process,
    lastInit: null,
    lastQuota: null,
    busy: false,
    session: null,
  };
  vm.runInNewContext(serverSource.slice(start, end), sandbox);
  return handler;
}

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function rawRequest(port, target, host = `127.0.0.1:${port}`, headers = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      const hostHeader = host == null ? "" : `Host: ${host}\r\n`;
      const extraHeaders = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join("");
      const protocol = host == null ? "HTTP/1.0" : "HTTP/1.1";
      socket.end(`GET ${target} ${protocol}\r\n${hostHeader}${extraHeaders}Connection: close\r\n\r\n`);
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("handler recusa targets malformados e continua atendendo", async () => {
  const server = await listen(loadHandler("token-do-teste"));
  const port = server.address().port;
  try {
    for (const target of ["//", "///"]) {
      const response = await rawRequest(port, target);
      assert.match(response, /^HTTP\/1\.1 400 /);
      assert.match(response, /\{"error":"requisição inválida"\}/);
    }
    const health = await rawRequest(port, "/health");
    assert.match(health, /^HTTP\/1\.1 200 /);
    assert.equal(JSON.parse(health.split("\r\n\r\n")[1]).version, version);
  } finally {
    await close(server);
  }
});

test("handler converte exceção síncrona em 500 e continua atendendo", async () => {
  let falhar = true;
  const settings = {
    load() {
      if (falhar) {
        falhar = false;
        throw new Error("falha síncrona de teste");
      }
      return { profile: "default", provider: "claude", model: "" };
    },
    save: (patch) => patch,
  };
  const server = await listen(loadHandler("token-do-teste", { settings }));
  const port = server.address().port;
  try {
    const failure = await rawRequest(port, "/health");
    assert.match(failure, /^HTTP\/1\.1 500 /);
    assert.match(failure, /\{"error":"erro interno"\}/);
    const health = await rawRequest(port, "/health");
    assert.match(health, /^HTTP\/1\.1 200 /);
  } finally {
    await close(server);
  }
});

test("guard 500 não anexa JSON quando a resposta já começou", () => {
  const handler = loadHandler("token-do-teste", {
    settings: {
      load() { throw new Error("falha depois do início da resposta"); },
      save: (patch) => patch,
    },
  });
  let finalizadoCom = "não-finalizado";
  const response = {
    statusCode: 200,
    headersSent: true,
    writableEnded: false,
    setHeader() {},
    end(body) {
      this.writableEnded = true;
      finalizadoCom = body;
    },
  };

  handler({
    method: "GET",
    url: "/health",
    headers: { host: "127.0.0.1:43210" },
    socket: { localPort: 43210 },
  }, response);

  assert.equal(response.writableEnded, true);
  assert.equal(finalizadoCom, undefined);
});

test("health responde 200 quando CLIs não estão instalados", async () => {
  const clis = {
    claude: { installed: false },
    codex: { installed: false },
    gemini: { installed: false },
  };
  const server = await listen(loadHandler("token-do-teste", {
    profiles: { cliStatus: async () => clis },
  }));
  const port = server.address().port;
  try {
    const response = await rawRequest(port, "/health");
    assert.match(response, /^HTTP\/1\.1 200 /);
    assert.deepEqual(JSON.parse(response.split("\r\n\r\n")[1]), {
      ok: true,
      name: "Medium Latens",
      version,
      mode: "cli",
      provider: "claude",
      authMode: "assinatura",
      model: "padrão",
      profile: { name: "default", label: "Default" },
      auth: null,
      quota: null,
      clis,
      busy: false,
      session: null,
      sse: 0,
      uptime: JSON.parse(response.split("\r\n\r\n")[1]).uptime,
    });
  } finally {
    await close(server);
  }
});

test("health converte rejeição de cliStatus em erro interno", async () => {
  const server = await listen(loadHandler("token-do-teste", {
    profiles: { cliStatus: async () => { throw new Error("falha de probe"); } },
  }));
  const port = server.address().port;
  try {
    const response = await rawRequest(port, "/health");
    assert.match(response, /^HTTP\/1\.1 500 /);
    assert.match(response, /\{"error":"erro interno"\}/);
  } finally {
    await close(server);
  }
});

test("handler valida Host em toda rota na porta efêmera", async () => {
  const server = await listen(loadHandler("token-do-teste"));
  const port = server.address().port;
  try {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
      const response = await rawRequest(port, "/health", host);
      assert.match(response, /^HTTP\/1\.1 200 /);
    }
    for (const host of [`evil.example:${port}`, "127.0.0.1:1", null]) {
      const response = await rawRequest(port, "/health", host);
      assert.match(response, /^HTTP\/1\.1 421 /);
      assert.match(response, /\{"error":"host inválido"\}/);
    }
  } finally {
    await close(server);
  }
});

test("handler aceita somente Origin igual ao Host validado", async () => {
  const token = "token-do-teste";
  const server = await listen(loadHandler(token));
  const port = server.address().port;
  const host = `127.0.0.1:${port}`;
  const tokenHeader = { "x-medium-latens-token": token };
  try {
    const sameOrigin = await rawRequest(port, "/settings", host, {
      ...tokenHeader,
      Origin: `http://${host}`,
    });
    assert.match(sameOrigin, /^HTTP\/1\.1 200 /);

    for (const origin of ["http://127.0.0.1:1", "http://evil.example"]) {
      const response = await rawRequest(port, "/settings", host, { ...tokenHeader, Origin: origin });
      assert.match(response, /^HTTP\/1\.1 403 /);
      assert.match(response, /\{"error":"origem não permitida"\}/);
    }
  } finally {
    await close(server);
  }
});

test("status troca a query por cookie e nunca renderiza autenticado pela query", async () => {
  const token = "token-do-teste";
  const server = await listen(loadHandler(token));
  const port = server.address().port;
  try {
    const redirect = await rawRequest(port, `/status?t=${encodeURIComponent(token)}`);
    assert.match(redirect, /^HTTP\/1\.1 303 /);
    assert.match(redirect, /\r\nLocation: \/status\r\n/i);
    assert.match(
      redirect,
      new RegExp(`\\r\\nSet-Cookie: ml_status=${token}; HttpOnly; SameSite=Lax; Path=\\/status\\r\\n`, "i"),
    );

    const withCookie = await rawRequest(port, "/status", undefined, { Cookie: `ml_status=${token}` });
    assert.match(withCookie, /^HTTP\/1\.1 200 /);
    assert.match(withCookie, /Status do Medium Latens/);

    const withoutCookie = await rawRequest(port, "/status");
    assert.match(withoutCookie, /^HTTP\/1\.1 401 /);
  } finally {
    await close(server);
  }
});

function request(handler, pathname, headers) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(body) { resolve({ status: this.statusCode, body: body || "", headers: this.headers }); },
    };
    try {
      handler({
        method: "GET",
        url: pathname,
        headers: { host: "127.0.0.1:8765", ...(headers || {}) },
        socket: { localPort: 8765 },
      }, response);
    } catch (error) {
      reject(error);
    }
  });
}

test("handler autentica todas as rotas antes de responder e mantém somente health aberta", async () => {
  const token = "token-correto-para-o-teste";
  const handler = loadHandler(token);

  const semToken = await request(handler, "/settings");
  const health = await request(handler, "/health");
  const comToken = await request(handler, "/settings", { "x-medium-latens-token": token });
  const statusSemToken = await request(handler, "/status");
  const statusComToken = await request(handler, "/status", { cookie: `ml_status=${token}` });
  const streamSemToken = await request(handler, "/stream");
  const streamComToken = await request(handler, `/stream?t=${encodeURIComponent(token)}`);
  const chatComTokenNaQuery = await request(handler, `/chat?t=${encodeURIComponent(token)}`);
  const origemExterna = await request(handler, "/settings", {
    origin: "https://exemplo.com",
    "x-medium-latens-token": token,
  });

  console.log([
    `${semToken.status} sem token`,
    `${health.status} health aberto`,
    `${comToken.status} com token`,
    `${statusSemToken.status} status sem token`,
    `${statusComToken.status} status com token no cookie e sem eco`,
    `${streamSemToken.status} stream sem token`,
    `${streamComToken.status} stream com token na query`,
    `${chatComTokenNaQuery.status} chat com token na query recusado`,
    `${origemExterna.status} origem externa`,
  ].join("\n"));

  assert.equal(semToken.status, 401);
  assert.deepEqual(JSON.parse(semToken.body), { error: "token ausente ou inválido" });
  assert.equal(health.status, 200);
  assert.equal(comToken.status, 200);
  assert.equal(statusSemToken.status, 401);
  assert.equal(statusComToken.status, 200);
  assert.match(statusComToken.body, /Status do Medium Latens/);
  assert.doesNotMatch(statusComToken.body, new RegExp(token));
  assert.equal(streamSemToken.status, 401);
  assert.equal(streamComToken.status, 200);
  assert.equal(streamComToken.body, "stream conectado");
  assert.equal(chatComTokenNaQuery.status, 401);
  assert.equal(origemExterna.status, 403);
  assert.deepEqual(JSON.parse(origemExterna.body), { error: "origem não permitida" });
  for (const [arquivo, source] of corsSources) {
    const cabecalhos = [...source.matchAll(/Access-Control-[A-Za-z0-9-]+/g)].map((match) => match[0]);
    assert.deepEqual(cabecalhos, [], `${arquivo}: cabeçalho CORS remanescente: ${cabecalhos.join(", ")}`);
  }

  const criaUrl = serverSource.indexOf("url = new URL", startOfHandler());
  const bootstrap = serverSource.indexOf('if (url.pathname === "/status"', criaUrl);
  const checaBootstrap = serverSource.indexOf("const bootstrapPasse = auth.check", bootstrap);
  const checa = serverSource.indexOf("auth.check(req, url, TOKEN)", criaUrl);
  const options = serverSource.indexOf('req.method === "OPTIONS"', criaUrl);
  assert.ok(criaUrl >= 0 && bootstrap > criaUrl, "bootstrap deve vir depois da URL validada");
  assert.ok(checaBootstrap > bootstrap && checaBootstrap < checa, "bootstrap deve se autenticar antes da checagem geral");
  assert.ok(checa > bootstrap, "checagem geral deve acontecer depois do bootstrap de status");
  assert.ok(checa < options, "OPTIONS também precisa passar pela autenticação");
});

function startOfHandler() {
  return serverSource.indexOf("const server = http.createServer");
}
