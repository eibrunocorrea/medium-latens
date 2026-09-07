"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-envio-"));
process.env.MEDIUM_LATENS_USER_DIR = USER_DIR;
process.env.MEDIUM_LATENS_COLETA_URL = "";

const telemetria = require("../lib/telemetria");
const envio = require("../lib/envio");
const settings = require("../lib/settings");
const BITS_POSIX = process.platform !== "win32"; // NTFS não expõe bits de modo; a proteção vem da ACL do perfil do usuário

test.after(() => fs.rmSync(USER_DIR, { recursive: true, force: true }));

test("configuração tem o endereço oficial e a variável de ambiente pode desligar o envio", () => {
  const configFile = path.join(USER_DIR, "config.json");
  fs.rmSync(configFile, { force: true });
  delete process.env.MEDIUM_LATENS_COLETA_URL;
  assert.equal(settings.DEFAULTS.coletaUrl, "https://coleta.torremaster.com/v1/eventos");
  assert.equal(settings.load().coletaUrl, settings.DEFAULTS.coletaUrl);
  settings.save({ model: "x" });
  const persisted = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.deepEqual(persisted, { model: "x" });
  if (BITS_POSIX) {
    assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  }
  assert.equal(Object.hasOwn(persisted, "coletaUrl"), false);
  assert.equal(settings.load().coletaUrl, settings.DEFAULTS.coletaUrl);
  process.env.MEDIUM_LATENS_COLETA_URL = "";
  assert.equal(settings.load().coletaUrl, "");
});

function linha(indice, tamanho = 2900) {
  return JSON.stringify({ indice, texto: String(indice).padStart(4, "0") + "x".repeat(tamanho) });
}

function gravarFila(linhas) {
  fs.mkdirSync(telemetria.DIR, { recursive: true });
  fs.writeFileSync(telemetria.FILA, linhas.length ? `${linhas.join("\n")}\n` : "", { mode: 0o600 });
}

function lerFilaCrua() {
  try { return fs.readFileSync(telemetria.FILA, "utf8"); } catch { return ""; }
}

function ouvir(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const porta = server.address().port;
      assert.notEqual(porta, 8765, "o receptor falso nunca pode tocar a porta 8765");
      resolve(porta);
    });
  });
}

function fechar(server) {
  return new Promise((resolve, reject) => server.close((erro) => (erro ? reject(erro) : resolve())));
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    let corpo = "";
    req.setEncoding("utf8");
    req.on("data", (trecho) => { corpo += trecho; });
    req.on("end", () => resolve(corpo));
  });
}

test("sem aceite não envia nem toca na fila", async () => {
  fs.rmSync(path.join(telemetria.DIR, "aceite.json"), { force: true });
  const linhas = [linha(1)];
  gravarFila(linhas);
  let chamadas = 0;

  const resultado = await envio.enviarLote({
    url: "http://127.0.0.1:1/v1/eventos",
    fetch: async () => { chamadas += 1; throw new Error("não deveria chamar"); },
  });

  assert.deepEqual(resultado, { enviado: 0, motivo: "sem_aceite" });
  assert.equal(chamadas, 0);
  assert.equal(lerFilaCrua(), `${linhas.join("\n")}\n`);
});

test("endereço vazio desliga o envio sem perder a fila", async () => {
  process.env.MEDIUM_LATENS_COLETA_URL = "";
  telemetria.registrarAceite("1.0");
  const linhas = [linha(1)];
  gravarFila(linhas);
  let chamadas = 0;
  const resultado = await envio.enviarLote({
    fetch: async () => { chamadas += 1; throw new Error("não deveria chamar"); },
  });

  assert.deepEqual(resultado, { enviado: 0, motivo: "sem_url" });
  assert.equal(chamadas, 0);
  assert.equal(lerFilaCrua(), `${linhas.join("\n")}\n`);
});

test("envia NDJSON real em lote, respeita os limites e remove somente a frente confirmada", async () => {
  telemetria.registrarAceite("1.7");
  const linhas = Array.from({ length: 250 }, (_, indice) => linha(indice));
  gravarFila(linhas);
  let recebido;
  const server = http.createServer(async (req, res) => {
    const corpo = await lerCorpo(req);
    recebido = { corpo, headers: req.headers };
    const quantidade = corpo.trimEnd().split("\n").length;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, recebidos: quantidade }));
  });
  const porta = await ouvir(server);

  try {
    const resultado = await envio.enviarLote({ url: `http://127.0.0.1:${porta}/v1/eventos` });
    assert.deepEqual(resultado, { enviado: 200 });
  } finally {
    await fechar(server);
  }

  const linhasRecebidas = recebido.corpo.trimEnd().split("\n");
  assert.equal(linhasRecebidas.length, 200);
  assert.equal(recebido.corpo, `${linhas.slice(0, 200).join("\n")}\n`);
  assert.ok(Buffer.byteLength(recebido.corpo) <= envio.LOTE_MAX_BYTES);
  assert.equal(recebido.headers["content-type"], "application/x-ndjson");
  assert.equal(recebido.headers["x-medium-latens-app"], envio.IDENTIFICADOR_APP);
  assert.equal(recebido.headers["x-termos"], "1.7");
  assert.match(recebido.headers["x-instalacao"], /^[0-9a-f-]{36}$/);
  assert.match(recebido.headers["user-agent"], /^MediumLatens\//);
  assert.equal(lerFilaCrua(), `${linhas.slice(200).join("\n")}\n`);
});

