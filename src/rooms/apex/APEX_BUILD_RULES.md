# APEX — Build Rules & Integration Bible
### Rules I (Claude) must follow to build APEX without breaking anything.

> Verified against the live codebase (Kalshi + Helix as templates), 2026-07-07. This is a contract, not a suggestion. Read it before writing any APEX server code. Companion to `APEX_MASTER_PLAN.md`.

---

## 0. Golden rules (never violate)
1. **Server code is CommonJS.** `require()` / `module.exports`. Never `import`/`export` in `server/` or `server.js`. Frontend `src/` is ESM/TS (fine).
2. **Never expose secrets.** API keys go in `secret-store.js` `SECRET_FIELDS`, DPAPI-encrypted, resolved `env → settings → ""`. Never send them to the client, log them, or store them in `apex.sqlite`. `SECRET_VALUE_PATTERN` blocks them from memory.
3. **Atomic writes.** JSON files via tmp + `fs.renameSync()` (`writeJsonAtomic`). Never bare `fs.writeFileSync` to a live file.
4. **SQLite = prepared statements + `db.transaction()`** for multi-step writes. `safeDbJson()` on every JSON read (prototype-pollution guard). Never raw `JSON.parse` on DB input.
5. **IDs = `crypto.randomUUID()`. Timestamps = `new Date().toISOString()` / `isoNow()`.** No integer IDs, no epoch ints.
6. **Route handlers return clean JSON errors** (`sendJson(res, code, {error})`), never throw uncaught. Guard subsystems: `if (!apexDb) { sendJson(res,503,{error:"APEX unavailable"}); return; }`.
7. **No external API calls inside route handlers.** External calls live in provider adapters / capability-engine tools.
8. **Don't hardcode Gemini model names.** Use `settings` + `agent-runtime.selectModel`. (Ignore any "gemini-3.x" names — those were a hallucination; confirmed models are gemini-2.5-flash / 2.5-pro / 2.0-flash-lite / text-embedding-004 / gemini-2.0-flash-live.)
9. **Voice stays OFF** (`voiceEnabled:false`) unless the user explicitly enables it. Gemini Live is billed per-minute.
10. **NEVER kill/restart the backend server (`node server.js`, port 8799).** The user runs it; ask them to restart. (Frontend Vite is fine to restart.)
11. **`better-sqlite3` is native** — after a Node version change: `node_modules\.bin\electron-rebuild -f -w better-sqlite3 --version <v>`.

---

## 1. Where things live (exact paths)
```
server.js                              main HTTP server (CommonJS, port 8799); routes = flat if/else in handleApi
server/providers/kalshi-provider.js    PROVIDER TEMPLATE
server/providers/provider-utils.js     errorWithStatus, cleanString, fetchJson(15s), writeJsonAtomic
server/secret-store.js                 SECRET_FIELDS (add apex/alpaca keys here)
server/helix-db.js                     DB TEMPLATE (createHelixDb → helix.sqlite)
server/capability-engine.js            tools: definitions ~171 / declarations ~288 / handlers ~1425
server/tool-gateway.js                 tool selection (alwaysUseful patterns)
server/agent-runtime.js                classify() + selectModel() (mode routing)
server/mission-engine.js               ROLES + mission lifecycle (bot execution)
server/autonomy-policy.js              observe/prepare/act/autopilot gating
server/providers/google-provider.js    Gemini calls + streaming
runtime/neural_vault/agents/definitions/*.js   FILE-AGENT (bot) definitions, auto-discovered
runtime/neural_vault/agents/agent-loader.js     validates + discovers agents
runtime/helix.sqlite                   Helix DB · runtime/apex.sqlite = APEX DB (to create)
src/api.ts                             api() / post() / streamPost() frontend helpers
src/rooms/helix/JarvisPanel.tsx        room→brain context-prefix pattern (template for APEX Jarvis)
vite.config.mjs                        proxy /api → :8799 (WS proxied too)
```

## APEX files to create (Wave 1+)
```
server/providers/apex/alpaca.js  ccxt.js  fred.js  edgar.js  finra.js  finnhub.js   (adapters)
server/apex-db.js                createApexDb(runtimeDir) → runtime/apex.sqlite
src/rooms/apex/… panels, ApexJarvisPanel.tsx, apex-api.ts, useApexWS.ts
```

---

