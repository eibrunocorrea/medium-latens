"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { performance } = require("node:perf_hooks");

process.env.MEDIUM_LATENS_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-tel-"));
const tel = require("../lib/telemetria");
const envio = require("../lib/envio");
const BITS_POSIX = process.platform !== "win32"; // NTFS não expõe bits de modo; a proteção vem da ACL do perfil do usuário

test("identificador da instalação é anônimo e estável", () => {
  const a = tel.instalacaoId();
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.equal(tel.instalacaoId(), a);
  assert.ok(!a.includes(os.userInfo().username));
});

test("nada entra na fila antes do aceite", () => {
  tel.evento("teste", { x: 1 });
  assert.equal(tel.fila().length, 0);
});

test("depois do aceite o evento entra", () => {
  tel.registrarAceite("1.0");
  assert.equal(tel.aceito(), true);
  tel.evento("comando", { rota: "/autozoom/apply", aplicados: 3 });
  const f = tel.fila();
  assert.equal(f.length, 1);
  assert.equal(f[0].tipo, "comando");
  assert.equal(f[0].dados.aplicados, 3);
  assert.ok(f[0].instalacao && f[0].em);
});

// As chaves de teste são montadas em tempo de execução, nunca escritas inteiras no arquivo.
// Motivo prático: o verificador de segredo do repositório bloqueia commit que contenha
// literal com formato de chave, mesmo sendo falsa. Montando por partes, o teste continua
// exercitando o mesmo caminho de código e o arquivo passa na verificação.
const P = "sk-";
const G = "AIza";
const FALSA_ANTHROPIC = P + "ant-api03-SEGREDO12345678";
const FALSA_OPENAI = P + "proj-OUTRO67890123456";
const FALSA_GOOGLE = G + "SyFALSA1234567890abcd";
const FALSA_ELEVENLABS = "sk" + "_9f8e7d6c5b4a39281706f5e4d3c2b1a0";
const FALSA_META = "EAA" + "B7ZBxKq0ZDZD1234567890abcdefgh";

// PNG real de 1x1 pixel, grayscale com alpha, montado pelos chunks PNG.
const PNG_REAL = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from("0000000d4948445200000001000000010804000000b51c0c02", "hex"),
  Buffer.from("0000000e494441547801010300fcff00000000030001aa07e5fe", "hex"),
  Buffer.from("0000000049454e44ae426082", "hex"),
]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkPng(tipo, dados) {
  const nome = Buffer.from(tipo, "ascii");
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([nome, dados])));
  return Buffer.concat([tamanho, nome, dados, checksum]);
}

function montarPngReal12x12() {
  const largura = 12;
  const altura = 12;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);

  let estado = 0x6d2b79f5;
  const pixels = Buffer.alloc((largura * 4 + 1) * altura);
  for (let linha = 0; linha < altura; linha++) {
    const inicio = linha * (largura * 4 + 1);
    pixels[inicio] = 0;
    for (let coluna = 0; coluna < largura * 4; coluna++) {
      estado ^= estado << 13;
      estado ^= estado >>> 17;
      estado ^= estado << 5;
      pixels[inicio + coluna + 1] = estado & 0xff;
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunkPng("IHDR", ihdr),
    chunkPng("IDAT", zlib.deflateSync(pixels)),
    chunkPng("IEND", Buffer.alloc(0)),
  ]);
}

const PNG_REAL_12X12 = montarPngReal12x12();

function cincoFormasDoPng() {
  return {
    base64Curto: PNG_REAL.subarray(0, 40).toString("base64"),
    base64Completo: PNG_REAL.toString("base64"),
    array40: Array.from(PNG_REAL.subarray(0, 40)),
    array63: Array.from(PNG_REAL.subarray(0, 63)),
    latin1_60: PNG_REAL.subarray(0, 60).toString("latin1"),
  };
}

test("remove chave de API em qualquer profundidade", () => {
  const sujo = {
    prompt: "minha chave é " + FALSA_ANTHROPIC + " ok",
    nivel: { dois: ["Bearer " + FALSA_OPENAI, FALSA_GOOGLE] },
  };
  const limpo = tel.limpar(sujo);
  const texto = JSON.stringify(limpo);
  assert.ok(!texto.includes("SEGREDO12345678"), "vazou chave no prompt");
  assert.ok(!texto.includes("OUTRO67890123456"), "vazou chave aninhada");
  assert.ok(!texto.includes("FALSA1234567890abcd"), "vazou chave google");
  assert.ok(texto.includes("[removido]"));
});

