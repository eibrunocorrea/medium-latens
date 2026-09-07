"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { garantir } = require("../lib/mcp-config");

const BITS_POSIX = process.platform !== "win32";
const CAPACIDADES = "inspect,edit,export,filesystem,unsafe-script";

function preparar(t) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-mcp-config-"));
  t.after(() => fs.rmSync(userDir, { recursive: true, force: true }));
  return {
    userDir,
    mcpConfigPath: path.join(userDir, "mcp-config.json"),
    nodeBin: process.execPath,
    capacidades: CAPACIDADES,
    fsImpl: fs,
  };
}

function instalar(opcoes, layout = "macos") {
  const partes = layout === "macos" ? ["npm", "lib"] : ["npm"];
  const entrada = path.join(opcoes.userDir, ...partes, "node_modules", "premiere-pro-mcp", "dist", "index.js");
  fs.mkdirSync(path.dirname(entrada), { recursive: true });
  fs.writeFileSync(entrada, '"use strict";\n');
  return entrada;
}

function conferirCriacao(opcoes, entrada, estado) {
  assert.deepEqual(estado, { ok: true, criado: true, caminho: opcoes.mcpConfigPath, entrada });
  const esperado = {
    mcpServers: {
      "premiere-pro": {
        command: opcoes.nodeBin,
        args: [entrada],
        env: {
          PREMIERE_TIMEOUT_MS: String(opcoes.timeoutMs ?? 60000),
          PREMIERE_MCP_CAPABILITIES: opcoes.capacidades,
        },
      },
    },
  };
  const conteudo = fs.readFileSync(opcoes.mcpConfigPath, "utf8");
  assert.deepEqual(JSON.parse(conteudo), esperado);
  assert.equal(conteudo, JSON.stringify(esperado, null, 2) + "\n");
  assert.deepEqual(fs.readdirSync(opcoes.userDir).sort(), ["mcp-config.json", "npm"]);
  if (BITS_POSIX) assert.equal(fs.statSync(opcoes.mcpConfigPath).mode & 0o777, 0o600);
}

test("cria configuração com o executável Node e a entrada do layout macOS", (t) => {
  const opcoes = preparar(t);
  const entrada = instalar(opcoes);
  conferirCriacao(opcoes, entrada, garantir(opcoes));
});

test("cria configuração para o layout Windows sem depender de um bin no PATH", (t) => {
  const opcoes = preparar(t);
  const entrada = instalar(opcoes, "windows");
  conferirCriacao(opcoes, entrada, garantir(opcoes));
});

test("prefere o layout macOS quando as duas entradas existem", (t) => {
  const opcoes = preparar(t);
  instalar(opcoes, "windows");
  const entrada = instalar(opcoes);
  conferirCriacao(opcoes, entrada, garantir(opcoes));
});

test("usa o timeout e as capacidades fornecidos", (t) => {
  const opcoes = { ...preparar(t), timeoutMs: 45000, capacidades: "inspect" };
  const entrada = instalar(opcoes);
  conferirCriacao(opcoes, entrada, garantir(opcoes));
});

for (const command of [process.execPath, "node-manual"]) {
  test(`preserva byte a byte a configuração válida com comando ${command === process.execPath ? "Node" : "manual"}`, (t) => {
    const opcoes = preparar(t);
    const entrada = instalar(opcoes);
    const original = JSON.stringify({
      mcpServers: {
        "premiere-pro": { command, args: [entrada], env: { PREMIERE_TIMEOUT_MS: "120000" } },
        outro: { command: "outro-mcp" },
      },
    }, null, 4) + "\n\n";
    fs.writeFileSync(opcoes.mcpConfigPath, original);
    assert.deepEqual(garantir(opcoes), { ok: true, criado: false, caminho: opcoes.mcpConfigPath });
    assert.equal(fs.readFileSync(opcoes.mcpConfigPath, "utf8"), original);
  });
}

