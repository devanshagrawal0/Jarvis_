# Stage W4 — The Presentation Router — build plan

Master plan §3. One decision per turn: **`{form, container, confidence, why}`** — talk, open a
pre-made widget, draw a generative surface, or take over the screen; and panel or full-screen.

Its acceptance test, from the master plan:
> "how are you" → text only · "what's on my calendar" → widget · "latest news on X, in detail" →
> generative dossier (takeover)

---

## What W4 must NOT touch — the seam that already burned us once

`settings.semanticRouting` is a model router that exists and is **switched off**, because turning it
on regressed general knowledge: *"who wrote hamlet"* went from "William Shakespeare wrote Hamlet" to
"I can't confirm that current information".

The cause is in `agent-runtime.js`: the model's classification is merged with the deterministic
baseline by OR-ing flags upward (`if (baseline.fresh) guarded.fresh = true;` and so on). Flags can
only ever be **added**. When the model over-classified the turn as `fresh`, nothing could pull it
back down, so the turn went to grounding and the answer got worse.

**Therefore W4's router decides FORM ONLY.** It must never influence whether facts are fetched,
which data tools run, or whether grounding happens. Form is what the owner *sees*; fetch is what is
*true*. Keeping them apart is what makes this wave safe to ship, and every slice below is written so
a wrong decision can only produce the wrong-looking answer, never a wrong answer.

