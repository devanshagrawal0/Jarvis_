# JARVIS "The Stage" — Generative UI Master Plan

*A Jarvis-owned, morphing, voice-fused generative UI surface. Grounded in three research streams (two deep-research agents + a dedicated voice/audio study). Design locked; not yet built.*

---

## 0. The Vision

Jarvis doesn't just answer — it **authors and drives a living UI** shaped to the intent. Ask "what's on my calendar," a calendar surface morphs in and it talks you through it. Ask "latest news on X, in detail," a full dossier builds itself — video, text, charts, sources. Say "trade on Kalshi," a live browser cockpit opens, Jarvis navigates to the exact page, narrates each step, and **stops at the buy button for you to confirm**. When there's nothing worth showing, it just talks. It morphs size, shape, and state as it goes, and it speaks while it works.

**Router (three-way):**
1. A **pre-made widget** already covers it → open it and let Jarvis navigate/drive it.
2. Visual, but no widget fits → Jarvis **generates a bespoke surface**.
3. Not visual → **just answer** (a widget where the payoff is low actively hurts).

## 1. Locked Decisions

| Decision | Choice |
|---|---|
| Stage model | **One morphing Stage** now; hybrid/multi-surface later when a task wants two things side-by-side |
| Screen weight | **Jarvis decides** — takeover for heavy/agentic, panel for quick answers |
| Generation | **Block-DSL AND sandboxed code**, both day one. **Blocks lead** (90%+); code is the ~1% escape hatch |
| Narration | **Voice + on-surface text**, synchronized |
| Agentic actions | Navigate live + narrate + **stop at human confirm**. Never auto-execute money/creds/irreversible |
| Quality | Dev is building a dedicated **"UI agent"** that generates + critiques the UI so it looks great |
| Target | **90/100** advancement — never-seen-before, not basics |

---

## 2. The Convergent Architecture (the spine)

Every serious system independently converged on the same shape. This is the backbone.

