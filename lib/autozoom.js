"use strict";
/**
 * lib/autozoom.js — Auto Zoom multicam (herança Zoomer, reimplementado pelo doc).
 * Parte pura: planRotation decide por corte SEM tocar o Premiere (testável).
 * Regras preservadas do doc: 5s divide estático/push (§3.8); push único com
 * sentido alternado a cada APLICAÇÃO (§3.10); keyframes manuais intocáveis,
 * push próprio reescrevível no redo (§3.16); sem push, longos intocados (§3.9).
 * Decisão do spec §6.3 (fecha a pendência 7 do doc): pulo NÃO avança o índice.
 * Persistência server-side por projeto: config.json chave "autozoom" (spec §6.3).
 */
const settings = require("./settings");
const premiere = require("./premiere");
const multicam = require("./multicam");
const briefing = require("./briefing");

function planRotation(cuts, presets, push, opts) {
  const redo = !!(opts && opts.redo);
  const plan = [];
  let pi = 0;            // índice da rotação estática — só avança quando APLICA
  let dir = "forward";   // sentido do push — só alterna quando APLICA
  for (const c of cuts) {
    if (c.durationSec > 5.0) {
      if (!push) { plan.push({ key: c.key, action: "none", reason: "sem push configurado" }); continue; }
      const blocked = c.keyframed && !(redo && c.ownPush);
      if (blocked) { plan.push({ key: c.key, action: "skip", reason: "keyframes manuais" }); continue; }
      plan.push({ key: c.key, action: "push", direction: dir });
      dir = dir === "forward" ? "reverse" : "forward";
    } else {
      if (!presets.length) { plan.push({ key: c.key, action: "none", reason: "sem presets" }); continue; }
      if (c.keyframed) { plan.push({ key: c.key, action: "skip", reason: "keyframes manuais" }); continue; }
      plan.push({ key: c.key, action: "static", presetId: presets[pi % presets.length].id });
      pi++;
    }
  }
  return plan;
}

// Motion no ES é localizado (pt-BR "Movimento"/"Escala"/"Posição") — matchName é estável:
// procurar component "AE.ADBE Motion"/"AE.ADBE Motion Control"/displayName; fallback por
// índice de propriedade; o Premiere 26.3 usa nomes
// pt-BR na API de efeitos; probe ao vivo 2026-08-24 achou "AE.ADBE Motion" nesta build —
// mantém "AE.ADBE Motion Control" também porque builds/idiomas podem divergir).
// Convenção __result (mesma de lib/briefing.js e lib/multicam.js — script FLAT, sem IIFE
// própria, único `return __result({...})` com objeto; JSON.parse(r) do lado Node).
const ES_HELPERS = `
function findMotion(item) {
  for (var i = 0; i < item.components.numItems; i++) {
    var c = item.components[i];
    if (c.matchName === "AE.ADBE Motion" || c.matchName === "AE.ADBE Motion Control" || c.displayName === "Motion" || c.displayName === "Movimento") return c;
  }
  return null;
}
function findProps(motion) {
  var scale = null, position = null;
  for (var i = 0; i < motion.properties.numItems; i++) {
    var p = motion.properties[i];
    if (p.displayName === "Scale" || p.displayName === "Escala") scale = p;
    if (p.displayName === "Position" || p.displayName === "Posição" || p.displayName === "Posicao") position = p;
  }
  return { scale: scale, position: position };
}
function clipAt(seq, v, c) { return seq.videoTracks[v].clips[c]; }
`;

