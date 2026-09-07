"use strict";
/**
 * lib/profiles.js — perfis multi-provider (v2, spec 2026-08-18).
 * Perfil = { label, provider: "claude"|"codex"|"gemini", authMode: "assinatura"|"api-key",
 *            homeDir, model?, endpoint?, envKey? }.
 * Isolamento multi-conta por diretório de config: CLAUDE_CONFIG_DIR (claude),
 * CODEX_HOME (codex), GEMINI_CLI_HOME (gemini — doc T1 V7: confirmado que isola de
 * verdade o ~/.gemini real, achado via grep no bundle; o brief original presumia "sem
 * var equivalente"). Atenção V7: uma sessão OAuth já cacheada dentro do diretório
 * isolado tem precedência sobre GEMINI_API_KEY — perfis gemini api-key precisam de um
 * homeDir criado do zero (addProfile já garante isso).
 * OpenRouter NÃO é provider de código: é perfil codex com endpoint + envKey
 * (config.toml do homeDir declara o model_provider custom, wire_api = "responses" —
 * "chat" foi removido na 0.147.0, doc T1 V6).
 * Segredos: keys vêm do process.env do servidor (.env do usuário) ou da credencial
 * persistida pelo assistente; envFor limita o filho às chaves de recurso documentadas
 * e à autenticação exigida pelo perfil ativo.
 * Migração automática do schema v1
 * ({label, configDir}) na leitura.
 * Auth codex api-key (doc T1 V3): OPENAI_API_KEY solta no ambiente NÃO autentica —
 * o Codex CLI guarda auth em CODEX_HOME/auth.json e só aceita a key via
 * `codex login --with-api-key` (lida do stdin). Por isso loginCommand devolve um
 * comando one-time para codex+api-key (sem endpoint custom) e authStatus consulta
 * `codex login status` de verdade em vez de só checar a env var. OpenRouter
 * (codex+endpoint) segue o mecanismo env_key do config.toml — sem login.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const win = require("./win");
const { execFileCli } = win;
const credentials = require("./credentials");
const { FILES, ensurePrivateDir, ensureUserDir } = require("./paths");

const FILE = process.env.MEDIUM_LATENS_PROFILES_FILE || FILES.profiles;
const MCP_CONFIG = process.env.MEDIUM_LATENS_MCP_CONFIG || FILES.mcpConfig;

const PROVIDERS = {
  claude: { cli: "claude", homeVar: "CLAUDE_CONFIG_DIR", apiKeyVar: "ANTHROPIC_API_KEY" },
  codex:  { cli: "codex",  homeVar: "CODEX_HOME",        apiKeyVar: "OPENAI_API_KEY" },
  gemini: { cli: "gemini", homeVar: "GEMINI_CLI_HOME",   apiKeyVar: "GEMINI_API_KEY" },
};

// TUDO que decide auth em QUALQUER CLI — scrub total; envFor injeta só o que o perfil exige.
const AUTH_VARS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR", "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CONFIG_DIR",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR",
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME",
  "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_GENAI_USE_VERTEXAI",
  "GEMINI_CLI_HOME",
  "OPENROUTER_API_KEY",
];

const CHILD_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG",
  "LC_ALL", "LC_CTYPE", "TMPDIR", "TEMP", "TMP",
  "SystemRoot", "ComSpec", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "ProgramFiles",
  "GEMINI_API_KEY", "ELEVENLABS_API_KEY",
]);
const CHILD_ENV_CANONICAL = new Map([...CHILD_ENV_KEYS].map((key) => [key.toLowerCase(), key]));

const DEFAULTS = { padrao: { label: "Conta do CLI (~/.claude)", provider: "claude", authMode: "assinatura", homeDir: null } };
let avisouIdInvalido = false;

function expand(p) { return p ? p.replace(/^~(?=\/|$)/, os.homedir()) : p; }

function migrate(p) {
  if (p.provider) return p;
  return { label: p.label, provider: "claude", authMode: "assinatura", homeDir: p.configDir || null };
}

function validarId(id) {
  return credentials.validarId(id, "perfil");
}

function slugDeConta(nome) {
  if (typeof nome !== "string") return "";
  return nome.trim().normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (j && typeof j.profiles === "object" && Object.keys(j.profiles).length) {
      const out = Object.create(null);
      for (const [k, v] of Object.entries(j.profiles)) {
        if (!credentials.idValido(k)) {
          if (!avisouIdInvalido) {
            console.error("Aviso: perfil com identificador inválido ignorado.");
            avisouIdInvalido = true;
          }
          continue;
        }
        out[k] = migrate(v);
      }
      if (Object.keys(out).length) return out;
    }
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function save(profiles) {
  for (const id of Object.keys(profiles)) validarId(id);
  ensureUserDir();
  fs.writeFileSync(FILE, JSON.stringify({ profiles }, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(FILE, 0o600);
}

function get(name) {
  if (!credentials.idValido(name)) return { name: "padrao", ...DEFAULTS.padrao };
  const all = load();
  return all[name] ? { name, ...all[name] } : { name: "padrao", ...DEFAULTS.padrao };
}

function keyVarFor(p) {
  if (p.endpoint) return p.envKey || "OPENROUTER_API_KEY";
  return (PROVIDERS[p.provider] || PROVIDERS.claude).apiKeyVar;
}

function savedKeyFor(p) {
  if (!p.credencialId) return null;
  const credencial = credentials.get(p.credencialId);
  return credencial && credencial.key ? credencial.key : null;
}

function allowlistedEnv(source, extra, platform = process.platform) {
  const input = source || process.env;
  const e = {};
  for (const [key, value] of Object.entries(input)) {
    const canonical = platform === "win32"
      ? CHILD_ENV_CANONICAL.get(key.toLowerCase())
      : (CHILD_ENV_KEYS.has(key) ? key : null);
    if (canonical) {
      e[canonical] = value;
    } else if (key.startsWith("MEDIUM_LATENS_") || key.startsWith("ELEVENLABS_VOICE_")) {
      e[key] = value;
    }
  }
  return Object.assign(e, extra || {});
}

/** Env mínimo p/ o CLI filho, mais somente a autenticação do perfil ativo. */
function envFor(name, extra) {
  const e = allowlistedEnv();
  const p = get(name);
  const prov = PROVIDERS[p.provider] || PROVIDERS.claude;
  const geminiResourceKey = e.GEMINI_API_KEY;
  for (const key of AUTH_VARS) delete e[key];
  if (p.provider !== "gemini" && geminiResourceKey !== undefined) {
    e.GEMINI_API_KEY = geminiResourceKey;
  }
  if (p.homeDir && prov.homeVar) e[prov.homeVar] = expand(p.homeDir);
  if (p.authMode === "api-key") {
    const kv = keyVarFor(p);
    const val = process.env[kv] || savedKeyFor(p);
    if (!val) {
      const err = new Error(`perfil "${p.name}" sem credencial; configure a conta no painel ou adicione ${kv} ao .env do usuário`);
      err.code = "MISSING_KEY";
      throw err;
    }
    e[kv] = val;
  }
  return Object.assign(e, extra || {});
}

