"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("node:child_process");
const userenv = require("../lib/userenv");
const paths = require("../lib/paths");

const SUBIDA_POR_ARGUMENTOS = /path\.(?:join|resolve)\([^)]*["']\.\.["'][^)]*["']\.\.["'][^)]*\)/;
const CAMINHO_WINDOWS = /\b[A-Z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)/i;
const CAMINHO_LINUX = /\/home\/[^/\s"'`]+/;
const NOME_ANTIGO = /Bruno's IA Editor|Brunos IA Editor|BrunosIAEditor|brunos-ia-editor|ia-editor|IA_EDITOR/gi;
const EXTENSOES_DE_CODIGO_E_CONFIGURACAO = new Set([
  ".bat", ".cjs", ".cmd", ".conf", ".css", ".html", ".ini", ".js", ".json",
  ".md", ".mjs", ".ps1", ".py", ".sh", ".toml", ".ts", ".tsx", ".vbs", ".xml",
  ".yaml", ".yml",
]);
const DIRETORIOS_DE_BUILD = new Set([
  ".cache", ".git", ".next", ".turbo", "__pycache__", "build", "coverage", "dist",
  "node_modules", "out", "release", "target",
]);
const ARQUIVOS_DE_CONFIGURACAO_SEM_EXTENSAO = new Set([
  ".editorconfig", ".gitignore", "Dockerfile", "Makefile",
]);

test("carrega o .env do usuário e ignora o da pasta acima", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-env-"));
  const userDir = path.join(tmp, "user");
  fs.mkdirSync(userDir);
  fs.writeFileSync(path.join(userDir, ".env"), "MINHA_CHAVE=ok\nOUTRA=2 # comentario\n");
  fs.writeFileSync(path.join(tmp, ".env"), "CHAVE_DE_FORA=vazou\n");

  const env = {};
  const n = userenv.load(env, path.join(userDir, ".env"));

  assert.equal(n, 2);
  assert.equal(env.MINHA_CHAVE, "ok");
  assert.equal(env.OUTRA, "2");
  assert.equal(env.CHAVE_DE_FORA, undefined, "variável de fora do USER_DIR não pode entrar");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("carrega .env com CRLF igual ao arquivo com LF", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-env-"));
  const arquivoLf = path.join(tmp, "lf.env");
  const arquivoCrlf = path.join(tmp, "crlf.env");
  fs.writeFileSync(arquivoLf, "FOO=bar\nBAZ=qux\n");
  fs.writeFileSync(arquivoCrlf, "FOO=bar\r\nBAZ=qux\r\n");
  const envLf = {};
  const envCrlf = {};

  const nLf = userenv.load(envLf, arquivoLf);
  const nCrlf = userenv.load(envCrlf, arquivoCrlf);

  assert.equal(nCrlf, nLf);
  assert.deepEqual(envCrlf, envLf);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("preserva valores entre aspas e hashes colados", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-env-"));
  const arquivo = path.join(tmp, ".env");
  fs.writeFileSync(arquivo, [
    "MINHA_CHAVE=ok",
    "OUTRA=2 # comentario",
    'A="a#b"',
    'B="bar baz"',
    "C=sk-live#1234",
    "D='c#d'",
  ].join("\n"));
  const env = {};

  const n = userenv.load(env, arquivo);

  assert.equal(n, 6);
  assert.deepEqual(env, {
    MINHA_CHAVE: "ok",
    OUTRA: "2",
    A: "a#b",
    B: "bar baz",
    C: "sk-live#1234",
    D: "c#d",
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("não sobrescreve variável já definida no ambiente", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-env-"));
  fs.writeFileSync(path.join(tmp, ".env"), "JA_EXISTE=do_arquivo\n");
  const env = { JA_EXISTE: "do_ambiente" };
  userenv.load(env, path.join(tmp, ".env"));
  assert.equal(env.JA_EXISTE, "do_ambiente");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("arquivo ausente não quebra e carrega zero", () => {
  const env = {};
  assert.equal(userenv.load(env, "/caminho/que/nao/existe/.env"), 0);
});

test("gerador de imagem recebe BFL_API_KEY sem entregar segredo arbitrário", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-image-env-"));
  const pipeline = path.join(tmp, "pipeline");
  const bin = path.join(pipeline, "bin");
  const out = path.join(tmp, "saida.png");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "pipeline.mjs"), [
    "import { writeFileSync } from 'node:fs';",
    "const out = process.argv.find((arg) => arg.startsWith('--out=')).slice(6);",
    "writeFileSync(out, 'imagem-de-teste');",
    "console.log(JSON.stringify({ bfl: process.env.BFL_API_KEY || null, segredo: process.env.MINHA_VARIAVEL_SECRETA || null }));",
    "console.log('provider escolhido: bfl');",
  ].join("\n"));
  const result = spawnSync(process.execPath, [
    path.join(paths.APP_DIR, "genai", "image.mjs"), "imagem de teste", "--provider", "bfl", "-o", out,
  ], {
    env: {
      ...process.env,
      MEDIUM_LATENS_USER_DIR: path.join(tmp, "user"),
      MEDIUM_LATENS_IMAGE_PIPELINE: pipeline,
      BFL_API_KEY: "bfl-chave-de-teste",
      MINHA_VARIAVEL_SECRETA: "não-pode-vazar",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"bfl":"bfl-chave-de-teste"/);
  assert.match(result.stdout, /"segredo":null/);
});

test("guarda reforçada reconhece outras formas de caminho externo", () => {
  const join = 'const p = path.join(__dirname, "..", "..");';
  const resolve = "const p = path.resolve(__dirname, '..', '..');";
  const windowsEscapado = String.raw`const p = "C:\\Users\\ana\\AppData";`;
  const windowsBarraNormal = 'const p = "C:/Users/ana";';
  const windowsLiteralCru = 'const p = String.raw`C:\\Users\\ana`;';
  const windowsMinusculo = String.raw`const p = "c:\\users\\ana";`;
  const appDataLegitimo = 'const base = env.APPDATA || path.join(home, "AppData", "Roaming");';
  const healthLegitimo = 'const u = "http://127.0.0.1:8765/health";';
  const linux = 'const p = "/home/ana/.secret";';
  const linuxLegitimo = 'const home = os.homedir();';

  assert.match(join, SUBIDA_POR_ARGUMENTOS);
  assert.match(resolve, SUBIDA_POR_ARGUMENTOS);
  assert.match(windowsEscapado, CAMINHO_WINDOWS);
  assert.match(windowsBarraNormal, CAMINHO_WINDOWS);
  assert.match(windowsLiteralCru, CAMINHO_WINDOWS);
  assert.match(windowsMinusculo, CAMINHO_WINDOWS);
  assert.doesNotMatch(appDataLegitimo, CAMINHO_WINDOWS);
  assert.doesNotMatch(healthLegitimo, CAMINHO_WINDOWS);
  assert.match(linux, CAMINHO_LINUX);
  assert.doesNotMatch(linuxLegitimo, CAMINHO_LINUX);
});

test("GUARDA: nenhum módulo sobe acima de APP_DIR nem tem caminho de máquina", () => {
  const alvos = [path.join(paths.APP_DIR, "server.js")]
    .concat(fs.readdirSync(path.join(paths.APP_DIR, "lib"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => path.join(paths.APP_DIR, "lib", f)))
    .concat(fs.readdirSync(path.join(paths.APP_DIR, "genai"))
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => path.join(paths.APP_DIR, "genai", f)));

  const falhas = [];
  const verificar = (ok, arquivo, mensagem) => {
    if (!ok) falhas.push(`${arquivo}: ${mensagem}`);
  };

  for (const arquivo of alvos) {
    const src = fs.readFileSync(arquivo, "utf8");
    verificar(!/["'`][^"'`]*\.\.\/\.\.[^"'`]*["'`]/.test(src), arquivo,
      "caminho que sobe acima da instalação");
    verificar(!/\/Users\/[a-z]/i.test(src), arquivo, "caminho absoluto de máquina");
    verificar(!/\bconst HUB\b/.test(src), arquivo, "HUB foi reintroduzido");
    verificar(!SUBIDA_POR_ARGUMENTOS.test(src), arquivo,
      "path.join ou path.resolve sobe acima da instalação");
    verificar(!CAMINHO_WINDOWS.test(src), arquivo,
      "caminho absoluto de máquina no Windows");
    verificar(!CAMINHO_LINUX.test(src), arquivo,
      "caminho absoluto de máquina no Linux");
  }

  assert.equal(falhas.length, 0, falhas.join("\n"));
});

test("GUARDA: nome antigo do produto não aparece no código nem na configuração", () => {
  const ignorar = path.resolve(__filename);
  const falhas = [];

  const visitar = (diretorio) => {
    for (const entrada of fs.readdirSync(diretorio, { withFileTypes: true })) {
      if (entrada.isDirectory() && DIRETORIOS_DE_BUILD.has(entrada.name)) continue;

      const arquivo = path.join(diretorio, entrada.name);
      if (entrada.isDirectory()) {
        visitar(arquivo);
        continue;
      }
      if (!entrada.isFile() || path.resolve(arquivo) === ignorar) continue;

      const extensao = path.extname(entrada.name).toLowerCase();
      if (!EXTENSOES_DE_CODIGO_E_CONFIGURACAO.has(extensao)
          && !ARQUIVOS_DE_CONFIGURACAO_SEM_EXTENSAO.has(entrada.name)) continue;

      const relativo = path.relative(paths.APP_DIR, arquivo);
      const linhas = fs.readFileSync(arquivo, "utf8").split(/\r?\n/);
      linhas.forEach((linha, indice) => {
        for (const ocorrencia of linha.matchAll(NOME_ANTIGO)) {
          falhas.push(`${relativo}:${indice + 1}: nome antigo do produto encontrado: ${ocorrencia[0]}`);
        }
      });
    }
  };

  visitar(paths.APP_DIR);
  assert.equal(falhas.length, 0,
    `Nome antigo do produto encontrado em ${falhas.length} ocorrência(s):\n${falhas.join("\n")}`);
});
