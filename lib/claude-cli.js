"use strict";
/**
 * lib/claude-cli.js — provider "claude": spawn `claude -p --output-format stream-json`
 * e traduz os eventos do CLI para o contrato do lib/provider.js.
 * Flags e taxonomia de eventos verificadas no CLI 2.1.219 durante o pré-voo de
 * integração, em 2026-07-24. CoT literal não é exposto pelo CLI
 * (thinking_delta chega vazio) — o medidor vem de system/thinking_tokens.
 */
const { spawnCli } = require("./win");
const { allowlistedEnv } = require("./profiles");
const provider = require("./provider");

function run(opts, onEvent) {
  const {
    message, model, effort, session, systemPrompt, allowedTools, mcpConfig, cwd, env,
    somenteLeitura, maxTokens, maxBudgetUsd,
  } = opts;
  const args = [
    "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--setting-sources", "", // determinístico: sem settings/hooks herdados do ~/.claude
  ];
  if (somenteLeitura) args.push("--tools", "");
  if (mcpConfig && !somenteLeitura) args.push("--mcp-config", mcpConfig, "--strict-mcp-config");
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  if (allowedTools && !somenteLeitura) args.push("--allowedTools", allowedTools);
  if (typeof maxBudgetUsd === "number" && Number.isFinite(maxBudgetUsd)) {
    args.push("--max-budget-usd", String(maxBudgetUsd));
  }
  if (model) args.push("--model", model, "--effort", effort || "high"); // xhigh quebra sem thinking
  if (session) args.push("--resume", session);
  // "--" fecha as opções: --allowedTools é variádico e engoliria o prompt posicional
  args.push("--", String(message));

  const childEnv = typeof maxTokens === "number" && Number.isFinite(maxTokens)
    ? { ...(env || allowlistedEnv()), CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxTokens) }
    : (env || allowlistedEnv());
  let buf = "", stderrTail = "", finished = false;
  const blocks = new Map(); // index do stream -> {type, id, name, json}

  const finish = (ev) => { if (!finished) { finished = true; onEvent(ev); } };
  let child;
  try {
    child = spawnCli("claude", args, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    queueMicrotask(() => finish({ kind: "done", ok: false, error: String(error.message || error) }));
    return null;
  }

  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) handleLine(line);
    }
  });
  child.stderr.on("data", (c) => { stderrTail = (stderrTail + c).slice(-2000); });
  child.on("error", (e) => finish({ kind: "done", ok: false, error: "spawn claude: " + e.message }));
  child.on("close", (code, signal) => {
    if (!finished) {
      finish(signal
        ? { kind: "done", ok: false, error: "cancelado", canceled: true }
        : { kind: "done", ok: false, error: `claude saiu (código ${code}) ${provider.truncate(stderrTail, 400)}` });
    }
  });

  function handleLine(line) {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    const t = ev.type;
    if (t === "system") {
      if (ev.subtype === "init") {
        onEvent({ kind: "init", session: ev.session_id, model: ev.model, apiKeySource: ev.apiKeySource,
          tools: (ev.tools || []).length,
          mcp: (ev.mcp_servers || []).map((s) => `${s.name}:${s.status}`).join(" ") });
      } else if (ev.subtype === "thinking_tokens") {
        onEvent({ kind: "thinking", tokens: ev.estimated_tokens || 0 });
      } else if (ev.subtype === "status" && ev.status) {
        onEvent({ kind: "status", message: String(ev.status) });
      }
      return;
    }
    if (t === "rate_limit_event") { onEvent({ kind: "quota", info: ev.rate_limit_info || {} }); return; }
    if (t === "stream_event") {
      const e = ev.event || {};
      if (e.type === "content_block_start") {
        const cb = e.content_block || {};
        if (cb.type === "tool_use") {
          blocks.set(e.index, { type: "tool_use", id: cb.id, name: cb.name, json: "" });
          onEvent({ kind: "tool_start", id: cb.id, name: cb.name });
        } else blocks.set(e.index, { type: cb.type });
      } else if (e.type === "content_block_delta") {
        const d = e.delta || {}, b = blocks.get(e.index);
        if (d.type === "text_delta" && d.text) onEvent({ kind: "text", delta: d.text });
        else if (d.type === "input_json_delta" && b && b.type === "tool_use") b.json += d.partial_json || "";
      } else if (e.type === "content_block_stop") {
        const b = blocks.get(e.index);
        if (b && b.type === "tool_use") {
          let input = b.json;
          try { input = JSON.stringify(JSON.parse(b.json || "{}")); } catch {}
          onEvent({ kind: "tool_input", id: b.id, name: b.name, input: provider.truncate(input, 600) });
        }
        blocks.delete(e.index);
      }
      return;
    }
    if (t === "user") {
      const content = ev.message && Array.isArray(ev.message.content) ? ev.message.content : [];
      for (const item of content) {
        if (item && item.type === "tool_result") {
          let text = "";
          if (typeof item.content === "string") text = item.content;
          else if (Array.isArray(item.content)) {
            text = item.content.filter((c) => c && c.type === "text").map((c) => c.text).join(" ");
          }
          onEvent({ kind: "tool_end", id: item.tool_use_id, ok: !item.is_error, summary: provider.truncate(text, 300) });
        }
      }
      return;
    }
    if (t === "result") {
      finish({ kind: "done", ok: ev.subtype === "success",
        reply: ev.result || (ev.is_error ? String(ev.error || ev.subtype) : ""),
        session: ev.session_id || null, cost: ev.total_cost_usd, turns: ev.num_turns,
        durationMs: ev.duration_ms, error: ev.is_error ? (ev.result || ev.subtype) : undefined });
    }
  }

  return child;
}

provider.register({ name: "claude", run });
module.exports = { run };
