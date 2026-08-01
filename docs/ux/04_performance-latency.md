# 04 · Performance & Latency

Speed *is* UX. Perceived speed matters as much as real speed. Budgets, React
specifics, and the animation cost model.

---

## 1. The budgets (RAIL + Doherty)

| Bucket | Budget | Meaning |
|---|---|---|
| **Response** | < 100 ms | any tap/click acknowledged |
| **Animation** | 16 ms / frame (60 fps); ≤ 8 ms JS/frame | no dropped frames |
| **Idle** | 50 ms chunks | do deferred work in `requestIdleCallback`-sized slices |
| **Load** | < 1 s to interactive for a surface | code-split heavy rooms |
| **Doherty** | < 400 ms system response | keep the user in flow |

- **Rule:** if real work exceeds a budget, **fake the perception** honestly:
  optimistic echo, skeleton, streamed partials, progress. Never a frozen UI.

## 2. Perceived-performance toolkit

- **Skeletons** that match final layout (no layout shift, reads faster than spinner).
- **Optimistic UI** for reversible mutations (02).
- **Streaming / progressive**: render partials as they arrive (Ask pipeline phases,
  streamed model text). Show the first token fast.
- **Stale-while-revalidate**: show cached data instantly, refresh in background,
  reconcile. Great for project lists, graphs, metrics.
- **Prefetch on intent**: on hover/focus of a nav item or row, warm its data. By
  the time the click lands, it's ready.
- **Debounce** input-driven work (search 150–250 ms); **throttle** high-frequency
  events (scroll/resize/pointermove 16–32 ms).

## 3. React performance rules (React 19 + Vite)

- **Stable identities.** Do **not** key an effect on a callback/object recreated
  every render. Use `useRef` for the latest value + run-once effects.
  - *This is the exact HELIX boot bug:* a boot effect keyed on an inline `onDone`
    reset every second when the parent's clock re-rendered → never completed.
    Wrong: `useEffect(fn, [onDone])` with inline `onDone`. Right: `onDoneRef` +
    `useEffect(fn, [])` + a wall-clock failsafe.
- **Re-render hygiene.** A parent that re-renders on a timer (clock/vitals ticking
  every 1s) re-renders all children. Isolate the ticking state into a leaf
  component so it doesn't cascade. `React.memo` boundaries around expensive
  subtrees.
- **Memoize** expensive derived values (`useMemo`) and handlers passed to memoized
  children (`useCallback`) — but don't cargo-cult it on cheap values.
- **List virtualization** for > ~100 rows (evidence, entries, ledgers). Render
  what's visible.
- **Keys** are stable and unique (never array index for reorderable/removable
  lists — causes state bleed and remounts).
- **Code-split rooms** and heavy deps (three.js, charts) with `React.lazy` +
  `Suspense` so opening HELIX doesn't pay APEX's bundle.
- **Cleanup** every effect (timers, listeners, RAF, observers). Leaks = slow tabs
  and zombie work.

## 4. Network / data

- **Coalesce**: don't fire 8 requests where 1 batched endpoint works; but also
  don't block the first paint on a slow aggregate — load shell, then fill.
- **Cache** GETs; invalidate on the matching mutation. Keep a client cache keyed by
  (surface, projectId).
- **Abort** in-flight requests on unmount/param-change (`AbortController`) so a fast
  tab-switch doesn't render stale responses over fresh ones (race bug).
- **Long jobs → async**: > ~10s work (deep research, big pipeline) becomes a
  durable job with progress events + completion toast; let the user leave and come
  back (Observability surface).

## 5. Animation cost model (see 05 for the design side)

- **Only `transform` and `opacity`** animate on the compositor (cheap, off-main-
  thread). Animating `width/height/top/left/margin/box-shadow/filter` triggers
  layout/paint every frame = jank.
- `will-change: transform` **sparingly** and remove it after (each one is a layer =
  memory).
- Avoid **layout thrash**: batch DOM reads then writes; don't read `offsetWidth`
  in a loop that also writes styles.
- **Pause offscreen work**: `requestAnimationFrame` is throttled/paused when the
  tab/pane is hidden — so never gate *correctness* (like an overlay dismissal) on
  RAF alone; use it only for visuals and back it with a timer (the boot lesson,
  again).
- Canvas/WebGL: cap DPR (≤ 2), cap particle counts, stop the loop when not visible,
  reuse geometries/materials.

## 6. Measuring (don't guess)

- `performance.now()` around suspect work; log long tasks (> 50 ms).
- React DevTools Profiler for re-render storms; check "why did this render".
- Network panel for waterfalls (are GETs parallel? is the first paint blocked?).
- Frame rate during animations (DevTools Performance) — verify 60 fps, no long
  frames.
- **Rule:** a perf claim in a PR needs a number, not a feeling.

---

### Performance checklist
- [ ] click ack < 100 ms; result < 400 ms or streamed/skeletoned
- [ ] no effect keyed on an unstable callback; ticking state isolated to a leaf
- [ ] lists > 100 rows virtualized; keys stable
- [ ] rooms/three.js/charts code-split & lazy
- [ ] in-flight requests aborted on unmount/param change
- [ ] animations use only transform/opacity; offscreen loops paused
- [ ] every timer/listener/RAF/observer cleaned up
