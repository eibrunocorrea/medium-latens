"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const b = require("../lib/briefing");

const CSV_WIND = [
  '"Nome","Início","Fim","Texto"',
  '"L1","00:00:01:15","00:00:04:10","abrimos o pacote mais raro do set"',
  '"L2","00:00:04:11","00:00:09:02","essa carta vale mais que o meu aluguel"',
].join("\n");

const CSV_SEM_ASPAS_PV = [
  "Nome;Início;Fim;Texto",
  "L1;00;00;01;15…",  // linha lixo: colunas erradas — deve ser ignorada
  "L1;00:00:01:15;00:00:04:10;abrimos o pacote",
].join("\n");

test("parseCsv: formato Wind (4 colunas com aspas)", () => {
  const s = b.parseCsv(CSV_WIND);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { tcStart: "00:00:01:15", tcEnd: "00:00:04:10", text: "abrimos o pacote mais raro do set" });
});

test("parseCsv: sem aspas, ponto-e-vírgula, header e lixo ignorados", () => {
  const s = b.parseCsv(CSV_SEM_ASPAS_PV);
  assert.equal(s.length, 1);
  assert.equal(s[0].text, "abrimos o pacote");
});

test("parseCsv: timecode drop-frame (;) normalizado para :", () => {
  const s = b.parseCsv('"L1","00;00;01;15","00;00;04;10","x"');
  assert.equal(s[0].tcStart, "00:00:01:15");
});

test("parseTranscript: segundos → timecode no fps dado", () => {
  const s = b.parseTranscript({ segments: [{ start: 1.5, end: 4.25, text: "olá" }] }, 30);
  assert.deepEqual(s[0], { tcStart: "00:00:01:15", tcEnd: "00:00:04:07", text: "olá" });
});

test("tc/secs roundtrip", () => {
  assert.equal(b.secsToTc(3661.5, 30), "01:01:01:15");
  assert.equal(b.tcToSecs("01:01:01:15", 30), 3661.5);
});

test("validateBrief: aceita o shape do Wind e recusa faltas", () => {
  const ok = { tema_identificado: "t", musica_global: "m", trechos: [
    { timecode: "00:00:01:15 --> 00:00:04:10", fala: "f", inserts: [{ tipo: "realista", descricao: "d", prompt: "p" }], lettering: "l", cortes: [] }] };
  assert.equal(b.validateBrief(ok).ok, true);
  assert.equal(b.validateBrief({}).ok, false);
  assert.equal(b.validateBrief({ ...ok, trechos: [{ fala: "f" }] }).ok, false);
});

test("alignByTimecode: casa por tcStart, NUNCA por índice (bug do Wind corrigido)", () => {
  const segments = [
    { tcStart: "00:00:01:15", tcEnd: "00:00:04:10", text: "a" },
    { tcStart: "00:00:04:11", tcEnd: "00:00:09:02", text: "b" },
  ];
  // resposta fora de ordem E com um trecho inventado — não pode desalinhar
  const brief = { tema_identificado: "t", musica_global: "m", trechos: [
    { timecode: "00:00:04:11 --> 00:00:09:02", fala: "b", inserts: [], lettering: "l2", cortes: [] },
    { timecode: "00:00:99:99 --> 00:01:00:00", fala: "fantasma", inserts: [], lettering: "", cortes: [] },
    { timecode: "00:00:01:15 --> 00:00:04:10", fala: "a", inserts: [], lettering: "l1", cortes: [] },
  ] };
  const r = b.alignByTimecode(brief, segments);
  assert.equal(r.trechos.length, 2);
  assert.equal(r.trechos[0].tcStart, "00:00:01:15"); // ordenado pela ENTRADA
  assert.equal(r.trechos[0].lettering, "l1");
  assert.equal(r.unmatched.length, 1);
  assert.equal(r.unmatched[0].fala, "fantasma");
  assert.equal(r.semResposta.length, 0);
});

test("buildMarkers: cores do Wind e prefixo [Brief]", () => {
  const ms = b.buildMarkers([{ tcStart: "00:00:01:15", tcEnd: "00:00:04:10", fala: "a",
    inserts: [{ tipo: "realista", descricao: "d", prompt: "p" }], lettering: "l — branco bold", cortes: ["cortar em 2s"] }]);
  assert.equal(ms.length, 3);
  const byColor = Object.fromEntries(ms.map((m) => [m.colorIndex, m]));
  assert.match(byColor[6].name, /^\[Brief\] Insert/);    // roxo
  assert.match(byColor[3].name, /^\[Brief\] Lettering/); // laranja
  assert.match(byColor[1].name, /^\[Brief\] Corte/);     // vermelho
  assert.equal(ms[0].tcStart, "00:00:01:15");
});

