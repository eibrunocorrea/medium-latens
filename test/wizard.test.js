"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const WIZARD_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-wizard-"));
process.env.MEDIUM_LATENS_USER_DIR = WIZARD_USER_DIR;
const wizard = require("../lib/wizard");

test.after(() => fs.rmSync(WIZARD_USER_DIR, { recursive: true, force: true }));

function listen(server) {
  return new Promise((resolve, reject) => {
    const tentar = () => {
      const port = 20_000 + Math.floor(Math.random() * 20_000);
      const onError = (error) => {
        server.off("listening", onListening);
        if (error && error.code === "EADDRINUSE") tentar();
        else reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    };
    tentar();
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("catálogo oferece os três trilhos", () => {
  const ids = wizard.catalogo().map((c) => c.id);
  assert.deepEqual(ids, ["claude-assinatura", "chatgpt-assinatura", "chave-propria"]);
});

test("monta a URL de modelos por provedor", () => {
  assert.equal(wizard.urlDeModelos("anthropic"), "https://api.anthropic.com/v1/models");
  assert.equal(wizard.urlDeModelos("openai"), "https://api.openai.com/v1/models");
  assert.equal(wizard.urlDeModelos("compativel", "https://openrouter.ai/api/v1"), "https://openrouter.ai/api/v1/models");
});

test("recusa endpoint inseguro antes de montar a URL de modelos", () => {
  const invalidos = [
    "http://exemplo.com/v1",
    "https://a.com/#@b.com",
    "https://user:pw@a.com",
    "https://a.com/caminho com espaço",
  ];

  for (const endpoint of invalidos) {
    assert.throws(() => wizard.urlDeModelos("compativel", endpoint), /endereço|HTTPS/i);
  }
});

test("normaliza o endpoint usado para consultar modelos", () => {
  const endpoint = "https://EXEMPLO.com:443/api/../v1/";
  assert.equal(wizard.normalizarEndpoint(endpoint), "https://exemplo.com/v1");
  assert.equal(wizard.urlDeModelos("compativel", endpoint), "https://exemplo.com/v1/models");
});

test("validar recusa endpoint inseguro sem enviar a chave", async () => {
  const fetchOriginal = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = async () => { chamadas += 1; throw new Error("não deveria chamar"); };
  try {
    for (const endpoint of ["http://exemplo.com", "https://user:pw@a.com", "https://a.com/#@b.com"]) {
      const resultado = await wizard.validar({ provider: "compativel", endpoint, key: "chave-teste" });
      assert.equal(resultado.ok, false);
      assert.match(resultado.motivo, /HTTPS/);
    }
    assert.equal(chamadas, 0);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("cabeçalhos corretos por provedor", () => {
  const a = wizard.cabecalhos("anthropic", "sk-x");
  assert.equal(a["x-api-key"], "sk-x");
  assert.ok(a["anthropic-version"]);
  assert.equal(wizard.cabecalhos("openai", "sk-y").Authorization, "Bearer sk-y");
});

test("traduz erro do provedor para português, sem código cru", () => {
  assert.match(wizard.traduzErro(401, ""), /chave/i);
  assert.match(wizard.traduzErro(403, ""), /permiss/i);
  assert.match(wizard.traduzErro(429, ""), /limite|crédito/i);
  assert.match(wizard.traduzErro(404, ""), /não encontr|não existe/i);
  assert.match(wizard.traduzErro(500, ""), /fora do ar|provedor/i);
  assert.ok(!/\b(401|403|429|500)\b/.test(wizard.traduzErro(401, "")), "não pode vazar código cru");
});

test("traduz erro de modelo indisponível", () => {
  assert.match(wizard.traduzErro(400, "model not found"), /modelo/i);
});

test("validar recusa chave vazia sem chamar a rede", async () => {
  const r = await wizard.validar({ provider: "openai", key: "" });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /chave/i);
});

test("validar chave e modelo antes de permitir persistência", async () => {
  const invalidKey = "chave-invalida-nao-vazar";
  const validKey = "chave-valida-nao-vazar";
  const server = http.createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${validKey}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"error":"invalid_api_key"}');
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"data":[{"id":"gpt-modelo-existente"}]}');
  });
  const port = await listen(server);
  assert.notEqual(port, 8765, "o teste nunca pode tocar a porta 8765");
  const endpoint = `http://127.0.0.1:${port}/api/../v1/`;
  const endpointNormalizado = `http://127.0.0.1:${port}/v1`;
  const credentialsFile = path.join(WIZARD_USER_DIR, "credentials.json");

  try {
    const invalid = await wizard.validar({ provider: "compativel", endpoint, key: invalidKey });
    assert.equal(invalid.ok, false);
    assert.match(invalid.motivo, /chave/i);
    assert.doesNotMatch(invalid.motivo, /401|invalid_api_key/);
    assert.ok(!invalid.motivo.includes(invalidKey));
    assert.equal(fs.existsSync(credentialsFile), false);

    const missingModel = await wizard.validar({
      provider: "compativel",
      endpoint,
      key: validKey,
      model: "gpt-modelo-ausente",
    });
    assert.equal(missingModel.ok, false);
    assert.match(missingModel.motivo, /modelo/i);
    assert.ok(!missingModel.motivo.includes(validKey));
    assert.equal(fs.existsSync(credentialsFile), false);

    const valid = await wizard.validar({ provider: "compativel", endpoint, key: validKey });
    assert.deepEqual(valid, {
      ok: true,
      modelos: ["gpt-modelo-existente"],
      endpoint: endpointNormalizado,
    });
  } finally {
    await close(server);
  }
});
