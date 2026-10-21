# Master fix plan — every open issue, exact change, exact proof

Written 2026-08-21. Supersedes the ordering in `OPEN_ISSUES_PLAN.md`; that doc's root causes are
kept only where they survived checking, and the ones that did not are listed as REFUTED below.

Sources for this plan: two research passes (one web/state-of-the-art, one code forensics) whose
transcripts were recovered after the runs were interrupted, plus measurements re-run and verified
independently afterwards. Every number in this document was produced by running something, not by
reasoning about it.

---

## RULES — re-read these before every step. No exceptions.

1. **One step at a time.** Do the step. Show Dev the real result. Stop. Wait. Then the next step.
   Never do step N+1 in the same message as step N.
2. **The proof is what Dev can see.** A rendered panel, a screenshot, an answer in the real command
   bar. An HTTP 200, a passing unit test, a harness ranking, and JARVIS's own reply text are NOT
   proof and must never be presented as such.
3. **Test on the config Dev runs.** `npm start` = `node server.js`. `JARVIS_SEMANTIC_TOOLS` is NOT
   set. Any result obtained with that flag on is evidence for a build he does not use and must be
   labelled that way or discarded.
4. **Adversarial inputs only.** Vary vocabulary, sentence structure, spelling, length. Include
   inputs designed to make the change fail, and inputs that must be UNAFFECTED. A test battery with
   no failing case in it has not tested anything.
5. **Every step must be measurable before it is written.** If a change cannot be measured before it
   touches the repo, say so explicitly rather than shipping it on judgment.
6. **No keyword lists, no word-count thresholds, no NL-parsing regex added as intelligence.** If one
   is genuinely the right answer, stop and get Dev's explicit yes first. Removing such a rule needs
   his yes too, because it is still routing.
7. **State what was NOT tested, unprompted, in the same message.**
8. **If a measurement contradicts the plan, the plan is wrong.** Update this document, tell Dev the
   plan changed and why. Do not quietly proceed.
9. **Nothing gets committed without Dev seeing the real result first.**

---

## What was REFUTED while checking — do not act on these

| claim | status | evidence |
|---|---|---|
| "The router already emits `followUp`, so just use it" | **WRONG** | `agent-runtime.js:174` gates the model call on `settings.semanticRouting !== true`. `semanticRouting` is set nowhere in the codebase and is absent from `runtime/settings.json`. `classifyWithModel` **never calls the model** — it always falls through to the deterministic classifier. `followUp` comes from the same word-count heuristic it would be replacing. |
| "`route.followUp` feeds tool selection" | **WRONG** | It is passed to `selectTools` as `options.intent`. `selectTools` destructures `route` and never reads it. Dead wire. |
| "`continuationAction` raises `toolLimit` to 8" | **WRONG** | `agent-runtime.js:332-334` — the third and fourth branches both evaluate to `8`. 8 is already the default. The variable has no effect there. |
| "Issue 8 (the poem) is fixed" | **WRONG** | The TTL added earlier clears `active_artifact` only. `likely_next_references` still ratchets the poem back through its fallback chain, and `resolveReference` rewrites the user's prompt before the model sees it. Not fixed on Dev's machine. |
| "The AMD chart miss is a vocabulary problem" | **PARTLY** | Vocabulary is real, but the mechanism is scoring arithmetic — see Step 2. |
| "IDF / BM25 weighting will fix function-word noise" | **WRONG, MEASURED** | IDF measures rarity *within the tool corpus*, not within English. `what` appears in 20/159 descriptions (weight 2.07), `how` in 4/159 (**3.68 — the highest of any token tested**), `doing` in 1/159 (5.07). IDF *boosts* function words. Tested in four configurations; `open_app` stays #1 on "what is a bond yield" in all four. Do not spend anything on this. |
| "`isPureConversation` in the gateway returns zero tools" | **STALE** | No such function exists anywhere in the codebase. A comment in `agent-runtime.js` cites it. |

---

## STOP FIRST — two uncommitted changes must be reverted before anything else

Both are currently sitting modified in the working tree. Neither is committed. Both are harmful.

### R1 — revert the `guardUnearnedClaim` widening in `server.js`

`git diff server.js` (~line 2815-2851). The widened guard fires when `effective.length === 0`.
Read-only tools are excluded from `effective` by design (`observeOnlyTools()`), so a turn where
`web_research`, `url_read`, `apex_*` or `kalshi_*` ran and **succeeded** ends with
`effective = []` and `failed = []`. The new branch then replaces the entire answer with
*"I didn't actually do that — no tool ran"* — which is false, and destroys a correct answer.

