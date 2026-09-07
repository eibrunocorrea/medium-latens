"use strict";
/**
 * lib/briefing.js — Brief Criativo (herança Wind AI, spec v2 §5).
 * Determinístico: parsers (CSV do Premiere formato Wind, tolerante; transcript do
 * pipeline), prompt, validação por schema (sem regex de parse), alinhamento por
 * TIMECODE (bug do Wind era por índice — corrigido: trecho sem match é reportado,
 * nunca desalinhado) e montagem de markers (cores validadas no Wind host.jsx:
 * roxo=6 insert, laranja=3 lettering, vermelho=1 corte; prefixo "[Brief] " para
 * limpeza nunca tocar marker manual).
 * A geração (one-shot no provider ativo) entra na Task 11 deste mesmo arquivo.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const provider = require("./provider");
const premiere = require("./premiere");

const DATA_DIR = path.join(__dirname, "..", "data", "briefs");

const PREFIX = "[Brief] ";
const COLORS = { insert: 6, lettering: 3, corte: 1 };

function pad(n) { return String(n).padStart(2, "0"); }

function secsToTc(s, fps) {
  const total = Math.floor(s * fps + 1e-6);
  const f = total % fps;
  const secs = Math.floor(total / fps);
  return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}:${pad(f)}`;
}

function tcToSecs(tc, fps) {
  const p = String(tc).replace(/;/g, ":").split(":").map(Number);
  if (p.length < 4 || p.some(Number.isNaN)) return -1;
  return p[0] * 3600 + p[1] * 60 + p[2] + p[3] / fps;
}

function normTc(tc) { return String(tc).trim().replace(/;/g, ":"); }
function isTc(s) { return /^\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2}$/.test(String(s).trim()); }

function splitCsvLine(line, sep) {
  const cols = [];
  let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === sep && !inQ) { cols.push(cur); cur = ""; }
    else cur += ch;
  }
  cols.push(cur);
  return cols.map((c) => c.trim());
}

/** CSV de legenda do Premiere, formato Wind (4 colunas), tolerante. */
function parseCsv(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let cols = splitCsvLine(line, ",");
    if (cols.length < 4 || !isTc(cols[1]) || !isTc(cols[2])) {
      cols = splitCsvLine(line, ";");
    }
    if (cols.length < 4) continue;
    if (!isTc(cols[1]) || !isTc(cols[2])) continue;
    const sep = isTc(splitCsvLine(line, ",")[1]) ? "," : ";";
    out.push({ tcStart: normTc(cols[1]), tcEnd: normTc(cols[2]), text: cols.slice(3).join(sep).trim() });
  }
  return out;
}

/** Transcript do pipeline (whisper/corrected: {segments:[{start,end,text}]} em segundos). */
function parseTranscript(json, fps) {
  const segs = (json && json.segments) || [];
  return segs.filter((s) => s && s.text && s.start != null && s.end != null)
    .map((s) => ({ tcStart: secsToTc(s.start, fps), tcEnd: secsToTc(s.end, fps), text: String(s.text).trim() }));
}

/**
 * Acha o transcript certo em `<ws>/transcript/` (não na raiz do workspace — bug corrigido em
 * 2850c0b). Múltiplos masters por workspace são possíveis (ex.: FX3-1_*.corrected.json e
 * FX3-2_*.whisper.json lado a lado) — prioriza `*.corrected.json` (excluindo
 * `*.adobe-transcript.json`, que é o formato de import pro Text panel, não um transcript fonte)
 * pegando o mais recente por mtime; sem corrected, cai pro `*.whisper.json` mais recente.
 * Lança erro citando o diretório e o que foi procurado quando nada casa (ou o diretório não existe).
 */
function resolveTranscript(transcriptDir) {
  const newestMatching = (suffix, excludeSuffix) => {
    if (!fs.existsSync(transcriptDir)) return null;
    const matches = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith(suffix) && !(excludeSuffix && f.endsWith(excludeSuffix)))
      .map((f) => path.join(transcriptDir, f));
    if (!matches.length) return null;
    matches.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return matches[0];
  };
  const corrected = newestMatching(".corrected.json", ".adobe-transcript.json");
  if (corrected) return { file: corrected, kind: "corrected" };
  const whisper = newestMatching(".whisper.json");
  if (whisper) return { file: whisper, kind: "whisper" };
  throw new Error(`transcript não achado em ${transcriptDir} (procurei *.corrected.json e *.whisper.json) — rode engine/transcribe.py ou use CSV`);
}

