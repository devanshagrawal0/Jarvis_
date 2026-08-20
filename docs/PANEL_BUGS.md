# The Panel / Stage — every bug, and the reason for each

Written 2026-08-20 after a session in which **not one panel request reached the panel system**.
Everything below was read in source or reproduced by running the real code — nothing is inferred.

The owner's session, verbatim, and what actually happened:

| owner said | what he got |
|---|---|
| "pull up the latest top equities prices for me in the panel" | a markdown table **in chat** |
| "in the panel come on not in chat" | the **Kalshi** widget opened |
| "in this panel add the latest stock prices for me" | "Done. I have displayed the latest index and equity prices on the Stage panel" — **nothing rendered** |

---

## Root cause A — three keyword gates stand in front of the panel

The panel has a real LLM router (`server/stage-router.js`) whose own header says it decides
"with the model's own judgment … **NOT keyword regex**". That router is never consulted, because
three hand-written regexes sit in front of it and each one can veto.

| # | gate | file | what it gates |
|---|---|---|---|
| A1 | `detectPanelRequest` | `server/stage-pipeline.js:213` | whether the Stage pipeline runs at all |
| A2 | stage-tool exposure | `server/tool-gateway.js:251` | whether the brain is even *offered* `stage_render` |
| A3 | `WIDGET_ALIASES` / `resolveWidgetTarget` | `server/capability-engine.js:50,71` | which widget a UI command targets |

A1 and A2 are both `PANEL_NOUN && PANEL_VERB`. Their verb lists contain `bring up` and `pop up`
but **not `pull up`**, and **not `add`**. Measured against the owner's real words:

```
PIPELINE | TOOL-OFFERED | prompt
   NO    |      NO      | yes i will pull up the latest top equities prices for me in the panel
   NO    |      NO      | in the panel come on not in chat
   NO    |      NO      | in this panel add the latest stock prices for me
   NO    |     yes      | give latest top equity prices on the panel
   NO    |      NO      | throw my portfolio onto the big screen
   NO    |      NO      | i want to see nvidia and apple side by side
   NO    |      NO      | stick the fed numbers up where i can see them
```

**This is the whole session explained.** Every request fell through to the plain chat brain, which
had no render tool available, so it answered in prose — and then claimed it had rendered.

The gates cannot be repaired by extending the word lists. Any list fixes the sentences it was
written against and fails the next ones. **The fix is to delete them and let the router decide.**

---

## Root cause B — the panel is never cleared when the pipeline gives up

`server.js:11471-11489`:

```js
skeleton("Reading your request…")          // paints an EMPTY panel: blocks: []
stage = await getStagePipeline().run(...)  // 2-4 sequential Gemini calls
catch → stage = null
if (stage && stage.handled) { render; return }
// falls through to the brain — NO event is ever sent to clear the skeleton
```

The frontend confirms there is no rescue: `src/StageSurface.tsx:229-240` stores
`{ title, loading, key }` and has **no timeout and no clear path**. When the pipeline abstains or
throws, the panel sits on "Building your panel" with zero blocks **forever**. This is the owner's
"it never finished / took forever".

The same `onPhase` callback re-sends that empty skeleton at every phase, which is the panel
visibly re-painting itself mid-request.

---

## Root cause C — the panel's size is decided once and frozen

`src/StageSurface.tsx:236`:

```js
setRect((prev) => prev ?? defaultRect(isCalendar(blocks)));
```

`prev ??` means: after the first surface ever shown, the rect never changes again. A calendar
surface and a three-stat surface get the same box. Resizing the window reflows nothing. This is
"the length doesn't adjust to content — it does nothing".

---

## Root cause D — the calendar block scales like an image, not a layout

`src/StageCalendar.tsx:12` fixes the design canvas at `BASE_W=1180, BASE_H=740`; line 166 applies
`Math.min(W/BASE_W, H/BASE_H)` as a CSS transform. A transform can only shrink or grow the whole
canvas uniformly — it can never reflow. Mounted in the strip slot
(`src/globe-room/WidgetStrip.tsx:1706`, hardcoded `320×440`) the factor is **0.27**, so the whole
widget renders at roughly a quarter size inside its own box.

---

