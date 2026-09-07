"use strict";
/**
 * Relato de como a sessão transcorreu, gerado pela conta de IA do próprio editor,
 * uma vez por sessão, no modelo mais barato daquela conta.
 * Falhar aqui não interrompe nada: os eventos já estão gravados e o resumo é um extra.
 */
const telemetria = require("./telemetria");
const profiles = require("./profiles");
const wizard = require("./wizard");

const PROMPT = `Você recebe os eventos de uma sessão de edição de vídeo no Medium Latens.
Escreva um relato de COMO a pessoa trabalhou, para melhorar o produto.

Responda APENAS com JSON válido neste formato, sem texto antes ou depois:
{
  "objetivo": "o que a pessoa parecia querer nesta sessão, em uma frase",
  "caminho": ["passo 1", "passo 2"],
  "atritos": ["onde travou, refez ou repetiu"],
  "acertos": ["o que funcionou de primeira"],
  "sugestoes": ["o que no produto teria evitado os atritos"]
}

Regras:
- Escreva em português do Brasil, sem travessão.
- Descreva padrão de trabalho e decisão.
- Se faltar informação para um campo, devolva lista vazia.
- Nunca invente evento que não está na lista.`;

// Postos de modelo barato, do mais barato para o menos. A lista real de modelos
// vem do provedor em tempo de execução, sem nome de versão fixado no produto.
const POSTOS_BARATOS = ["haiku", "mini", "flash", "lite", "small", "nano"];
const MODELOS_NAO_TEXTUAIS = [
  "tts", "transcribe", "whisper", "embed", "audio", "realtime", "image", "moderation", "vision-only",
];
const MAX_EVENTOS = 300;
const MAX_ENTRADA_BYTES = 60000;

function modeloMaisBarato(perfil) {
  const disponiveis = ((perfil && perfil.modelosDisponiveis) || []).filter((modelo) => {
    const nome = String(modelo).toLowerCase();
    return !MODELOS_NAO_TEXTUAIS.some((termo) => nome.includes(termo));
  });
  for (const posto of POSTOS_BARATOS) {
    const achado = disponiveis.find((modelo) => String(modelo).toLowerCase().includes(posto));
    if (achado) return achado;
  }
  return null;
}

function deveRodar(estado) {
  if (!estado) return false;
  if (estado.ocupado) return false;
  if (estado.jaRodou) return false;
  return (estado.eventos || 0) > 0;
}

async function listarModelos(perfil, validar = wizard.validar) {
  try {
    if (!perfil) return [];
    if (perfil.provider === "claude" && perfil.authMode === "assinatura") {
      return ["haiku", "sonnet", "opus"];
    }
    if (perfil.authMode !== "api-key" || perfil.provider === "gemini") return [];

    let provider;
    if (perfil.endpoint) provider = "compativel";
    else if (perfil.provider === "claude") provider = "anthropic";
    else if (perfil.provider === "codex") provider = "openai";
    else return [];

    const definicao = profiles.PROVIDERS[perfil.provider];
    const variavel = perfil.endpoint
      ? (perfil.envKey || "OPENROUTER_API_KEY")
      : definicao && definicao.apiKeyVar;
    const key = variavel && process.env[variavel];
    if (!key) return [];

    const opcoes = { provider, key };
    if (perfil.endpoint) opcoes.endpoint = perfil.endpoint;
    const resultado = await validar(opcoes);
    return resultado && resultado.ok && Array.isArray(resultado.modelos) ? resultado.modelos : [];
  } catch {
    return [];
  }
}

function eventosDaSessao(desde) {
  let eventos = telemetria.fila()
    .filter((item) => item && item.tipo !== "resumo_sessao")
    .filter((item) => !desde || (typeof item.em === "string" && item.em >= desde))
    .slice(-MAX_EVENTOS)
    .map((item) => ({ em: item.em, tipo: item.tipo, dados: item.dados }));

  let json = JSON.stringify(eventos);
  while (eventos.length && Buffer.byteLength(json, "utf8") > MAX_ENTRADA_BYTES) {
    eventos = eventos.slice(1);
    json = JSON.stringify(eventos);
  }
  return { eventos, json };
}

async function gerar(opcoes) {
  const o = opcoes || {};
  try {
    if (!telemetria.ativa()) return null;
    if (!telemetria.aceito()) return null;
    const perfil = o.perfil || {};
    const modelos = perfil.modelosDisponiveis || await listarModelos(perfil);
    const modelo = modeloMaisBarato({ modelosDisponiveis: modelos });
    if (!modelo) return null;

    const { eventos, json } = eventosDaSessao(o.desde);
    if (!eventos.length) return null;
    const texto = await o.chamar({
      modelo,
      prompt: PROMPT + "\n\nEVENTOS:\n" + json,
      maxTokens: 1200,
    });
    const bruto = String(texto || "");
    const inicio = bruto.indexOf("{");
    const fim = bruto.lastIndexOf("}");
    if (inicio < 0 || fim <= inicio) return null;
    const objeto = JSON.parse(bruto.slice(inicio, fim + 1));
    telemetria.evento("resumo_sessao", objeto);
    return objeto;
  } catch {
    return null;
  }
}

module.exports = {
  PROMPT,
  POSTOS_BARATOS,
  MAX_EVENTOS,
  MAX_ENTRADA_BYTES,
  modeloMaisBarato,
  deveRodar,
  listarModelos,
  gerar,
};
