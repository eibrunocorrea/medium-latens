"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");

// aponta o profiles.js para um profiles.json de teste ANTES do require
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-test-"));
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = TMP;
const PFILE = path.join(TMP, "profiles.json");
const MCPFILE = path.join(TMP, "mcp-config.json");
const CREDENTIALS_FILE = path.join(TMP, "credentials.json");
fs.writeFileSync(MCPFILE, JSON.stringify({ mcpServers: { "premiere-pro": { command: "npx", args: ["premiere-pro-mcp"], env: {} } } }));
process.env.MEDIUM_LATENS_USER_DIR = TMP;
process.env.MEDIUM_LATENS_PROFILES_FILE = PFILE;
process.env.MEDIUM_LATENS_MCP_CONFIG = MCPFILE;
const profiles = require("../lib/profiles");
const credentials = require("../lib/credentials");
const BITS_POSIX = process.platform !== "win32"; // NTFS não expõe bits de modo; a proteção vem da ACL do perfil do usuário

test.after(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
});

function writeProfiles(obj) { fs.writeFileSync(PFILE, JSON.stringify({ profiles: obj }, null, 2)); }

test("migração v1 → v2: configDir vira homeDir, provider claude, assinatura", () => {
  writeProfiles({ trabalho: { label: "Trabalho", configDir: "~/.claude-profiles/trabalho" } });
  const p = profiles.get("trabalho");
  assert.equal(p.provider, "claude");
  assert.equal(p.authMode, "assinatura");
  assert.equal(p.homeDir, "~/.claude-profiles/trabalho");
});

test("load ignora um id legado inválido sem descartar os perfis válidos", () => {
  writeProfiles({
    primeira: { label: "Primeira", provider: "claude", authMode: "assinatura", homeDir: null },
    "Conta Rota": { label: "Legada", provider: "codex", authMode: "api-key", homeDir: null },
    segunda: { label: "Segunda", provider: "gemini", authMode: "assinatura", homeDir: null },
  });
  const original = console.error;
  const avisos = [];
  console.error = (...args) => avisos.push(args.join(" "));
  try {
    const carregados = profiles.load();
    const carregadosNovamente = profiles.load();
    assert.deepEqual(Object.keys(carregados), ["primeira", "segunda"]);
    assert.deepEqual(Object.keys(carregadosNovamente), ["primeira", "segunda"]);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /perfil.*inválido.*ignorado/i);
  } finally {
    console.error = original;
  }
});

test("leituras de referência legada inválida não lançam", () => {
  assert.equal(profiles.savedKeyFor({ credencialId: "Conta Rota" }), null);
  assert.equal(profiles.remove("Conta Rota"), false);
});

test("envFor claude assinatura: allowlist + CLAUDE_CONFIG_DIR", () => {
  writeProfiles({ max: { label: "Max", provider: "claude", authMode: "assinatura", homeDir: "~/.claude-profiles/max" } });
  process.env.ANTHROPIC_API_KEY = "vazaria";
  process.env.OPENAI_API_KEY = "vazaria2";
  process.env.GEMINI_API_KEY = "vazaria3";
  const e = profiles.envFor("max");
  assert.equal(e.ANTHROPIC_API_KEY, undefined);
  assert.equal(e.OPENAI_API_KEY, undefined);
  assert.equal(e.GEMINI_API_KEY, "vazaria3");
  assert.ok(e.CLAUDE_CONFIG_DIR.endsWith("/.claude-profiles/max"));
  assert.equal(e.CODEX_HOME, undefined);
});