## Root cause E — every open widget reloads itself every 30 seconds

`src/globe-room/WidgetStrip.tsx:2209` — a `setInterval(…, 30_000)` that calls `refresh(id)` on
every non-minimized widget. That is the panel "auto-reloading while I'm looking at it".

---

## Root cause F — the "Done" safeguard has the panel tools carved out of it

`server.js:2692`:

```js
definitions.filter(i => i.risk === "observe" && !/^(ui_|stage_)/.test(i.name))
```

`server/tool-result-honesty.js` exists specifically to stop JARVIS claiming "Done" for actions it
did not perform. That filter **exempts every `ui_` and `stage_` tool from the observe-only set**,
so any UI tool that returns successfully counts as `effective` and produces
**"Done. Here's what I verified:"** regardless of whether a pixel changed on screen.

---

## Root cause G — there is no markets/equities widget, and "calendar" points at the wrong one

`server/capability-engine.js:50-58` is the complete list of openable widgets.

- There is **no** stocks / equities / markets widget. `kalshi` is the only market-shaped entry,
  which is why "stock prices in the panel" opened Kalshi. Nothing malfunctioned — the requested
  thing does not exist.
- Line 51 maps `calendar: "today"`. The word "calendar" opens the **today** widget, not the
  calendar widget.

`server/stage-router.js:29-39` carries a **second, different** widget menu (9 entries) that also
has no markets widget and must be kept in sync by hand.

---

## Root cause H — the panel can only ever draw stat cards

`RENDER_SCHEMA` (`server/stage-pipeline.js:21-43`) allows exactly: `title`, `heading`,
`stats[{label,value,delta}]`, `bullets[]`, `note`. `blocksFrom()` builds the block list from only
those. So every generative surface is a heading, a row of stat cards, a bullet list and one line
of text — no table, no chart, no timeline, no calendar. The block registry
(`src/StageRegistry.tsx`) supports more types than the pipeline can ever emit.

---

## Root cause I — the pipeline is slow by construction

One LIVE panel is a serial chain of Gemini calls:

1. `router.route()` — classification
2. `ground()` — **grounded Google Search** call (the slow one; also billed per request)
3. `genBlocks()` — structured render
4. `genBlocks()` again — repair retry when the faithfulness audit fails

Four sequential round-trips, nothing parallel, no cache, no timeout. The comment in
`stage-pipeline.js` claims "~20s"; with no timeout and no clear-on-failure (root cause B) the
observed behaviour is "forever".

---

## Secondary defects found while tracing

| # | defect | location |
|---|---|---|
| J1 | Three separate listeners bound to `jarvis:open-widget` | `WidgetStrip.tsx:1645`, `WidgetStrip.tsx:2195`, `JarvisUI.tsx:492` |
| J2 | Internal tool traces are assigned straight to the user-facing answer (`- codebase search: … details available`) | `server.js:2766`, assigned at 9 call sites incl. `4917`, `4922` |
| J3 | `maxToolTurns = 6`; 4 searches + a contact lookup + a send exhausts it, leaving no turn to write the reply → empty answer | `server.js:4215` |
| J4 | `conversation.json` file mtime 15:22 but newest turn 09:52 — recent turns are not being persisted | `runtime/conversation.json` |

---

## The fix, in one line

**Delete the gates; let the router decide.** A1, A2 and the parts of A3 that override the model are
rules substituting for judgment, and each one is the direct cause of a bug above. B, C, E and F are
missing behaviour, not missing rules — they are fixed by adding the clear path, unfreezing the
rect, removing the blind interval, and closing the honesty carve-out. D is a rewrite of one
component from transform-scaling to real layout.

---

# Part 2 — what the investigation actually found (corrections included)

## Correction to Root cause A

The claim above that `stage_render` "was not offered to the brain" is **half wrong**, and the real
version is worse. Measured against the live selector: `stage_show` (a plain prose note) was offered
on panel requests, and `stage_render` (the actual typed-block panel) **never was, at any tool limit**:

```
--- limit 5 / 8 / 12 ---
stage_render ABSENT | in this panel add the latest stock prices for me
stage_render ABSENT | pull up the latest top equities prices for me in the panel
```

