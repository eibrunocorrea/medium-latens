"use strict";

(function carregarTokenMediumLatens() {
  function semBarraFinal(valor, separador) {
    var texto = String(valor || "");
    while (texto.length > 1 && texto.slice(-1) === separador) texto = texto.slice(0, -1);
    return texto;
  }

  function normalizarUserData(valor) {
    var texto = String(valor || "");
    try {
      texto = decodeURI(texto);
    } catch (erroUri) {}

    if (/^file:\/\/\/[A-Za-z]:/.test(texto)) {
      return texto.slice("file:///".length).replace(/\//g, "\\");
    }
    if (texto.indexOf("file://") === 0) return texto.slice("file://".length);
    return texto;
  }

  function caminhoDoToken(ambiente) {
    var a = ambiente || {};
    var windows = String(a.plataforma || "").indexOf("Win") === 0;
    var userData = normalizarUserData(a.userData);
    if (windows) {
      var appData = semBarraFinal(a.appData || userData, "\\");
      return appData + "\\Medium Latens\\token";
    }

    var home = a.home || "";
    if (!home && userData) {
      var marcador = "/Library/Application Support";
      var indice = userData.indexOf(marcador);
      if (indice >= 0) home = userData.slice(0, indice);
    }
    return semBarraFinal(home, "/") + "/.medium-latens/token";
  }

  function resultado(token, caminho, metodo, motivo) {
    return { token: token, caminho: caminho, metodo: metodo, motivo: motivo };
  }

  function lerToken(ambiente) {
    var a = ambiente || {};
    var caminho = "";
    var leituraVazia = null;
    try {
      caminho = caminhoDoToken(a);
    } catch (erroCaminho) {
      return resultado("", caminho, null, "caminho_invalido");
    }

    if (a.cep && a.cep.fs && typeof a.cep.fs.readFile === "function") {
      try {
        var leituraCep = a.cep.fs.readFile(caminho);
        if (leituraCep && leituraCep.err === 0) {
          var tokenCep = String(leituraCep.data || "").trim();
          if (tokenCep) return resultado(tokenCep, caminho, "cep", null);
          leituraVazia = resultado("", caminho, "cep", "token_vazio");
        }
      } catch (erroCep) {}
    }

    if (typeof a.require === "function") {
      try {
        var fs = a.require("fs");
        var tokenNode = String(fs.readFileSync(caminho, "utf8") || "").trim();
        if (tokenNode) return resultado(tokenNode, caminho, "node", null);
        return resultado("", caminho, "node", "token_vazio");
      } catch (erroNode) {
        return leituraVazia || resultado("", caminho, null, "leitura_falhou");
      }
    }

    if (leituraVazia) return leituraVazia;
    return resultado("", caminho, null, "sem_leitor");
  }

  var api = {
    lerToken: lerToken,
    caminhoDoToken: caminhoDoToken,
    normalizarUserData: normalizarUserData,
  };
  if (typeof window !== "undefined") window.MediumLatensToken = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}());
