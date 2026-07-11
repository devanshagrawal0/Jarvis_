# Current System Audit

Source contract: `C:\Users\devan\Downloads\JARVIS_Codex_Execution_Free_Hosting_and_Camera_Deployment_Specification.docx`

## Repository State

- Git root is `C:\Users\devan\OneDrive\Documents\Kalshi`.
- `git ls-files` returns zero tracked files.
- `jarvis-ui/` is currently untracked from the parent repository.
- `../secrets/` is also untracked, so creating a checkpoint commit before code changes is unsafe without explicit staging guidance.
- Checkpoint status: blocked. Do not stage parent workspace contents automatically.

## Current Architecture

- Local Node HTTP server in `server.js`.
- React/Vite client in `src/`.
- Runtime JSON state in `runtime/`.
- Module catalog in `config/jarvis-modules.json`.
- Playwright tests in `tests/feature` and `tests/visual`.
- Current local app is served at `http://127.0.0.1:8812/` when the long-running server is active.

## Working Features To Preserve

- Spatial shell with exactly three environments: Main, Focus, Plan.
- Floating windows with drag grip, eight resize handles, minimize, restore, close, pin, z-focus, persistence, and undo.
- Jarvis waveform and transient receipt transcript.
- Workpad with local persistence and export.
- Browser module with embedded frame and external-open fallback.
- Projects module using `/api/projects`.
- System Pulse and Active Context modules.
- Module registry route `/api/modules` with masked provider status.
- Gemini backend route `/api/brain`, keeping keys off the browser bundle.
- Existing server-side module router and basic agent task persistence.

## Broken Or Missing Against The New Spec

- No public Cloudflare deployment yet.
- No `wrangler.jsonc`, Worker entry, Durable Object room, or D1/SQLite schema yet.
- No authenticated device pairing or durable user room yet.
- No Camera Matrix module in the spatial UI.
- No browser camera lifecycle controls in the current UI.
- No WebRTC signaling surface yet.
- Agents exist only as rough auto-progress tasks, not a full mission civilization with pause/resume/cancel/evidence/artifacts.
- Provider Health exists in server state but is not exposed as a first-class spatial module.
- Receipts exist in the transcript but not as an inspectable audit module.
- Emergency Stop is not implemented.
- The current local Node server cannot prove phone/iPad external HTTPS behavior.

## Security Risks

- Local `runtime/settings.json` can contain secrets. It must remain uncommitted.
- Camera/microphone must only start from explicit user action.
- Remote device pairing must use short-lived codes, device identity, and explicit approval.
- Commit-class actions such as email send, trading, file deletion, and desktop control must stay gated by confirmation.
- Browser-only deployment cannot inspect local files or control laptop applications without a later installed laptop agent.

## Migration Plan

1. Keep the spatial shell and window manager.
2. Expand the module layer instead of adding tabs or modes.
3. Add local backend routes for `/api/health`, `/api/chat`, `/api/devices`, `/api/pair`, `/api/missions`, and receipt/audit state.
4. Add UI modules for Agents, Camera Matrix, Device Mesh, Provider Health, Receipts, and Emergency Stop.
5. Add Cloudflare Worker and Durable Object scaffold for production deployment.
6. Verify with Playwright tests and screenshots before claiming each slice.