/** Prompt do Wind adaptado: PT-BR, mesmas regras validadas. */
function buildPrompt(segments) {
  const formatados = segments.map((s, i) => `Trecho ${i + 1} [${s.tcStart} --> ${s.tcEnd}]: ${s.text}`).join("\n");
  return `Você é um assistente criativo. Analise os trechos de narração abaixo e retorne um plano criativo por trecho para um vídeo vertical (Reels/Shorts/TikTok).

REGRAS GERAIS:
- Identifique o tema automaticamente pela narração
- Adapte o tom ao tema (curioso, direto, sem clickbait mentiroso)
- Seja específico e acionável, evite sugestões genéricas

REGRAS PARA MÚSICA (global, uma sugestão para o vídeo inteiro):
- Sugira a emoção/energia geral do vídeo + o gênero musical ideal

REGRAS PARA INSERTS (Higgsfield) por trecho:
- Varie entre dois tipos:
  1. INFORMATIVO: gráficos, textos animados, infográficos, dados visuais
  2. REALISTA: o prompt DEVE incluir cenário detalhado, câmera (ex: handheld, tripod, drone), lente (ex: 24mm wide, 85mm portrait), ângulo (ex: low angle, bird's eye, eye level)
- Pessoas podem aparecer mas NUNCA rostos: corpo inteiro, mãos, silhuetas, costas ou ângulos laterais
- Formato vertical 9:16, prompts em inglês

REGRAS PARA LETTERING por trecho:
- Texto curto e impactante em PT-BR, pode repetir a fala para dar ênfase
- Inclua cor e estilo da fonte (ex: "branco bold com outline preto")

REGRAS PARA CORTES por trecho:
- Só sugira se o trecho tiver mais de 4 segundos E o corte agregar dinamismo real
- Se já parecer objetivo, retorne array vazio []

REGRA DE OURO DOS TIMECODES: o campo "timecode" de cada trecho da resposta deve COPIAR EXATAMENTE o timecode do trecho de entrada correspondente, no formato "INICIO --> FIM". Não invente, não arredonde, não reordene.

RESPONDA APENAS COM JSON VÁLIDO, sem texto extra, sem markdown:

{
  "tema_identificado": "descrição do tema",
  "musica_global": "emoção/energia + gênero musical para o vídeo inteiro",
  "trechos": [
    {
      "timecode": "timecode do trecho copiado da entrada",
      "fala": "texto da fala",
      "inserts": [
        { "tipo": "informativo ou realista", "descricao": "o que mostrar, em português", "prompt": "detailed cinematic prompt in English, vertical 9:16, no faces" }
      ],
      "lettering": "texto sugerido + cor e estilo da fonte",
      "cortes": ["sugestão de corte se aplicável"]
    }
  ]
}

TRECHOS DO VÍDEO:
${formatados}`;
}

/** Validação por schema (feita à mão, zero-dep). Nunca parse por regex. */
function validateBrief(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return { ok: false, errors: ["resposta não é um objeto JSON"] };
  if (typeof obj.tema_identificado !== "string" || !obj.tema_identificado) errors.push("tema_identificado ausente");
  if (typeof obj.musica_global !== "string" || !obj.musica_global) errors.push("musica_global ausente");
  if (!Array.isArray(obj.trechos) || !obj.trechos.length) errors.push("trechos ausente ou vazio");
  else obj.trechos.forEach((t, i) => {
    if (!t || typeof t !== "object") { errors.push(`trecho ${i + 1}: não é objeto`); return; }
    if (typeof t.timecode !== "string" || !t.timecode.includes("-->")) errors.push(`trecho ${i + 1}: timecode inválido`);
    if (typeof t.fala !== "string") errors.push(`trecho ${i + 1}: fala ausente`);
    if (!Array.isArray(t.inserts)) errors.push(`trecho ${i + 1}: inserts não é array`);
    else t.inserts.forEach((ins, j) => {
      if (!ins || typeof ins.tipo !== "string" || typeof ins.descricao !== "string" || typeof ins.prompt !== "string")
        errors.push(`trecho ${i + 1} insert ${j + 1}: precisa de tipo/descricao/prompt`);
    });
    if (typeof t.lettering !== "string") errors.push(`trecho ${i + 1}: lettering ausente`);
    if (!Array.isArray(t.cortes)) errors.push(`trecho ${i + 1}: cortes não é array`);
  });
  return { ok: !errors.length, errors };
}

