<div align="center">

<img src="./docs/media/banner.svg" alt="Jarvis Command OS" width="960" />

<br/>

### A local-first, AI-native operating system for a personal assistant.

**Not a chat box.** A set of immersive 3D *rooms* that share one reasoning brain, one encrypted memory that grows over time, and one set of real-world tools. It runs on your machine, learns what matters to you, and can act — drive a browser, read your screen, search the web, pull live market data, pair with your phone, and reason through hard problems out loud.

<br/>

**`167,585`** lines · **`363`** API routes · **`129`** agent tools · **`214`** encrypted memory tables · **`503`** backend tests

<br/>

<img src="./docs/screenshots/01-globe.png" alt="The JARVIS landing shell — a holographic globe above a command bar" width="900" />

<sub><i>The landing shell. The globe is hand-built Three.js — real country borders projected from GeoJSON onto a canvas texture, a custom GLSL fresnel shader for the atmosphere, hand-placed orbit rings.</i></sub>

</div>

---

## Contents

- [What this actually is](#what-this-actually-is)
- [**What's real, what's demo**](#whats-real-whats-demo) ← read this first
- [The rooms](#the-rooms) — [APEX](#-apex--trading-command-center) · [HELIX](#-helix--the-intelligence-chamber) · [Arbiter](#-arbiter--prediction-market-divergence) · [Synapse](#-synapse--cross-machine-collaboration)
- [Memory](#memory--the-part-im-proudest-of)
- [The brain](#the-brain)
- [Tools & capabilities](#tools--capabilities)
- [Automation — how it drives a computer](#automation--how-it-drives-a-computer)
- [Security & trust](#security--trust)
- [Design system](#design-system)
- [Desktop & phone](#desktop--phone)
- [Architecture](#architecture)
- [Quick start](#quick-start) · [Keys & configuration](#keys--configuration)
- [Engineering discipline](#engineering-discipline)
- [Project structure](#project-structure)
- [Status & disclaimer](#status--disclaimer)

---

## What this actually is

Most "AI assistants" are a text box in front of someone else's model. This is the opposite bet: **the interface, the memory and the tools are the product**, and the model is a component you swap.

Three ideas hold it together.

**1 · Rooms, not tabs.** Different work wants a different environment. Researching a hard question, running a trading analysis, and asking what's on your calendar are not the same activity and shouldn't share one scrolling transcript. Each room is a full-screen environment with its own layout, palette and data — but they share one brain and one memory, so context carries across them.

**2 · Memory as infrastructure, not a feature.** Chat history is not memory. What's underneath here is a bitemporal, encrypted, append-only knowledge store with its own migration system, retrieval planner and safety gates — closer to a database with a policy engine than to a `messages` array.

**3 · An assistant that cannot lie about what it did.** This is the theme running through the whole codebase. If it says it sent a message, a tool must actually have performed a side effect. If it says "verified", something must have re-observed the result. A large share of the work here is the machinery that makes overclaiming *structurally impossible* — and a [51-finding internal audit](#engineering-discipline) whose central conclusion was that **a check that cannot fail is a bug**.

It's a personal system, built for one person, in the open. Not a product, no users, takes no money.

---

## What's real, what's demo

Every project like this is tempted to oversell. This table is the antidote, and it's near the top on purpose. Statuses below match the badges the UI shows on its own surfaces.

| Surface | Status | Detail |
|---|---|---|
| **Shell · globe · 17 widgets** | 🟢 Real | Live backend data |
| **Memory (vNext)** | 🟢 Real, **shadow + guarded canary** | Runs live on every turn, but **legacy memory is still authoritative for answers**. Only a narrow allowlist of low-risk facts reaches the prompt. Cutover is gated — [see below](#the-cutover-model). |
| **APEX** · Live Markets, Portfolio, Risk, News, Backtesting, Forge | 🟢 Real | Live public market data, own quant routes. Equity microstructure is **labelled in-app as simulated**. |
| **APEX** · Trading Bots, Paper Trading, Live Testing | 🟡 Real but **paper-only** | Bots evaluate live bars and auto-trade, but *"route every order through the virtual paper desk and have no broker path at all."* |
| **APEX Home** · Portfolio & Bot Status tiles | 🟠 **Demo-badged** | Those dashboard tiles carry a `DEMO` badge in the UI. The standalone Portfolio **tab** is real. |
| **APEX** · Scanner | 🟠 Environment-dependent | Needs an external "Vibe-Trading" sidecar **not included in this repo**. Won't work on a fresh clone. |
| **HELIX** · Ask, Evidence, Analyze, Build, Explore, Team, Projects | 🟢 Real | Bound to live `/api/helix/*`; shows honest empties rather than fake rows |
| **HELIX** · Notifications panel | 🟠 **Sample-badged** | In-app tooltip: *"Notifications aren't wired to live events yet."* |
| **HELIX** · Observability per-run internals | 🟠 Known gap | Flagged in-code as pending an honesty sweep |
| **Arbiter** | 🔴 **UI prototype — mock data** | Renders from `MOCK_EDGES`/`MOCK_CATALYSTS`. No backend behind it yet. |
| **Synapse** | 🟡 Partial | Chat, cursors, shared canvas, choreography implemented. The **call/video panel is an explicit placeholder.** |
| **Kalshi trading by the AI** | ⚪ Deliberately absent | All 6 Kalshi tools are read-only. An order-placement path exists in the provider but **is not exposed to the agent.** |
| **Scheduled background tasks** | ⚪ Not built | Planned, not implemented. No scheduler exists in this codebase. |

Also honest: `App.tsx`, `SimpleApp.tsx` and the v1 `HelixRoom.tsx` are **dead code** still in the tree. The live shell is `JarvisUI.tsx`.

---

## The rooms

Rooms mount full-screen over the globe. Type `apex`, `helix`, `arbiter` or `synapse` into the command bar, or use the launcher (bottom-right grid icon). The last room you opened persists across reloads.

### 📈 APEX — Trading Command Center

A trading terminal built entirely on **free, public market data**. Eleven tabs, 68 source files.

<div align="center">
<img src="./docs/screenshots/02-apex-01-home.png" alt="APEX Home — the Command Deck" width="920" />
<br/>
<sub><i>APEX Home. Note the <code>DEMO</code> badges on Portfolio and Bot Status — the UI labels its own unfinished surfaces.</i></sub>
</div>

The Home dashboard is a ~24-panel bento grid: a **regime engine** (risk-on/risk-off from breadth, VIX and momentum), a **Market Constellation** — a live force-directed physics graph of cross-asset correlation — an order-book heatmap, sector rotation, a news river with sentiment scoring, and a Jarvis dock with Analyst / Trader / Quant / Research personas.

<div align="center">
<img src="./docs/screenshots/02-apex-03-live-markets.png" alt="APEX Live Markets" width="450" />
<img src="./docs/screenshots/02-apex-06-backtesting.png" alt="APEX Backtesting" width="450" />
<br/>
<sub><i>Live Markets — candlesticks with EMA/VWAP/Bollinger/RSI/MACD and an Oracle prediction panel · Backtesting — equity, drawdown, walk-forward, Monte Carlo</i></sub>
</div>

**THE FORGE** *(inside APEX)* is the densest subsystem in the codebase — a visual quant lab where strategies are assembled from signal blocks and then attacked by a family of agents: **Darwin** (genetic evolution of strategy populations), **Prospector** (signal mining), **Sentinel** (overfitting detection — deflated Sharpe, sensitivity, Monte Carlo), **Genesis** (goal → strategy), **Terraform**, and an **Improver** that diagnoses *why* a strategy underperforms instead of just scoring it.

<div align="center">
<img src="./docs/screenshots/02-apex-02-forge.png" alt="THE FORGE — visual strategy builder" width="920" />
</div>

Three themes (Cold Steel `#3fd0ff`, Midnight `#a98bff`, High Contrast `#00e5ff`), three density modes, and a cinematic boot sequence.

### 🧬 HELIX — the Intelligence Chamber

A research environment structured around an explicit five-stage pipeline: **Question → Evidence → Analysis → Decision → Artifact.** Eleven surfaces.

<div align="center">
<img src="./docs/screenshots/03-helix.png" alt="HELIX v2" width="920" />
</div>

What separates it from "chat with your documents" is that it treats **contradictions** and **corpus confidence** as first-class state. Evidence is supported or contradicted; open contradictions are counted and surfaced; confidence is deliberately **ordinal, not a fake percentage**. Surfaces render honest empties — `0` and a call to action — rather than inventing sample rows.

The standout visual is the **Knowledge Graph**: a real WebGL force-directed 3D graph (`@react-three/fiber` + `d3-force-3d` + bloom postprocessing) laying out Sources → Claims → Analyses → Decisions → Artifacts in colour-coded z-layers.

### 🎲 Arbiter — prediction-market divergence

<div align="center">
<img src="./docs/screenshots/04-arbiter.png" alt="Arbiter" width="920" />
</div>

Finds price divergence for the same real-world outcome across Kalshi and Polymarket and proposes the convergence trade. **This room is currently a UI prototype rendering from mock fixtures** — the backend is not wired. It's shown here because the interface is finished and it renders, not because it works.

### 🕸️ Synapse — cross-machine collaboration

Two JARVIS instances on different machines collaborating in one session: presence, shared workspace, live cursors, shared canvas, dual chat, timeline, and a session choreographer — over WebRTC with Noise-protocol identity. **The call/video panel is an explicit placeholder**; the rest is implemented.

---

## Memory — the part I'm proudest of

Under `server/memory-vnext/` is a memory system with **30 migrations and 214 tables — every one declared `STRICT`** — built across 32 development waves.

**What it stores.** Encrypted conversation turns with **branching**; a working-memory kernel of open loops, focus state and unresolved referents; tasks, checkpoints, approvals and a tool-invocation ledger; an evidence graph of sources → evidence → assertions → entities with reliability and trust zones; and a personal-context layer of discrete owner facts (`identity.*`, `preference.*`, `goal.*`, `health.*`, `location.*`).

**How it's protected.**

- Every payload is **AES-256-GCM** (96-bit nonce, 128-bit auth tag) inside an `encrypted_objects` table.
- The 32-byte master key is wrapped at rest with **Windows DPAPI** (CurrentUser scope).
- The master key is **never used directly** — per-purpose subkeys are derived with **HKDF-SHA256**: separate keys for content encryption, content MAC and ledger signing.
- The event ledger is **HMAC-chained** (`previous_mac` → `mac`), so tampering with history is detectable.

### The cutover model

This is the design decision I'd most want a reviewer to look at. Replacing a working memory system is dangerous, so vNext runs **live but non-authoritative**:

1. **Shadow** — observes every turn, ingests facts, runs a parallel retrieval and compares against legacy. Influences nothing.
2. **Guarded canary** — a narrow, hand-audited allowlist of low-risk facts *may* reach the prompt alongside legacy context. A denylist (health, location, identity beyond preferred name, raw transcript) applies **unconditionally, regardless of who holds authority**.
3. **Cutover** — per-domain, owner-approved, recorded in a signed ledger. Four domains flip independently: `explicit_commands` → `conversation_runtime` → `retrieval_context` → `room_integrations`.

Every failure mode resolves to **legacy**. Authority is granted only by a positive, signed activation.

And the gate that authorises a cutover doesn't accept an asserted `{passed: true}` — it **earns** its evidence: 24 real probe prompts through the live retrieval path, plus a **contained rollback rehearsal** that spins up a throwaway store, runs the real coordinator, activates all four domains forward, rolls them all back, and asserts the runtime actually observed each flip.

---

## The brain

Google **Gemini**, through one model registry (`server/gemini-models.js`) with per-role assignments and **failover ladders** — each role carries an ordered list of fallbacks tried on 503/429/500/404, with self-healing `*-latest` aliases as a last resort. The comments record why: real Google outages took specific models down mid-use.

| Role | Purpose |
|---|---|
| `router` | routing, classification, extraction, background work |
| `main` | chat, tools, vision, search grounding |
| `reasoning` | escalation for hard problems |
| `live` | realtime voice |
| `embedding` | memory vectors |
| `image` · `imagePro` | generation |
| `deepResearch` | long-horizon hosted research |
| `computerUse` | screen control |

> **Accuracy note.** The registry's `main` role and three call sites (`react-loop.js`, `computer-use.js`, `cost-meter.js`) currently name **different** Gemini Flash versions. That drift is real and unfixed — I'd rather document it than pretend the registry is the single source of truth it's supposed to be.

**Turn classification is two-layered on purpose.** A deterministic regex classifier establishes intent; an optional model-based semantic router may then *sharpen* it — but the deterministic baseline always wins on conflict. The LLM cannot talk its way past a safety-relevant classification.

A **three-tier effort dial** (`cost-guarded` → `balanced` → `full`) governs only the premium tier — Pro escalation, Computer Use, hosted Deep Research. Cheap models and free search grounding are always on. Spend is metered per turn, and the stable system preamble is served from Gemini's prompt cache to cut repeat input cost.

---

## Tools & capabilities

**129 tool definitions**, each classified by risk:

| Risk | Count | Meaning |
|---|---|---|
| `observe` | 77 | read-only |
| `prepare` | 25 | stages an action without committing it |
| `execute` | 17 | acts locally |
| `commit` | 10 | causes an external, irreversible side effect |

Families: browser control, Windows UI-Automation, file read/write, research, market data, device mesh, agent deployment, skill compilation, screen vision, and communications (Gmail, Instagram).

**Approval is cryptographic, not a UI checkbox.** When a tool needs owner confirmation the engine mints a random 32-byte `ownerChallenge` bound to that exact tool *and* a hash of its arguments, stores it with a 10-minute expiry, and requires it back on approval with a timing-safe compare. Argument summaries are redacted (`token|secret|password|authorization|api.?key|cookie`) before they're ever displayed.

Orthogonally, an **autonomy level** (`observe` / `prepare` / `act` / `autopilot`) gates what may run unattended. `run_command` is *always* confirmed even at autopilot — the code comment explains that a blocklist alone is not a real security boundary. Voice-originated turns can never commit external side effects.

---

## Automation — how it drives a computer

Four lanes, chosen by an execution-lane router:

- **`visible-desktop`** — takes over your actual screen. Only activates on explicit phrasing ("on my screen", "control my cursor"). One merged PowerShell call does foreground detection + UI-Automation extraction + a Set-of-Marks overlay, then Gemini Vision picks a *numbered element* rather than raw coordinates.
- **`headless-browser`** — the default. A DOM-driven planner/actor loop over Playwright with a schema-constrained planner, its own world model, entity resolver and navigation memory.
- **`private-browser`** — authenticated sites that need your real session.
- **`connector-google`** — the direct Gmail API when OAuth is connected.

Two details worth calling out, both learned the hard way:

**Snapshots rank before they truncate.** The DOM collector used to walk in document order and stop at its element budget — so on any chat app the nav rail and conversation list consumed the budget and the **message box, which is last in the DOM, was never seen.** The agent concluded there was nowhere to type. Elements are now ranked in-page so typable controls survive truncation wherever they sit, decorative icons that merely restate their parent link are dropped (~half the budget), and truncation is *reported* instead of silent.

**Recipient resolution refuses ambiguity.** Asked to message someone, if the top candidate doesn't clear a confidence margin the action is refused rather than guessed. It would rather do nothing than message the wrong person — including refusing a group chat when a single person was named.

---

## Security & trust

Three trust tiers, cleanly separated in `server/request-trust.js`:

| Tier | How it's established |
|---|---|
| `local-owner` | Direct loopback **with no proxy-forwarded headers present** |
| `relay` | HMAC-SHA256 signed request · 60s max age · nonce replay cache · timing-safe compare |
| `paired-device` | Bearer-token device auth, permission tier chosen at pairing |

The forwarded-header condition exists because of a real finding: `cloudflared` with no `--http-host-header` makes **every public request arrive as if from loopback**, so a spoofable `Host: localhost` was briefly the entire boundary between the open internet and full owner authority.

Other controls: **secrets encrypted at rest** via DPAPI across an allowlist of 17 fields, atomic writes, `0o600`; **provenance-based prompt-injection defence** (a turn is marked possibly-influenced only once a tool that actually pulled external content has run); a **path blocklist** on file writes (Windows, Program Files, Startup, System32, UNC); and an **Action Fabric emergency stop** that every in-flight consequential action must clear, bound to `Ctrl+Alt+Escape` in the desktop app.

---

## Design system

One visual language, tokenised rather than styled per-room.

| | |
|---|---|
| **Ground** | `#020408` room · `#060809` void · near-black glass panels |
| **Accents** | JARVIS cyan `rgb(0,180,255)` · HELIX `#4a9eff` · APEX `#22d3ee` · signal orange `#f5a524` |
| **Strands** | evidence `#4a9eff` · strategy `#4aff9e` · construction `#ff9e4a` · memory `#9e4aff` · signal `#ffe14a` · synthesis `#4afff0` |
| **Type** | Orbitron / Oxanium (display) · Inter (body) · JetBrains Mono (data) |
| **Motion** | 120–450ms, tokenised easings, full z-index scale |

The language throughout: dark glass with 12–32px backdrop blur, thin translucent accent borders, additive glow, scanline decoration, uppercase micro-labels with wide letter-spacing. Rooms re-theme by swapping CSS custom properties on `:root`, so entering a room re-tints the entire shell including the Jarvis panel.

Widgets share one canonical frame — draggable, resizable, three modes (minimized / normal / expanded), each widget a `{ compact card, expanded command center }` pair.

---

## Desktop & phone

**Desktop (Electron).** Forks the backend as a child process, lives in the system tray, and adds the piece I like most: a **Desktop Takeover Overlay** — a frameless, transparent, click-through, always-on-top, content-protected, multi-display-aware window that makes it *visually unmistakable* when JARVIS is driving your machine. `Ctrl+Alt+Escape` is a hard emergency stop; `Ctrl+Alt+Space` pauses and resumes.

**Phone.** A five-tab app (home, send, screen, camera, feed) over an authenticated WebSocket. Pairing is a 6-character code plus a server-rendered QR, with permission tiers chosen at approval time (upload-only / screen-viewer / admin). A **Cloudflare Quick Tunnel** starts automatically so pairing works from any network with zero configuration — and if it isn't up, the UI says so plainly rather than showing a QR that cannot work.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  React 19 + Vite 8  ·  5 entry points  ·  81k lines           │
│  JarvisUI shell → HoloGlobe (Three.js) → rooms + widgets       │
└────────────────────────────┬─────────────────────────────────┘
                             │  /api/*  ·  /mesh/ws
┌────────────────────────────┴─────────────────────────────────┐
│  Node HTTP server · :8799 · 363 routes · 54k lines            │
│                                                               │
│  agent-runtime ──► gemini-models (registry + failover)         │
│       │                                                        │
│       ├──► capability-engine (129 tools · risk · approvals)    │
│       │        ├── computer-use ......... visible desktop      │
│       │        ├── universal-browser .... headless DOM         │
│       │        └── browser-service ...... Playwright           │
│       │                                                        │
│       ├──► memory-vnext (214 STRICT tables · AES-GCM · DPAPI)  │
│       ├──► neural-vault (legacy — still authoritative)         │
│       ├──► action-fabric (event-sourced · emergency stop)      │
│       └──► mesh-hub (WebSocket) ──► tunnel-manager             │
└───────────────────────────────────────────────────────────────┘
```

No Express — routing is hand-rolled on raw pathnames. Storage is SQLite (`better-sqlite3`) throughout.

**Stack.** React 19 · Vite 8 · TypeScript 6 · Three.js + `@react-three/fiber`/`drei`/`postprocessing` · deck.gl · MapLibre · `lightweight-charts` (TradingView OSS) · ECharts · d3 · GSAP + Motion · Zustand · TanStack Query · Zod · Yjs · Playwright · Electron 42 · better-sqlite3.

---

## Quick start

Requires **Node 20+**. **Windows** is needed for the DPAPI-backed secret store and UI-Automation desktop control; the web UI and most of the backend run cross-platform.

```bash
git clone https://github.com/devanshagrawal0/Jarvis_.git
cd Jarvis_
npm install
cp .env.example .env      # every key is optional — the app boots with none
```

```bash
npm start        # backend  → http://127.0.0.1:8799
npm run dev      # frontend → http://127.0.0.1:5173
```

```bash
npm run app:dev         # …or the desktop app, which starts the backend itself
npm run test:backend    # 503 tests on Node's built-in runner
npm run check           # syntax + typecheck + production build
```

---

## Keys & configuration

**Everything is optional except `GEMINI_API_KEY`**, and many sources need no key at all (GDELT, SEC EDGAR, NWS, Binance, Coinbase, Yahoo, Treasury, Stooq). Missing keys disable features rather than breaking startup.

| Group | Variables |
|---|---|
| **Brain** *(required)* | `GEMINI_API_KEY` |
| Market data *(free tiers)* | `APEX_FINNHUB_KEY` · `APEX_TIINGO_KEY` · `APEX_FRED_KEY` · `APEX_MARKETAUX_KEY` · `APEX_ALPHAVANTAGE_KEY` · `APEX_COINGECKO_KEY` |
| Research | `BRAVE_SEARCH_API_KEY` · `EXA_API_KEY` · `NEWS_API_KEY` |
| Optional models | `OPENAI_API_KEY` · `ANTHROPIC_API_KEY` |
| Integrations | `GITHUB_TOKEN` · `FIGMA_ACCESS_TOKEN` · `HIGGSFIELD_API_KEY` · `INSTAGRAM_*` · `GOOGLE_*` |
| Prediction markets | `KALSHI_API_KEY_ID` · `KALSHI_PRIVATE_KEY` |
| Runtime | `JARVIS_HOST` · `JARVIS_RUNTIME_DIR` · `JARVIS_BROWSER_HEADLESS` · `JARVIS_DESKTOP_CONTROL_DRY_RUN` |

Secrets live in `runtime/`, which is **gitignored and never committed** — it holds the encrypted vault, the local SQLite stores, and a browser profile with live session cookies.

---

## Engineering discipline

**503 backend tests** across 69 files, on Node's built-in runner.

The document I'd point a reviewer at is [`docs/JARVIS_DEEP_AUDIT.md`](./docs/JARVIS_DEEP_AUDIT.md) — a 51-finding internal audit of the memory system, the tool and automation lanes, and the core brain. Its central finding names the dominant defect class:

> ### A check that cannot fail is a bug.

Guards whose condition was always true. Tests that still passed with the original bug reinstated. Counters reporting zero because nothing ever incremented them. A canary allowlist that matched **zero** facts for two days while reporting perfect health. A deletion path that had never once deleted. A cutover gate satisfied by a boolean the caller supplied about itself.

The discipline that came out of it, and which the tests here follow: **reinstate the original bug and confirm the new test goes red.** A test that passes both before and after a fix has proven nothing. That mutation step caught several of my own would-be fixes that were quietly vacuous.

---

## Project structure

```
server/              63 modules + 9 subsystems · 54k lines
  memory-vnext/        214-table encrypted memory · 35 repositories
  automation/          lane router · navigation memory · entity resolver
  action-fabric/       event-sourced tasks · emergency stop
  apex/  arbiter/      room backends
  providers/           Kalshi, market data, connectors
src/
  JarvisUI.tsx         the live shell
  globe-room/          globe · command bar · 17 widgets
  rooms/
    apex/                11 tabs · 68 files · THE FORGE
    helix/v2/            11 surfaces · 3D knowledge graph
    synapse/             cross-machine collaboration
  phone/               phone app
electron/            desktop shell · takeover overlay
tests/backend/       69 files · 503 tests
docs/                audit · specs · screenshots
```

---

## Status & disclaimer

A personal project, built in the open, actively under construction. The overwhelming majority of the code was written in collaboration with AI — which is the point: an experiment in how far one person can push a system when the assistant is a genuine collaborator rather than autocomplete.

**Nothing here is financial advice.** APEX and Arbiter are research and visualisation tools. Every trading surface is paper-only with no broker path. Market data comes from free public sources and may be delayed, incomplete or wrong.

**It can control your computer.** Read the [security section](#security--trust), remember the emergency stop (`Ctrl+Alt+Escape`), and don't point it at anything you can't afford to have clicked.

<div align="center">
<br/>
<sub>Built by <b>Dev</b> · <a href="./docs/JARVIS_DEEP_AUDIT.md">Read the audit</a></sub>
</div>