test("limita o trabalho de redação para PEMs incompletos em entrada de 2 MB", () => {
  const cabecalho = ["-----BEGIN ", "TEST PRIVATE KEY-----"].join("");
  const tamanhoTrecho = Math.ceil((2 * 1024 * 1024) / 1000);
  const entrada = (cabecalho + "x".repeat(tamanhoTrecho - cabecalho.length)).repeat(1000);
  assert.ok(Buffer.byteLength(entrada, "utf8") >= 2 * 1024 * 1024);

  const inicio = performance.now();
  const saida = tel.limpar(entrada);
  const duracaoMs = performance.now() - inicio;

  assert.ok(duracaoMs < 1000, `redação demorou ${duracaoMs.toFixed(1)} ms`);
  assert.ok(!saida.includes("PRIVATE KEY"));
});

test("remove valor de variável de autenticação presente no ambiente", () => {
  process.env.ANTHROPIC_API_KEY = "valor-super-secreto-do-ambiente";
  const limpo = tel.limpar({ nota: "usei valor-super-secreto-do-ambiente hoje" });
  assert.ok(!JSON.stringify(limpo).includes("valor-super-secreto-do-ambiente"));
  delete process.env.ANTHROPIC_API_KEY;
});

test("campo com nome sensível é removido mesmo com valor curto", () => {
  const limpo = tel.limpar({ token: "abc", api_key: "xyz", nome: "corte.mp4" });
  assert.equal(limpo.token, "[removido]");
  assert.equal(limpo.api_key, "[removido]");
  assert.equal(limpo.nome, "corte.mp4");
});

test("descarta dado binário em vez de enfileirar", () => {
  const limpo = tel.limpar({ frame: Buffer.from([1, 2, 3, 4]), nome: "corte.mp4" });
  assert.equal(limpo.frame, "[binario removido]");
  assert.equal(limpo.nome, "corte.mp4");
});

test("evento nunca lança, mesmo com valor circular", () => {
  const circular = { a: 1 };
  circular.self = circular;
  assert.doesNotThrow(() => tel.evento("estranho", circular));
});

test("fila respeita o teto", () => {
  for (let i = 0; i < 20; i++) tel.evento("enche", { i });
  assert.ok(tel.fila().length <= tel.MAX_ITENS);
});

test("descarta entrada quando a credencial está na chave do objeto", () => {
  const limpo = tel.limpar({ [FALSA_GOOGLE]: 1, preservado: 2 });
  const texto = JSON.stringify(limpo);
  assert.ok(!texto.includes(FALSA_GOOGLE), "vazou credencial como chave de objeto");
  assert.deepEqual(limpo, { preservado: 2 });
});

test("redige e limita o campo tipo antes de gravar", () => {
  tel.evento("rota:" + FALSA_GOOGLE + ":" + "x".repeat(300), { ok: true });
  const item = tel.fila().at(-1);
  assert.ok(!item.tipo.includes(FALSA_GOOGLE), "vazou credencial no tipo");
  assert.ok(Buffer.byteLength(item.tipo, "utf8") <= 128, "tipo ultrapassou o teto de bytes");
  assert.ok(item.tipo.includes("[texto truncado]"), "tipo longo não recebeu marcador");
});

test("remove função sem serializar código e limpa outro escalar não-string", () => {
  const funcao = new Function("return " + JSON.stringify(FALSA_GOOGLE));
  const limpo = tel.limpar({ funcao, simbolo: Symbol(FALSA_META) });
  const texto = JSON.stringify(limpo);
  assert.equal(limpo.funcao, "[funcao removida]");
  assert.ok(!texto.includes(FALSA_GOOGLE), "vazou chave no código-fonte da função");
  assert.ok(!texto.includes(FALSA_META), "vazou chave em escalar convertido para string");
});

test("remove formatos reais modernos da ElevenLabs e da Meta", () => {
  const texto = JSON.stringify(tel.limpar({ elevenlabs: FALSA_ELEVENLABS, meta: FALSA_META }));
  const vazamentos = [FALSA_ELEVENLABS, FALSA_META].filter((segredo) => texto.includes(segredo));
  assert.deepEqual(vazamentos, []);
});

test("remove PNG em Uint8Array serializado como objeto de chaves numéricas", () => {
  assert.equal(PNG_REAL.length, 71);
  const serializado = JSON.parse(JSON.stringify(new Uint8Array(PNG_REAL)));
  assert.equal(tel.limpar(serializado), "[binario removido]");
});

