# JARVIS Era I ownership boundary

This file records the collision boundary while main JARVIS and HELIX are being developed concurrently.

## Main JARVIS owned in Era I

- `server/request-trust.js`
- `server.js` only at the host/trust/API-policy/confirmation integration points
- `worker/index.ts` and `wrangler.jsonc`
- `server/capability-engine.js` confirmation challenge contract only
- `src/JarvisUI.tsx` current-shell approval presentation
- `src/globe-room/WidgetStrip.tsx` current-shell truth-state conversion
- Era I tests and documentation

## HELIX owned elsewhere

- `src/rooms/helix/**`
- `src/rooms/HelixRoom.tsx`
- `src/rooms/helix.css` and HELIX tokens
- `server/helix-*.js`
- HELIX schemas, migrations, retrieval, pipelines and room workflows

## Shared-file rule

`server.js`, `src/api.ts`, shared types and shared memory modules are integration boundaries. Era I changes must be narrow, additive where possible, and must preserve unrelated working-tree edits. HELIX behavior is not refactored during Era I.

## Product truth contract

Current JARVIS widgets may render only `live`, `stale`, `disconnected`, `empty`, or explicitly labelled `sample` state. Network errors must not turn into invented projects, devices, agents, memories, receipts, markets, connection counts or latency.

## Approval contract

Tool preparation and owner consent are separate events. A capability requester cannot approve its own action. Approval secrets are available only from the direct owner surface, are bound to the original confirmation, expire quickly and are consumed once.

