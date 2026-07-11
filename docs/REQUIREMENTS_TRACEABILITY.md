# Requirements Traceability

Source contract: `JARVIS_Codex_Execution_Free_Hosting_and_Camera_Deployment_Specification.docx`

| ID | Requirement | Implementation Files | Test / Evidence | Status |
| --- | --- | --- | --- | --- |
| GOV-01 | Read full spec before editing | DOCX extracted and reviewed in Codex session | Extraction showed 294 paragraphs and 15 tables | Done |
| GOV-02 | Create traceability matrix | `docs/REQUIREMENTS_TRACEABILITY.md` | This file | Done |
| GOV-03 | Create system audit | `docs/CURRENT_SYSTEM_AUDIT.md` | Audit file | Done |
| GOV-04 | Checkpoint commit before modifications | Git root has zero tracked files; `jarvis-ui` and `secrets/` are untracked | `git ls-files` count `0`; commit blocked to avoid secrets | Blocked |
| MODES-01 | Exactly Main, Focus, Plan environments | `src/App.tsx`, `src/styles.css` | Playwright mode tests | Done |
| WM-01 | Drag from grip only, eight-way resize, minimize, restore, close, pin, persistence, undo | `src/App.tsx` | Existing and expanded feature tests | Done |
| WM-02 | Collision avoidance around Jarvis and widgets | `src/App.tsx`, `tests/feature/jarvis-modules.spec.ts` | Zero-overlap test and live screenshot | Done |
| JARVIS-01 | Thin triangular waveform, no orb/blob/equalizer | `src/App.tsx`, `src/styles.css` | Visual smoke | Done |
| JARVIS-02 | Natural text conversation through secure backend | `server.js`, `src/App.tsx` | `/api/chat` and command tests | In progress |
| JARVIS-03 | Postcondition receipts before success | `src/App.tsx`, `server.js` | Receipt module/tests | In progress |
| AGENT-01 | Agents panel with mission composer, progress, evidence, artifacts | `server.js`, `src/App.tsx` | Mission e2e tests | In progress |
| AGENT-02 | Pause, resume, cancel missions | `server.js`, `src/App.tsx` | Mission control tests | In progress |
| CAMERA-01 | Enumerate cameras after permission | `src/App.tsx` | Browser camera fallback test; manual device proof required | In progress |
| CAMERA-02 | Local preview, stop tracks, snapshot, status indicator | `src/App.tsx` | Camera module tests | In progress |
| CAMERA-03 | WebRTC publish/subscribe between paired devices | `worker/UserRoom.ts`, `src/App.tsx` | Requires deployed HTTPS and two devices | Planned |
| DEVICE-01 | Short-lived pairing codes and device records | `server.js`, `src/App.tsx`, `worker/UserRoom.ts` | Device route tests | In progress |
| HEALTH-01 | Provider Health shows Gemini connection, model, latency, last request/error/tool | `server.js`, `src/App.tsx` | Feature tests | In progress |
| DEPLOY-01 | Cloudflare Worker/Vite configuration | `wrangler.jsonc`, `worker/index.ts` | `wrangler deploy` after login | Planned |
| DEPLOY-02 | Production HTTPS URL recorded | `docs/USER_SETUP_STEPS.md`, `docs/TEST_EVIDENCE.md` | Blocked until Cloudflare auth | Blocked |
| SEC-01 | No secrets in browser bundle or repository | `server.js`, docs | Secret field masking tests | In progress |
| SEC-02 | Emergency Stop closes media tracks, sockets, agents | `src/App.tsx`, `server.js` | E2E test | In progress |
| TEST-01 | Screenshot evidence at key states | `docs/TEST_EVIDENCE.md`, `test-results/` | Playwright/browser screenshots | In progress |

