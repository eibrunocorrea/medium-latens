"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const painel = fs.readFileSync(path.join(ROOT, "panel", "index.html"), "utf8");
const manifest = fs.readFileSync(path.join(ROOT, "panel", "CSXS", "manifest.xml"), "utf8");

test("painel inclui o leitor de token antes do script principal", () => {
  const tokenScript = painel.indexOf('<script src="token.js"></script>');
  const principal = painel.indexOf("const API =");

  assert.ok(tokenScript >= 0, "panel/token.js não foi incluído");
  assert.ok(principal > tokenScript, "panel/token.js precisa carregar antes do script principal");
});

test("painel mantém fallback quando token.js não carrega", () => {
  assert.match(painel, /window\.MediumLatensToken \|\|/);
});

test("todas as chamadas HTTP e o EventSource enviam o token local", () => {
  assert.doesNotMatch(painel, /fetch\(API/);
  assert.match(painel, /function apiFetch\(caminho, opcoes\)/);
  assert.match(painel, /apiFetch\(/);
  assert.match(painel, /new EventSource\(API \+ "\/stream\?t=" \+ encodeURIComponent\(TOKEN\)\)/);
  assert.match(painel, /"x-medium-latens-token": TOKEN/);
});

test("painel avisa em português quando não consegue ler o token", () => {
  assert.match(
    painel,
    /Não consegui ler a chave local do serviço\. Abra a página de status pelo aplicativo Medium Latens na pasta Aplicativos \(macOS\) ou no menu Iniciar \(Windows\) e siga as instruções\./,
  );
});

test("manifest habilita Node dentro de Resources para o fallback", () => {
  assert.match(
    manifest,
    /<Resources>[\s\S]*?<MainPath>\.\/index\.html<\/MainPath>[\s\S]*?<CEFCommandLine>[\s\S]*?<Parameter>--enable-nodejs<\/Parameter>[\s\S]*?<\/CEFCommandLine>[\s\S]*?<\/Resources>/,
  );
});

test("painel limita conteúdo e conexões com CSP explícita", () => {
  const meta = painel.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)">/i);
  assert.ok(meta, "meta CSP ausente");
  assert.deepEqual(meta[1].split(";").map((parte) => parte.trim()).filter(Boolean), [
    "default-src 'none'",
    "script-src 'self' file: 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "connect-src http://127.0.0.1:8765",
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
  ]);
  assert.doesNotMatch(meta[1], /'unsafe-eval'/);
  assert.deepEqual(meta[1].match(/http:\/\/[^;\s]+/g), ["http://127.0.0.1:8765"]);
  assert.match(manifest, /<!--[^]*Node[^]*CSP[^]*-->/);
});

test("esc neutraliza os cinco caracteres especiais sem depender do DOM", () => {
  const inicio = painel.indexOf("function esc(s)");
  const fim = painel.indexOf('\n$("briefList")', inicio);
  assert.ok(inicio >= 0 && fim > inicio, "função esc não encontrada");
  assert.match(
    painel.slice(Math.max(0, inicio - 160), inicio),
    /\/\/ esc\(\) output is safe only in text nodes and quoted attributes, never in unquoted attributes or JavaScript strings\.\n$/,
  );
  const esc = vm.runInNewContext(`${painel.slice(inicio, fim)}; esc`);

  assert.equal(esc('a&<>"\'b'), "a&amp;&lt;&gt;&quot;&#39;b");
  assert.equal(esc(null), "");
});

test("innerHTML recebe somente markup fixo, texto escapado ou número convertido", () => {
  const atribuicoes = painel.match(/\.innerHTML\s*(?:\+?=)/g) || [];
  assert.equal(atribuicoes.length, 9, "inventário de innerHTML mudou e precisa de revisão");
  assert.doesNotMatch(painel, /\.innerHTML\s*\+=/);

  const inicio = painel.indexOf("function renderBrief(data)");
  const fim = painel.indexOf("function esc(s)", inicio);
  const renderBrief = painel.slice(inicio, fim);
  assert.match(renderBrief, /const unmatched = Number\(data\.unmatched\.length\) \|\| 0;/);
  assert.match(renderBrief, /esc\(String\(unmatched\)\)/);
  for (const valor of [
    "data.brief.tema_identificado", "data.brief.musica_global", "t.tcStart", "t.tcEnd",
    "t.fala", "ins.tipo", "ins.descricao", "ins.prompt", "t.lettering", "c",
  ]) {
    assert.ok(renderBrief.includes(`esc(${valor})`), `${valor} entra em innerHTML sem esc`);
  }
  assert.match(painel, /innerHTML = '<span class="warn">⚠ ' \+ esc\(j\.error\)/);
});

test("painel não usa outros sinks de HTML dinâmico", () => {
  for (const sink of ["outerHTML", "insertAdjacentHTML", "document.write", "document.writeln"]) {
    assert.ok(!painel.includes(sink), `sink ${sink} exige revisão de segurança`);
  }
});

test("painel contém a tela e o botão Contas do assistente", () => {
  assert.match(painel, /id="wizard"/);
  assert.match(painel, /id="openWizard"[^>]*>Contas</);
});

test("assistente usa as rotas de validar, salvar, assinatura, estado e remover", () => {
  for (const rota of [
    "/wizard/validar", "/wizard/salvar", "/wizard/assinatura", "/wizard/ativar", "/wizard/estado", "/wizard/remover",
  ]) {
    assert.ok(painel.includes(rota), `rota ${rota} ausente do painel`);
  }
});

test("mensagens de salvar e remover sobrevivem ao recarregamento do assistente", () => {
  assert.match(painel, /carregarWizard\(true, "Conta salva e ativada\."\)/);
  assert.match(painel, /carregarWizard\(true, "Conta removida\."\)/);
  assert.match(painel, /if \(!mensagem\) mostrarMensagemWizard\("", false\)/);
});

test("polling impede reentrada e ativa a assinatura somente depois da conexão", () => {
  assert.match(painel, /let emConsulta = false/);
  assert.match(painel, /if \(emConsulta\) return/);
  assert.match(painel, /emConsulta = true/);
  assert.match(painel, /chamarWizard\("\/wizard\/ativar"/);
  assert.match(painel, /Conectado e ativada\./);
});

test("endereço compatível só aparece para o provedor compatível", () => {
  assert.match(painel, /provider\.value === "compativel"/);
  assert.match(painel, /endpoint\.style\.display/);
  assert.match(painel, /provider\.addEventListener\("change"/);
});

test("assistente exibe e reutiliza o endpoint normalizado", () => {
  assert.match(painel, /endpoint\.value = resultado\.dados\.endpoint/);
});

test("DOM dinâmico do assistente usa createElement e textContent sem innerHTML", () => {
  const inicio = painel.indexOf("// ---------- assistente de contas ----------");
  const fim = painel.indexOf("// ---------- fim do assistente de contas ----------", inicio);
  assert.ok(inicio >= 0 && fim > inicio, "bloco do assistente não encontrado");
  const bloco = painel.slice(inicio, fim);
  assert.match(bloco, /document\.createElement\(/);
  assert.match(bloco, /\.textContent\s*=/);
  assert.doesNotMatch(bloco, /\.innerHTML\s*=/);
});

test("assistente nunca repõe chave salva e consulta login a cada três segundos por até dois minutos", () => {
  assert.match(painel, /wizardKey[^\n]*\.value\s*=\s*""/);
  assert.match(painel, /setInterval\([^]*?,\s*3000\)/);
  assert.match(painel, /120000/);
  assert.doesNotMatch(painel, /wizardKey[^\n]*masked/);
});
