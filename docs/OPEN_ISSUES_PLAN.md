# The 11 open issues — cause, fix, and how each one gets proven

Written 2026-08-21. Everything marked **CONFIRMED** was read in source or measured against the live
runtime today; everything marked **NOT CONFIRMED** is a hypothesis and says so.

Nothing in here is fixed by adding a keyword list. Where a fix means changing a regex heuristic, it
is flagged in bold and needs Dev's yes before it is written.

---

## Rules this plan runs under

- One issue at a time. Fix it, show the result on Dev's screen, stop. No stacking.
- The proof is the rendered UI, not a harness count, not an HTTP 200, not JARVIS's own reply text.
- Every test runs on the config Dev actually starts (`npm start` = `node server.js`, **no**
  `JARVIS_SEMANTIC_TOOLS`). Results from any other config do not count.
- Varied phrasings, chosen to break it, not to pass it.

---

## P0 — Issue 1 and Issue 5 are the same bug

### What Dev sees
- **Issue 1:** "anything i type it opens app" — an app-launch confirmation surfaces on messages that
  have nothing to do with apps.
- **Issue 5:** typing `can u redo it` fires `neural_vault_maintenance`.

### Root cause — CONFIRMED
`server/agent-runtime.js:300-305` (the plan previously cited 304-306):

```js
const isContinuation = rawPrompt.trim().split(/\s+/).filter(Boolean).length <= 6 || /^(y|ok|...)/i...
const historyTail = history.slice(-4).map(h => h.text).join("\n");
const continuationAction = isContinuation && historyTail.trim().length > 0;
```

Then line 318 builds the text the tool scorer reads as `historyTail + "\n" + prompt`.

**Any message of six words or fewer** is treated as a continuation, and the last four turns are
glued onto the front of the text the tool scorer reads. So the tool selection for `can u redo it`
is not scored against `can u redo it` — it is scored against four turns of previous conversation
plus those four words. Whatever tool family the last few turns touched gets re-retrieved.

That is the whole mechanism for both issues:

- Ask to open an app, then type anything short → `open_app` is back on the menu, the history says
  "open chatgpt", the model calls it again.
- `can u redo it` is four words → history prepended → `redo`/`maintenance` scores against
  `neural_vault_maintenance`.

Two things make it worse rather than better:

1. **Six words is not a continuation test, it is a length test.** "what is a bond yield" is five
   words and gets the previous turn's tools. So does "hows the weather".
2. **`requestConfirmation` dedupe makes it visible.** `server/capability-engine.js:1120-1148`
   returns the *existing* pending confirmation rather than minting a new one — correct on its own,
   but the reply then names the waiting `open_app` on every short message, which is exactly what
   "anything i type opens app" looks like from the chair.

### Fix
Continuation is a property of *meaning*, not of *length*. The length heuristic should be deleted,
not tuned.

**CORRECTION (measured 2026-08-21, this claim was wrong).** An earlier draft said to hand the
decision to the route classifier "because it reads the words". On Dev's build it does not read
anything. `classifyWithModel` (:174) calls Gemini only when `settings.semanticRouting === true`.
That key occurs in **exactly one place in the whole repository — the line that tests it**. Nothing
sets it, no UI exposes it, and it is `undefined` in `runtime/settings.json`. The LLM router has
never executed here; `classifyWithModel` always returns the deterministic baseline.

And the baseline's own follow-up signal (`agent-runtime.js:94`) is the same bug one size up:

```js
const followUp = text.trim().split(/\s+/).length < 8 || /\b(that|it|them|those|earlier|previous|i meant|actually)\b/.test(lower);
```

So deferring to `route.followUp` swaps a 6-word rule for an 8-word rule plus a pronoun regex —
the banned pattern, wearing a different hat. There is **no meaning-based signal available on this
build**. That leaves exactly two honest options, and Dev picks:

- **(a) Delete and do not replace.** History stops being prepended to the tool scorer. Issues 1 and
  5 die with it. Cost: a genuine short follow-up ("do it again") no longer re-exposes the previous
  turn's tool family, so that path has to be carried by the confirmation card instead — which must
  be tested, not assumed.
