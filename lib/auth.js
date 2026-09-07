"use strict";
/**
 * lib/auth.js , fecha o servidor local.
 * Sem isto, qualquer página aberta no navegador do usuário poderia mandar o agente
 * mexer no projeto dele: o servidor ouve em 127.0.0.1 e o navegador alcança 127.0.0.1.
 * Duas barreiras: token que só quem tem acesso ao disco consegue ler, e recusa de
 * qualquer requisição que anuncie origem de site.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { FILES, ensurePrivateDir } = require("./paths");

const OPEN_ROUTES = new Set(["/health"]);

function ajustarPermissaoToken(alvo) {
  try {
    fs.chmodSync(alvo, 0o600);
  } catch {
    console.error(`Aviso: não foi possível ajustar a permissão do arquivo de token: ${alvo}`);
  }
}

function getToken(file) {
  const alvo = file || FILES.token;
  try {
    const t = fs.readFileSync(alvo, "utf8").trim();
    if (t.length >= 32) {
      ajustarPermissaoToken(alvo);
      return t;
    }
  } catch {}
  ensurePrivateDir(path.dirname(alvo));
  const t = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(alvo, t, { mode: 0o600 });
  ajustarPermissaoToken(alvo);
  return t;
}

function iguais(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function origemPermitida(origem, host) {
  if (origem === "null" || origem === "file://") return true;
  try {
    const origemUrl = new URL(origem);
    return origemUrl.protocol === "http:" && origemUrl.host === host;
  } catch {
    return false;
  }
}

function hostPermitido(req) {
  const host = req.headers && req.headers.host;
  const port = req.socket && req.socket.localPort;
  if (typeof host !== "string" || !port) return false;
  return new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]).has(host);
}

function tokenDoCookie(req) {
  const cookies = String(req.headers && req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split("=");
    if (name !== "ml_status") continue;
    try {
      return decodeURIComponent(parts.join("="));
    } catch {
      return "";
    }
  }
  return "";
}

function check(req, url, token) {
  if (!hostPermitido(req)) {
    return { ok: false, status: 421, error: "host inválido" };
  }
  const origem = req.headers && req.headers.origin;
  if (origem && !origemPermitida(origem, req.headers.host)) {
    return { ok: false, status: 403, error: "origem não permitida" };
  }
  if (OPEN_ROUTES.has(url.pathname)) return { ok: true };
  const enviado = (req.headers && req.headers["x-medium-latens-token"])
    || (url.pathname === "/status" ? tokenDoCookie(req) : null)
    || (url.pathname === "/stream" ? url.searchParams.get("t") : null);
  if (!enviado || !iguais(enviado, token)) {
    return { ok: false, status: 401, error: "token ausente ou inválido" };
  }
  return { ok: true };
}

module.exports = { getToken, check, OPEN_ROUTES };
