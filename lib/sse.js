"use strict";
/**
 * lib/sse.js — relay Server-Sent Events para o painel (EventSource).
 * Cada evento normalizado do provider é retransmitido a todos os clientes conectados.
 */
const clients = new Set();

function handle(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.write(": ola\n\n");
  clients.add(res);
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
  req.on("close", () => { clearInterval(ping); clients.delete(res); });
}

function broadcast(ev) {
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { clients.delete(res); }
  }
}

function count() { return clients.size; }

module.exports = { handle, broadcast, count };
