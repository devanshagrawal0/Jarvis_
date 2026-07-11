# Jarvis HUD Rebuild Spec

## Source Of Truth

1. The visual source of truth is `runtime/hud-template`.
2. The target screenshot is `output/playwright/hud-template-source-target.png`.
3. `runtime/old-brain-3/brain` is feature context only.
4. The current React shell must be judged against the HUD template, not against a generic dashboard.

## Non-Negotiables

1. No text inside the central reactor/core.
2. No large tab strip of feature modes.
3. Exactly three modes: Main, Focus, Plan.
4. Kalshi, Canvas, Vision, Agents, Projects, Phone, Memory, Media, Settings, and Verification are modules/widgets.
5. Jarvis is a minimal transparent chat surface with a single waveform line.
6. Widgets must be floating HUD instruments, not cards.
7. Widgets must be readable at the default viewport.
8. Widgets must be closable, minimizable, draggable, and resizable.
9. Default state must avoid cramped scrollbars.
10. The UI must use the template's tilted side-panel language.
11. Typography must look like the provided HUD: condensed, uppercase labels, mono telemetry, high contrast.
12. The central canvas must remain fast and nonblocking.
13. Motion must be restrained and purposeful.
14. Modules must expose working actions backed by the existing APIs where available.
15. Playwright screenshots must be taken after changes.

## HCI Principles Applied

1. Visibility of system status: top telemetry and module status must show what is live.
2. Aesthetic minimalism: only task-relevant information is visible.
3. User control: every module has close/minimize/resize controls.
4. Recognition over recall: module launcher shows names and status.
5. Spatial hierarchy: center is ambient system state; side panels are actionable modules.
6. Low cognitive load: Main shows only Jarvis, system, modules, and one primary workspace.
7. Comfort: avoid dense small text in default module state.
8. Progressive disclosure: deep module detail appears after opening/resizing a module.
9. Consistency: all widgets share template panel geometry and control affordances.
10. Performance: central HUD canvas is throttled; expensive charts are small and optional.

## Visual Target

1. Full black spatial stage.
2. Template-like starfield/grid/scanline overlay.
3. Central holographic reactor drawn by canvas.
4. No literal label in the reactor.
5. Left panels tilt inward with `rotateY(15deg)`.
6. Right panels tilt inward with `rotateY(-16deg)`.
7. Panels use clipped angular corners.
8. Panels have internal fine scanlines.
9. Controls are small glyph buttons.
10. Bottom navigation resembles template `bottom-nav`.
11. Only Main, Focus, Plan appear in bottom mode controls.
12. Module launcher is a compact dock/sheet, not a mode bar.
13. Jarvis chat is transparent and minimal.
14. Chat includes a single animated waveform line.
15. Default UI should look useful before any command is typed.

## Mode Behavior

1. Main: Jarvis chat, System Overview, Module Sheet, Active Missions.
2. Focus: Jarvis chat, Focus timer, minimal status, current active module only.
3. Plan: Jarvis chat, Canvas/plan module, Agents, Verification.
4. Mode buttons do not represent features.
5. Switching modes changes layout only.
6. Modules can be summoned in any mode.
7. Module visibility persists until closed, unless a mode reset is explicitly requested later.

## Module Inventory

1. Jarvis Chat: prompt input, voice toggle, waveform, response/event stream.
2. System Overview: CPU, memory, network, shield, reactor.
3. Module Sheet: opens modules, shows capability status.
4. Kalshi: load markets, chart, ticket draft warning.
5. Canvas: auto-map, add node, canvas rendering.
6. Vision: camera, screen capture, capture frame, analyze frame, stop.
7. Agents: launch task, progress rows.
8. Projects: index workspace, launch inspect agent.
9. Phone: pair PIN/webhook view.
10. Focus: timer start/pause/quiz.
11. Prepare: email draft.
12. Media: ambient queue.
13. Settings: Gemini key, wake phrase, phone, webhook.
14. Trust: verification records and run verification.
15. Memory/World Model: initially represented by module status and event stream until backend endpoints exist.

## Verification Loop

1. Build with `npm run check`.
2. Capture command/main screenshot.
3. Capture target HUD screenshot.
4. Capture focus and plan screenshots.
5. Use Playwright console checks.
6. Check no center text.
7. Check only three mode buttons.
8. Check module controls exist.
9. Check default widgets are readable.
10. Check no page-level horizontal scroll.
11. Check central canvas has nonblank pixels.
12. Compare screenshot visually against source target.
13. List ten critiques after each visual pass.
14. Patch the highest-impact issues.
15. Repeat until remaining differences are explainable product differences.
