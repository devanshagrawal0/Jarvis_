# JARVIS "how it talks / decides" — full pipeline audit

Goal: find every bug, logic gap, and prompt issue that makes JARVIS reply like a robotic dead AI —
no awareness, no proactiveness, deflecting to the Stage, routing market/crypto to APEX/Kalshi/rooms
instead of just searching the web, answering-then-retracting, leaking internal junk. Then redo the
pipeline so the basics are right.

## Observed symptoms (measured 2026-09-17, 15-question audit + owner reports)
- Asked "btc prices" → showed wrong "btcp" data, then on a re-ask opened **Kalshi** instead of just
  searching the web. It keeps routing to **APEX/Kalshi/rooms** instead of plain web research.
- "how's the stock market", "plan a tokyo trip", "what time is it" → deflects to a **Stage panel**
  and puts **no answer in the text** (dead on phone — no Stage there).
- Answer-then-retract: full confident answer, then "Correction: nothing actually read that…".
- Leaks internal junk: fake citation tokens like `[2.3.5]`; raw tool-error dumps as the reply.
- Hard question ("kalshi vs polymarket") → "Gemini exceeded the 22000ms response budget".
- Overall: robotic, no personality, no proactiveness, no awareness — "the orb talks better".

## SECTION A — server.js brain path (owner: Claude, this session)

**A1 — Stage deflection is FORCED, and the model is told NOT to write the answer in text. [worst]**
- `server.js:4671-4685` — when the presentation classifier returns `form="surface"`, the code force-ADDS `stage_render` and drops `ui_open_widget`.
- `server.js:4805-4810` — injects: *"The owner wants to SEE this one, not be told it… your sentence should point at the surface rather than repeat what is on it… if you notice yourself about to write the figures, that is the moment to draw them instead."*
- Effect: "how's the market", "plan tokyo", "what time is it" → the model draws to the Stage and writes only "it's on the Stage panel." The actual answer never lands in text.
- ROOT: the design treats a "surface" turn as REPLACING the text answer. Fix: the reply must ALWAYS contain the full answer in text; the Stage is additive, only when the owner explicitly asks to see/draw AND a Stage exists. Delete the "don't write the figures" instruction.

**A2 — Phone turns still get force-rendered to a Stage that doesn't exist.**
- `server.js:12282` `fromPhone = data.surface === "phone"` only routes UI actions to the PC; the presentation gate (A1) still forces `stage_render` on phone turns → the phone gets a text-less "it's on the Stage" for a Stage it has no way to show. Fix: for `surface:"phone"`, never force stage_render; always answer in text.

**A3 — Answer-then-retract: honesty judges bolt a "Correction:" onto a finished answer.**
- `server.js:3179-3180` appends *"Correction: none of that happened on your screen…"*; `server.js:~3189` appends *"Correction: stage render did not actually complete."*
- These run AFTER the model already wrote a confident answer — which A1 pushed it to do (claim the Stage). The two systems fight: A1 makes it claim a surface, honesty retracts it. Fix A1 and most of this whiplash disappears; keep the corrector only for genuine fabrication.

