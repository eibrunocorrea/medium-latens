"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const {
  avaliar,
  autoresDosCommits,
  comentario,
  descricaoPendentes,
  executar,
  lerIsentos,
  publicarAssinatura,
  FRASE,
  CONTEXTO,
} = require("../.github/cla/verificar.js");

const base = {
  assinaturas: [{ login: "ana", id: 1, signedAt: "2026-09-07T00:00:00Z", pr: 1 }],
  isentos: [
    { login: "eibrunocorrea", id: 179166498 },
    { login: "dependabot[bot]", id: 49699333 },
  ],
};

test("todos assinaram: sucesso", () => {
  const r = avaliar({ ...base, autores: [{ login: "ana", id: 1 }] });
  assert.equal(r.estado, "success");
  assert.deepEqual(r.pendentes, []);
});

test("autor sem assinatura: falha e lista quem falta", () => {
  const r = avaliar({ ...base, autores: [{ login: "ana", id: 1 }, { login: "bia", id: 2 }] });
  assert.equal(r.estado, "failure");
  assert.deepEqual(r.pendentes, ["bia"]);
});

test("isentos e bots não precisam assinar", () => {
  const r = avaliar({ ...base, autores: [{ login: "eibrunocorrea", id: 179166498 }, { login: "dependabot[bot]", id: 49699333, type: "Bot" }] });
  assert.equal(r.estado, "success");
});

test("isenção exige login e id numérico correspondentes", () => {
  const r = avaliar({ ...base, autores: [{ login: "eibrunocorrea", id: 9 }] });
  assert.equal(r.estado, "failure");
  assert.deepEqual(r.pendentes, ["eibrunocorrea"]);
});

test("CLA_ISENTOS aceita apenas pares login e id válidos", () => {
  assert.deepEqual(
    lerIsentos("eibrunocorrea:179166498,dependabot[bot]:49699333,invalido,abc:"),
    [
      { login: "eibrunocorrea", id: 179166498 },
      { login: "dependabot[bot]", id: 49699333 },
    ],
  );
});

test("a assinatura é por id numérico, não só por login", () => {
  const r = avaliar({ ...base, autores: [{ login: "ana", id: 999 }] });
  assert.equal(r.estado, "failure");
});

test("autor sem conta GitHub vinculada fica pendente sem expor email", () => {
  const [autor] = autoresDosCommits([{
    sha: "abcdef0123456789",
    author: null,
    committer: null,
    commit: { author: { email: "privado@example.com" } },
  }], {});
  assert.deepEqual(autor, {
    login: "commit abcdef0 (autor sem conta GitHub vinculada)",
    id: null,
    type: "User",
  });
  assert.equal(avaliar({ ...base, autores: [autor] }).estado, "failure");
  assert.doesNotMatch(autor.login, /privado|@/);
});

test("descrição lista no máximo três pendentes e fica abaixo de 140 caracteres", () => {
  const descricao = descricaoPendentes(["ana", "bia", "caio", "duda", "eva"]);
  assert.equal(descricao, "Falta assinatura: ana, bia, caio, e mais 2");
  assert.ok(descricao.length <= 140);

  const longa = descricaoPendentes([
    "commit abcdef0 (autor sem conta GitHub vinculada)",
    "commit bcdef01 (autor sem conta GitHub vinculada)",
    "commit cdef012 (autor sem conta GitHub vinculada)",
  ]);
  assert.ok(longa.length <= 140);
});

test("comentário aponta para o CLA por URL absoluta", () => {
  const corpo = comentario(["bia"], "dona", "projeto");
  assert.match(corpo, /https:\/\/github\.com\/dona\/projeto\/blob\/main\/CLA\.md/);
  assert.doesNotMatch(corpo, /\.\.\/blob\/main/);
});

test("CLA em português preserva os acentos essenciais", () => {
  const cla = fs.readFileSync(path.join(__dirname, "..", "CLA.md"), "utf8");
  assert.match(cla, /Licença/);
  assert.match(cla, /versão/);
  assert.match(cla, /Contribuição/);
  assert.match(cla, /"Você" é a pessoa/);
});

test("parágrafo de assinatura em português é o texto acentuado do brief", () => {
  const cla = fs.readFileSync(path.join(__dirname, "..", "CLA.md"), "utf8");
  const esperado = "Comente no seu pull request, com esta frase exata: `I have read the CLA Document and I hereby sign the CLA`. O workflow do repositório registra a assinatura (seu nome de usuário do GitHub, o id numérico da conta, a data e o número do PR) no arquivo `signatures/v1.json` da branch `cla-signatures` deste mesmo repositório, e marca o check `CLA` do PR como aprovado. Uma assinatura vale para todas as contribuições futuras enquanto esta versão do acordo estiver em vigor.";
  assert.ok(cla.includes(esperado));
});

