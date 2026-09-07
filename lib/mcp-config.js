"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function configuracaoValida(caminho, fsImpl) {
  try {
    const config = JSON.parse(fsImpl.readFileSync(caminho, "utf8"));
    const servidor = config?.mcpServers?.["premiere-pro"];
    if (typeof servidor?.command !== "string") return false;
    const entrada = Array.isArray(servidor.args)
      ? servidor.args.find((arg) => typeof arg === "string" && arg.endsWith("index.js"))
      : undefined;
    return entrada === undefined || fsImpl.statSync(entrada).isFile();
  } catch {
    return false;
  }
}

function gravarAtomico(caminho, config, fsImpl) {
  const temporario = path.join(
    path.dirname(caminho),
    `.${path.basename(caminho)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const descritor = fsImpl.openSync(temporario, "wx", 0o600);
  try {
    try {
      fsImpl.writeFileSync(descritor, JSON.stringify(config, null, 2) + "\n");
    } finally {
      fsImpl.closeSync(descritor);
    }
    fsImpl.chmodSync(temporario, 0o600);
    fsImpl.renameSync(temporario, caminho);
  } catch (erro) {
    try { fsImpl.unlinkSync(temporario); } catch {}
    throw erro;
  }
}

function garantir({ userDir, mcpConfigPath, nodeBin, capacidades, timeoutMs = 60000, fsImpl = fs }) {
  try {
    const candidatos = [
      path.join(userDir, "npm", "lib", "node_modules", "premiere-pro-mcp", "dist", "index.js"),
      path.join(userDir, "npm", "node_modules", "premiere-pro-mcp", "dist", "index.js"),
    ];
    const entrada = candidatos.find((candidato) => fsImpl.existsSync(candidato));
    if (!entrada) {
      return { ok: false, motivo: `premiere-pro-mcp não instalado em ${path.join(userDir, "npm")}` };
    }
    if (fsImpl.existsSync(mcpConfigPath) && configuracaoValida(mcpConfigPath, fsImpl)) {
      return { ok: true, criado: false, caminho: mcpConfigPath };
    }
    gravarAtomico(mcpConfigPath, {
      mcpServers: {
        "premiere-pro": {
          command: nodeBin,
          args: [entrada],
          env: {
            PREMIERE_TIMEOUT_MS: String(timeoutMs),
            PREMIERE_MCP_CAPABILITIES: capacidades,
          },
        },
      },
    }, fsImpl);
    return { ok: true, criado: true, caminho: mcpConfigPath, entrada };
  } catch (erro) {
    return { ok: false, motivo: `não foi possível gravar mcp-config.json: ${erro.message}` };
  }
}

module.exports = { garantir };
