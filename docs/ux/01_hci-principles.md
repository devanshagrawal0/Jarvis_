# 01 · HCI Principles — the laws and when they bind

Each law below: the principle, the number that operationalizes it, and the
**HELIX rule** that turns it into something you can enforce in a PR.

---

## Fitts's Law — time to hit a target ∝ distance / size
Big, near targets are fast; small, far ones are slow and error-prone. Screen
**edges and corners are effectively infinite size** (the pointer stops there).

- **Rule:** primary click targets ≥ **40×40 px** hit area (visual can be smaller
  with transparent padding). Destructive/rare targets get *more* separation, not
  less, from frequent ones.
- **Rule:** put high-frequency global actions (command palette, exit, primary CTA)
  at edges/corners or make them keyboard-first.
- **Rule:** on rows/cards, make the **whole region** the target, not a 12px icon;
  add a hover affordance so the target is legible.
- Anti-pattern we shipped: a delete affordance only reachable on a tiny glyph with
  no hover state. Give it padding + hover (see `hxv-prow` delete button).

## Hick's Law — decision time ∝ log₂(options)
More visible choices = slower decisions and higher abandon.

- **Rule:** a surface shows **one primary action**; secondary actions are demoted
  (menu, drawer, `…`). Never present 6 equal-weight buttons.
- **Rule:** progressive disclosure — reveal advanced options on intent, not by
  default. Sensible defaults beat exhaustive controls.
- **Rule:** categorize long lists (facets, groups) so the user chooses a group
  first, then an item (see Projects status/domain facets).

## Miller's Law — working memory ≈ 7 ± 2 chunks
People hold few items at once; chunk to reduce load.

- **Rule:** nav groups ≤ ~7 items; beyond that, section with dividers/headers
  (HELIX sidebar already separates primary vs pipeline nav).
- **Rule:** group related fields/metrics; use whitespace + `common region` to form
  chunks (03 Gestalt).

## Jakob's Law — users expect your app to work like the others they know
Novelty in *mechanics* costs more than it earns; spend novelty on *identity*.

- **Rule:** ⌘K palette, `Esc` closes, `?` help, breadcrumb/back, `/` focuses
  search — behave conventionally. Be inventive in visuals/motion, conventional in
  controls.

## Tesler's Law — conservation of complexity
Irreducible complexity doesn't vanish; someone absorbs it — user or system.

- **Rule:** the *system* pays. Auto-derive what you can (default project name,
  smart intent detection, inferred strand) rather than making the user specify it.

## Doherty Threshold — keep system response < 400 ms
Below ~400 ms, humans stay in flow and *do more*; above, attention drifts.

- **Rule:** any user action must show a state change < **100 ms**; the full result
  should land < **400 ms** or stream/skeleton toward it. (Enforced in 04.)

## Peak–End Rule — people judge an experience by its peak and its end
Not the average. Design a deliberate peak and a clean ending.

- **Rule:** every flow has a **designed success moment** (the peak: a satisfying
  Live-Run reveal, a confetti on new-best, a crisp "Answer" render) and a **clean
  end** (result persists, next action offered, no dead-end).

## Serial-Position Effect — first and last items are remembered best
- **Rule:** put the most important nav/list items **first and last**; bury the
  rarely-used in the middle.

## Goal-Gradient + Zeigarnik — motivation rises near the goal; open loops nag
- **Rule:** show real progress (pipeline phases, spine stages, % with meaning).
  Never fake progress, but *do* show it — a determinate bar beats a spinner when
  you can estimate. Surface unfinished tasks (draft, unreviewed) as gentle nudges.

## Gestalt principles — how the eye groups (detail in 03)
Proximity, similarity, common region, closure, continuity, figure/ground. Layout
communicates structure *before* anyone reads a word.

- **Rule:** if two things are related, make them near / alike / boxed together.
  If unrelated, separate them. Don't rely on labels to do grouping's job.

## Norman's principles — affordance, signifier, feedback, mapping, constraint, model
- **Affordance/Signifier:** it looks clickable ⇢ it is; it is ⇢ it looks it.
- **Feedback:** every action acknowledged (02).
- **Mapping:** control layout mirrors effect (spatial, natural).
- **Constraints:** make illegal states unreachable (disable, not error).
- **Conceptual model:** the UI's story matches the user's mental model (HELIX =
  Question→Evidence→Analysis→Decision→Artifact spine; keep it visible & truthful).

## Aesthetic–Usability Effect — beautiful is *perceived* as more usable
Polish buys goodwill and forgiveness — but never *substitutes* for real usability
(it can also mask problems in testing). Earn it; don't hide behind it.

## Von Restorff (isolation) — the different one is remembered
- **Rule:** exactly **one** emphasis per view (the primary CTA, the key metric).
  If everything is emphasized, nothing is (02/03 accent discipline).

## Postel's Law — be liberal in what you accept
- **Rule:** accept messy input (trim, coerce, case-insensitive "DELETE" confirm,
  paste-friendly fields); render strict, clean output.

---

### Quick audit checklist (per screen)
- [ ] One primary action, clearly the loudest thing (Von Restorff / Hick)
- [ ] All targets ≥ 40px hit area, frequent ones near/at edges (Fitts)
- [ ] ≤ 7 ungrouped items anywhere (Miller)
- [ ] Conventional shortcuts & patterns (Jakob)
- [ ] Response < 100 ms, result < 400 ms or streamed (Doherty)
- [ ] Designed peak + clean end (Peak–End)
- [ ] Grouping done by layout, not just labels (Gestalt)
- [ ] Illegal states disabled, not error-ed (Norman constraints)
