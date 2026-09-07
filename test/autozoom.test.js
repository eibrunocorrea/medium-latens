"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "medium-latens-test-"));
process.env.MEDIUM_LATENS_USER_DIR = TMP;
process.env.MEDIUM_LATENS_CONFIG_FILE = path.join(TMP, "config.json");
const az = require("../lib/autozoom");

const P = [{ id: "A", scale: 100 }, { id: "B", scale: 125 }, { id: "C", scale: 150 }];
const PUSH = { start: { scale: 115, position: [2050, 1080] }, end: { scale: 135, position: [2046, 1080] } };
function cut(key, dur, extra) { return { key, durationSec: dur, keyframed: false, ownPush: false, ...extra }; }

test("rotação circular na ordem da lista (doc §3.7)", () => {
  const plan = az.planRotation([cut("1", 2), cut("2", 3), cut("3", 4), cut("4", 2)], P, null, {});
  assert.deepEqual(plan.map((p) => p.presetId), ["A", "B", "C", "A"]);
});

test("clipe pulado NÃO avança o índice (spec §6.3 fecha a pendência 7)", () => {
  const plan = az.planRotation([cut("1", 2), cut("2", 2, { keyframed: true }), cut("3", 2)], P, null, {});
  assert.equal(plan[0].presetId, "A");
  assert.deepEqual(plan[1], { key: "2", action: "skip", reason: "keyframes manuais" });
  assert.equal(plan[2].presetId, "B"); // recebe o preset que seria do pulado
});

test("push alterna forward/reverse só quando APLICA (doc §3.10)", () => {
  const plan = az.planRotation([cut("1", 8), cut("2", 9, { keyframed: true }), cut("3", 10), cut("4", 6)], P, PUSH, {});
  assert.equal(plan[0].direction, "forward");
  assert.equal(plan[1].action, "skip");           // pulado: não alterna
  assert.equal(plan[2].direction, "reverse");
  assert.equal(plan[3].direction, "forward");
});

test("sem push, cortes longos ficam intocados (doc §3.9)", () => {
  const plan = az.planRotation([cut("1", 8)], P, null, {});
  assert.deepEqual(plan[0], { key: "1", action: "none", reason: "sem push configurado" });
});

test("sem presets, cortes curtos ficam intocados", () => {
  const plan = az.planRotation([cut("1", 2)], [], PUSH, {});
  assert.equal(plan[0].action, "none");
});

test("limiar exato: 5.0s é estático, acima é push (doc §3.8: dur > 5.0)", () => {
  const plan = az.planRotation([cut("1", 5.0), cut("2", 5.01)], P, PUSH, {});
  assert.equal(plan[0].action, "static");
  assert.equal(plan[1].action, "push");
});

test("push próprio: intocável sem redo, reescrevível com redo (doc §3.16)", () => {
  const cuts = [cut("1", 8, { keyframed: true, ownPush: true })];
  assert.equal(az.planRotation(cuts, P, PUSH, {})[0].action, "skip");
  assert.equal(az.planRotation(cuts, P, PUSH, { redo: true })[0].action, "push");
});

test("estático keyframed é pulado mesmo com redo (só push próprio é reescrevível)", () => {
  const plan = az.planRotation([cut("1", 2, { keyframed: true })], P, PUSH, { redo: true });
  assert.equal(plan[0].action, "skip");
});

test("store: presets/push/câmera persistem por slug no config.json", () => {
  const slug = "teste-" + Date.now();
  az.saveStore(slug, { presets: P, push: PUSH, camera: { name: "DSCF1450.mp4" } });
  const s = az.store(slug);
  try {
    assert.equal(s.presets.length, 3);
    assert.equal(s.push.start.scale, 115);
    assert.equal(s.camera.name, "DSCF1450.mp4");
  } finally {
    az.saveStore(slug, null); // limpa a chave de teste
  }
  assert.deepEqual(az.store(slug), { camera: null, presets: [], push: null });
});

// ---------- filterCutsByWindow (spec §6.4) ----------
const TICKS = 254016000000; // ticks por segundo
function cutAt(key, secs) { return { key, startTicks: secs * TICKS }; }
const CUTS = [cutAt("a", 5), cutAt("b", 10), cutAt("c", 15)];

test("filterCutsByWindow: só fromTc corta o começo (startTicks >= from)", () => {
  const r = az.filterCutsByWindow(CUTS, "00:00:10:00", null, 30);
  assert.deepEqual(r.map((c) => c.key), ["b", "c"]);
});

test("filterCutsByWindow: só toTc corta o fim (startTicks < to, exclusivo)", () => {
  const r = az.filterCutsByWindow(CUTS, null, "00:00:10:00", 30);
  assert.deepEqual(r.map((c) => c.key), ["a"]);
});

test("filterCutsByWindow: janela com os dois lados", () => {
  const r = az.filterCutsByWindow(CUTS, "00:00:05:00", "00:00:15:00", 30);
  assert.deepEqual(r.map((c) => c.key), ["a", "b"]);
});

test("filterCutsByWindow: sem TC = fronteiras abertas, tudo passa (; aceito como em /brief/goto)", () => {
  assert.deepEqual(az.filterCutsByWindow(CUTS, null, undefined, 30).map((c) => c.key), ["a", "b", "c"]);
  assert.deepEqual(az.filterCutsByWindow(CUTS, "00;00;10;00", null, 30).map((c) => c.key), ["b", "c"]);
});

test("filterCutsByWindow: TC malformado LANÇA em vez de virar janela aberta (-1 do tcToSecs)", () => {
  assert.throws(() => az.filterCutsByWindow(CUTS, "1:2:3", null, 30), /HH:MM:SS:FF/);
  assert.throws(() => az.filterCutsByWindow(CUTS, null, "00:00:aa:00", 30), /HH:MM:SS:FF/);
  assert.throws(() => az.filterCutsByWindow(CUTS, "00:00:10:00 ", null, 30), /HH:MM:SS:FF/);
});