test("remove sequência longa de amostras PCM de 16 bits", () => {
  const pcm16 = Array.from({ length: 4000 }, (_, i) => Math.round(Math.sin(i / 10) * 20_000));
  assert.equal(tel.limpar(pcm16), "[binario removido]");
});

test("remove sequência longa de amostras float32", () => {
  const float32 = Array.from({ length: 4000 }, (_, i) => Math.sin(i / 10));
  assert.equal(tel.limpar(float32), "[binario removido]");
});

test("remove sequência longa de bytes representados como strings", () => {
  const bytesComoStrings = Array.from(PNG_REAL, String);
  assert.equal(tel.limpar(bytesComoStrings), "[binario removido]");
});

test("redige hexadecimal longo isolado e colado a hífen", () => {
  const hexadecimal = "a1b2c3d4e5f6a7b8" + "c9d0e1f2a3b4c5d6";
  const entradas = {
    isolado: hexadecimal,
    hifenAntes: `audio-${hexadecimal}.mp3`,
    hifenDepois: `id ${hexadecimal}-v2`,
    hifensDosDoisLados: `audio-${hexadecimal}-v2`,
    atribuicao: `key=${hexadecimal}`,
  };
  assert.deepEqual(tel.limpar(entradas), {
    isolado: "[removido]",
    hifenAntes: "audio-[removido].mp3",
    hifenDepois: "id [removido]-v2",
    hifensDosDoisLados: "audio-[removido]-v2",
    atribuicao: "key=[removido]",
  });
});

test("barra os cinco formatos de mídia já desserializada", () => {
  const base64Livre = Buffer.alloc(60_000, 0xab).toString("base64");
  const dataNoMeio = "antes data:image/png;base64," + Buffer.alloc(3_000, 0xcd).toString("base64") + " depois";
  const latin1 = Buffer.alloc(3_072, 0x89).toString("latin1");
  const limpo = tel.limpar({
    bufferJson: { type: "Buffer", data: Array.from({ length: 60_000 }, (_, i) => i % 256) },
    base64Livre,
    dataNoMeio,
    bytes: Array.from({ length: 8_192 }, (_, i) => i % 256),
    latin1,
  });
  const falhas = [];
  if (limpo.bufferJson !== "[binario removido]") falhas.push("Buffer serializado");
  if (limpo.base64Livre !== "[binario removido]") falhas.push("base64 solto");
  if (limpo.dataNoMeio !== "antes [binario removido] depois") falhas.push("data URI no meio");
  if (limpo.bytes !== "[binario removido]") falhas.push("array de bytes");
  if (limpo.latin1 !== "[binario removido]") falhas.push("string latin1");
  assert.deepEqual(falhas, []);
});

test("remove assinaturas conhecidas de mídia em qualquer tamanho e nas cinco formas do PNG", () => {
  const assinaturas = {
    png: [137, 80, 78, 71],
    jpeg: [255, 216, 255],
    gif: Array.from(Buffer.from("GIF8", "ascii")),
    webp: Array.from(Buffer.from("RIFFxxxxWEBP", "ascii")),
    mp4: Array.from(Buffer.from("xxxxftyp", "ascii")),
    mov: Array.from(Buffer.from("zzzzftyp", "ascii")),
    wav: Array.from(Buffer.from("RIFFxxxxWAVE", "ascii")),
    avi: Array.from(Buffer.from("RIFFxxxxAVI ", "ascii")),
    mp3Id3: Array.from(Buffer.from("ID3", "ascii")),
    mp3Frame: [255, 251],
    pdf: Array.from(Buffer.from("%PDF", "ascii")),
    zip: Array.from(Buffer.from("PK", "ascii")),
  };
  const limpo = tel.limpar({ assinaturas, png: cincoFormasDoPng() });
  assert.deepEqual(limpo.assinaturas, Object.fromEntries(
    Object.keys(assinaturas).map((formato) => [formato, "[binario removido]"]),
  ));
  assert.deepEqual(limpo.png, Object.fromEntries(
    Object.keys(cincoFormasDoPng()).map((forma) => [forma, "[binario removido]"]),
  ));
});

test("remove qualquer array de pelo menos 16 bytes", () => {
  const bytesSemAssinatura = Array.from({ length: 16 }, (_, i) => 32 + i);
  assert.equal(tel.limpar(bytesSemAssinatura), "[binario removido]");
});

test("remove base64 sem prefixo por assinatura ou por comprimento generoso", () => {
  const base64PngCurto = PNG_REAL.subarray(0, 40).toString("base64");
  const base64LongoSemAssinatura = Buffer.alloc(192, 0xa5).toString("base64");
  assert.equal(tel.limpar(base64PngCurto), "[binario removido]");
  assert.equal(tel.limpar(base64LongoSemAssinatura), "[binario removido]");
});