### 2.1 Registry / block DSL over raw code — the core bet
The LLM emits a **flat, ID-referenced JSON tree of components drawn from a fixed, pre-approved catalog** — never executable code. Google **A2UI** ("agent can only request components from that catalog… client in full control over styling and security"), Thesys **C1** ("composable, spec-based… streams the UI as it's generated, not after"). Google's *consumer* genUI that emits raw HTML/CSS/JS "can take a minute or more" and runs code with no stated sandbox — the cautionary tale. **Blocks default; code is the escape hatch.**
*Sources: [A2UI](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/), [Thesys C1](https://docs.thesys.dev/guides/what-is-thesys-c1), [Google Research genUI](https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/).*

### 2.2 Two-phase generation (reason → format)
Never emit the spec under schema constraint in one pass — strict format constraints cost **10–30% of reasoning quality** (the model is forced to output structure before finishing its thinking). **Phase 1:** free-text "UI plan" (which blocks, hierarchy, data bindings, is the code hatch needed). **Phase 2:** constrained JSON emission of the spec.
*Source: ["Let Me Speak Freely?" arXiv 2408.02442](https://arxiv.org/pdf/2408.02442).*

### 2.3 Constrained decoding to the block schema
Grammar/JSON-schema-constrained decoding (XGrammar / Outlines / provider structured outputs, compiled from Zod→JSON-schema) so the spec is **always** parseable and only references real block types/props. Apply only to the *format* phase (2.2).

### 2.4 Event-stream protocol + client reducer (AG-UI style)
Don't ship one big spec — stream typed events (`SURFACE_START`, `BLOCK_ADD`, `BLOCK_PATCH`, `STATE_DELTA`, `TOOL_CALL_START/END`, `NARRATE`, `SURFACE_DONE`) over SSE/WebSocket into **one client reducer** that applies deltas to a live surface tree. This is what makes live morph + narration interleaving work. **Not** server-rendered component streaming (Vercel paused RSC-genUI in favor of streaming data parts).
*Sources: [AG-UI event types](https://www.copilotkit.ai/blog/master-the-17-ag-ui-event-types-for-building-agents-the-right-way), [LangChain: token streams → agent streams](https://www.langchain.com/blog/token-streams-to-agent-streams).*

### 2.5 Skeleton-first progressive hydration
Emit the **layout skeleton** (block frames with dims) in the first tokens; stream each block's data to hydrate in place. Because the spec is a flat ID list, the shell renders before data resolves → a bespoke surface **feels instant** while the LLM is still writing it. Skeleton frames are already interactive (hover/scroll queue and replay on hydrate).
*Source: Vercel yield-skeleton pattern ([AI SDK 3.0 GenUI](https://vercel.com/blog/ai-sdk-3-generative-ui)).*

### 2.6 The "UI agent" — vision-guided self-critique
Render the surface headless → screenshot → a VLM emits **grounded** critiques ("nav overlaps chart at region X") → patch. ≤2 iterations, quality-gated. Bank every surface that passes the gate as a growing **few-shot "taste library"** (Apple UICoder's automated-feedback self-training) — the Stage gets *more* tasteful the more it's used.
*Sources: [Vision-Guided Iterative Refinement arXiv 2604.05839](https://arxiv.org/pdf/2604.05839), [UICrit](https://people.eecs.berkeley.edu/~bjoern/papers/duan-uicrit-uist2024.pdf), [Apple UICoder](https://machinelearning.apple.com/research/uicoder).*

### 2.7 Morph / motion choreography
- **`layoutId` shared-element (FLIP)** via Motion — matched elements crossfade/translate on the GPU as the surface changes form.
- **View Transitions API** for coarse cross-form snapshots (`document.startViewTransition()`, `view-transition-name` on persistent blocks).
- **Spring physics, not bezier durations** — mid-morph "mind-changes" reroute from current velocity instead of snapping. A single global spring makes every spatial transition feel like one physical system.
- **Curved paths toward consistent screen "homes"** (markets top-left, calendar right) → a stable spatial grammar the user builds muscle memory for.
*Source: [Motion layout animations](https://motion.dev/docs/react-layout-animations).*

### 2.8 The sandbox (the ~1% code escape hatch)
- Cross-origin iframe on a dedicated origin; `sandbox="allow-scripts"` **without** `allow-same-origin`.
- Strict CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'` — **no `connect-src`, no remote `img-src`.** No network, no tools, no secrets, no host-DOM access.
- Parent → child `postMessage({tokens, data})` only (design tokens keep it on-brand); child → parent only typed events the host **re-validates**.
- Watchdog kills on timeout or `securitypolicyviolation`. **Sandpack** for real in-browser JSX bundling; WebContainers only if a full Node runtime is ever needed.
- Threat model: assume the code is hostile — it has no network, no secrets, no bridge, no host DOM.
*Sources: [browser sandbox architecture](https://medium.com/@alexgriss/the-architecture-of-browser-sandboxes-a-deep-dive-into-javascript-code-isolation-2dc337703191), [MDN CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox), [Sandpack](https://www.ctnicholas.dev/articles/how-to-use-sandpack-for-code-demos).*

### 2.9 The live browser cockpit
CDP `Page.captureScreenshot` → JPEG frames over WebSocket with **latest-first frame dropping** + ack-pacing (≤1 frame in flight, so on a stall you see current content, not buffered history). **Input (mouse/keyboard) runs on a separate channel** so clicks dispatch immediately. Narration overlay in the widget. **Freeze-frame confirm gate:** at any submit/buy/send control it freezes the last frame, dims it, floats a native confirm card with exact params + rationale — resume only on explicit human click. Auto-execute is **structurally impossible**.
*Sources: [agent-browser streaming](https://agent-browser.dev/streaming), [OpenAI Computer-Using Agent](https://openai.com/index/computer-using-agent/), [propose-only Kalshi agent](https://www.botforkalshi.com/blog/ai-kalshi-trading-agent-claude).*

### 2.10 Block schema (starting point)
```ts
type BlockId = string;
interface Surface { root: BlockId; blocks: Record<BlockId, Block>; theme: TokenRef; }
type Block =
 | { id; type:"stack"|"grid"|"split"; props:{gap?;cols?}; children:BlockId[] }
 | { id; type:"text"; props:{ md; role:"title"|"body"|"caption" } }
 | { id; type:"chart"; props:{ kind:"line"|"bar"|"candlestick"; dataKey; x; y:string[] } }
 | { id; type:"stat"; props:{ label; valueKey; delta?; trend? } }
 | { id; type:"video"|"webembed"|"map"|"calendar"; props:{ srcKey } }
 | { id; type:"livebrowser"; props:{ sessionId; confirmGate:true } }
 | { id; type:"form"; props:{ fields; submitAction } }
 | { id; type:"code_surface"; props:{ entryKey /* sandbox only */ } };
```
Blocks bind to a streamed `DataBag` via `*Key` fields → render skeleton, then hydrate/patch by id without re-mounting. Every prop Zod-validated; on failure the block **degrades to a `text` block** rather than failing the whole surface.

### 2.11 End-to-end pipeline
`Route (3-way)` → `Gather (parallel tools → DataBag)` → `Plan (free-form)` → `Emit spec (constrained, streamed as events)` → `Render + morph` → `Self-critique (gated)` → `Narrate (sentence-locked to block reveals)` → `Drive (cockpit tasks)`.

---

## 3. The Presentation Router (the brain of the Stage)

One fast LLM call returns `{form, medium, container, autonomy, confidence, why}`.

**Signals:** intent-class (action/lookup/explanation/decision/creation/social/ambient) · data-shape of the answer (scalar/list/table/time-series/entities+relations/geo/simulateable/media) · interactivity-need (manipulate vs read) · cardinality/density (glance limit ~5–7) · reversibility × blast-radius · model confidence · build-cost/latency · context (device, motion, time, location, next commitment) · learned user preference · persistence-need.

**Decision logic (ordered):**
1. Social/trivial ("how are you", "thanks") → **text-only** (a widget here hurts).
2. Reversible + confident action → **silent-do + one-line receipt + Undo**.
3. Irreversible / money / creds / send → **do all safe work, stop at confirm/handoff**.
4. Lookup, scalar → **one line** (+ evidence chip if confidence low).
5. Lookup, list/table/time-series/geo → **pre-made widget** if one exists; else **generative card**.
6. Process / "what-if" / manipulable → **interactive sim surface**.
7. Multi-step agentic → **live plan-timeline** + **cockpit** if browser.
8. Decision with options → **interactive tradeoff table**.
9. Predicted-but-unasked → **Antechamber / Inbox** (pull not push, dismiss-rate governor).
10. Container: **panel default**; **takeover** only when interactivity needs the room / it's a watchable agent run / user prefers immersive. **Blocks** whenever primitives suffice; **code** only when blocks can't express it.

**Worked examples:** "what's on my calendar" → pre-made calendar widget (panel). "latest news on Y, in detail" → generative dossier (takeover), fast card first then stream the surface in. "trade on Kalshi" → cockpit, stop at buy. "how are you" → text only. "should I leave for the airport?" → one line backed by the world-tick, expand-chip → map with route + meeting buffer. "explain compound interest for me" → interactive simulator (sliders). "reschedule Chen, tell the team, move the doc" → cross-app plan-timeline with per-step gates.
*Source: [Generative Interfaces for LMs — arXiv 2508.19227](https://arxiv.org/abs/2508.19227) (generative interfaces beat chat by up to 72% preference **when form matches task**; a self-scored per-query reward function picks the form).*

---

## 4. Feature Catalog (frontier)

**Presentation intelligence:** reward-scored form selection · cost-aware degrade (fast card now, expand later) · confidence-modulated verbosity · silent-action-with-receipt · answer-in-place/evidence-on-demand.
**Proactive / ambient (pull, not push):** the **Antechamber** (calm idle Stage) · event-triggered **ambient agents + a JARVIS Inbox** (notify/question/review) · **pre-built "briefing at the door"** · **anticipatory conflict detection** ("this eats your flight buffer") · **dismiss-rate frequency governor** (the anti-nag).
**Transparency ("watch JARVIS work"):** the **Cockpit** · **plan-timeline** (live tool-call stream, interruptible) · **provenance / trust ledger** · **visual uncertainty** · **dry-run world-diff** (approve-all/each/edit before multi-step actions).
**Multi-modal:** **modality router** (shape→medium: time-series→chart, entities→diagram, geo→map, process→sim) · **on-the-fly interactive simulations** · generated narrated walkthroughs · spatial reasoning surfaces.
**Memory-driven UI:** pairwise-learned form preferences · adaptive density dial (auto + manual override wins) · preference decay/change-detection · **per-domain surface memory** ("markets as candlesticks, tasks as kanban").
**JARVIS-from-fiction (feasible now):** **autonomy slider** per task-class · cross-app orchestration surface · **situational-awareness "world tick"** (bounded periodic, not always-listening) · **cognitive-offload "open loops" ledger**.
**Novel widgets:** **rewind & branch** a surface · **living/self-refreshing document** · **interactive tradeoff table** with live re-weighting · "explain your route" meta-surface · multi-surface canvas for parallel agents · "handoff to human" packaged surface.
*Full sourcing in §9.*

---

## 5. Voice & Audio (we currently have NONE)

**Key call: a controllable cascade, not a black-box native speech-to-speech model** — because our brain does the tool orchestration + generative Stage + safety gates, which an S2S black box can't. We wrap frontier voice *around* our brain.

**Stack:**
- **Wake word:** Picovoice **Porcupine** — custom "Hey Jarvis," fully on-device, private, always-on, low-power.
- **Turn-taking:** **semantic endpointing** (rule-based VAD is broken — it can't use conversational meaning); bleeding edge folds turn-detection into the model via control tokens (`<user_finish_speaking>`).
- **Brain:** ours, unchanged (the crown jewel).
- **Voice out:** **Cartesia Sonic** (~40ms first byte, SSM architecture, stays fast under load) for speed; **ElevenLabs** for a **cloned signature JARVIS voice** with emotional range. Use ElevenLabs as identity, Cartesia as low-latency fallback.
- **Barge-in:** client echo-cancel + cancel generation on detected speech + flush audio buffer → talk over it, it yields mid-sentence.
- **Empathic layer:** Hume-style **prosody sensing** — reads stress/mood, adapts tone + terseness, backchannels ("still on it, sir") during long tasks.

**Fusion (one stream):** blocks materialize **in lockstep with the TTS sentence describing them** (spring-in on sentence onset). Barge-in cancels TTS, pauses the reveal queue, and hands the half-built surface to interactive at exactly the block being discussed. It can also **see the screen/the Stage** while you talk (Gemini-Live-style) — "what's this?" pointing at the surface.
*Sources: [realtime voice API comparison 2026](https://apiscout.dev/guides/realtime-voice-ai-apis-comparison-2026), [semantic VAD](https://gradium.ai/content/semantic-vad-voice-agents-turn-detection-2026), [DuplexCascade arXiv 2603.09180](https://arxiv.org/html/2603.09180), [TTS latency benchmark](https://gradium.ai/content/tts-latency-benchmark-2026), [Porcupine](https://picovoice.ai/products/voice/wake-word/), [Hume EVI](https://www.hume.ai/blog/introducing-hume-evi-api), [Gemini Live 2026](https://singularitymoments.com/google-gemini-live-guide-2026/).*

---

## 5A. Maps & Location Intelligence

Head start: a **Gemini Google Maps grounding lane** already exists (`useMaps` → `{google_maps:{}}`) and answers "when do I leave / traffic / nearest / directions" conversationally. We upgrade it to 90/100 in two moves:

1. **Structured routing via the Google Maps Routes API** (`computeRoutes`) — the modern recommended service. `routingPreference: TRAFFIC_AWARE_OPTIMAL` (identical to maps.google.com) + `departureTime` → real-time-traffic ETA; route modifiers **avoid tolls / highways / ferries**; alternative routes; traffic models (BEST_GUESS / PESSIMISTIC / OPTIMISTIC). A `maps_route` tool returns structured `{durationInTraffic, distance, polyline, steps, alternatives, warnings}`.
2. **"Leave by," tied to your calendar + world-tick** — Jarvis reads your next event's location + start time, computes the traffic-aware drive *backward* to a **leave-by time with a buffer**, flags jammed segments and routes to avoid, and renders it as a **map block** in the Stage: *"Leave by 2:34 — the bridge is jammed, routed you via Y; that's your 3:00 with Chen in Chinatown."* This is the anticipatory-conflict + world-tick features, made spatial.

**Tools:** `maps_route` (Routes API) · `maps_places` (nearby / hours / open-now — Places API) · `maps_geocode`. **Surface:** a `map` block with a route/annotation layer. **Keys:** one Google Maps Platform key (Routes + Places).
*Sources: [Routes API](https://developers.google.com/maps/documentation/routes), [traffic model](https://developers.google.com/maps/documentation/routes/traffic-model).*

---

## 6. The Top 10 Never-Seen Features (crown jewels)

1. **Narration-locked reveal** — the surface *builds itself as Jarvis talks*; each block springs in on the sentence describing it.
2. **The Cockpit that stops at the trigger** — watch Jarvis drive a live browser, narrating, and *pause at the final click* for you. Auto-execute structurally impossible.
3. **Ask a paragraph, get a machine you can drag** — "what if I retire at 60?" returns a live simulator with sliders, not prose.
4. **Velocity-preserving "mind-change" morph** — when new data lands mid-animation, the UI visibly *reroutes* fluidly instead of snapping. It looks like it's thinking.
5. **The self-critiquing "polish pass"** — after first paint, Jarvis screenshots its own surface, fixes it, and you *watch* the caption nudge into place and the chart recolor.
6. **Rewind & branch an answer** — scrub a generated dashboard back through its construction and say "go back to before the filter, group by region instead."
7. **The living dashboard** — pin a surface and it keeps itself fresh, diff-highlighting what changed since you last looked. A surface with a heartbeat.
8. **Answers in context you never gave** — "leave now?" already knows your next meeting, its address, and traffic (a bounded "world-tick" day-model).
9. **The brief already at the door** — you think "morning brief," it opens *instantly* because Jarvis pre-built it at 6am (zero-query, pull not push).
10. **The surface that remembers you — and tells you why** — markets come up as candlesticks, prose stays terse (learned from your dwell/dismiss); tap "why a chart?" and it shows its router decision, then *learns* from your correction.
*Runners-up: barge-in hands you the wheel · anticipatory conflict detection · data-substrate morphing ("show it as a map / table / timeline" — same data, liquid morph) · handoff-to-human packaged surface.*

---

## 7. Build Plan — WAVES (vertical slices, each one testable end-to-end)

**Philosophy:** start trivial, compound. Every wave is a *working capability you can use and test in the real Jarvis* — never a half-built backend/frontend layer. Rhythm: build → drive it in the real UI → verify → commit → next wave. Never start Wave N+1 until Wave N is real and tested.

| Wave | Capability (builds on the last) | The test — "say X → see Y" |
|---|---|---|
| **W0** | **The Stage exists.** Jarvis owns a panel it can open on command and write text into. | "Jarvis, open a panel and write hello" → a Jarvis panel appears with the text. Works. |
| **W1** | **Widget command & control.** Jarvis opens any EXISTING widget when relevant, is **aware of every open widget**, avoids overlap, and can **move / resize / arrange / focus / close** them on command. | "open the calendar" · "move it to the right" · "make it bigger" · "what's open?" · "close everything" → it does each, no overlap. |
| **W2** | **Drive widget content.** Jarvis reads and fully controls the *inside* of existing widgets — navigate their state/tabs, set values, populate them — not just position. | "open the calendar and jump to next week" · "in the Kalshi widget, go to <market>" → it navigates inside the widget. |
| **W3** | **Generative Stage v1** — block registry (text/stat/chart/calendar) + event-stream reducer + two-phase generation. Jarvis composes a bespoke surface from typed blocks, streamed in. | "what's on my calendar today" → a real calendar block with your actual events builds itself in the Stage. |
| **W4** | **The 3-way presentation router.** Decides text vs pre-made widget vs generative surface vs takeover; picks panel vs full-screen. | "how are you" → text only · "what's on my calendar" → widget · "latest news on X, in detail" → generative dossier surface (takeover). |
| **W5** | **Morph + motion + skeleton-first.** Surfaces morph fluidly between forms and feel instant (skeleton paints first, data hydrates). | Ask two different things back-to-back → the Stage *morphs* (shared elements slide, springs), never reloads; feels instant. |
| **W6** | **Maps & location intelligence.** `maps_route` (Routes API, traffic-aware, avoid-routes) + a map block + "leave by" tied to your calendar/world-tick. | "when should I leave for the airport?" → leave-by time + route + traffic + avoid-segments on a live map, aware of your next event. |
| **W7** | **The UI agent (self-critique).** Render → screenshot → vision critique → patch (≤2 passes); bank good surfaces into a growing taste library. | Generate a busy dossier → watch it *fix its own* overlap/alignment live; quality visibly rises over repeated use. |
| **W8** | **Code sandbox + interactive sims.** The walled iframe escape hatch for what blocks can't express. | "explain compound interest for my situation" → a **draggable simulator** (sliders recompute a live curve), safely sandboxed. |
| **W9** | **The live Cockpit.** Agent-driven browser streamed into a widget, narrated, with a freeze-frame confirm gate. | "trade on Kalshi for me" → live browser navigates to the exact market, narrates, **freezes at the buy button** for your confirm. |
| **W10** | **Voice.** Wake word ("Hey Jarvis") → semantic endpointing → brain → streaming TTS; **narration-locked reveal**; barge-in. | Spoken: "Hey Jarvis, what's on my calendar" → it *speaks* the answer AND the calendar builds in lockstep; talk over it → it yields. |
| **W11** | **Proactive + memory.** Antechamber (calm idle Stage), event-triggered Inbox (notify/question/review), world-tick, pre-built briefs, per-domain + learned surface memory, dismiss-rate governor. | Idle at 8am → the Antechamber shows next meeting + the one email needing you; markets always come up your preferred way. |
| **W12** | **Advanced polish.** Hybrid multi-surface canvas, rewind & branch a surface, living/self-refreshing dashboards, "explain your route" meta-surface. | "go back to before the filter, group by region" → the surface rewinds & rebranches; a pinned dashboard refreshes itself. |

Maps (W6) sits after the surface + router basics exist so the map block and calendar context are there to render "leave by" into. Voice (W10) comes once the surfaces are worth narrating. Each wave is independently demoable — that's the whole point.

---

## 8. Safety & Guardrails (the research is unambiguous)

- **A widget must earn its pixels** — default to text for trivial/emotional/scalar answers; a low-payoff surface adds cognitive overhead.
- **Proactive = pull, not push, with a dismiss-rate governor** — intrusiveness/assuming-too-much is exactly what killed Google Now's goodwill and Humane/Rabbit.
- **Transparency is targeted** — surface reasoning/uncertainty only at high-value checkpoints, not constantly.
- **Latency is a routing signal** — slow ideal surface → ship the fast card, offer to expand.
- **Autonomy is a visible slider; money/credentials/irreversible always gate to a human handoff** — Jarvis stages everything up to the line and hands off the last click. Never auto-executes a trade.

---

## 9. Sources
A2UI · Thesys C1 · Google Research genUI · "Let Me Speak Freely?" (2408.02442) · AG-UI / CopilotKit · Vercel AI SDK GenUI · Vision-Guided Iterative Refinement (2604.05839) · UICrit · Apple UICoder · Motion (layout animations) · MDN CSP sandbox · Sandpack · agent-browser streaming · OpenAI CUA/Operator · Generative Interfaces for LMs (2508.19227) · LangChain ambient agents & agent streams · Karpathy Software 3.0/LLM-OS · Smashing (transparency, anticipatory design) · Confirmation Frequency (2510.05307) · Personalization of Generative UIs (2604.09876, 2603.19196, 2606.02976) · LIDA / DiagrammerGPT · NN/g progressive disclosure · calm technology / ambient device · realtime voice APIs 2026 · semantic VAD · DuplexCascade (2603.09180) · TTS latency benchmark · Picovoice Porcupine · Hume EVI · Gemini Live 2026. (Full URLs inline throughout.)