test("a frase de assinatura tem que ser exata e o comentário só assina pelo próprio autor", () => {
  assert.equal(FRASE, "I have read the CLA Document and I hereby sign the CLA");
  assert.equal(CONTEXTO, "CLA");
});

test("o workflow nunca faz checkout do head do PR e usa só o GITHUB_TOKEN", () => {
  const yml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "cla.yml"), "utf8");
  assert.match(yml, /ref: cla-signatures/);
  assert.doesNotMatch(yml, /github\.event\.pull_request\.head\.(sha|ref)\s*$/m);
  assert.doesNotMatch(yml, /PERSONAL_ACCESS_TOKEN|CLA_ASSISTANT_TOKEN/);
  assert.match(yml, /permissions:\s*\n\s*contents: write\s*\n\s*pull-requests: write\s*\n\s*statuses: write/);
  assert.match(yml, /uses: actions\/github-script@[0-9a-f]{40} #/);
  assert.match(yml, /uses: actions\/checkout@[0-9a-f]{40} #/);
  assert.match(yml, /name: verificacao do CLA/);
  assert.doesNotMatch(yml, /jobs:\s*\n\s*cla:\s*\n\s*name: CLA/);
});

test("pendência publica status e comentário antes de falhar o check run", async () => {
  const ordem = [];
  const listCommits = () => {};
  const listComments = () => {};
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: { head: { sha: "head123" }, user: null } }),
        listCommits,
      },
      repos: {
        createCommitStatus: async () => ordem.push("status"),
      },
      issues: {
        listComments,
        createComment: async () => ordem.push("comentário"),
        updateComment: async () => ordem.push("comentário"),
      },
    },
    paginate: async (metodo) => metodo === listCommits
      ? [{ sha: "abcdef0123456789", author: { login: "bia", id: 2, type: "User" }, committer: null }]
      : [],
  };
  const core = {
    info: () => {},
    setFailed: () => ordem.push("falha"),
  };
  const context = {
    eventName: "pull_request_target",
    repo: { owner: "dona", repo: "projeto" },
    payload: { pull_request: { number: 7 } },
  };
  const fsFalso = { readFileSync: () => JSON.stringify({ signatures: [] }) };

  await executar({ github, context, core, exec: {}, fs: fsFalso });

  assert.deepEqual(ordem, ["status", "comentário", "falha"]);
});

test("assinatura publica status e comentário antes do push", async () => {
  const ordem = [];
  const listCommits = () => {};
  const listComments = () => {};
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: { head: { sha: "head123" }, user: null } }),
        listCommits,
      },
      repos: { createCommitStatus: async () => ordem.push("status") },
      issues: {
        listComments,
        createComment: async () => ordem.push("comentário"),
        updateComment: async () => ordem.push("comentário"),
      },
    },
    paginate: async (metodo) => metodo === listCommits
      ? [{ sha: "abcdef0123456789", author: { login: "ana", id: 1, type: "User" }, committer: null }]
      : [],
  };
  const core = { info: () => {}, setFailed: () => ordem.push("falha") };
  const context = {
    eventName: "issue_comment",
    repo: { owner: "dona", repo: "projeto" },
    payload: {
      issue: { number: 7, pull_request: {} },
      comment: { body: FRASE, user: { login: "ana", id: 1 } },
    },
  };
  const exec = {
    exec: async (_comando, argumentos) => {
      if (argumentos[0] === "push") ordem.push("push");
      return 0;
    },
  };
  const fsFalso = {
    readFileSync: () => JSON.stringify({ signatures: [] }),
    writeFileSync: () => {},
  };

  await executar({ github, context, core, exec, fs: fsFalso });

  assert.deepEqual(ordem, ["status", "comentário", "push"]);
});

test("falha definitiva no push substitui status success por error", async () => {
  const statuses = [];
  const listCommits = () => {};
  const listComments = () => {};
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: { head: { sha: "head123" }, user: null } }),
        listCommits,
      },
      repos: { createCommitStatus: async (status) => statuses.push(status) },
      issues: {
        listComments,
        createComment: async () => {},
        updateComment: async () => {},
      },
    },
    paginate: async (metodo) => metodo === listCommits
      ? [{ sha: "abcdef0123456789", author: { login: "ana", id: 1, type: "User" }, committer: null }]
      : [],
  };
  const context = {
    eventName: "issue_comment",
    repo: { owner: "dona", repo: "projeto" },
    payload: {
      issue: { number: 7, pull_request: {} },
      comment: { body: FRASE, user: { login: "ana", id: 1 } },
    },
  };
  const exec = {
    exec: async (_comando, argumentos) => {
      if (argumentos[0] === "push") throw new Error("push indisponível");
      return 0;
    },
  };
  const fsFalso = {
    readFileSync: () => JSON.stringify({ signatures: [] }),
    writeFileSync: () => {},
  };

  await assert.rejects(
    executar({ github, context, core: { info: () => {}, setFailed: () => {} }, exec, fs: fsFalso }),
    /3 tentativas/,
  );

  assert.deepEqual(statuses.map((status) => status.state), ["success", "error"]);
  assert.equal(statuses.at(-1).sha, "head123");
  assert.equal(statuses.at(-1).context, "CLA");
  assert.equal(statuses.at(-1).description, "Assinatura não pôde ser registrada; comente a frase de novo");
});

