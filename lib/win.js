"use strict";
/**
 * lib/win.js — spawn portável de CLIs (claude/codex/gemini).
 *
 * Contexto Windows:
 * - CVE-2024-27980: o Node recusa spawn direto de .cmd/.bat sem shell (EINVAL).
 *   Foi por isso que a versão anterior usava shell:true.
 * - DEP0190: no modo shell o Node NÃO cita/escapa os args do array — eles são
 *   apenas concatenados na linha do cmd.exe. Consequências: prompts multilinha
 *   (--append-system-prompt) não passam, paths com espaço se partem em vários
 *   args e metacaracteres (& | ^ < >) numa mensagem viram comando — injeção.
 *
 * Estratégia atual: resolver o shim .cmd do npm até o entrypoint JS real
 * (linha `"%dp0%\node_modules\<pkg>\<bin>"` do formato cmd-shim) e spawnar
 * process.execPath (o próprio node) com [jsEntry, ...args], SEM shell —
 * evita o EINVAL e preserva os args byte a byte.
 * Se a resolução do JS falhar, procura um executável .exe no PATH.
 * Nenhum caminho usa shell, mesmo quando o chamador envia essa opção.
 *
 * No macOS/Linux devolve spawn/execFile puros (comportamento intacto).
 */
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");
const IS_WIN = process.platform === "win32";

// Extrai do conteúdo de um shim .cmd do npm o caminho relativo do entrypoint
// JS: o token citado `"%dp0%\<relpath>"` (alguns geradores emitem `"%~dp0\..."`).
// Ignora os tokens .exe do shim (ex.: `"%dp0%\node.exe"`), que não são o entry.
// Retorna o caminho relativo capturado, ou null se nada casar.
function parseShimJsRelpath(shimText) {
  if (typeof shimText !== "string") return null;
  const re = /"%(?:~dp0|dp0%)\\([^"]+)"/g;
  let m;
  while ((m = re.exec(shimText)) !== null) {
    if (!/\.exe$/i.test(m[1])) return m[1];
  }
  return null;
}

// Acha o shim `<dir>\<cmd>.cmd` no PATH informado e resolve o entrypoint JS
// absoluto a partir do conteúdo dele. Retorna null (nunca lança) quando:
// nenhum shim existe no PATH, o shim é ilegível, ou não há captura %dp0%.
function resolveWinJsEntry(cmd, envPath) {
  try {
    const dirs = String(envPath || "").split(";");
    for (const dir of dirs) {
      if (!dir) continue;
      const shim = path.join(dir, cmd + ".cmd");
      if (!fs.existsSync(shim)) continue;
      let text;
      try {
        text = fs.readFileSync(shim, "utf8");
      } catch (_err) {
        continue;
      }
      const rel = parseShimJsRelpath(text);
      if (!rel) continue;
      return path.join(path.dirname(shim), rel);
    }
    return null;
  } catch (_err) {
    return null;
  }
}

function resolveWinExecutable(cmd, envPath) {
  try {
    if (/\.(?:bat|cmd)$/i.test(cmd)) return null;
    const dirs = String(envPath || "").split(";");
    const suffixes = /\.exe$/i.test(cmd) ? [""] : [".exe"];
    for (const dir of dirs) {
      if (!dir) continue;
      for (const suffix of suffixes) {
        const candidate = path.join(dir, cmd + suffix);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      }
    }
  } catch (_err) {}
  return null;
}

function withoutShell(opts) {
  const safe = { ...(opts || {}) };
  delete safe.shell;
  return safe;
}

function winTarget(cmd, args, opts) {
  const envPath = (opts && opts.env && opts.env.PATH) || process.env.PATH;
  const jsEntry = resolveWinJsEntry(cmd, envPath);
  if (jsEntry) {
    return { cmd: process.execPath, args: [jsEntry].concat(args || []), opts: withoutShell(opts) };
  }
  const executable = resolveWinExecutable(cmd, envPath);
  if (executable) return { cmd: executable, args: args || [], opts: withoutShell(opts) };
  throw new Error(`Não encontrei o comando ${cmd}. Execute o instalador de novo.`);
}

function spawnCli(cmd, args, opts) {
  if (!IS_WIN) return spawn(cmd, args, withoutShell(opts));
  const t = winTarget(cmd, args, opts);
  return spawn(t.cmd, t.args, t.opts);
}

function execFileCli(cmd, args, opts, cb) {
  if (!IS_WIN) return execFile(cmd, args, withoutShell(opts), cb);
  const t = winTarget(cmd, args, opts);
  return execFile(t.cmd, t.args, t.opts, cb);
}

module.exports = {
  spawnCli, execFileCli, IS_WIN, winTarget, resolveWinExecutable, resolveWinJsEntry, parseShimJsRelpath,
};