for (const servidor of [{ command: "mcp-manual" }, { command: "npx", args: ["premiere-pro-mcp"] }]) {
  test(`preserva configuração manual ${servidor.args ? "sem argumento index.js" : "sem args"}`, (t) => {
    const opcoes = preparar(t);
    instalar(opcoes);
    const original = JSON.stringify({ mcpServers: { "premiere-pro": servidor } });
    fs.writeFileSync(opcoes.mcpConfigPath, original);
    assert.equal(garantir(opcoes).criado, false);
    assert.equal(fs.readFileSync(opcoes.mcpConfigPath, "utf8"), original);
  });
}

test("reescreve quando a entrada antiga deixou de existir após reinstalação", (t) => {
  const opcoes = preparar(t);
  const entrada = instalar(opcoes);
  fs.writeFileSync(opcoes.mcpConfigPath, JSON.stringify({
    mcpServers: { "premiere-pro": {
      command: "node-antigo",
      args: ["--no-warnings", path.join(opcoes.userDir, "instalacao-antiga", "index.js")],
    } },
  }));
  conferirCriacao(opcoes, entrada, garantir(opcoes));
});

test("valida apenas o primeiro argumento que termina em index.js", (t) => {
  const opcoes = preparar(t);
  const entrada = instalar(opcoes);
  const original = JSON.stringify({ mcpServers: { "premiere-pro": {
    command: "node-manual",
    args: ["--no-warnings", entrada, path.join(opcoes.userDir, "outro", "index.js")],
  } } });
  fs.writeFileSync(opcoes.mcpConfigPath, original);
  assert.equal(garantir(opcoes).criado, false);
  assert.equal(fs.readFileSync(opcoes.mcpConfigPath, "utf8"), original);
});

for (const [caso, conteudo] of [
  ["JSON inválido", "{invalido"],
  ["JSON nulo", "null"],
  ["mcpServers ausente", "{}"],
  ["servidor premiere-pro ausente", '{"mcpServers":{"outro":{"command":"outro-mcp"}}}'],
  ["command ausente", '{"mcpServers":{"premiere-pro":{}}}'],
  ["command não textual", '{"mcpServers":{"premiere-pro":{"command":42}}}'],
]) {
  test(`reescreve configuração com ${caso}`, (t) => {
    const opcoes = preparar(t);
    const entrada = instalar(opcoes);
    fs.writeFileSync(opcoes.mcpConfigPath, conteudo);
    conferirCriacao(opcoes, entrada, garantir(opcoes));
  });
}

test("não cria arquivo nem diretório quando o pacote não está instalado", (t) => {
  const opcoes = preparar(t);
  assert.deepEqual(garantir(opcoes), {
    ok: false,
    motivo: `premiere-pro-mcp não instalado em ${path.join(opcoes.userDir, "npm")}`,
  });
  assert.deepEqual(fs.readdirSync(opcoes.userDir), []);
});

test("não altera configuração existente quando nenhuma entrada candidata existe", (t) => {
  const opcoes = preparar(t);
  const original = '{"mcpServers":{"premiere-pro":{"command":"mcp-manual"}}}\n';
  fs.writeFileSync(opcoes.mcpConfigPath, original);
  assert.equal(garantir(opcoes).ok, false);
  assert.equal(fs.readFileSync(opcoes.mcpConfigPath, "utf8"), original);
  assert.deepEqual(fs.readdirSync(opcoes.userDir), ["mcp-config.json"]);
});

test("uma segunda inicialização mantém o arquivo criado na primeira", (t) => {
  const opcoes = preparar(t);
  instalar(opcoes);
  assert.equal(garantir(opcoes).criado, true);
  const original = fs.readFileSync(opcoes.mcpConfigPath, "utf8");
  assert.deepEqual(garantir(opcoes), { ok: true, criado: false, caminho: opcoes.mcpConfigPath });
  assert.equal(fs.readFileSync(opcoes.mcpConfigPath, "utf8"), original);
});

test("falha de escrita retorna aviso sem lançar nem deixar temporário", (t) => {
  const opcoes = preparar(t);
  instalar(opcoes);
  fs.mkdirSync(opcoes.mcpConfigPath);
  const estado = garantir(opcoes);
  assert.equal(estado.ok, false);
  assert.match(estado.motivo, /não foi possível gravar mcp-config\.json/);
  assert.equal(fs.statSync(opcoes.mcpConfigPath).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(opcoes.userDir).sort(), ["mcp-config.json", "npm"]);
});
