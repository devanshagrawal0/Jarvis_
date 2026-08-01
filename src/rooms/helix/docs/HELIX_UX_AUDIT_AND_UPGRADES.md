# HELIX — UX Audit & 30-Upgrade Backlog

Grounded in `/docs/ux/` (01 HCI · 02 flow · 03 layout · 04 perf · 05 motion).
Audit is from live inspection of HELIX v2 (2026-07-23), after the boot-overlay
click-blocker + model-failover fixes landed.

---

## A. Current state (what's true today)

**Works end-to-end (verified live):** shell (sidebar/spine/topbar/inspector),
project switcher, ⌘K palette, density cycle, all 11 nav surfaces render, Projects
list + create + delete (with cascade), Ask → real cited research pipeline (answer +
12 evidence cards), GET routes across surfaces return real data.

**Architecture:** `HelixV2.tsx` shell → `surface` state switches 11 surfaces;
`UIProvider` (toast/prompt), `SelectionProvider` (inspector/compare),
`ContextMenuProvider`, `DrawerProvider`. Backend: ~50 `/api/helix/*` routes over
`helix-db` (SQLite) + `substrate` (7-layer memory).

## B. Findings (by severity → impact)

**Flow / navigation (highest leverage)**
- F1. **No transition between surfaces** — surface swap is a hard cut (`? :` ladder).
  Disorienting; loses the sense of moving through the spine. *(05 §4)*
- F2. **Spine is decorative, not synced** — it maps only 4 of 11 surfaces and
  doesn't advance/pulse as you move. The core conceptual model is under-used. *(01
  Norman, 02 §6)*
- F3. **Weak cross-surface handoff** — Ask offers "→ Evidence", but most surfaces
  dead-end. The "next step" isn't consistently offered. *(02 §6, goal-gradient)*
- F4. **State not deep-linkable / not restored** — refresh loses surface+selection;
  scroll not preserved on tab switch. *(02 §6)*
- F5. **Two project lists drift** — shell's `projects` and Projects surface's own
  list are separate fetches; create/delete only partly sync. *(single-source)*

**Feedback / latency**
- L1. **No skeletons** — surfaces show empty then pop; Ask waits ~10–30s on a real
  research call with only a phase ticker (good) but other GET surfaces have no
  loading state. *(04 §2)*
- L2. **No prefetch-on-intent** — hovering a nav item / project row doesn't warm its
  data; every switch pays full latency. *(04 §2)*
- L3. **No optimistic UI** — create/delete wait the round-trip. Delete is verified
  but could echo instantly. *(02 §3)*
- L4. **Silent GET failures** — surfaces `.catch(()=>{})`; a failed load looks
  identical to "empty". Needs error state. *(02 §4)*

**Motion / 3D**
- M1. No micro-interactions on rows/cards/buttons beyond CSS hover; no press state.
- M2. Knowledge graph exists but the 3D/explore surface isn't a peak; no shared-
  element from list→detail.
- M3. Boot is now robust but visually minimal; the "peak/end" moments (pipeline
  complete, decision committed) aren't celebrated.

**Layout / honesty**
- Y1. Some surfaces still carry **sample/demo scaffolding** mixed with live data
  (Home bottom cards, Projects SAMPLE fallback) — honesty risk (02 §4). Audit each.
- Y2. Z-index not yet a named scale (boot bug fixed tactically) — codify `--z-*`.
- Y3. Inconsistent empty-state treatment across surfaces.

**Accessibility / power-user**
- X1. `prefers-reduced-motion` not globally handled. *(05 §3 — mandatory)*
- X2. Focus-visible rings inconsistent. *(02 §1)*
- X3. ⌘K covers navigation but not *actions* on the current surface (bulk, filters).

---

## C. The 30 upgrades (prioritized: P1 highest impact/lowest risk first)

### Group 1 — Foundations (do first; everything builds on these)
1. **Motion + z-index token layer** — `--dur-*`, `--ease-*`, `--z-*` in CSS; global
   `prefers-reduced-motion` reset. *(05 §1, 03 §5, 05 §3)*
2. **Surface-transition primitive** — a `<SurfaceSwitch>` wrapper: crossfade +
   directional slide (forward/back by spine order), shell static, scroll preserved.
   *(F1, 05 §4)*
3. **Single project source** — lift projects to one store/provider; shell + Projects
   read the same; create/delete update once. *(F5)*
4. **Data layer with SWR + abort + prefetch** — `useHelixResource(key, url)`:
   cached, stale-while-revalidate, `AbortController` on change, `prefetch(url)` on
   hover/focus. *(L1–L4, 04 §3–4)*
5. **Skeleton + error + empty triad** — one `<SurfaceState>` component every surface
   uses; kills silent `.catch` blanks. *(L1, L4, 02 §4)*

