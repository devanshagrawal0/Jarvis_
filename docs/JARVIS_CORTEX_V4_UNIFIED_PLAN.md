# JARVIS CORTEX v4 — Unified Master Plan

> **Supersedes Cortex v3.** Thesis (from the read-only architecture audit): Jarvis is **not** a weak brain — it's a **hidden** one. Three partially-disconnected products (rich local backend · simpler Cloudflare Worker · thin active frontend). The leap comes from **UNIFYING + securing + economically routing** what already exists, then making it **visible** — not from piling on features.
>
> Built on: the architecture audit (bugs, phases, "unify > expand") × the Gemini paid-key deep-dive (model portfolio + required/too-good/over-the-top segregation) × our own-pipeline deep-research design × the locked local-vs-Gemini decisions below.

---

## Locked decisions (2026-07-11)

- **Reliance = Cost-guarded by default, with an in-chat "Strength" selector** (Cost-guarded / Balanced / Full-power) sitting next to the model picker. Cheap Gemini (Flash brain, Flash-Lite routing, free-tier Search grounding, embeddings) is used everywhere it wins, always with a **local fallback**. The Strength dial only governs the **premium tier** (3.1-Pro, Computer Use, hosted Deep Research, media, big caching).
- **Memory = local-only + Gemini embeddings.** Neural Vault stays on-device (nothing stored at Google); Gemini Embedding-2 computes vectors for semantic search.
- **Deep Research = both, ours primary.** Our pipeline (Gemini as the search/reason engine) fuses **private data + web** and streams its work; Gemini's hosted Deep Research is an option for pure heavy web.
- **Media + sandbox = included, gated.** Nano Banana 2 for images/cards/report assets; Antigravity for explicit heavy jobs. Never default.
- **Budget = no hard cap; track + surface** running spend from `usageMetadata`.

---

## The Gemini model registry (one config, swap-safe)

| Role | Model | Local fallback |
|---|---|---|
| Router / classify / extract / background | `gemini-3.1-flash-lite` | deterministic keyword router |
| Main brain / tools / vision | `gemini-3.5-flash` | — (must be LLM) |
| Hard-reasoning escalation | `gemini-3.1-pro-preview` | Flash |
| Live voice | `gemini-3.1-flash-live-preview` | browser SpeechRecognition (free Dictate mode) |
| Embeddings (memory) | `gemini-embedding-2` | FTS5 + graph only |
| Image generation | `gemini-3.1-flash-image` (Nano Banana 2) [+ `gemini-3-pro-image` premium] | SVG (our hand-built cards) |
| Deep Research (hosted option) | `deep-research-preview` | our pipeline |
| Computer Use | `gemini-3.5-flash` (computer-use) | local Playwright + Windows UIA |
| Cloud sandbox | `antigravity-preview` | local execution |

**Strength selector mapping:** Cost-guarded → Flash-Lite + Flash only; premium on explicit request. Balanced → auto-escalate to Pro/Computer-Use/Deep-Research within reason. Full → best tool always. All three verify model names against a single registry (rename = one line).

---

## Where to use what (local vs Gemini vs hybrid)

| Function | Choice | Why |
|---|---|---|
| Greetings / time / trivial | **Local** | instant, $0 |
| Intent routing | **Hybrid** | deterministic for obvious, Flash-Lite for ambiguous |
| Web fast facts | **Gemini** (Search grounding) | free < 5k/mo, fresher + cleaner than our scraping; local scrape fallback |
| Read specific URLs | **Gemini** (URL Context) | server-side, billed as tokens only |
| Deep research | **Ours** (Gemini-engine) | mixes private+web, shows work; hosted as option |
| Main reasoning | **Gemini** (Flash→Pro) | — |
| Built calculations (APEX/Forge) | **Local** | deterministic, $0, already built |
| Ad-hoc data/math | **Gemini** (Code Execution) | any Python, gated |
| Memory store | **Local** (Neural Vault) | privacy, no dependency |
| Memory vectors | **Gemini** (Embedding-2) | cheap, multimodal |
| Voice | **Both modes** | free browser Dictate · paid Gemini Live |
| Desktop/browser control | **Local primary** (Playwright/UIA), Gemini CU fallback/critic | control + guardrails |
| Maps/places/traffic | **Gemini** (Maps grounding) + keyless geocode fallback | — |

