#!/usr/bin/env node
// Adaptador de geração de imagem (F6). Delega a um pipeline externo configurado
// por MEDIUM_LATENS_IMAGE_PIPELINE no .env do usuário.
// Nada de lógica de provider aqui: o pipeline configurado escolhe provider/modelo.
//
// Uso:
//   node genai/image.mjs "<prompt>" [--provider gemini|bfl|openai|cloudflare] [-o out.png]
//
// Sem --provider: o roteador do pipeline decide (task "scene").
// Com --provider: força o provider mascarando (env vazio no child) a credencial dos
// concorrentes na rota. O gate isAvailable() do pipeline os pula. process.env vence
// o .env do pipeline, então nenhum arquivo dele é tocado.
//
// Última linha do stdout: IMAGE=<path> PROVIDER=<p>
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { FILES } = require('../lib/paths.js');
const userenv = require('../lib/userenv.js');
const profiles = require('../lib/profiles.js');

// Credencial (nome de env var) de cada provider da rota "scene" do pipeline.
// Espelha providers.config.json do pipeline só para o mascaramento, sem segredos.
const SCENE_CRED_ENV = {
  gemini: ['GEMINI_API_KEY'],
  bfl: ['BFL_API_KEY'],
  cloudflare: ['CLOUDFLARE_API_TOKEN'],
  hf: ['HUGGINGFACE_TOKEN'],
};
const PROVIDERS = ['gemini', 'bfl', 'openai', 'cloudflare'];

function pick(source, keys) {
  const selected = {};
  for (const key of keys) {
    if (source[key] !== undefined) selected[key] = source[key];
  }
  return selected;
}

const fileEnv = {};
userenv.load(fileEnv, FILES.env);
const sourceEnv = { ...fileEnv, ...process.env };
const sceneKeys = Object.values(SCENE_CRED_ENV).flat();
const childEnv = profiles.allowlistedEnv(sourceEnv, pick(sourceEnv, sceneKeys));
const configuredPipeline = childEnv.MEDIUM_LATENS_IMAGE_PIPELINE?.trim();
const PIPELINE_DIR = configuredPipeline ? resolve(configuredPipeline) : null;
const PIPELINE_BIN = PIPELINE_DIR ? join(PIPELINE_DIR, 'bin', 'pipeline.mjs') : null;
const TASK = 'scene';

// --- CLI ---
const argv = process.argv.slice(2);
let prompt = null;
let provider = null;
let out = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--provider') provider = argv[++i];
  else if (a.startsWith('--provider=')) provider = a.slice('--provider='.length);
  else if (a === '-o' || a === '--out') out = argv[++i];
  else if (a.startsWith('--out=')) out = a.slice('--out='.length);
  else if (prompt === null) prompt = a;
  else { console.error(`argumento inesperado: ${a}`); process.exit(2); }
}
if (!prompt || !prompt.trim() || (provider !== null && !provider) || (out !== null && !out)) {
  console.error(`uso: node image.mjs "<prompt>" [--provider ${PROVIDERS.join('|')}] [-o out.png]`);
  process.exit(2);
}
if (provider && !PROVIDERS.includes(provider)) {
  console.error(`provider desconhecido: ${provider} (esperado: ${PROVIDERS.join(' | ')})`);
  process.exit(2);
}
if (provider === 'openai') {
  // Decisão registrada no providers.config.json do pipeline (teste real 2026-07-22):
  // gpt-image-1 bloqueia produto de marca (Pokémon) e foi removido de todas as rotas.
  // O roteador não o escolhe. Forçá-lo exigiria alterar a configuração do pipeline.
  console.error('provider "openai" está fora das rotas do pipeline configurado. ' +
    'Use gemini | bfl | cloudflare, ou reative openai na rota "scene" do providers.config.json do pipeline.');
  process.exit(1);
}
if (!PIPELINE_DIR || !existsSync(PIPELINE_DIR) || !existsSync(PIPELINE_BIN)) {
  console.error('O recurso de imagem está desligado. Defina MEDIUM_LATENS_IMAGE_PIPELINE ' +
    'no .env do usuário com o caminho de um pipeline de imagem válido.');
  process.exit(2);
}

if (!out) out = join(FILES.workspaces, `img-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
const outPath = resolve(out);
mkdirSync(dirname(outPath), { recursive: true });

// --- máscara de concorrentes quando um provider é forçado ---
if (provider) {
  for (const [id, vars] of Object.entries(SCENE_CRED_ENV)) {
    if (id === provider) continue;
    for (const v of vars) childEnv[v] = ''; // present() → false no gate do pipeline
  }
}

// --- delega ao pipeline (child_process, cwd correto) ---
const res = spawnSync(process.execPath, [
  PIPELINE_BIN, 'generate', TASK,
  `--prompt=${prompt}`,
  `--out=${outPath}`,
], { cwd: PIPELINE_DIR, env: childEnv, encoding: 'utf8' });

if (res.stdout) process.stdout.write(res.stdout);
if (res.stderr) process.stderr.write(res.stderr);
if (res.status !== 0) {
  console.error(`pipeline saiu com status ${res.status ?? 'null'}`);
  process.exit(res.status ?? 1);
}
if (!existsSync(outPath)) {
  console.error(`pipeline terminou OK mas ${outPath} não existe`);
  process.exit(1);
}

const m = (res.stdout ?? '').match(/provider escolhido:\s*(\S+)/);
const chosen = m ? m[1] : (provider ?? 'desconhecido');
if (provider && chosen !== provider) {
  console.error(`provider pedido (${provider}) ≠ escolhido (${chosen})`);
  process.exit(1);
}
console.log(`IMAGE=${outPath} PROVIDER=${chosen}`);