test("buildPrompt: contém regras-chave e os trechos", () => {
  const p = b.buildPrompt([{ tcStart: "00:00:01:15", tcEnd: "00:00:04:10", text: "abrimos o pacote" }]);
  assert.match(p, /NUNCA rostos/);
  assert.match(p, /9:16/);
  assert.match(p, /APENAS COM JSON/i);
  assert.match(p, /00:00:01:15 --> 00:00:04:10/);
  assert.match(p, /abrimos o pacote/);
});

test("parseCsv: semicolon sem aspas com vírgula no texto NÃO é dropada", () => {
  const s = b.parseCsv("L1;00:00:01:15;00:00:04:10;essa carta, sinceramente, vale muito");
  assert.equal(s.length, 1);
  assert.equal(s[0].text, "essa carta, sinceramente, vale muito");
});

test("tc/secs roundtrip estável em fps 25 e 30 (epsilon float)", () => {
  assert.equal(b.secsToTc(b.tcToSecs("00:00:04:03", 30), 30), "00:00:04:03");
  assert.equal(b.secsToTc(b.tcToSecs("00:00:01:04", 25), 25), "00:00:01:04");
  for (let f = 0; f < 30; f++) {
    const tc = "00:00:02:" + String(f).padStart(2, "0");
    assert.equal(b.secsToTc(b.tcToSecs(tc, 30), 30), tc);
  }
});

