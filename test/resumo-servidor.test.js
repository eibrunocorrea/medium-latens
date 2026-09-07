"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function carregarResumo(opcoes = {}) {
  const inicio = serverSource.indexOf("// ---------- resumo da sessão ----------");
  const fim = serverSource.indexOf("// ---------- HTTP ----------", inicio);
  assert.ok(inicio >= 0 && fim > inicio, "bloco do resumo da sessão não encontrado");

  let agora = Date.parse("2026-08-25T10:00:00.000Z");
  class DataControlada extends Date {
    constructor(valor) { super(valor === undefined ? agora : valor); }
    static now() { return agora; }
  }
  let intervalo;
  const timers = [];
  const chamadas = [];
  const spawns = [];
  const filhos = [];
  const sinais = new Map();
  const mortes = [];
  const exits = [];
  let fechamentos = 0;
  const gerar = opcoes.gerar || (async () => ({ objetivo: "ok" }));
  const registrarSinal = (sinal, fn) => {
    const lista = sinais.get(sinal) || [];
    lista.push(fn);
    sinais.set(sinal, lista);
  };
  const sandbox = {
    Date: DataControlada,
    setInterval(fn, ms) {
      intervalo = { fn, ms, unrefChamado: false, unref() { this.unrefChamado = true; } };
      return intervalo;
    },
    setTimeout(fn, ms) {
      const timer = { fn, ms, limpo: false, unrefChamado: false, unref() { this.unrefChamado = true; } };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.limpo = true; },
    busy: false,
    busySince: 0,
    agentCwd: () => "/tmp/medium-latens-teste",
    settings: { load: () => ({ profile: "perfil-teste" }) },
    profiles: {
      get: () => ({ provider: "claude", authMode: "assinatura" }),
      envFor: () => ({}),
    },
    provider: {
      get: () => ({
        run(opts, onEvent) {
          spawns.push({ opts, onEvent });
          const filho = { sinais: [], kill(sinal) { this.sinais.push(sinal); } };
          filhos.push(filho);
          return filho;
        },
      }),
    },
    resumoSessao: {
      deveRodar: ({ ocupado, jaRodou, eventos }) => !ocupado && !jaRodou && eventos > 0,
      gerar: (opts) => { chamadas.push(opts); return gerar(opts); },
    },
    server: { close() { fechamentos++; } },
    process: {
      pid: 4242,
      on: registrarSinal,
      once: registrarSinal,
      removeListener(sinal, fn) {
        sinais.set(sinal, (sinais.get(sinal) || []).filter((item) => item !== fn));
      },
      kill(pid, sinal) { mortes.push({ pid, sinal }); return true; },
      exit(codigo) { exits.push(codigo); },
    },
  };
  vm.runInNewContext(
    `${serverSource.slice(inicio, fim)}\n` +
      "globalThis.apiResumo = { resumo, iniciarAtividadeResumo, concluirAtividadeResumo, " +
      "podeRodarResumo, chamarResumo, encerrarComResumo };",
    sandbox,
  );
  return {
    api: sandbox.apiResumo,
    chamadas,
    spawns,
    filhos,
    intervalo,
    timers,
    sinais,
    mortes,
    exits,
    avancar(ms) { agora += ms; },
    agora() { return agora; },
    ocupado(valor) { sandbox.busy = valor; },
    busyDesde(valor) { sandbox.busySince = valor; },
    fechamentos() { return fechamentos; },
    timer(ms) { return timers.find((item) => item.ms === ms && !item.limpo); },
  };
}

test("brief e autozoom concluem com o início capturado da própria requisição", () => {
  const inicioBrief = serverSource.indexOf('if (url.pathname === "/brief/generate"');
  const fimBrief = serverSource.indexOf('if (url.pathname === "/brief"', inicioBrief + 1);
  const inicioAutozoom = serverSource.indexOf('if (url.pathname === "/autozoom/apply"');
  const fimAutozoom = serverSource.indexOf("\n\n  res.statusCode = 404", inicioAutozoom);
  assert.ok(inicioBrief >= 0 && fimBrief > inicioBrief, "rota /brief/generate não encontrada");
  assert.ok(inicioAutozoom >= 0 && fimAutozoom > inicioAutozoom, "rota /autozoom/apply não encontrada");

  const brief = serverSource.slice(inicioBrief, fimBrief);
  const autozoom = serverSource.slice(inicioAutozoom, fimAutozoom);
  assert.match(brief, /const inicioBrief = busySince;/);
  assert.match(brief, /iniciarAtividadeResumo\(inicioBrief\)/);
  assert.match(brief, /concluirAtividadeResumo\(inicioBrief\)/);
  assert.match(autozoom, /concluirAtividadeResumo\(myTurn\)/);
  assert.doesNotMatch(serverSource, /concluirAtividadeResumo\(busySince\)/);
});