/** Lê Scale/Position do clipe selecionado (aprender preset/push — doc §3.6, §9.9). */
async function learnFromSelectedClip() {
  const es = `${ES_HELPERS}
var seq = app.project.activeSequence;
if (!seq) return __result({ error: "sem_sequencia" });
var sel = seq.getSelection();
// clique na timeline seleciona vídeo+áudio vinculados (2 itens) — filtra só o de vídeo antes de exigir 1
var vsel = [];
for (var si = 0; si < (sel ? sel.length : 0); si++) { if (sel[si].mediaType === "Video") vsel.push(sel[si]); }
if (!vsel || vsel.length !== 1) return __result({ error: "selecione_exatamente_um_clipe" });
var m = findMotion(vsel[0]);
if (!m) return __result({ error: "sem_motion" });
var pr = findProps(m);
if (!pr.scale || !pr.position) return __result({ error: "scale_position_nao_achados" });
var pos = pr.position.getValue();
return __result({ scale: pr.scale.getValue(), position: [pos[0], pos[1]] });`;
  const r = await premiere.extendscript(es);
  const data = JSON.parse(r);
  if (data.error) throw new Error("aprender do clipe: " + data.error.replace(/_/g, " "));
  return { scale: data.scale, position: data.position };
}

/**
 * Estado de keyframes por corte (keyframed? push próprio? — doc §3.16). refs =
 * [{vTrack, cIndex, key, startTicks, endTicks}]. Assinatura de push próprio: exatamente
 * 2 keys de Scale + 2 de Position em startTicks e endTicks-frameTicks (tolerância = frameTicks).
 *
 * Nota (verify-before-use local, mesma disciplina do Zoomer §7.16): `getKeys`,
 * `addKey(seconds)`, `setValueAtKey`, `removeKeyRange` e a unidade de tempo (segundos vs
 * ticks) DEVEM ser confirmados no Premiere real antes do commit final desta feature — o
 * SYSTEM do server já registra que addKey/setValueAtKey em "Movimento">"Posição" aceita
 * [x,y] e segundos (validado). Se `getKeys` não existir na build, detectar push próprio
 * via contagem de keys por `getKeyframeCount`/iteração equivalente — NÃO implementado
 * aqui, só documentado; a confirmação em Premiere real fica pendente (Step 3, bloqueado).
 */
async function detectStates(refs) {
  const mapped = refs.map((x) => ({ v: x.vTrack, c: x.cIndex, key: x.key, st: String(x.startTicks), en: String(x.endTicks) }));
  const es = `${ES_HELPERS}
function nearTicks(t, ref, tol) { return Math.abs(t - ref) <= tol; }
var seq = app.project.activeSequence;
if (!seq) return __result({ error: "sem_sequencia" });
var frameTicks = parseFloat(seq.timebase);
var refs = ${briefing.esJson(mapped)};
var out = [];
for (var i = 0; i < refs.length; i++) {
  var rf = refs[i];
  var item = clipAt(seq, rf.v, rf.c);
  var m = item && findMotion(item);
  var pr = m && findProps(m);
  if (!pr || !pr.scale || !pr.position) { out.push({ key: rf.key, keyframed: false, ownPush: false, error: true }); continue; }
  var kf = (pr.scale.isTimeVarying() || pr.position.isTimeVarying());
  var own = false;
  if (kf) {
    try {
      var sk = pr.scale.getKeys ? pr.scale.getKeys() : null;
      var pk = pr.position.getKeys ? pr.position.getKeys() : null;
      if (sk && pk && sk.length === 2 && pk.length === 2) {
        var startT = Number(rf.st), lastT = Number(rf.en) - frameTicks, tol = frameTicks;
        if (nearTicks(Number(sk[0].ticks), startT, tol) && nearTicks(Number(sk[1].ticks), lastT, tol) &&
            nearTicks(Number(pk[0].ticks), startT, tol) && nearTicks(Number(pk[1].ticks), lastT, tol)) own = true;
      }
    } catch (e) { own = false; }
  }
  out.push({ key: rf.key, keyframed: kf, ownPush: own, error: false });
}
return __result({ states: out });`;
  const r = await premiere.extendscript(es, { timeoutMs: 120000 });
  const data = JSON.parse(r);
  if (data.error) throw new Error("detectar keyframes: " + data.error.replace(/_/g, " "));
  const states = {};
  for (const s of data.states) states[s.key] = { keyframed: !!s.keyframed, ownPush: !!s.ownPush, error: !!s.error };
  return states;
}

