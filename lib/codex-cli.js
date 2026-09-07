"use strict";
/**
 * lib/codex-cli.js — provider "codex": OpenAI Codex CLI headless (`codex exec`).
 * Flags, formato de eventos e resume VERIFICADOS em runtime (codex-cli 0.147.0,
 * probes T1 V2-V4).
 * Confirmado (V2): --json, --skip-git-repo-check, --dangerously-bypass-approvals-and-sandbox,
 * -m existem em `codex exec`; --ask-for-approval NÃO existe nesse subcomando (só no modo
 * interativo) — por isso não é usado aqui.
 * Confirmado (V3): thread.started tem campo thread_id (não session_id); texto do assistente
 * chega INTEIRO em item.completed/agent_message (sem delta); par item.started/item.completed
 * com item.type="command_execution" carrega command/aggregated_output/exit_code/status.
 * Confirmado (V6): item.completed com item.type="error" é aviso NÃO fatal (o turno segue e
 * fecha com turn.completed normalmente) — mapeado para "status", não para "done{error}".
 * Extrapolado (não capturado no doc): tipos de item mcp_tool_call/file_change/web_search e
 * item.type="reasoning" seguem o mesmo padrão started/completed de command_execution — mantidos
 * de forma defensiva (mesmo espírito do lib/gemini-cli.js) já que o uso real do provider passa
 * por MCP (premiere-pro); um evento top-level turn.failed/error também é um fallback defensivo
 * não observado nos probes, para não deixar falhas de turno sem sinalização.
 * Auth: CODEX_HOME do perfil (OAuth ChatGPT) ou key injetada por profiles.envFor (doc V3: key
 * solta no ambiente NÃO autentica — precisa de `codex login --with-api-key` prévio no CODEX_HOME).
 * MCP + provider custom (OpenRouter): config.toml do CODEX_HOME (gerado no addProfile, doc V5/V6).
 * Paridade de acesso total: bypass de sandbox/aprovação (mesma decisão de projeto aplicada ao claude
 * via --allowedTools e ao gemini via --approval-mode yolo).
 * Sem system prompt flag no exec (V2) → SYSTEM prefixado na 1ª mensagem (padrão gemini).
 * Resume (V4): `codex exec resume <thread_id> [flags] [prompt]` — id posicional, aceita as
 * mesmas flags de `codex exec` em qualquer ordem antes do prompt.
 * ITEM ABERTO: `--dangerously-bypass-approvals-and-sandbox` existe e está documentado em
 * `codex exec --help` (V2), mas NENHUM probe do doc rodou uma chamada com tool call sob essa
 * flag — o probe de tool call do V3 usou `-s workspace-write` porque o bypass foi bloqueado
 * pelo classificador de auto-mode da sessão que escreveu o doc. Ou seja: a combinação
 * "--dangerously-bypass-approvals-and-sandbox" + evento real de command_execution/tool call
 * nunca foi observada em runtime — só a flag isolada (via --help) e o tool call isolado (via
 * -s workspace-write) foram confirmados separadamente. Verificação real dessa combinação fica
 * para o E2E da Task 8.
 */
const { spawnCli } = require("./win");
const { allowlistedEnv } = require("./profiles");
const provider = require("./provider");

function run(opts, onEvent) {
  const { message, model, session, systemPrompt, cwd, env, somenteLeitura } = opts;
  const args = ["exec"];
  if (session) args.push("resume", String(session)); // V4: codex exec resume <id> [flags] [prompt]
  args.push("--json", "--skip-git-repo-check");
  if (somenteLeitura) args.push("-s", "read-only");
  else args.push("--dangerously-bypass-approvals-and-sandbox"); // V2
  if (model) args.push("-m", model);
  const text = session ? String(message) : `${systemPrompt || ""}\n\n---\n\n${message}`;
  args.push(text);

  const t0 = Date.now();
  let buf = "", stderrTail = "", finished = false, reply = "", threadId = session || null;
  const finish = (ev) => { if (!finished) { finished = true; onEvent(ev); } };
  let child;
  try {
    child = spawnCli("codex", args, { cwd, env: env || allowlistedEnv(), stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    queueMicrotask(() => finish({ kind: "done", ok: false, error: "spawn codex: " + String(error.message || error) }));
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
  child.on("error", (e) => finish({ kind: "done", ok: false, error: "spawn codex: " + e.message }));
  child.on("close", (code, signal) => {
    if (!finished) {
      finish(signal
        ? { kind: "done", ok: false, error: "cancelado", canceled: true }
        : { kind: "done", ok: false, error: `codex saiu (${code}) ${provider.truncate(stderrTail, 300)}` });
    }
  });

  function toolName(item) {
    return item.command || item.tool || (item.server && `${item.server}.${item.tool}`) || item.type || "tool";
  }

  function handle(line) {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    const t = String(ev.type || "");
    if (t === "thread.started") {
      threadId = ev.thread_id || threadId;
      onEvent({ kind: "init", session: threadId, model: model || "codex", apiKeySource: "codex", tools: 0, mcp: "premiere-pro" });
    } else if (t === "turn.started") {
      onEvent({ kind: "status", message: "codex pensando…" });
    } else if (t.startsWith("item.")) {
      const item = ev.item || {};
      const it = String(item.type || "");
      if (it === "agent_message") {
        // V3 (2º probe): um turno pode carregar VÁRIOS agent_message completos (narração +
        // resposta final) — cada item.completed é uma mensagem inteira, não um delta. Sem
        // separador eles grudam ("...comando.A saída foi...") tanto no done.reply quanto no
        // texto acumulado do painel (que só concatena, nunca reseta no meio do turno).
        if (t === "item.completed" && item.text) {
          const sep = reply ? "\n\n" : "";
          reply += sep + item.text;
          onEvent({ kind: "text", delta: sep + item.text });
        }
      } else if (it === "reasoning") {
        if (t === "item.completed") onEvent({ kind: "thinking", tokens: 0 });
      } else if (it === "error") {
        // V6: item.completed{item.type:"error"} é aviso não fatal (turno segue e fecha normal).
        if (t === "item.completed") onEvent({ kind: "status", message: provider.truncate(String(item.message || "aviso do codex"), 300) });
      } else if (it === "command_execution" || it === "mcp_tool_call" || it === "file_change" || it === "web_search") {
        const id = String(item.id || toolName(item));
        if (t === "item.started") onEvent({ kind: "tool_start", id, name: toolName(item) });
        else if (t === "item.completed") {
          // V3: exit_code é o sinal confiável para command_execution (null enquanto roda, 0 = ok);
          // para tipos de item sem exit_code, cai para status !== "failed"/"error" (não observado no doc).
          const ok = item.exit_code != null ? item.exit_code === 0 : item.status !== "failed" && item.status !== "error";
          onEvent({ kind: "tool_end", id, ok,
            summary: provider.truncate(String(item.aggregated_output ?? item.result ?? item.status ?? ""), 300) });
        }
      }
    } else if (t === "turn.completed") {
      finish({ kind: "done", ok: true, reply, session: threadId, cost: null,
        turns: null, durationMs: Date.now() - t0 });
    } else if (t === "turn.failed" || t === "error") {
      finish({ kind: "done", ok: false, reply, session: threadId,
        error: provider.truncate(String(ev.message || (ev.error && ev.error.message) || "codex falhou"), 300) });
    }
  }
  return child;
}

provider.register({ name: "codex", run });
module.exports = { run };
