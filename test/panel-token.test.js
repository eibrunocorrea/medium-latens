"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const tokenPanel = require("../panel/token");

test("normaliza userData percent-encoded do CEP no macOS", () => {
  assert.equal(
    tokenPanel.caminhoDoToken({
      plataforma: "MacIntel",
      userData: "file:///Users/x/Library/Application%20Support",
    }),
    "/Users/x/.medium-latens/token",
  );
});

test("normaliza userData do CEP no Windows", () => {
  assert.equal(
    tokenPanel.caminhoDoToken({
      plataforma: "Win32",
      userData: "file:///C:/Users/x/AppData/Roaming",
    }),
    "C:\\Users\\x\\AppData\\Roaming\\Medium Latens\\token",
  );
});

test("userData com percent-encoding inválido não lança e preserva o valor bruto", () => {
  assert.doesNotThrow(() => {
    assert.equal(
      tokenPanel.caminhoDoToken({
        plataforma: "MacIntel",
        userData: "file:///Users/x%ZZ/Library/Application Support",
      }),
      "/Users/x%ZZ/.medium-latens/token",
    );
  });
});

test("lê o token pelo cep.fs no macOS e deriva HOME de userData", () => {
  const esperado = "/Users/x/.medium-latens/token";
  let caminhoLido = null;

  const resultado = tokenPanel.lerToken({
    plataforma: "MacIntel",
    userData: "/Users/x/Library/Application Support",
    cep: {
      fs: {
        readFile(caminho) {
          caminhoLido = caminho;
          return { err: 0, data: "abc\n" };
        },
      },
    },
  });

  assert.equal(caminhoLido, esperado);
  assert.deepEqual(resultado, {
    token: "abc",
    caminho: esperado,
    metodo: "cep",
    motivo: null,
  });
});

test("sem cep.fs lê o token pelo Node no caminho do APPDATA", () => {
  const appData = "C:\\Users\\x\\AppData\\Roaming";
  const esperado = `${appData}\\Medium Latens\\token`;
  let caminhoLido = null;

  function requireFalso(modulo) {
    assert.equal(modulo, "fs");
    return {
      readFileSync(caminho, encoding) {
        caminhoLido = caminho;
        assert.equal(encoding, "utf8");
        return "node-token\n";
      },
    };
  }

  const resultado = tokenPanel.lerToken({
    plataforma: "Win32",
    appData,
    require: requireFalso,
  });

  assert.equal(caminhoLido, esperado);
  assert.deepEqual(resultado, {
    token: "node-token",
    caminho: esperado,
    metodo: "node",
    motivo: null,
  });
});

test("sem leitor devolve token vazio e não lança", () => {
  const ambiente = {
    plataforma: "MacIntel",
    home: "/Users/x",
  };
  let resultado;

  assert.doesNotThrow(() => { resultado = tokenPanel.lerToken(ambiente); });
  assert.deepEqual(resultado, {
    token: "",
    caminho: path.posix.join("/Users/x", ".medium-latens", "token"),
    metodo: null,
    motivo: "sem_leitor",
  });
});

test("falha do cep.fs cai para o leitor Node", () => {
  const esperado = "/Users/x/.medium-latens/token";
  const chamadas = [];

  const resultado = tokenPanel.lerToken({
    plataforma: "MacIntel",
    home: "/Users/x",
    cep: { fs: { readFile() { chamadas.push("cep"); return { err: 1 }; } } },
    require(modulo) {
      chamadas.push(modulo);
      return { readFileSync: () => "fallback\n" };
    },
  });

  assert.deepEqual(chamadas, ["cep", "fs"]);
  assert.deepEqual(resultado, {
    token: "fallback",
    caminho: esperado,
    metodo: "node",
    motivo: null,
  });
});

test("token vazio no cep.fs cai para o leitor Node", () => {
  const esperado = "/Users/x/.medium-latens/token";
  const chamadas = [];

  const resultado = tokenPanel.lerToken({
    plataforma: "MacIntel",
    home: "/Users/x",
    cep: { fs: { readFile() { chamadas.push("cep"); return { err: 0, data: "  \n" }; } } },
    require(modulo) {
      chamadas.push(modulo);
      return { readFileSync: () => "fallback\n" };
    },
  });

  assert.deepEqual(chamadas, ["cep", "fs"]);
  assert.deepEqual(resultado, {
    token: "fallback",
    caminho: esperado,
    metodo: "node",
    motivo: null,
  });
});
