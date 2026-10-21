# JARVIS Brain Rebuild — Research Findings (2026-10-20)

Read-only trace of the reply pipeline for every problem Dev listed. Every claim below was read in
code or measured from a live database on this date. Where a first guess turned out wrong, the
correction is noted (two were).

Scope rules from Dev for the rebuild: UI unchanged, widgets unchanged, every existing agent /
capability / tool keeps working. Backend may be reworked; unneeded code may be removed.

---

## 0. How one message flows today

`POST /api/chat/stream` (server.js:12263)
1. Regex fast-paths before the brain: widget control / move / view (`detectWidgetControl|Move|View`,
   12327-12385), image-generation keyword gate (12425).
2. `callGemini` (server.js:4078 → ~5929, ~1,850 lines):
   - `instantConversationResponse` (3724) — operational commands only now (greeting/time regexes
     removed 2026-09-13, uncommitted).
   - `agentRepair.prepareTurn` (4447) — deterministic intents (sports_*) with tool blocking.
   - `neuralVault.getContextPack(prompt, 8)` (4450) + Memory vNext canary (4436, ~380 ms).
   - `agentRuntime.prepare` (4545 → server/agent-runtime.js:512):
     - `classifyWithModel` → **keyword `classify()`** (agent-runtime.js:11-156). The model router only
       runs if `settings.semanticRouting === true` — **not set** (settings keys: googleClientId,
       googleRedirectBase, googleTokenExpiry, googleScopes, geminiModel, webhookBaseUrl,
       stablePhoneUrl, updatedAt). So word lists decide intent / action / fresh / personal /
       complexity / bigAsk on every turn.
     - `rewriteForRetrieval` — **model call #1** (router model, ≤4 s) every turn with history.
     - `decidePresentation` — **model call #2** (router model, ≤3.5 s) every turn.
     - tool selection (lexical by default; semantic only if env `JARVIS_SEMANTIC_TOOLS=1`).
     - `memoryStore.search(prompt, 7|12)` keyword memory.
   - Regex gates in callGemini: semantic memory only if prompt matches a pronoun regex (4632);
     weather (4807); screen (4705); saved workflow (4795); compute lane (5337); maps lane (5363).
   - `needsFreshInfo` / route.fresh → **native Google grounding, which strips ALL function tools**
     (5378-5392). Grounding and function tools are mutually exclusive in this code.
   - Main model loop, up to 6 rounds (10 for browser/screen) (5313).
   - Post-processing: `guardUnearnedClaim` (3172) → `enforceEvidenceGate` (3660) →
     `cleanProviderResponse` → `polishPersonality` (server/jarvis-personality.js:173).
   - Writes: memoryStore.ingestTurn, memoryExtractor.push, proceduralMemory.ingestCorrection,
     neuralVault.ingestTurn, memoryVNextShadow.observeTurn, appendConversation — **6 stores**.

Model calls per ordinary turn: rewrite (1) + presentation (1) + main (1-6) + honesty judges (0-3,
`replyOverclaims` / `replyClaimsTheOwnersScreen` / `replyClaimsAnAction` — each a router-model
fetch, server.js:2972/3032/3094) + extractor every 5 turns. **3 to ~10 calls per message.**

---

## 1. "Replies are short, dry, robotic, not like JARVIS"

| # | Cause | Where |
|---|---|---|
| R1 | Thinking is **minimal** on Eco (phone default, desktop default) — `resolveCortexExecution` sets `thinkingLevel: "minimal"` for cost-guarded, `medium` for balanced, `high` only for Max | server/gemini-models.js:121-133 |
| R2 | `forceModel` is **always** set (main Flash unless Max), which overrides the router's model choice in callGemini (4558) — so "deep → Pro" never happens below Max | gemini-models.js:129, server.js:4558 |
| R3 | `thinkingConfigFor` gives gemini-3 `minimal` unless `route.complexity === "deep"` (keyword-decided); `route.thinkingLevel` is computed but never used | server.js:3835-3853, agent-runtime.js:153 |
| R4 | `maxOutputTokens` default 2600 (3500 bigAsk, 4500 deep); thinking shares the output budget on thinking models | server.js:5431 |
| R5 | **Hard 12 s abort per model call** (Pro: 115 s) — a long streamed answer is killed mid-stream | server.js:5330 |
| R6 | Personality spec teaches terse replies ("Done. The project is open.", "Evening. What do you need?") | server/jarvis-personality.js:47-72 |
| R7 | The only profile item: **"remember i like my answers short and punchy"** (personal_profile_items, 2026-09-17) + extracted procedural "User prefers short and punchy answers" — injected as the owner's preference every turn | neural_vault.sqlite |
| R8 | ~127-line system prompt of rules (`brainSystemInstruction`, server.js:2420-2547) incl. one ~2,000-char capability paragraph; rules fight each other and crowd out voice | server.js:2471 |
| R9 | `polishPersonality` replaces whole replies with templates ("Operational and ready. What do you need?", "That didn't complete. …") and rewrites em-dashes | jarvis-personality.js:121-194 |
| R10 | Evidence gate replaces a good answer with a canned refusal when `needsFreshInfo` fires ("I can't confirm that current information…") — open-defects register says it over-fires | server.js:3683-3700 |
| R11 | Error text leaks to the owner raw: "Gemini could not complete that request: <error>" | server.js:5888 |
| R12 | Recovery path answers with `summarizeVerifiedToolResults` ("stage render ran") when the model call fails after tools | server.js:5818-5880 |
| R13 | Only the last **8** history turns reach the model (6,000 chars each) | server.js:4604-4607 |