/** Alinhamento por TIMECODE (nunca por índice). Ordena pela ENTRADA. */
function alignByTimecode(brief, segments) {
  const byStart = new Map();
  for (const t of brief.trechos || []) {
    const start = normTc(String(t.timecode).split("-->")[0]);
    if (!byStart.has(start)) byStart.set(start, t);
  }
  const trechos = [], semResposta = [];
  for (const seg of segments) {
    const t = byStart.get(seg.tcStart);
    if (t) {
      trechos.push({ ...t, tcStart: seg.tcStart, tcEnd: seg.tcEnd, fala: t.fala || seg.text });
      byStart.delete(seg.tcStart);
    } else semResposta.push(seg);
  }
  const unmatched = [...byStart.values()]; // trechos da IA sem segmento correspondente
  return { trechos, unmatched, semResposta };
}

/** Markers do brief (prefixo p/ limpeza seletiva; cores validadas no Wind). */
function buildMarkers(alignedTrechos) {
  const out = [];
  alignedTrechos.forEach((t, i) => {
    const n = i + 1;
    if (t.inserts && t.inserts.length) out.push({ tcStart: t.tcStart, tcEnd: t.tcEnd,
      name: `${PREFIX}Insert ${n}`, comment: t.inserts.map((x) => `${x.tipo}: ${x.descricao}`).join(" | ").slice(0, 200), colorIndex: COLORS.insert });
    if (t.lettering && t.lettering.trim()) out.push({ tcStart: t.tcStart, tcEnd: t.tcEnd,
      name: `${PREFIX}Lettering ${n}`, comment: t.lettering.slice(0, 200), colorIndex: COLORS.lettering });
    if (t.cortes && t.cortes.length) out.push({ tcStart: t.tcStart, tcEnd: t.tcEnd,
      name: `${PREFIX}Corte ${n}`, comment: t.cortes.join(" | ").slice(0, 200), colorIndex: COLORS.corte });
  });
  return out;
}

/**
 * Builders ExtendScript p/ markers no Premiere (Task 12).
 *
 * CONVENÇÃO __result (reconciliada na Task 9/12 contra o premiere-pro-mcp real,
 * dist/tools/scripting.js + dist/bridge/script-builder.js, e confirmada ao vivo
 * via `premiere.extendscript()` — ver task-12-report.md):
 *
 *   1. O `code` passado a `premiere.extendscript(code)` NÃO deve se embrulhar em
 *      IIFE própria. O MCP real já embrulha com `buildScript()`:
 *        (function() { try { <code> } catch(e) { return __error(e.toString()); } })();
 *      Se <code> for `(function(){ ...; return "ok:3"; })()`, o `return` interno
 *      só sai da IIFE de dentro — nunca chega no `return` do wrapper externo, e o
 *      tool não devolve nada. Por isso os builders escrevem statements DIRETOS,
 *      terminados em `return __result(...)`.
 *   2. `extendscript()` resolve com o TEXTO do `data` de `__result(data)`, via
 *      `JSON.stringify(data, null, 2)` do lado do server MCP — verificado ao vivo:
 *      `__result("ok:3")` (string) → resolve pro texto `"ok:3"` (COM as aspas —
 *      `JSON.stringify` de uma string simples inclui as aspas, então checar
 *      prefixo tipo `/^ok:/` quebra); `__result({ok:true})` (objeto) → resolve
 *      pro JSON pretty de 2 espaços `{\n  "ok": true\n}`. Por isso os builders
 *      SEMPRE devolvem OBJETOS via `__result({...})` e os chamadores fazem
 *      `JSON.parse(r)` — nunca comparação de string com prefixo.
 *   3. `__error(msg)` faz `extendscript()` REJEITAR a Promise (isError:true no
 *      MCP) — reservado para exceção inesperada (o wrapper externo já captura
 *      qualquer throw e chama `__error` sozinho). Condição de negócio esperada
 *      (ex.: sem sequência ativa) usa `__result({ error: "sem_sequencia" })` —
 *      resolve normal, o chamador confere `data.error` e decide o que fazer.
 */