function detalheFalha(error) {
  return String(error && error.message || error).slice(0, 160);
}

function probeAuth(cli, args, opts, mapear, executar) {
  return new Promise((resolve) => {
    try {
      executar(cli, args, opts, (err, stdout, stderr) => resolve(mapear(err, stdout, stderr)));
    } catch (error) {
      resolve({ loggedIn: false, detail: detalheFalha(error) });
    }
  });
}

/** Status de login por provider (sem segredos; timeout curto). */
function authStatus(name, executar = execFileCli) {
  const p = get(name);
  if (p.authMode === "api-key") {
    const kv = keyVarFor(p);
    const hasKey = !!(process.env[kv] || savedKeyFor(p));
    // codex + api-key SEM endpoint custom: a key só autentica de verdade depois de
    // `codex login --with-api-key` gravar em CODEX_HOME/auth.json (doc T1 V3) — checar
    // só a presença da env var mentiria "logado" para um CODEX_HOME que devolveria 401.
    if (p.provider === "codex" && !p.endpoint) {
      if (!hasKey) return Promise.resolve({ loggedIn: false, detail: `falta ${kv} no .env` });
      return probeAuth("codex", ["login", "status"], { env: envFor(name), timeout: 15000 },
        (err, stdout, stderr) => {
          const out = String(stdout || "") + String(stderr || "");
          return { loggedIn: !err, detail: out.trim().slice(0, 160) || (err ? "sem login" : "logado") };
        }, executar);
    }
    // OpenRouter (codex+endpoint) e gemini/claude api-key: mecanismo env_key/direto,
    // sem passo de login separado. A key pode vir do .env ou do assistente.
    return Promise.resolve({ loggedIn: hasKey, detail: hasKey ? `api-key (${kv})` : `falta ${kv} no .env` });
  }
  if (p.provider === "claude") {
    return probeAuth("claude", ["auth", "status", "--json"], { env: envFor(name), timeout: 15000 },
      (err, stdout) => {
        try { return JSON.parse(stdout); }
        catch { return { loggedIn: false, detail: err ? String(err).slice(0, 120) : "sem resposta" }; }
      }, executar);
  }
  if (p.provider === "codex") {
    return probeAuth("codex", ["login", "status"], { env: envFor(name), timeout: 15000 },
      (err, stdout, stderr) => {
        const out = String(stdout || "") + String(stderr || "");
        return { loggedIn: !err, detail: out.trim().slice(0, 160) || (err ? "sem login" : "logado") };
      }, executar);
  }
  // gemini assinatura: credencial OAuth em <homeDir>/.gemini quando isolado via
  // GEMINI_CLI_HOME (doc T1 V7), senão no ~/.gemini padrão do usuário.
  const geminiHome = p.homeDir ? expand(p.homeDir) : os.homedir();
  const cred = path.join(geminiHome, ".gemini", "oauth_creds.json");
  return Promise.resolve({ loggedIn: fs.existsSync(cred), detail: fs.existsSync(cred) ? "OAuth ~/.gemini" : "rode `gemini` 1× no Terminal para logar" });
}

