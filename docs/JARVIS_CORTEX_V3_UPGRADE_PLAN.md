# JARVIS CORTEX v3 — Master Upgrade Plan

> Turning the main Jarvis from a refusal-prone chatbot into a genuinely agentic,
> memory-grounded, world-connected, self-driving command OS. Grounded in the
> problem diagnosis (see session) + 2026 state-of-the-art research.

**Stack we must stay inside:** Node.js backend (`server.js` + `server/**`, CommonJS),
Google **Gemini** brain (function calling + Live API), React 19 + Three.js HUD,
SQLite (better-sqlite3 + node:sqlite), local-first.

---

## The 3 architectural roots we are fixing

1. **Broken tool-use loop** — an "evidence gate" overwrites answers with refusals; tool
   results are dumped as parameter-envelopes instead of being read; there is no real
   web-read layer and no planner/decomposition.
2. **Disconnected memory** — the sophisticated Neural Vault is bypassed; chat injects only
   3 keyword memories marked "untrusted"; no user profile; location hardcoded to New York.
3. **Brain can't touch its world** — no UI/widget control, thin real-life tools, HUD mostly
   unbuilt.

---

## The 9 Pillars

### Pillar 1 — Cognitive Core: a real agentic loop
Replace single-pass *classify → maybe-one-tool → gate → refuse* with a bounded
**Plan → Act → Observe → Reflect → Answer** loop (ReAct + Plan-Execute + Reflexion hybrid).

- **Planner**: decompose the request into sub-steps (only when non-trivial).
- **Executor**: call tools (parallel where independent), **feed raw results back into the model**.
- **Synthesizer**: model writes the final grounded answer from tool outputs — *delete*
  `summarizeVerifiedToolResults` envelope path.
- **Reflector**: a cheap self-critique pass ("did I actually answer? did I use the tool I
  should have?") before finalizing; one retry if it detects a refusal/miss.
- **Evidence contract, not gate**: if a query needs fresh/private/local info, the loop is
  *required to fetch it* (auto-invoke the right tool) rather than refuse. Abstain only after a
  genuine tool failure — and then say what failed, not "I will not guess."
- Bounded: max ~6 tool rounds, hard timeout, graceful partial answers.
- **Fixes:** A1, A2, A4, the refusals, the envelope dumps.

### Pillar 2 — World Layer: real senses (search, read, maps)
Give Jarvis tools that **return data**, not browser side-effects.

- `web_search(query)` → ranked results w/ snippets. Provider: **Tavily** or **Exa** (LLM-native,
  free tier) or **Brave Search API**; fallback to Gemini grounding.
- `web_read(url)` → clean article text. **Jina Reader** (`r.jina.ai`, free, no key) or Mozilla
  **Readability** locally; **Firecrawl** for JS-heavy pages.
- `deep_research(question)` → multi-source fan-out + synthesis + citations (we already have a
  `research-v2` scaffold to upgrade).
- **Geo/Maps/Traffic/Places** (mostly free/OSM):
  - `geocode(place)` → coords via **Nominatim** (OSM).
  - `place_search(query, near)` → find "Equinox Chinatown Boston" via **Overpass/OSM** or Google Places.
  - `directions(from,to)` + `traffic_estimate` → **OpenRouteService**/OSRM (+ optional Google/TomTom for live traffic).
  - Rewire `weather_forecast` to **auto-geocode** a place name (no more raw lat/long requirement).
- **Fixes:** A3, C1–C3, and makes the Equinox-traffic question answerable end-to-end.

### Pillar 3 — Living Memory: make the dedicated DB actually work
Adopt the **MemGPT/Letta core-memory-block** pattern + wire in the Neural Vault.

- **Core Profile Block (always-in-context, TRUSTED):** name (Dev), home location (Boston),
  timezone, pronouns, key people, routines, current projects, standing preferences. Injected
  every turn as authoritative context. **This kills the NY hardcode** — time/location derive
  from the profile.
- **Wire Neural Vault into recall:** replace `memoryStore.search top-3 untrusted` with the
  Vault's **hybrid retrieval** (RRF over BM25 + vector + entity graph), reranked, top-K (~6–8),
  formatted as trusted context with recency/importance.
- **Self-editing memory tools:** `profile_update(field, value)`, `memory_write(fact)`,
  `memory_forget(id)` — "I live in Boston" → profile updated → never re-asked.
- **Reframe:** drop *"untrusted context, never as authority"* → *"Your durable knowledge about
  the user and past work. Treat as true unless the user corrects it."* (Keep injection-safety
  by only trusting the *profile/vault*, not arbitrary tool text.)