## 2. "Formatting is wrong, random asterisks everywhere"

- Stored final replies ARE valid markdown (checked conversation.json raw: bullets on their own
  lines, bold paired). Both live renderers are fine: phone `Thread.tsx` uses `JarvisMarkdown`
  (react-markdown + GFM + a streaming-repair pass); desktop `JarvisUI.tsx` snaps to the final text
  on `done` (697). **Correction:** `SimpleApp.tsx` keeps raw streamed text (1171) and does not
  render markdown, but it is NOT the loaded app (`src/main.tsx` renders `JarvisUI`).
- Proven sources of visible mess:
  - F1 `readGeminiStream` emits every text part as a delta immediately (3867-3919), including
    preamble text from rounds that end in a function call — streamed text = all rounds glued.
  - F2 A 12 s abort mid-stream (R5) falls to the next ladder model, which streams the answer again
    — the half answer (often with an unclosed `**`) stays on screen until `done`.
  - F3 `guardUnearnedClaim` appends whole "Correction: …" paragraphs to correct answers
    (3190/3210/3213/3231) — real example in conversation.json ("Correction: apex price history
    did not actually complete…").
  - F4 Plumbing excuses in replies ("our direct historical price feeds are currently offline").
- Not reproduced: an asterisk mess that persists after a reply finishes. Need one screenshot.

## 3. "No memory / recall wrong"

- M1 Profile tables empty: user-context facts 0, goals 0; `personal_profile_items` = 1 row
  ("short and punchy"). Nothing but `recordLocationStatement` writes the profile.
- M2 Fact extractor (server/memory-extractor.js) **does run** (33 facts, source
  `extractor:session`) — **correction** of an earlier guess — but writes to `ms_memories`, not the
  profile, and reads BOTH speakers' text, so JARVIS's own words become "facts about the user".
- M3 Memory is **polluted**: apparent test-prompt facts ("job interview tomorrow", "stressed about
  exams", "coding 9 hours", "Tokyo trip $2,000", "rent vs buy at 7%", "Python list dedup",
  "process vs thread"), a JARVIS hallucination stored as a user fact ("User is involved in building
  a Google Workspace or Canvas API bridge"), and honesty-guard text stored as memory ("apex price
  history task is incomplete").
- M4 Extractor buffer is in-memory, fires every 5 turns per session, lost on restart.
- M5 Recall = keyword `memoryStore.search` (7/12) + vault context pack (8) + vectors ONLY when the
  prompt matches a pronoun regex (4632) + vNext canary. Four overlapping paths, no facts-first.
- M6 `neural_vault.sqlite` has **73 tables**; overlapping systems (memories, ms_memories,
  memory_objects 55, personal_profile_items, episodes 0, procedures 0, memory_os_entities 0…).
- M7 Totals 2026-10-20: memories 132 (episode 59 + episodic 39 = raw turns), ms_memories 65.
  Newest memory 2026-09-21 — the assistant has not been used in a month.

## 4. "Can't send agents to work and see status"

- A1 `agent_deploy` (capability-engine.js:3343 → skill-autopilot.js:183) creates a mission row.
- A2 Missions DO execute: `missionEngine.setExecutor` (server.js:15371) → ReAct loop or `callGemini`.
- A3 **Nothing reports back**: no chat message, no push when a mission finishes; results sit in
  jarvis-missions.sqlite.
- A4 Coordinator always spawns the same 3 generic children (research/analysis/verification)
  (mission-engine.js:244-275).
- A5 Three separate agent systems: mission engine, deployable-agents, ECLIPSE. ECLIPSE (the
  strongest, with a live SSE status stream) is reachable from the desktop model picker
  (`model === "eclipse"`, JarvisUI.tsx:624) but **no chat tool can launch or query it**.

## 5. "No initiative — never tells me things, no ideas, no 'your bot is back'"

- P1 `server/proactive-intelligence.js` is a stub: no model call anywhere. "Unresolved loops" =
  fixed `hybridSearch("todo will research follow up")` + regex filter. Anomaly alerts computed and
  discarded. 8 am push body: "Jarvis is ready." Last brief 2026-09-21: empty.
- P2 Push requires `device.pushSubscription`; no subscription file exists on this PC.
- P3 Never reads calendar, tasks, projects, bots, markets, or mission results.

## 6. "Attach my projects and control them"

- J1 `search_projects` scans only `WORKSPACE_ROOT = path.resolve(ROOT, "..")` = `D:\jarvis`
  (server.js:160, 6045). Dev's projects in `D:\crypto trading\` (cryptobot, hyperliquid-bot,
  quant project) are invisible.
- J2 `open_project` only opens the folder in Explorer. No start/stop/status/logs per project.
- J3 Vault `projects` table: 1 seeded row (Jarvis), no root paths.

## 7. "Lag / takes too long"

- L1 Two serial-ish pre-calls (rewrite ≤4 s, presentation ≤3.5 s) before the answer.
- L2 vNext canary ~380 ms + context pack ~490 ms + repair ~205 ms prep (comment at 4431).
- L3 Honesty judges run AFTER the answer, before `done` (up to 3 router calls).
- L4 Ladder retries restart the whole answer (R5/F2).
- L5 Grounded `web_research` ~24 s (comment 4848).

## 8. "Credit usage"

- C1 Only ONE call site is metered: server.js:5502 (main answer). Unmetered: rewrite,
  presentation, honesty judges, memory extractor, research-v2, research-orchestrator,
  universal-browser-agent, computer-use, react-loop, email-composer, attachment-reader,
  gmail-reader, helix-pipeline, agent-runtime.
- C2 Thinking tokens (`thoughtsTokenCount`) not priced; grounding fee (~$0.035/request) not added.
- C3 No budget cap by design ("track, don't limit").
- C4 Pricing table has no Gemini 4 Argon / 3.8 entries.

## 9. Gemini 2.5 retirement (listed for 2026-10-20)

- FALLBACKS main = [2.5-flash, 3-flash-preview, 3.1-flash-lite]; reasoning = [2.5-pro, 2.5-flash,
  3-flash-preview] (server/gemini-models.js). Retired rungs = wasted retries, not outages.
- `universal-browser-agent.js:63` PLANNER_SPEED_ORDER starts with 2.5-flash → every browser task
  pays one failed call first.
- attachment-reader / email-composer / gmail-reader / research-orchestrator use 2.5-flash only as a
  last default after `settings.geminiModel` (3.5-flash) — low risk.
- Not yet confirmed whether Google actually switched 2.5 off (models.list is free to check).

## 10. Other regex / hardcoding (LAW 0) on the hot path

agent-runtime.js `classify()` (whole router), `browserTask`/`screenTask`/`meshTask`/`forgeTask`
(525-529), execution-lane suppression regexes (591-614); server.js widget fast-paths
(12282, 12327-12385), image gate (12425), pronoun memory gate (4632), weather (4807), screen
(4705), workflow (4795), compute (5337), maps (5363), mesh preflights (4981-4986), honesty
`honestBoundary` regex (3687), agent-repair sports intents.

---

## Proposed new system (for Dev's approval before building)

1. **Model decides, not word lists.** Remove keyword routing from the decision path; the brain gets
   a retrieved tool menu (semantic retrieval on by default) plus a function-based web search tool,
   and chooses. (Check: whether current Gemini models allow native search grounding together with
   function tools — if so the grounding/tools split disappears entirely.)
2. **Real thinking, room to answer.** Thinking on by default (dynamic/medium), Max = Gemini 4 Argon
   or 3.1 Pro high; output budget sized for thinking; replace the 12 s kill with a first-token
   timeout + generous total; never restart after text has streamed; drop 2.5 from all ladders.
3. **One voice.** Short identity + JARVIS voice with rich examples + the living profile; move
   tool-specific rules into tool descriptions; delete template replacements; honesty problems fixed
   by a rewrite pass, never an appended "Correction:"; no raw errors or plumbing excuses.
4. **Real memory.** Owner-only extraction into the profile (facts, goals, preferences, projects,
   people) with confidence + supersede; facts-first retrieval every turn (no pronoun gate); longer
   history + rolling summary; collapse redundant write paths; clean polluted rows (Dev approves the
   list).
5. **Initiative.** A real background loop (model-driven) over profile, conversations, calendar/
   tasks, missions, projects, markets → 0-3 things worth saying → phone push / waiting message;
   morning + evening briefs; agent-finished notices.
6. **Agents with status.** Chat tools to launch / check / stop ECLIPSE missions and mission-engine
   agents; completion pushes back to Dev.
7. **Projects.** A project registry (path, start/stop/status/logs/health) covering D:\jarvis and
   D:\crypto trading; tools to check and control them (approval for start/stop); watcher feeds #5.
8. **Cost.** One wrapper around every Gemini call: meter everything (incl. thinking + grounding),
   daily budget with warnings, cut the 2 pre-calls and 3 judge calls down to what's needed.