/** Comando de login 1× (ação do DONO). null = não há passo de login separado. */
function loginCommand(name) {
  const p = get(name);
  if (p.authMode === "api-key") {
    // codex + api-key SEM endpoint custom: único caminho confirmado (doc T1 V3) para
    // autenticar um CODEX_HOME descartável — a key entra via stdin de `codex login
    // --with-api-key`, não como env var solta. OpenRouter (codex+endpoint), gemini e
    // claude em api-key não têm passo de login: usam a key direto por chamada.
    if (p.provider === "codex" && !p.endpoint && !p.credencialId) {
      return `printf '%s' "$OPENAI_API_KEY" | CODEX_HOME="${expand(p.homeDir)}" codex login --with-api-key`;
    }
    return null;
  }
  if (p.provider === "claude") {
    if (!p.homeDir) return "claude auth login  # perfil padrão usa o login do CLI";
    return `CLAUDE_CONFIG_DIR="${expand(p.homeDir)}" claude auth login`;
  }
  if (p.provider === "codex") return `CODEX_HOME="${expand(p.homeDir)}" codex login`;
  if (!p.homeDir) return "gemini  # login interativo no primeiro uso";
  return `GEMINI_CLI_HOME="${expand(p.homeDir)}" gemini  # login interativo isola a conta (doc T1 V7)`;
}

/**
 * config.toml do perfil codex: MCP (fonte única: mcp-config.json) + provider custom.
 * Formato confirmado no doc T1 V5/V6: model/model_provider na raiz (antes de qualquer
 * [table]), [model_providers.openrouter] com wire_api = "responses" ("chat" foi
 * removido na 0.147.0), [mcp_servers.<nome>] e um bloco SEPARADO
 * [mcp_servers.<nome>.env] para as env vars (validado via `codex mcp list --json`).
 */
function codexToml(p) {
  const mcp = JSON.parse(fs.readFileSync(MCP_CONFIG, "utf8")).mcpServers["premiere-pro"];
  const lines = [];
  if (p.model) lines.push(`model = ${JSON.stringify(p.model)}`);
  if (p.endpoint) lines.push(`model_provider = "openrouter"`);
  if (p.model || p.endpoint) lines.push("");
  if (p.endpoint) {
    lines.push(
      `[model_providers.openrouter]`,
      `name = "OpenRouter"`,
      `base_url = ${JSON.stringify(p.endpoint)}`,
      `env_key = ${JSON.stringify(p.envKey || "OPENROUTER_API_KEY")}`,
      `wire_api = "responses"`,
      "");
  }
  lines.push(
    `[mcp_servers.premiere-pro]`,
    `command = ${JSON.stringify(mcp.command)}`,
    `args = ${JSON.stringify(mcp.args)}`,
    "",
    `[mcp_servers.premiere-pro.env]`);
  for (const [k, v] of Object.entries(mcp.env || {})) lines.push(`${k} = ${JSON.stringify(v)}`);
  return lines.join("\n") + "\n";
}

function addProfile(opts) {
  const { name, label, provider: prov, authMode, model, endpoint, credencialId, homeDirBase } = opts;
  // name ausente/não-string já gerou um perfil-lixo ("object-object" via String([object Object]))
  if (typeof name !== "string" || !name.trim()) throw new Error("nome do perfil obrigatório");
  validarId(name);
  if (!PROVIDERS[prov]) throw new Error(`provider inválido: ${prov}`);
  if (authMode !== "assinatura" && authMode !== "api-key") throw new Error(`authMode inválido: ${authMode}`);
  const all = load();
  const slug = name;
  const base = homeDirBase || "~/.medium-latens-profiles";
  const p = { label: label || name, provider: prov, authMode, homeDir: `${base}/${slug}` };
  if (model) p.model = model;
  if (credencialId) p.credencialId = credencialId;
  if (endpoint) { p.endpoint = endpoint; p.envKey = "OPENROUTER_API_KEY"; p.authMode = "api-key"; }
  const home = expand(p.homeDir);
  ensurePrivateDir(home);
  all[slug] = p;
  save(all);
  if (prov === "codex") {
    const configFile = path.join(home, "config.toml");
    fs.writeFileSync(configFile, codexToml(p), { mode: 0o600 });
    fs.chmodSync(configFile, 0o600);
  }
  return { name: slug, ...p };
}