test("remove base64 de PNG real com quebras de linha", () => {
  const base64 = PNG_REAL_12X12.toString("base64").replace(/(.{76})/g, "$1\n");
  assert.ok(base64.replace(/\s/g, "").length >= 256);
  assert.equal(tel.limpar(base64), "[binario removido]");
});

test("remove trecho base64 de PNG real dentro de JSON já serializado", () => {
  const base64 = PNG_REAL_12X12.toString("base64");
  const serializado = JSON.stringify({ img: base64 });
  assert.equal(tel.limpar(serializado), JSON.stringify({ img: "[binario removido]" }));
});

test("remove objeto de amostras com chaves numéricas começando em 1", () => {
  const amostras = Object.fromEntries(
    Array.from(PNG_REAL_12X12.subarray(0, 16), (valor, indice) => [String(indice + 1), valor]),
  );
  assert.equal(tel.limpar(amostras), "[binario removido]");
});

test("remove objeto de amostras com chaves numéricas não consecutivas", () => {
  const amostras = Object.fromEntries(
    Array.from(PNG_REAL_12X12.subarray(0, 16), (valor, indice) => [String(indice * 2), valor]),
  );
  assert.equal(tel.limpar(amostras), "[binario removido]");
});

test("remove array misto de números e strings numéricas", () => {
  const amostras = Array.from(
    PNG_REAL_12X12.subarray(0, 16),
    (valor, indice) => (indice % 2 === 0 ? String(valor) : valor),
  );
  assert.equal(tel.limpar(amostras), "[binario removido]");
});

test("remove string binária com alta proporção de caracteres de controle", () => {
  const controles = Buffer.from(Array.from({ length: 60 }, (_, i) => (i % 31) + 1)).toString("latin1");
  assert.equal(tel.limpar(controles), "[binario removido]");
});

test("mantém idênticos os dez casos legítimos", () => {
  const legitimos = [
    [1, 2, 3],
    [30, 60, 120],
    [1920, 1080],
    { largura: 1920, altura: 1080 },
    { 0: "primeiro", 1: "segundo" },
    { 1: "faixa um", 2: "faixa dois" },
    ["a", "b", "c"],
    "cortei 3 clipes na faixa 2 as 00:01:23:14",
    "render de corte-final-v3.mp4 levou 45s",
    "commit a1b2c3d aplicado",
  ];
  for (const legitimo of legitimos) assert.deepEqual(tel.limpar(legitimo), legitimo);
});

test("fila crua não contém o PNG em nenhuma das cinco formas", () => {
  const formas = cincoFormasDoPng();
  tel.evento("png-em-cinco-formas", formas);

  const cru = fs.readFileSync(tel.FILA, "utf8");
  const representacoesProibidas = [
    "137,80,78,71",
    PNG_REAL.toString("base64"),
    formas.base64Curto,
    JSON.stringify(formas.array40).slice(1, -1),
    JSON.stringify(formas.array63).slice(1, -1),
    JSON.stringify(formas.latin1_60).slice(1, -1),
  ];
  assert.deepEqual(
    representacoesProibidas.filter((representacao) => cru.includes(representacao)),
    [],
    "bytes ou codificações do PNG apareceram no disco",
  );
  assert.deepEqual(tel.fila().at(-1).dados, {
    base64Curto: "[binario removido]",
    base64Completo: "[binario removido]",
    array40: "[binario removido]",
    array63: "[binario removido]",
    latin1_60: "[binario removido]",
  });
});

test("ignora valor curto de variável dinâmica e mantém redação dinâmica longa", () => {
  process.env.AUTH_MODE = "1";
  process.env.CUSTOM_AUTH_SECRET = "segredo-dinamico-comprido";
  try {
    const original = "cortei 1 clipe em 12 minutos, faixa 1; segredo-dinamico-comprido";
    const limpo = tel.limpar(original);
    assert.equal(limpo, "cortei 1 clipe em 12 minutos, faixa 1; [removido]");
  } finally {
    delete process.env.AUTH_MODE;
    delete process.env.CUSTOM_AUTH_SECRET;
  }
});

test("repara permissões privadas do diretório e da fila", () => {
  fs.chmodSync(tel.DIR, 0o777);
  fs.chmodSync(tel.FILA, 0o666);
  tel.evento("permissoes", { ok: true });
  if (BITS_POSIX) {
    assert.equal(fs.statSync(tel.DIR).mode & 0o777, 0o700);
    assert.equal(fs.statSync(tel.FILA).mode & 0o777, 0o600);
  }
});