**A4 — Error-dump-as-answer.** `server.js:2836-2918` `summarizeVerifiedToolResults` replaces the reply with a raw bulleted tool-status dump (*"I didn't complete that, only these read-only checks ran: - apex ticker report ran - stage_render failed: The Stage needs some blocks…"*) when a tool failed, nothing effective succeeded, and the model claimed completion (the nvidia case). Intent (don't fake success) is right; the output is robotic and leaks internals. Fix: on tool failure it should ANSWER from web grounding (it has that lane) or say in ONE natural sentence it couldn't pull it — never dump tool lines.

**A5 — The 22s budget returns the raw error AS the answer.** `server.js:286-288` clamps the budget to [8s, 30s] (default ~22s). On exceed, the turn surfaces *"Gemini exceeded the 22000ms response budget"* as the reply (kalshi-vs-polymarket). Fix: on exceed, return the partial/streamed answer or a single-shot fallback — never the raw budget error.

**A6 — Fake citation tokens leak into text.** grounding rendering near `server.js:3248` (groundingChunks) emits internal chunk indices like `[2.3.5, 2.3.7]` into the reply (weather answer). Fix: render citations cleanly or strip; never emit raw chunk-index tokens.

**A7 — Sprawling, self-contradictory system prompt.** `server.js:2411-2550+` is 90+ imperative rules grown across waves; some conflict (e.g. "reply in text OR draw on the Stage" is what enables A1). Decent persona buried in noise. Fix: consolidate to a tight, prioritized persona+behavior prompt with "always answer in text" near the top.

**A8 — No proactiveness / awareness.** The prompt bans filler/hedging but nothing rewards JARVIS-style anticipation (notice the likely next need, offer the obvious next action). With A1's deflection on top, replies feel dead. Fix: add a measured proactiveness directive (anticipate + offer the next step), not filler.

## SECTION B — routing / tools / honesty modules (sub-agent findings)

Pipeline: `classify()` → tool retrieval (`selectTools`/`selectToolsSemantic`) → execution-lane union → presentation router (form) → surface-tool gate → model call → honesty guard. **The BTC bug is born in tool RETRIEVAL, not classification** — classify() correctly marks "btc prices" as `fresh-information`; the tools handed to the model are wrong.

**B1 — Market/crypto tools out-rank `web_research`; no guarantee of web grounding for a public price/"how's X" query. [ROOT of BTC→APEX/Kalshi]**
- `server/tool-gateway.js:134-144` — `scoreTool` is pure lexical (`matches*4`, `+12` if query contains the tool name). `capability-engine.js:604` `apex_ticker_report` description literally lists "BTC"; `:611` `apex_price_history` says "bitcoin this week"; `:472` `kalshi_market_discovery` fuzzy-matches. `web_research` (`:480`) is generic ("current/live web question… citations") with NO price/stock/crypto/market token → scores ~0 → never in the top-8. Model can only pick from what it's handed. "btcp" wrong data = kalshi fuzzy-expanding "btc" to a contract ticker; "opened Kalshi" = the kalshi widget/apex room tools were on the menu.

**B2 — The semantic path drops the web-research safeguard.** `tool-gateway.js:325-326` (legacy `selectTools`) pushes `web_research` into `alwaysUseful` for price/news/weather; but `selectToolsSemantic` (`:149-206`, used when `JARVIS_SEMANTIC_TOOLS=1`, `agent-runtime.js:544-570`) returns `slice(0,limit)` with NO alwaysUseful merge — the safeguard is bypassed in the "smarter" mode.

**B3 — Companions hard-link `apex_price_history` ↔ `stage_render`.** `tool-gateway.js:51,67` — picking APEX bars promotes the Stage tool beside it → "fetch bars + draw panel", crowding out web_research and feeding the Stage-deflection.

**B4 — Presentation router "SHOW WINS" + told not to write the answer.** `agent-runtime.js:443-492` (`:455` "choose SURFACE") → `server.js:4671-4685` force-adds stage_render → `4808-4810` "point at the surface… don't write the figures." No floor guaranteeing a text answer if the panel fails. (= my A1.)

**B5 — "Correction:" retractions are downstream symptoms.** `tool-result-honesty.js:48-66` + `server.js:3162-3221` (`guardUnearnedClaim`) append "Correction: nothing actually read that…" when a tool failed but the model answered anyway. Correct logic reacting to the mis-route; the append-a-trailer presentation is itself much of the "robotic, answers-then-retracts" feel. Fix should retract-and-REDO (retry with web), not retract-and-append.

**B6 — `classify()` is a big regex wall** (`agent-runtime.js:11-156`) — the banned keyword-pre-route pattern; `fresh` keys off the literal word "price" (`:100`), so "how's bitcoin doing" (no price token) falls to `conversation`. Lean on the semantic router + scope tags instead.

**B7 — Tool descriptions are a keyword-gaming game.** `capability-engine.js:602-614` — APEX tools each hoard market vocabulary; `tool-gateway.js:540-543` literally calls it "keyword bait to game the LEXICAL scorer." Anti-pattern.

**B8 — APEX answers a PUBLIC spot-price question from the trading-room's stored bars** (`capability-engine.js:604,700`) — the owner-data vs public-web boundary is invisible to the model.

**B9 — 8-tool cap crowds out web_research.** `agent-runtime.js:561-564` — market tools + companions fill 8 slots before any public-web tool; the fix must RESERVE a slot, not append (append is truncated by `slice(0,limit)`, `tool-gateway.js:205`).

Key files: `server/tool-gateway.js`, `server/agent-runtime.js`, `server.js`, `server/capability-engine.js`, `server/tool-result-honesty.js`.

## SECTION C — how the best assistants actually do it (web research, 2026-09-17)

**isair/jarvis** (a well-regarded private talking JARVIS — the quality bar Dev wants):
- **Adaptive tone lives in the prompt**: "surgical for code, pragmatic for business, encouraging for wellbeing" — one persona that adapts, no mode switching. (Ours: persona buried under 90 contradictory rules → A7.)
- **Embedding-based tool filtering**: loads ONLY the tools relevant to the query, per turn. (Ours: force-ADDS stage/room tools → A1. Opposite of best practice.)
- **Web-search fallback CHAIN** as the default for facts: DuckDuckGo → Brave → Wikipedia → honest failure, **no confabulation**, ~20s deadline with graceful fail. (Ours: routes market/price/news to APEX/Kalshi/rooms instead of just searching — the BTC→Kalshi bug.)
- **Tool-result "digest" pass**: raw web/tool payloads are summarized into "short attributed fact notes" BEFORE the reply model sees them. (Ours: raw tool output + `[2.3.5]` citation tokens leak straight into the reply → A4/A6.)

**when2tool — Probe&Prefill (lilywenglab / arXiv 2605.09252):**
- Core finding: LLM agents **call tools indiscriminately even when they can answer directly**; models already "know" internally when a tool is needed. Prompt-only suppression is crude and kills necessary calls too.
- Actionable for us (Gemini API, no hidden states): a cheap, well-calibrated **answer-vs-tool router with explicit negative guidance** ("when NOT to call a tool"), and route the *reasoning path* (direct answer vs tool) — 48% fewer junk tool calls at ~1.7% accuracy loss. (Ours: the presentation/router over-picks surface/room tools → A1 + BTC→Kalshi.)

**Proactive-assistant research (ProPerSim, Alpha-Service "Know When / Know How"):** proactivity must be *personalized* — anticipate the likely next need and offer it, but only when it fits. (Ours: none → A8.)

### What this says to build (research-backed, not guesses)
1. **A real default web-search lane** for any factual/price/market/news/weather/"how's X" question — grounding/search FIRST, never a room/widget/APEX tool unless the owner explicitly asked to open one.
2. **Filter tools by relevance per turn; stop force-adding** stage_render/room/widget tools.
3. **Always answer in text**; a surface (Stage/widget) is additive and only on explicit "show/draw/open" + a surface that exists (never phone).
4. **Digest tool results → attributed fact notes** before the reply; never leak raw output or chunk tokens.
5. **Tighten persona** to one adaptive-tone directive + measured proactiveness; cut the contradictory rule pile.
6. **Graceful degradation** on budget/tool failure — answer with what you have or say it plainly in one sentence; never surface a raw error/tool dump.

## ROOT CAUSES (synthesis)

1. **Tool retrieval has no concept of tool AUTHORITY/SCOPE.** Selection is lexical keyword overlap, so APEX/Kalshi tools (which hoard market/crypto vocab) beat the generic `web_research`, and the public-web fallback is dropped by the semantic path + crowded out by the 8-tool cap + companions. → BTC→Kalshi, "won't just search the web". (B1,B2,B3,B7,B8,B9)
2. **A "surface" turn is allowed to REPLACE the text answer.** The presentation router picks SURFACE and the model is instructed not to write the answer → dead on phone, deflection on laptop. (A1,A2,B4)
3. **Honesty guard retracts-and-appends instead of retract-and-redo**, turning mis-routes into "answer then Correction:" whiplash + raw tool dumps. (A3,A4,B5)
4. **Junk leaks + no digest** — raw tool output and `[2.3.5]` citation tokens reach the reply. (A4,A6)
5. **Persona is buried under 90 contradictory rules; no proactiveness; brittle regex classify().** (A7,A8,B6)
6. **No graceful degradation** — budget/tool failure surfaces raw errors. (A5)

## FIX PLAN (ordered, root-level, no regex band-aids)

**FIX 1 — "just search the web" (tool authority + reserved web slot). [start here, Dev's #1]**
- Add a model-visible `scope` to every tool declaration: `"public-web"` (web_research, research_v2, url_read, weather, maps…) vs `"owner-account"` (apex_*, kalshi_*, atlas_*, calendar_*, email_*…).
- One shared post-selection step (used by BOTH `selectTools` and `selectToolsSemantic`) that, for any `route.fresh` turn, RESERVES a slot for a public-web tool (never truncated).
- One system-prompt line: "APEX/Kalshi read the owner's OWN trading data; for a public price/quote/'how's X doing' use web grounding unless he named APEX/Kalshi/his portfolio."
- Delete the description keyword-baiting and the sports-only web_research special-case.
- PROVE: re-run the 15-Q audit; "btc price", "how's the market", "nvidia news" answer from web in text, no room opens.

**FIX 2 — always answer in text; Stage is additive.** Remove the "don't write the figures" instruction (`server.js:4808-4810`); require a substantive one-line text answer always; never force stage_render on `surface:"phone"`; demote surface bias for single-value lookups.

**FIX 3 — retract-and-redo, digest tool results.** When the guard catches an unearned claim, retry with the correct public-web tool instead of appending "Correction:"; add a digest pass so raw output/`[2.3.5]` tokens never reach the reply.

**FIX 4 — persona + proactiveness + graceful failure.** Consolidate the 90-rule prompt into one tight adaptive-tone persona + measured proactiveness; on budget/tool failure answer with what exists or one honest sentence, never a raw error.

Each fix is verified by re-running the 15-question audit (`_newpc/reply-audit.txt`) and showing before/after.
