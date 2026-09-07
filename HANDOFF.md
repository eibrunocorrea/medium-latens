# Session History

### 2026-09-07 (Codex)

Objective: show the installed product version in the CEP panel header through `/health`.

- ENTREGUE: `/health` reads `APP_DIR/VERSION` through the existing `readVersion` export. The panel displays known versions, clears the version offline, and uses the requested Portuguese offline message. Bundle and extension versions both match the numeric `VERSION` prefix.
- ARQUIVOS: `server.js`, `panel/index.html`, `panel/CSXS/manifest.xml`, `test/panel.test.js`, `test/server-auth.test.js`, `test/telemetria-integracao.test.js`, and this handoff.
- DECISOES: preserved `readVersion` behavior, including its missing/empty-file fallback, without editing `lib/status.js`. Supplied real dependencies to both HTTP test VMs. CSP, request authentication, EventSource, script order, and listener were preserved.
- COMO TESTAR: `node --check server.js`, then `node --check lib/status.js`, then `node --test test/panel.test.js test/server-auth.test.js`, then `node --test test/*.test.js`. TDD evidence: focused RED 24 pass / 7 fail, focused GREEN 31 pass / 0 fail. The first full run exposed the telemetry VM dependency gap (459 pass / 1 fail); after fixing its setup, telemetry integration passed 9/9 and the final full run passed 460/460 with zero failures, skips, or cancellations. `git diff --check` passed.
- PENDENTE: no requested implementation items remain. Coordinator review and push are pending. Visual verification inside Premiere was not performed; panel evidence is source assertions and HTTP handler tests. The existing U+2014 in the login instruction at original panel line 115, now line 116, remains outside scope.
- ARVORE: started clean on `feat/panel-version` at `3ad5f35`. Only the listed files changed, for one local commit. No push performed.