- **(b) Make the classifier real.** Turn `semanticRouting` on so the Gemini router actually runs,
  then let it decide. This is the only option that produces meaning-based continuation. It costs a
  router call per eligible turn, and `shouldUseSemanticRouter` (:160) currently gates on
  `baseline.followUp` — the broken signal — so that gate has to be revisited too.

**FLAG — needs Dev's yes:** this deletes the `isContinuation` word-count + `/^(y|ok|sure|...)/`
regex at `agent-runtime.js:300-301`. It removes a hardcoded rule rather than adding one, which is
the direction Dev asked for, but it is still a routing change and he gates it.

Secondary, independent of the above: when a confirmation is already pending, a turn that is not
about that confirmation should not resurface it. Currently the pending card leaks into every reply.

### Proof required
In Dev's own command bar, with an `open_app` confirmation deliberately left pending, type ten
things that have nothing to do with apps — a knowledge question, a weather question, a two-word
reply, a typo-ridden sentence, a question about a file. Screenshot of the UI for each. Zero of them
may surface `open_app`. Then confirm a real "open chatgpt" still works.

---

## P1 — Issue 4: Apple's price disagrees with itself

### Root cause — PARTLY CONFIRMED, and the earlier conclusion was wrong
The two tools do read two different sources (confirmed). But the earlier claim that "both numbers
are correct, they are different things labelled identically" is **not established, and the live
data contradicts it.**

Measured in `runtime/apex.sqlite` just now:

| source | value | timestamp |
|---|---|---|
| `apex_quotes_live.last` (used by `apex_ticker_report`) | **311.30** | 2026-08-21 13:23Z — today, live |
| `apex_bars` last 1d close (used by `apex_price_history`) | **316.60** | 2026-08-20 13:30Z — yesterday's close |

`apex_ticker_report` calls `apex.getQuote()`; `apex_price_history` reads stored daily bars
(`capability-engine.js:2947` and `:2963` — both citations verified). The reply presents both as
"Apple's price" with no date attached, so they read as a contradiction.

The earlier line "neither is stale or wrong" is **withdrawn** — see the measurement below. The
numbers in the table above are from an earlier reading; `last` moves intraday, so its exact value
is not the point. The point is the disagreement measured next.

### The measurement that breaks the old conclusion (2026-08-21, live `runtime/apex.sqlite`)

`apex_quotes_live` carries its own `prev_c` (previous close). That is the *same quantity* as the
latest completed daily bar. They disagree, and not by a constant:

| ticker | quote.prev_c | latest 1d bar close (2026-08-20) | gap |
|---|---|---|---|
| AAPL | 305.93 | 316.60 | +3.5% |
| NVDA | 225.16 | 216.45 | -3.9% |
| MSFT | 495.40 | 481.86 | -2.7% |
| ^IXIC | 26729.16 | 26067.17 | -2.5% |
| TSLA | 342.27 | 341.85 | -0.1% |
| AMZN | 260.11 | 261.38 | +0.5% |

The sign varies, so this is not a split/dividend adjustment. Two feeds disagree about one number.

### Fix — labelling ALONE is now the wrong fix
Labelling would print two contradictory previous closes and call both correct. **Diagnose the feed
disagreement first**: find where `apex_quotes_live` and `apex_bars` are ingested from and why
they disagree about a settled close. Labelling is still wanted afterwards, but on top of data that
agrees with itself, not instead of fixing it.

### Proof required
Ask for Apple's price five different ways in the real UI. Every answer names which measurement it
is quoting and its date. No answer contains two unlabelled conflicting prices.

---

## P2 — Issues 8, 9, 10, 11: changed in code, never verified on Dev's build

These are the poem hallucination (8), the YouTube fabrication (9), confirmations dead-ending (10),
and the panel hanging on "Building your panel" with a frozen size (11).