test("503 e falha de conexão preservam a fila e pedem repetição", async () => {
  telemetria.registrarAceite("1.0");
  const linhas = [linha(1), linha(2)];
  gravarFila(linhas);
  const original = lerFilaCrua();
  const server = http.createServer(async (req, res) => {
    await lerCorpo(req);
    res.writeHead(503);
    res.end("indisponível");
  });
  const porta = await ouvir(server);
  const url = `http://127.0.0.1:${porta}/v1/eventos`;

  const indisponivel = await envio.enviarLote({ url });
  assert.equal(indisponivel.enviado, 0);
  assert.equal(indisponivel.repetir, true);
  assert.equal(lerFilaCrua(), original);

  await fechar(server);
  const conexao = await envio.enviarLote({ url });
  assert.equal(conexao.enviado, 0);
  assert.equal(conexao.repetir, true);
  assert.equal(lerFilaCrua(), original);
});

test("401 e 403 pedem repetição sem tocar na fila", async () => {
  telemetria.registrarAceite("1.0");
  const linhas = [linha(1), linha(2)];

  for (const status of [401, 403]) {
    gravarFila(linhas);
    const original = lerFilaCrua();
    const resultado = await envio.enviarLote({
      url: "http://127.0.0.1:1/v1/eventos",
      fetch: async () => ({ status }),
    });

    assert.deepEqual(resultado, { enviado: 0, repetir: true, motivo: `http_${status}` });
    assert.equal(lerFilaCrua(), original);
  }
});

test("envio não segue redirecionamento do receptor", async () => {
  telemetria.registrarAceite("1.0");
  gravarFila([linha(1)]);
  let opcoes;

  const resultado = await envio.enviarLote({
    url: "https://coleta.exemplo.test/v1/eventos",
    fetch: async (_url, recebidas) => {
      opcoes = recebidas;
      return { status: 307 };
    },
  });

  assert.equal(opcoes.redirect, "manual");
  assert.deepEqual(resultado, { enviado: 0, repetir: true, motivo: "http_307" });
  assert.equal(telemetria.fila().length, 1);
});

test("400 descarta o lote recusado e preserva o restante byte a byte", async () => {
  telemetria.registrarAceite("1.0");
  const linhas = Array.from({ length: 205 }, (_, indice) => linha(indice, 20));
  gravarFila(linhas);
  const server = http.createServer(async (req, res) => {
    await lerCorpo(req);
    res.writeHead(400);
    res.end("inválido");
  });
  const porta = await ouvir(server);

  try {
    const resultado = await envio.enviarLote({ url: `http://127.0.0.1:${porta}/v1/eventos` });
    assert.equal(resultado.enviado, 0);
    assert.equal(resultado.descartado, 200);
    assert.equal(resultado.motivo, "http_400");
  } finally {
    await fechar(server);
  }
  assert.equal(lerFilaCrua(), `${linhas.slice(200).join("\n")}\n`);
});

test("404 repete sem tocar a fila e 413 descarta somente o lote recusado", async () => {
  telemetria.registrarAceite("1.0");
  const linhas = Array.from({ length: 205 }, (_, indice) => linha(indice, 20));
  gravarFila(linhas);
  const original = lerFilaCrua();

  const responder = async (status) => {
    const server = http.createServer(async (req, res) => {
      await lerCorpo(req);
      res.writeHead(status);
      res.end("recusado");
    });
    const porta = await ouvir(server);
    try {
      return await envio.enviarLote({ url: `http://127.0.0.1:${porta}/v1/eventos` });
    } finally {
      await fechar(server);
    }
  };

  const ausente = await responder(404);
  assert.deepEqual(ausente, { enviado: 0, repetir: true, motivo: "http_404" });
  assert.equal(lerFilaCrua(), original);

  const grande = await responder(413);
  assert.deepEqual(grande, { enviado: 0, descartado: 200, motivo: "http_413" });
  assert.equal(lerFilaCrua(), `${linhas.slice(200).join("\n")}\n`);
});

test("corpo da fila e token do aplicativo nunca aparecem no console", async () => {
  telemetria.registrarAceite("1.0");
  const marcador = "PROMPT-PRIVADO-NAO-LOGAR";
  gravarFila([JSON.stringify({ marcador })]);
  const mensagens = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args) => mensagens.push(args.join(" "));
  console.error = (...args) => mensagens.push(args.join(" "));
  try {
    const resultado = await envio.enviarLote({ url: "http://127.0.0.1:1/v1/eventos" });
    assert.equal(resultado.repetir, true);
  } finally {
    console.log = log;
    console.error = error;
  }
  const saida = mensagens.join("\n");
  assert.doesNotMatch(saida, new RegExp(marcador));
  assert.doesNotMatch(saida, new RegExp(envio.IDENTIFICADOR_APP));
});

