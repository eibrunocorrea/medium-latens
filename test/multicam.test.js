"use strict";
const test = require("node:test");
const assert = require("node:assert");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const mc = require("../lib/multicam");

function clip(inP, outP, idx, multicam = true) {
  return `<VideoClip ObjectID="x"><Clip><InPoint>${inP}</InPoint><OutPoint>${outP}</OutPoint>` +
    `<IsMulticam>${multicam}</IsMulticam><SelectedTrackIndex>${idx}</SelectedTrackIndex></Clip></VideoClip>`;
}
const XML_OK = `<Project>${clip("50854003200", "627199372800", 0)}${clip("627199372800", "700000000000", 1)}` +
  `${clip("1", "2", 9, false)}</Project>`; // o não-multicam deve ser ignorado
const XML_AMBIGUO = `<Project>${clip("10", "20", 0)}${clip("10", "20", 1)}</Project>`;
const XML_SEM_MC = `<Project>${clip("10", "20", 0, false)}</Project>`;

test("parseMulticamMap: mapa InPoint|OutPoint -> SelectedTrackIndex", () => {
  const m = mc.parseMulticamMap(XML_OK);
  assert.deepEqual(m, { "50854003200|627199372800": 0, "627199372800|700000000000": 1 });
});

test("parseMulticamMap: chave duplicada com índice igual NÃO é ambiguidade", () => {
  const m = mc.parseMulticamMap(`<P>${clip("10", "20", 1)}${clip("10", "20", 1)}</P>`);
  assert.deepEqual(m, { "10|20": 1 });
});

test("parseMulticamMap: ambiguidade recusa e explica (comportamento do Zoomer)", () => {
  assert.throws(() => mc.parseMulticamMap(XML_AMBIGUO), /ambíguo/);
});

test("parseMulticamMap: sem multicam explica o que faltou", () => {
  assert.throws(() => mc.parseMulticamMap(XML_SEM_MC), /IsMulticam/);
});

test("decodePrproj: gzip válido, texto puro e gzip inválido", () => {
  assert.equal(mc.decodePrproj(zlib.gzipSync(Buffer.from("<a/>"))), "<a/>");
  assert.equal(mc.decodePrproj(Buffer.from("<a/>")), "<a/>");
  const corrupto = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from("lixo")]);
  assert.throws(() => mc.decodePrproj(corrupto), /gzip inválido/);
});

test("filterTargetCuts: casa chave no mapa, filtra pelo índice-alvo, ordena por start", () => {
  const items = [
    { key: "30|40", startTicks: 900, endTicks: 950, durationSec: 2, vTrack: 0, cIndex: 2 },
    { key: "10|20", startTicks: 100, endTicks: 200, durationSec: 3, vTrack: 0, cIndex: 0 },
    { key: "20|30", startTicks: 500, endTicks: 700, durationSec: 8, vTrack: 0, cIndex: 1 },
    { key: "99|99", startTicks: 300, endTicks: 400, durationSec: 1, vTrack: 0, cIndex: 3 }, // sem match no mapa
  ];
  const map = { "10|20": 0, "20|30": 0, "30|40": 1 };
  const r = mc.filterTargetCuts(items, map, 0);
  assert.deepEqual(r.map((i) => i.key), ["10|20", "20|30"]); // só índice 0, ordenado
});

test("regressão: fixture real de projeto do canal parseia com índices coerentes", () => {
  const xml = fs.readFileSync(path.join(__dirname, "fixtures", "multicam-real.xml"), "utf8");
  const m = mc.parseMulticamMap(xml);
  const keys = Object.keys(m);
  assert.ok(keys.length >= 2, "esperava 2+ cortes multicam, veio " + keys.length);
  for (const k of keys) {
    assert.match(k, /^\d+\|\d+$/);
    assert.ok(Number.isInteger(m[k]) && m[k] >= 0);
  }
});
