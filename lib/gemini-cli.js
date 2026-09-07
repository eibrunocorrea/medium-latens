"use strict";
/**
 * lib/gemini-cli.js — provider "gemini" (F7): Gemini CLI 0.26+ headless.
 * Formato stream-json OBSERVADO em 2026-07-25 (gemini 0.26.0), re-verificado
 * 2026-08-18 contra gemini 0.55.1 (doc T1 V7):
 *   {"type":"init","session_id","model"} · {"type":"message","role":"assistant","content","delta":true}
 *   · {"type":"result","status":"success","stats":{duration_ms,...}}
 * MCP: <hub>/.gemini/settings.json define premiere-pro; --allowed-mcp-server-names escopa;
 * --approval-mode yolo = paridade com o acesso total do provider claude por decisão de projeto.
 * apiKeySource: honesto — reflete env.GEMINI_API_KEY do filho, não mais fixo em "gemini".
 * Ressalva (V7): uma sessão OAuth cacheada em ~/.gemini/oauth_creds.json tem PRECEDÊNCIA
 * sobre GEMINI_API_KEY quando o HOME não é isolado (probado: mesmo com a key setada, o
 * CLI tentou OAuth e tocou o cache real). GEMINI_CLI_HOME existe na 0.55.1 e isola de
 * verdade o diretório de config (confirmado em V7, sem tocar o ~/.gemini real). O sistema
 * de perfis (lib/profiles.js, Task 2) já registra PROVIDERS.gemini.homeVar="GEMINI_CLI_HOME"
 * e profiles.envFor injeta GEMINI_API_KEY + GEMINI_CLI_HOME=homeDir isolado para perfis
 * "gemini api-key" — sob esse regime não há OAuth cache concorrente, então
 * env.GEMINI_API_KEY presente aqui é honesto como "api-key".
 * Sessão: --resume aceita uuid real na 0.55.1 (não documentado em --help, que só cita
 * "latest"/índice, mas confirmado em V7: mesmo session_id devolvido, input_tokens cresceu
 * = histórico da sessão anterior foi carregado). Passamos a guardar o session_id do init
 * e reenviá-lo com --resume no turno seguinte, em vez do sentinel "latest".
 * Limitação v1 (mantida — V7 não achou flag de system prompt nem var *SYSTEM* no bundle
 * 0.55.1): sem --append-system-prompt no gemini → SYSTEM vai prefixado na 1ª mensagem.
 */
const { spawnCli } = require("./win");
const { allowlistedEnv } = require("./profiles");
const provider = require("./provider");

function run(opts, onEvent) {
  const { message, session, systemPrompt, cwd, env, somenteLeitura } = opts;
  const args = ["-o", "stream-json", "--approval-mode", somenteLeitura ? "plan" : "yolo",
    "--allowed-mcp-server-names", "premiere-pro"];
  if (session) args.push("--resume", String(session));
  const text = session ? String(message) : `${systemPrompt || ""}\n\n---\n\n${message}`;
  args.push("-p", text);

  const childEnv = env || allowlistedEnv();
  let buf = "", stderrTail = "", finished = false, reply = "", sid = null;
  const finish = (ev) => { if (!finished) { finished = true; onEvent(ev); } };
  let child;
  try {
    child = spawnCli("gemini", args, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    queueMicrotask(() => finish({ kind: "done", ok: false, error: String(error.message || error) }));
    return null;
  }

  child.stdout.on("data", (c) => {
    buf += c; let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) handle(line);
    }
  });
  child.stderr.on("data", (c) => { stderrTail = (stderrTail + c).slice(-2000); });
  child.on("error", (e) => finish({ kind: "done", ok: false, error: "spawn gemini: " + e.message }));
  child.on("close", (code, signal) => {
    if (!finished) {
      finish(signal
        ? { kind: "done", ok: false, error: "cancelado", canceled: true }
        : { kind: "done", ok: false, error: `gemini saiu (${code}) ${provider.truncate(stderrTail, 300)}` });
    }
  });

  function handle(line) {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    const t = String(ev.type || "");
    if (t === "init") {
      sid = ev.session_id || sid;
      onEvent({ kind: "init", session: ev.session_id, model: ev.model,
        apiKeySource: childEnv.GEMINI_API_KEY ? "api-key" : "gemini",
        tools: 0, mcp: "premiere-pro" });
    } else if (t === "message" && ev.role === "assistant" && ev.content) {
      reply += ev.content;
      onEvent({ kind: "text", delta: ev.content });
    } else if (t.includes("tool")) { // formatos de tool variam entre versões — mapeia defensivo
      const name = ev.name || ev.tool_name || (ev.tool && ev.tool.name) || "tool";
      if (t.includes("result") || ev.status) {
        onEvent({ kind: "tool_end", id: String(ev.id || name), ok: ev.status !== "error",
          summary: provider.truncate(JSON.stringify(ev.output ?? ev.result ?? ""), 300) });
      } else {
        onEvent({ kind: "tool_start", id: String(ev.id || name), name });
      }
    } else if (t === "result") {
      finish({ kind: "done", ok: ev.status === "success", reply,
        session: sid || "latest", // uuid real do session_id (V7); "latest" só se init não chegou
        cost: null, turns: null, durationMs: ev.stats && ev.stats.duration_ms });
    }
  }
  return child;
}

provider.register({ name: "gemini", run });
module.exports = { run };
