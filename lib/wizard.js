"use strict";
/**
 * lib/wizard.js , assistente de configuração de conta.
 * Trilhos: assinatura do Claude, assinatura do ChatGPT, ou chave de API própria.
 * A validação usa a rota de listagem de modelos do provedor: confirma a chave sem
 * gastar crédito e já devolve os modelos disponíveis, de modo que nenhum nome de
 * modelo precisa ficar fixo no código.
 */
const credentials = require("./credentials");

const VERSAO_ANTHROPIC = "2023-06-01";
const MOTIVO_ENDPOINT_INVALIDO = "Informe um endereço HTTPS válido. HTTP só pode ser usado no próprio computador.";

function catalogo() {
  return [
    { id: "claude-assinatura", titulo: "Entrar com minha assinatura do Claude", tipo: "assinatura" },
    { id: "chatgpt-assinatura", titulo: "Entrar com minha assinatura do ChatGPT", tipo: "assinatura" },
    { id: "chave-propria", titulo: "Usar minha própria chave de API", tipo: "chave" },
  ];
}

function normalizarEndpoint(endpoint) {
  if (typeof endpoint !== "string" || !endpoint || /\s/.test(endpoint)) {
    throw new Error(MOTIVO_ENDPOINT_INVALIDO);
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(MOTIVO_ENDPOINT_INVALIDO);
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const protocoloSeguro = url.protocol === "https:" || (url.protocol === "http:" && loopback);
  if (!protocoloSeguro || url.hash || url.username || url.password) {
    throw new Error(MOTIVO_ENDPOINT_INVALIDO);
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
}

function urlDeModelos(provider, endpoint) {
  if (provider === "anthropic") return "https://api.anthropic.com/v1/models";
  if (provider === "openai") return "https://api.openai.com/v1/models";
  const url = new URL(normalizarEndpoint(endpoint));
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  return url.href;
}

function cabecalhos(provider, key) {
  if (provider === "anthropic") return { "x-api-key": key, "anthropic-version": VERSAO_ANTHROPIC };
  return { Authorization: "Bearer " + key };
}

function traduzErro(status, corpo) {
  const texto = String(corpo || "").toLowerCase();
  if (status === 401) return "A chave não foi aceita. Confira se copiou ela inteira, sem espaços.";
  if (status === 403) return "Essa chave não tem permissão para este recurso na conta do provedor.";
  if (status === 404) return "O endereço do provedor não existe ou não foi encontrado. Confira o endereço informado.";
  if (status === 429) return "A conta atingiu o limite de uso ou está sem crédito no provedor.";
  if (status >= 500) return "O provedor está fora do ar neste momento. Tente de novo em alguns minutos.";
  if (texto.includes("model")) return "Esse modelo não está disponível para essa chave.";
  return "Não foi possível validar a chave agora. Confira a conexão e tente de novo.";
}

async function validar(opcoes) {
  const provider = opcoes.provider;
  const key = String(opcoes.key || "").trim();
  if (!key) return { ok: false, motivo: "Cole a chave antes de continuar." };
  let endpointNormalizado = null;
  if (provider === "compativel") {
    try {
      endpointNormalizado = normalizarEndpoint(opcoes.endpoint);
    } catch {
      return { ok: false, motivo: MOTIVO_ENDPOINT_INVALIDO };
    }
  }
  let resp;
  try {
    resp = await fetch(urlDeModelos(provider, endpointNormalizado), {
      headers: cabecalhos(provider, key),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    const msg = String(e && e.message || "");
    if (/timeout|abort/i.test(msg)) return { ok: false, motivo: "O provedor demorou demais para responder." };
    return { ok: false, motivo: "Sem conexão com a internet, ou o endereço do provedor está errado." };
  }
  if (!resp.ok) {
    let corpo = "";
    try { corpo = await resp.text(); } catch {}
    return { ok: false, motivo: traduzErro(resp.status, corpo) };
  }
  let dados = {};
  try { dados = await resp.json(); } catch {}
  const lista = Array.isArray(dados.data) ? dados.data : (Array.isArray(dados.models) ? dados.models : []);
  const modelos = lista.map((m) => m.id || m.name).filter(Boolean);
  const modeloPedido = String(opcoes.model || "").trim();
  if (modeloPedido && !modelos.includes(modeloPedido)) {
    return { ok: false, motivo: "O modelo escolhido não está disponível para essa chave." };
  }
  return endpointNormalizado
    ? { ok: true, modelos, endpoint: endpointNormalizado }
    : { ok: true, modelos };
}

module.exports = {
  catalogo,
  normalizarEndpoint,
  urlDeModelos,
  cabecalhos,
  traduzErro,
  validar,
  credentials,
};
