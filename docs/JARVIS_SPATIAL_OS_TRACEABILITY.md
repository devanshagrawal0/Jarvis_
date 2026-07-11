# JARVIS Spatial OS Traceability Matrix

Source: `C:\Users\devan\Downloads\JARVIS_Spatial_OS_Implementation_Blueprint_v2.pdf`

## Active Build Slice

The current rebuild follows Blueprint milestone 120: spatial shell first.

| Requirement | Blueprint Pages | Implementation Target | Verification |
| --- | ---: | --- | --- |
| Only Main, Focus, Plan are environments | 2, 6-8, 120 | `ShellMode = main/focus/plan`; no feature modes | Playwright checks `data-mode` and environment switch |
| No permanent dashboard/tab rail for modules | 2-3, 28 | Module Library is summoned as a spatial window | UI test opens library through Jarvis |
| Jarvis is one thin waveform plus transient transparent transcript | 18-19, 120 | `JarvisConsole` fixed per-mode position | UI test submits command and reads receipt |
| Window manager before modules | 5, 23-25, 120 | DOM spatial windows with geometry state | Drag/resize/minimize/restore tests |
| Eight-direction resize | 24, 130 | N, NE, E, SE, S, SW, W, NW handles | Playwright resizes from SE/NW |
| Move, snap, minimize, close, restore, pin, undo | 25, 130 | Window commands + UI controls + history stack | Playwright and command receipts |
| Per-mode workspace persistence | 6-8, 24, 122 | Local persisted workspace keyed by mode | Reload test validates geometry/content |
| Mode transitions preserve active compatible modules | 6-8, 121-122 | Open windows are carried into Main/Focus/Plan with target-mode geometry | Feature test switches to Focus with Workpad + Projects open |
| Spatial lanes avoid panel/transcript collisions | 23-25, 120 | Focus reserves left module rail, center work surface, right Jarvis lane | Feature test asserts zero overlap between Workpad, Projects, Jarvis |
| Core has no text/buttons | 2-3, 127 | Core is background identity only | Visual smoke asserts forbidden labels absent |
| First real modules: Workpad, Browser, Projects | 120 | Real local Workpad, embedded/open Browser, `/api/projects` Projects | Feature tests open/use all three |
| Every visible control works or is removed | 2-4, 119-120 | No decorative module buttons in active slice | Interaction tests click visible controls |
| Command grammar controls UI | 20-22, 121 | Open, move, resize, minimize, close, restore, pin, mode, undo | Command replay tests |
| Structured action receipts | 19, 108-109, 121 | Receipt cards in Jarvis transcript | UI test checks receipt content |

## Explicitly Not Claimed Complete

- Streaming voice/TTS is not in this slice.
- Computer-use, Canvas LMS, authenticated Kalshi, phone calls, and real external write actions remain later vertical slices.
- The old pixel reference compare is no longer the primary acceptance gate for this rebuild; the PDF's interaction matrix is.

## Current Milestone 120 State

Implemented now: spatial shell, GPU HUD core, transient Jarvis waveform/transcript, Module Library, Workpad, Browser, Projects, System Pulse, Active Context, mode switching, persistence, geometry controls, command receipts, and overlap regression coverage.

Next vertical slices should add authenticated integrations one at a time behind the same module contract: first settings/key vault, then Gemini command brain, then screen/camera vision, then Kalshi/Canvas/phone actions with permission gates.
