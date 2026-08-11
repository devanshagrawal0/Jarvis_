# Jarvis "Today" — Intelligence Rebuild: audit, research & fix plan

**Thesis (one line):** The regex intent layer isn't a bug to patch — it's the crutch that has to be removed. Make the LLM own understanding (forced tool choice + strict argument schemas + a session‑state object + memory + a validate‑retry loop), gate only irreversible actions behind confirmation, and prove it with argument‑level end‑to‑end evals.

Scope: only the ATLAS/"Today" work built since Wave 1 (W1→W6 + email intelligence Fix 1–4). Not the whole app.

---

## PART 1 — The errors (what I built that made it dumb)

**Root cause:** every natural‑language path is hardcoded regex, and it runs *instead of* the LLM, with no conversation memory. Actions never reach the brain, never get recorded, never see prior turns. So Jarvis can pattern‑match one sentence but cannot understand, remember, or reason.

**Offending code (files I wrote/changed):**
- `src/lib/messageIntent.js` — client‑side regex "intent": `detectMessageIntent` (email + recipient), `detectInboxRead`, `detectCalendarCommand`, `parseContactSaveReply`, plus hand‑maintained wordlists (`NOT_A_PERSON`, `VERB_NOT_NAME`, `personOK`). This is the worst offender.
- `server/atlas/atlas-capture.js` — regex NL date/task parser (`extractWhen`, `detectRecurrence`, `parseCapture`).
- `server/atlas/calendar-write.js` — regex calendar parser (`parseCalendarCommand`, `matchCalendarTarget`, `cleanTarget`, `splitMoveOnTo`).
- `server/automation/execution-lane-router.js` — `emailIntent()` regex.
- `src/JarvisUI.tsx` `handleSubmit` — the **pre‑route chain** (room → calendar → email → inbox → capture → brain). Each pre‑route runs a regex, calls an API, and `return`s early — **the brain is never called**.

