"use strict";
/**
 * lib/multicam.js — detecção da câmera ativa por corte numa multicam (herança
 * Zoomer, reimplementado pelo doc research/2026-08-17-zoomer-handoff-parte1.md).
 * Rota: exportAsProject(.prproj temporário) → gunzip → XML → blocos <VideoClip>
 * com <IsMulticam>true → mapa "InPoint|OutPoint" -> SelectedTrackIndex (doc §3.4-3.5, §6.4-6.6).
 * Contorno necessário: nenhuma API testada expõe o ângulo ativo (doc §6.11) —
 * parte mais sensível a mudanças de formato do Premiere; fixture real em
 * test/fixtures/multicam-real.xml protege contra regressão.
 * Ambiguidade (mesma chave, índices divergentes) = recusar, comportamento do
 * original preservado (spec §6.1). Temp sempre removido no finally.
 */
const zlib = require("zlib");
const fs = require("fs");
const os = require("os");
const path = require("path");
const premiere = require("./premiere");
const { esJson } = require("./briefing");

function decodePrproj(buffer) {
  if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try { return zlib.gunzipSync(buffer).toString("utf8"); }
    catch (e) { throw new Error("prproj: gzip inválido — " + e.message); }
  }
  return buffer.toString("utf8");
}

function parseMulticamMap(xml) {
  const map = {};
  const blocks = String(xml).match(/<VideoClip\b[\s\S]*?<\/VideoClip>/g) || [];
  let found = 0;
  for (const b of blocks) {
    if (!/<IsMulticam>true<\/IsMulticam>/.test(b)) continue;
    const inP = (b.match(/<InPoint>(-?\d+)<\/InPoint>/) || [])[1];
    const outP = (b.match(/<OutPoint>(-?\d+)<\/OutPoint>/) || [])[1];
    const idx = (b.match(/<SelectedTrackIndex>(-?\d+)<\/SelectedTrackIndex>/) || [])[1];
    if (inP == null || outP == null || idx == null) continue;
    found++;
    const key = inP + "|" + outP;
    if (key in map && map[key] !== Number(idx)) {
      throw new Error(`prproj: mapa ambíguo — chave ${key} com índices ${map[key]} e ${idx}; recusando aplicar (nada foi alterado)`);
    }
    map[key] = Number(idx);
  }
  if (!found) throw new Error("prproj: nenhum <VideoClip> com <IsMulticam>true — a sequência ativa tem cortes de multicam?");
  return map;
}