test("extractJson: JSON puro, com cerca de código e com texto em volta", () => {
  assert.deepEqual(b.extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(b.extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(b.extractJson('claro! aqui está:\n{"a":1}\nespero que ajude'), { a: 1 });
  assert.equal(b.extractJson("nada de json"), null);
  assert.deepEqual(b.extractJson('veja {a} e depois o json {"b":2}'), { b: 2 });
});

test("generate: usa o provider dado, valida e alinha; retry único em JSON inválido", async () => {
  const provider = require("../lib/provider");
  let calls = 0;
  const messages = [];
  provider.register({ name: "fake-brief", run(opts, onEvent) {
    calls++;
    messages.push(opts.message);
    const good = JSON.stringify({ tema_identificado: "t", musica_global: "m", trechos: [
      { timecode: "00:00:01:15 --> 00:00:04:10", fala: "a", inserts: [], lettering: "l", cortes: [] }] });
    setImmediate(() => onEvent({ kind: "done", ok: true, reply: calls === 1 ? "não vou responder json" : good }));
    return { kill() {} };
  } });
  const segments = [{ tcStart: "00:00:01:15", tcEnd: "00:00:04:10", text: "a" }];
  const r = await b.generate({ segments, providerName: "fake-brief", env: process.env, cwd: process.cwd() });
  assert.equal(calls, 2); // 1ª inválida + retry
  assert.equal(r.trechos.length, 1);
  // Verify retry message contains validator errors
  assert.match(messages[1], /REJEITADA PELO VALIDADOR/);
  assert.match(messages[1], /resposta sem JSON/);
});

test("generate: falha dupla expõe o texto bruto", async () => {
  const provider = require("../lib/provider");
  provider.register({ name: "fake-bad", run(opts, onEvent) {
    setImmediate(() => onEvent({ kind: "done", ok: true, reply: "sempre prosa" }));
    return { kill() {} };
  } });
  await assert.rejects(
    () => b.generate({ segments: [{ tcStart: "00:00:01:00", tcEnd: "00:00:02:00", text: "x" }],
      providerName: "fake-bad", env: process.env, cwd: process.cwd() }),
    (e) => /JSON inválido/.test(e.message) && e.raw === "sempre prosa");
});

test("projectSlug: estável e legível", () => {
  const s = b.projectSlug("/Volumes/Ed/BC em C/ep151.prproj");
  assert.match(s, /^ep151-[0-9a-f]{8}$/);
  assert.equal(s, b.projectSlug("/Volumes/Ed/BC em C/ep151.prproj"));
});

test("plantScript: embute os markers, as chamadas certas e devolve via __result", () => {
  const es = b.plantScript([{ tcStart: "00:00:01:15", tcEnd: "00:00:04:10", name: "[Brief] Insert 1", comment: "c", colorIndex: 6 }]);
  assert.match(es, /createMarker/);
  assert.match(es, /setColorByIndex\(m\.colorIndex\)/);
  assert.match(es, /\[Brief\] Insert 1/);
  assert.match(es, /00:00:01:15/);
  assert.match(es, /return __result\(\{ planted: n \}\)/); // convenção T9: IIFE não devolve valor — precisa __result()
  assert.doesNotMatch(es, /^\(function/); // NÃO embrulhar em IIFE própria — buildScript() do MCP já faz isso
  // regressão T15: Marker não tem .duration (confirmado ao vivo via for-in) — setar isso era
  // no-op silencioso e plantava sempre um marker de ponto (0s). O fix usa .end (tempo absoluto).
  assert.match(es, /mk\.end\s*=/);
  assert.ok(!/mk\.duration/.test(es));
});

test("plantScript: escapa U+2028/U+2029 no JSON embutido (senão quebra o parser ES pré-2019)", () => {
  const es = b.plantScript([{ tcStart: "00:00:01:15", tcEnd: "00:00:04:10",
    name: "[Brief] Insert 1", comment: "linha quebrada", colorIndex: 6 }]);
  assert.ok(!es.includes(" ")); // nenhum separador de linha CRU no source ES
  assert.ok(es.includes("\\u2028")); // a sequência de escape textual está presente
});

test("clearScript: filtra pelo prefixo [Brief] antes de deletar e devolve via __result", () => {
  const es = b.clearScript();
  assert.match(es, /indexOf\("\[Brief\] "\) === 0/);
  assert.match(es, /deleteMarker/);
  assert.match(es, /return __result\(\{ removed: doomed\.length \}\)/);
  assert.doesNotMatch(es, /^\(function/);
});

test("gotoScript: converte timecode em ticks via timebase e devolve via __result", () => {
  const es = b.gotoScript("00:00:02:00");
  assert.match(es, /setPlayerPosition/);
  assert.match(es, /00:00:02:00/);
  assert.match(es, /return __result\(\{ ok: true \}\)/);
  assert.doesNotMatch(es, /^\(function/);
});

test("gotoScript: guarda contra timecode inválido antes de mover a agulha", () => {
  const es = b.gotoScript("00:00:02:00");
  assert.match(es, /timecode_invalido/);
});

test("saveBrief/loadBrief: slug guard contra path traversal", () => {
  assert.throws(() => b.saveBrief("../evil", {}), /slug inválido/);
  assert.throws(() => b.saveBrief("slugs-with-underscores_bad", {}), /slug inválido/);
  assert.throws(() => b.loadBrief("../etc/passwd"), /slug inválido/);
  // Valid slugs should not throw (may return null on load, but no error)
  const validSlug = "valid-slug-123";
  b.saveBrief(validSlug, { test: true });
  const loaded = b.loadBrief(validSlug);
  assert.deepEqual(loaded, { test: true });
});

// ---------- resolveTranscript (regressão T15 — extraído do handler /brief/generate) ----------
function mkTranscriptDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-transcript-"));
}
function touch(filePath, mtimeDate) {
  fs.writeFileSync(filePath, "{}");
  fs.utimesSync(filePath, mtimeDate, mtimeDate);
}

test("resolveTranscript: corrected vence whisper mesmo quando whisper é mais recente (prioridade por tipo, não só mtime)", () => {
  const dir = mkTranscriptDir();
  touch(path.join(dir, "FX3-1_6898.corrected.json"), new Date(Date.now() - 60000));
  touch(path.join(dir, "FX3-2_7053.whisper.json"), new Date());
  const r = b.resolveTranscript(dir);
  assert.equal(r.kind, "corrected");
  assert.match(r.file, /FX3-1_6898\.corrected\.json$/);
});

test("resolveTranscript: .adobe-transcript.json é excluído da checagem de corrected, cai pro whisper", () => {
  const dir = mkTranscriptDir();
  touch(path.join(dir, "FX3-1_6898.adobe-transcript.json"), new Date(Date.now() - 30000));
  touch(path.join(dir, "FX3-1_6898.whisper.json"), new Date());
  const r = b.resolveTranscript(dir);
  assert.equal(r.kind, "whisper");
  assert.match(r.file, /FX3-1_6898\.whisper\.json$/);
});

test("resolveTranscript: dentro do mesmo tipo, o arquivo mais recente por mtime vence", () => {
  const dir = mkTranscriptDir();
  touch(path.join(dir, "old.corrected.json"), new Date(Date.now() - 60000));
  touch(path.join(dir, "new.corrected.json"), new Date());
  const r = b.resolveTranscript(dir);
  assert.equal(r.kind, "corrected");
  assert.match(r.file, /new\.corrected\.json$/);
});

test("resolveTranscript: diretório ausente lança erro citando o diretório", () => {
  const dir = path.join(os.tmpdir(), "medium-latens-transcript-does-not-exist-" + Date.now());
  assert.throws(() => b.resolveTranscript(dir),
    (e) => e.message.includes(dir) && /transcript não achado/.test(e.message));
});
