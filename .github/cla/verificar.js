"use strict";
// Verificação do CLA do Medium Latens. Roda dentro de actions/github-script (ver
// .github/workflows/cla.yml) e também é importável para teste. Nunca lê nem executa
// código do pull request: só metadados (autores dos commits) e o texto exato do comentário.

const FRASE = "I have read the CLA Document and I hereby sign the CLA";
const CONTEXTO = "CLA";
const ARQUIVO = "signatures/v1.json";

class ErroReconciliacao extends Error {}

function avaliar({ autores, assinaturas, isentos }) {
  const isento = new Set((isentos || []).map((item) => `${item.login}:${item.id}`));
  const assinou = new Set((assinaturas || []).map((a) => `${a.id}`));
  const pendentes = [];
  for (const autor of autores || []) {
    if (!autor || !autor.login) continue;
    if (autor.type === "Bot" || isento.has(`${autor.login}:${autor.id}`)) continue;
    if (autor.id === null || autor.id === undefined || !assinou.has(`${autor.id}`)) pendentes.push(autor.login);
  }
  const unicos = [...new Set(pendentes)];
  return { estado: unicos.length ? "failure" : "success", pendentes: unicos };
}

function autoresDosCommits(commits, pr) {
  const autores = [];
  for (const c of commits || []) {
    if (c.author) {
      autores.push({ login: c.author.login, id: c.author.id, type: c.author.type });
    } else {
      autores.push({
        login: `commit ${String(c.sha || "desconhecido").slice(0, 7)} (autor sem conta GitHub vinculada)`,
        id: null,
        type: "User",
      });
    }
    if (c.committer && c.committer.login && c.committer.login !== "web-flow") {
      autores.push({ login: c.committer.login, id: c.committer.id, type: c.committer.type });
    }
  }
  if (pr && pr.user) autores.push({ login: pr.user.login, id: pr.user.id, type: pr.user.type });
  return autores;
}

function lerIsentos(valor) {
  return (valor || "").split(",").map((entrada) => {
    const separador = entrada.lastIndexOf(":");
    if (separador < 1) return null;
    const login = entrada.slice(0, separador).trim();
    const idTexto = entrada.slice(separador + 1).trim();
    if (!idTexto) return null;
    const id = Number(idTexto);
    return login && Number.isSafeInteger(id) ? { login, id } : null;
  }).filter(Boolean);
}

function descricaoPendentes(pendentes) {
  const prefixo = "Falta assinatura: ";
  const limite = 140;
  const escolhidos = [];
  for (const login of pendentes.slice(0, 3)) {
    const candidatos = [...escolhidos, login];
    const restantes = pendentes.length - candidatos.length;
    const sufixo = restantes ? `, e mais ${restantes}` : "";
    if ((prefixo + candidatos.join(", ") + sufixo).length > limite) break;
    escolhidos.push(login);
  }
  if (!escolhidos.length && pendentes.length) {
    const sufixo = pendentes.length > 1 ? `, e mais ${pendentes.length - 1}` : "";
    escolhidos.push(pendentes[0].slice(0, limite - prefixo.length - sufixo.length));
  }
  const restantes = pendentes.length - escolhidos.length;
  return prefixo + escolhidos.join(", ") + (restantes ? `, e mais ${restantes}` : "");
}

function comentario(pendentes, owner, repo) {
  if (!pendentes.length) {
    return "Todas as pessoas autoras assinaram o CLA. / All contributors have signed the CLA.";
  }
  return [
    "Obrigado pela contribuição! Antes da revisão, precisamos da assinatura do CLA de: "
      + pendentes.map((login) => login.startsWith("commit ") ? login : "@" + login).join(", ") + ".",
    `Leia o [CLA.md](https://github.com/${owner}/${repo}/blob/main/CLA.md) e responda neste PR com a frase exata:`,
    "",
    "    " + FRASE,
    "",
    "Thank you for contributing! Before review, we need the CLA signature from the people above. Read CLA.md and reply on this PR with the exact sentence.",
  ].join("\n");
}

async function saidaGit(exec, argumentos) {
  let saida = "";
  await exec.exec("git", argumentos, {
    silent: true,
    listeners: { stdout: (dados) => { saida += dados.toString(); } },
  });
  return saida;
}

async function resolverConflito({ exec, fs, assinatura }) {
  const conflitos = (await saidaGit(exec, ["diff", "--name-only", "--diff-filter=U"]))
    .split("\n").map((linha) => linha.trim()).filter(Boolean);
  if (conflitos.length !== 1 || conflitos[0] !== ARQUIVO) {
    throw new Error("Rebase do CLA falhou fora do arquivo de assinaturas.");
  }

  const remoto = JSON.parse(await saidaGit(exec, ["show", `origin/cla-signatures:${ARQUIVO}`]));
  if (!Array.isArray(remoto.signatures)) throw new Error("Arquivo remoto de assinaturas inválido.");
  const jaExiste = remoto.signatures.some((item) => `${item.id}` === `${assinatura.id}`);
  if (jaExiste) {
    await exec.exec("git", ["rebase", "--skip"]);
  } else {
    remoto.signatures.push(assinatura);
    fs.writeFileSync(ARQUIVO, JSON.stringify(remoto, null, 2) + "\n");
    await exec.exec("git", ["add", ARQUIVO]);
    await exec.exec("git", ["-c", "core.editor=true", "rebase", "--continue"]);
  }
}