/** Exporta a sequência ativa como .prproj temporário e devolve o mapa. */
async function exportActiveSequenceMap() {
  const tmp = path.join(os.tmpdir(), `medium-latens-multicam-${process.pid}-${Date.now()}.prproj`);
  try {
    const es = `var seq = app.project.activeSequence;
if (!seq) return __result({ error: "sem_sequencia" });
seq.exportAsProject(${esJson(tmp)});
return __result({ ok: true });`;
    const r = await premiere.extendscript(es, { timeoutMs: 120000 });
    const data = JSON.parse(r);
    if (data.error) throw new Error("exportAsProject falhou: " + data.error);
    return parseMulticamMap(decodePrproj(fs.readFileSync(tmp)));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/**
 * Seleção atual do painel Projeto (doc Zoomer §6.2; viewID obrigatório, §8.6).
 * Itera as project views procurando a do documento ativo (comparando documentID)
 * — caminho primário do doc. Nota p/ o smoke real (Step 4, pendente): se
 * `app.getProjectFromViewID` não existir na build instalada, o fallback do
 * Zoomer é iterar os viewIDs e usar a primeira seleção não vazia; isso NÃO
 * está implementado aqui (o smoke real adjudica qual caminho vale) — só
 * documentado para quando a confirmação em Premiere real acontecer.
 */
async function getProjectSelection() {
  const es = `var viewIDs = app.getProjectViewIDs();
if (!viewIDs || !viewIDs.length) return __result({ error: "sem_project_view" });
for (var i = 0; i < viewIDs.length; i++) {
  var proj = app.getProjectFromViewID(viewIDs[i]);
  if (!proj || proj.documentID !== app.project.documentID) continue;
  var sel = app.getProjectViewSelection(viewIDs[i]);
  if (!sel || !sel.length) return __result({ error: "nada_selecionado" });
  var it = sel[0];
  var isSeq = false;
  try { if (it.isSequence && it.isSequence()) isSeq = true; } catch (e) {}
  return __result({ name: it.name, nodeId: it.nodeId, mediaPath: (it.getMediaPath ? it.getMediaPath() : ""), isSequence: isSeq });
}
return __result({ error: "project_view_do_projeto_ativo_nao_achada" });`;
  const r = await premiere.extendscript(es);
  const data = JSON.parse(r);
  if (data.error) throw new Error("painel Projeto: " + data.error.replace(/_/g, " "));
  return { name: data.name, nodeId: data.nodeId, mediaPath: data.mediaPath, isSequence: !!data.isSequence };
}

/** Track interno da câmera na multicam (doc §6.3): exige 1 corte selecionado na timeline. */
async function resolveCameraTrackIndex(camera) {
  const es = `var seq = app.project.activeSequence;
if (!seq) return __result({ error: "sem_sequencia" });
var sel = seq.getSelection();
// clique na timeline seleciona vídeo+áudio vinculados (2 itens) — filtra só o de vídeo antes de exigir 1
var vsel = [];
for (var si = 0; si < (sel ? sel.length : 0); si++) { if (sel[si].mediaType === "Video") vsel.push(sel[si]); }
if (!vsel || vsel.length !== 1) return __result({ error: "selecione_exatamente_um_corte_da_multicam" });
var item = vsel[0];
var pi = item.projectItem;
if (!pi) return __result({ error: "corte_sem_project_item" });
var nested = null;
for (var s = 0; s < app.project.sequences.numSequences; s++) {
  if (app.project.sequences[s].projectItem && app.project.sequences[s].projectItem.nodeId === pi.nodeId) { nested = app.project.sequences[s]; break; }
}
if (!nested) return __result({ error: "sequencia_aninhada_da_multicam_nao_achada" });
var t = item.inPoint.seconds;
var cam = ${esJson(camera)};
for (var v = 0; v < nested.videoTracks.numTracks; v++) {
  var tr = nested.videoTracks[v];
  for (var c = 0; c < tr.clips.numItems; c++) {
    var cl = tr.clips[c];
    if (cl.start.seconds <= t && cl.end.seconds > t && cl.projectItem) {
      var p = cl.projectItem;
      var mp = p.getMediaPath ? p.getMediaPath() : "";
      if (p.nodeId === cam.nodeId || (cam.mediaPath && mp === cam.mediaPath) || p.name === cam.name) {
        return __result({ trackIndex: v, multicamNodeId: pi.nodeId, nestedName: nested.name });
      }
    }
  }
}
return __result({ error: "camera_nao_achada_nos_tracks_internos_no_inPoint_do_corte" });`;
  const r = await premiere.extendscript(es);
  const data = JSON.parse(r);
  if (data.error) throw new Error("câmera-alvo: " + data.error.replace(/_/g, " "));
  return { trackIndex: Number(data.trackIndex), multicamNodeId: data.multicamNodeId, nestedName: data.nestedName };
}

/** Todos os TrackItems da timeline cujo projectItem é a multicam (doc §6.7, coleta crua). */
async function listMulticamItems(multicamNodeId) {
  const es = `var seq = app.project.activeSequence;
if (!seq) return __result({ error: "sem_sequencia" });
var out = [];
for (var v = 0; v < seq.videoTracks.numTracks; v++) {
  var tr = seq.videoTracks[v];
  for (var c = 0; c < tr.clips.numItems; c++) {
    var it = tr.clips[c];
    if (!it.projectItem || it.projectItem.nodeId !== ${esJson(multicamNodeId)}) continue;
    out.push({ key: it.inPoint.ticks + "|" + it.outPoint.ticks, startTicks: it.start.ticks, endTicks: it.end.ticks,
      durationSec: Number((it.end.seconds - it.start.seconds).toFixed(4)), vTrack: v, cIndex: c });
  }
}
return __result({ items: out });`;
  const r = await premiere.extendscript(es);
  const data = JSON.parse(r);
  if (data.error) throw new Error("coleta multicam: " + data.error.replace(/_/g, " "));
  return data.items.map((i) => ({ key: i.key, startTicks: Number(i.startTicks), endTicks: Number(i.endTicks),
    durationSec: Number(i.durationSec), vTrack: Number(i.vTrack), cIndex: Number(i.cIndex) }));
}

/** PURA: cortes da câmera-alvo = chave casa no mapa E índice ativo é o alvo; ordena por start. */
function filterTargetCuts(items, map, targetIndex) {
  return items.filter((i) => map[i.key] === targetIndex)
    .sort((a, b) => a.startTicks - b.startTicks);
}

module.exports = { decodePrproj, parseMulticamMap, exportActiveSequenceMap,
  getProjectSelection, resolveCameraTrackIndex, listMulticamItems, filterTargetCuts };
