"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// mcp-config de teste apontando para um servidor MCP falso em node
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-mcp-"));
const FAKE = path.join(TMP, "fake-mcp.js");
fs.writeFileSync(FAKE, `
let buf = "";
let busy = false;
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.method === "initialize") reply(m.id, { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake" } });
    else if (m.method === "tools/call") {
      if (m.params.name === "slow") continue; // nunca responde — simula timeout do bridge
      if (busy) { replyError(m.id, "overlap detected"); continue; }
      busy = true;
      setTimeout(() => {
        busy = false;
        if (m.params.name === "boom") reply(m.id, { content: [{ type: "text", text: "explodiu" }], isError: true });
        else reply(m.id, { content: [{ type: "text", text: "ok:" + m.params.name + ":" + JSON.stringify(m.params.arguments) }] });
      }, 10);
    }
  }
});
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n"); }
function replyError(id, message) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\\n"); }
`);
const CFG = path.join(TMP, "mcp-config.json");
fs.writeFileSync(CFG, JSON.stringify({ mcpServers: { "premiere-pro": { command: process.execPath, args: [FAKE], env: {} } } }));
process.env.MEDIUM_LATENS_MCP_CONFIG = CFG;
const premiere = require("../lib/premiere");

test("call: handshake + tools/call devolve o texto do content", async () => {
  const r = await premiere.call("add_marker", { time: 1 });
  assert.match(r, /^ok:add_marker:/);
});

test("call: isError rejeita com o texto", async () => {
  await assert.rejects(() => premiere.call("boom", {}), /explodiu/);
});

test("call: fila serializa (10 chamadas concorrentes, todas respondem)", async () => {
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => premiere.call("t", { i })));
  rs.forEach((r, i) => assert.match(r, new RegExp(`"i":${i}`)));
});

test("call: timeout rejeita e a fila continua livre pra próxima chamada", async () => {
  await assert.rejects(() => premiere.call("slow", {}, { timeoutMs: 100 }), /timeout/);
  const r = await premiere.call("add_marker", { time: 2 });
  assert.match(r, /^ok:add_marker:/);
});

test("call: close() seguido de nova chamada respawna um filho novo com sucesso", async () => {
  const r1 = await premiere.call("add_marker", { time: 3 });
  assert.match(r1, /^ok:add_marker:/);
  premiere.close();
  const r2 = await premiere.call("add_marker", { time: 4 });
  assert.match(r2, /^ok:add_marker:/);
});

test.after(() => premiere.close());