### Group 2 — Flow & navigation
6. **Live spine** — sync all 11 surfaces to a stage, advance + pulse on move, click a
   node to jump. *(F2)*
7. **Persistent "next step" bar** — every surface offers the spine-forward action
   (Ask→Evidence→Analyze→Decide→Build). *(F3)*
8. **Deep-linkable state** — persist `{surface, projectId, selection}` to hash +
   store; restore on load; back/forward works. *(F4)*
9. **Command palette actions (not just nav)** — surface-contextual actions in ⌘K
   (run pipeline, add source, record decision, filter, delete). *(X3)*
10. **Cross-surface breadcrumbs / context chips** — show the through-line ("from
    question X → 8 evidence → this decision"). *(02 §6)*
11. **Recent + pinned** — recent surfaces/projects, pin favorites in the switcher.
12. **Global search that jumps** — the topbar search resolves to entities/evidence/
    decisions and navigates to them (currently placeholder). *(02 scent)*

### Group 3 — Feedback, latency & honesty
13. **Prefetch-on-hover** wired to nav + project rows + evidence rows. *(L2)*
14. **Optimistic create/delete** with rollback + undo toast. *(L3, 02 §3)*
15. **Streaming Ask answer** — render tokens as they arrive, not one final blob.
    *(04 §2)*
16. **Honesty sweep** — remove/label all sample scaffolding; every number is live or
    badged "demo/estimate". *(Y1, Y3)*
17. **Determinate progress** where estimable (pipeline ETA, upload %) instead of
    spinners. *(01 goal-gradient)*
18. **Latency HUD (dev)** — surface load time + request waterfall in the inspector
    for ongoing perf discipline. *(04 §6)*

### Group 4 — Motion, micro-interactions & 3D
19. **Micro-interaction pass** — hover lift, press scale, toggle animation, focus-
    visible rings — every interactive element. *(M1, 02 §1)*
20. **Staggered list entrances** across evidence/projects/entries. *(05 §6)*
21. **Shared-element expand** — list row → detail/drawer magic-move (evidence,
    project). *(M2, 05 §4)*
22. **Tick-flash live data** — signals/metrics pulse on change (reuse Jarvis pattern).
23. **Milestone celebrations** — pipeline-complete reveal, decision-committed stamp,
    new-evidence shimmer; reserved for real peaks. *(M3, 05 §5)*
24. **3D knowledge-graph polish** — depth, hover halo, focus-node camera ease, lazy-
    loaded + reduced-motion static fallback. *(05 §7)*
25. **Ambient depth** — subtle pointer parallax + glass layering on the shell (no
    WebGL, `pointer-events:none`). *(05 §7)*

### Group 5 — Per-surface depth & power-user
26. **Evidence surface** — sortable/filterable, bulk select→compare, source badges,
    contradiction highlighting inline.
27. **Analyze surface** — assertion builder → decision flow with integrity check
    surfaced; contradiction resolution UX.
28. **Build/Artifacts** — live preview, template gallery, one-click export, artifact
    versioning visible.
29. **Observability** — real run timeline scrub, cost/latency per run, retry.
30. **Keyboard-complete** — every action reachable by key; a discoverable cheat
    sheet (extend the existing `?`), `g`+key nav already present — document + expand.

---

## D. Wave plan (2-then-check, no breaking order)

- **W1 — Foundations:** #1 tokens/reduced-motion, #2 surface-transition. *(check)*
- **W2 — Data spine:** #3 single project source, #4 SWR/abort/prefetch, #5 state
  triad. *(check)*
- **W3 — Flow:** #6 live spine, #7 next-step bar. *(check)*
- **W4 — Flow+:** #8 deep-link, #9 palette actions. *(check)*
- **W5 — Feedback:** #13 prefetch, #14 optimistic+undo, #15 streaming. *(check)*
- **W6 — Honesty+perf:** #16 honesty sweep, #17 determinate progress, #18 HUD.
- **W7 — Motion:** #19 micro-interactions, #20 stagger. *(check)*
- **W8 — Motion+:** #21 shared-element, #22 tick-flash, #23 celebrations.
- **W9 — 3D:** #24 graph polish, #25 ambient depth. *(check)*
- **W10–12 — Per-surface depth:** #26–30 across two-surface waves.

Each wave: apply rules from `/docs/ux/`, browser-verify, no regressions.

---

## E. Acceptance bar (every wave)
- Meets the relevant `/docs/ux/` checklist(s).
- No new console errors; typecheck clean; browser-verified.
- `prefers-reduced-motion` respected; focus-visible present.
- No fabricated data; empty/loading/error distinct.
- No z-index outside `--z-*`; no effect on an unstable-identity dependency.
