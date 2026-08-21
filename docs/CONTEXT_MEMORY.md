# Current-context memory — how it works, what's wrong, and the fix

Written 2026-08-21 after the owner asked the same vague question eight days running and got a poem
back every time. Everything here was read in source or measured against the live runtime.

---

## 1. What JARVIS actually loads when you type

Five independent layers are assembled into every turn. None of them knows about the others.

| # | layer | source | live size | selection |
|---|---|---|---|---|
| 1 | conversation history | `runtime/conversation.json` | 500 turns / 8 days | the client sends **no** `history` field, so the server fell back to the whole log |
| 2 | recalled memories | `ms_memories` in `neural_vault.sqlite` | **670 live rows, 465 episodic** | keyword overlap, top 7 (12 when the route is "personal") |
| 3 | continuity state | `runtime/neural_vault/hot/continuity_state.json` | the pronoun map | carried forward every turn, never released |
| 4 | vector memories | `runtime/memory-vectors.sqlite` | 264 vectors | cosine, merged into layer 2 |
| 5 | working memory | `working_memory` table | 2 rows | **last written 1 July** — effectively dead |

Layers 1–3 are the ones that matter. Layer 4 is small; layer 5 is abandoned.

---

## 2. Defect A — retrieval has no sense of time

`server/memory-store.js:171`:

```js
score = term_hits*0.2 + importance*0.35 + confidence*0.25 + exact*0.2
```

There is **no recency term**. A memory written on 12 August scores identically to one written a
minute ago. `updated_at` appears only as the third tiebreak in the `ORDER BY`, so it decides nothing
unless term hits and importance are exactly equal.

Measured: **237 of 670 rows have no expiry at all.** They are permanent by default.

The consequence is not subtle. Ask anything whose words overlap an old exchange and the old exchange
is retrieved with full confidence, indefinitely.

---

## 3. Defect B — episodic transcripts are presented as durable facts

465 of the 670 rows are raw turn records:

```
[episodic/conversation 2026-08-13]
User: open panel and write a 200 word poem
JARVIS: Opened the Stage panel on your screen with the poem, sir.
```

Eleven of them mention the poem. They are injected into the system prompt under this heading
(`server.js:2396`):

> "Durable memory about the owner and past work — reference material, generally reliable but may be
> incomplete or dated; prefer it over guessing"

They are not durable facts about the owner. They are old turns. Telling the model to *prefer them
over guessing* is telling it to prefer a transcript of last week over the conversation in front of
it. `server/memory-extractor.js` already exists to distil real facts out of turns; the raw turns are
being retrieved instead of, not in addition to, its output.

---

## 4. Defect C — the continuity ratchet

`server/neural-vault.js:1659-1664`, which runs after **every** turn:

```js
const artifact   = artifacts.find(…)?.title || artifacts.find(…)?.path || continuity.active_artifact;
const nextObject = artifact || entities[0] || topic || continuity.last_discussed_object;
```

Two faults in two lines:

1. **`|| continuity.active_artifact`** — a turn that produces no artifact *inherits the previous
   one*. No expiry, no session scope, no decay.
2. **`artifact` is first in `nextObject`** — so while `active_artifact` is set, the stale artifact
   outranks the current turn's own entities and topic.

That value is then written straight into the coreference map:

```js
recent_pronoun_targets: { it: nextObject, this: …, that: … }
likely_next_references: { it: nextObject, "the prompt": artifact || …, … }
```

So `it`, `that` and `the prompt` have pointed at `a 500 word poem on it — final.md` since
**13 August**, re-pinned on every one of the ~450 turns since. The file's `updated_at` moves
constantly, which is why it looks maintained: each update writes the poem back in.

Two more latches in the same block:

- **`last_assistant_commitment`** (line 1674) records any reply matching
  `/\b(i will|i'll|done|created|updated|opened|saved|fixed)\b/`. JARVIS's own **false** claims are
  therefore stored as commitments and replayed as context — including "I have switched over to your
  YouTube tab", which never happened.
- **`active_issue`** (line 1661) latches on any reply containing `failed|broken|error|cannot` and
  only clears when a different error replaces it. With 29 refusals in the log, this is a pessimism
  ratchet.

---

## 5. Why the three compound

Ask **"where is this file"** one message after requesting a conversation export:

