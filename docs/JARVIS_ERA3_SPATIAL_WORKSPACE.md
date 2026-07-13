# JARVIS Era III — Spatial Intelligence Workspace

Era III replaces the single-card overlay with a persistent, multi-layer workspace. Widgets now behave as independent instruments instead of modal popups, and the globe remains visible while any number of instruments are open.

## What is now real

- Every dock instrument opens independently and multiple instruments remain visible together.
- Every window supports minimized, normal, and expanded modes.
- Every visible window is draggable, resizable, focusable, closeable, and refreshable.
- Window position, size, mode, and z-order persist in `jarvis.spatial-widgets.v1`.
- Tile and Cascade arrange the entire workspace; Grid enables 8-pixel magnetic placement.
- Sync All refreshes open instruments. Visible instruments also refresh every 30 seconds.
- A transient request failure preserves the last good payload and marks it stale instead of replacing it with “backend unavailable.”
- No widget uses a blur or modal scrim over the globe.
- The responsive contract includes a dedicated `min-width: 2200px` 4K density layer and a compact mobile layer.

## Device Mesh × Co-op command center

The Devices instrument is now a six-plane operating console:

1. **Mesh** — approved devices, actual online presence, trust role, preferred route, route candidates, object/inbox counts, session/replay memory, and the live event timeline.
2. **Pair** — real `/api/pair` QR image, one-use token fingerprint, expiry, route diagnostics, invite copy/open, approval queue, and trust-level explanation.
3. **Portal** — object portal, device inbox, source device, type, time, file links, and the Co-op shared manifest.
4. **Screen** — real live-screen state, frame count, last frame, resolution, start/stop, control baton state, explicit approve/deny, Ghost Sandbox, and emergency status.
5. **Co-op** — secure session creation/ending, invite, mode choice, ability envelope, human chat, shared tasks, Patch Court state, files, patches, memory counts, and replay coverage.
6. **Security** — permissions, trust levels, device revocation, bounded control expiry, host authority, secret boundary, Ghost isolation, audit counters, and confirmed emergency stop.

It calls the existing Device Mesh and Co-op APIs directly; it does not duplicate those systems or simulate their state.

## Graph and Vision repairs

The Graph placeholder now reads `/api/memory/life-graph?limit=120`. It exposes episodic/semantic/procedural counts, a searchable entity field, memory-domain distribution, Neural Vault provenance, one-click Jarvis analysis, and JSON export.

The Vision placeholder now reads Device Mesh status and visual objects. It exposes the current screen relay, control state, recent visual evidence, explicit laptop capture through `/api/device-mesh/screen`, and Jarvis analysis actions for laptop and phone vision. Screen and camera actions remain permission-aware and are never started automatically.

## 60 delivered interaction and presentation upgrades

1. Multi-window runtime; 2. simultaneous widgets; 3. persistent layout; 4. persistent modes; 5. persistent sizes; 6. persistent positions; 7. persistent z-order; 8. click-to-focus; 9. drag headers; 10. free resize; 11. bounded movement; 12. bounded sizing; 13. minimized mode; 14. normal mode; 15. expanded mode; 16. dock restore; 17. close one; 18. clear all; 19. Tile; 20. Cascade; 21. spatial grid; 22. magnetic snapping; 23. Sync All; 24. per-widget refresh; 25. 30-second polling; 26. visibility-aware polling; 27. loading animation; 28. live status dot; 29. warning status dot; 30. offline status dot; 31. last-sync age; 32. live dock statistics; 33. last-good fallback; 34. stale labeling; 35. truthful empty states; 36. no modal scrim; 37. no backdrop blur; 38. globe continuity; 39. independent scrolling; 40. compact title telemetry; 41. scan-line treatment; 42. layered glass border; 43. focus glow; 44. high-density typography; 45. 4K breakpoint; 46. mobile breakpoint; 47. keyboard-readable controls; 48. control tooltips; 49. ARIA workspace labels; 50. ARIA widget labels; 51. Device Mesh route plane; 52. QR pairing plane; 53. object portal plane; 54. live-screen plane; 55. control-baton plane; 56. Co-op plane; 57. security plane; 58. real Life Graph; 59. real Vision evidence console; 60. Graph export and Jarvis bridge.

These shared upgrades apply to every widget shell. Domain-specific interiors remain specialized: Kalshi remains the information-density standard, Device Mesh/Co-op is the collaboration standard, Graph is the memory-map standard, and Vision is the multimodal evidence standard.

## Verification contract

- `tsc --noEmit` and the production Vite build pass.
- `tests/backend/era3-spatial-contract.test.js` protects modes, persistence, no-blur behavior, Device Mesh/Co-op API wiring, Graph, and Vision.
- Browser verification confirms multiple live windows, minimize/restore, expanded/normal, coordinate drag, free resize, Device Mesh tabs, real payload counts, and no application console errors.
- The complete backend, Device Mesh, Co-op, and memory regression suites remain the release gate.