## 2. Provider adapter pattern (per free source)
Factory: `createAlpacaAdapter({ getSettings, fetchImpl = fetch })` returning `{ status, quotes, bars, news, account, positions, placeOrderPaper, wsAuthHeaders, test }`. Rules:
- `status()` returns `{connected, configured, source: env|local|missing, missing:[…], baseUrl}` for `/api/providers/apex/test`.
- Auth = provider-specific. **Alpaca = `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` headers** (paper base `https://paper-api.alpaca.markets`, data `https://data.alpaca.markets`). CCXT/FRED/EDGAR = public or key-in-header. (Kalshi's RSA-PSS is Kalshi-specific — do not copy it for Alpaca.)
- Validate/allow-list base URLs; use `fetchJson` (15s timeout); normalize every response to one internal shape before returning.
- Credentials: `settings.alpacaKeyId || process.env.APCA_API_KEY_ID || ""` (env wins).

## 3. Routes (`server.js`)
- if-block per endpoint, **exact matches before regex patterns**, guard `apexDb`/provider availability, `return` after `sendJson`.
- Helpers already global inside `handleApi`: `sendJson`, `parseRequestData`, `url`, `pathname`, `createReceipt`.
- Add `/api/apex/*` per plan §8. Provider test route is already generic: `/api/providers/apex/test`.

## 4. WebSocket relay
`new WebSocketServer({ noServer:true })` for `/api/apex/ws`; on connection open upstream (Alpaca/CCXT) with server-side auth, relay both directions, close/​error both sides with `[apex-ws]` logs; register pathname in `server.on("upgrade")`.

## 5. apex-db.js (mirror helix-db.js)
`createApexDb(runtimeDir)`: `new Database(runtime/apex.sqlite)`, `pragma journal_mode=WAL; foreign_keys=ON`, `CREATE TABLE IF NOT EXISTS` (schema in plan §7), prepared `stmts`, transactions for multi-step writes, `safeDbJson` on reads, idempotent `try{ALTER}catch{}` migrations. Export methods from the factory. Init in server.js startup **after neuralVault, before capabilityEngine**; expose as module-level `let apexDb`.

## 6. Jarvis tools + APEX mode
- Tool = 3 steps in `capability-engine.js`: definition `["apex_x","desc","observe",false]`, declaration (params schema), handler `apex_x: async (args, ctx) => ({...})`. Prefix `apex_`. Return `{ok, result}` / `{ok:false, error}`.
- Risk levels: `observe` (read), `prepare` (draft), `execute` (act), `commit` (trade/irreversible → `confirmationRequired:true`, autonomy-gated).
- Mode: add `mode==="apex"` in `agent-runtime.classify`, a `brainSystemInstruction()` case, and tool-gateway `alwaysUseful` patterns. Frontend sends `{prompt, mode:"apex"}` + a room-context prefix (Helix `JarvisPanel` pattern). Streaming = NDJSON via `streamPost`.

## 7. Bots — the STRICT convention (LATER; do not build until data+Home ship)
File agent at `runtime/neural_vault/agents/definitions/apex-<name>.js`, exporting exactly:
```js
const meta = { name:"apex-momentum", version:"1.0.0", description:"…", category:"agent", icon:"🤖", tags:["apex","trading"] };
const triggers = { phrases:["…"], intents:["apex","trading"], onEvent:"apex_scan" };
const permissions = { tools:["apex_quotes","apex_bars","calculator"], network:true, readOnly:true }; // readOnly for anything that could trade
const character = { tone:"concise", format:"structured", focus:"numbers only" };
const behavior = { checkIntervalMinutes:15, targetEdge:0.02 };
const steps = [ { id:"scan", title:"…", tool:"apex_scan", description:"…" } ];
module.exports = { meta, triggers, permissions, character, behavior, steps /*, onStart, onShutdown */ };
```
- Validated by `agent-loader.js` (needs `meta.name/version/description`). Names kebab-case; tools snake_case; trigger phrases lowercase.
- **Permissions are a whitelist** — only listed tools run.
- **Execution:** mission-engine (roles) or deployable-agent mission. **Trading is ALWAYS: `readOnly:true` + autonomy `prepare` → build order template → `pendingConfirmations` → user approves → separate `execute`/`commit` tool.** No autonomous trades. Every claim = tool receipt (logged JSONL). This is the user's "very strict and direct way of making bots" — honor it exactly.
- Deployable specialist kinds already include `quant` and `math` (`deployable:quant`, `deployable:math`) — the APEX "quant bot"/"math bot" the user mentioned should extend these, not reinvent them.

---

## 8. Pre-flight checklist before I touch server code
- [ ] Confirmed the exact insertion point in `server.js` (route section, startup wiring order).
- [ ] Added secret fields to `secret-store.js` `SECRET_FIELDS`.
- [ ] Provider adapters normalize + timeout + never leak keys.
- [ ] `apex-db.js` mirrors helix-db (WAL, safeDbJson, transactions, idempotent).
- [ ] Tools registered in all 3 places; risk levels correct; trades gated.
- [ ] No model names hardcoded; voice untouched.
- [ ] Did NOT restart the backend — asked the user.
- [ ] Ran `npx tsc --noEmit` for frontend; server smoke-checked by the user.
