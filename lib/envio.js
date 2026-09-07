"use strict";

const fs = require("node:fs");
const path = require("node:path");
const telemetria = require("./telemetria");
const settings = require("./settings");
const termos = require("./termos");

const LOTE_MAX_ITENS = 200;
const LOTE_MAX_BYTES = 1_000_000;
// Identificador fixo do aplicativo, enviado em x-medium-latens-app. É um filtro público de ruído
// no receptor, não é segredo: o código é aberto e o valor já saía em qualquer instalador. O que
// protege o receptor são os limites de taxa por instalação e por IP e o teto de armazenamento.
const IDENTIFICADOR_APP = "ed6d78c70b7690ab9dfe91d3927689d6";
const INTERVALO_MS = 5 * 60 * 1000;
const PRIMEIRA_TENTATIVA_MS = 60 * 1000;
const RECUO_MAX_MS = 30 * 60 * 1000;
const DESCARTAR = new Set([400, 413]);
const VERSION = (() => {
  try { return fs.readFileSync(path.join(__dirname, "..", "VERSION"), "utf8").trim(); }
  catch { return "desconhecida"; }
})();

const registro = {
  ultimoEnvio: null,
  ultimoResultado: "nunca",
  ultimaMensagem: "Nenhuma tentativa de envio foi feita.",
  enviados: 0,
  descartados: 0,
  proximaTentativa: null,
};
let agendamento = null;

function montarLote() {
  const linhas = [];
  let bytes = 0;
  for (const linha of telemetria.linhasValidas()) {
    const tamanho = Buffer.byteLength(linha, "utf8") + 1;
    if (linhas.length >= LOTE_MAX_ITENS) break;
    if (linhas.length > 0 && bytes + tamanho > LOTE_MAX_BYTES) break;
    linhas.push(linha);
    bytes += tamanho;
  }
  return { linhas, corpo: linhas.length ? linhas.join("\n") + "\n" : "" };
}

function motivoErro(erro) {
  if (!erro) return "erro";
  if (erro.name === "TimeoutError" || erro.name === "AbortError") return erro.name;
  return typeof erro.name === "string" && erro.name ? erro.name.slice(0, 80) : "erro";
}

async function enviarLote(opcoes = {}) {
  try {
    if (!telemetria.ativa()) return { enviado: 0, motivo: "coleta_desligada" };
    if (!telemetria.aceito()) return { enviado: 0, motivo: "sem_aceite" };
    const url = opcoes.url === undefined ? settings.load().coletaUrl : opcoes.url;
    if (!url) return { enviado: 0, motivo: "sem_url" };
    const lote = montarLote();
    if (!lote.linhas.length) return { enviado: 0, motivo: "fila_vazia" };
    const fetcher = opcoes.fetch || globalThis.fetch;
    if (typeof fetcher !== "function") return { enviado: 0, repetir: true, motivo: "fetch_indisponivel" };
    const aceite = telemetria.aceiteInfo();
    const versaoTermos = aceite && typeof aceite.termos === "string" && aceite.termos
      ? aceite.termos
      : termos.versao();

    const resposta = await fetcher(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-ndjson",
        "x-instalacao": telemetria.instalacaoId(),
        "x-medium-latens-app": IDENTIFICADOR_APP,
        "x-termos": versaoTermos,
        "user-agent": `MediumLatens/${VERSION}`,
      },
      body: lote.corpo,
      signal: AbortSignal.timeout(20_000),
      redirect: "manual",
    });

    if (resposta.status >= 200 && resposta.status < 300) {
      let confirmacao;
      try { confirmacao = await resposta.json(); } catch { confirmacao = null; }
      if (!confirmacao || confirmacao.ok !== true || confirmacao.recebidos !== lote.linhas.length) {
        return { enviado: 0, repetir: true, motivo: "resposta_invalida" };
      }
      telemetria.remover(lote.linhas);
      return { enviado: lote.linhas.length };
    }

    if (DESCARTAR.has(resposta.status)) {
      telemetria.remover(lote.linhas);
      return { enviado: 0, descartado: lote.linhas.length, motivo: `http_${resposta.status}` };
    }
    return { enviado: 0, repetir: true, motivo: `http_${resposta.status}` };
  } catch (erro) {
    return { enviado: 0, repetir: true, motivo: motivoErro(erro) };
  }
}

function estado() {
  return { ...registro };
}

function agendar(opcoes = {}) {
  if (agendamento) return agendamento;
  const criarIntervalo = opcoes.setInterval || setInterval;
  const criarTimeout = opcoes.setTimeout || setTimeout;
  const agora = opcoes.now || Date.now;
  const enviar = opcoes.enviar || (() => enviarLote(opcoes));
  let rodando = false;
  let recuo = 0;

  const agendarTimeout = (fn, atraso) => {
    const timer = criarTimeout(fn, atraso);
    if (timer && typeof timer.unref === "function") timer.unref();
    return timer;
  };

  const marcarProxima = (atraso) => {
    registro.proximaTentativa = new Date(agora() + atraso).toISOString();
  };

  const executar = async () => {
    if (rodando) return;
    if (recuo && registro.proximaTentativa && agora() < Date.parse(registro.proximaTentativa)) return;
    rodando = true;
    try {
      for (let lote = 0; lote < 10; lote += 1) {
        const resultado = await enviar();
        const instante = new Date(agora()).toISOString();
        if (resultado.repetir) {
          recuo = recuo ? Math.min(recuo * 2, RECUO_MAX_MS) : PRIMEIRA_TENTATIVA_MS;
          registro.ultimoEnvio = instante;
          registro.ultimoResultado = "falha";
          registro.ultimaMensagem = String(resultado.motivo || "falha de envio").slice(0, 120);
          marcarProxima(recuo);
          agendarTimeout(executar, recuo);
          return;
        }
        if (resultado.descartado) {
          recuo = 0;
          registro.ultimoEnvio = instante;
          registro.ultimoResultado = "falha";
          registro.ultimaMensagem = String(resultado.motivo || "lote descartado").slice(0, 120);
          registro.descartados += resultado.descartado;
          registro.proximaTentativa = null;
          return;
        }
        if (resultado.enviado > 0) {
          recuo = 0;
          registro.proximaTentativa = null;
          registro.ultimoEnvio = instante;
          registro.ultimoResultado = "ok";
          registro.ultimaMensagem = `${resultado.enviado} ${resultado.enviado === 1 ? "item enviado" : "itens enviados"}`;
          registro.enviados += resultado.enviado;
          continue;
        }
        if (registro.ultimoResultado === "nunca") {
          registro.ultimaMensagem = String(resultado.motivo || "fila vazia").slice(0, 120);
        }
        recuo = 0;
        registro.proximaTentativa = null;
        return;
      }
      registro.proximaTentativa = null;
    } finally {
      rodando = false;
    }
  };

  marcarProxima(PRIMEIRA_TENTATIVA_MS);
  const primeiraTentativa = agendarTimeout(executar, PRIMEIRA_TENTATIVA_MS);
  const intervalo = criarIntervalo(executar, INTERVALO_MS);
  if (intervalo && typeof intervalo.unref === "function") intervalo.unref();
  agendamento = { primeiraTentativa, intervalo };
  return agendamento;
}

module.exports = {
  LOTE_MAX_ITENS,
  LOTE_MAX_BYTES,
  IDENTIFICADOR_APP,
  montarLote,
  enviarLote,
  agendar,
  estado,
};