### Status — honest
The code changes are real and are described in `docs/CONTEXT_MEMORY.md` and `docs/PANEL_BUGS.md`.
**The PASS table in `CONTEXT_MEMORY.md` section 7 is not usable as evidence.** An earlier draft
said every one of those runs set `JARVIS_SEMANTIC_TOOLS=1`. **That is unsupported** — the string
`JARVIS_SEMANTIC_TOOLS` does not appear anywhere in `CONTEXT_MEMORY.md`. Section 7 records only
"Run against the live server".

The conclusion survives for a stronger reason: **the table states no configuration at all**, and it
is harness output rather than the rendered UI. A results table that does not say what produced it
cannot be evidence for any build, including the one it ran on.

That table should not stay in the repo unqualified — it currently reads as proof and it is not.

### Fix
No new code until they are re-run. Re-test all four on the default config, in the real UI, and then
either mark them genuinely fixed or reopen them with what actually happened.

### Proof required
The five vague prompts that used to return the poem (`where is this file`, `open it`, `do it
again`, `that was interesting tell me more`, `thanks that was helpful`), typed into Dev's own
command bar with his real 500-turn history in place — not a two-message synthetic history, which is
what my harness used and is the easiest way to make this look fixed when it is not.

---

## P3 — Issues 2 and 3: asking for a picture gets text, or a browser

- **Issue 2:** `visualise how amd did in august` → neither the price tool nor the drawing tool is
  retrieved. Nothing is drawn.
- **Issue 3:** `i wanna SEE tesla numbers not read them` → opens a web browser.

### Root cause — PARTLY CONFIRMED
Measured across twelve chart phrasings on the default config: `stage_render` was offered 8/12, and
in three of the four misses the *data* tool came back without the *renderer*. That half of it is
confirmed, and a structural companion (`apex_price_history` → `stage_render`, uncommitted, in
`server/tool-gateway.js:51`) took it to 11/12 offered in the harness — **offered, not drawn. There
is no evidence yet that a chart appears on screen.**

What is **NOT CONFIRMED**: why `visualise how amd did in august` retrieves *neither* tool. It is
not a pair failure, it is a total miss, and I have not diagnosed it. Likely the description text for
both tools is written in market vocabulary ("OHLCV bars", "price series") while the request is in
plain sight-words ("visualise", "SEE", "eyeball"), but that is a hypothesis.

### Fix
Diagnose the total miss first — do not extend anything until the reason is known. If the cause is
descriptions written in implementation vocabulary, the fix is rewriting the descriptions in the
words a person uses, which is what the retriever actually reads.

### Proof required
Twelve-plus phrasings, deliberately varied in vocabulary and structure, in the real UI. Screenshot
of a rendered chart, not a count of which tools were offered.

---

## P4 — Issue 6: screen capture blocked

Environmental — the local security policy blocks it roughly one attempt in four. Code cannot remove
the block. Already changed so the failure is one sentence instead of a PowerShell dump. The only
open question is whether a second capture method exists that the policy does not block; **not
researched yet.**

---

## Deferred — Issue 7: calendar widget renders shrunk

`src/StageCalendar.tsx` fixes its design canvas at 1180x740 and applies a CSS transform, so in the
320x440 strip slot it renders at 0.27 scale. A transform can only scale, never reflow. Fixing it
means the layout reflows instead of scaling. **Dev said leave it, so it stays here untouched.**

---

## Order, and why

1. **P0 (issues 1 + 5)** — one fix, two bugs, and it is the one that makes JARVIS feel broken on
   every single message. Highest damage per line changed.
2. **P1 (issue 4)** — small, fully diagnosed, and it is a trust problem: two prices means neither
   can be believed.
3. **P2 (issues 8-11)** — no new code, just honest re-verification. Has to happen before anything
   built on top of it means anything.
4. **P3 (issues 2 + 3)** — needs a diagnosis before a fix.
5. **P4 (issue 6)** — research whether an alternative capture path exists.

## Uncommitted right now
`server.js` (+31) and `server/tool-gateway.js` (+29) are modified and unsaved. The tool-gateway
change is the chart companion described in P3. The `server.js` change widens the honesty guard to
catch "I am opening..." claims when no tool ran at all. Neither is verified on screen.