function addFromCredential(publico, label) {
  const providerMap = { anthropic: "claude", openai: "codex", compativel: "codex" };
  const prov = providerMap[publico && publico.provider];
  if (!prov) throw new Error("provedor da credencial inválido");
  return addProfile({
    name: publico.id,
    label: label || publico.id,
    provider: prov,
    authMode: "api-key",
    model: publico.model || undefined,
    endpoint: publico.provider === "compativel" ? (publico.endpoint || undefined) : undefined,
    credencialId: publico.id,
  });
}

function loginComChave(name, key, spawn = win.spawnCli) {
  const perfil = get(name);
  if (perfil.provider !== "codex" || perfil.endpoint) {
    return Promise.resolve({ ok: true, pulado: true });
  }

  return new Promise((resolve) => {
    let concluido = false;
    let limite;
    let filho;
    const concluir = (ok) => {
      if (concluido) return;
      concluido = true;
      if (limite) clearTimeout(limite);
      resolve({ ok });
    };

    try {
      filho = spawn("codex", ["login", "--with-api-key"], {
        env: envFor(name),
        stdio: ["pipe", "ignore", "ignore"],
      });
      if (!filho || !filho.stdin || typeof filho.stdin.write !== "function") {
        concluir(false);
        return;
      }
      filho.once("error", () => concluir(false));
      filho.once("close", (codigo) => concluir(codigo === 0));
      if (typeof filho.stdin.once === "function") filho.stdin.once("error", () => concluir(false));
      limite = setTimeout(() => {
        try {
          if (filho && typeof filho.kill === "function") filho.kill();
        } catch {}
        concluir(false);
      }, 30000);
      if (typeof limite.unref === "function") limite.unref();
      filho.stdin.write(key);
      filho.stdin.end();
    } catch (_erro) {
      concluir(false);
    }
  });
}

function startLogin(id, providerName) {
  if (providerName !== "claude" && providerName !== "codex") throw new Error("provedor de assinatura inválido");
  if (typeof id !== "string" || !id.trim()) throw new Error("nome do perfil obrigatório");
  const slug = validarId(id);
  const todos = load();
  const existente = Object.prototype.hasOwnProperty.call(todos, slug) ? todos[slug] : null;
  const perfil = existente
    ? { name: slug, ...existente }
    : addProfile({ name: id, label: id, provider: providerName, authMode: "assinatura" });
  if (perfil.provider !== providerName || perfil.authMode !== "assinatura") {
    throw new Error("o nome já pertence a outra conta");
  }
  const args = providerName === "claude" ? ["auth", "login"] : ["login"];
  const filho = win.spawnCli(PROVIDERS[providerName].cli, args, {
    env: envFor(perfil.name),
    detached: true,
    stdio: "ignore",
  });
  if (filho && typeof filho.unref === "function") filho.unref();
  return { pid: filho && filho.pid, name: perfil.name };
}

function remove(name) {
  if (!credentials.idValido(name)) return false;
  const all = load();
  if (!all[name]) return false;
  delete all[name];
  save(all);
  return true;
}

/** Detecção de CLI instalado (cache 60s) — /health e /providers. */
let cliCache = null, cliCacheAt = 0;
function probeCli(cli, executar = execFileCli) {
  return new Promise((resolve) => {
    try {
      executar(cli, ["--version"], { env: allowlistedEnv(), timeout: 8000 }, (err, stdout) => {
        resolve(err ? { installed: false } : { installed: true, version: String(stdout).trim().slice(0, 40) });
      });
    } catch (_error) {
      resolve({ installed: false });
    }
  });
}

function cliStatus(executar = execFileCli) {
  if (cliCache && Date.now() - cliCacheAt < 60000) return Promise.resolve(cliCache);
  return Promise.all([
    probeCli("claude", executar), probeCli("codex", executar), probeCli("gemini", executar),
  ]).then(([claude, codex, gemini]) => {
    cliCache = { claude, codex, gemini }; cliCacheAt = Date.now();
    return cliCache;
  });
}

module.exports = {
  load, get, envFor, authStatus, loginCommand, addProfile, addFromCredential,
  loginComChave, startLogin, remove, cliStatus, probeCli, allowlistedEnv, validarId,
  slugDeConta, savedKeyFor, PROVIDERS, AUTH_VARS,
};
