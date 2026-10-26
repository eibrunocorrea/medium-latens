"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const MODELS = ["eleven_multilingual_v2", "eleven_v3", "eleven_flash_v2_5", "eleven_v4"];
const TAG_MODELS = ["eleven_v3", "eleven_v4"];
const TEXT = "[excited] Olha essa carta! [laughs]";

// Stubs installed before importing the CLI: no user credentials, network or files.
function cli(file, args) {
  const script = `
    const fs = require('node:fs');
    const { syncBuiltinESMExports } = require('node:module');
    const { pathToFileURL } = require('node:url');
    require.cache[require.resolve('./lib/paths.js')] = { exports: { FILES: { env: 'unused', workspaces: '.' } } };
    require.cache[require.resolve('./lib/userenv.js')] = { exports: { load() {} } };
    require.cache[require.resolve('./lib/profiles.js')] = { exports: {
      allowlistedEnv() { return { ELEVENLABS_API_KEY: ['fake', 'key'].join('-') }; }
    } };
    fs.mkdirSync = () => {};
    fs.writeFileSync = () => {};
    syncBuiltinESMExports();
    globalThis.fetch = async (url, options) => {
      console.log('REQUEST=' + options.body);
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    };
    process.argv = ['node', ${JSON.stringify(file)}, ...${JSON.stringify(args)}];
    import(pathToFileURL(${JSON.stringify(path.join(ROOT, file))}).href);
  `;
  return spawnSync(process.execPath, ["-e", script], { cwd: ROOT, encoding: "utf8" });
}

test("model catalog retains the voice default and the disabled OpenAI route", () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "genai/providers.config.json"), "utf8"));
  assert.deepEqual(config.voice.models, MODELS);
  assert.equal(config.voice.default_model, "eleven_flash_v2_5");
  assert.equal(config.image.default, "gemini");
  assert.match(config.image.note, /gpt-image-2/);
  assert.doesNotMatch(config.image.note, /gpt-image-1/);
});

for (const model of [null, ...MODELS]) {
  test(`voice request preserves text and omits unsupported settings: ${model || "default"}`, () => {
    const args = [TEXT, "--voice", "test-voice", "-o", "unused.mp3"];
    if (model) args.push("--model", model);
    const result = cli("genai/voice.mjs", args);
    assert.equal(result.status, 0, result.stderr);
    const request = JSON.parse(result.stdout.match(/^REQUEST=(.+)$/m)[1]);
    assert.deepEqual(request, { text: TEXT, model_id: model || "eleven_flash_v2_5" });
  });
}

test("voice usage lists the catalog models", () => {
  const result = cli("genai/voice.mjs", []);
  assert.equal(result.status, 2);
  for (const model of MODELS) assert.ok(result.stderr.includes(model), result.stderr);
});

test("voice rejects eleven_v4_turbo: it only runs on the Text to Dialogue WebSocket", () => {
  const result = cli("genai/voice.mjs", [TEXT, "--model", "eleven_v4_turbo"]);
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stdout, /REQUEST=/);
});

test("voice rejects unknown models without making a request", () => {
  const result = cli("genai/voice.mjs", [TEXT, "--model", "unknown"]);
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stdout, /REQUEST=/);
});

test("OpenAI image provider remains disabled", () => {
  const result = cli("genai/image.mjs", ["test image", "--provider", "openai"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fora das rotas/);
  assert.doesNotMatch(result.stdout, /REQUEST=/);
});

// Exercise argparse, TTS, fallback and the final manifest with only stdlib mocks.
const NARRATE_TEST = String.raw`
import json, sys, types
from pathlib import Path
from unittest.mock import patch

for name in ("gemini_client", "workspace", "userpaths"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["userpaths"].PERFIL_NARRACAO = Path("unused-profile")
sys.modules["workspace"].resolve = lambda slug: Path("unused-workspace")
source = Path("engine/narrate.py")
narrate = types.ModuleType("narrate")
narrate.__file__ = str(source.resolve())
exec(compile(source.read_text(encoding="utf-8"), str(source), "exec"), narrate.__dict__)

model, fallback = sys.argv[1], sys.argv[2] == "fallback"
selected = model or "eleven_flash_v2_5"
text = "[excited] Olha essa carta! [laughs]"
plain = "Olha essa carta!"
tag_models = {"eleven_v3", "eleven_v4"}
calls, manifests = [], []
def run(args, **kwargs):
    calls.append(args)
    fail = fallback and len(calls) == 1
    return types.SimpleNamespace(returncode=int(fail), stderr="simulated failure" if fail else "", stdout="")

narrate.load_events = lambda _: [{"t_start": 0, "card": "test card"}]
narrate.slug_for = lambda _: "test"
narrate.gen_lines = lambda *args: [{"t_start": 0, "text": text}]
narrate.duration_of = lambda _: 1.0
sys.argv = ["narrate.py", "unused-cards.json"] + (["--model", model] if model else [])
with patch.object(Path, "exists", return_value=True), \
     patch.object(Path, "stat", return_value=types.SimpleNamespace(st_size=3)), \
     patch.object(Path, "mkdir"), \
     patch.object(Path, "write_text", lambda self, value, **kwargs: manifests.append(json.loads(value))), \
     patch.object(narrate.subprocess, "run", side_effect=run):
    narrate.main()

assert calls[0][2] == (text if selected in tag_models else plain), calls
assert calls[0][calls[0].index("--model") + 1] == selected, calls
used = "eleven_multilingual_v2" if fallback else selected
assert len(calls) == (2 if fallback else 1), calls
if fallback:
    assert calls[1][2] == plain, calls
    assert calls[1][calls[1].index("--model") + 1] == used, calls
assert manifests[0]["model"] == used, manifests
assert manifests[0]["events"][0]["text"] == (text if used in tag_models else plain), manifests
assert len(manifests[0]["issues"]) == int(fallback), manifests
`;

for (const [model, mode] of [
  ...["", ...MODELS].map((model) => [model, "success"]),
  ...TAG_MODELS.map((model) => [model, "fallback"]),
]) {
  test(`narrate accepts ${model || "default"} and preserves tags/manifest on ${mode}`, () => {
    const result = spawnSync("python3", ["-c", NARRATE_TEST, model, mode], {
      cwd: ROOT, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  });
}

test("both READMEs document the new voice models", () => {
  for (const file of ["README.md", "README.pt-BR.md"]) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const model of ["eleven_v4"]) assert.ok(text.includes('`' + model + '`'), file);
  }
});
