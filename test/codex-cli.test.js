"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("node:events");
require("../lib/codex-cli");
const provider = require("../lib/provider");

// FIXTURE: JSONL real capturado no probe T1 V3,
// probe de tool call (thread_id, item.started/completed de command_execution, turn.completed com usage) —
// os DOIS agent_message do probe real (narração ANTES do tool call + resposta final DEPOIS) foram
// mantidos — são a evidência de que um turno pode ter múltiplas mensagens completas, não deltas — só
// os campos de texto foram encurtados ("Vou executar exatamente esse comando." → "Vou executar o
// comando."; "A saída foi:\n\n```text\ntool-probe-ok\n```" → "pong"), permitido pelo brief ("pode
// encurtar campos de texto longos"). Nenhum tipo/forma de evento foi inventado, todos vêm literalmente
// do doc, na mesma ordem capturada.
const FIXTURE = [
  '{"type":"thread.started","thread_id":"01a01649-c649-7592-8282-fcbe1c56514d"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Vou executar o comando."}}',
  '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \'echo tool-probe-ok\'","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc \'echo tool-probe-ok\'","aggregated_output":"tool-probe-ok\\n","exit_code":0,"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"pong"}}',
  '{"type":"turn.completed","usage":{"input_tokens":25078,"cached_input_tokens":12484,"cache_write_input_tokens":12588,"output_tokens":93,"reasoning_output_tokens":0}}',
].join("\n");

function makeFakeCodex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-codex-"));
  if (process.platform === "win32") {
    const script = path.join(dir, "codex-fixture.js");
    fs.writeFileSync(script, `process.stdout.write(${JSON.stringify(`${FIXTURE}\n`)});\n`);
    fs.writeFileSync(path.join(dir, "codex.cmd"), '@"%~dp0\\codex-fixture.js" %*\r\n');
  } else {
    const bin = path.join(dir, "codex");
    fs.writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${FIXTURE}\nEOF\n`);
    fs.chmodSync(bin, 0o755);
  }
  return dir;
}

test("codex-cli normaliza o stream para o contrato de eventos", (t, done) => {
  const dir = makeFakeCodex();
  const events = [];
  provider.get("codex").run({
    message: "responda apenas: pong",
    systemPrompt: "SYS",
    cwd: dir,
    env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH },
  }, (ev) => {
    events.push(ev);
    if (ev.kind === "done") {
      // V3 (2º probe): dois agent_message completos no mesmo turno (narração + resposta final)
      // devem virar duas mensagens separadas por "\n\n", nunca grudadas.
      assert.equal(ev.ok, true);
      assert.equal(ev.reply, "Vou executar o comando.\n\npong");
      assert.equal(ev.session, "01a01649-c649-7592-8282-fcbe1c56514d");
      const kinds = events.map((e) => e.kind);
      assert.ok(kinds.includes("init"), "init presente");
      assert.ok(kinds.includes("tool_start"), "tool_start presente");
      assert.ok(kinds.includes("tool_end"), "tool_end presente");
      assert.ok(kinds.indexOf("init") < kinds.indexOf("done"));
      const textDeltas = events.filter((e) => e.kind === "text").map((e) => e.delta);
      assert.equal(textDeltas.length, 2, "duas mensagens de texto distintas, não uma só");
      assert.equal(textDeltas.join(""), ev.reply, "deltas concatenados == reply acumulado");
      done();
    }
  });
});

test("codex-cli reporta erro de spawn como done{error}", (t, done) => {
  provider.get("codex").run({
    message: "x", cwd: os.tmpdir(),
    env: { ...process.env, PATH: "/nonexistent" },
  }, (ev) => {
    if (ev.kind === "done") {
      assert.equal(ev.ok, false);
      assert.match(ev.error, /spawn codex/);
      done();
    }
  });
});

test("codex-cli usa sandbox read-only no resumo", () => {
  const win = require("../lib/win");
  const original = win.spawnCli;
  let chamada;
  win.spawnCli = (cmd, args, opts) => {
    chamada = { cmd, args, opts };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    return child;
  };
  const caminho = require.resolve("../lib/codex-cli");
  delete require.cache[caminho];
  const adaptador = require("../lib/codex-cli");
  win.spawnCli = original;

  adaptador.run({
    message: "resuma", cwd: process.cwd(), env: { PATH: process.env.PATH }, somenteLeitura: true,
  }, () => {});

  assert.equal(chamada.cmd, "codex");
  assert.equal(chamada.args[chamada.args.indexOf("-s") + 1], "read-only");
  assert.equal(chamada.args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
});