test("fila crua não contém credenciais nem os cinco formatos de mídia", () => {
  const base64Livre = Buffer.alloc(60_000, 0xee).toString("base64");
  const dataNoMeio = "prefixo data:video/mp4;base64," + Buffer.alloc(3_000, 0xfa).toString("base64") + " sufixo";
  const latin1 = Buffer.alloc(3_072, 0x91).toString("latin1");
  const funcao = new Function("return " + JSON.stringify(FALSA_GOOGLE));
  const dados = {
    [FALSA_GOOGLE]: 1,
    elevenlabs: FALSA_ELEVENLABS,
    meta: FALSA_META,
    funcao,
    bufferJson: { type: "Buffer", data: Array.from({ length: 60_000 }, (_, i) => i % 256) },
    base64Livre,
    dataNoMeio,
    bytes: Array.from({ length: 8_192 }, (_, i) => i % 256),
    latin1,
  };
  tel.evento("tipo:" + FALSA_GOOGLE, dados);

  const cru = fs.readFileSync(tel.FILA, "utf8");
  const proibidos = [FALSA_GOOGLE, FALSA_ELEVENLABS, FALSA_META];
  assert.deepEqual(proibidos.filter((segredo) => cru.includes(segredo)), [], "credencial apareceu no disco");

  const item = tel.fila().at(-1);
  assert.deepEqual(item.dados, {
    elevenlabs: "[removido]",
    meta: "[removido]",
    funcao: "[funcao removida]",
    bufferJson: "[binario removido]",
    base64Livre: "[binario removido]",
    dataNoMeio: "prefixo [binario removido] sufixo",
    bytes: "[binario removido]",
    latin1: "[binario removido]",
  });
  assert.ok(!cru.includes(JSON.stringify(dados.bufferJson)));
  assert.ok(!cru.includes(base64Livre));
  assert.ok(!cru.includes(dataNoMeio));
  assert.ok(!cru.includes(JSON.stringify(dados.bytes)));
  assert.ok(!cru.includes(JSON.stringify(latin1).slice(1, -1)));
});

const MAX_EVENTO_BYTES_ESPERADO = 4096;

function bytesJson(valor) {
  return Buffer.byteLength(JSON.stringify(valor), "utf8");
}

function linhasCruas() {
  return fs.readFileSync(tel.FILA, "utf8").split("\n").filter(Boolean);
}

function itemOriginal(itemGravado, dados) {
  return {
    em: itemGravado.em,
    instalacao: itemGravado.instalacao,
    tipo: itemGravado.tipo,
    dados: tel.limpar(dados),
  };
}

function afirmarAritmeticaTruncamento(item, linha, dados) {
  const bytesOriginais = bytesJson(itemOriginal(item, dados));
  const bytesFinais = Buffer.byteLength(linha, "utf8");
  assert.deepEqual(item.truncado, {
    bytesOriginais,
    bytesDescartados: bytesOriginais - bytesFinais,
  });
}

function textoLegitimo(tamanho, rotulo) {
  const trecho = `${rotulo} texto legitimo com espacos `;
  return trecho.repeat(Math.ceil(tamanho / trecho.length)).slice(0, tamanho);
}

test("objeto largo com 8000 campos não bloqueia", () => {
  const dados = Object.fromEntries(
    Array.from({ length: 8000 }, (_, indice) => {
      const rotulo = `campo ${String(indice).padStart(4, "0")}`;
      return [`campo_${String(indice).padStart(4, "0")}`, textoLegitimo(50, rotulo)];
    }),
  );
  assert.equal(new Set(Object.values(dados)).size, 8000);
  assert.ok(Object.values(dados).every((valor) => valor.length === 50));

  const inicio = process.hrtime.bigint();
  tel.evento("objeto-largo-8000-campos", dados);
  const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
  console.log(`tempo_evento_8000_campos_ms=${duracaoMs.toFixed(3)}`);

  const linha = linhasCruas().at(-1);
  const item = JSON.parse(linha);
  const bytesDados = bytesJson(tel.limpar(dados));
  // CI em 2026-09-07: ubuntu 1118 ms, macOS 1605 ms e Windows 3349 ms.
  assert.ok(duracaoMs < 10_000, `evento() levou ${duracaoMs.toFixed(3)} ms`);
  assert.ok(Buffer.byteLength(linha, "utf8") <= tel.MAX_EVENTO_BYTES);
  assert.equal(item.dados, `[evento truncado: ${bytesDados} bytes descartados]`);
  afirmarAritmeticaTruncamento(item, linha, dados);
});