- **continuity** resolves *this* → the poem (Defect C)
- **retrieval** matches *file*/*poem* against 11 episodic poem rows, with no recency penalty (A + B)
- **history** carried the original poem exchange in all 500 turns (fixed today)

Three independent layers vote for the poem. Nothing votes for the export requested one message
earlier. The result reads like confident recall rather than a bug, which is why it survived eight
days of being told it was wrong.

The same mechanism explains every intrusion in the log: `#96 "send it to the right person"`,
`#132 "open it"`, `#298 "thanks that was helpful"`, `#318 "do the thing with the panel"`,
`#324 "nah do it again"`, `#368 "that was interesting tell me more"`, `#374`, `#498`.

---

## 6. The fix

Three changes, each independently testable. None of them is a keyword rule and none deletes data.

### F1 — recency in the retrieval score
Add a half-life to episodic memories so today outranks last week. Semantic and procedural memories
(real facts, learned procedures) decay far more slowly or not at all — a fact about the owner does
not get less true. Nothing is deleted; old memories simply stop beating new ones on equal keywords.

### F2 — stop calling transcripts durable facts
Episodic conversation rows are recall, not reference. Either label them honestly in the prompt
("earlier exchanges, may be stale") and separate them from `[semantic]` facts, or stop retrieving
raw turns for non-personal routes entirely and rely on the extractor's distilled facts.

### F3 — continuity prefers the present
- `nextObject` takes the **current turn's** entities/topic first; a carried-over artifact is the
  last resort, not the first.
- `active_artifact` is time-boxed — inherited only within the same session/day, dropped after.
- `last_assistant_commitment` latches only when a tool **actually took effect** (the `effective`
  set already computed in `server/tool-result-honesty.js`), so a false claim can never become
  remembered context.

### Acceptance
The same vague prompts, run against the live server, must resolve to the current subject and not to
an eight-day-old artifact: "where is this file", "open it", "do it again", "that was interesting
tell me more", "thanks that was helpful". Plus no regression on the things that work now —
charts, general knowledge, and genuine follow-ups where the referent really is the previous turn.


---

## 7. Result — measured after the fix

Run against the live server, transient so none of it entered the owner's history (verified: 500
turns before, 500 after).

```
PASS [chart]   chart nvidia over the last month
PASS [chart]   graph tesla's closes for the past three weeks
PASS [chart]   put apple's price history up
PASS [chart]   plot amd for the last 30 days
PASS [know]    who wrote hamlet / capital of japan / 17 times 23
PASS [live]    hows btc doing today / whats the weather like
PASS [vague]   where is this file
PASS [vague]   open it
PASS [vague]   do it again
PASS [vague]   that was interesting tell me more
PASS [vague]   thanks that was helpful
PASS [approve] launch the chatgpt desktop app
PASS [approve] write today's conversation out to a text file
PASS [honest]  switch my tab to youtube and read all the videos
PASS [noise]   hi
```

The five `vague` prompts are the ones that returned the poem for eight days. None of them does now,
and "tell me more" picks up the most recent subject instead.

The `honest` case is the YouTube fabrication. It used to answer "I have switched over to your
YouTube tab and gathered the visible video titles" followed by an invented feed, while the owner was
looking at a different tab. It now switches the tab for real and reports that the page is empty.

Continuity released itself on the first turn after the change: poem references 11 -> 1,
`active_artifact` empty, `it` pointing at the live subject.

Retrieved-memory age, measured on the real store:

| prompt | before | after |
|---|---|---|
| "open it" | 21.4 days | 1.2 days |
| "do it again" | 8.5 days | 0.2 days |
| "send it to the right person" | 7.5 days | 2.5 days |

Side effects of clearing the reminder-doubling damage:

| | before | after |
|---|---|---|
| atlas.sqlite | 349 MB | 0.1 MB |
| /api/atlas/today | ~8s at worst | 0.44-0.82s |
| /api/atlas/notes | 1.1s | 0.017s |

## 8. Not fixed

- **Screen capture is intermittently blocked** by local security policy — it succeeded three times
  in four during testing. The failure is now reported in a sentence rather than by pasting the
  PowerShell source, but the block itself is environmental and not something the code can remove.
- **The calendar widget still scales like an image** (`StageCalendar.tsx`, a fixed 1180x740 canvas
  under a CSS transform). The owner said explicitly to leave it alone, so it was left alone.