---

## Phases & Waves (merged audit phases × our waves)

Cadence per wave: **start** with a quick Gemini-capability check (what to use here) → build → **end** with memory update + kid-summary. **Bug tests every 2 waves.** Standing restart permission.

### ✅ Already done (fold in, keep)
- **Personal Vault** (`user-context.js`) — authoritative core profile. *(ex-Wave 0)*
- **Live web grounding + anti-refusal** — verified. *(ex-Wave 1; now governed by the one-lane rule below)*

### PHASE 0 — Stabilize & Secure (do first; unlocks everything)
- **0.1 Security trust zones** 🔴 #1 — separate loopback desktop API / authenticated paired-device (bearer) / public pairing surface / cloud front door. Quick-Tunnel must **never** expose the full desktop API anonymously. Gate before any more autonomy.
- **0.2 Model registry** — one config; replace every obsolete/hardcoded model (react-loop, memory-extractor, screen-analysis, computer-use, worker); wire the Strength selector + per-role models.
- **0.3 One research lane** — fact→grounding · urls→url_context · deep→our pipeline. Kill the double-grounding (research_v2 + native) our earlier grounding change can trigger.
- **0.4 Mission hygiene** — idempotency keys, per-parent child caps, no recursive self-deploy, per-run token/$ budget, retention/archival, fix `skill_runs` completion. Clean the 704 MB / 15,898-mission DB.
- **0.5 Fix memory extractor** (`geminiKey` + live model) + finish NY-hardcode removal (research-v2, instant path).
- **0.6 Cost/usage accounting** from `usageMetadata` — running $ tracker (per-turn + monthly), surfaced in UI. No hard cap.

### PHASE 1 — Make Jarvis FEEL like Jarvis (visible intelligence)
*Biggest perceived leap: expose the backend through the active `JarvisUI`.*
- **1.1 Unified conversation/event protocol** — backend streams: plan · tool-calls · states · sources · evidence · receipts · approvals · artifacts · model + cost.
- **1.2 Agent-activity UI** — response cards (sources / files / approvals / screen evidence / research / errors) + live activity rail ("searching / reading / calculating / verifying") + expandable technical trace + model/cost/strength indicator.
- **1.3 Backend→HUD tools** — `ui_open_widget` / `ui_focus_widget` (focus mode) / `ui_populate` / `ui_render_card`.
- **1.4 Selectors in the command bar** — Model · **Strength** (Cost-guarded/Balanced/Full) · **Research mode** (Fast/Deep), like Claude's model picker.
- **1.5 Connect Gemini Live** to the active command bar — 2 modes: **Dictate** (free browser STT) · **Talk-Live** (paid native audio, ephemeral tokens, current Live model). The expensive part is already built in `liveVoice.ts`.
- **1.6 Attachments end-to-end** — upload → classify MIME → extract/multimodal → Gemini turn → artifact ref → render + analysis status. Reuse ported `file-extractor`/`pdf-provider`. *(Jarvis Files — inbound)*
- **1.7 Downloadables** — `create_file` → download chip in chat **and** toast with a Download button. *(Jarvis Files — outbound)*