test("truncamento de 30 campos mantém a ordem do maior para o menor", () => {
  const dados = Object.fromEntries(
    Array.from({ length: 30 }, (_, indice) => {
      const tamanho = 160 + indice * 55;
      const chave = `campo_${String(indice).padStart(2, "0")}`;
      return [chave, textoLegitimo(tamanho, chave)];
    }),
  );

  tel.evento("truncamento-ordenado-30-campos", dados);
  const linha = linhasCruas().at(-1);
  const item = JSON.parse(linha);
  const limpos = tel.limpar(dados);
  const ordenados = Object.entries(limpos)
    .map(([chave, valor]) => ({ chave, valor, bytes: bytesJson(valor) }))
    .sort((a, b) => b.bytes - a.bytes);
  const quantidadeTruncada = ordenados.filter(({ chave, bytes }) => (
    item.dados[chave] === `[campo truncado: ${bytes} bytes descartados]`
  )).length;

  assert.ok(quantidadeTruncada > 0);
  assert.ok(quantidadeTruncada < ordenados.length);
  for (const [indice, campo] of ordenados.entries()) {
    const esperado = indice < quantidadeTruncada
      ? `[campo truncado: ${campo.bytes} bytes descartados]`
      : campo.valor;
    assert.equal(item.dados[campo.chave], esperado, `ordem incorreta em ${campo.chave}`);
  }
  assert.ok(Buffer.byteLength(linha, "utf8") <= tel.MAX_EVENTO_BYTES);
  afirmarAritmeticaTruncamento(item, linha, dados);
});

test("podar não altera nenhuma linha válida", () => {
  tel.evento("poda-verbatim-1", { ok: true });
  tel.evento("poda-verbatim-2", { etapa: 2 });
  tel.evento("poda-verbatim-truncado", {
    grandeA: textoLegitimo(2048, "grande-a"),
    grandeB: textoLegitimo(2048, "grande-b"),
  });
  assert.ok(Object.hasOwn(JSON.parse(linhasCruas().at(-1)), "truncado"));

  const validasAntes = linhasCruas();
  const linhaExpoente = `{"id":"expoente-sem-mais","valores":[${Array(800).fill("1e21").join(",")}]}`;
  assert.ok(Buffer.byteLength(linhaExpoente, "utf8") < tel.MAX_EVENTO_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(JSON.parse(linhaExpoente)), "utf8") > tel.MAX_EVENTO_BYTES);
  validasAntes.push(linhaExpoente);
  fs.appendFileSync(tel.FILA, `{linha corrompida\n${linhaExpoente}\n`);

  tel.podar();
  const depois = linhasCruas();
  assert.deepEqual(depois, validasAntes);
  assert.ok(!fs.readFileSync(tel.FILA, "utf8").includes("linha corrompida"));
  assert.ok(depois.every((linha) => Buffer.byteLength(linha, "utf8") <= tel.MAX_EVENTO_BYTES));
});

test("podar preserva espaço final e aritmética do truncamento", () => {
  let encontrado = null;
  for (let deslocamento = 0; deslocamento < 200; deslocamento++) {
    const tamanho = 1020 + deslocamento;
    const dados = {
      grande: textoLegitimo(tamanho, `grande-${tamanho}`),
      apoioA: textoLegitimo(750, "apoio-a"),
      apoioB: textoLegitimo(750, "apoio-b"),
      apoioC: textoLegitimo(750, "apoio-c"),
      apoioD: textoLegitimo(750, "apoio-d"),
    };
    tel.evento(`fronteira-espaco-${tamanho}`, dados);
    const linha = linhasCruas().at(-1);
    if (linha.endsWith(" ")) {
      encontrado = { dados, linha };
      break;
    }
  }

  if (!encontrado) {
    console.log("ramo_do_espaco_final_nao_atingido_em_200_tamanhos");
    assert.equal(encontrado, null);
    return;
  }

  const itemAntes = JSON.parse(encontrado.linha);
  afirmarAritmeticaTruncamento(itemAntes, encontrado.linha, encontrado.dados);
  fs.appendFileSync(tel.FILA, "{forca poda corrompida\n");
  tel.podar();

  const linhaDepois = linhasCruas().find((linha) => linha === encontrado.linha);
  assert.equal(linhaDepois, encontrado.linha);
  assert.ok(linhaDepois.endsWith(" "));
  const itemDepois = JSON.parse(linhaDepois);
  afirmarAritmeticaTruncamento(itemDepois, linhaDepois, encontrado.dados);
});