async function abortarRebase(exec) {
  try {
    await exec.exec("git", ["rebase", "--abort"]);
  } catch {
    // Não havia rebase em andamento.
  }
}

async function publicarAssinatura({ exec, fs, assinatura }) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    try {
      await exec.exec("git", ["fetch", "origin", "cla-signatures"]);
      try {
        await exec.exec("git", ["rebase", "origin/cla-signatures"]);
      } catch {
        try {
          await resolverConflito({ exec, fs, assinatura });
        } catch (erroResolucao) {
          await abortarRebase(exec);
          throw new ErroReconciliacao("Não foi possível reconciliar as assinaturas do CLA.", { cause: erroResolucao });
        }
      }
      await exec.exec("git", ["push", "origin", "HEAD:cla-signatures"]);
      return;
    } catch (erro) {
      if (erro instanceof ErroReconciliacao) throw erro;
      ultimoErro = erro;
      await abortarRebase(exec);
    }
  }
  throw new Error("Não foi possível publicar a assinatura do CLA após 3 tentativas.", { cause: ultimoErro });
}

async function executar({ github, context, core, exec, fs }) {
  const { owner, repo } = context.repo;
  const numero = context.payload.pull_request ? context.payload.pull_request.number : context.payload.issue && context.payload.issue.number;
  if (!numero) return core.info("Evento sem pull request; nada a fazer.");
  if (context.payload.issue && !context.payload.issue.pull_request) return core.info("Comentário fora de PR; nada a fazer.");

  const pr = (await github.rest.pulls.get({ owner, repo, pull_number: numero })).data;
  const commits = await github.paginate(github.rest.pulls.listCommits, { owner, repo, pull_number: numero, per_page: 100 });
  const autores = autoresDosCommits(commits, pr);

  const isentos = lerIsentos(process.env.CLA_ISENTOS);
  const dados = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));

  const ehAssinatura = context.eventName === "issue_comment"
    && context.payload.comment && context.payload.comment.body.trim() === FRASE;
  let novaAssinatura = null;
  if (ehAssinatura) {
    const quem = context.payload.comment.user;
    const jaAssinou = dados.signatures.some((s) => `${s.id}` === `${quem.id}`);
    if (!jaAssinou) {
      novaAssinatura = { login: quem.login, id: quem.id, signedAt: new Date().toISOString(), pr: numero };
      dados.signatures.push(novaAssinatura);
      fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2) + "\n");
      await exec.exec("git", ["config", "user.name", "medium-latens-cla[bot]"]);
      await exec.exec("git", ["config", "user.email", "cla@mediumlatens.com"]);
      await exec.exec("git", ["add", ARQUIVO]);
      await exec.exec("git", ["commit", "-m", `chore(cla): signature from ${quem.login} (PR #${numero})`]);
    }
  }

  const resultado = avaliar({ autores, assinaturas: dados.signatures, isentos });
  const statusBase = {
    owner, repo, sha: pr.head.sha, state: resultado.estado, context: CONTEXTO,
    target_url: `https://github.com/${owner}/${repo}/blob/main/CLA.md`,
  };
  await github.rest.repos.createCommitStatus({
    ...statusBase,
    description: resultado.estado === "success" ? "CLA assinado por todas as pessoas autoras" : descricaoPendentes(resultado.pendentes),
  });

  const marcador = "<!-- medium-latens-cla -->";
  const corpo = marcador + "\n" + comentario(resultado.pendentes, owner, repo);
  const existentes = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: numero, per_page: 100 });
  const meu = existentes.find((c) => c.body && c.body.startsWith(marcador));
  if (meu) {
    if (meu.body !== corpo) await github.rest.issues.updateComment({ owner, repo, comment_id: meu.id, body: corpo });
  } else if (resultado.pendentes.length || ehAssinatura) {
    await github.rest.issues.createComment({ owner, repo, issue_number: numero, body: corpo });
  }
  if (resultado.pendentes.length) core.setFailed(`CLA pendente: ${resultado.pendentes.join(", ")}`);
  if (novaAssinatura) {
    try {
      await publicarAssinatura({ exec, fs, assinatura: novaAssinatura });
    } catch (erro) {
      await github.rest.repos.createCommitStatus({
        ...statusBase,
        state: "error",
        description: "Assinatura não pôde ser registrada; comente a frase de novo",
      });
      throw erro;
    }
  }
  core.info(`CLA: ${resultado.estado} (${resultado.pendentes.length} pendente(s))`);
}

module.exports = {
  FRASE,
  CONTEXTO,
  ARQUIVO,
  avaliar,
  autoresDosCommits,
  comentario,
  descricaoPendentes,
  executar,
  lerIsentos,
  publicarAssinatura,
};
