#!/usr/bin/env node
/**
 * Medium Latens, server do painel.
 *
 * Painel CEP (Window > Extensões > "Medium Latens")
 *   → este server (127.0.0.1:8765)
 *     → provider LLM (lib/provider.js; multi-provider — claude/codex/gemini, cada um
 *       em sessão paralela, escolhidos pelo PERFIL ativo — lib/profiles.js, imune ao
 *       switch do terminal)
 *       → premiere-pro-mcp (mcp-config.json) → painel MCP Bridge → Premiere.
 *
 * Debug na mão:  node server.js
 * Produção:      serviço configurado pelo instalador.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const provider = require("./lib/provider");
require("./lib/claude-cli"); // registra o provider "claude" (default)
require("./lib/gemini-cli"); // registra o provider "gemini" (F7 — segundo cérebro)
require("./lib/codex-cli");  // registra o provider "codex" (P1 — spec v2 §4.2)
const profiles = require("./lib/profiles");
const settings = require("./lib/settings");
const credentials = require("./lib/credentials");
const wizard = require("./lib/wizard");
const sse = require("./lib/sse");
const briefing = require("./lib/briefing");
const premiere = require("./lib/premiere");
const autozoom = require("./lib/autozoom");
const multicam = require("./lib/multicam");
const auth = require("./lib/auth");
const statusPage = require("./lib/status");
const telemetria = require("./lib/telemetria");
const envio = require("./lib/envio");
const resumoSessao = require("./lib/resumo-sessao");
const { APP_DIR, USER_DIR, PYTHON_INTERPRETER, FILES, ensureUserDir, workspaceDir } = require("./lib/paths");
process.env.PATH = path.join(USER_DIR, "bin") + path.delimiter + (process.env.PATH || "");

const PORT = 8765;
const NAME = "Medium Latens";
const TOKEN = auth.getToken();
ensureUserDir();
const MCP_CONFIG = FILES.mcpConfig;
const WATCHDOG_MS = 10 * 60 * 1000; // com streaming + cancelar visível, 10min é o teto duro
const MSG_MAX = 100000;             // mensagens podem conter scripts inteiros

// Chaves de recursos extras (voz, imagem) vêm do .env do usuário e de nenhum outro lugar.
// As variáveis de autenticação de agente nunca chegam aos filhos: profiles.envFor faz o scrub.
require("./lib/userenv").load();

// ACESSO TOTAL (decisão de projeto): perfil completo do MCP incl. unsafe-script
// (também fixado no env do mcp-config.json, que é quem vale p/ o processo do MCP).
const FULL_CAPS = "inspect,edit,export,filesystem,unsafe-script";
const ALLOWED = "mcp__premiere-pro__*,Bash,Read,Glob,Grep,Write,Edit,WebSearch,WebFetch";

const SYSTEM = require("./lib/system").build({
  appDir: APP_DIR,
  userDir: USER_DIR,
  pythonInterpreter: PYTHON_INTERPRETER,
});

// ---------- estado ----------
let busy = false, busySince = 0, child = null, session = null;
let lastInit = null, lastQuota = null;
let lastSlug = null; // último projeto do Premiere que o servidor viu; define o cwd dos turnos

function ensureDir(dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch {} return dir; }
function lembrarSlug(s) {
  if (typeof s === "string" && /^[a-z0-9][a-z0-9-]*$/.test(s)) lastSlug = s;
  return s;
}
function agentCwd() { return lastSlug ? ensureDir(workspaceDir(lastSlug)) : FILES.workspaces; }

function emit(ev) { sse.broadcast(ev); }

function killChild(reason) {
  if (!child) return;
  const c = child;
  try { c.kill("SIGTERM"); } catch {}
  setTimeout(() => { try { c.kill("SIGKILL"); } catch {} }, 3000);
  if (reason) emit({ kind: "status", message: reason });
}

setInterval(() => { // watchdog: nunca ficar "ocupado" para sempre
  if (busy && Date.now() - busySince > WATCHDOG_MS) {
    console.log("[watchdog] turno preso >10min — liberando");
    killChild("watchdog: turno preso — cancelado");
    busy = false;
  }
}, 15000);

// ---------- envio da coleta ----------
envio.agendar();

function startTurn(message, res, wait) {
  const inicioTurno = Date.now();
  iniciarAtividadeResumo(inicioTurno);
  const cfg = settings.load();
  const prof = profiles.get(cfg.profile);
  const provName = prof.provider || cfg.provider || "claude";
  let env;
  try {
    env = profiles.envFor(cfg.profile, { PREMIERE_MCP_CAPABILITIES: FULL_CAPS });
  } catch (e) { // MISSING_KEY: aponta o .env do servidor, nunca pede key no painel (spec §8)
    const ev = { kind: "done", ok: false, error: String(e.message) };
    telemetria.evento("turno_fim", { ok: false, erro: String(e.message), cancelado: false });
    concluirAtividadeResumo(inicioTurno);
    emit(ev);
    if (res) res.end(JSON.stringify({ ok: false, error: ev.error }));
    return;
  }
  busy = true; busySince = Date.now();
  telemetria.evento("turno_inicio", { provider: provName, modelo: prof.model || cfg.model || null, prompt: message });
  emit({ kind: "user", text: provider.truncate(message, 2000) });
  const prov = provider.get(provName) || provider.get("claude");
  const turnChild = prov.run({
    message,
    model: prof.model || cfg.model || undefined,
    effort: cfg.effort,
    session,
    systemPrompt: SYSTEM,
    allowedTools: ALLOWED,
    mcpConfig: MCP_CONFIG,
    cwd: agentCwd(),
    env,
  }, (ev) => {
    if (ev.kind === "init") lastInit = ev;
    if (ev.kind === "quota") lastQuota = ev.info;
    if (ev.kind === "tool_input") telemetria.evento("ferramenta", { id: ev.id, nome: ev.name, entrada: ev.input });
    if (ev.kind === "tool_end") telemetria.evento("ferramenta_fim", { id: ev.id, ok: ev.ok, resumo: ev.summary });
    if (ev.kind === "done") {
      telemetria.evento("turno_fim", {
        ok: ev.ok, erro: ev.error || null, cancelado: !!ev.canceled, custo: ev.cost ?? null,
        turnos: ev.turns ?? null, duracaoMs: ev.durationMs ?? null, resposta: ev.reply || null,
      });
      if (child === turnChild) { busy = false; child = null; } // done tardio de turno velho não mexe no estado de um turno mais novo
      if (ev.session) session = ev.session; // cancelar NÃO perde a conversa
      concluirAtividadeResumo(inicioTurno);
      if (wait && res) { try { res.end(JSON.stringify({ ok: ev.ok, reply: ev.reply || ev.error || "" })); } catch {} }
    }
    emit(ev);
  });
  child = turnChild;
  if (!wait && res) res.end(JSON.stringify({ ok: true, started: true }));
}

// ---------- resumo da sessão ----------
const RESUMO_OCIOSO_MS = 2 * 60 * 1000;
const RESUMO_INTERVALO_MS = 30 * 1000;
const RESUMO_ENCERRAMENTO_MS = 15 * 1000;
const RESUMO_TIMEOUT_MS = 90 * 1000;
const resumo = {
  eventosDesde: null,
  turnos: 0,
  ultimaAtividade: 0,
  jaRodou: false,
  rodando: false,
};
let resumoChild = null;
let resumoEmCurso = null;

function iniciarAtividadeResumo(agora = Date.now()) {
  if (resumo.jaRodou) {
    resumo.eventosDesde = new Date(agora).toISOString();
    resumo.turnos = 0;
    resumo.jaRodou = false;
  } else if (!resumo.eventosDesde) {
    resumo.eventosDesde = new Date(agora).toISOString();
  }
}

function concluirAtividadeResumo(inicioTurno, agora = Date.now()) {
  iniciarAtividadeResumo(inicioTurno);
  resumo.turnos++;
  resumo.ultimaAtividade = agora;
}

function estadoResumo() {
  return { ocupado: busy, jaRodou: resumo.jaRodou, eventos: resumo.turnos };
}

function podeRodarResumo() {
  return !resumo.rodando
    && resumoSessao.deveRodar(estadoResumo())
    && Date.now() - resumo.ultimaAtividade >= RESUMO_OCIOSO_MS;
}

function chamarResumo({ modelo, prompt, maxTokens }) {
  if (busy) return Promise.reject(new Error("turno em andamento"));
  return new Promise((resolve, reject) => {
    const cfg = settings.load();
    const perfil = profiles.get(cfg.profile);
    const prov = provider.get(perfil.provider || cfg.provider || "claude") || provider.get("claude");
    let finalizado = false;
    let filhoDesteResumo = null;
    let limite = null;
    const terminar = (ev) => {
      if (finalizado || ev.kind !== "done") return;
      finalizado = true;
      if (limite) clearTimeout(limite);
      if (resumoChild === filhoDesteResumo) resumoChild = null;
      if (ev.ok) resolve(ev.reply || "");
      else reject(new Error("não foi possível gerar o resumo da sessão"));
    };
    filhoDesteResumo = prov.run({
      message: prompt,
      model: modelo,
      effort: "low",
      session: null,
      systemPrompt: undefined,
      allowedTools: undefined,
      mcpConfig: undefined,
      cwd: agentCwd(),
      env: profiles.envFor(cfg.profile),
      somenteLeitura: true,
      maxTokens,
      maxBudgetUsd: 0.05,
    }, terminar);
    if (!finalizado) {
      resumoChild = filhoDesteResumo;
      limite = setTimeout(() => {
        if (finalizado) return;
        finalizado = true;
        matarResumo();
        reject(new Error("resumo demorou demais"));
      }, RESUMO_TIMEOUT_MS);
      limite.unref();
    }
  });
}

function executarResumo() {
  if (resumoEmCurso) return resumoEmCurso;
  resumo.rodando = true;
  const cfg = settings.load();
  resumoEmCurso = resumoSessao.gerar({
    perfil: profiles.get(cfg.profile),
    chamar: chamarResumo,
    desde: resumo.eventosDesde,
  }).finally(() => {
    resumo.jaRodou = true;
    resumo.rodando = false;
    resumoEmCurso = null;
  });
  return resumoEmCurso;
}

function dispararResumoOcioso() {
  if (!podeRodarResumo()) return null;
  return executarResumo();
}

const resumoIntervalo = setInterval(() => {
  dispararResumoOcioso();
}, RESUMO_INTERVALO_MS);
resumoIntervalo.unref();

function matarResumo() {
  if (!resumoChild) return;
  const atual = resumoChild;
  resumoChild = null;
  try { atual.kill("SIGTERM"); } catch {}
}

// O processo morre pelo próprio sinal para preservar o restart do launchd.
// A única espera permitida é o resumo da sessão, por no máximo 15 segundos.
function encerrarComResumo(sinal) {
  let saiu = false;
  const sair = () => {
    if (saiu) return;
    saiu = true;
    try { server.close(); } catch {}
    matarResumo();
    process.removeListener(sinal, sair);
    process.kill(process.pid, sinal);
  };
  try { server.close(); } catch {}
  process.once(sinal, sair);
  if (busy || !resumoSessao.deveRodar(estadoResumo())) {
    sair();
    return;
  }
  const limite = setTimeout(() => {
    sair();
  }, RESUMO_ENCERRAMENTO_MS);
  limite.unref();
  executarResumo().finally(() => {
    clearTimeout(limite);
    sair();
  });
}

process.once("SIGTERM", () => encerrarComResumo("SIGTERM"));
process.once("SIGINT", () => encerrarComResumo("SIGINT"));

// ---------- HTTP ----------
function semChave(obj) {
  const vistos = new WeakSet();
  function visitar(valor) {
    if (!valor || typeof valor !== "object" || vistos.has(valor)) return;
    vistos.add(valor);
    for (const nome of Object.keys(valor)) {
      if (nome.toLowerCase() === "key") throw new Error("resposta contém campo sensível");
      visitar(valor[nome]);
    }
  }
  visitar(obj);
  return obj;
}

function responderWizard(res, objeto, statusCode = 200) {
  let resposta = objeto;
  let status = statusCode;
  try {
    semChave(resposta);
  } catch (_erro) {
    status = 500;
    resposta = { ok: false, motivo: "Não foi possível concluir a configuração com segurança." };
    semChave(resposta);
  }
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(resposta));
}

function resumoPerfil(name, perfil) {
  return {
    name,
    label: perfil.label,
    provider: perfil.provider,
    authMode: perfil.authMode,
    credencialId: perfil.credencialId || null,
  };
}

const server = http.createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch (error) {
    console.error(`[${NAME}] erro interno no handler: ${error && (error.code || error.message) || "erro desconhecido"}`);
    if (res.writableEnded) return;
    if (res.headersSent) return res.end();
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "erro interno" }));
  }
});

function responderErroInterno(res, error) {
  console.error(`[${NAME}] erro interno assíncrono: ${error && (error.code || error.message) || "erro desconhecido"}`);
  if (res.writableEnded) return;
  if (res.headersSent) return res.end();
  res.statusCode = 500;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: "erro interno" }));
}

function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, "http://x");
  } catch (_error) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ error: "requisição inválida" }));
  }
  if (url.pathname === "/status" && req.method === "GET" && url.searchParams.has("t")) {
    const bootstrapReq = {
      headers: { ...req.headers, "x-medium-latens-token": url.searchParams.get("t") },
      socket: req.socket,
    };
    const bootstrapPasse = auth.check(bootstrapReq, new URL("/status", "http://x"), TOKEN);
    if (!bootstrapPasse.ok) {
      res.statusCode = bootstrapPasse.status;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ error: bootstrapPasse.error }));
    }
    res.statusCode = 303;
    res.setHeader("Location", "/status");
    res.setHeader("Set-Cookie", `ml_status=${encodeURIComponent(url.searchParams.get("t"))}; HttpOnly; SameSite=Lax; Path=/status`);
    return res.end();
  }
  const passe = auth.check(req, url, TOKEN);
  if (!passe.ok) {
    res.statusCode = passe.status;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ error: passe.error }));
  }
  if (req.method === "OPTIONS") return res.end();
  if (!["/stream", "/health", "/status"].includes(url.pathname)) {
    telemetria.evento("rota", { caminho: url.pathname, metodo: req.method });
  }

  if (url.pathname === "/status" && req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    statusPage.renderStatusPage({ distributionUrl: settings.load().distributionUrl })
      .then((html) => res.end(html))
      .catch(() => {
        res.statusCode = 500;
        res.end(statusPage.renderErrorPage());
      });
    return;
  }

  if (url.pathname !== "/stream") res.setHeader("Content-Type", "application/json");

  if (url.pathname === "/health") {
    const cfg = settings.load();
    const p = profiles.get(cfg.profile);
    profiles.cliStatus().then((clis) => {
      res.end(JSON.stringify({
        ok: true, name: NAME, mode: "cli",
        version: statusPage.readVersion(path.join(APP_DIR, "VERSION")),
        provider: p.provider, authMode: p.authMode,
        model: p.model || cfg.model || "padrão",
        profile: { name: p.name, label: p.label },
        auth: lastInit ? { apiKeySource: lastInit.apiKeySource, model: lastInit.model } : null,
        quota: lastQuota ? { type: lastQuota.rateLimitType, status: lastQuota.status, resetsAt: lastQuota.resetsAt } : null,
        clis,
        busy, session: session ? session.slice(0, 8) : null, sse: sse.count(),
        uptime: Math.round(process.uptime()),
      }));
    }).catch((error) => responderErroInterno(res, error));
    return;
  }

  if (url.pathname === "/stream") return sse.handle(req, res);

  if (url.pathname === "/wizard" && req.method === "GET") {
    try {
      const cfg = settings.load();
      const perfis = Object.entries(profiles.load()).map(([name, perfil]) => resumoPerfil(name, perfil));
      return responderWizard(res, {
        ok: true,
        trilhos: wizard.catalogo(),
        contas: credentials.list(),
        ativo: cfg.profile,
        perfis,
      });
    } catch (_erro) {
      return responderWizard(res, { ok: false, motivo: "Não foi possível carregar as contas agora." }, 500);
    }
  }

  if (url.pathname === "/wizard/validar" && req.method === "POST") {
    return jsonBody(req, async (j) => {
      try {
        const resultado = await wizard.validar({
          provider: j.provider, key: j.key, endpoint: j.endpoint, model: j.model,
        });
        responderWizard(res, resultado, resultado.ok ? 200 : 400);
      } catch (_erro) {
        responderWizard(res, { ok: false, motivo: "Não foi possível validar a chave agora. Tente de novo." }, 400);
      }
    });
  }

  if (url.pathname === "/wizard/salvar" && req.method === "POST") {
    return jsonBody(req, async (j) => {
      try {
        const validacao = await wizard.validar({
          provider: j.provider, key: j.key, endpoint: j.endpoint, model: j.model,
        });
        if (!validacao.ok) return responderWizard(res, validacao, 400);
        if (typeof j.id !== "string" || !j.id.trim()) {
          return responderWizard(res, { ok: false, motivo: "Dê um nome para a conta." }, 400);
        }
        const nomeConta = j.id.trim();
        const slug = profiles.slugDeConta(nomeConta);
        if (!slug) return responderWizard(res, { ok: false, motivo: "Dê um nome para a conta." }, 400);
        const conta = credentials.save({
          id: slug, provider: j.provider, endpoint: validacao.endpoint, model: j.model, key: j.key,
        });
        const perfilCriado = profiles.addFromCredential(conta, nomeConta);
        const login = await profiles.loginComChave(perfilCriado.name, j.key);
        if (!login.ok) {
          credentials.remove(conta.id);
          profiles.remove(perfilCriado.name);
          return responderWizard(res, {
            ok: false,
            motivo: "Não consegui registrar a chave no assistente do ChatGPT. Confira a chave e tente de novo.",
          }, 400);
        }
        settings.save({ profile: perfilCriado.name });
        session = null;
        lastInit = null;
        return responderWizard(res, {
          ok: true,
          conta,
          perfil: resumoPerfil(perfilCriado.name, perfilCriado),
        });
      } catch (_erro) {
        return responderWizard(res, { ok: false, motivo: "Não foi possível salvar a conta. Confira os dados e tente de novo." }, 400);
      }
    });
  }

  if (url.pathname === "/wizard/assinatura" && req.method === "POST") {
    return jsonBody(req, (j) => {
      const prov = j.provider === "claude" ? "claude" : (j.provider === "codex" ? "codex" : null);
      if (!prov) return responderWizard(res, { ok: false, motivo: "Escolha uma assinatura disponível." }, 400);
      try {
        const login = profiles.startLogin(profiles.slugDeConta(j.id), prov);
        const perfil = profiles.get(login.name);
        return responderWizard(res, {
          ok: true,
          mensagem: "Abrimos seu navegador. Conclua o login por lá e volte aqui.",
          pid: login.pid,
          perfil: resumoPerfil(login.name, perfil),
        });
      } catch (_erro) {
        return responderWizard(res, {
          ok: false,
          motivo: "Não consegui abrir o login. Confira se o assistente está instalado.",
        }, 400);
      }
    });
  }

  if (url.pathname === "/wizard/ativar" && req.method === "POST") {
    return jsonBody(req, async (j) => {
      try {
        if (typeof j.id !== "string" || !j.id.trim()) {
          return responderWizard(res, { ok: false, motivo: "Escolha uma conta para ativar." }, 400);
        }
        const nome = j.id.trim();
        const perfil = profiles.load()[nome];
        if (!perfil || perfil.authMode !== "assinatura") {
          return responderWizard(res, { ok: false, motivo: "A conta de assinatura não foi encontrada." }, 400);
        }
        const estado = await profiles.authStatus(nome);
        if (!estado || !estado.loggedIn) {
          return responderWizard(res, { ok: false, motivo: "Conclua o login antes de ativar esta conta." }, 400);
        }
        settings.save({ profile: nome });
        session = null;
        lastInit = null;
        return responderWizard(res, { ok: true, perfil: resumoPerfil(nome, perfil) });
      } catch (_erro) {
        return responderWizard(res, { ok: false, motivo: "Não foi possível ativar a conta agora." }, 400);
      }
    });
  }

  if (url.pathname === "/wizard/estado" && req.method === "GET") {
    const id = url.searchParams.get("id");
    (async () => {
      try {
        const estado = await profiles.authStatus(id);
        responderWizard(res, {
          ok: true,
          auth: {
            loggedIn: !!(estado && estado.loggedIn),
            email: estado && typeof estado.email === "string" ? estado.email : null,
            detail: statusPage.redactSecrets(estado && estado.detail ? estado.detail : "").slice(0, 160),
          },
        });
      } catch (_erro) {
        responderWizard(res, { ok: false, motivo: "Não foi possível conferir a conta agora." }, 500);
      }
    })();
    return;
  }

  if (url.pathname === "/wizard/remover" && req.method === "POST") {
    return jsonBody(req, (j) => {
      if (typeof j.id !== "string" || !j.id.trim()) {
        return responderWizard(res, { ok: false, motivo: "Escolha uma conta para remover." }, 400);
      }
      const entradaPerfil = Object.entries(profiles.load())
        .find(([name, perfil]) => name === j.id || perfil.credencialId === j.id);
      const nomePerfil = entradaPerfil ? entradaPerfil[0] : j.id;
      credentials.remove(j.id);
      profiles.remove(nomePerfil);
      const cfg = settings.load();
      if (cfg.profile === nomePerfil) {
        settings.save({ profile: "padrao" });
        session = null;
        lastInit = null;
      }
      return responderWizard(res, {
        ok: true,
        contas: credentials.list(),
        ativo: settings.load().profile,
      });
    });
  }

  if (url.pathname === "/model") { // /model?m=sonnet|opus|haiku|(vazio=default Max)
    const cfg = settings.save({ model: url.searchParams.get("m") || "" });
    return res.end(JSON.stringify({ ok: true, model: cfg.model || "padrão (Max)" }));
  }

  if (url.pathname === "/cancel") { // cancela o turno SEM perder a conversa
    killChild("cancelado pelo usuário");
    busy = false;
    return res.end(JSON.stringify({ ok: true, canceled: true, session: session ? session.slice(0, 8) : null }));
  }

  if (url.pathname === "/new" || url.pathname === "/reset") { // nova conversa (sessão nova)
    killChild(null);
    busy = false; session = null; lastInit = null;
    emit({ kind: "status", message: "nova conversa" });
    return res.end(JSON.stringify({ ok: true, new: true }));
  }

  if (url.pathname === "/profiles" && req.method === "GET") {
    const all = profiles.load();
    const cfg = settings.load();
    Promise.all(Object.keys(all).map(async (name) => {
      const auth = await profiles.authStatus(name);
      return [name, { ...all[name], active: name === cfg.profile, loginCommand: profiles.loginCommand(name),
        auth: { loggedIn: !!auth.loggedIn, email: auth.email || null, subscriptionType: auth.subscriptionType || null } }];
    })).then((entries) => {
      res.end(JSON.stringify({ ok: true, active: cfg.profile, profiles: Object.fromEntries(entries) }));
    }).catch((error) => responderErroInterno(res, error));
    return;
  }

  if (url.pathname === "/providers" && req.method === "GET") {
    const all = profiles.load();
    const cfg = settings.load();
    Promise.all([profiles.cliStatus(), ...Object.keys(all).map(async (name) => {
      const auth = await profiles.authStatus(name);
      const p = { name, ...all[name] };
      const kv = p.authMode === "api-key" ? (p.endpoint ? (p.envKey || "OPENROUTER_API_KEY") : ({ claude: "ANTHROPIC_API_KEY", codex: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" })[p.provider]) : null;
      const credencialSalva = p.credencialId ? !!credentials.get(p.credencialId) : false;
      return { name, label: p.label, provider: p.provider, authMode: p.authMode,
        model: p.model || null, endpoint: p.endpoint || null, active: name === cfg.profile,
        auth, loginCommand: profiles.loginCommand(name),
        keyMissing: kv && !process.env[kv] && !credencialSalva ? kv : null };
    })]).then(([clis, ...list]) => {
      const providers = {};
      for (const prov of ["claude", "codex", "gemini"]) {
        providers[prov] = { cli: clis[prov], profiles: list.filter((p) => p.provider === prov) };
      }
      res.end(JSON.stringify({ ok: true, active: cfg.profile, providers }));
    }).catch((error) => responderErroInterno(res, error));
    return;
  }

  if (url.pathname === "/profiles/use") { // /profiles/use?p=<nome>
    const name = url.searchParams.get("p");
    if (!profiles.load()[name]) { res.statusCode = 404; return res.end(JSON.stringify({ error: "perfil não existe" })); }
    settings.save({ profile: name });
    session = null; lastInit = null; // conta nova = conversa nova
    profiles.authStatus(name).then((auth) => {
      emit({ kind: "status", message: `conta: ${profiles.get(name).label}${auth.loggedIn ? "" : " (SEM LOGIN — rode o comando de login)"}` });
      res.end(JSON.stringify({ ok: true, profile: name, auth, loginCommand: profiles.loginCommand(name) }));
    }).catch((error) => responderErroInterno(res, error));
    return;
  }

  if (url.pathname === "/profiles/add") {
    try {
      const q = url.searchParams;
      const name = profiles.slugDeConta(q.get("name") || "");
      const p = profiles.addProfile({
        name, label: q.get("label"),
        provider: q.get("provider") || "claude",
        authMode: q.get("authMode") || "assinatura",
        model: q.get("model") || undefined,
        endpoint: q.get("endpoint") || undefined,
      });
      return res.end(JSON.stringify({ ok: true, profile: p, loginCommand: profiles.loginCommand(p.name) }));
    } catch (e) { res.statusCode = 400; return res.end(JSON.stringify({ error: String(e.message || e) })); }
  }

  if (url.pathname === "/settings" && req.method === "GET") {
    return res.end(JSON.stringify({ ok: true, settings: settings.load() }));
  }
  if (url.pathname === "/settings" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const patch = JSON.parse(body || "{}");
        const allowed = {};
        for (const k of ["model", "effort", "profile", "provider", "voice", "image"]) if (k in patch) allowed[k] = patch[k];
        const before = settings.load().provider;
        const saved = settings.save(allowed);
        if (allowed.provider && allowed.provider !== before) { session = null; lastInit = null; } // cérebro novo = conversa nova
        return res.end(JSON.stringify({ ok: true, settings: saved }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: String(e).slice(0, 200) })); }
    });
    return;
  }

  if (url.pathname === "/chat" && req.method === "POST") {
    if (busy) { res.statusCode = 429; return res.end(JSON.stringify({ error: "ocupado — cancele ou aguarde o turno atual" })); } // rejeição rápida, best-effort (checagem de verdade é a de baixo)
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // checagem+set atômica: mesmo tick síncrono de startTurn's busy=true, sem brecha de TOCTOU
      // entre o momento em que o header chegou e o corpo terminou de ler (outro request pode ter
      // ficado busy nesse meio-tempo).
      if (busy) { res.statusCode = 429; return res.end(JSON.stringify({ error: "ocupado — cancele ou aguarde o turno atual" })); }
      try {
        const j = JSON.parse(body || "{}");
        const message = String(j.message || "").slice(0, MSG_MAX);
        if (!message.trim()) { res.statusCode = 400; return res.end(JSON.stringify({ error: "mensagem vazia" })); }
        startTurn(message, res, !!j.wait); // wait=true: responde só no fim (test.sh/fallback)
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: String(e).slice(0, 200) })); }
    });
    return;
  }

  // ---------- Brief Criativo (spec v2 §5) — mesmo código dos botões E do agente ----------
  if (url.pathname === "/brief/generate" && req.method === "POST") {
    if (busy) { res.statusCode = 429; return res.end(JSON.stringify({ error: "ocupado — aguarde o turno atual" })); } // rejeição rápida, best-effort (checagem de verdade é a de baixo)
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      // checagem+set atômica: mesmo tick síncrono, sem brecha de TOCTOU entre o header e o fim do corpo
      if (busy) { res.statusCode = 429; return res.end(JSON.stringify({ error: "ocupado — aguarde o turno atual" })); }
      busy = true; busySince = Date.now();
      const inicioBrief = busySince;
      iniciarAtividadeResumo(inicioBrief);
      let myChild = null; // child DESTE turno — nunca zerar o `child` global se já pertencer a um turno mais novo
      try {
        const j = JSON.parse(body || "{}");
        const info = await briefing.activeProjectInfo();
        const slug = lembrarSlug(j.slug || briefing.projectSlug(info.path));
        let segments;
        if (j.source === "csv") segments = briefing.parseCsv(String(j.csv || ""));
        else {
          const ws = String(j.workspace || slug).toLowerCase().replace(/[^a-z0-9-]/g, "");
          if (!/^[a-z0-9]/.test(ws)) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: "nome do workspace inválido" }));
          }
          // Convenção real: workspaces/<ws>/transcript/ dentro da pasta do usuário,
          // arquivos nomeados pelo master (ex.: FX3-1_6898.corrected.json), múltiplos
          // masters por workspace possíveis — briefing.resolveTranscript escolhe o
          // *.corrected.json mais recente; sem corrected, cai pro *.whisper.json mais recente.
          const transcriptDir = path.join(workspaceDir(ws), "transcript");
          const { file: cand } = briefing.resolveTranscript(transcriptDir);
          const rawTranscript = JSON.parse(fs.readFileSync(cand, "utf8"));
          // corrected.json guarda a fala em text_corrected/text_original, não em text
          // (parseTranscript espera text) — normaliza aqui, não no parser genérico.
          if (Array.isArray(rawTranscript.segments)) {
            rawTranscript.segments = rawTranscript.segments.map((s) => (s && s.text == null && (s.text_corrected != null || s.text_original != null))
              ? { ...s, text: s.text_corrected != null ? s.text_corrected : s.text_original } : s);
          }
          segments = briefing.parseTranscript(rawTranscript, info.fps);
        }
        if (!segments.length) throw new Error("nenhum trecho válido na fonte (CSV vazio/formato inesperado?)");
        const cfg = settings.load();
        const prof = profiles.get(cfg.profile);
        const r = await briefing.generate({
          segments, providerName: prof.provider || "claude",
          env: profiles.envFor(cfg.profile), cwd: agentCwd(), model: prof.model || cfg.model || undefined,
          onStatus: (m) => emit({ kind: "status", message: m }),
          onChild: (c) => { myChild = c; child = c; }, // registra no `child` global — /cancel e /new agora conseguem matar este turno também
        });
        briefing.saveBrief(slug, { generatedAt: new Date().toISOString(), projectPath: info.path,
          fps: info.fps, segments, brief: r.brief, trechos: r.trechos, unmatched: r.unmatched, semResposta: r.semResposta });
        telemetria.evento("brief_generate", { ok: true, trechos: r.trechos.length, semResposta: r.semResposta, unmatched: r.unmatched });
        emit({ kind: "status", message: `brief pronto: ${r.trechos.length} trechos` });
        res.end(JSON.stringify({ ok: true, slug, tema: r.brief.tema_identificado, musica: r.brief.musica_global,
          trechos: r.trechos, unmatched: r.unmatched, semResposta: r.semResposta }));
      } catch (e) {
        telemetria.evento("brief_generate", { ok: false, erro: String(e.message) });
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(e.message), raw: e.raw ? String(e.raw).slice(0, 2000) : undefined }));
      } finally {
        concluirAtividadeResumo(inicioBrief);
        if (child === myChild) { busy = false; child = null; }
      } // done tardio pós-cancel não derruba o busy de um turno novo
    });
    return;
  }

  if (url.pathname === "/brief" && req.method === "GET") {
    briefing.activeProjectInfo().then((info) => {
      const slug = lembrarSlug(briefing.projectSlug(info.path));
      const data = briefing.loadBrief(slug);
      if (!data) { res.statusCode = 404; return res.end(JSON.stringify({ error: "nenhum brief salvo para este projeto" })); }
      res.end(JSON.stringify({ ok: true, slug, data }));
    }).catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message) })); });
    return;
  }

  // NOTA (Task 12, convenção __result — ver comentário em lib/briefing.js): extendscript()
  // resolve com o TEXTO JSON de __result({...}) — nunca prefixo tipo "ok:"/"erro:". Os 3
  // endpoints abaixo sempre fazem JSON.parse(r) e conferem `.error` (condição de negócio,
  // ex. sem sequência ativa) antes de ler o campo de sucesso.
  if (url.pathname === "/brief/markers" && req.method === "POST") {
    briefing.activeProjectInfo().then(async (info) => {
      const slug = lembrarSlug(briefing.projectSlug(info.path));
      const data = briefing.loadBrief(slug);
      if (!data) throw new Error("gere um brief antes de plantar markers");
      const markers = briefing.buildMarkers(data.trechos);
      const r = await premiere.extendscript(briefing.plantScript(markers));
      const parsed = JSON.parse(r);
      if (parsed.error) throw new Error("plantar markers falhou: " + parsed.error);
      telemetria.evento("brief_markers", { plantados: parsed.planted });
      res.end(JSON.stringify({ ok: true, planted: parsed.planted }));
    }).catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message) })); });
    return;
  }

  if (url.pathname === "/brief/markers/clear" && req.method === "POST") {
    premiere.extendscript(briefing.clearScript()).then((r) => {
      const parsed = JSON.parse(r);
      if (parsed.error) throw new Error(parsed.error);
      res.end(JSON.stringify({ ok: true, removed: parsed.removed }));
    }).catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message) })); });
    return;
  }

  if (url.pathname === "/brief/goto") {
    const tc = url.searchParams.get("tc") || "";
    if (!/^\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2}$/.test(tc)) { // valida ANTES de tocar no bridge
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "timecode inválido (use HH:MM:SS:FF)" }));
    }
    premiere.extendscript(briefing.gotoScript(tc)).then((r) => {
      const parsed = JSON.parse(r);
      res.end(JSON.stringify({ ok: !!parsed.ok, result: parsed }));
    }).catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message) })); });
    return;
  }

  // ---------- Auto Zoom (spec v2 §6) ----------
  function azSlug() { return briefing.activeProjectInfo().then((i) => lembrarSlug(briefing.projectSlug(i.path))); }
  function jsonBody(req2, cb) {
    let b = ""; req2.on("data", (c) => (b += c));
    req2.on("end", () => { try { cb(JSON.parse(b || "{}")); } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: "JSON inválido" })); } });
  }
  const azFail = (e) => { res.statusCode = 500; res.end(JSON.stringify({ error: String(e.message) })); };

  if (url.pathname === "/autozoom" && req.method === "GET") {
    azSlug().then((slug) => res.end(JSON.stringify({ ok: true, slug, ...autozoom.store(slug) }))).catch(azFail);
    return;
  }
  if (url.pathname === "/autozoom/camera" && req.method === "POST") {
    Promise.all([azSlug(), multicam.getProjectSelection()]).then(([slug, cam]) => {
      if (cam.isSequence) throw new Error("selecione o ARQUIVO bruto da câmera no painel Projeto, não uma sequência");
      autozoom.saveStore(slug, { camera: cam });
      emit({ kind: "status", message: `câmera-alvo: ${cam.name}` });
      res.end(JSON.stringify({ ok: true, camera: cam }));
    }).catch(azFail);
    return;
  }
  if (url.pathname === "/autozoom/presets/learn" && req.method === "POST") {
    jsonBody(req, (j) => {
      Promise.all([azSlug(), autozoom.learnFromSelectedClip()]).then(([slug, learned]) => {
        const st = autozoom.store(slug);
        const id = j.id || "z" + (st.presets.reduce((m, p) => Math.max(m, Number(String(p.id).replace(/\D/g, "")) || 0), 0) + 1);
        const presets = [...st.presets.filter((p) => p.id !== id), { id, ...learned }];
        autozoom.saveStore(slug, { presets });
        res.end(JSON.stringify({ ok: true, preset: { id, ...learned }, presets }));
      }).catch(azFail);
    });
    return;
  }
  if (url.pathname === "/autozoom/presets/update" && req.method === "POST") {
    jsonBody(req, (j) => {
      azSlug().then((slug) => {
        const st = autozoom.store(slug);
        const presets = st.presets.map((p) => p.id === j.id ? { ...p, scale: Number(j.scale) } : p);
        autozoom.saveStore(slug, { presets });
        res.end(JSON.stringify({ ok: true, presets }));
      }).catch(azFail);
    });
    return;
  }
  if (url.pathname === "/autozoom/presets/delete" && req.method === "POST") {
    jsonBody(req, (j) => {
      azSlug().then((slug) => {
        const presets = autozoom.store(slug).presets.filter((p) => p.id !== j.id);
        autozoom.saveStore(slug, { presets });
        res.end(JSON.stringify({ ok: true, presets }));
      }).catch(azFail);
    });
    return;
  }
  if (url.pathname === "/autozoom/push/learn" && req.method === "POST") {
    Promise.all([azSlug(), autozoom.learnFromSelectedClip()]).then(([slug, learned]) => {
      // compatibilidade com o comportamento do Zoomer (doc §3.9): nasce 115→135 com a Position atual
      const push = { start: { scale: 115, position: learned.position }, end: { scale: 135, position: learned.position } };
      autozoom.saveStore(slug, { push });
      res.end(JSON.stringify({ ok: true, push }));
    }).catch(azFail);
    return;
  }
  if (url.pathname === "/autozoom/push/update" && req.method === "POST") {
    jsonBody(req, (j) => {
      azSlug().then((slug) => {
        const st = autozoom.store(slug);
        if (!st.push) throw new Error("crie o push antes de editar");
        const push = { start: { ...st.push.start, ...(j.start || {}) }, end: { ...st.push.end, ...(j.end || {}) } };
        autozoom.saveStore(slug, { push });
        res.end(JSON.stringify({ ok: true, push }));
      }).catch(azFail);
    });
    return;
  }
  if (url.pathname === "/autozoom/push/delete" && req.method === "POST") {
    azSlug().then((slug) => { autozoom.saveStore(slug, { push: null }); res.end(JSON.stringify({ ok: true })); }).catch(azFail);
    return;
  }
  if (url.pathname === "/autozoom/analyze" && req.method === "GET") {
    autozoom.analyze().then((r) => res.end(JSON.stringify({ ok: true, ...r }))).catch(azFail);
    return;
  }
  if (url.pathname === "/autozoom/apply" && req.method === "POST") {
    if (busy) { res.statusCode = 429; return res.end(JSON.stringify({ error: "ocupado — aguarde o turno atual" })); } // rejeição rápida, best-effort (checagem de verdade é a de baixo)
    jsonBody(req, (j) => {
      // checagem+set atômica: mesmo tick síncrono, sem brecha de TOCTOU entre o header e o fim do corpo —
      // um apply são até 300s de escrita no ES; um /chat ou segundo clique no meio dirigiria o Premiere em paralelo
      if (busy) { res.statusCode = 429; return res.end(JSON.stringify({ error: "ocupado — aguarde o turno atual" })); }
      // valida a janela ANTES de tocar no Premiere (mesmo formato/400 de /brief/goto) —
      // TC malformado viraria -1 no tcToSecs e a janela passaria a pegar a timeline inteira
      const tcOk = (tc) => tc == null || tc === "" || /^\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2}$/.test(tc);
      if (!tcOk(j.fromTc) || !tcOk(j.toTc)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: "fromTc/toTc inválido: use HH:MM:SS:FF" }));
      }
      busy = true; busySince = Date.now();
      iniciarAtividadeResumo(busySince);
      const myTurn = busySince; // apply não segura child: a posse do busy é o carimbo deste turno
      autozoom.apply({ redo: !!j.redo, fromTc: j.fromTc, toTc: j.toTc }).then((r) => {
        telemetria.evento("autozoom_apply", { ok: true, aplicados: r.applied, pulados: r.skipped, erros: r.errors, plano: r.report });
        emit({ kind: "status", message: `auto zoom: ${r.applied} aplicados, ${r.skipped} pulados, ${r.errors} erros` });
        res.end(JSON.stringify({ ok: true, ...r }));
      }).catch((e) => {
        telemetria.evento("autozoom_apply", { ok: false, erro: String(e.message) });
        azFail(e);
      })
        .finally(() => {
          concluirAtividadeResumo(myTurn);
          if (busySince === myTurn) busy = false;
        }); // release com posse: um apply tardio não derruba o busy de um turno mais novo (mesma disciplina do done de startTurn)
    });
    return;
  }

  res.statusCode = 404; res.end("{}");
}

server.on("error", (e) => {
  console.error(`[${NAME}] erro do server: ${e.code || e.message}`);
  process.exit(1); // launchd (KeepAlive on-crash + ThrottleInterval) tenta de novo em 10s
});

// Auto-restart quando o código muda (só sob launchd: MEDIUM_LATENS_SERVICE=1 no plist).
// Sai com código ≠0 → KeepAlive {SuccessfulExit:false} religa com a versão nova.
if (process.env.MEDIUM_LATENS_SERVICE === "1") {
  const watched = [__filename, ...fs.readdirSync(path.join(__dirname, "lib")).map((f) => path.join(__dirname, "lib", f))];
  for (const f of watched) {
    fs.watchFile(f, { interval: 5000 }, () => {
      console.log(`[${NAME}] código atualizado (${path.basename(f)}) — reiniciando via launchd`);
      process.exit(64);
    });
  }
}

server.listen(PORT, "127.0.0.1", () => {
  const cfg = settings.load();
  console.log(`[${NAME}] ouvindo em http://127.0.0.1:${PORT} — perfil ${cfg.profile}, modelo ${cfg.model || "padrão (Max)"}`);
});
