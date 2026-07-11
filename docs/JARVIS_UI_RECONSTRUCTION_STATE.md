# JARVIS UI Reconstruction State

## Current Phase

Phase 1 tooling is complete. Phase 2-7 visual reconstruction is in progress, using `design/reference/jarvis-ui-reference.png` as the fixed visual baseline at `1402 x 1122`.

Feature phase has started without changing the three-mode shell: modules are now registry-driven, provider-gated, and test-covered.

## Completed Components

- Reference image copied to `design/reference/jarvis-ui-reference.png`.
- Reference analysis script created: `scripts/analyze-reference.mjs`.
- Generated reference analysis, palette, and region files in `design/generated/`.
- Deterministic visual-test mode added via `?visualTest=1`.
- Visual capture script created: `scripts/capture-jarvis-reference.mjs`.
- Pixel/SSIM comparison script created: `scripts/compare-jarvis-reference.mjs`.
- Visual smoke test created: `tests/visual/jarvis-reference.spec.ts`.
- Left middle default panel changed from Module Sheet to Network Status.
- Right-side default stack changed to Target Analysis, Threat Assessment, Fleet Status, Environment, and Time Synchronization.
- Right-side stack dimmed after measured luminance regression.
- Default left-lower System Logs panel added to match the reference frame.
- System Overview reworked from generic CPU/MEM tiles into reference-style readouts and micro charts.
- Bottom mode controls reduced from button-like tabs into a low-luminance instrument rail.
- Jarvis command input reduced into a thin transparent waveform strip.
- Canvas field, outer reactor geometry, top telemetry, and non-core panel chrome dimmed through measured screenshot loops.
- Capture script now cache-busts each run and reports loaded asset filenames to prevent stale visual comparisons.
- Shared 51-module registry added at `config/jarvis-modules.json`.
- Node API now exposes `/api/modules`, `/api/modules/:id`, `/api/modules/:id/run`, `/api/brain/profile`, and `/api/memory`.
- Provider Vault now masks secrets and exposes only connected/missing provider status.
- Personal brain profile is derived from `JARVIS_Master_Brain_150_Page_Specification.docx` extraction in `runtime/master-brain-extract.txt`.
- Module Sheet now consumes the server registry instead of the tiny hardcoded React catalog.
- Module Inspector and Memory Core floating widgets added.
- Interactive widgets have reliable click hitboxes, native resize handles, close, and minimize controls.
- Feature/API/UI smoke tests added at `tests/feature/jarvis-modules.spec.ts`.

## Locked Components

- None. No region is below the acceptance threshold yet.

## Remaining Components

- Central reactor geometry and luminance.
- Left upper System Overview exact luminance and micro-chart geometry.
- Left middle Network Status exact luminance and geometry.
- Left lower System Logs exact luminance and typography.
- Central outer geometry/rings/targeting arms.
- Bottom navigation labels and luminance.
- Top telemetry fine alignment.
- Background atmosphere and foreground depth particles.
- Deeper old-brain integrations: streaming brain, real agents, Canvas LMS, authenticated Kalshi portfolio/orderbook, device mesh, and guarded computer-use.

## Current Visual Score

- Overall mismatch: `3.2812%`
- SSIM: `0.335735`
- Mean pixel difference: `7.2273`
- Latest screenshot: `test-results/jarvis/current.png`
- Latest difference: `test-results/jarvis/difference.png`
- Latest enhanced difference: `test-results/jarvis/difference-enhanced.png`
- Latest report: `test-results/jarvis/visual-report.json`

## Worst Regions

1. `centralReactor` - mismatch `32.1071%`, SSIM `0.367292`, luminance diff `16.7884`
2. `rightThreatPanel` - mismatch `26.1063%`, SSIM `0.123955`, luminance diff `12.9532`
3. `leftLowerPanel` - mismatch `19.0112%`, SSIM `0.132190`, luminance diff `11.2358`
4. `leftMiddlePanel` - mismatch `18.2618%`, SSIM `0.149014`, luminance diff `10.1884`
5. `leftUpperPanel` - mismatch `14.7481%`, SSIM `0.183983`, luminance diff `9.5028`

## Known Functional Issues

- No Tauri project is present in `jarvis-ui`; the current app is Vite + React + Node server.
- Root repository has no baseline commits and contains many untracked sibling projects including `secrets/`, so a full-root baseline commit was intentionally not created.
- Existing functional modules remain available but are not all represented in the reference frame.
- A local `C:\Users\devan\OneDrive\Desktop\holographic-command-hud-ui.zip` and `C:\Users\devan\OneDrive\Desktop\mangotrades\stark-hud.html` were located for future UI/core reference work.
- Some registered modules are honest adapter slots, not fake completed integrations. Provider-gated modules open Provider Vault until their keys are added.
- The Browser plugin could not attach to the in-app browser tab in this run, so live behavior was verified through Playwright against `http://127.0.0.1:8812/`.

## Last Successful Build

- `npm run check` passed.
- `npm run test:feature` passed.
- `npm run visual:capture` passed.
- `npm run visual:compare` passed.
- `npm run test:visual` passed after the UI reconstruction pass.
- Live server refreshed on `http://127.0.0.1:8812/`.

## Next Exact Actions

1. Wire the next real old-brain feature: memory graph or Canvas LMS is the best next integration.
2. Replace simulated agent progress with the old backend's real research/parliament/computer-use run events.
3. Replace the remaining atom-like central core with a closer mechanical iris without increasing mismatch.
4. Continue compare loop after each localized correction.

## Architecture Decisions

- Reference image is only used for analysis and comparison, never as production background.
- `?visualTest=1` freezes boot, metrics, polling, canvas animation, transitions, and exposes `data-visual-ready="true"`.
- Only `Main`, `Focus`, and `Plan` are modes; every other feature remains a summonable module/widget.
- Raw provider secrets stay out of public settings and out of model context.
- Heavy 3D panel transforms are reserved for ambient HUD panels; interactive module widgets use reliable hitboxes first.
