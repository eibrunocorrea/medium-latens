"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");
const { APP_DIR, USER_DIR, PYTHON_INTERPRETER, FILES } = require("./paths");
const { redactSecrets } = require("./redacao");
const termos = require("./termos");

const VERSION_UNKNOWN = "não informada";
const LOG_NOT_FOUND = "Nenhum install.log foi encontrado. Esta instalação não passou pelo instalador.";
const LOG_SEM_PASSOS = "O install.log existe, mas não registra nenhum passo.";
const MAX_PASSOS = 100;
const MAX_AVISOS_POR_PASSO = 20;
const MAX_TITULO = 200;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isFile(file, fsImpl) {
  try { return fsImpl.statSync(file).isFile(); } catch { return false; }
}

function isDirectory(dir, fsImpl) {
  try { return fsImpl.statSync(dir).isDirectory(); } catch { return false; }
}

function readVersion(file, fsImpl) {
  const source = fsImpl || fs;
  try {
    const version = source.readFileSync(file, "utf8").trim();
    return version ? version.slice(0, 100) : VERSION_UNKNOWN;
  } catch {
    return VERSION_UNKNOWN;
  }
}

// Lê só a última execução do instalador e devolve um resumo por passo. O texto livre do log
// (saída de npm, pip, launchctl) nunca chega à página: pode carregar segredo em formato que a
// redação não reconhece. Avisos e falhas passam pela redação mesmo assim (defesa em profundidade).
function resumirInstallLog(contents) {
  const texto = String(contents);
  const inicio = texto.lastIndexOf("PASSO 1/");
  const ultimaExecucao = inicio === -1 ? texto : texto.slice(inicio);
  const passos = [];
  let total = 0;
  let pronto = false;
  let atual = null;
  for (const bruta of ultimaExecucao.split(/\r?\n/)) {
    const linha = bruta.trim();
    const passo = linha.match(/^PASSO (\d+)\/(\d+): (.+)$/);
    if (passo) {
      total = Number(passo[2]) || total;
      atual = passos.length < MAX_PASSOS
        ? {
            numero: Number(passo[1]),
            titulo: redactSecrets(passo[3]).slice(0, MAX_TITULO),
            estado: "em andamento",
            avisos: [],
            falha: null,
          }
        : null;
      if (atual) passos.push(atual);
      continue;
    }
    if (linha === "PRONTO") { pronto = true; continue; }
    if (!atual) continue;
    if (linha.startsWith("AVISO: ")) {
      if (atual.avisos.length < MAX_AVISOS_POR_PASSO) atual.avisos.push(redactSecrets(linha.slice(7)));
      continue;
    }
    if (linha.startsWith("FALHOU: ")) { atual.falha = redactSecrets(linha.slice(8)); atual.estado = "falhou"; continue; }
  }
  passos.forEach((passo, indice) => {
    if (passo.estado === "falhou") return;
    if (indice < passos.length - 1 || pronto) passo.estado = passo.avisos.length ? "concluído com aviso" : "concluído";
  });
  return { total, passos, pronto };
}

function mensagemDoResumo(resumo) {
  if (!resumo.passos.length) return LOG_SEM_PASSOS;
  if (resumo.pronto) return "Instalação concluída.";
  const ultimo = resumo.passos[resumo.passos.length - 1];
  if (ultimo.estado === "falhou") return `A instalação parou no passo ${ultimo.numero} de ${resumo.total}.`;
  return `A instalação parou no passo ${ultimo.numero} de ${resumo.total} sem registrar conclusão.`;
}

function readInstallLog(file, fsImpl) {
  const source = fsImpl || fs;
  try {
    const contents = source.readFileSync(file, "utf8");
    const resumo = resumirInstallLog(contents);
    return { found: true, resumo, message: mensagemDoResumo(resumo) };
  } catch {
    return { found: false, message: LOG_NOT_FOUND };
  }
}

function commandAvailable(command, spawn) {
  try {
    const result = (spawn || spawnSync)(command, ["-version"], {
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
    });
    return result && result.status === 0;
  } catch {
    return false;
  }
}

