"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert");

process.env.MEDIUM_LATENS_USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-resumo-"));

const resumo = require("../lib/resumo-sessao");
const telemetria = require("../lib/telemetria");

test("não roda com turno em andamento", () => {
  assert.equal(resumo.deveRodar({ ocupado: true, jaRodou: false, eventos: 40 }), false);
});

test("não roda duas vezes na mesma sessão", () => {
  assert.equal(resumo.deveRodar({ ocupado: false, jaRodou: true, eventos: 40 }), false);
});

test("não roda com sessão vazia", () => {
  assert.equal(resumo.deveRodar({ ocupado: false, jaRodou: false, eventos: 0 }), false);
});

test("roda quando a sessão teve trabalho e está parada", () => {
  assert.equal(resumo.deveRodar({ ocupado: false, jaRodou: false, eventos: 40 }), true);
});

test("o prompt exige json e proíbe inventar evento", () => {
  assert.match(resumo.PROMPT, /JSON/);
  assert.match(resumo.PROMPT, /nunca invente/i);
});

test("escolhe o modelo mais barato conhecido do perfil", () => {
  const m = resumo.modeloMaisBarato({ modelosDisponiveis: ["algo-opus-caro", "algo-haiku-barato", "algo-sonnet-medio"] });
  assert.equal(m, "algo-haiku-barato");
});

test("ignora modelos de mídia e moderação ao escolher o modelo barato", () => {
  const modelos = [
    "gpt-4o-mini-tts",
    "gpt-mini-transcribe",
    "gpt-mini-whisper",
    "text-embedding-mini",
    "gpt-mini-audio",
    "gpt-mini-realtime",
    "gpt-mini-image",
    "gpt-mini-moderation",
    "gpt-mini-vision-only",
    "gpt-4o-mini",
  ];

  assert.equal(resumo.modeloMaisBarato({ modelosDisponiveis: modelos }), "gpt-4o-mini");
});

test("sem modelo barato conhecido, devolve null e o resumo é pulado", () => {
  assert.equal(resumo.modeloMaisBarato({ modelosDisponiveis: ["modelo-desconhecido-x"] }), null);
});

test("listarModelos usa os apelidos do Claude por assinatura", async () => {
  assert.deepEqual(
    await resumo.listarModelos({ provider: "claude", authMode: "assinatura" }),
    ["haiku", "sonnet", "opus"],
  );
  assert.deepEqual(await resumo.listarModelos({ provider: "gemini", authMode: "assinatura" }), []);
});

test("listarModelos mapeia perfis com chave sem expor ou trocar a chave", async (t) => {
  const anteriores = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    TESTE_ENDPOINT_KEY: process.env.TESTE_ENDPOINT_KEY,
  };
  t.after(() => {
    for (const [nome, valor] of Object.entries(anteriores)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  });
  process.env.ANTHROPIC_API_KEY = "valor-claude-teste";
  process.env.OPENAI_API_KEY = "valor-codex-teste";
  process.env.TESTE_ENDPOINT_KEY = "valor-endpoint-teste";

  const chamadas = [];
  const validar = async (opcoes) => {
    chamadas.push(opcoes);
    return { ok: true, modelos: [`barato-${chamadas.length}`] };
  };

  assert.deepEqual(await resumo.listarModelos({ provider: "claude", authMode: "api-key" }, validar), ["barato-1"]);
  assert.deepEqual(await resumo.listarModelos({ provider: "codex", authMode: "api-key" }, validar), ["barato-2"]);
  assert.deepEqual(await resumo.listarModelos({
    provider: "codex", authMode: "api-key", endpoint: "https://provedor.teste/v1", envKey: "TESTE_ENDPOINT_KEY",
  }, validar), ["barato-3"]);
  assert.deepEqual(chamadas, [
    { provider: "anthropic", key: "valor-claude-teste" },
    { provider: "openai", key: "valor-codex-teste" },
    { provider: "compativel", key: "valor-endpoint-teste", endpoint: "https://provedor.teste/v1" },
  ]);
});

test("listarModelos pula Gemini com chave sem consultar rota inventada", async () => {
  let chamou = false;
  const modelos = await resumo.listarModelos(
    { provider: "gemini", authMode: "api-key" },
    async () => { chamou = true; return { ok: true, modelos: ["indevido"] }; },
  );
  assert.deepEqual(modelos, []);
  assert.equal(chamou, false);
});

function comTelemetria(falsos, fn) {
  const originais = {};
  for (const [nome, valor] of Object.entries(falsos)) {
    originais[nome] = telemetria[nome];
    telemetria[nome] = valor;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [nome, valor] of Object.entries(originais)) telemetria[nome] = valor;
    });
}