/**
 * Aplica o plano: estáticos setValue; push setTimeVarying + 2 keys + Bezier em try/catch
 * (doc §3.11-3.12). Itens do plano com action "none" NUNCA vão ao ES (não há corte pra
 * mexer) — entram no relatório direto, com o motivo (`reason`) do planRotation.
 */
async function applyPlan(plan, refs, presets, push) {
  const byKey = Object.fromEntries(refs.map((x) => [x.key, x]));
  const presetById = Object.fromEntries(presets.map((p) => [p.id, p]));
  const jobs = plan.filter((p) => p.action !== "none").map((p) => {
    const ref = byKey[p.key];
    const job = { v: ref.vTrack, c: ref.cIndex, key: p.key, action: p.action,
      st: String(ref.startTicks), en: String(ref.endTicks), reason: p.reason || null };
    if (p.action === "static") { const pr = presetById[p.presetId]; job.scale = pr.scale; job.pos = pr.position || null; }
    if (p.action === "push") {
      const a = p.direction === "forward" ? push.start : push.end;
      const b = p.direction === "forward" ? push.end : push.start;
      job.s0 = a.scale; job.p0 = a.position; job.s1 = b.scale; job.p1 = b.position;
    }
    return job;
  });
  const es = `${ES_HELPERS}
var seq = app.project.activeSequence;
if (!seq) return __result({ error: "sem_sequencia" });
var frameTicks = parseFloat(seq.timebase);
var jobs = ${briefing.esJson(jobs)};
var out = [];
for (var i = 0; i < jobs.length; i++) {
  var j = jobs[i];
  if (j.action !== "static" && j.action !== "push") { out.push({ key: j.key, status: "skipped", detail: j.reason || j.action }); continue; }
  try {
    var item = clipAt(seq, j.v, j.c);
    var m = item && findMotion(item);
    var pr = m && findProps(m);
    if (!pr || !pr.scale || !pr.position) { out.push({ key: j.key, status: "error", detail: "sem_scale_position" }); continue; }
    if (j.action === "static") {
      pr.scale.setValue(j.scale, true);
      if (j.pos) pr.position.setValue([j.pos[0], j.pos[1]], true);
      out.push({ key: j.key, status: "applied", detail: "static" });
    } else {
      var t0s = Number(j.st) / 254016000000;
      var t1s = (Number(j.en) - frameTicks) / 254016000000;
      pr.scale.setTimeVarying(true);
      pr.position.setTimeVarying(true);
      // reescrita de push próprio: remove keys antigas na janela antes de recriar; falha não aborta
      try { if (pr.scale.removeKeyRange) { pr.scale.removeKeyRange(t0s - 1, t1s + 1, true); pr.position.removeKeyRange(t0s - 1, t1s + 1, true); } } catch (e0) {}
      pr.scale.addKey(t0s); pr.scale.setValueAtKey(t0s, j.s0, true);
      pr.scale.addKey(t1s); pr.scale.setValueAtKey(t1s, j.s1, true);
      pr.position.addKey(t0s); pr.position.setValueAtKey(t0s, [j.p0[0], j.p0[1]], true);
      pr.position.addKey(t1s); pr.position.setValueAtKey(t1s, [j.p1[0], j.p1[1]], true);
      try { // Bezier easing (doc §3.12, interpolação tipo 5) — falha não aborta os keyframes
        pr.scale.setInterpolationTypeAtKey(t0s, 5, true);
        pr.scale.setInterpolationTypeAtKey(t1s, 5, true);
        pr.position.setInterpolationTypeAtKey(t0s, 5, true);
        pr.position.setInterpolationTypeAtKey(t1s, 5, true);
      } catch (e1) {}
      out.push({ key: j.key, status: "applied", detail: "push" });
    }
  } catch (e) { out.push({ key: j.key, status: "error", detail: String(e.message) }); }
}
return __result({ report: out });`;
  const r = await premiere.extendscript(es, { timeoutMs: 300000 });
  const data = JSON.parse(r);
  if (data.error) throw new Error("aplicar: " + data.error.replace(/_/g, " "));
  const report = data.report;
  for (const p of plan) if (p.action === "none") report.push({ key: p.key, status: "skipped", detail: p.reason });
  return report;
}