test("resumo roda uma vez somente após 120 segundos de ociosidade", async () => {
  const h = carregarResumo();
  assert.equal(h.intervalo.ms, 30000);
  assert.equal(h.intervalo.unrefChamado, true);
  assert.equal(h.api.podeRodarResumo(), false);

  const inicioTurno = h.agora();
  h.api.iniciarAtividadeResumo(inicioTurno);
  h.api.concluirAtividadeResumo(inicioTurno);
  h.avancar(119000);
  assert.equal(h.api.podeRodarResumo(), false);
  h.avancar(1000);
  assert.equal(h.api.podeRodarResumo(), true);

  h.intervalo.fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.chamadas.length, 1);
  assert.equal(h.api.resumo.jaRodou, true);
  assert.equal(h.api.resumo.rodando, false);

  const novoInicio = h.agora();
  h.api.iniciarAtividadeResumo(novoInicio);
  h.api.concluirAtividadeResumo(novoInicio);
  assert.equal(h.api.resumo.jaRodou, false);
  assert.equal(h.api.resumo.turnos, 1);
});

test("chamarResumo rejeita sem spawnar quando um turno começou", async () => {
  const h = carregarResumo();
  h.ocupado(true);
  const chamada = h.api.chamarResumo({ modelo: "apelido", prompt: "resuma", maxTokens: 1200 });
  assert.equal(h.spawns.length, 0);
  await assert.rejects(chamada, /turno em andamento/);
});

test("timeout do resumo mata o filho e rejeita", async () => {
  const h = carregarResumo();
  const chamada = h.api.chamarResumo({ modelo: "apelido", prompt: "resuma", maxTokens: 1200 });
  assert.equal(h.spawns.length, 1);
  const timeout = h.timer(90000);
  assert.ok(timeout, "timeout de 90 segundos não instalado");
  assert.equal(timeout.unrefChamado, true);
  const rejeicao = assert.rejects(chamada, /resumo demorou demais/);
  timeout.fn();
  await rejeicao;
  assert.deepEqual(h.filhos[0].sinais, ["SIGTERM"]);
});

test("SIGTERM durante turno fecha o servidor e morre pelo próprio sinal", () => {
  const h = carregarResumo();
  h.ocupado(true);
  h.api.encerrarComResumo("SIGTERM");
  assert.ok(h.fechamentos() >= 1);
  assert.equal(h.chamadas.length, 0);
  assert.deepEqual(h.mortes, [{ pid: 4242, sinal: "SIGTERM" }]);
  assert.deepEqual(h.exits, []);
});

test("SIGTERM aguarda o resumo antes de morrer pelo próprio sinal", async () => {
  let resolver;
  const pendente = new Promise((resolve) => { resolver = resolve; });
  const h = carregarResumo({ gerar: () => pendente });
  const inicioTurno = h.agora();
  h.api.iniciarAtividadeResumo(inicioTurno);
  h.api.concluirAtividadeResumo(inicioTurno);

  h.api.encerrarComResumo("SIGTERM");
  assert.equal(h.chamadas.length, 1);
  assert.deepEqual(h.mortes, []);
  resolver({ objetivo: "ok" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.mortes, [{ pid: 4242, sinal: "SIGTERM" }]);
  assert.deepEqual(h.exits, []);
});

test("turno sobreposto reabre a sessão desde o início do turno", () => {
  const h = carregarResumo();
  const inicioTurno = h.agora();
  h.api.iniciarAtividadeResumo(inicioTurno);
  h.avancar(30000);
  h.busyDesde(h.agora() + 60000);
  h.api.resumo.jaRodou = true;
  h.api.concluirAtividadeResumo(inicioTurno);

  assert.equal(h.api.resumo.eventosDesde, new Date(inicioTurno).toISOString());
  assert.equal(h.api.resumo.ultimaAtividade, h.agora());
  assert.equal(h.api.resumo.jaRodou, false);
  assert.equal(h.api.resumo.turnos, 1);
});