The reason is not the keyword gate — it is the two tools' own descriptions. `stage_show` was written
in the owner's vocabulary ("open a panel / surface / stage and show, write, or put something on it");
`stage_render` was written in implementation vocabulary ("typed blocks", "delta", "consecutive stat
blocks lay out side by side"). Retrieval matched the text it was given and did the right thing with
the wrong inputs. So the brain's only Stage option was a prose note it could not put numbers in.

**Fixed by merging them into one tool.** `stage_show` still executes for older callers but is no
longer declared, so there is no wrong choice left to make; a plain note is one 'text' block.
Measured on prompts whose wording appears nowhere in this repo: **6/12 → 11/12** (legacy path),
**12/12** (semantic path).

## The real reason panels "took forever" — a runaway reminder table

Not the Stage pipeline. `runtime/atlas.sqlite` had grown to **349 MB / 1,048,633 reminder rows**,
of which **524,280 were copies of one reminder titled "Stretch"** — 524,288 is 2^19, i.e. one
doubling per fire.

Two independent code paths were both re-arming every recurring reminder after it fired:

| path | source tag |
|---|---|
| `server/atlas/atlas-scheduler.js:42` | `{kind:"recurrence"}` |
| `server.js:13852` (the `deliver` callback) | `{kind:"system", ref:"recurrence"}` |

Every fire created two next occurrences. `"Check RecurProof email"` was caught at generation 3 —
8 identical rows at one fire time — confirming the mechanism on a second reminder.

`pendingReminders()` is `SELECT *`, and the Today endpoint called it **twice per request**:

```
BEFORE (backup)  rows= 524096   pendingReminders() = 3954 ms
AFTER  (live)    rows=     13   pendingReminders() =    5 ms
```

≈8 seconds of blocking work on every Today/calendar load. All 524,292 were queued to fire together
at 11:27 that day, each broadcasting a push to every paired device and arming another generation.

**Fixed:** the duplicate re-arm removed (the scheduler's own header already said recurrence must not
be expanded there); a same-title-same-fire_at occurrence is now a no-op in `createReminder`, so a
third caller cannot repeat it. Mutation-tested — replaying 19 generations of the exact old bug
yields 1 row instead of 524,288, while a genuine next slot and an unrelated reminder still create.
The existing rows were marked **cancelled, not deleted**, and `atlas.sqlite.backup-before-reminder-cleanup`
holds the original.

## The 22-second budget counted tool time against the model

`web_research` (Gemini grounded search) reliably takes ~24s. The response budget was a fixed
wall-clock deadline of 22s covering tool execution too, so any request needing live data blew the
budget *before* the model got a turn to use what came back. The turn aborted and the recovery path
printed the raw tool trace as the reply — which is exactly the `- codebase search: … details
available` text the owner was shown. **Fixed:** the budget now credits tool wait time back, so it
measures the model.

## Still broken — not fixed, do not assume otherwise

1. **`ui_*` regex block floods the tool list.** "put my open tasks up on the panel" pulls in seven
   `ui_` tools via `tool-gateway.js:290`. Those go into `required`, which is never truncated, so
   `stage_render` is crowded out. Jarvis then says "I have opened the Today widget" with no panel.
2. **A pronoun still zeroes the tool list.** `agent-runtime.js` classifies any turn containing
   "it/them/that" as `conversation-follow-up`, which triggers `isPureConversation` → **no tools at
   all**. "stick apple and nvidia side by side where i can see them" fails on the word "them".
3. **The model-based router cannot be turned on yet.** `settings.semanticRouting` has never been
   enabled. Turning it on fixes (2) but regresses general knowledge: "who wrote hamlet" went from
   "William Shakespeare wrote Hamlet" to "I can't confirm that current information" because the
   router over-classifies as fresh-information. Reverted.
4. **Neither retriever can tell chat from work unaided.** Measured with `isPureConversation`
   bypassed: semantic gets all four panel cases right but hands 8 tools to "hi" and "who wrote
   hamlet". The keyword classifier is load-bearing and cannot simply be deleted.
5. **Jarvis still claims actions it did not take** in prose, without calling a tool. The honesty
   gate only inspects tool results, so free-text claims bypass it entirely.
