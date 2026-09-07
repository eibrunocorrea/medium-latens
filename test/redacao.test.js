"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("node:perf_hooks");

process.env.MEDIUM_LATENS_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-redacao-"));
const telemetria = require("../lib/telemetria");
const redacao = require("../lib/redacao");

const corpo = ["R7qLm2XvKp9wTz4N", "bHc1JdYgQs6FuEaP", "3ViOkM8ZrWnB5tXy"].join("");

function segredo(...partes) {
  return partes.join("");
}

function base64Deterministico(tamanho) {
  let estado = 0x6d2b79f5;
  const bytes = Buffer.alloc(Math.ceil(tamanho * 3 / 4));
  for (let indice = 0; indice < bytes.length; indice++) {
    estado ^= estado << 13;
    estado ^= estado >>> 17;
    estado ^= estado << 5;
    bytes[indice] = estado & 0xff;
  }
  return bytes.toString("base64").slice(0, tamanho);
}

function afirmarRemovidos(entradas) {
  const saida = telemetria.limpar(entradas);
  for (const [nome, valor] of Object.entries(entradas)) {
    assert.ok(!JSON.stringify(saida).includes(valor), `${nome} não foi redigido`);
    assert.equal(saida[nome], "[removido]", `${nome} não virou o marcador de redação`);
  }
}

test("redige formatos conhecidos, webhooks e tokens de alta entropia", () => {
  const tokenAleatorio = segredo(
    "q7Kx2PmL9vRt4WzN",
    "8bCd1FgH5jSn3yUe",
    "6AaB0ZoQ",
  );
  const jwt = segredo(
    "ey", "J", "hbGciOiJIUzI1NiJ9", ".",
    "ey", "J", "zdWIiOiIxMjM0NTY3ODkwIn0", ".",
    corpo,
  );
  const entradas = {
    awsAkia: segredo("AK", "IA", "Q7W8E9R0T1Y2U3I4"),
    awsAsia: segredo("AS", "IA", "Z9X8C7V6B5N4M3L2"),
    jwt,
    stripeSecret: segredo("s", "k", "_", "test", "_", corpo),
    stripeRestricted: segredo("r", "k", "_", "live", "_", corpo),
    stripePublishable: segredo("p", "k", "_", "test", "_", corpo),
    googleOauth: segredo("ya", "29", ".", corpo),
    googleClient: segredo("GOC", "SPX", "-", corpo),
    npm: segredo("npm", "_", corpo),
    gitlab: segredo("gl", "pat", "-", corpo),
    slackApp: segredo("xapp", "-", corpo),
    digitalOcean: segredo("dop", "_v1_", corpo),
    huggingFace: segredo("hf", "_", corpo),
    githubPat: segredo("github", "_pat_", corpo),
    chavePrivada: segredo(
      "-----BEGIN ", "TEST PRIVATE KEY-----\n", corpo, "\n-----END ", "TEST PRIVATE KEY-----",
    ),
    webhookSlack: segredo("https://hooks.", "slack.com/services/", corpo),
    webhookDiscord: segredo("https://discord.com/api/", "webhooks/123/", corpo),
    webhookDiscordApp: segredo("https://discordapp.com/api/", "webhooks/123/", corpo),
    webhookZapier: segredo("https://hooks.", "zapier.com/hooks/catch/123/", corpo),
    webhookOutlook: segredo("https://outlook.office.com/", "webhook/123/", corpo),
    desconhecido: corpo,
    tokenAleatorio,
  };

  afirmarRemovidos(entradas);
});

test("mantém a rede de entropia para token alfanumérico longo", () => {
  const tokenAlfanumerico = segredo(
    "qwerty7Kasdfgh2Pzxcvbn9Lmn",
    "bvcx4Wpoiuyt8Bqazwsx1Fedcr",
    "fv5JtgbN",
  );

  assert.equal(tokenAlfanumerico.length, 60);
  assert.equal(redacao.contarAlternanciasCaixa(tokenAlfanumerico), 8);
  assert.ok(redacao.contarSequenciasDigitosInteriores(tokenAlfanumerico) >= 3);
  assert.equal(redacao.redigirValores(tokenAlfanumerico), "[removido]");
  assert.equal(redacao.redigirValores(`${tokenAlfanumerico}.json`), "[removido].json");
});

test("redige corpo PEM de 6000 caracteres sem deixar linhas base64", () => {
  const corpoPem = base64Deterministico(6000);
  const linhas = corpoPem.match(/.{1,64}/g);
  const pem = [
    segredo("-----BEGIN ", "TEST PRIVATE KEY-----"),
    ...linhas,
    segredo("-----END ", "TEST PRIVATE KEY-----"),
  ].join("\n");
  const saida = redacao.redigirValores(pem);

  for (const linha of linhas) assert.ok(!saida.includes(linha), "linha do corpo PEM vazou");
  assert.ok(!saida.includes("PRIVATE KEY"));
});