// JSON seguro para embutir em source ExtendScript (pré-ES2019: U+2028/29 são terminadores de
// linha "crus" que JSON.stringify NÃO escapa; se um comment/nome tiver um desses caracteres,
// o literal de string quebra no meio, o parse ES falha ANTES de rodar — o try/catch do
// wrapper não ajuda, é erro de parse, não de execução). Toda interpolação de JSON.stringify
// dentro de um template ES abaixo passa por aqui.
function esJson(v) {
  return JSON.stringify(v).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const ACTIVE_PROJECT_INFO_SCRIPT = `var seq = app.project.activeSequence;
if (!seq) return __result({ error: "sem_sequencia" });
var fps = Math.round(254016000000 / parseFloat(seq.timebase));
return __result({ path: app.project.path, fps: fps });`;

/** fps e path do projeto/sequência ativos (1 chamada ES). */
async function activeProjectInfo() {
  const r = await premiere.extendscript(ACTIVE_PROJECT_INFO_SCRIPT);
  const data = JSON.parse(r);
  if (data.error) throw new Error("Premiere sem sequência ativa (erro:" + data.error + ")");
  return { path: data.path, fps: Number(data.fps) || 30 };
}

/** Planta TODOS os markers do brief numa chamada ES só; devolve a contagem. */
function plantScript(markers) {
  return `var seq = app.project.activeSequence;
if (!seq) return __result({ error: "sem_sequencia" });
var fps = Math.round(254016000000 / parseFloat(seq.timebase));
function tcSec(tc){ var p = tc.replace(/;/g, ":").split(":"); if (p.length < 4) return -1;
  return (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]) + (+p[3]) / fps; }
var ms = ${esJson(markers)}, n = 0;
for (var i = 0; i < ms.length; i++) { var m = ms[i]; var s = tcSec(m.tcStart); if (s < 0) continue;
  var e = tcSec(m.tcEnd); var mk = seq.markers.createMarker(s);
  mk.name = m.name; mk.comments = m.comment || "";
  mk.end = (e > s) ? e : (s + 1); // Marker NÃO tem propriedade .duration (confirmado ao vivo via
  // for-in: comments/end/guid/name/start/type) — .end é o tempo ABSOLUTO final, não uma duração
  // relativa; setar .duration era no-op silencioso e plantava marker de ponto (0 seg) sempre.
  mk.setColorByIndex(m.colorIndex); n++; }
return __result({ planted: n });`;
}

/** Remove SÓ os markers do brief (prefixo) — manuais intactos. */
function clearScript() {
  return `var seq = app.project.activeSequence;
if (!seq) return __result({ error: "sem_sequencia" });
var doomed = [], mk = seq.markers.getFirstMarker();
while (mk) { if (mk.name && mk.name.indexOf(${esJson(PREFIX)}) === 0) doomed.push(mk);
  mk = seq.markers.getNextMarker(mk); }
for (var i = 0; i < doomed.length; i++) seq.markers.deleteMarker(doomed[i]);
return __result({ removed: doomed.length });`;
}

/** Move a agulha para o timecode dado (via ticks do timebase da sequência). */
function gotoScript(tc) {
  return `var seq = app.project.activeSequence;
if (!seq) return __result({ error: "sem_sequencia" });
var tpf = parseFloat(seq.timebase); var fps = Math.round(254016000000 / tpf);
var p = ${esJson(normTc(tc))}.split(":");
if (p.length < 4) return __result({ error: "timecode_invalido" });
var h = +p[0], m = +p[1], s = +p[2], f = +p[3];
if (isNaN(h) || isNaN(m) || isNaN(s) || isNaN(f)) return __result({ error: "timecode_invalido" });
var frames = (h * 3600 + m * 60 + s) * fps + f;
seq.setPlayerPosition(String(frames * tpf));
return __result({ ok: true });`;
}

function extractJson(text) {
  const t = String(text || "").replace(/```(?:json)?/g, "");
  let a = t.indexOf("{");
  while (a >= 0) {
    let depth = 0, inStr = false, esc = false;
    for (let i = a; i < t.length; i++) {
      const ch = t[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = !inStr;
      else if (!inStr && ch === "{") depth++;
      else if (!inStr && ch === "}") {
        depth--;
        if (depth === 0) {
          try { const o = JSON.parse(t.slice(a, i + 1)); if (o && typeof o === "object") return o; } catch {}
          break;
        }
      }
    }
    a = t.indexOf("{", a + 1);
  }
  return null;
}

function projectSlug(projectPath) {
  const base = path.basename(String(projectPath || "sem-projeto")).replace(/\.prproj$/i, "")
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "projeto";
  const hash = crypto.createHash("sha256").update(String(projectPath || "")).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

function saveBrief(slug, data) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(slug))) throw new Error("slug inválido");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, slug + ".json"), JSON.stringify(data, null, 2) + "\n");
}

function loadBrief(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(slug))) throw new Error("slug inválido");
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, slug + ".json"), "utf8")); }
  catch { return null; }
}

const ONE_SHOT_SYSTEM = "Você é um gerador de briefs de edição. Responda APENAS com JSON válido, sem markdown, sem comentários.";

function oneShot({ providerName, env, cwd, model, onChild }, prompt) {
  return new Promise((resolve, reject) => {
    const prov = provider.get(providerName);
    if (!prov) return reject(new Error(`provider ${providerName} não registrado`));
    let child = null;
    const timer = setTimeout(() => { try { child && child.kill(); } catch {} }, 180000);
    child = prov.run({ message: prompt, model, session: null, systemPrompt: ONE_SHOT_SYSTEM, cwd, env },
      (ev) => {
        if (ev.kind !== "done") return;
        clearTimeout(timer);
        ev.ok ? resolve(ev.reply || "") : reject(new Error(ev.error || "provider falhou"));
      });
    if (onChild) onChild(child); // expõe o child pro chamador (server.js) poder cancelar via /cancel
  });
}

/** Geração completa: prompt → provider ativo → valida → retry 1× → alinha. */
async function generate(opts) {
  const { segments, onStatus } = opts;
  if (!segments || !segments.length) throw new Error("nenhum trecho de transcript para analisar");
  const prompt = buildPrompt(segments);
  if (onStatus) onStatus(`analisando ${segments.length} trechos no provider ${opts.providerName}…`);
  let raw = await oneShot(opts, prompt);
  let brief = extractJson(raw);
  let v = brief ? validateBrief(brief) : { ok: false, errors: ["resposta sem JSON"] };
  if (!v.ok) { // retry único, com os erros do validador (spec §8)
    if (onStatus) onStatus("resposta inválida — tentando 1× de novo com os erros do validador");
    raw = await oneShot(opts, prompt +
      `\n\nSUA RESPOSTA ANTERIOR FOI REJEITADA PELO VALIDADOR:\n- ${v.errors.join("\n- ")}\nResponda de novo, somente o JSON, corrigindo TODOS os pontos.`);
    brief = extractJson(raw);
    v = brief ? validateBrief(brief) : { ok: false, errors: ["resposta sem JSON"] };
  }
  if (!v.ok) {
    const err = new Error("brief: JSON inválido após retry — " + v.errors.join("; "));
    err.raw = raw; // texto bruto disponível para inspeção
    throw err;
  }
  const aligned = alignByTimecode(brief, segments);
  return { brief, ...aligned, raw };
}

module.exports = { parseCsv, parseTranscript, resolveTranscript, secsToTc, tcToSecs, buildPrompt,
  validateBrief, alignByTimecode, buildMarkers, extractJson, projectSlug, saveBrief, loadBrief, generate, PREFIX, COLORS,
  activeProjectInfo, plantScript, clearScript, gotoScript, esJson };