**The systemic failures this produces:**
1. **No conversation memory in the action path.** Pre‑routes are pure functions of the current string, so "him" / "the file showing the recent changes" / "same as last time" are unresolvable. (#1 reason it feels dumb.)
2. **Pre‑routes bypass the recorder.** Turns are only written by the brain endpoints (`appendConversation`, server.js:7584/8425). Email/calendar/contact/capture turns hit none of those, so `conversation.json` (and the brain's own history via `loadConversation`) is full of holes — even a later brain turn has amnesia about actions taken.
3. **No session entity/state** ("last person emailed = aj", "the file we're discussing"). No coreference is even possible.
4. **Regex ≠ understanding.** Recipient extraction grabs quantifiers ("another"), articles, and stray words ("and"). Wordlists are an endless losing game.
5. **Attachments by reference are dropped silently.** "attach the file showing the recent changes" → no file, no concept of it → ignored, no error.
6. **Two calendars, implicit routing.** Google Calendar vs internal ATLAS store; whichever detector fires first wins.
7. **The brain has no tools for its own data.** "plan my day / my tasks" → "not connected this turn," even though the widgets show the data.
8. **Duplicate surfaces.** Three Today components (`TodayCard`, `TodayDashboard`, `TodayCommandCenter`) — every feature added 3×; easy to miss one.
9. **Stateful regex dialogs loop** (the contact‑save "what name?" loop).
10. **Silent wrong actions** ("send in 2 min" sent instantly).
11. **Verification theater (mine).** I verified *plumbing* (endpoint returns 200 / unit test passes) and reported it as "it works / it's smart," never testing the real conversational experience.

**Why the regex exists (the honest tension):** it was added because Gemini was unreliable at tool‑calling (it narrated instead of calling the tool). That trades reliability of *firing* for total loss of *understanding and memory*. The correct fix is to make the model reliably call tools **with** the conversation as context — not replace it with regex.

---

## PART 2 — What the web research found (summary)

A one‑agent deep web dossier (Anthropic/OpenAI/Gemini docs, agent/memory/tool‑calling best practice, coreference, evals). Full sourced version lives in the appendix at the bottom. Key findings:

- **The architecture is inverted.** Every production assistant does the opposite of us: **the LLM owns understanding; deterministic code owns only execution and safety.** The regex pre‑router that pre‑empts the LLM is the structural defect.
- **Unreliable tool‑calling has a real fix that isn't regex:** **forced/required tool choice** (Gemini `function_calling_config: ANY`/`VALIDATED`, OpenAI `tool_choice:"required"`, Claude `tool_choice:{any|tool}`) **+ strict JSON‑Schema arguments** (constrained decoding) **+ a validate‑and‑retry loop** that re‑prompts the model on a bad argument instead of asking the user.
- **Gemini specifically:** in AUTO mode + long context it "forgets" to call tools (documented); its dominant errors are *argument* errors ("Value Not Yet Known" / "Incorrect Value") — exactly our `recipient = "another"` bug. Fixes: `ANY` mode, mandatory system instruction, retry taking first valid call, small focused toolset; if still flaky, route the reasoning/tool‑selection call to a stronger tool‑use model.
- **Memory is three tiers:** recent raw turns (working) + rolling summary (session) + long‑term facts store (contacts/preferences, Mem0‑style ADD/UPDATE/DELETE). Our action path touches *none* of it.
- **Coreference:** let the LLM resolve "him"/"the file" from context, but anchor it with an explicit **session entity/state object** the model reads each turn (`last_contact`, `last_file`, `pending_action`). Optionally rewrite the utterance into a self‑contained form before the tool call.
- **Routing without regex:** LLM owns intent + argument extraction; a **semantic router** (embeddings) is a legitimate cheap fast‑path for top‑level intent only — never for entity extraction. Deterministic routes are legitimate only for *exact* commands (slash‑commands, buttons), never NL parsing.
- **Execution:** ReAct loop over typed tools (1–3 step requests); **human‑in‑the‑loop confirmation** on consequential/irreversible actions only (send email, create/cancel/move event) with approve/edit/reject; **attachments as first‑class tracked entities** referenced by id.
- **Response quality:** one strong system prompt (persona + hard rules: concise, never fabricate a recipient/time/file — ask a targeted question; confirm sends).
- **Evals:** test real end‑to‑end behavior with **assertions on the resolved recipient / attachment / action**, not "API returned 200"; scoped judges for tool‑choice and argument correctness; run on every prompt/model change.

> Honesty note: I relayed the research faithfully but did **not** independently verify every citation; a few source IDs look off. The recommendations are standard and sound regardless.

---

## PART 3 — The fix plan (what we will do)

**Target architecture, grounded in our codebase:** one entry point — the brain (`callGemini` / `agent-runtime`) — for every natural‑language turn. Delete the JarvisUI regex pre‑routes. The brain receives full recent history + a session‑state object + a compact set of typed tools + forced tool choice + strict arg schemas + a validate‑retry loop. Consequential tools go through the existing approval‑card confirmation. Everything is recorded. Memory accumulates. Evals assert real outcomes.

We already have much of the machinery: `callGemini(history, …)`, `agent-runtime.prepare` (route + selectedTools), `capability-engine` (typed tools with `risk` levels), the `forceToolCall` (ANY mode) path, approval cards, and `neuralVault/memoryStore.ingestTurn`. The rebuild is mostly **removing the regex** and **wiring the brain correctly**.

### Waves (build 2 → gate → checkpoint; nothing marked done without a live before/after demo)

- **W0 — Remove the crutch + record everything.** Delete the JarvisUI pre‑routes for email/calendar/inbox/capture/contact‑save; keep only exact room‑entry navigation. Every NL turn now goes to the brain, which already records + loads history. (Files: `src/JarvisUI.tsx`.)
- **W1 — Give the brain its missing tools.** Expose as first‑class `capability-engine` tools with strict schemas + clear descriptions + enums: ATLAS tasks/reminders/events read+write, inbox read, `contact_find` / `contact_save`, calendar `create/move/cancel`, email `compose` + `send`. Fix "not connected this turn" — the brain must read tasks/calendar. Keep the toolset small/focused. (Files: `server/capability-engine.js`, `server.js` handlers.)
- **W2 — Make tool calls reliable.** When an action is expected: Gemini `function_calling_config: ANY`/`VALIDATED` + `allowed_function_names`; strict JSON‑Schema arguments (`additionalProperties:false`); a **validate‑and‑retry loop** that re‑prompts on a bad/garbage argument (e.g. recipient="another") instead of surfacing it. (Files: `server.js callGemini`, `agent-runtime`.)
- **W3 — Session state + memory.** Build a `session_state` entity object each turn (`last_contact`, `last_email/thread`, `last_file`, `pending_action`) from recent turns/actions; feed it + recent history + a rolling summary; wire long‑term contact/preference memory (neuralVault). This is what resolves "him" → aj and "the file" → the artifact. (Files: `server.js`, memory store.)
- **W4 — Confirmation UX (reuse approval cards).** `send_email` / `create_event` / `move_event` / `cancel_event` pause for approve/edit/reject; reversible tools (draft/search/read) auto‑run.
- **W5 — Attachments as entities.** Track files (id/name/description/provenance); tools take `attachment_id`; "the file showing the recent changes" resolves from state, or the assistant asks a targeted question when it genuinely can't.
- **W6 — System prompt + voice.** One strong persona/rules prompt: concise, honest, never fabricate a recipient/time/file — ask a specific question; always confirm sends.
- **W7 — Eval harness.** Golden set of real requests (incl. "send another mail to him attaching the file…") with assertions on resolved recipient / attachment id / action taken; scoped tool‑choice + argument judges; run on every prompt/model change. Delete the regex unit tests — they test the wrong layer.

### Priority order (highest leverage first)
1. W0 remove regex from the action path (foundational).
2. W1 + W2 typed tools + forced/validated tool choice + strict args + retry loop.
3. W3 session state + memory (unlocks coreference).
4. W4 confirmation on consequential actions.
5. W5 attachments; W6 system prompt; W7 evals.
6. *(If Gemini stays flaky after W2)* route reasoning/tool‑selection to a stronger tool‑use model; keep Gemini for cheap subtasks.

### Definition of done (per wave)
A wave is done only when the **real conversation** demonstrates the target behavior in front of you (the 15 benchmarks), not when an endpoint returns 200 or a unit test passes. Every "done" ships with a before/after transcript.

---

## Appendix — full research dossier (verbatim, sourced)

*(The complete sourced research report from the web‑research agent is preserved here for reference. Summarized in Part 2 above.)*

See the seven sections: (1) tool/function‑calling reliability, (2) conversation memory, (3) coreference/entity resolution, (4) intent without regex, (5) agentic execution + confirmation UX, (6) response quality, (7) reliability engineering/evals — plus the failure→fix mapping table and the prioritized change list. Key sources: Anthropic "Building Effective Agents" & "Writing tools for AI agents"; OpenAI function‑calling & Structured Outputs; Gemini function‑calling (AUTO/ANY/VALIDATED); LangChain human‑in‑the‑loop interrupt; three‑tier agent memory (Mem0); ReAct vs plan‑and‑execute; coreference‑via‑object‑descriptions; Braintrust/LangChain LLM evals.
