"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const auth = require("../lib/auth");
const BITS_POSIX = process.platform !== "win32"; // NTFS não expõe bits de modo; a proteção vem da ACL do perfil do usuário

function req(headers, port = 8765) {
  return {
    headers: { host: `127.0.0.1:${port}`, ...(headers || {}) },
    socket: { localPort: port },
  };
}
function url(pathname, query) { return new URL(pathname + (query || ""), "http://x"); }

test("getToken cria o arquivo com permissão 600 e reusa depois", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-tok-"));
  const file = path.join(tmp, "token");
  const t1 = auth.getToken(file);
  assert.ok(t1.length >= 32, "token curto demais");
  if (BITS_POSIX) {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  assert.equal(auth.getToken(file), t1, "deve reusar o token existente");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("getToken corrige para 600 a permissão de token pré-existente", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-tok-"));
  const file = path.join(tmp, "token");
  const token = "a".repeat(64);
  fs.writeFileSync(file, token, { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  assert.equal(auth.getToken(file), token);
  if (BITS_POSIX) {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("/health continua aberto", () => {
  assert.deepEqual(auth.check(req(), url("/health"), "abc"), { ok: true });
});

test("valida Host em toda rota, inclusive health", () => {
  for (const host of ["127.0.0.1:8765", "localhost:8765", "[::1]:8765"]) {
    assert.deepEqual(auth.check(req({ host }), url("/health"), "abc"), { ok: true });
  }
  for (const host of ["evil.example:8765", "127.0.0.1:1", undefined]) {
    assert.deepEqual(
      auth.check(req({ host }), url("/health"), "abc"),
      { ok: false, status: 421, error: "host inválido" },
    );
  }
});

test("recusa requisição sem token", () => {
  const r = auth.check(req(), url("/autozoom/apply"), "abc");
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test("aceita token no cabeçalho", () => {
  const r = auth.check(req({ "x-medium-latens-token": "abc" }), url("/autozoom/apply"), "abc");
  assert.equal(r.ok, true);
});

test("recusa token de status na query e aceita pelo cookie", () => {
  const r = auth.check(req(), url("/status", "?t=abc"), "abc");
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(auth.check(req({ cookie: "ml_status=abc" }), url("/status"), "abc").ok, true);
});

test("aceita token na query para o EventSource do painel", () => {
  const r = auth.check(req(), url("/stream", "?t=abc"), "abc");
  assert.equal(r.ok, true);
});

test("recusa token na query fora de status e stream", () => {
  const r = auth.check(req(), url("/chat", "?t=abc"), "abc");
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test("recusa token errado", () => {
  assert.equal(auth.check(req({ "x-medium-latens-token": "xxx" }), url("/chat"), "abc").ok, false);
});

test("recusa requisição vinda de site externo mesmo com token", () => {
  const r = auth.check(req({ origin: "https://site-malicioso.com", "x-medium-latens-token": "abc" }), url("/chat"), "abc");
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("aceita origem null com token", () => {
  const r = auth.check(req({ origin: "null", "x-medium-latens-token": "abc" }), url("/chat"), "abc");
  assert.equal(r.ok, true);
});

test("origem null sem token continua recusada", () => {
  const r = auth.check(req({ origin: "null" }), url("/chat"), "abc");
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test("origem externa com token continua recusada", () => {
  const r = auth.check(req({ origin: "https://site.com", "x-medium-latens-token": "abc" }), url("/chat"), "abc");
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("aceita origem do próprio servidor e do painel", () => {
  assert.equal(auth.check(req({ origin: "http://127.0.0.1:8765", "x-medium-latens-token": "abc" }), url("/chat"), "abc").ok, true);
  assert.equal(auth.check(req({ origin: "null" }), url("/health"), "abc").ok, true);
});

test("recusa origem de loopback com porta diferente da requisição", () => {
  const r = auth.check(req({ origin: "http://127.0.0.1:9999", "x-medium-latens-token": "abc" }), url("/chat"), "abc");
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("aceita origem de loopback com a mesma porta da requisição", () => {
  const r = auth.check(req({ host: "localhost:8765", origin: "http://localhost:8765", "x-medium-latens-token": "abc" }), url("/chat"), "abc");
  assert.equal(r.ok, true);
});

test("aceita somente o literal file e recusa file com caminho", () => {
  assert.equal(auth.check(req({ origin: "file:///etc/passwd" }), url("/health"), "abc").status, 403);
  assert.equal(auth.check(req({ origin: "file://" }), url("/health"), "abc").ok, true);
});

test("recusa origem malformada sem lançar exceção", () => {
  for (const origin of ["http://", "::::"]) {
    let resultado;
    assert.doesNotThrow(() => {
      resultado = auth.check(req({ origin }), url("/health"), "abc");
    });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.status, 403);
  }
});