### PHASE 2 — Economical Intelligence (the brain, done right)
- **2.1 One bounded universal loop** — Plan→Act→Observe→Reflect, ≤6 rounds, parallel tools, duplicate `tool+args` detection, reflect only on failure/uncertainty, final synthesis from the evidence ledger, partial success on deadline. Browser loop stays specialized underneath.
- **2.2 Real tool-result synthesis** — feed `functionResponse` back to the model; delete the envelope dump for research_v2 / skill paths.
- **2.3 Memory unification + vectors** — `user-context.sqlite` = authoritative core; Neural Vault = long-term semantic/episodic/procedural; PC graph = activity evidence; rest = derived indexes. Add Embedding-2 vectors (async/batch). Hybrid retrieval = lexical + vector + graph → local rerank → inject 5–8, provenance-tagged. **Memory Inspector** widget.
- **2.4 Context caching** — cache system/personality/tool/profile context (big cost cut).
- **2.5 Situational Context object** — constant time/place/activity, event-driven, freshness-stamped.
- **2.6 Routing polish** — Flash-Lite router → Flash main → Pro escalation, governed by Strength.

### PHASE 3 — Premium Capabilities (gated, guarded)
- **3.1 Deep Research pipeline (ours)** — planner → parallel workers (Gemini-grounded **+** private-data workers over Vault/files/APEX/Arbiter) → dedup/rank ledger → reflect → synthesize → adversarial verify. Streams to the activity UI. Its own lane. Hosted Deep Research as an option for pure web.
- **3.2 Code Execution** — Python sandbox for ad-hoc data/math; local engines keep the built stuff.
- **3.3 Maps grounding** — places/directions/traffic → finishes "when should I leave"; + keyless geocode/weather fallback.
- **3.4 Computer Use** — Gemini CU as fallback/critic to local Playwright+UIA; receipts, allowlists, action caps, confirmation.
- **3.5 Image generation** — Nano Banana 2 for charts / visual cards / report assets (Pro for premium).
- **3.6 Antigravity** — cloud-sandbox agent for explicit heavy jobs (reports/data analysis in isolation), budget-gated.

### PHASE 4 — Real Widgets & Proactive
- Top-15 widgets: Now/Clock · Agenda · Weather · Commute · Tasks · Quick-capture · Email · Launcher · **Memory Inspector** · Goals · Finance · System vitals · **Proactive suggestion** · **Agent activity** · **Generative slot**.
- Proactive engine wired to situational triggers + scheduled tasks (node-cron).
- Capability roadmap: briefing → email/calendar → do-it-for-me → lifestyle.

### PHASE 5 — Cloud/Mesh unification + evals
- Cloudflare Worker → **authenticated relay/signaling only** (local brain authoritative).
- Promptfoo eval harness (the diagnosed failures become regression tests) + OTel/Langfuse tracing + cost dashboards.

---

## Explicitly NOT doing (from the deep-dive "over-the-top / not-needed")
Veo video · Lyria music · robotics · Deep Research Max as default · Pro-on-every-turn · priority inference · continuous always-on camera · another UI shell · another independent brain path · more "available"-but-unwired modules. *(Antigravity + Nano Banana are in — but gated, never default.)*

## Definitive stack (the audit's diagram, with our routing)
```
Active UI (agent-activity surface: plan · tools · sources · approvals · files · cost)
  ↓  one conversation/event protocol
Local deterministic router  +  Strength dial (Cost-guarded / Balanced / Full)
  ├─ instant/local answer
  ├─ Flash-Lite  (routing, extraction, background, triage)
  ├─ 3.5-Flash   (main agent + tools + vision + grounding)
  ├─ 3.1-Pro     (escalation only)
  ├─ Live voice  (Dictate free · Talk-Live paid)
  └─ Deep Research (our pipeline · hosted option)
  ↓  ONE bounded tool loop (Plan→Act→Observe→Reflect)
Local capabilities  +  Gemini managed tools (Search/Maps/URL/Code Exec/Computer Use)
  ↓  one evidence ledger  (+ usageMetadata cost tracking)
User Profile (authoritative) + Neural Vault (local + Embedding-2 vectors) + PC Graph
  ↓
Rich answer cards + live activity timeline + Memory Inspector
```