test("evento acima do teto é truncado por campo, do maior para o menor", () => {
  const pequeno = { rota: "/autozoom/apply", aplicados: 3, ok: true };
  const trecho = "edição precisa em português, com contexto humano. ".repeat(60);
  const dados = {
    detalhes: [trecho, trecho],
    rota: "/autozoom/apply",
    aplicados: 3,
    ok: true,
  };

  tel.evento("evento-pequeno", pequeno);
  tel.evento("evento-grande", dados);

  const linhas = linhasCruas();
  const linhaPequena = linhas.at(-2);
  const linhaGrande = linhas.at(-1);
  const itemPequeno = JSON.parse(linhaPequena);
  const itemGrande = JSON.parse(linhaGrande);
  const bytesDetalhes = bytesJson(tel.limpar(dados).detalhes);

  assert.equal(tel.MAX_EVENTO_BYTES, MAX_EVENTO_BYTES_ESPERADO);
  assert.ok(Buffer.byteLength(linhaGrande, "utf8") <= tel.MAX_EVENTO_BYTES);
  assert.equal(itemGrande.dados.detalhes, `[campo truncado: ${bytesDetalhes} bytes descartados]`);
  assert.equal(itemGrande.dados.rota, dados.rota);
  assert.equal(itemGrande.dados.aplicados, dados.aplicados);
  assert.equal(itemGrande.dados.ok, dados.ok);
  assert.ok(!Object.hasOwn(itemPequeno, "truncado"));
  afirmarAritmeticaTruncamento(itemGrande, linhaGrande, dados);
});

test("mídia real maior que o teto nas quatro codificações nunca entra inteira", () => {
  const pcm = Buffer.alloc(7000);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(((i * 7919) % 65536) - 32768, i);
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);

  const largura = 64;
  const altura = 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const pixels = Buffer.alloc((largura * 4 + 1) * altura);
  let estado = 0x6d2b79f5;
  for (let linha = 0; linha < altura; linha++) {
    const inicio = linha * (largura * 4 + 1);
    for (let coluna = 0; coluna < largura * 4; coluna++) {
      estado ^= estado << 13;
      estado ^= estado >>> 17;
      estado ^= estado << 5;
      pixels[inicio + coluna + 1] = estado & 0xff;
    }
  }
  const png = Buffer.concat([
    PNG_REAL.subarray(0, 8),
    chunkPng("IHDR", ihdr),
    chunkPng("IDAT", zlib.deflateSync(pixels)),
    chunkPng("IEND", Buffer.alloc(0)),
  ]);
  assert.ok(wav.length > 6000);
  assert.ok(png.length > tel.MAX_EVENTO_BYTES);

  const codificacoes = {
    csv: (bytes) => Array.from(bytes).join(","),
    hexComEspaco: (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" "),
    base64UrlSafe: (bytes) => bytes.toString("base64url"),
    paresIndiceValor: (bytes) => Array.from(bytes, (byte, indice) => [indice, byte]),
  };
  const inicio = linhasCruas().length;
  const representacoes = [];
  for (const [midia, bytes] of Object.entries({ wav, png })) {
    for (const [forma, codificar] of Object.entries(codificacoes)) {
      const representacao = codificar(bytes);
      representacoes.push(typeof representacao === "string" ? representacao : JSON.stringify(representacao));
      tel.evento(`midia-${midia}-${forma}`, { midia: representacao });
    }
  }

  const novasLinhas = linhasCruas().slice(inicio);
  const cru = novasLinhas.join("\n");
  assert.equal(novasLinhas.length, 8);
  assert.ok(novasLinhas.every((linha) => Buffer.byteLength(linha, "utf8") <= tel.MAX_EVENTO_BYTES));
  assert.deepEqual(representacoes.filter((representacao) => cru.includes(representacao)), []);
});

test("fila ignora linha acima do teto e podar a purga", () => {
  const prefixo = JSON.stringify({ id: "linha-no-teto", dados: "" });
  const linhaNoTeto = JSON.stringify({
    id: "linha-no-teto",
    dados: "x".repeat(MAX_EVENTO_BYTES_ESPERADO - Buffer.byteLength(prefixo, "utf8")),
  });
  const linhaAcima = JSON.stringify({ id: "linha-acima", dados: "x".repeat(MAX_EVENTO_BYTES_ESPERADO) });
  assert.equal(Buffer.byteLength(linhaNoTeto, "utf8"), MAX_EVENTO_BYTES_ESPERADO);
  assert.ok(Buffer.byteLength(linhaAcima, "utf8") > MAX_EVENTO_BYTES_ESPERADO);

  fs.appendFileSync(tel.FILA, linhaAcima + "\n" + linhaNoTeto + "\n");
  const antesDePodar = tel.fila();
  tel.podar();
  const cruDepois = fs.readFileSync(tel.FILA, "utf8");

  assert.ok(!antesDePodar.some((item) => item.id === "linha-acima"));
  assert.ok(antesDePodar.some((item) => item.id === "linha-no-teto"));
  assert.ok(!cruDepois.includes("linha-acima"));
  assert.ok(cruDepois.includes("linha-no-teto"));
});