This is the same defect class as `guardFabricatedProse`, which was already reverted once for
exactly this reason.

There is also dead code inside it: `if (!failed.length && !list.length && !COMPLETION_CLAIM.test(body)) return text;`
— `COMPLETION_CLAIM.test(body)` was already required to be true at the top of the function, so the
negation can never hold. A check that cannot fire.

**RULE:** revert to `HEAD`. Do not attempt to "narrow" it. The honest-claim problem is real but this
is not the fix, and a half-narrowed guard is worse than none because it fails silently.

### R2 — revert the `apex_price_history -> stage_render` companion in `server/tool-gateway.js`

Two independent problems:

1. **It disables Google grounding on price questions.** Adding `stage_render` to a turn flips
   `wantsSurface` true and `wantsFresh` false, and grounding is mutually exclusive with function
   declarations. So "how has bitcoin done this week" silently loses web grounding.
2. **There is no bitcoin data to fall back on.** The local store has bars for 34 tickers, none of
   them BTC, all last updated the previous day. So the turn loses grounding AND has no local data.

This reproduces exactly the failure Dev reported earlier ("i asked a simple query hows btc doing
today ... it says it cant answer").

**RULE:** revert to `HEAD`. Step 2 below achieves the same retrieval outcome by a route that does
not touch grounding.

**PROOF for R1+R2:** `git diff` returns empty for both files. Then, in the real command bar, ask a
live question ("how's bitcoin doing today") and confirm a real grounded answer comes back.

---

## STEP 1 — `open_app` stops firing on ordinary sentences

**The symptom Dev reported:** "anything i type it opens app".

### Root cause — CONFIRMED by measurement
`open_app`'s description explains itself in conversational prose
(`server/capability-engine.js:415`):

> "It looks the app up in **what is** ACTUALLY installed here"

That sentence puts the literal tokens `what`, `is` and `it` into the tool's searchable body.
`scoreTool` awards 4 points per matched token, and almost every other tool scores zero on an
ordinary sentence, so two junk matches win a 159-tool field:

```
"what is a bond yield"   -> open_app #1 of 159, matching on: what, is
"can u redo it"          -> open_app #1,        matching on: it
"whats 17 times 23"      -> open_app #5
"thanks that was helpful"-> open_app #1
```

None of these involve conversation history, pending confirmations, or the continuation bug. The
scorer does it cold.

### The change
`server/capability-engine.js:415` — replace the description string only. No logic, no scorer, no
list. Same meaning, without borrowing the user's function words:

```
"Launch an installed desktop application on this machine by name — 'open chatgpt', 'launch
spotify', 'open my claude app', 'start vscode', 'fire up notepad'. The name is matched against the
applications actually present on this computer, so there is no fixed list and no installed
application is out of reach; never tell the owner that desktop applications cannot be launched.
Prefer this over opening a website whenever the owner names an application rather than a site.
Requires an application name — do not call this unless the owner has asked for a program to be
started."
```

### Measured, before it goes near the repo
22 prompts: 12 that must NOT surface `open_app`, 10 real launch requests that MUST still reach it.

| | false exposures | real requests kept |
|---|---|---|
| live today | **8 / 12** | 10 / 10 |
| with rewrite | **4 / 12** | 10 / 10 |

Fixed: `can u redo it`, `whats 17 times 23`, `visualise how amd did in august`, `what is a bond
yield` (#1 -> #13).

**Still leaking after the rewrite:** `thanks that was helpful` (**still #1**), `what do you think of
this idea` (#3), `tell me more about that` (#4), `what is the capital of japan` (#5).

### HONEST LIMIT — read this before claiming the step worked
This halves the problem. It does not solve it. The residual leak has a structural cause that is
**not yet diagnosed**: on a field where nearly every tool scores zero, any single coincidental match
ranks first. A minimum-score floor is the obvious candidate and has NOT been measured. Do not
propose it until it has been.

**RULE:** this step is "measurably better", not "fixed". Say exactly that to Dev. Do not let 4/12
be reported as a win.

**PROOF REQUIRED:** in Dev's own command bar, type all 12 non-app sentences and all 10 launch
requests. Screenshot the results. No confirmation card may appear for the 12; all 10 must still
launch. Harness rankings do not count as proof here — they only justified writing the change.

---

## STEP 2 — charts actually get drawn

**The symptoms:** `visualise how amd did in august` draws nothing; `i wanna SEE tesla numbers not
read them` opens a browser.

### Root cause — CONFIRMED by measurement
Same class as Step 1, opposite direction: the two tools needed are described in market and
implementation vocabulary ("OHLCV bars", "price series"), so plain sight-words retrieve nothing.
`apex_price_history` scored 4 points of pure junk on the AMD prompt and ranked **32nd of 159**;
`stage_render` ranked **39th**.

### The change
Three description strings only, in `server/capability-engine.js` (`apex_price_history` at :566,
`apex_ticker_report` at :559, and `stage_render`). Exact strings are held in the measurement harness
at `scratchpad/bm25.js` and are reproduced verbatim when the step is executed. No scorer change —
see the REFUTED table; BM25 and IDF were both measured and are both worse.

### Measured across 14 prompts

| prompt | live today | with rewrite |
|---|---|---|
| `visualise how amd did in august` | price #32, stage #39 | **price #1, stage #2** |
| `i wanna SEE tesla numbers not read them` | price #37, stage #2 | **price #1, stage #2** |
| `plot amd for the last 30 days` | price #1, stage MISS | price #1, stage #8 |
| `amd. last month. visual.` | price #5, stage MISS | price #1, stage #9 |
| `nvda 30 day trend in panel` | price #1, stage #2 | price #1, stage #2 |
| `hows the weather` | weather only | weather only — unchanged |
| `who wrote hamlet` | neither | neither — unchanged |

No regression on the control prompts.

### KNOWN GAP
Getting both tools *offered* is not a drawn chart. `stage_render` sits at #8-#14 on three of the
phrasings, which is at or past the cut. Whether a chart actually appears is unproven and must be
proven on screen, not in the harness.

**RULE:** do NOT re-add the `TOOL_COMPANIONS` pair to force `stage_render` in. It breaks grounding
(see R2). If ranking alone proves insufficient after real testing, come back to Dev with the
measurement rather than reaching for the companion again.

**PROOF REQUIRED:** 12+ varied phrasings typed into the real command bar. Screenshot of a rendered
chart on the Stage. A count of which tools were offered is not proof.

---

## STEP 3 — a pending approval stops hijacking every reply

**The symptom:** with an approval waiting, every message comes back about that approval.

### Root cause — CONFIRMED
Two mechanisms, and the second is the one that matters.

1. `requestConfirmation` (`server/capability-engine.js:1116-1146`) returns the existing pending
   confirmation when the same tool+args is requested again, with an `alreadyPending` message.
2. **The real damage:** `server.js:5062-5063` —
   `const pendingApproval = toolResults.some((item) => item.status === "confirmation_required");`
   and if true it **breaks the tool loop and overwrites `finalText` with the summarizer output**.
   The model's actual answer to Dev's actual question is computed and then discarded, replaced by
   confirmation-card text.

So a re-offered `open_app` does not merely appear alongside the answer — it **deletes** the answer.

### The change
Give a duplicate its own status so it is not treated as a fresh approval request:

- `requestConfirmation` returns `alreadyPending: true` **without** a renderable card.
- The caller returns `status: "already_pending"` instead of `"confirmation_required"`.
- `classifyToolResults` in `server/tool-result-honesty.js` excludes `already_pending` from the
  `failed` bucket (otherwise it prints as a failure).
- `pendingConfirmationsFrom` and the UI filters are untouched — they key on
  `"confirmation_required"` and so will not pick duplicates up. Blast radius stays small.

Result: `pendingApproval` stays false, the loop continues, and the model answers the real question
while the already-queued action waits silently.

**RULE:** the model must still be told the action is queued and not to re-call it — that text stays,
it simply stops reaching the user and stops emitting a second card.

**PROOF REQUIRED:** deliberately leave an approval pending. Then ask ten unrelated things in the
real command bar — a knowledge question, a weather question, a two-word reply, a typo-ridden
sentence. Screenshot each. All ten must get a real answer. Then confirm the pending card still
approves correctly, and that a genuine new action still raises a card.

---

## STEP 4 — short messages stop re-triggering the last turn's tools

**The symptoms:** issue 1's other half, and `can u redo it` firing `neural_vault_maintenance`.

### Root cause — CONFIRMED
`server/agent-runtime.js:304-306`:

```js
const isContinuation = rawPrompt.trim().split(/\s+/).filter(Boolean).length <= 6
  || /^\s*(y|ok|okay|sure|yes|...)/i.test(rawPrompt);
const historyTail = history.slice(-4).map(h => h.text).join("\n");
const continuationAction = isContinuation && historyTail.trim().length > 0;
```

`historyTail` is prepended to the text the tool scorer reads (~line 318). Any message of six words
or fewer therefore gets scored against four turns of previous conversation. It is a length test
wearing a meaning test's clothes. Measured: with app history prepended, `open_app` jumps to **32**;
with vault history, `neural_vault_maintenance` jumps to **40**; and `what is a bond yield` flips to
`open_app` once continuation context is added.

### The change — and why it is NOT the obvious one
The obvious fix — "use the model router's judgment" — **does not exist to be used**. See REFUTED:
`semanticRouting` is never true, so the model router never runs.

The state-of-the-art answer is conversational query rewriting (QReCC / CANARD; LangChain's
`create_history_aware_retriever` passes the rewritten *standalone* query to the retriever and passes
input through untouched when history is empty; LlamaIndex's `CondenseQuestionChatEngine` condenses
always, which is worse). The retriever should receive **a rewritten standalone question**, never
history concatenated with the prompt.

That means a dedicated `resolveStandaloneQuery()` call on the router model, gated only on whether
history exists.

**COST, STATED PLAINLY:** this adds one model call — roughly **0.8s** on every turn that has
history. There is no way to hide it: it cannot run concurrently with classification (which is
instant) or with memory search (which happens after selection). Dev decides whether that is worth
it before this step is written.

**FALLBACK ON FAILURE:** fall back to the bare prompt, not to the old prepend behaviour. The failure
mode becomes "a follow-up loses its tools" instead of "every short message re-triggers the last
action". That is the safer of the two and it must be stated to Dev, not glossed.

**FLAG — NEEDS DEV'S EXPLICIT YES:** this deletes the `isContinuation` word-count and its regex.
It removes a hardcoded heuristic rather than adding one, but it is routing, and Dev gates routing.

**PROOF REQUIRED:** after an app request, ten unrelated short messages in the real command bar, none
of which may retrieve `open_app`. Then genuine follow-ups ("do it again", "move it to 1pm", "send
it") must still work — this is the regression that matters most, because the heuristic exists to
make follow-ups work at all.

---

## STEP 5 — the panel stops hanging on "Building your panel"

### Root cause — FOUND HERE, not in the earlier doc
`server.js`: the skeleton is raised at **4959** (`stageSkeletonRaised = true`) inside the `try`, and
dismissed at **5084** — also inside the `try`. The `catch` begins at **5177** and contains **no
dismiss**. `stage-dismiss` is emitted at only two places in the entire file, 4663 and 5085, both on
success paths.

So any error after `stage_render` — a timeout, a budget overrun, a model throw — leaves the panel
frozen on "Building your panel" permanently. The frontend has no rescue either: `StageSurface` has
no client-side timeout, so if the server never sends `stage-dismiss` the skeleton persists
indefinitely.

### The change
Dismiss the skeleton in the `catch` path as well as the success path, and add a client-side timeout
in `src/StageSurface.tsx` so the panel can rescue itself when the server says nothing at all.

Note: the dismiss at **4663** is dead code — the skeleton cannot have been raised at that point in
the `skipAnswerModel` path.

**PROOF REQUIRED:** force the pipeline to throw mid-request and watch the panel on screen recover.
Not a log line — the panel.

---

## STEP 6 — internal engines stop writing into Dev's memory

### Root cause — CONFIRMED, previously unreported
`recordNeuralTurn` runs inside every internal `callGemini` with no source filter. The allowlist that
should exclude internal turns (`server/neural-vault.js:1846`) covers only:

```js
["mission", "agent", "skill-autopilot"].includes(String(source || "").toLowerCase())
```

It does not cover `apex-oracle`, `apex-engine`, `helix-*`, or `apex-forge-*`. Consequences measured
in the live vault:

- **89 memories are internal engine prompts stored as if Dev had typed them** ("User: ...").
- `last_user_correction` currently holds an APEX Oracle system prompt — its "no prose, no code
  fences" phrasing matched the correction-detection regex.
- Those rows are then retrieved by keyword against Dev's real questions.

### The change
Filter by source at the ingest boundary so internal engine turns never enter continuity or memory,
then clean the 89 contaminated rows.

**RULE:** do not delete anything until Dev has seen a listing of exactly what would be deleted.

**PROOF REQUIRED:** count of internal-prompt rows before and after; `last_user_correction` showing a
real correction from Dev, or empty.

---

## STEP 7 — the poem, properly this time

Issue 8 was reported fixed and is not. `resolveReference` rewrites Dev's prompt before the model
sees it, and the poem is still the live referent because `likely_next_references` ratchets it back
through its fallback chain even after `active_artifact` expires.

Depends on Step 6 — the same continuity block is involved, and fixing it while internal engines are
still writing into it means measuring against a moving target.

**PROOF REQUIRED:** the five prompts that returned the poem for eight days, typed into Dev's own
command bar **with his real history in place**. A synthetic two-message history is the easiest way
to make this look fixed when it is not, and was how it was wrongly declared fixed before.

---

## STEP 8 — prices stop contradicting themselves

### Root cause — CONFIRMED, and the earlier proposed fix was wrong
`apex_ticker_report` returns a live quote; `apex_price_history` returns stored daily bars. Both
correct, both labelled "Apple's price".

**But the earlier plan's fix — label it "last trade 13:23 today" — would be MISLEADING.** The `ts`
field is the *ingest* time (when JARVIS polled Yahoo), not the exchange time. At 3am on a Saturday
that timestamp reads as "now" while the price is Friday's close.

Further findings:
- `apex_market_snapshot` drops the `updated` field entirely — a genuinely unlabelled price source.
- `capToolResultForModel` truncates JSON mid-string, so a large bar request can reach the model as
  invalid JSON with the latest date missing.

### The change
Follow Polygon's field naming (`lastTrade`, `day`, `prevDay`, `updated`) — a verified reference —
and label each number by *what measurement it is*, with an honest note that the timestamp is a poll
time rather than an exchange time. Fix the snapshot's dropped field. Fix the truncation separately.

**Blast radius: none in code.** No frontend or server code consumes these tool return shapes; the
only consumer is the model. The sole reference found was a scratch harness, not a test.

---

## STEP 9 — smaller confirmed findings, batched last

| # | finding | file |
|---|---|---|
| 9a | `/api/chat`, `/agent/message`, `/api/briefing` still load the **full unwindowed** conversation; only `/api/chat/stream` was windowed to 16 | `server.js` |
| 9b | APEX room chat is not marked transient, so it pollutes the main command bar's history | `src/rooms/apex` |
| 9c | `/api/agents` registered twice — the earlier route shadows the missionEngine one, which is dead | `server.js` |
| 9d | Four widget catalogs drifted: server 18, HUD 18 (swaps `helix`, drops `runtime`), frontend registry 21, system prompt 12 | multiple |
| 9e | `capabilityHint` says "I can't see your screen" — false; `screen_capture`/`screen_inspect` exist and the system prompt forbids exactly this refusal | `server.js` |
| 9f | A confirmation created via `/agent/message` stores `req.jarvisDevice?.id`, which approve may not match — permanently unapprovable until the 10-minute expiry | `server.js` |
| 9g | `addNote` has no cap; the notes table grows unbounded (reads capped at 100, writes not) | `server/atlas-store.js` |
| 9h | `active_issue` latches on any reply containing failure words and only clears when replaced — and the honesty guard's own replacement text contains those words, so it can latch itself | `server/neural-vault.js` |
| 9i | `defaultContinuity()` seeds hardcoded pronoun targets, so a freshly wiped continuity still resolves "it" to a canned string | `server/neural-vault.js` |
| 9j | The tool cap is already broken independently of anything above: the always-useful set alone pushes 15+ tools past a limit of 8, and `chosen.slice(...)` is a no-op by construction | `server/tool-gateway.js` |

---

## Order, and why

**R1, R2** first — they are live in the working tree and actively harmful.
**Step 1** next — it is Dev's loudest complaint, it is a single string, and it is already measured.
**Step 2** — same mechanism, same file, already measured, no new risk.
**Step 3** — the reply-hijack; large user-visible win, contained blast radius.
**Step 4** — needs Dev's yes and costs 0.8s per turn; it is a decision, not just a change.
**Step 5** — the stuck panel.
**Steps 6 -> 7** — memory contamination, then the poem, in that order.
**Step 8, 9** — correctness and hygiene.

## Deferred by Dev's instruction
The calendar widget's fixed 1180x740 canvas under a CSS transform (`src/StageCalendar.tsx`). Dev
said leave it. It stays here, untouched, so it is not forgotten.

## Environmental, not fixable in code
Screen capture is blocked by local security policy roughly one attempt in four. Already reported as
a sentence rather than a PowerShell dump. Whether a second capture method exists that the policy
permits has **not been researched**.
