# JARVIS Repair Implementation Note

## Current Stack

- Frontend framework: React + Vite + TypeScript.
- Backend framework: Node.js HTTP server in `server.js`.
- Current message controller path: `/api/chat` and `/api/chat/stream` in `server.js`, both route through `callGemini`.
- Current model provider path: Gemini calls inside `server.js`, plus `server/agent-runtime.js` for route/model/tool context.
- Current tool/capability files: `server/capability-engine.js`, `server/tool-gateway.js`, `server/autonomy-policy.js`.
- Current Kalshi integration files: `server/providers/kalshi-provider.js`, exposed through `kalshi_*` capabilities.
- Current browser/screen control files: `server/browser-service.js`, `server/windows-broker-client.js`, screen helpers in `server.js`, browser/screen capabilities in `server/capability-engine.js`.
- Current memory files: `server/memory-store.js`, runtime SQLite at `runtime/jarvis-memory.sqlite`, conversation at `runtime/conversation.json`.
- Current artifact files: `server/work-composer/work-composer.js`, runtime artifacts under `runtime/artifacts/work-composer`.
- Current debug/log files: receipts in `runtime/receipts.json`, provider health in `runtime/provider-health.json`, conversation export in `runtime/latest-conversation-extract.md`.

## Files Modified By This Repair

- `server.js`: integrate the repair controller before model/tool execution and save debug traces after each turn.
- `server/agent-runtime.js`: tighten deterministic routing so sports schedule words do not accidentally trigger on generic browser fixture text.
- `server/tool-gateway.js`: separate browser control, web search, Kalshi market search, and device mesh selection.
- `server/autonomy-policy.js`: observe-only tools no longer consume or trip action-rate limits.
- `server/capability-engine.js`: observe-only tools no longer increment the action limiter.
- `server/agent-repair.js`: new deterministic repair controller, topic state, behavior prompt handling, debug trace store, and clean tool-result rendering helpers.
- `tests/backend/jarvis-repair.test.js`: acceptance tests for FIFA/Kalshi separation, topic state, pasted behavior prompts, and clean rendering.

## Preserved Capabilities

- Existing UI, voice, browser actions, screen control, Kalshi, PC graph, device mesh, artifacts, skills, memory, and provider settings are preserved.
- Public routes are not renamed.
- Existing environment variables continue to work.