test("envFor usa allowlist e não entrega variável arbitrária ao filho", () => {
  writeProfiles({ max: { label: "Max", provider: "claude", authMode: "assinatura", homeDir: null } });
  const userenv = require("../lib/userenv");
  const envFile = path.join(TMP, "child-allowlist.env");
  const original = {};
  const values = {
    PATH: process.env.PATH || "/usr/bin",
    GEMINI_API_KEY: "gemini-" + "teste",
    ELEVENLABS_API_KEY: "eleven-" + "teste",
    ELEVENLABS_VOICE_PRINCIPAL: "voz-teste",
    MEDIUM_LATENS_IMAGE_PIPELINE: "/pipeline/teste",
  };
  for (const [name, value] of Object.entries(values)) {
    original[name] = process.env[name];
  }
  original.MINHA_VARIAVEL_SECRETA = process.env.MINHA_VARIAVEL_SECRETA;
  delete process.env.MINHA_VARIAVEL_SECRETA;
  delete process.env.GEMINI_API_KEY;
  fs.writeFileSync(envFile, "MINHA_VARIAVEL_SECRETA=x\n" + "GEMINI_API_KEY=gemini-" + "teste\n");
  userenv.load(process.env, envFile);
  process.env.ELEVENLABS_API_KEY = values.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_VOICE_PRINCIPAL = values.ELEVENLABS_VOICE_PRINCIPAL;
  process.env.MEDIUM_LATENS_IMAGE_PIPELINE = values.MEDIUM_LATENS_IMAGE_PIPELINE;
  try {
    const e = profiles.envFor("max");
    assert.equal(e.MINHA_VARIAVEL_SECRETA, undefined);
    assert.equal(e.PATH, values.PATH);
    assert.equal(e.GEMINI_API_KEY, values.GEMINI_API_KEY);
    assert.equal(e.ELEVENLABS_API_KEY, values.ELEVENLABS_API_KEY);
    assert.equal(e.ELEVENLABS_VOICE_PRINCIPAL, values.ELEVENLABS_VOICE_PRINCIPAL);
    assert.equal(e.MEDIUM_LATENS_IMAGE_PIPELINE, values.MEDIUM_LATENS_IMAGE_PIPELINE);
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("geradores de mídia usam a mesma allowlist central", () => {
  for (const file of ["image.mjs", "voice.mjs"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "genai", file), "utf8");
    assert.match(source, /profiles\.allowlistedEnv/);
    assert.doesNotMatch(source, /userenv\.load\(process\.env/);
  }
});

test("allowlist normaliza Path do Windows para PATH", () => {
  const value = "C:\\Windows\\System32;C:\\Program Files\\nodejs";
  assert.equal(profiles.allowlistedEnv({ Path: value }, undefined, "win32").PATH, value);
});

test("allowlist não deixa path minúsculo substituir PATH no macOS", () => {
  const env = profiles.allowlistedEnv({ PATH: "/usr/bin", path: "/tmp/injetado" }, undefined, "darwin");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.path, undefined);
});

test("envFor codex assinatura: só CODEX_HOME", () => {
  writeProfiles({ gpt: { label: "GPT", provider: "codex", authMode: "assinatura", homeDir: "~/.medium-latens-profiles/gpt" } });
  const e = profiles.envFor("gpt");
  assert.ok(e.CODEX_HOME.endsWith("/.medium-latens-profiles/gpt"));
  assert.equal(e.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(e.OPENAI_API_KEY, undefined);
});

test("envFor gemini assinatura remove GEMINI_API_KEY do próprio perfil", () => {
  writeProfiles({ gem: { label: "Gemini", provider: "gemini", authMode: "assinatura", homeDir: "~/.medium-latens-profiles/gem" } });
  process.env.GEMINI_API_KEY = "recurso-de-imagem";
  const e = profiles.envFor("gem");
  assert.equal(e.GEMINI_API_KEY, undefined);
  assert.ok(e.GEMINI_CLI_HOME.endsWith("/.medium-latens-profiles/gem"));
});

test("envFor codex api-key: injeta SÓ OPENAI_API_KEY, do env do servidor", () => {
  writeProfiles({ gptk: { label: "GPT key", provider: "codex", authMode: "api-key", homeDir: "~/.medium-latens-profiles/gptk" } });
  process.env.OPENAI_API_KEY = "sk-test-123";
  const e = profiles.envFor("gptk");
  assert.equal(e.OPENAI_API_KEY, "sk-test-123");
  assert.equal(e.ANTHROPIC_API_KEY, undefined);
});

test("envFor openrouter (codex + endpoint): injeta OPENROUTER_API_KEY", () => {
  writeProfiles({ or: { label: "OpenRouter", provider: "codex", authMode: "api-key",
    homeDir: "~/.medium-latens-profiles/or", endpoint: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat" } });
  process.env.OPENROUTER_API_KEY = "or-test-123";
  const e = profiles.envFor("or");
  assert.equal(e.OPENROUTER_API_KEY, "or-test-123");
  assert.equal(e.OPENAI_API_KEY, undefined);
});

test("envFor api-key SEM key no .env: erro claro apontando o .env", () => {
  writeProfiles({ sem: { label: "Sem key", provider: "gemini", authMode: "api-key", homeDir: null } });
  delete process.env.GEMINI_API_KEY;
  assert.throws(() => profiles.envFor("sem"), (err) => err.code === "MISSING_KEY" && /GEMINI_API_KEY/.test(err.message) && /\.env/.test(err.message));
});

test("envFor usa a credencial salva quando a variável do servidor não existe", () => {
  credentials.save({ id: "gpt-painel", provider: "openai", model: "gpt-teste", key: "chave-salva-no-painel" }, CREDENTIALS_FILE);
  writeProfiles({ painel: { label: "Painel", provider: "codex", authMode: "api-key",
    homeDir: "~/.medium-latens-profiles/painel", credencialId: "gpt-painel" } });
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const e = profiles.envFor("painel");

  assert.equal(e.OPENAI_API_KEY, "chave-salva-no-painel");
  assert.equal(e.ANTHROPIC_API_KEY, undefined);
  assert.equal(e.OPENROUTER_API_KEY, undefined);
});

test("envFor sem variável nem credencial orienta configurar no painel ou no .env", () => {
  writeProfiles({ ausente: { label: "Ausente", provider: "claude", authMode: "api-key",
    homeDir: "~/.medium-latens-profiles/ausente", credencialId: "nao-existe" } });
  delete process.env.ANTHROPIC_API_KEY;

  assert.throws(
    () => profiles.envFor("ausente"),
    (err) => err.code === "MISSING_KEY"
      && /configure a conta no painel ou adicione ANTHROPIC_API_KEY ao \.env/.test(err.message),
  );
});

test("addFromCredential mapeia os três providers e persiste credencialId", () => {
  writeProfiles({ padrao: { label: "p", provider: "claude", authMode: "assinatura", homeDir: null } });

  const anthropic = profiles.addFromCredential({ id: "anthropic-painel", provider: "anthropic", model: "claude-teste" });
  const openai = profiles.addFromCredential({ id: "openai-painel", provider: "openai", model: "gpt-teste" });
  const compativel = profiles.addFromCredential({ id: "router-painel", provider: "compativel",
    endpoint: "https://exemplo.invalid/v1", model: "modelo-teste" });

  assert.deepEqual(
    [anthropic.provider, openai.provider, compativel.provider],
    ["claude", "codex", "codex"],
  );
  assert.equal(anthropic.credencialId, "anthropic-painel");
  assert.equal(openai.credencialId, "openai-painel");
  assert.equal(compativel.credencialId, "router-painel");
  assert.equal(compativel.endpoint, "https://exemplo.invalid/v1");
  assert.equal(profiles.load()["router-painel"].credencialId, "router-painel");
});

test("startLogin usa spawn sem shell, injeta o home isolado e solta o filho", () => {
  const win = require("../lib/win");
  const original = win.spawnCli;
  const chamadas = [];
  const filho = new EventEmitter();
  filho.pid = 43210;
  filho.unref = () => { filho.solto = true; };
  win.spawnCli = (cmd, args, opts) => { chamadas.push({ cmd, args, opts }); return filho; };

  try {
    const resultado = profiles.startLogin("claude-painel", "claude");
    assert.deepEqual(resultado, { pid: 43210, name: "claude-painel" });
  } finally {
    win.spawnCli = original;
  }

  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].cmd, "claude");
  assert.deepEqual(chamadas[0].args, ["auth", "login"]);
  assert.ok(chamadas[0].opts.env.CLAUDE_CONFIG_DIR.endsWith("/.medium-latens-profiles/claude-painel"));
  assert.equal(chamadas[0].opts.detached, true);
  assert.equal(chamadas[0].opts.stdio, "ignore");
  assert.equal(chamadas[0].opts.shell, undefined);
  assert.equal(filho.solto, true);
});

test("remove apaga o perfil sem apagar o diretório isolado", () => {
  const criado = profiles.addProfile({ name: "removivel", provider: "claude", authMode: "assinatura",
    homeDirBase: path.join(TMP, "homes-remocao") });
  const home = criado.homeDir;

  assert.equal(profiles.remove(criado.name), true);
  assert.equal(profiles.load()[criado.name], undefined);
  assert.equal(fs.existsSync(home), true);
});

// Chaves OpenAI cadastradas pelo painel são registradas automaticamente pelo assistente.
// Não existe comando manual válido para mostrar ao usuário nesse perfil.
test("loginCommand por provider não oferece comando manual para codex api-key", () => {
  writeProfiles({
    c: { label: "c", provider: "claude", authMode: "assinatura", homeDir: "~/.claude-profiles/c" },
    x: { label: "x", provider: "codex", authMode: "assinatura", homeDir: "~/.medium-latens-profiles/x" },
    k: { label: "k", provider: "codex", authMode: "api-key", homeDir: "~/.medium-latens-profiles/k",
      credencialId: "k-painel" },
    g: { label: "g", provider: "gemini", authMode: "api-key", homeDir: null },
  });
  assert.match(profiles.loginCommand("c"), /CLAUDE_CONFIG_DIR=.*claude auth login/);
  assert.match(profiles.loginCommand("x"), /CODEX_HOME=.*codex login/);
  assert.equal(profiles.loginCommand("k"), null);
  assert.equal(profiles.loginCommand("g"), null);
});

// Doc T1 V3: um CODEX_HOME isolado que nunca passou por `codex login --with-api-key`
// reporta "Not logged in" (exit 1) mesmo com OPENAI_API_KEY presente no ambiente do
// servidor — checar só a env var (comportamento ingênuo do brief original) mentiria
// "logado" para uma conta que na prática devolveria 401 no primeiro uso real.
test("authStatus codex api-key: CODEX_HOME isolado sem login prévio reporta não-logado mesmo com key no .env", async () => {
  writeProfiles({ freshkey: { label: "fresh", provider: "codex", authMode: "api-key",
    homeDir: path.join(TMP, "codex-fresh-home") } });
  process.env.OPENAI_API_KEY = "sk-test-999";
  const status = await profiles.authStatus("freshkey");
  assert.equal(status.loggedIn, false);
});

test("probe de CLI ausente resolve sem rejeitar", async () => {
  const status = await profiles.probeCli("ausente", () => {
    throw new Error("Não encontrei o comando ausente. Execute o instalador de novo.");
  });
  assert.deepEqual(status, { installed: false });
});

test("authStatus converte falha síncrona do launcher em estado não logado", async () => {
  writeProfiles({ semcli: { label: "Sem CLI", provider: "claude", authMode: "assinatura", homeDir: null } });
  const status = await profiles.authStatus("semcli", () => {
    throw new Error("Não encontrei o comando claude. Execute o instalador de novo.");
  });
  assert.deepEqual(status, {
    loggedIn: false,
    detail: "Não encontrei o comando claude. Execute o instalador de novo.",
  });
});

test("addProfile sem name (ausente/vazio/não-string) lança — nada de perfil-lixo 'object-object'", () => {
  const base = { provider: "claude", authMode: "assinatura", homeDirBase: path.join(TMP, "homes") };
  assert.throws(() => profiles.addProfile({ ...base, label: "sem nome" }), /nome do perfil/);
  assert.throws(() => profiles.addProfile({ ...base, name: "" }), /nome do perfil/);
  assert.throws(() => profiles.addProfile({ ...base, name: "   " }), /nome do perfil/);
  assert.throws(() => profiles.addProfile({ ...base, name: {} }), /nome do perfil/);
});

test("profiles rejeita ids fora do formato seguro", () => {
  const base = { provider: "claude", authMode: "assinatura", homeDirBase: path.join(TMP, "homes-ids") };
  for (const name of ["__proto__", "constructor", "prototype", "Conta Maiúscula", "com_espaço", `a${"b".repeat(64)}`]) {
    assert.throws(() => profiles.addProfile({ ...base, name }), /identificador de perfil inválido/i);
  }
});

test("addProfile cria USER_DIR inexistente antes de salvar o primeiro perfil", () => {
  const userDir = path.join(TMP, "user-dir-ainda-inexistente");
  const childEnv = { ...process.env, MEDIUM_LATENS_USER_DIR: userDir };
  delete childEnv.MEDIUM_LATENS_PROFILES_FILE;
  const modulePath = path.join(__dirname, "..", "lib", "profiles.js");
  const script = `
    const profiles = require(${JSON.stringify(modulePath)});
    profiles.addProfile({
      name: "primeiro",
      provider: "claude",
      authMode: "assinatura",
      homeDirBase: ${JSON.stringify(path.join(TMP, "fresh-homes"))}
    });
  `;

  assert.equal(fs.existsSync(userDir), false);
  const result = spawnSync(process.execPath, ["-e", script], { env: childEnv, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(userDir, "profiles.json"), "utf8")).profiles.primeiro.provider, "claude");
});

test("addProfile não persiste o perfil quando a criação do homeDir falha", () => {
  const profilesFile = path.join(TMP, "profiles-mkdir-failure.json");
  const blockedBase = path.join(TMP, "blocked-homes");
  fs.writeFileSync(blockedBase, "não é diretório");
  const childEnv = {
    ...process.env,
    MEDIUM_LATENS_PROFILES_FILE: profilesFile,
    MEDIUM_LATENS_USER_DIR: path.join(TMP, "user-mkdir-failure"),
  };
  const modulePath = path.join(__dirname, "..", "lib", "profiles.js");
  const script = `
    const fs = require("fs");
    const profiles = require(${JSON.stringify(modulePath)});
    try {
      profiles.addProfile({
        name: "bloqueado",
        provider: "claude",
        authMode: "assinatura",
        homeDirBase: ${JSON.stringify(blockedBase)}
      });
      process.exitCode = 2;
    } catch (error) {
      if (error.code !== "ENOTDIR") throw error;
    }
    if (fs.existsSync(${JSON.stringify(profilesFile)})) process.exitCode = 3;
  `;

  const result = spawnSync(process.execPath, ["-e", script], { env: childEnv, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("addProfile codex: cria homeDir e config.toml com o MCP do mcp-config.json (bloco [mcp_servers.<n>.env] separado — doc T1 V5)", () => {
  writeProfiles({ padrao: { label: "p", provider: "claude", authMode: "assinatura", homeDir: null } });
  const home = path.join(TMP, "homes", "gpt-novo");
  const p = profiles.addProfile({ name: "gpt-novo", label: "GPT novo", provider: "codex",
    authMode: "assinatura", homeDirBase: path.join(TMP, "homes") });
  assert.equal(p.provider, "codex");
  const toml = fs.readFileSync(path.join(home, "config.toml"), "utf8");
  assert.match(toml, /\[mcp_servers\.premiere-pro\]/);
  assert.match(toml, /\[mcp_servers\.premiere-pro\.env\]/);
  assert.match(toml, /premiere-pro-mcp/);
});

test("addProfile protege o diretório e os arquivos de estado", () => {
  const base = path.join(TMP, "homes-modos");
  const home = path.join(base, "codex-privado");
  fs.mkdirSync(home, { recursive: true, mode: 0o755 });
  fs.chmodSync(home, 0o755);
  fs.chmodSync(PFILE, 0o644);

  profiles.addProfile({
    name: "codex-privado",
    provider: "codex",
    authMode: "assinatura",
    homeDirBase: base,
  });

  if (BITS_POSIX) {
    assert.equal(fs.statSync(home).mode & 0o777, 0o700);
    assert.equal(fs.statSync(PFILE).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(home, "config.toml")).mode & 0o777, 0o600);
  }
});

// Doc T1 V6: wire_api = "chat" foi removido na 0.147.0 — o valor aceito é "responses".
test("addProfile openrouter: config.toml ganha model_providers + model, wire_api = responses (doc T1 V6)", () => {
  const p = profiles.addProfile({ name: "or-novo", label: "OpenRouter", provider: "codex",
    authMode: "api-key", endpoint: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat",
    homeDirBase: path.join(TMP, "homes") });
  const toml = fs.readFileSync(path.join(path.join(TMP, "homes", "or-novo"), "config.toml"), "utf8");
  assert.match(toml, /\[model_providers\.openrouter\]/);
  assert.match(toml, /env_key = "OPENROUTER_API_KEY"/);
  assert.match(toml, /wire_api = "responses"/);
  assert.match(toml, /model = "deepseek\/deepseek-chat"/);
  assert.equal(p.envKey, "OPENROUTER_API_KEY");
});
