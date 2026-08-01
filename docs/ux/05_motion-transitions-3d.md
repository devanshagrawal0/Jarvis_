# 05 · Motion, Transitions & 3D

Motion has a job: **orient, confirm, connect, and — sparingly — delight.** Motion
without a job is noise and reads as "AI-generated." Every animation answers "what
does this help the user understand?"

---

## 1. Motion tokens (one scale)

**Durations** (ms): `instant 0`, `fast 120`, `base 200`, `slow 320`, `slower 480`.
- Micro-interactions (hover, press, toggle): **120–160**.
- Enter/exit, tab transitions: **200–260**.
- Large/hero/3D reveals: **320–480**. Beyond ~500ms feels slow unless it's a
  deliberate cinematic peak.

**Easing:**
- **ease-out** (`cubic-bezier(.2,.8,.2,1)`) for **enter** (fast in, gentle settle).
- **ease-in** (`cubic-bezier(.4,0,1,1)`) for **exit** (gentle start, quick leave).
- **ease-in-out** for moves/reorders.
- **spring** (small overshoot) only for playful, physical moments (drag drop, new-
  best). Never for text/data.

**Rule:** put these in CSS custom properties/tokens; components reference tokens,
never literal durations.

## 2. What to animate (and the hard constraint)

- **Only `transform` and `opacity`** (04 §5). Fade + slide/scale = 95% of good UI
  motion, all compositor-cheap.
- Enter: `opacity 0→1` + `translateY 8px→0` or `scale .98→1`.
- Exit: reverse, faster, ease-in.
- Never animate layout properties per-frame.

## 3. `prefers-reduced-motion` is mandatory

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```
- Replace movement with instant/opacity-only changes. Disable parallax, autoplay,
  large 3D motion. This is accessibility (vestibular disorders), not optional.
- Provide the *information* the motion conveyed by other means (state still changes,
  just without travel).

## 4. Transitions between tabs/surfaces (the flow work)

- **Shell stays; surface transitions.** Sidebar, topbar, spine are static anchors;
  only the surface content animates. Animating the whole screen is disorienting.
- **Directional continuity:** forward navigation slides content in from the right
  (+X), back from the left. Deeper in the spine = forward. This teaches spatial
  structure.
- **Crossfade + small slide**, `base` duration, ease-out. Never a hard cut (feels
  broken), never a slow wipe (feels sluggish).
- **Preserve scroll & state** across the transition (02 §6). The transition is
  cosmetic; the data/context is continuous.
- **Shared-element (magic-move):** when an item expands into a detail/drawer, animate
  the shared element from its list position to its detail position so the user keeps
  their anchor. Great for evidence card → detail, project row → project.
- **Spine sync:** as the surface changes, the active spine node advances with a
  short pulse — reinforcing "where am I in the pipeline" (goal-gradient).

## 5. Micro-interactions (confirm, don't decorate)

- **Hover:** subtle lift (`translateY -1px` + shadow/glow token), 120ms. Magnetic
  hover on primary targets (Fitts assist).
- **Press:** scale `.97`, 80–120ms — tactile acknowledgement < 100ms (02).
- **Toggle/switch:** animate the knob + track color, 160ms ease-out.
- **Live data:** tick-flash (brief bg pulse in the change direction — green up / red
  down), then fade. Signals "this is live" (already a Jarvis pattern).
- **Success:** checkmark draw-on, row settle. Reserve **confetti / shockwave /
  full-screen** for real milestones only (Von Restorff — overuse kills meaning).

## 6. Orchestration

- **Stagger** list/grid entrances (~30–50ms per item, cap total ~300ms) so groups
  read as groups arriving, not a wall snapping in.
- **One focal motion at a time.** Don't animate five things competing for the eye;
  choreograph a lead element, others support.
- **Interruptible:** if the user acts mid-transition, respond now — never trap them
  behind an animation (and never behind a *non-dismissable* overlay — 03 §5).

## 7. 3D & depth (the "cool" layer, used with discipline)

- **Purpose first:** 3D earns its cost when it conveys structure (knowledge graph
  in space, pipeline as a growing form, depth = hierarchy) or provides a genuine
  peak (Live-Run reveal). Decorative 3D that says nothing = cut it.
- **Cheap depth without WebGL:** layered translucency + blur (glass), soft shadows,
  subtle parallax on pointer (±4–8px), `perspective` + `rotateX/Y` tilt on cards
  (≤ 6°). Most "3D feel" needs no three.js.
- **When WebGL (three.js):** knowledge-graph force layout, cinematic takeovers.
  Budget hard (04 §5): cap DPR, instance geometry, pause when hidden, lazy-load the
  whole module (code-split). Provide a static fallback for reduced-motion / low-end.
- **Layer the glass** on the z-scale (03 §5); never let a decorative canvas capture
  pointer events over interactive content (`pointer-events:none` on ambient layers).

## 8. Sound (optional, subtle, off by default-loud)

- Tiny, low-volume cues for meaningful events (send, complete, error). Respect a
  mute setting; never essential to understanding. (Jarvis has a sound system —
  reuse it, don't reinvent.)

---

### Motion checklist
- [ ] durations/easing from tokens; enter ease-out, exit ease-in
- [ ] only transform/opacity animated
- [ ] `prefers-reduced-motion` handled (movement → instant/opacity)
- [ ] tab transitions: shell static, surface crossfade+directional slide, state preserved
- [ ] micro-interactions < 120ms; big celebrations reserved for real milestones
- [ ] staggered group entrances; one focal motion; interruptible
- [ ] 3D only where it conveys structure or is a true peak; budgeted + lazy + reduced-motion fallback
- [ ] ambient/decorative layers are `pointer-events:none`
