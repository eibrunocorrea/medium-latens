#!/usr/bin/env node
// TTS via ElevenLabs (F6, gen-AI de voz). Node >=18 (fetch nativo), zero deps.
//
// Uso:
//   node genai/voice.mjs "<texto>" [--voice principal|cloud|<voice_id>]
//        [--model eleven_v3|eleven_multilingual_v2|eleven_flash_v2_5] [-o out.mp3]
//
// Credenciais: ELEVENLABS_API_KEY + ELEVENLABS_VOICE_PRINCIPAL (e opcional
// ELEVENLABS_VOICE_CLOUD), lidas de process.env ou do .env do usuário.
// NUNCA imprime valores de segredo.
//
// Última linha do stdout: VOICE_MP3=<path> BYTES=<n> MODEL=<m>
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { FILES } = require('../lib/paths.js');
const userenv = require('../lib/userenv.js');
const profiles = require('../lib/profiles.js');

// .env do usuário filtrado pela mesma lista dos outros processos filhos.
const fileEnv = {};
userenv.load(fileEnv, FILES.env);
const runtimeEnv = profiles.allowlistedEnv({ ...fileEnv, ...process.env });
const env = (name) => runtimeEnv[name] ?? null;

// --- CLI ---
const argv = process.argv.slice(2);
const MODELS = ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5'];
let text = null;
let voiceArg = 'principal';
let model = 'eleven_flash_v2_5'; // padrão equilibrado; v3 pode soar artificial em algumas vozes
let out = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--voice') voiceArg = argv[++i];
  else if (a.startsWith('--voice=')) voiceArg = a.slice('--voice='.length);
  else if (a === '--model') model = argv[++i];
  else if (a.startsWith('--model=')) model = a.slice('--model='.length);
  else if (a === '-o' || a === '--out') out = argv[++i];
  else if (a.startsWith('--out=')) out = a.slice('--out='.length);
  else if (text === null) text = a;
  else { console.error(`argumento inesperado: ${a}`); process.exit(2); }
}

function usage() {
  console.error('uso: node voice.mjs "<texto>" [--voice principal|cloud|<voice_id>] ' +
    `[--model ${MODELS.join('|')}] [-o out.mp3]`);
  process.exit(2);
}
if (!text || !text.trim()) usage();
if (!voiceArg || !model || (out !== null && !out)) usage();
if (!MODELS.includes(model)) {
  console.error(`modelo desconhecido: ${model} (esperado: ${MODELS.join(' | ')})`);
  process.exit(2);
}

// --- resolve voice_id (aliases para env; senão trata como voice_id literal) ---
let voiceId;
if (voiceArg === 'principal' || voiceArg === 'cloud') {
  const varName = voiceArg === 'principal' ? 'ELEVENLABS_VOICE_PRINCIPAL' : 'ELEVENLABS_VOICE_CLOUD';
  voiceId = env(varName);
  if (!voiceId) { console.error(`variável ${varName} ausente no .env do usuário`); process.exit(1); }
} else {
  voiceId = voiceArg;
}

const apiKey = env('ELEVENLABS_API_KEY');
if (!apiKey) { console.error('ELEVENLABS_API_KEY ausente no .env do usuário'); process.exit(1); }

if (!out) out = join(FILES.workspaces, `voice-${new Date().toISOString().replace(/[:.]/g, '-')}.mp3`);
const outPath = resolve(out);

// --- chamada TTS ---
const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
  method: 'POST',
  headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
  body: JSON.stringify({ text, model_id: model }),
});
if (!res.ok) {
  let detail = '';
  try { detail = (await res.text()).slice(0, 500); } catch { /* corpo ilegível */ }
  console.error(`ElevenLabs HTTP ${res.status}: ${detail}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
if (buf.length === 0) { console.error('ElevenLabs retornou corpo vazio'); process.exit(1); }

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, buf);
console.log(`VOICE_MP3=${outPath} BYTES=${buf.length} MODEL=${model}`);