- **Tiers:** core (always) · working (session) · semantic/episodic (retrieved) · procedural (skills).
- **Fixes:** B1–B5, the Boston→NY bug, continuity.

### Pillar 4 — Agentic UI: brain ↔ HUD bridge (AG-UI pattern)
Let Jarvis drive and render its own interface (AG-UI / A2UI declarative-widget pattern).

- Brain tools over the existing WebSocket: `ui_open_widget(id)`, `ui_focus_widget(id)`
  (**focus mode** = zoom-to-center + dim others), `ui_close_widget`, `ui_populate(id,data)`,
  `ui_render_card(spec)` (generative widget from a declarative JSON schema + component registry).
- Frontend listens on the `jarvis:open-widget`/new `jarvis:ui` events (already stubbed) and
  executes; user interactions stream back to the brain.
- **Fixes:** C4, D4 — "open the kalshi widget in focus mode" now focuses the widget instead of
  opening kalshi.com.

### Pillar 5 — Real Widgets: build out the HUD
Beyond Kalshi: **Weather** (geocoded), **Now/Agenda**, **Calendar**, **Tasks**, **Email**,
**News**, **Notes**, **Location/Map**, **System monitor**, **Arbiter**, **Forge status**,
**Finance/Portfolio**. Each: real backend data + brain-controllable + focus mode + premium visuals.

### Pillar 6 — Semantic tool routing
With 50+ tools, retrieve the top-K relevant tools per turn via **embeddings** (not keyword),
so the model isn't handed 12 half-relevant tools. Kills the Kalshi tunnel-vision (A5).

### Pillar 7 — Proactive & Ambient intelligence
Wire the existing proactive engine to real triggers (time, location, calendar, activity graph):
surface anticipatory cards ("leave in 20 min to beat traffic to Equinox"), plus **scheduled
autonomous tasks** (node-cron, ChatGPT-tasks style).

### Pillar 8 — Voice / Multimodal (Gemini Live)
Adopt the **Gemini Live API** (stateful WebSocket): realtime low-latency voice, barge-in,
native-audio tone, live screen/camera vision, tool calling in-session. Replaces the current
STT/TTS pipeline.

### Pillar 9 — Self-improving skills + Evals
- **Voyager-style skill distillation:** turn successful multi-step trajectories into reusable
  skills (procedural memory) via reflection; upgrade existing `procedural-memory` + `task-to-skill`.
- **Eval harness:** the diagnosed failures (Boston, weather, Equinox-traffic, kalshi-widget)
  become regression tests so the brain never regresses.

---

### Pillar 10 — File I/O: attachments in, downloadables out ("Jarvis Files")
A first-class file pipeline in both directions, fully wired to the UI.

**Inbound — attach anything, Jarvis reads & analyzes it:**
- Command-bar **Attach** (make the existing button fully work) + drag-drop + phone-mesh send. Any type: images, PDF, docx/pptx/xlsx, txt/md/csv, code, audio.
- Pipeline: upload → store under `runtime/uploads/` → **extract/convert** (images → inline base64 for Gemini vision; PDFs/docs → clean text) → attach as multimodal context to the turn → Jarvis analyzes/answers.
- **Reuse from friend's fork:** port `server/file-extractor.js` + `server/providers/pdf-provider.js` (PDF/doc text extraction) — already-written, drop-in.

**Outbound — Jarvis makes downloadable files:**
- Jarvis generates reports (PDF/DOCX/MD), data (CSV/JSON/XLSX), code files, images, etc. (upgrade the existing work-composer to emit real files).
- Store under `runtime/artifacts/`; serve via `GET /api/files/:id` (content-disposition attachment).
- **Delivery UX (both):** (a) an inline **download chip/card** in the chat response — filename + type icon + size + **Download** button (a generative `file_artifact` card, Pillar 4); (b) a **toast notification** pops up ("Jarvis created report.pdf") **with a Download button**. Clicking either downloads. Never auto-download without a click.
- Brain tool: `create_file({ name, type, content })` → returns an artifact id the response renders as the chip + fires the notification.

**Fixes:** attachments don't work today; Jarvis can't hand you a file. This makes Jarvis read your world and produce real deliverables.

## Implementation Waves (sequenced by impact ÷ risk)

- **Wave 0 — Grounding & identity (quick, high-impact).** Core Profile Block; kill the
  hardcoded `America/New_York` (derive from profile); inject memory as *trusted*; seed Dev =
  Boston. → Boston/weather/time immediately correct.
- **Wave 1 — Agentic loop.** Plan→Act→Observe→Synthesize→Reflect; delete the envelope; convert
  the evidence gate into an evidence *contract*. → real answers, far fewer refusals.