Corollary, from the cascade literature (LLM confidence is "typically miscalibrated and sensitive to
prompt wording"; "every routing path needs a fallback"): the router carries an explicit **abstain**,
and abstain means *behave exactly as Jarvis does today*. Abstain is built in W4a, not bolted on
later.

---

## How this is sliced, and why

Slices are **vertical** — each one cuts from the router through the tool offer to something the
owner can see, and each ships observable value on its own (INVEST; horizontal "build the classifier
this week, wire it next week" is the documented anti-pattern that produces two halves of nothing).

W4a is a **walking skeleton**: the thinnest end-to-end path that proves the seam, deliberately
changing no behaviour. After that, each slice widens *what the decision is allowed to influence*, one
direction at a time, safest first. That ordering is the reason nothing already built breaks: at every
point the untouched paths still run exactly as they do today, and abstain is always the floor.

---

## The slices

### W4a — The decision exists, is visible, and changes nothing
**Build:** one router call producing `{form, container, confidence, why}` alongside the existing
route. Recorded on the turn and rendered in the **Technical trace**. An `abstain` value from day one.
Nothing consumes it yet.
**Owner-visible value:** he can see what Jarvis *would* have chosen, and why, before trusting it.
**Test:** ask three different things — a greeting, a chart request, a calendar request — open
Technical trace on each and read the form, the container and the one-line reason.
**Must not regress:** every one of those three turns behaves exactly as it does today. This slice is
provably safe because nothing reads the decision.
**Why first:** it is the only slice that can be wrong without costing anything, and it produces the
measurement that tells us whether the later slices are worth shipping.

**Decided by Dev 2026-08-23: the router runs on EVERY turn.** Not gated to turns that already
touch tools — a social turn is exactly the case W4b needs a decision for, and gating it there would
leave the commonest wrong-panel unfixed. The cost (one extra fast call per turn, on top of the tool
embedding) is accepted for now; **optimisation is deferred to the end of the whole panel build**, not
traded away at the start.

### W4b — Text-only wins: a surface that was never going to help is not offered
**Build:** the first and safest application — when the decision is `text` with high confidence, the
surface tools are not offered for that turn. Removal only; nothing new is forced.
**Owner-visible value:** "how are you", "thanks", "what's 2+2" stop producing panels.
**Test:** four social/trivial turns → plain text, no panel. Control in the same run: "put my day on
the panel" still draws the calendar.
**Must not regress:** any turn where the decision is not a confident `text` is untouched. A wrong
decision here can only *withhold a panel*, never withhold an answer.

### W4c — Show wins: a request to SEE reaches the Stage
**Build:** the opposite direction — when the decision is `surface`, the Stage tools are offered and
the turn is told to draw rather than narrate.
**Owner-visible value:** this fixes the failure W3 measured and handed over. "what's on my calendar
today" — the master plan's own W3 acceptance sentence — currently answers in **chat**; across six
phrasings the calendar reached the panel **4/6**, and every success needed an explicit "on the
panel". The deleted keyword gate used to fake this decision.
**Test:** the plan's own sentence draws the calendar, plus six fresh phrasings with no show-word in
them, measured as a count.
**Must not regress:** the 4/6 that already work stay working; text-only turns from W4b stay text.

### W4d — The right target: pre-made widget vs generative surface
**Build:** when the decision is `widget`, the widget opens; when it is `surface`, blocks are drawn.
Today the model picks whichever tool retrieval floated up, which is why saying "**panel**" lost to
the word "graph" and opened the graph widget instead of the Stage.
**Owner-visible value:** asking for a thing gets that thing.
**Test:** "open the calendar" → the calendar widget · "how did amd do in august" → a drawn chart
surface · "open panel with graph" → the Stage, not the graph widget.
**Must not regress:** widget open/move/close still work; the chart and calendar surfaces from W3
still render.

### W4e — The right size: panel by default, takeover only when it earns it
**Build:** the `container` half of the decision. Panel is the default; full-screen only when the
plan's §3 rule 10 is met — interactivity needs the room, or it is a watchable agent run.
**Owner-visible value:** a dossier gets the screen; a single number never does.
**Test:** "latest news on X, in detail" → takeover dossier · a price → one line · a chart → panel.
**Must not regress:** the calendar's own large surface still opens at its own size; W3's panel
auto-fit still fits its content.

### W4f — "Why this form?" and the correction that teaches it
**Build:** the reason becomes a chip the owner can tap on any surface, showing the router's decision
in his own words; disagreeing with it is recorded as a preference for that kind of request.
**Owner-visible value:** master plan §6 crown jewel #10 — the surface that tells you why, and learns
from the correction. It also makes every later routing complaint diagnosable instead of arguable.
**Test:** draw a surface, tap "why this?", read the reason; say it should have been text; ask the
same kind of thing again and see the decision change.
**Must not regress:** the preference may only shift FORM, never fetch — the same seam as the top of
this document.

---

## Order, and what each slice depends on

W4a is independent. W4b and W4c both need only W4a, and are opposite directions of the same lever —
W4b ships first because withholding a panel is recoverable and withholding an answer is not. W4d
refines the target once the decision is trusted; W4e refines the size. W4f needs a decision worth
explaining, so it lands last.

**No slice is "write a function, then write another function, then test."** Every one of the six is a
change the owner can see in the real UI on the turn it ships.

---

## The standing regression set (runs on every slice, not once at the end)

- **"who wrote hamlet"** → "William Shakespeare wrote Hamlet." This is the exact sentence the last
  model router broke. It is the canary for the fetch/form seam.
- A greeting stays text. A chart request still draws. The calendar still opens with real events.
- Widget open / move / close still work.

## What is deliberately NOT in W4

Morph and shared-element motion (W5), maps (W6), the self-critique pass (W7), the code sandbox and
interactive simulators (W8), the live cockpit (W9). §3's decision list mentions sims, cockpits and
tradeoff tables as *outcomes* the router can select; W4 builds the **selection**, and each of those
surfaces arrives in its own wave. Until then the router simply does not choose a form that does not
exist yet.

## Research this plan is built on

- Master plan §3 (the router), §8 (a widget must earn its pixels), §6 #10 (why-chip + correction).
- Generative Interfaces for LMs (arXiv 2508.19227) — generative interfaces beat chat by up to 72%
  preference **when the form matches the task**, which is the whole premise: form selection is the
  value, not surfaces for their own sake.
- LLM routing / cascade practice — every routing path needs a fallback; LLM confidence is
  miscalibrated and prompt-sensitive, so thresholds tuned on one workload fail on another. Hence
  abstain-to-today's-behaviour rather than a tuned threshold.
- Selective prediction / abstention (risk–coverage trade-off, AUACC) — an explicit reject option is
  the studied way to buy accuracy with coverage, which is what W4a's abstain is.
- Story splitting / vertical slicing (INVEST, walking skeleton, the nine patterns) — why W4a exists
  and why no slice is a layer.


---

## STATUS — W4a + W4b shipped 2026-08-23, verified in the running UI

**W4a — the decision exists, is visible.** `decidePresentation()` in `agent-runtime.js` returns
`{why, form, container, confidence, source}` on EVERY turn, started early and awaited at the return
so it overlaps tool selection rather than adding wall-clock. It is returned as its OWN object and is
never merged into `route`, so it structurally cannot touch the fetch seam. Rendered first in the
Technical trace (`JarvisUI.tsx`), read live in the UI.

**W4b — text-only wins.** When `form === "text"` the three surface-producing tools are withheld for
that turn. Removal only; nothing is ever forced on.

### Two design changes made against this document, with the evidence

1. **No confidence threshold. `unsure` is a discrete choice instead.** The plan said "text with high
   confidence". Verbalized confidence is systematically overconfident — models cluster in the
   0.7-1.0 band because the number is a generated token and RLHF rewards the confident-sounding one
   — and arXiv 2509.25532 finds a discrete reject option calibrates better precisely because it
   "reduces the pressure to express false precision".
   **Confirmed on this machine:** across the first measured spread the router returned confidence
   1.0, 1.0, 1.0, 1.0, 0.95, 1.0. A `> 0.8` gate would have fired on every turn, including the ones
   that must not be gated. `confidence` is still returned and displayed, for measurement only.
2. **`why` is emitted before the label.** `propertyOrdering: ["why","form","container","confidence"]`
   — a format instruction suppresses the reasoning a model would otherwise do (the "format tax"),
   and this codebase already banks that trick in `stage_render`'s `plan` field (arXiv 2601.07525,
   77.9% vs 48.9%).

### Measured

| check | result |
|---|---|
| decision present on every turn | yes — social, scalar, lookup, trend, schedule |
| social / scalar / lookup drew a surface | **0** (want 0) |
| trend + schedule still drew | yes — `apex_price_history` + `stage_render` |
| **canary: "who wrote hamlet"** | "William Shakespeare wrote *Hamlet*, Dev." |
| second canary: "who painted the mona lisa" | text, no surface |
| W4b violations (form=text yet a surface ran) | **0/12** across two rounds of fresh prompts |

### One list was added, and it is named rather than hidden
`SURFACE_TOOLS = {stage_render, ui_open_widget, ui_open_room}` in server.js — which tools put
something on screen. This is a property of the TOOLS, not a guess about the owner's wording; no
phrase list decides anything, the router does. Its proper home is a `surface` effect in
`tool-effects.js`; declaring effects there flips `isDeclared` and moves those tools onto a different
confirmation rule, which this batch deliberately did not risk. Worth revisiting in a later slice.

### Not exercised
The abstain path (`unsure` / router failure → today's behaviour) is code-present and logs on failure,
but was not forced in this run: making it fire means breaking the API key or the model name on a
live system. Its behavioural twin WAS proven — every non-`text` decision left the turn untouched.

### Next
W4c — show wins. The remaining gap it inherits, measured during this run: "how did tesla close each
day the past fortnight" and "chuck todays meetings up where i can look" both decided `surface` and
still answered in text, because W4b only withholds and nothing yet forces the Stage.


---

## STATUS — W4c + W4d shipped 2026-08-23, verified in the running system

**W4c — show wins.** When the decision is `surface`, `stage_render` is ADDED if retrieval missed it,
`ui_open_widget` is withheld, and the turn is told to draw. This is the one place the router adds a
tool rather than removing one — a decision to draw is worthless if the renderer was never offered.

**W4d — the right target.** The router is now handed the widget catalogue (`WIDGET_LIST_TEXT`), so
`widget` is a knowing choice; `widget` offers `ui_open_widget` and withholds `stage_render`.

### The pre-route is deleted, and that was the real W4d fix
`detectWidgetOpen` — a 90-character cap, a verb list and a widget-word list — opened a HUD widget and
RETURNED before the brain and before the router, under its own comment reading "Deterministic, no
model call". Measured: **"open panel with graph" produced no routing decision at all.** The word
`panel` is what did it: `panel` was in the widget-word list and `graph` is a widget name, so asking
for the PANEL is precisely what guaranteed the owner did not get it. Gate removed, function removed.

### Two rounds of iteration, both measured, neither a prompt patch
1. First run: 5/8. The router had been told the catalogue and started preferring widgets — it read
   "open **panel** with graph" as "open the knowledge graph panel", and its own stated reason for
   "chuck todays meetings up where i can look" was *"see their schedule for today ON THE PANEL"*
   while it still chose `widget`.
2. Fix: an explicit **tie-break** in the rubric — if both could work choose SURFACE, and the words
   "panel"/"stage" always mean the Stage even when another word matches a widget name. → **8/8.**
3. The draw instruction was also generalised twice: first for question-shaped asks ("how did X do"
   is a request to SEE), then with a behavioural test — *if you are about to write the figures out
   in your reply, that is the moment to draw them instead*.

### Measured — the 15 hard prompts (5 daily / 5 occasional / 5 rare 4+ step)

**13/15**, and one of the two "failures" was the test being wrong: R4 ("if my afternoon is free say
free, otherwise draw it") drew, and the owner's afternoon is NOT free, so drawing was the correct
branch. Effectively **14/15**.

Passing includes the genuinely nasty ones: a negation naming a widget ("i dont want the today
widget, draw me the actual meetings" → drew), an anti-chart instruction ("but not as a chart" →
text), asking ABOUT a widget without opening it ("whats the point of the graph widget" → text), and
three 4+ step chains (longest free gap → timeline; compare two tickers and show the working; rank
three tickers and lay it out).

### The residual, stated rather than buried
When the router says `surface`, the turn actually draws **7/8** in two independent rounds — so about
**one in ten surface decisions still narrates**. After the second instruction fix the repeatable
failure narrowed to a single shape: **"whats my day look like, and dont use a widget for it"** — a
negation ABOUT widgets appears to suppress the drawing along with the widget. A third fix aimed at
that one sentence would be building around a prompt, which is banned, so it is recorded as a known
limit for W4e/W4f to revisit.

### Regression checks, all held
"open the calendar" and "open the today widget" still open their widgets; W3's chart and calendar
surfaces still render; W4b's text turns stay text; the canary ("who wrote pride and prejudice")
answers correctly.


---

## STATUS — W4e + W4f shipped 2026-08-23. WAVE 4 COMPLETE.

**W4e — the right size.** The `container` half of the decision is now consumed. It is stamped onto
the `stage-render` action by the SERVER (`stampPresentation` in server.js), never passed to
`stage_render` as a parameter: how big the result should be is the router's answer, and handing it
to the model as an argument would invite it to argue with a decision already made. `fullscreen`
opens at the same geometry the Expand button uses, so there is one definition of "big" and the owner
can still drag or resize it. **Panel is the floor** — a missing or malformed decision lands as a
panel, so a wrong decision can only ever produce a surface that is too small, never one that takes
his screen uninvited.

**W4f — why this form, and the correction that teaches it.** The router's `why` and the request it
decided about ride along with the surface. A `why this?` chip opens them, with one action: *this
should have been text*. That posts to `/api/presentation/feedback`, which stores the pair in
`runtime/presentation-preferences.json` (last 12). Those pairs are read back to the router as
examples. **Nothing classifies anything** — the model judges whether a new request is "like" a
corrected one, because it is the only participant here that can, and a table that tried would be
the keyword list LAW 0 bans.

### Two regressions were introduced during this batch and caught by its own tests

1. **A latency optimisation made the decision unreachable exactly where it mattered.** The
   presentation await had been made conditional on a surface tool already being on the menu — but
   W4c's whole job is to ADD `stage_render` when the decision is `surface`, so the turns retrieval
   missed were precisely the turns that needed a decision. Measured: *"give me a proper deep rundown
   on the fed rate decision"* — W4e's own acceptance test — returned `unsure`, reason "no surface
   tool on this turn", and drew nothing. The await is now unconditional and commented so it is not
   re-optimised away.
2. **The new surface-honesty guard invented a falsehood.** `surfaceRouting()` did not know that
   `stage_render` draws on the owner's screen, so a correctly drawn panel got *"Correction, sir:
   none of that happened on your screen"* appended to a true sentence. JARVIS's own surfaces now
   count as his screen.

### One iteration on the correction, both halves measured

- **Position, not wording.** Placed inside the rubric the corrections did nothing: after correcting
  *"plot me intel's closes"*, an identically-shaped Qualcomm request still chose `surface`, with a
  reason that never mentioned the correction. Moved to LAST — after the owner's request — it applied.
- **Scope.** It then over-generalised: one correction about stock closes flipped *"chuck todays
  meetings up"* from `surface` to `widget`. An explicit scope rule ("applies only when the new
  request is the same kind of thing; otherwise ignore it entirely") restored it while keeping the
  stock behaviour corrected.

### Measured — W4e

| prompt (all new wording) | decision | rendered |
|---|---|---|
| give me a proper deep rundown on the fed rate decision, all the detail | surface / **fullscreen** | fullscreen, 7 blocks |
| whats nvidia trading at | text | none |
| chart me amd over the past fortnight | surface / panel | panel, 4 blocks |
| chuck todays meetings up where i can look | surface / panel | panel, 2 blocks |
| break down everything going on with the tiktok ban case, i want the full picture | surface / **fullscreen** | fullscreen |
| how many days till september | text | none |
| lay out my week next to each other | surface / panel | panel, 2 blocks |
| i want a proper long writeup comparing the rtx 5090 and the 4090 | surface / **fullscreen** | fullscreen |
| whats the time in tokyo right now | text | none |
| put the last 5 days of tesla next to nvidia so i can compare | surface / panel | panel, 7 blocks |
| walk me through the entire history of the arsenal invincibles season in proper depth | surface / **fullscreen** | fullscreen |
| one number: how much did bitcoin move today | text | none |
| throw my afternoon on the panel | surface / panel | panel, 3 blocks |

**13/13 on the container decision.**

### Measured — W4f

| check | result |
|---|---|
| `why` + `request` present on every rendered surface | yes, 13/13 |
| chip renders in the real UI | screenshot: `EDIT · EXPAND · WHY THIS? · PIN`, box reads "The user explicitly requested to see their afternoon schedule on the panel", button reads "THIS SHOULD HAVE BEEN TEXT" |
| correction is stored | yes — `{request, chose:"surface", wanted:"text", at}` written to disk |
| correction changes a DIFFERENTLY WORDED request of the same kind | yes — "show me broadcom's run over the last two weeks" → **text**, reason cites the correction |
| correction does NOT leak to a different kind of request | yes — "chuck todays meetings up" stayed `surface` |
| fetch seam intact | "who wrote pride and prejudice" → "Jane Austen."; "who painted the night watch" → text |
| regression: widget still opens | "open the calendar" → widget |

### Residuals, stated rather than buried

- **A fullscreen surface often renders ONE block.** tiktok, rtx and arsenal each drew a single block
  at takeover size. The container decision is right; the CONTENT is not sectioned to match, so a
  full screen carries one paragraph. This is a `stage_render` content problem, not a W4e one, and it
  is the obvious first item for W5.
- **The why box overlays the last line of content** instead of the panel growing to fit it. Visible
  in the verification screenshot: "Pick up milk" is clipped.
- **The one-in-ten narration from W4c/W4d is unretested here** — this batch did not re-run that
  measurement.
- The abstain path is still not force-tested; breaking the key on a live system remains the only way.

### Test hygiene
`runtime/presentation-preferences.json` (the test correction) was deleted after the run, and 76 test
turns were purged from `conversation.json`. Neither the owner's history nor his router carries
anything from this batch.
