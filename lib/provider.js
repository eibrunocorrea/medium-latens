"use strict";
/**
 * lib/provider.js — contrato de eventos normalizados + registro de providers LLM.
 *
 * Eventos (kind):
 *   init        {session, model, apiKeySource, tools, mcp}
 *   status      {message}
 *   thinking    {tokens}
 *   text        {delta}
 *   tool_start  {id, name}
 *   tool_input  {id, name, input}      // input já truncado p/ exibição
 *   tool_end    {id, ok, summary}
 *   quota       {info}                 // rate_limit_event do CLI (badge de quota Max)
 *   done        {ok, reply, session, cost, turns, durationMs, error?, canceled?}
 *
 * Um provider expõe { name, run(opts, onEvent) -> child } — child tem .kill().
 * F7 adiciona gemini-cli.js atrás deste mesmo contrato.
 */
const providers = new Map();

function register(p) { providers.set(p.name, p); }
function get(name) { return providers.get(name); }
function list() { return [...providers.keys()]; }
function truncate(s, n) { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; }

module.exports = { register, get, list, truncate };