function runProbe(command, args, spawn) {
  try {
    return (spawn || spawnSync)(command, args, {
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

function collectTelemetry(options) {
  const opts = options || {};
  const telemetry = require("./telemetria");
  const sender = opts.envio || require("./envio");
  const config = require("./settings").load();
  const collectionUrl = opts.coletaUrl === undefined ? config.coletaUrl : opts.coletaUrl;
  const collectionUrlInvalida = opts.coletaUrlInvalida === undefined
    ? opts.coletaUrl === undefined && config.coletaUrlInvalida === true
    : opts.coletaUrlInvalida === true;
  let termosVersao = null;
  try { termosVersao = termos.versao(); } catch {}
  const coleta = opts.coleta || (() => {
    return { ativa: config.coletaAtiva === true, motivo: config.coletaMotivo };
  })();
  return {
    instalacao: telemetry.instalacaoId(),
    itens: telemetry.linhasValidas().length,
    arquivo: telemetry.FILA,
    aceite: telemetry.aceito(),
    ativa: coleta.ativa,
    motivo: coleta.motivo,
    termos: termosVersao,
    envio: sender.estado(),
    url: collectionUrl || null,
    urlInvalida: collectionUrlInvalida,
    contato: "contato@mediumlatens.com",
  };
}

function collectStatus(options) {
  const opts = options || {};
  const source = opts.fs || fs;
  const appDir = opts.appDir || APP_DIR;
  const userDir = opts.userDir || USER_DIR;
  const logsDir = opts.logsDir || (userDir === USER_DIR ? FILES.logs : path.join(userDir, "logs"));
  const pythonInterpreter = opts.pythonInterpreter || PYTHON_INTERPRETER;
  const probe = opts.commandAvailable || ((command) => commandAvailable(command, opts.spawn));
  const platform = opts.platform || process.platform;
  const mediaCommand = (name) => {
    const executable = platform === "win32" ? `${name}.exe` : name;
    const installed = path.join(userDir, "bin", executable);
    return isFile(installed, source) ? installed : name;
  };
  const ffmpeg = !!probe(mediaCommand("ffmpeg"));
  const ffprobe = !!probe(mediaCommand("ffprobe"));
  const homeDir = opts.homeDir || os.homedir();
  const appData = opts.appData || process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
  const panelIndex = platform === "darwin"
    ? path.join(homeDir, "Library", "Application Support", "Adobe", "CEP", "extensions", "MediumLatens", "index.html")
    : path.join(appData, "Adobe", "CEP", "extensions", "MediumLatens", "index.html");
  let panelDebug = false;
  if (isFile(panelIndex, source) && platform === "darwin") {
    panelDebug = [9, 10, 11, 12].some((version) => {
      const result = runProbe("defaults", ["read", `com.adobe.CSXS.${version}`, "PlayerDebugMode"], opts.spawn);
      return !!result && result.status === 0 && String(result.stdout).trim() === "1";
    });
  } else if (isFile(panelIndex, source) && platform === "win32") {
    panelDebug = [9, 10, 11, 12].some((version) => {
      const result = runProbe("reg", ["query", `HKCU\\Software\\Adobe\\CSXS.${version}`, "/v", "PlayerDebugMode"], opts.spawn);
      return !!result && result.status === 0 && /PlayerDebugMode\s+REG_\w+\s+1\b/i.test(String(result.stdout));
    });
  }

  return {
    service: "respondendo",
    version: readVersion(path.join(appDir, "VERSION"), source),
    logsDir,
    logsUrl: pathToFileURL(logsDir).href,
    installLog: readInstallLog(path.join(logsDir, "install.log"), source),
    telemetria: collectTelemetry(opts),
    modules: [
      {
        name: "Python do ambiente do usuário",
        present: isFile(pythonInterpreter, source),
        detail: pythonInterpreter,
        action: "Execute novamente o instalador para reparar o motor Python.",
      },
      {
        name: "ffmpeg e ffprobe",
        present: ffmpeg && ffprobe,
        detail: ffmpeg && ffprobe
          ? "ffmpeg e ffprobe estão disponíveis para o serviço."
          : `Componentes ausentes: ${[!ffmpeg && "ffmpeg", !ffprobe && "ffprobe"].filter(Boolean).join(", ")}.`,
        action: `Execute novamente o instalador; ele reinstala as ferramentas de mídia em ${path.join(userDir, "bin")}.`,
      },
      {
        name: "Painel no Premiere",
        present: isFile(panelIndex, source) && panelDebug,
        detail: panelDebug
          ? `Painel instalado e modo de depuração CEP 9 a 12 habilitado em ${panelIndex}.`
          : `Verifique o painel em ${panelIndex} e o PlayerDebugMode do CEP 9 a 12.`,
        action: "Execute novamente o instalador para copiar o painel e habilitar o modo de depuração CEP 9 a 12.",
      },
      {
        name: "Remotion",
        present: isDirectory(path.join(appDir, "remotion"), source),
        detail: path.join(appDir, "remotion"),
        action: "Não distribuído nesta versão. Geração de vídeo por Remotion fica para uma versão futura.",
      },
    ],
  };
}

function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    const leftNumber = /^\d+$/.test(left[index]);
    const rightNumber = /^\d+$/.test(right[index]);
    if (leftNumber && rightNumber && Number(left[index]) !== Number(right[index])) {
      return Number(left[index]) > Number(right[index]) ? 1 : -1;
    }
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] > right.numbers[index] ? 1 : -1;
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function safeHttpUrl(value, base) {
  try {
    const parsed = base ? new URL(value, base) : new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

async function checkLatestVersion(installedVersion, distributionUrl, fetchImpl) {
  const endpoint = safeHttpUrl(distributionUrl);
  if (!endpoint || installedVersion === VERSION_UNKNOWN) return null;
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  if (typeof timer.unref === "function") timer.unref();
  try {
    const response = await fetcher(endpoint, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response || !response.ok) return null;
    const payload = await response.json();
    const latestVersion = typeof payload.version === "string" ? payload.version.trim().slice(0, 100) : "";
    const link = safeHttpUrl(payload.url || endpoint, endpoint);
    if (!latestVersion || !link || compareVersions(latestVersion, installedVersion) !== 1) return null;
    return { version: latestVersion, url: link };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function renderModule(module) {
  const state = module.present ? "Instalado" : "Ausente";
  const action = module.present ? "" : `<p class="action">${escapeHtml(module.action)}</p>`;
  return `<li class="module ${module.present ? "ok" : "missing"}">
          <div><strong>${escapeHtml(module.name)}</strong><span class="badge">${state}</span></div>
          <p>${escapeHtml(module.detail)}</p>${action}
        </li>`;
}

const FRASES_COLETA = {
  "obrigatoria-build-oficial": "Coleta: obrigatória (build oficial).",
  "desligada-por-ambiente": "Coleta: desligada por MEDIUM_LATENS_COLETA (build a partir do fonte).",
  "ativa-build-fonte": "Coleta: ativa (build a partir do fonte).",
};

function renderPasso(passo, total) {
  const classe = { "concluído": "ok", "concluído com aviso": "aviso", "falhou": "falhou", "em andamento": "andamento" }[passo.estado] || "andamento";
  const avisos = passo.avisos.length
    ? `<ul class="avisos">${passo.avisos.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`
    : "";
  const falha = passo.falha ? `<p class="falha">${escapeHtml(passo.falha)}</p>` : "";
  return `<li class="passo ${classe}"><strong>${escapeHtml(`${passo.numero}/${total}`)}</strong> ${escapeHtml(passo.titulo)}: ${escapeHtml(passo.estado)}${avisos}${falha}</li>`;
}

function renderStatusHtml(data) {
  const latest = data.latest
    ? `<section class="notice"><strong>Há uma versão mais recente: ${escapeHtml(data.latest.version)}</strong><a href="${escapeHtml(data.latest.url)}" rel="noopener noreferrer">Ver nova versão</a></section>`
    : "";
  const telemetry = data.telemetria || {
    instalacao: "não disponível",
    itens: 0,
    arquivo: "não disponível",
    aceite: false,
    ativa: true,
    motivo: null,
    termos: null,
    envio: { ultimoEnvio: null, ultimoResultado: "nunca", ultimaMensagem: "Nenhuma tentativa de envio foi feita." },
    url: null,
    contato: "contato@mediumlatens.com",
  };
  const waiting = telemetry.itens === 1 ? "1 item aguardando envio" : `${telemetry.itens} itens aguardando envio`;
  const lastUpload = telemetry.envio.ultimoEnvio || "Nunca";
  const collectionUrl = telemetry.urlInvalida
    ? "Endereço de coleta inválido"
    : redactSecrets(telemetry.url || "Envio desativado");
  const ultimaMensagem = redactSecrets(telemetry.envio.ultimaMensagem);
  const fraseColeta = FRASES_COLETA[telemetry.motivo] || "Coleta: estado não informado.";
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>Status do Medium Latens</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #11131a; color: #f5f7ff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, #252947, #11131a 45%); }
    main { width: min(880px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 32px; }
    header, section { background: rgba(25, 28, 42, .94); border: 1px solid #383d58; border-radius: 16px; padding: 24px; margin-bottom: 16px; }
    h1, h2 { margin-top: 0; } h1 { margin-bottom: 8px; } h2 { font-size: 1.1rem; }
    p { line-height: 1.55; } code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    .service { color: #6ee7a8; font-weight: 700; }
    .notice { display: flex; gap: 16px; align-items: center; justify-content: space-between; border-color: #dfb34b; }
    a.button, .notice a { display: inline-block; border-radius: 10px; padding: 10px 14px; background: #7587ff; color: white; text-decoration: none; font-weight: 700; }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
    .module { padding: 16px; border-radius: 12px; border: 1px solid #3d435f; background: #151824; }
    .module > div { display: flex; gap: 12px; justify-content: space-between; }
    .module p { margin: 8px 0 0; color: #c9cee1; overflow-wrap: anywhere; }
    .module .action { color: #ffd38a; }
    .badge { border-radius: 999px; padding: 3px 9px; font-size: .82rem; background: #285c43; }
    .missing .badge { background: #75383b; }
    ol.passos { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 8px; }
    .passo { padding: 10px 14px; border-radius: 10px; background: #151824; border: 1px solid #3d435f; }
    .passo.ok { border-color: #285c43; } .passo.aviso { border-color: #8a6d1f; } .passo.falhou { border-color: #75383b; }
    .passo ul.avisos { margin: 6px 0 0 14px; list-style: disc; display: block; color: #ffd38a; }
    .passo .falha { color: #ff9b9b; margin: 6px 0 0; }
    footer { text-align: center; color: #aeb4c9; padding: 12px; }
    @media (max-width: 600px) { main { padding-top: 24px; } header, section { padding: 18px; } .notice { align-items: flex-start; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Medium Latens</h1>
      <p>Serviço: <span class="service">${escapeHtml(data.service)}</span></p>
      <p>Versão instalada: <strong>${escapeHtml(data.version)}</strong></p>
    </header>
    ${latest}
    <section>
      <h2>Módulos opcionais</h2>
      <ul>${data.modules.map(renderModule).join("")}</ul>
    </section>
    <section>
      <h2>Coleta de uso</h2>
      <p><strong>${escapeHtml(fraseColeta)}</strong></p>
      <p>Identificador anônimo: <code>${escapeHtml(telemetry.instalacao)}</code>. Informe este identificador ao pedir exclusão.</p>
      <p>${escapeHtml(waiting)}.</p>
      <p>Você pode ler a fila local em <code>${escapeHtml(telemetry.arquivo)}</code>.</p>
      <p>Último envio: ${escapeHtml(lastUpload)}. Resultado: ${escapeHtml(telemetry.envio.ultimoResultado)}. ${escapeHtml(ultimaMensagem)}</p>
      <p>Endereço de coleta: <code>${escapeHtml(collectionUrl)}</code>.</p>
      <p>Para pedir a exclusão dos dados coletados, escreva para ${escapeHtml(telemetry.contato)} e informe o identificador anônimo acima.</p>
    </section>
    <section>
      <h2>Logs e reparo</h2>
      <p>Os logs ficam em <code>${escapeHtml(data.logsDir)}</code>.</p>
      <p><a class="button" href="${escapeHtml(data.logsUrl)}" rel="noopener noreferrer">Abrir a pasta de logs</a></p>
      <p>Para reinstalar, abra novamente o instalador do Medium Latens. Ele pode reparar módulos ausentes sem apagar seus projetos.</p>
      <p class="resumo-instalacao">${escapeHtml(data.installLog.message)}</p>
      ${data.installLog.resumo && data.installLog.resumo.passos.length
        ? `<ol class="passos">${data.installLog.resumo.passos.map((passo) => renderPasso(passo, data.installLog.resumo.total)).join("")}</ol>`
        : ""}
      <p>O log completo fica no arquivo <code>install.log</code> da pasta de logs, que o botão acima abre.</p>
    </section>
    <footer>Criado por Bruno Correa</footer>
  </main>
</body>
</html>`;
}

async function renderStatusPage(options) {
  const opts = options || {};
  const data = collectStatus(opts);
  data.latest = await checkLatestVersion(data.version, opts.distributionUrl, opts.fetch);
  return renderStatusHtml(data);
}

function renderErrorPage() {
  return renderStatusHtml({
    service: "respondendo com falha ao montar o diagnóstico",
    version: VERSION_UNKNOWN,
    logsDir: FILES.logs,
    logsUrl: pathToFileURL(FILES.logs).href,
    installLog: { found: false, message: LOG_NOT_FOUND },
    modules: [],
    latest: null,
  });
}

module.exports = {
  VERSION_UNKNOWN,
  LOG_NOT_FOUND,
  LOG_SEM_PASSOS,
  escapeHtml,
  redactSecrets,
  readVersion,
  readInstallLog,
  resumirInstallLog,
  commandAvailable,
  collectStatus,
  compareVersions,
  checkLatestVersion,
  renderStatusHtml,
  renderStatusPage,
  renderErrorPage,
};
