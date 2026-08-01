# 02 · UX, Interaction & Flow

How individual controls behave, and how screens connect. This is where "nothing
works / everything feels dead" is won or lost.

---

## 1. Every interactive element has a full state machine

Design all of these, not just idle:

`idle → hover → focus(-visible) → active/press → loading → success → error → disabled → empty`

- **Rule:** never ship an element with only `idle`. Minimum: hover + focus-visible
  + active + disabled. Async ones add loading + success + error.
- **Focus:** always a visible `:focus-visible` ring (keyboard + a11y). Never
  `outline: none` without a replacement.
- **Disabled:** looks unavailable *and* explains why on hover/title (Norman
  constraint > silent dead button).

## 2. Feedback latency budgets (perceived time)

| Elapsed | User feels | You must… |
|---|---|---|
| 0–100 ms | instant | just do it; no spinner (a spinner here reads as jank) |
| 100–300 ms | slight but connected | subtle state change (press, highlight) |
| 300 ms–1 s | waiting | show a determinate/indeterminate indicator |
| 1–10 s | task | progress + what's happening + **cancel/escape** |
| > 10 s | background it | move to async job, toast on completion, let them leave |

- **Rule:** the acknowledgement (button depresses, row highlights, toast queued)
  fires < 100 ms **even when** the network call takes seconds. Decouple feedback
  from result.
- HELIX example done right: Ask surface flips to "running", shows pipeline phases
  immediately, then swaps in the real answer.

## 3. Optimistic UI + Undo > confirm dialogs

- **Rule:** for reversible actions, update the UI immediately and reconcile with
  the server; on failure, roll back + toast. Don't block on the round-trip.
- **Rule:** prefer **Undo** (toast with "Undo", soft-delete window) over
  up-front confirm dialogs — except for **irreversible/destructive** actions
  (hard delete, publish, spend), which get an explicit, friction-matched confirm.
  - HELIX delete-project = irreversible + cascades → "type DELETE" confirm is
    correct. A tag toggle = reversible → just do it.

## 4. Empty, loading, and error are DISTINCT designed states — and honest

- **Never** show emptiness as a blank or as fake data. Three different messages:
  - **Not run yet** ("Contradiction check hasn't run — this is not the same as
    'no contradictions'. Run it.") — *honesty rule, already in HELIX EmptyBoard.*
  - **No results** ("No evidence matched — adjust filters or rephrase.")
  - **Error** (what failed + how to recover; never a raw stack).
- **Loading:** skeletons that match the final layout beat spinners (perceived
  faster, no layout shift). Spinner only for < ~1s indeterminate waits.
- **Rule:** estimates/derived numbers are **labeled** as such; degrade explicitly
  ("couldn't get a live source — won't guess") rather than fabricate.

## 5. Forms & inputs

- Inline, **on-blur** validation (not on every keystroke; not only on submit).
- Error copy: what's wrong + how to fix, next to the field. No "invalid input".
- `Enter` submits, `Esc` cancels, autofocus the first field, preserve input on
  error. (HELIX modal already does Enter/Esc.)
- Accept liberal input (Postel); coerce/trim; case-insensitive confirms.

## 6. Navigation & flow between screens — the heart of this pass

**Principles**
- **Preserve context across tabs.** Switching surfaces must keep the active
  project, scroll position where sensible, and any in-progress input. Losing work
  on a tab switch is the #1 flow killer.
- **Information scent.** Every nav item and link previews where it leads (counts,
  status dots, last-updated). The user should predict the destination.
- **Deep-linkable state.** Surface + project + selection should be reconstructable
  (URL/hash or persisted store) so refresh/return lands you where you were.
- **One back model.** `Esc`/back is predictable and reversible; never a dead end.
- **Continuity of the spine.** HELIX's Question→Evidence→Analysis→Decision→Artifact
  is the through-line: each surface shows where you are in it and offers the *next*
  step (goal-gradient). The "next action" card on Home is the pattern — extend it
  to every surface.
- **Cross-surface handoff.** Finishing Ask should offer "→ Evidence"; recording a
  Decision should offer "→ Build artifact". Flow = each end is the next beginning
  (Peak–End).

**Mechanics (see 05 for the motion)**
- Tab change: fast crossfade + slight directional slide (forward vs back), never a
  hard cut, never a slow wipe. Keep the shell (sidebar/topbar) static; only the
  surface transitions.
- Selection → detail: shared-element / expand-in-place where possible so the user
  keeps their spatial anchor (the inspector/drawer pattern).
- Keep a **persistent command layer** (⌘K) so any destination is 2 keys away —
  navigation should never *require* the mouse.

## 7. Feedback moments & delight (the peak)

- Micro-interactions confirm success (press ripple, checkmark, tick-flash on live
  data). Reserve big moments (confetti, shockwave, 3D reveal) for **genuine
  milestones** (new-best run, pipeline complete, decision committed) — never for
  routine actions, or they lose meaning (Von Restorff).

---

### Per-interaction checklist
- [ ] hover + focus-visible + active + disabled all designed
- [ ] < 100 ms acknowledgement, decoupled from result
- [ ] reversible → optimistic + undo; irreversible → matched confirm
- [ ] empty / loading / error are three distinct, honest states
- [ ] context preserved across tab switches; state deep-linkable
- [ ] the "next step" is always offered (spine continuity)
- [ ] success has a designed moment; escape always available
