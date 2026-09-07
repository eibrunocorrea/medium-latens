"use strict";
/**
 * lib/premiere.js — cliente MCP mínimo do SERVIDOR para o premiere-pro-mcp.
 * Arquitetura A do spec v2: botões determinísticos e agente usam os MESMOS tools.
 * Transporte: stdio, JSON-RPC 2.0 delimitado por \n (MCP stdio transport).
 * Command/args/env vêm do mcp-config.json — a MESMA fonte usada pelos providers.
 * Uma chamada por vez (fila): o bridge CEP do Premiere não é reentrante.
 * Filho é lazy (nasce na 1ª chamada) e renasce sozinho se o processo cair.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const { FILES } = require("./paths");
const { allowlistedEnv } = require("./profiles");

const MCP_CONFIG = process.env.MEDIUM_LATENS_MCP_CONFIG || FILES.mcpConfig;

let child = null, buf = "", nextId = 1, initialized = false;
const pending = new Map(); // id -> {resolve, reject, timer}
let queue = Promise.resolve();

function rejectAllPending(message) {
  for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(message)); }
  pending.clear();
}

function start() {
  if (child) return;
  const cfg = JSON.parse(fs.readFileSync(MCP_CONFIG, "utf8")).mcpServers["premiere-pro"];
  const c = spawn(cfg.command, cfg.args, {
    env: allowlistedEnv(process.env, cfg.env || {}),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child = c;
  c.stdout.on("data", (chunk) => {
    if (child !== c) return; // instância antiga: um respawn (ou close()) já assumiu
    buf += chunk; let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  c.on("exit", () => {
    if (child !== c) return; // instância antiga: um respawn (ou close()) já assumiu
    child = null; initialized = false; buf = "";
    rejectAllPending("premiere-pro-mcp saiu — verifique o MCP Bridge no Premiere");
  });
}

function onLine(line) {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id != null && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id); clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message || "erro MCP"));
    else p.resolve(msg.result);
  }
}

function rpc(method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method} (${timeoutMs}ms) — Premiere aberto e MCP Bridge iniciado?`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

async function ensureInit() {
  start();
  if (initialized) return;
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "medium-latens", version: "2.0" } }, 15000);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  initialized = true;
}

/** Chama um tool do premiere-pro-mcp; resolve com o texto concatenado do content. */
function call(tool, args, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 60000;
  const run = async () => {
    await ensureInit();
    const r = await rpc("tools/call", { name: tool, arguments: args || {} }, timeoutMs);
    const text = ((r && r.content) || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    if (r && r.isError) throw new Error(text || `tool ${tool} falhou`);
    return text;
  };
  const p = queue.then(run, run);
  queue = p.then(() => {}, () => {});
  return p;
}

/** ExtendScript bruto (capability unsafe-script já vem do mcp-config.json). */
function extendscript(code, opts) { return call("execute_extendscript", { code }, opts); }

function close() {
  if (!child) return;
  const c = child;
  child = null; initialized = false; buf = ""; // marca a instância como obsoleta antes do exit assíncrono
  rejectAllPending("premiere-pro-mcp encerrado via close()");
  try { c.kill(); } catch {}
}

module.exports = { call, extendscript, close };