/** Pipeline compartilhado: câmera salva → mapa → cortes-alvo → estados. */
async function collect() {
  const info = await briefing.activeProjectInfo();
  const slug = briefing.projectSlug(info.path);
  const st = store(slug);
  if (!st.camera) throw new Error("defina a câmera-alvo primeiro (selecione o arquivo no painel Projeto e clique DEFINIR)");
  const res = await multicam.resolveCameraTrackIndex(st.camera);
  const items = await multicam.listMulticamItems(res.multicamNodeId);
  const map = await multicam.exportActiveSequenceMap();
  const cuts = multicam.filterTargetCuts(items, map, res.trackIndex);
  if (!cuts.length) throw new Error("nenhum corte da câmera-alvo na timeline (mapa: " + Object.keys(map).length + " cortes multicam)");
  const states = await detectStates(cuts);
  return { info, slug, st, cuts: cuts.map((c) => ({ ...c, ...states[c.key] })) };
}

/** Analisa sem aplicar: devolve o plano e as contagens por ação (spec §6.4). */
async function analyze() {
  const { slug, st, cuts } = await collect();
  const plan = planRotation(cuts, st.presets, st.push, {});
  return { slug, camera: st.camera, totalCuts: cuts.length,
    statics: plan.filter((p) => p.action === "static").length,
    pushes: plan.filter((p) => p.action === "push").length,
    skips: plan.filter((p) => p.action === "skip").length, plan };
}

// Mesmo formato que /brief/goto valida (HH:MM:SS:FF, ; aceito como separador).
const TC_RE = /^\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2}$/;

/**
 * Filtra cortes pela janela de timecode (spec §6.4). TC ausente = fronteira aberta.
 * TC malformado LANÇA em vez de aceitar o -1 silencioso do tcToSecs — um typo no
 * fromTc não pode virar "aplica na timeline inteira".
 */
function filterCutsByWindow(cuts, fromTc, toTc, fps) {
  if ((fromTc && !TC_RE.test(fromTc)) || (toTc && !TC_RE.test(toTc)))
    throw new Error("fromTc/toTc inválido: use HH:MM:SS:FF");
  const from = fromTc ? briefing.tcToSecs(fromTc, fps) * 254016000000 : -Infinity;
  const to = toTc ? briefing.tcToSecs(toTc, fps) * 254016000000 : Infinity;
  return cuts.filter((c) => c.startTicks >= from && c.startTicks < to);
}

/** Aplica de fato no Premiere. `fromTc`/`toTc` filtram os cortes por janela de timecode (spec §6.4). */
async function apply(opts) {
  const { redo, fromTc, toTc } = opts || {};
  const r = await collect();
  let cuts = r.cuts;
  if (fromTc || toTc) { // variação que só a orquestração permite (spec §6.4)
    cuts = filterCutsByWindow(cuts, fromTc, toTc, r.info.fps);
  }
  const plan = planRotation(cuts, r.st.presets, r.st.push, { redo });
  const report = await applyPlan(plan, cuts, r.st.presets, r.st.push);
  return { slug: r.slug, report,
    applied: report.filter((x) => x.status === "applied").length,
    skipped: report.filter((x) => x.status === "skipped").length,
    errors: report.filter((x) => x.status === "error").length };
}

const EMPTY = { camera: null, presets: [], push: null };

function store(slug) {
  const all = settings.load().autozoom || {};
  return { ...EMPTY, ...(all[slug] || {}) };
}

function saveStore(slug, patch) {
  const all = { ...(settings.load().autozoom || {}) };
  if (patch === null) delete all[slug];
  else all[slug] = { ...store(slug), ...patch };
  settings.save({ autozoom: all });
  return all[slug] || null;
}

module.exports = { planRotation, filterCutsByWindow, store, saveStore,
  learnFromSelectedClip, detectStates, applyPlan, analyze, apply, collect };
