# UX / HCI Reference Library

Reusable, stack-specific design & engineering standards for the Jarvis rooms
(HELIX, APEX, Forge). These are **normative** — when building or reviewing UI in
this repo, cite the rule you're satisfying. They exist so every screen feels like
one system and every interaction meets a measurable bar, not a vibe.

## The files

| File | Owns | Read before you… |
|---|---|---|
| `01_hci-principles.md` | The laws (Fitts, Hick, Doherty…) + when each binds | design any control, list, or flow |
| `02_ux-interaction-flow.md` | Interaction states, feedback budgets, navigation & flow between screens | wire a button, form, or tab switch |
| `03_layout-positioning-sizing.md` | Spatial system: spacing, grid, sizing, hierarchy, z-index | lay out a screen or place an overlay |
| `04_performance-latency.md` | Perceived speed, React perf, latency budgets, animation cost | fetch data, render a list, animate |
| `05_motion-transitions-3d.md` | Motion tokens, tab transitions, micro-interactions, 3D/depth | add any animation or transition |

Room-specific audits & backlogs live next to the room (e.g.
`src/rooms/helix/docs/`), and **reference** these files rather than repeating them.

## How to use

1. **Building**: pick the relevant file, apply its rules, keep its token names.
2. **Reviewing**: every finding should map to a rule here (or propose a new one).
3. **Extending**: if you discover a durable rule, add it here with a one-line
   rationale and, where possible, the bug that motivated it.

## The five non-negotiables (if you read nothing else)

1. **Every interaction gives feedback within 100 ms** — even if the real result
   takes seconds (skeleton, spinner, optimistic echo). Silence = broken. (04, 02)
2. **Nothing over ~400 ms may block without a progress signal + escape.** Doherty
   threshold; past it, flow breaks. (04)
3. **One spacing scale, one type scale, one motion scale, one z-index scale.** No
   magic numbers. (03, 05)
4. **Animate only `transform` and `opacity`; respect `prefers-reduced-motion`.**
   Everything else risks jank and vestibular harm. (05)
5. **State is honest.** "Not run yet" ≠ "nothing found"; estimates are labeled;
   loading, empty, and error are distinct designed states. (02)

## Hard-won lessons already encoded here

- A full-screen overlay that outlives its purpose silently eats every click →
  strict z-index scale + overlay lifecycle rules (03). *(HELIX boot-overlay bug,
  2026-07-23.)*
- An effect keyed on a callback recreated every render thrashes when a parent
  re-renders on a timer → stable-identity rule + run-once effects (04). *(Same
  bug's root cause.)*