test("agendamento recua até 30 minutos, zera após sucesso e limita cada tique a dez lotes", async () => {
  let agora = Date.parse("2026-08-26T12:00:00.000Z");
  const intervalos = [];
  const timeouts = [];
  let resultados = Array.from({ length: 6 }, () => ({ enviado: 0, repetir: true, motivo: "rede" }));
  let chamadas = 0;
  const criarTimer = (destino) => (fn, ms) => {
    const timer = { fn, ms, unrefChamado: false, unref() { this.unrefChamado = true; } };
    destino.push(timer);
    return timer;
  };
  const enviar = async () => {
    chamadas += 1;
    return resultados.shift() || { enviado: 0, motivo: "fila_vazia" };
  };

  envio.agendar({
    enviar,
    now: () => agora,
    setInterval: criarTimer(intervalos),
    setTimeout: criarTimer(timeouts),
  });

  assert.equal(intervalos.length, 1);
  const intervaloMs = 5 * 60 * 1000;
  assert.equal(intervalos[0].ms, intervaloMs);
  assert.equal(intervalos[0].unrefChamado, true);
  assert.equal(timeouts[0].ms, 60_000);
  assert.equal(timeouts[0].unrefChamado, true);

  const atrasos = [60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000];
  let proximo = timeouts[0];
  for (const atraso of atrasos) {
    agora += proximo.ms;
    await proximo.fn();
    assert.equal(envio.estado().proximaTentativa, new Date(agora + atraso).toISOString());
    proximo = timeouts.at(-1);
    assert.equal(proximo.ms, atraso);
  }

  resultados = [{ enviado: 1 }, { enviado: 0, motivo: "fila_vazia" }];
  agora += proximo.ms;
  await proximo.fn();
  assert.equal(envio.estado().ultimoResultado, "ok");
  assert.equal(envio.estado().enviados, 1);
  assert.equal(envio.estado().proximaTentativa, null);

  resultados = [{ enviado: 1 }, { enviado: 0, motivo: "fila_vazia" }];
  const antesPrimeiroTique = chamadas;
  await intervalos[0].fn();
  assert.equal(chamadas - antesPrimeiroTique, 2);

  resultados = [{ enviado: 1 }, { enviado: 0, motivo: "fila_vazia" }];
  const antesSegundoTique = chamadas;
  await intervalos[0].fn();
  assert.equal(chamadas - antesSegundoTique, 2);

  resultados = Array.from({ length: 12 }, () => ({ enviado: 1 }));
  agora += intervaloMs;
  const antes = chamadas;
  await intervalos[0].fn();
  assert.equal(chamadas - antes, 10);

  resultados = [{ enviado: 0, repetir: true, motivo: "rede" }];
  agora += intervaloMs;
  await intervalos[0].fn();
  assert.equal(envio.estado().proximaTentativa, new Date(agora + 60_000).toISOString());
});

test("os termos cobrem coleta, exclusão, mídia, IA e licença em até 120 linhas", () => {
  const termos = fs.readFileSync(path.join(__dirname, "..", "TERMOS.md"), "utf8");
  assert.match(termos, /^# Termos de uso do Medium Latens \(versão 2\.0\)$/m);
  assert.match(termos, /versão alpha/i);
  assert.match(termos, /gratuito/i);
  assert.match(termos, /treinar.*inteligência artificial/is);
  assert.match(termos, /arquivos de mídia nunca são enviados/i);
  assert.match(termos, /4 KB/i);
  assert.match(termos, /contato@mediumlatens\.com/);
  assert.match(termos, /coleta\.torremaster\.com/);
  assert.match(termos, /%APPDATA%\\Medium Latens\\telemetria\\/);
  assert.match(termos, /~\/\.medium-latens\/telemetria\//);
  assert.match(termos, /GNU Affero General Public License/i);
  assert.ok(termos.trimEnd().split("\n").length <= 120);
  assert.doesNotMatch(termos, /—/);
});

test("o servidor agenda a coleta uma única vez sem bloquear a inicialização", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /\/\/ ---------- envio da coleta ----------\s+envio\.agendar\(\);/);
  assert.equal((source.match(/envio\.agendar\(\)/g) || []).length, 1);
});

test("o identificador do app não se apresenta como segredo", () => {
  assert.equal(Object.hasOwn(envio, "APP_TOKEN"), false);
  assert.match(envio.IDENTIFICADOR_APP, /^[0-9a-f]{32}$/);
  const fonte = fs.readFileSync(path.join(__dirname, "..", "lib", "envio.js"), "utf8");
  assert.doesNotMatch(fonte, /APP_TOKEN/);
  assert.match(fonte, /não é segredo/);
});