test("redige linha base64 aleatória com barras e sinais de adição", () => {
  const linhaBase64 = segredo(
    "Bcj/nuaYqW2rFOKv9pVuwYG",
    "DY2e+ZPbY+4Ro4AU/Co/0hY/",
    "CR6REEFCUTK4CeOra",
  );

  assert.equal(redacao.redigirValores(linhaBase64), "[removido]");
  assert.equal(redacao.redigirValores(`${linhaBase64}.txt`), "[removido].txt");
});

test("limita PEMs incompletos com 1000 marcadores em entrada de 2 MB", () => {
  const cabecalho = segredo("-----BEGIN ", "TEST PRIVATE KEY-----");
  const tamanhoTrecho = Math.ceil((2 * 1024 * 1024) / 1000);
  const entrada = (cabecalho + "x".repeat(tamanhoTrecho - cabecalho.length)).repeat(1000);
  assert.ok(Buffer.byteLength(entrada, "utf8") >= 2 * 1024 * 1024);

  const inicio = performance.now();
  const saida = redacao.redigirValores(entrada);
  const duracaoMs = performance.now() - inicio;

  assert.ok(duracaoMs < 1000, `redação demorou ${duracaoMs.toFixed(1)} ms`);
  assert.ok(!saida.includes("PRIVATE KEY"));
});

test("redige a vizinhança e o resto órfão de um segredo partido", () => {
  const prefixo = segredo("s", "k", "-ant-api03-", corpo.slice(0, 18));
  const resto = corpo.slice(18);
  const restoExato = segredo(
    "JdYgQs6FuEaP3ViOkM8",
    "ZrWnB5tXyLpQaSdFgHjKlZxCvBn",
  );
  const saida = telemetria.limpar({
    quebra: `${prefixo}\n${resto}`,
    espaco: `${prefixo} ${resto}`,
    campoA: prefixo,
    campoB: resto,
    restoExato,
  });
  const serializado = JSON.stringify(saida);

  assert.ok(!serializado.includes(corpo.slice(0, 18)));
  assert.ok(!serializado.includes(resto));
  assert.equal(saida.quebra, "[removido]");
  assert.equal(saida.espaco, "[removido]");
  assert.equal(saida.campoA, "[removido]");
  assert.equal(saida.campoB, "[removido]");
  assert.equal(saida.restoExato, "[removido]");
});

test("normaliza caracteres de formato, largura e homóglifos antes de redigir", () => {
  const sufixo = segredo("-ant-api03-", corpo);
  const entradas = {
    espacoLarguraZero: segredo("s", "k", "\u200b", sufixo),
    kCirilico: segredo("s", "\u043a", sufixo),
    larguraCompleta: segredo("\uff53", "\uff4b", sufixo),
  };

  afirmarRemovidos(entradas);
  assert.equal(redacao.normalizar("ορτ"), "opt");
});

test("preserva caminho e slug portugueses mesmo com entropia natural alta", () => {
  const caminho = "/Users/editor/Movies/Projetos/Unboxing_Colecao_Especial_Pokemon_2026_Parte_02/brutos/camera_frontal_take_final_v3.mov";
  const slug = "unboxing-colecao-especial-pokemon-2026-parte-02";
  const naturais = [
    "IMG_20260907_Festa_De_Aniversario_Da_Maria_Parte_02",
    "Unboxing_Colecao_Especial_Pokemon_Edicao_2026_Parte_02",
    "myVeryLongVariableName2026",
    "Hoje vamos revisar o corte final antes de publicar o vídeo.",
  ];

  assert.equal(telemetria.limpar(caminho), caminho);
  assert.equal(telemetria.limpar(slug), slug);
  for (const natural of naturais) assert.equal(telemetria.limpar(natural), natural);
});

test("preserva caminhos, URL e identificadores longos que parecem base64", () => {
  const legitimos = [
    "/Users/editor/Movies/Projetos/Unboxing/brutos/CameraFrontal/takeFinal.mov",
    segredo("https://coleta.", "torremaster.com/v1/eventos/sessao/ProjetoUnboxingColecaoEspecial/parte02"),
    "UnboxingColecaoEspecialPokemonEdicao2026ParteDois",
    "IMG20260907FestaDeAniversarioDaMariaParteDois.mov",
  ];

  for (const legitimo of legitimos) assert.equal(redacao.redigirValores(legitimo), legitimo);
});

test("preserva prosa à direita de um segredo reconhecido", () => {
  const chaveAws = segredo("AK", "IA", "Q7W8E9R0T1Y2U3I4");
  assert.equal(
    telemetria.limpar(`a chave ${chaveAws} instalada no servidor`),
    "a chave [removido] instalada no servidor",
  );
});

test("redactSecrets mantém o padrão legado sk ou key com hífen", () => {
  const chave = segredo("sk-", "abcdef", "1234567");
  assert.equal(redacao.redactSecrets(`AVISO: usou ${chave} agora`), "AVISO: usou [oculto] agora");
});

test("mantém a redação por nome sensível em texto livre", () => {
  const valorCurto = segredo("curta", "123");
  const saida = telemetria.limpar(`senha=${valorCurto}`);

  assert.equal(saida, "senha=[removido]");
});
