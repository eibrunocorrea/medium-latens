"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cred = require("../lib/credentials");
const BITS_POSIX = process.platform !== "win32"; // NTFS não expõe bits de modo; a proteção vem da ACL do perfil do usuário

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mlat-cred-"));
  return path.join(dir, "credentials.json");
}

test("mask mostra apenas os quatro últimos caracteres", () => {
  assert.equal(cred.mask("sk-ant-1234567890abcd"), "••••abcd");
  assert.equal(cred.mask("curta"), "••••");
  assert.equal(cred.mask("1234567"), "••••");
  assert.equal(cred.mask("12345678901"), "••••");
  assert.equal(cred.mask("123456789012"), "••••9012");
});

test("save grava com permissão 600 e devolve sem a chave", () => {
  const f = tmpFile();
  const r = cred.save({ id: "minha", provider: "anthropic", model: "algum-modelo", key: "sk-secreta-abcd" }, f);
  if (BITS_POSIX) {
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  }
  assert.equal(r.masked, "••••abcd");
  assert.equal(r.key, undefined, "save nunca devolve a chave");
});

test("list nunca devolve a chave", () => {
  const f = tmpFile();
  const chave = ["sk", "11112222", "abcd"].join("-");
  cred.save({ id: "a", provider: "openai", model: "m", key: chave }, f);
  const itens = cred.list(f);
  assert.equal(itens.length, 1);
  assert.equal(itens[0].key, undefined);
  assert.equal(itens[0].masked, "••••abcd");
  assert.ok(!JSON.stringify(itens).includes(chave));
});

test("get devolve a chave, para uso interno do servidor", () => {
  const f = tmpFile();
  cred.save({ id: "a", provider: "openai", model: "m", key: "sk-1111abcd" }, f);
  assert.equal(cred.get("a", f).key, "sk-1111abcd");
  assert.equal(cred.get("nao-existe", f), null);
});

test("remove apaga a entrada", () => {
  const f = tmpFile();
  cred.save({ id: "a", provider: "openai", model: "m", key: "sk-1111abcd" }, f);
  assert.equal(cred.remove("a", f), true);
  assert.equal(cred.list(f).length, 0);
});

test("get e remove tratam id legado inválido como não encontrado", () => {
  const f = tmpFile();
  assert.equal(cred.get("Conta Rota", f), null);
  assert.equal(cred.remove("Conta Rota", f), false);
  assert.equal(fs.existsSync(f), false);
});

test("arquivo corrompido lança e save não apaga o conteúdo existente", () => {
  const f = tmpFile();
  cred.save({ id: "anthropic-trabalho", provider: "anthropic", key: "sk-a-1111" }, f);
  cred.save({ id: "openai-pessoal", provider: "openai", key: "sk-b-2222" }, f);
  fs.writeFileSync(f, '{"anthropic-trabalho":');
  const corrompido = fs.readFileSync(f, "utf8");

  assert.throws(() => cred.list(f));
  assert.throws(() => cred.save({ id: "nova", provider: "openai", key: "sk-c-3333" }, f));
  assert.equal(fs.readFileSync(f, "utf8"), corrompido);
});

test("arquivo inexistente continua sendo uma lista vazia", () => {
  const f = tmpFile();
  assert.deepEqual(cred.list(f), []);
});

test("save não deixa arquivo temporário no diretório", () => {
  const f = tmpFile();
  const dir = path.dirname(f);
  assert.deepEqual(fs.readdirSync(dir), []);

  cred.save({ id: "a", provider: "openai", key: "sk-1111abcd" }, f);

  assert.deepEqual(fs.readdirSync(dir), [path.basename(f)]);
});

test("erro de leitura cita o caminho sem revelar a chave", () => {
  const f = tmpFile();
  const chave = "chave-reconhecivel-nao-vazar-7x9Q";
  cred.save({ id: "a", provider: "openai", key: chave }, f);
  const conteudo = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, conteudo.slice(0, -1));

  assert.throws(
    () => cred.list(f),
    (erro) => {
      assert.match(erro.message, /arquivo de credenciais não pôde ser lido/i);
      assert.ok(erro.message.includes(f));
      assert.ok(!erro.message.includes(chave));
      return true;
    },
  );
});

test("rejeita ids perigosos sem gravar o arquivo", () => {
  for (const id of ["__proto__", "constructor", "prototype", "Conta Maiúscula", "com_espaço", `a${"b".repeat(64)}`]) {
    const f = tmpFile();
    assert.throws(
      () => cred.save({ id, provider: "openai", key: "chave-de-teste" }, f),
      /identificador de conta inválido/i,
    );
    assert.equal(fs.existsSync(f), false);
  }
});