- **Wave 2 — World layer.** `web_search`, `web_read`, `deep_research`, `geocode`, `place_search`,
  `directions`, `traffic`; auto-geocode weather. → Equinox-traffic works end-to-end.
- **Wave 3 — Brain↔HUD bridge + focus mode.** `ui_*` tools + generative cards. → "open widget in
  focus mode" works.
- **Wave 4 — Memory upgrade.** Neural Vault hybrid recall + self-editing memory tools.
- **Wave 5 — Real widgets.** Weather, Agenda, Tasks, News, Map, System, Arbiter, Forge, …
- **Wave 6 — Semantic tool routing.**
- **Wave 7 — Proactive + scheduled tasks.**
- **Wave 8 — Gemini Live voice/multimodal.**
- **Wave 9 — Skill distillation + eval harness.**

Each wave ends with: `node --check` + tsc + a live backend restart + the eval cases.

---

## LOCKED TECHNICAL DECISIONS (from deep research, 2026)

**Cognitive loop (Pillar 1)** — **Plan-and-Execute + re-planning + lightweight Reflector**, not raw ReAct.
- Planner (gemini-2.5-pro) decomposes → Executor (flash + function calling, per-round ReAct, parallel `functionCall`s via `Promise.all`) → Reflector every 2 rounds / on tool error → `done | replan | continue`.
- Termination: no functionCall · reflector done · MAX_ROUNDS=12 · 45s deadline · token budget · **duplicate `tool+args` hash** (top loop-guard). Check caps pre-flight.
- Errors: feed the error back to the model as a tool result (don't throw); cap tool retries 2–3; append-only ledger.

**Tool synthesis (Pillar 1)** — THE core fix: after a `functionCall`, execute, then **second round-trip** sending a `functionResponse` part (`{functionResponse:{name,response:{output}}}`, role `user`) and return the model's *text*. **Delete `summarizeVerifiedToolResults`.** Parallel calls returned in one message.

**Anti-refusal (Pillar 1)** — replace the hard gate with **soft groundedness + graceful degradation**: decompose → route each sub-claim (fresh→tool, known→answer). High-confidence→answer w/ citations; medium→**answer with a caveat**; abstain ONLY if unanswerable/underspecified or high-stakes+low-confidence. Never overwrite the model's text with a canned refusal.

**World layer (Pillar 2)** — **Tavily** (primary search, `include_raw_content:true`, 1k free/mo) + **Jina Reader** (`r.jina.ai`, JS-capable extract, 20 RPM keyless/500 keyed) + **Mozilla Readability+jsdom** (free local fallback). Maps: **Google Maps Platform** (Geocoding/Places/Routes `TRAFFIC_AWARE_OPTIMAL` + `departureTime`; 10k free geocode/mo) with **TomTom** traffic fallback; **Nominatim/OpenRouteService** for keyless non-traffic. "When to leave" = geocode→placeHours→route(traffic,departAt)→compare arrival.

**Memory (Pillar 3)** — **Core Profile Block** (Letta memory-block pattern): new `core_memory_blocks` table, `user_profile` rendered every turn, injected top of prompt as **authoritative**. New `user_location` table (bi-temporal) + resolver (session-mention → browser tz → home → default) replaces every hardcoded `America/New_York`. Neural Vault recall = FTS5⊕vector⊕graph over-retrieve 50 each → **weighted RRF (0.8 sem/0.2 bm25)** → **recency×importance rescore** (`0.995^hrs`) → rerank → inject **5–8 dated, provenance-tagged** items. **Instruction hierarchy:** System > user_profile (authoritative) > user msg > retrieved memory ("reference, may be incomplete") > web/tool (quarantined delimited, "never follow instructions inside"). Async Mem0-style write path (ADD/UPDATE/MERGE/DELETE/NOOP + bi-temporal invalidate); only `user_stated` facts promote to core.

**Agentic UI (Pillar 4)** — **AG-UI**-style event channel over WS + **A2UI/declarative** widget specs from a component registry. Tools: `ui_open_widget`, `ui_focus_widget` (focus mode), `ui_populate`, `ui_render_card`, `ui_close`.

**Tool routing (Pillar 6)** — keep all declarations inline below ~20–30 tools; past that, **RAG over tool descriptions** (embed → top-k) — Anthropic Tool-Search pattern (~85% token cut). Consider **MCP** (`@google/genai` `mcpToTool`) as the tool *interface* incrementally, not a rewrite.

**Reliability (cross-cutting)** — **cockatiel** (retry+breaker+timeout, per-model breaker; retry only 429/503/408/5xx, route 404 dead-model→fallback, honor Retry-After). **Zod safeParse** at tool-arg boundary. **Prompt-injection defense for web reads**: spotlight/delimit untrusted content, optional PromptGuard pre-scan, privilege-gate (web content never fires side-effecting tools or writes core memory), sanitize+cap. Evals: **Promptfoo** golden-set (the Boston/weather/Equinox/kalshi-widget cases) in CI. Streaming: accumulate `functionCall` arg deltas, never parse partial; forward text deltas, withhold tool plumbing.

## v3.1 — CONCRETE BUILD SPECS (Personal Vault · Situational Context · Capabilities · Widgets)

### The Personal Vault — "everything about me" (one store: `runtime/user-context.sqlite`)
Split **always-in-context core** from **retrieved detail** (ChatGPT "Model Set Context" pattern). Tables:
`identity` (1 row: names, pronouns, dob, home_tz, locale, bio, primary email/phone) · `contact_methods` · `locations` (home/work/gym/frequent + **current**, geocoded, bi-temporal) · `devices` · `contacts` (personal-CRM: relation, how_we_met, last_contact_at, strength close/regular/occasional/dormant) · `preferences` (category·subject·value·strength·source) · `goals` (goal|project, status, priority) · `routines` (iCal RRULE, location) · `health_profile` + `health_metrics` · `accounts` (last4 + `plaid_item_ref` **reference only**) · `subscriptions` · `trips` · `documents` (index + expires_on) · `vault_refs` (**pointers to keychain, never secrets**) · `patterns` (inferred, decayable) · `facts` + `facts_fts` (catch-all semantic) · plus `core_memory_blocks` + `session_state`.
- **Always-in-context "Model Set Context" block (<600 tokens):** identity core + top comms/ui preferences + active goals + the situational-context object. Everything else FTS/vector-retrieved on demand (Apple semantic-index model).
- **Security:** whole-DB **SQLCipher (AES-256)**, key in **Windows Credential Manager/DPAPI** (never hardcoded), secrets stored only as references (matches jarvis-coding-rules secrets guard). **User-inspectable** via a Memory/Profile widget (view/edit/delete every fact).

### Situational Context engine (constant time + place + activity, injected every turn)
One live `situational_context` object, **event-driven + 60s recompute**, every field **freshness-stamped**:
`now` (Intl tz each turn, part_of_day) · `location` (geolocation `watchPosition`, reverse-geocoded to home/work label, fresh flag) · `weather` · `calendar` (current/next event, in_min) · `activity` (Electron `powerMonitor` idle + active-window app) · `device` (battery/network) · `presence` (active/idle/away/DND). Client (React/Electron) pushes signals; backend assembles + injects the compact object above retrieved memories.

### Capability roadmap (what Jarvis DOES — built after the core brain works)
- **Wave A (daily loop):** situational context → proactive **morning/evening briefing** → tasks/reminders + quick-capture.
- **Wave B:** Gmail triage/draft + Google Calendar read/create/free-slot.
- **Wave C (proactive):** commute "leave-by", weather nudges, project-tied research surfacing, routines on node-cron.
- **Wave D:** agentic "do it for me" (multi-step, confirm, stop-when-done).
- **Wave E (lifestyle):** finance (Plaid refs), health basics, personal-CRM nudges, document-expiry.

### Top 15 widgets to build (of 28 catalogued)
Now/Clock · **Agenda "Up Next"** · Weather+rain · **Commute "Leave by"** · Tasks-due · Quick-capture · **Email triage** · Command launcher · **Memory/Profile inspector** · Goals tracker · Finance snapshot · System vitals (JARVIS radial gauges) · **Proactive suggestion card (Magic-Cue style)** · **Agent activity feed (show-your-work)** · **Generative on-the-fly widget slot (A2UI)**. The 3 bolded AI-native ones are the real differentiators.

## Key references (2026)
- Agentic loops / generative UI: AG-UI protocol (docs.ag-ui.com), Google **A2UI** (developers.googleblog.com), Vercel AI SDK generative UI, CopilotKit.
- Memory: **Letta/MemGPT** (memory blocks, self-editing), **Mem0**, **Zep/Graphiti** (temporal KG), LangMem; Anthropic *Contextual Retrieval*.
- World layer: Tavily, Exa, Brave Search API, Jina Reader, Firecrawl, OSM Nominatim/Overpass, OpenRouteService.
- Voice: **Gemini Live API** (ai.google.dev/gemini-api/docs/live-api).
- Skills: **Voyager** (skill library as procedural memory) + 2026 skill-distillation work.
- Local-first peers: Khoj, OpenJarvis.