const PERFIL_BARATO = { modelosDisponiveis: ["apelido-haiku-teste"] };

test("gerar devolve o objeto e grava resumo_sessao", async () => {
  const gravados = [];
  await comTelemetria({
    aceito: () => true,
    fila: () => [{ em: "2026-08-25T10:00:00.000Z", tipo: "turno_fim", dados: { ok: true } }],
    evento: (tipo, dados) => gravados.push({ tipo, dados }),
  }, async () => {
    const objeto = await resumo.gerar({
      perfil: PERFIL_BARATO,
      chamar: async () => '{"objetivo":"editar","caminho":[],"atritos":[],"acertos":[],"sugestoes":[]}',
    });
    assert.equal(objeto.objetivo, "editar");
    assert.deepEqual(gravados, [{ tipo: "resumo_sessao", dados: objeto }]);
  });
});

test("gerar respeita desde e exclui resumo anterior", async () => {
  let prompt = "";
  await comTelemetria({
    aceito: () => true,
    fila: () => [
      { em: "2026-08-25T09:59:59.000Z", tipo: "turno_inicio", dados: { prompt: "evento-antigo" } },
      { em: "2026-08-25T10:00:00.000Z", tipo: "resumo_sessao", dados: { objetivo: "resumo-antigo" } },
      { em: "2026-08-25T10:00:01.000Z", tipo: "turno_fim", dados: { resposta: "evento-novo" } },
    ],
    evento: () => {},
  }, async () => {
    await resumo.gerar({
      perfil: PERFIL_BARATO,
      desde: "2026-08-25T10:00:00.000Z",
      chamar: async (opcoes) => {
        prompt = opcoes.prompt;
        return '{"objetivo":"ok"}';
      },
    });
  });
  assert.doesNotMatch(prompt, /evento-antigo/);
  assert.doesNotMatch(prompt, /resumo-antigo/);
  assert.match(prompt, /evento-novo/);
});

test("gerar limita a entrada em bytes e preserva os eventos mais recentes", async () => {
  const eventos = Array.from({ length: resumo.MAX_EVENTOS }, (_, indice) => ({
    em: `2026-08-25T10:${String(Math.floor(indice / 60)).padStart(2, "0")}:${String(indice % 60).padStart(2, "0")}.000Z`,
    tipo: "turno_fim",
    dados: { indice, texto: `evento-${indice}-` + "á".repeat(1000) },
  }));
  let prompt = "";
  await comTelemetria({ aceito: () => true, fila: () => eventos, evento: () => {} }, async () => {
    await resumo.gerar({
      perfil: PERFIL_BARATO,
      chamar: async (opcoes) => { prompt = opcoes.prompt; return '{"objetivo":"ok"}'; },
    });
  });
  const json = prompt.slice(prompt.indexOf("EVENTOS:\n") + "EVENTOS:\n".length);
  const enviados = JSON.parse(json);
  assert.ok(Buffer.byteLength(json, "utf8") <= resumo.MAX_ENTRADA_BYTES);
  assert.ok(enviados.length < resumo.MAX_EVENTOS);
  assert.equal(enviados.at(-1).dados.indice, resumo.MAX_EVENTOS - 1);
  assert.ok(enviados[0].dados.indice > 0);
});

test("gerar devolve null para resposta sem JSON", async () => {
  await comTelemetria({
    aceito: () => true,
    fila: () => [{ em: "2026-08-25T10:00:00.000Z", tipo: "turno_fim", dados: {} }],
    evento: () => { throw new Error("não deveria gravar"); },
  }, async () => {
    assert.equal(await resumo.gerar({ perfil: PERFIL_BARATO, chamar: async () => "sem objeto" }), null);
  });
});

test("gerar sem aceite devolve null e não chama a conta do editor", async () => {
  let chamou = false;
  await comTelemetria({ aceito: () => false }, async () => {
    const resultado = await resumo.gerar({
      perfil: PERFIL_BARATO,
      chamar: async () => { chamou = true; return "{}"; },
    });
    assert.equal(resultado, null);
    assert.equal(chamou, false);
  });
});

test("gerar com a coleta desligada não chama a conta do editor", async () => {
  let chamou = false;
  await comTelemetria({
    ativa: () => false,
    aceito: () => true,
    fila: () => [{ em: "2026-08-25T10:00:00.000Z", tipo: "turno_fim", dados: { ok: true } }],
  }, async () => {
    const resultado = await resumo.gerar({
      perfil: PERFIL_BARATO,
      chamar: async () => { chamou = true; return "{}"; },
    });
    assert.equal(resultado, null);
    assert.equal(chamou, false);
  });
});
