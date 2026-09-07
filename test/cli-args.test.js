"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");

function filhoFalso() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}

function carregarComSpawn(modulo, spawnImpl) {
  const win = require("../lib/win");
  const original = win.spawnCli;
  let chamada;
  win.spawnCli = (cmd, args, opts) => {
    chamada = { cmd, args, opts };
    return spawnImpl ? spawnImpl(cmd, args, opts) : filhoFalso();
  };
  const caminho = require.resolve(modulo);
  delete require.cache[caminho];
  const adaptador = require(modulo);
  win.spawnCli = original;
  return { adaptador, chamada: () => chamada };
}

test("claude limita saída e desliga ferramentas no resumo", () => {
  const h = carregarComSpawn("../lib/claude-cli");
  const env = { PATH: process.env.PATH, MARCADOR: "preservado" };
  h.adaptador.run({
    message: "resuma", cwd: process.cwd(), env,
    allowedTools: "Read,Edit", mcpConfig: "mcp.json",
    somenteLeitura: true, maxTokens: 1200, maxBudgetUsd: 0.05,
  }, () => {});
  const chamada = h.chamada();
  assert.equal(chamada.cmd, "claude");
  assert.ok(chamada.args.includes("--tools"));
  assert.equal(chamada.args[chamada.args.indexOf("--tools") + 1], "");
  assert.equal(chamada.args.includes("--allowedTools"), false);
  assert.equal(chamada.args.includes("--mcp-config"), false);
  assert.equal(chamada.args[chamada.args.indexOf("--max-budget-usd") + 1], "0.05");
  assert.equal(chamada.opts.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "1200");
  assert.equal(chamada.opts.env.MARCADOR, "preservado");
  assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, undefined, "ambiente original não pode ser mutado");
});

test("adaptadores devolvem a mensagem amigável quando o launcher lança", async () => {
  const mensagem = "Não encontrei o comando cli. Execute o instalador de novo.";
  for (const modulo of ["../lib/claude-cli", "../lib/codex-cli", "../lib/gemini-cli"]) {
    const eventos = [];
    const h = carregarComSpawn(modulo, () => { throw new Error(mensagem); });
    assert.doesNotThrow(() => h.adaptador.run({ message: "teste", cwd: process.cwd() }, (ev) => eventos.push(ev)));
    await new Promise((resolve) => setImmediate(resolve));
    const erro = modulo === "../lib/codex-cli" ? `spawn codex: ${mensagem}` : mensagem;
    assert.deepEqual(eventos, [{ kind: "done", ok: false, error: erro }]);
  }
});

test("gemini usa modo plan no resumo", () => {
  const h = carregarComSpawn("../lib/gemini-cli");
  h.adaptador.run({
    message: "resuma", cwd: process.cwd(), env: { PATH: process.env.PATH }, somenteLeitura: true,
  }, () => {});
  const args = h.chamada().args;
  assert.equal(args[args.indexOf("--approval-mode") + 1], "plan");
  assert.equal(args.includes("yolo"), false);
});

test("adaptadores de provider usam allowlist mesmo sem env explícito", () => {
  const original = process.env.MINHA_VARIAVEL_SECRETA;
  process.env.MINHA_VARIAVEL_SECRETA = "x";
  try {
    for (const modulo of ["../lib/claude-cli", "../lib/codex-cli", "../lib/gemini-cli"]) {
      const h = carregarComSpawn(modulo);
      h.adaptador.run({ message: "teste", cwd: process.cwd() }, () => {});
      assert.equal(typeof h.chamada().opts.env, "object");
      assert.equal(h.chamada().opts.env.MINHA_VARIAVEL_SECRETA, undefined);
      assert.equal(h.chamada().opts.env.PATH, process.env.PATH);
    }
  } finally {
    if (original === undefined) delete process.env.MINHA_VARIAVEL_SECRETA;
    else process.env.MINHA_VARIAVEL_SECRETA = original;
  }
});

test("adaptador de provider não recebe chave exclusiva do gerador de imagem", () => {
  const original = process.env.BFL_API_KEY;
  process.env.BFL_API_KEY = "bfl-chave-de-teste";
  try {
    const h = carregarComSpawn("../lib/claude-cli");
    h.adaptador.run({ message: "teste", cwd: process.cwd() }, () => {});
    assert.equal(h.chamada().opts.env.BFL_API_KEY, undefined);
  } finally {
    if (original === undefined) delete process.env.BFL_API_KEY;
    else process.env.BFL_API_KEY = original;
  }
});
