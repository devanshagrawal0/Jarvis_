# 03 · Layout, Positioning & Sizing

The spatial system. One scale for everything; the eye reads structure before words.

---

## 1. Spacing scale (4 px base, 8 px rhythm)

Use only these steps (px): **2, 4, 8, 12, 16, 24, 32, 48, 64**. No `margin: 7px`.

- Expose as tokens; scale them by **density** so Compact/Comfortable/Ultra change
  spacing, not layout. HELIX already has a density system — spacing must key off it.
- **Rule:** vertical rhythm is a multiple of 4; related items 4–8px apart,
  groups 16–24px, sections 32–48px (proximity = grouping, Gestalt).

## 2. Grid & alignment

- Content on a consistent column grid; align to it. Optical alignment beats
  mathematical when they disagree (icons, punctuation).
- **Rule:** everything aligns to *something* — a shared left edge, a baseline, a
  grid line. Ragged, unaligned edges read as "unfinished / broken".
- Tables: header and rows share the **same** column template. (Bug pattern: adding
  a cell to rows but not the header breaks alignment — keep them in one source.)

## 3. Sizing

- **Hit targets:** ≥ 40×40 px interactive area (Fitts). Transparent padding is
  fine; the *visual* can be smaller.
- **Line length:** body text **45–75 characters** (`max-width: ~65ch`). Wider =
  hard to track; narrower = choppy.
- **Type scale:** modular (e.g. 11, 12.5, 14, 16, 20, 26, 34). Pick from the scale;
  don't freestyle font sizes. Weight + size + color = hierarchy.
- **Icons:** size to the text they sit with (`1em`), share stroke width (HELIX
  `Ico` uses `1em` + stroke 1.7 — keep new icons consistent).

## 4. Visual hierarchy

Rank every screen's elements 1→n and express rank through **size, weight, color,
and space** — in that order of strength.

- Reading patterns: **F-pattern** for text-dense (list/feed), **Z-pattern** for
  sparse/landing, **layer-cake** for scannable sections. Put the important thing
  where the eye lands first (top-left in LTR).
- **One accent, one emphasis** per view (Von Restorff). The accent color
  (`--v-accent`) marks the *primary* path only; semantic colors (good/warn/bad)
  are separate and never used as decoration.
- Whitespace is the cheapest hierarchy tool — group by proximity, separate by gap.

## 5. Z-index — a strict, named scale (this bit is load-bearing)

Uncontrolled stacking is how a launch overlay ends up eating every click. Define a
scale and **never** hand-write a random `z-index: 9999`.

```
--z-base:      0     content
--z-sticky:    100   sticky headers, spine, toolbars
--z-nav:       200   sidebar / persistent chrome
--z-dropdown:  300   menus, popovers, tooltips
--z-drawer:    400   inspector, side panels
--z-modal:     1000  dialogs, confirms
--z-toast:     1100  toasts (above modals)
--z-boot:      1200  full-screen boot/transition overlays
--z-devtools:  9000  reserved
```

- **Overlay lifecycle rules (from the HELIX boot bug):**
  1. A full-screen overlay MUST have a **guaranteed dismissal** independent of any
     animation frame or callback identity (wall-clock failsafe). If it can hang, it
     will, and it will silently block all input.
  2. While present, an overlay owns `pointer-events`. When leaving, drop
     `pointer-events` **before** the fade so clicks pass through during exit.
  3. Prefer *unmounting* over `opacity:0` — an invisible `pointer-events:auto`
     layer is an invisible wall.
  4. Never introduce a stacking value outside the scale. If you need "on top of
     everything," you need `--z-toast`/`--z-boot`, not `99999`.

## 6. Responsive / reflow

- Relative units + flex/grid + `gap`; avoid fixed pixel widths for containers.
- Content reflows; it never scrolls the page sideways. Wide items (tables, graphs,
  code) get their own `overflow-x:auto` container.
- Density modes are the app's "responsive" axis on desktop — test all three.
- Electron desktop: assume 1280×720 minimum working area; design the dense case,
  let it breathe up.

## 7. Overlap / collision discipline

- Watch for elements that overlap unintentionally (position:absolute without a
  positioned parent, negative margins, transformed layers).
- Give focus states room (ring needs 2–3px clearance).
- Sticky elements need a background (they'll show content bleeding under otherwise).

---

### Layout checklist
- [ ] spacing only from the scale, scaled by density
- [ ] everything aligned to a shared edge/grid/baseline
- [ ] hit targets ≥ 40px; body 45–75ch; type from the scale
- [ ] one accent + one emphasis; semantic colors separate
- [ ] z-index only from the named scale; overlays have a dismissal failsafe + drop pointer-events on exit
- [ ] no horizontal page scroll; wide content scrolls in its own box