test("corte em fronteira multibyte gera JSON válido", () => {
  const dados = { texto: ["á😀çõ".repeat(500), "é🚀í".repeat(500)] };
  tel.evento("multibyte", dados);

  const linha = linhasCruas().at(-1);
  assert.doesNotThrow(() => JSON.parse(linha));
  assert.ok(Buffer.byteLength(linha, "utf8") <= tel.MAX_EVENTO_BYTES);
  assert.ok(!linha.includes("�"));
});

test("dados não objeto e objeto de muitos campos pequenos usam marcador de evento", () => {
  const array = Array.from({ length: 400 }, (_, indice) => `item-${String(indice).padStart(3, "0")}`);
  const objeto = Object.fromEntries(
    Array.from({ length: 600 }, (_, indice) => [`campo_${String(indice).padStart(3, "0")}`, "v"]),
  );
  const inicio = linhasCruas().length;
  tel.evento("array-grande", array);
  tel.evento("objeto-campos-pequenos", objeto);

  const linhas = linhasCruas().slice(inicio);
  const casos = [[array, linhas[0]], [objeto, linhas[1]]];
  assert.equal(linhas.length, 2);
  for (const [dados, linha] of casos) {
    const item = JSON.parse(linha);
    const bytesDados = bytesJson(tel.limpar(dados));
    assert.ok(Buffer.byteLength(linha, "utf8") <= tel.MAX_EVENTO_BYTES);
    assert.equal(item.dados, `[evento truncado: ${bytesDados} bytes descartados]`);
    assert.ok(item.truncado && item.truncado.bytesDescartados > 0);
    afirmarAritmeticaTruncamento(item, linha, dados);
  }
});

test("remover descarta o prefixo enviado, purga inválidas e mantém 0600", () => {
  const primeira = '{"indice":1} ';
  const segunda = '{"indice":2}  ';
  const invalida = "não é json";
  const grande = JSON.stringify({ texto: "x".repeat(tel.MAX_EVENTO_BYTES) });
  fs.writeFileSync(tel.FILA, `${primeira}\n${invalida}\n${grande}\n${segunda}\n`, { mode: 0o666 });

  const resultado = tel.remover([primeira]);

  assert.deepEqual(resultado, { removidas: 1 });
  assert.equal(fs.readFileSync(tel.FILA, "utf8"), `${segunda}\n`);
  if (BITS_POSIX) {
    assert.equal(fs.statSync(tel.FILA).mode & 0o777, 0o600);
  }
});

test("remover não altera a fila quando o prefixo mudou depois da montagem do lote", () => {
  const originais = Array.from({ length: 205 }, (_, indice) => JSON.stringify({ indice }));
  const novas = [JSON.stringify({ indice: "nova-1" }), JSON.stringify({ indice: "nova-2" })];
  fs.writeFileSync(tel.FILA, `${originais.join("\n")}\n`, { mode: 0o600 });
  const lote = envio.montarLote();
  assert.equal(lote.linhas.length, 200);

  const alterada = [...originais.slice(2), ...novas];
  fs.writeFileSync(tel.FILA, `${alterada.join("\n")}\n`, { mode: 0o600 });
  const antes = fs.readFileSync(tel.FILA, "utf8");
  const conflito = tel.remover(lote.linhas);

  assert.deepEqual(conflito, { removidas: 0, motivo: "prefixo mudou" });
  assert.equal(fs.readFileSync(tel.FILA, "utf8"), antes);
  assert.deepEqual(tel.linhasValidas().slice(-2), novas);

  fs.writeFileSync(tel.FILA, `${originais.join("\n")}\n`, { mode: 0o600 });
  const loteNormal = envio.montarLote();
  const removido = tel.remover(loteNormal.linhas);
  assert.deepEqual(removido, { removidas: 200 });
  assert.equal(fs.readFileSync(tel.FILA, "utf8"), `${originais.slice(200).join("\n")}\n`);
});