test("push da assinatura tenta novamente até três vezes", async () => {
  let pushes = 0;
  const chamadas = [];
  const exec = {
    exec: async (_comando, argumentos) => {
      chamadas.push(argumentos);
      if (argumentos[0] === "push" && ++pushes < 3) throw new Error("corrida simulada");
      return 0;
    },
  };

  await publicarAssinatura({
    exec,
    fs: {},
    assinatura: { login: "ana", id: 1, signedAt: "2026-09-07T00:00:00Z", pr: 1 },
  });

  assert.equal(pushes, 3);
  assert.equal(chamadas.filter((args) => args[0] === "fetch").length, 3);
  assert.equal(chamadas.filter((args) => args[0] === "rebase" && args[1] === "origin/cla-signatures").length, 3);
});

test("conflito em v1.json relê o remoto e preserva as duas assinaturas", async () => {
  const chamadas = [];
  const escritas = [];
  let primeiraRebase = true;
  const exec = {
    exec: async (_comando, argumentos, opcoes = {}) => {
      chamadas.push(argumentos);
      if (argumentos[0] === "rebase" && argumentos[1] === "origin/cla-signatures" && primeiraRebase) {
        primeiraRebase = false;
        throw new Error("conflito simulado");
      }
      if (argumentos[0] === "diff") {
        opcoes.listeners.stdout(Buffer.from("signatures/v1.json\n"));
      }
      if (argumentos[0] === "show") {
        opcoes.listeners.stdout(Buffer.from(JSON.stringify({ signatures: [{ login: "bia", id: 2 }] })));
      }
      return 0;
    },
  };
  const fsFalso = { writeFileSync: (_arquivo, conteudo) => escritas.push(conteudo) };

  await publicarAssinatura({
    exec,
    fs: fsFalso,
    assinatura: { login: "ana", id: 1, signedAt: "2026-09-07T00:00:00Z", pr: 1 },
  });

  const dados = JSON.parse(escritas.at(-1));
  assert.deepEqual(dados.signatures.map((s) => s.id), [2, 1]);
  assert.ok(chamadas.some((args) => args[0] === "show" && args[1] === "origin/cla-signatures:signatures/v1.json"));
  assert.ok(chamadas.some((args) => args[0] === "-c" && args[2] === "rebase" && args[3] === "--continue"));
});

test("assinatura já presente no remoto apenas pula o commit em conflito", async () => {
  const chamadas = [];
  let primeiraRebase = true;
  const exec = {
    exec: async (_comando, argumentos, opcoes = {}) => {
      chamadas.push(argumentos);
      if (argumentos[0] === "rebase" && argumentos[1] === "origin/cla-signatures" && primeiraRebase) {
        primeiraRebase = false;
        throw new Error("conflito simulado");
      }
      if (argumentos[0] === "diff") opcoes.listeners.stdout(Buffer.from("signatures/v1.json\n"));
      if (argumentos[0] === "show") {
        opcoes.listeners.stdout(Buffer.from(JSON.stringify({ signatures: [{ login: "ana", id: 1 }] })));
      }
      return 0;
    },
  };
  const fsFalso = { writeFileSync: () => assert.fail("não deve reescrever o arquivo") };

  await publicarAssinatura({
    exec,
    fs: fsFalso,
    assinatura: { login: "ana", id: 1, signedAt: "2026-09-07T00:00:00Z", pr: 1 },
  });

  assert.ok(chamadas.some((args) => args[0] === "rebase" && args[1] === "--skip"));
  assert.equal(chamadas.some((args) => args[0] === "add"), false);
});

test("erro determinístico de reconciliação não entra no retry", async () => {
  let fetches = 0;
  const exec = {
    exec: async (_comando, argumentos, opcoes = {}) => {
      if (argumentos[0] === "fetch") fetches += 1;
      if (argumentos[0] === "rebase" && argumentos[1] === "origin/cla-signatures") {
        throw new Error("conflito simulado");
      }
      if (argumentos[0] === "diff") opcoes.listeners.stdout(Buffer.from("outro-arquivo.json\n"));
      return 0;
    },
  };

  await assert.rejects(
    publicarAssinatura({
      exec,
      fs: {},
      assinatura: { login: "ana", id: 1, signedAt: "2026-09-07T00:00:00Z", pr: 1 },
    }),
    { message: "Não foi possível reconciliar as assinaturas do CLA." },
  );
  assert.equal(fetches, 1);
});
