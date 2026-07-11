# JARVIS Command OS

> A local-first, AI-native **command center** for your desktop — a Jarvis-style assistant with a reasoning brain, a layered long-term memory, live browser/screen tools, device-mesh phone pairing, and a set of immersive 3D "rooms." Its flagship room is **APEX**, a trading command center whose centrepiece is **THE FORGE** — an AI-native quant strategy & bot builder with a real backtesting engine.

Built with React 19 + TypeScript + Three.js on the front end, a Node.js brain/agent server on the back end, and an Electron shell for the desktop app.

---

## Table of contents

- [What is this?](#what-is-this)
- [Feature highlights](#feature-highlights)
- [Architecture](#architecture)
- [The rooms](#the-rooms)
  - [Jarvis Home / HUD](#jarvis-home--hud)
  - [APEX — Trading Command Center](#apex--trading-command-center)
  - [THE FORGE — quant strategy & bot builder](#the-forge--quant-strategy--bot-builder)
  - [Other rooms](#other-rooms-globe--boston--phone--widget-lab)
- [How the AI brain works](#how-the-ai-brain-works)
- [How memory works](#how-memory-works)
- [Device Mesh (phone pairing)](#device-mesh-phone-pairing)
- [Tech stack & dependencies](#tech-stack--dependencies)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [NPM scripts](#npm-scripts)
- [Project structure](#project-structure)
- [Heavy assets](#heavy-assets)
- [Security & privacy](#security--privacy)
- [Status & disclaimer](#status--disclaimer)

---

## What is this?

Jarvis Command OS is a personal "operating system for an AI assistant." Instead of a single chat box, it's a set of **rooms** — full-screen, mostly-3D workspaces — that share one brain (an LLM-backed agent runtime) and one memory. You talk to Jarvis from a persistent command bar; it can answer, run tools (browser, screen, files, web search, market data), remember what matters, and act across the rooms.

The most developed room is **APEX → THE FORGE**: a genuinely functional quant lab where you compose trading strategies as node graphs, backtest them on real public market data with a no-look-ahead engine, and stress-test them with overfitting checks, walk-forward analysis, Monte-Carlo, evolutionary optimization, and an AI "improver."

Everything runs **locally**. Market data comes from free public APIs; the AI brain is pluggable (Gemini by default). No data leaves your machine unless you wire up a cloud key.

---

## Feature highlights

- 🧠 **AI brain** — Gemini-backed reasoning with an agent runtime, tool routing, and a capability engine.
- 🗄️ **Layered memory** — a "Neural Vault" that stores facts as both human-readable files and SQLite rows, with decay, governance, and procedural (skill) memory.
- 📈 **APEX trading room** — live market ribbon, dossiers, news river, correlation/RRG, watchlists, and a real alert engine — all from **public** data (shareable).
- 🔨 **THE FORGE** — node-graph strategy builder, a deterministic backtest engine (single- and multi-symbol portfolio), a 6-tab analysis dock, an always-on Strategy Health rail, plus Improver / Sentinel / Darwin / Terraform / Meta-Labeler / Genesis / Oracle tools.
- 🌐 **Immersive rooms** — a cyberpunk 3D globe room, a holographic Boston map, a phone companion, and a widget lab.
- 📱 **Device Mesh** — pair your phone via QR to send text/links/files and mirror screens.
- 🖥️ **Desktop app** — Electron shell, packageable for Windows/macOS.
- ☁️ **Optional Cloudflare** deploy path (Pages + Workers).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND  (Vite · React 19 · TypeScript · Three.js/R3F)     │
│  - Multi-page: index / phone / widget-lab / globe / globe-   │
│    room / boston-map                                         │
│  - Rooms live under src/rooms/** and src/features/**         │
│  - Talks to the backend over /api/** (Vite proxy → :8799)    │
└───────────────▲──────────────────────────────────────────────┘
                │  HTTP + WebSocket (/api, /mesh, /agent)
┌───────────────┴──────────────────────────────────────────────┐
│  BACKEND  (Node.js · server.js + server/**)                  │
│  - Agent runtime & tool gateway (agent-runtime.js)           │
│  - Brain providers (server/providers/**, Gemini default)     │
│  - Memory system (memory-*.js, neural-vault.js)              │
│  - APEX data + DB (apex-db.js, apex-ingest.js)               │
│  - Device mesh hub, capability engine, mission engine        │
│  - SQLite persistence under runtime/ (git-ignored)           │
└───────────────▲──────────────────────────────────────────────┘
                │
┌───────────────┴──────────────────────────────────────────────┐
│  DESKTOP  (Electron · electron/main.cjs + preload.cjs)       │
│  wraps the frontend + backend into a native app window.      │
└──────────────────────────────────────────────────────────────┘
```

- **Ports:** frontend dev server `5173`, backend `8799` (Vite proxies `/api` → `8799`).
- **Data model:** each room persists to its own SQLite tables under `runtime/` (never committed).

---

## The rooms

### Jarvis Home / HUD
The landing HUD: an animated background, a holographic command bar ("Ask Jarvis anything…"), and the entry point to every room. Typing a room name (e.g. `apex`) opens it. The command bar is context-aware — it knows which room you're in and can act on it.

### APEX — Trading Command Center
A shareable trading room (public data only, so it can be demoed safely). Top nav, a **live market ticker**, and a tabbed workspace: **Home** (command deck — dossiers with candlesticks, a briefing system, news river, correlation / RRG / volatility, watchlists, a real alert engine), plus **Forge, Live Markets, Portfolio, Paper Trading, Backtesting, Trading Bots, Live Testing**. A persistent **Jarvis Assistant** bar at the bottom (Analyst / Trader / Quant / Research modes) can answer questions about anything on screen.

### THE FORGE — quant strategy & bot builder
The flagship. A command-center layout with three panels + a docked analysis area:

**Left — Library**
Tabs (Library / Projects / Blocks), search + filters, **Quick-Start Template** cards, and a **Strategy Blocks** palette (Universe, Signals, Filters, Risk, Position Sizing, Entries, Exits, Execution, Portfolio Constraints, Analytics) you drag onto the canvas.

**Center — Builder canvas + analysis dock**
- **Visual Builder** — the strategy *is* a colour-coded **node graph** (Universe → Signals → Entry Logic → Exit / Execution / Sizing / Risk) with a tool rail, minimap, and pan/zoom. A **Forms** mode lets you edit every field directly.
- **Python / Transcript / Research** tabs — a read-only code scaffold generated from the spec, a provenance log of every change, and a per-strategy notes pad.
- **Docked analysis dock (6 tabs)** — **Backtest Results** (metrics + equity curve + per-symbol contribution), **Monte-Carlo** (block-bootstrap distribution), **Parameter Heatmap** (121-cell Terraform sweep), **Walk-Forward Matrix**, **Trade Distribution**, **Path Analysis**, plus **History** (version timeline + A/B diff).

**Right — Strategy Health rail**
An always-on report card: a health-score gauge + checklist (data integrity, logic, backtest quality, sample size, robustness), an out-of-sample performance grid, mini equity/drawdown sparklines, a rule-based **Jarvis Analysis** (strengths / considerations / warnings / recommendations + readiness-to-deploy), an experiment queue, and the deep-analysis tools.

**The engines (all real, client-side, no look-ahead):**
- **Backtest engine** — deterministic, next-bar-open fills, modeled slippage + commission; **single-symbol** and a **multi-symbol portfolio** engine (shared cash, up to *N* concurrent positions, per-symbol contribution).
- **The Improver** — a recursive diagnosis tree that builds a per-trade ledger, runs testers, grows a tree of confirmed weaknesses, and emits staged **action cards** you can apply and re-backtest.
- **Overfitting Sentinel** — Deflated Sharpe (trial-count-aware), walk-forward with embargo, parameter-jitter robustness, Monte-Carlo → a trust score.
- **Darwin** — a genetic algorithm that evolves the spec toward better risk-adjusted fitness.
- **Terraform** — a 2-parameter sweep rendered as a fitness landscape / heatmap.
- **Meta-Labeler** — an out-of-sample (k-fold CV) logistic model that filters low-confidence trades.
- **Genesis** — goal → strategy generator ("a low-drawdown momentum bot for NVDA").
- **Signal Upload Studio** — drop a `.py`/`.ipynb`, watch a staged analysis, get a derived signal (with its runnable code + retrieval method stored, well-labeled).
- **Portfolio (HRP)** — blend several strategies with hierarchical risk parity.

> **Universe:** by default a strategy backtests a ~30-name liquid large-cap basket (not a single ticker). Trim it, pick a preset (Mega-cap Tech, Index ETFs, Sectors, Semis, Dow 10, Crypto, or **All Large-cap**), or type your own.

### Other rooms (Globe · Boston · Phone · Widget Lab)
- **Globe Room** — a cyberpunk 3D globe workspace (Three.js / R3F).
- **Boston Hologram** — a holographic 3D map of Boston / Northeastern.
- **Phone** — a companion PWA surface for the device mesh.
- **Widget Lab** — a sandbox for the widget system.

> Note: the Globe and Boston rooms rely on heavy 3D/texture assets that are **git-ignored** (see [Heavy assets](#heavy-assets)); the core Jarvis + APEX + Forge experience needs none of them.

---

## How the AI brain works

Jarvis routes every request through an **agent runtime** (`server/agent-runtime.js`):

1. **Prepare** — classify intent/complexity and pick a route (conversation vs. tool-use vs. research). Some sources (e.g. the Forge) force a direct conversation route.
2. **Provider** — call the configured LLM (Google **Gemini** by default via `GEMINI_API_KEY`; OpenAI optional). A budget cap keeps latency bounded.
3. **Tools** — a **tool gateway** exposes capabilities (web search, browser control, screen/computer use, files, market data, memory) that the model can call.
4. **Capability engine** — registers each room's tools so Jarvis can act on what you're looking at (e.g. `apex_forge`, `apex_report`).
5. **Evidence gate** — the assistant is discouraged from asserting unverified facts; generative UI surfaces (like the Forge) bypass this gate for composing.

Everything is streamed back to the UI over `/api/**` (+ WebSocket for live updates).

---

## How memory works

Jarvis has a layered, persistent memory ("Neural Vault / MemoryOS") stored **both** as human-readable files and SQLite rows under `runtime/` (git-ignored):

- **Capture** — `memory-extractor.js` pulls durable facts out of conversations and actions.
- **Store** — `memory-store.js` / `neural-vault.js` write each memory as an object (file + row) with metadata (type, source, importance).
- **Types** — *user* (who you are), *feedback* (how Jarvis should work), *project* (ongoing work), *reference* (links/resources), plus **procedural memory** (`procedural-memory.js`) for learned skills.
- **Decay** — `memory-decay.js` ages memories so stale ones fade and important ones persist.
- **Governance** — `memory-governance.js` deduplicates, resolves conflicts, and keeps the store honest.
- **Recall** — memories relevant to the current context are surfaced back into the brain's prompt, so Jarvis remembers across sessions.

Query endpoints: `/api/memory-os/v4/query`, `/api/memory-os/v4/agents`. Files live under `runtime/neural_vault/memory_os/`.

> Because memory is personal, the entire `runtime/` directory is **never committed**.

---

## Device Mesh (phone pairing)

1. Start Jarvis on the laptop, open the **Devices** panel, click **Generate QR**.
2. Scan on your phone and pair. Use `/mesh` on the phone to send text, links, files/photos, heartbeats, and screen-preview requests.
3. Phone QR links must use LAN / Tailscale / Cloudflare — **not** `localhost`.

Repair/health routes: `GET /mesh/health`, `GET /mesh/pair?code=…`, `POST /mesh/api/inbox/{text,link,upload}`, `POST /mesh/api/self-test`.

---

## Tech stack & dependencies

**Frontend:** React 19, TypeScript, Vite 7, Three.js + @react-three/fiber/drei, Framer Motion, Zustand, cmdk, Recharts/visx-style charts (custom SVG), MapLibre GL (Boston), lucide-react icons.

**Backend:** Node.js (ES modules + CommonJS mix), `better-sqlite3`, `ws` (WebSocket), `express`-style routing in `server.js`, Playwright (browser tools), provider SDKs (Google Generative AI, OpenAI).

**Desktop:** Electron + electron-builder.

**Tooling:** Playwright (visual + feature tests), Wrangler (optional Cloudflare), TypeScript, ESLint.

> Full lists are in `package.json` (`dependencies` / `devDependencies`). Install pulls everything.

---

## Getting started

### Prerequisites
- **Node.js 20+** and npm
- Windows / macOS / Linux (desktop packaging is per-OS)
- (Optional) a **Gemini API key** for the brain, and any [APEX data keys](#environment-variables) you want

### Install & run

```bash
# 1. install
npm install

# 2. configure keys (optional but recommended)
cp .env.example .env        # then fill in the keys you have

# 3a. run the web app (frontend + backend)
npm start                   # backend  → http://127.0.0.1:8799
npm run dev                 # frontend → http://127.0.0.1:5173  (in a second terminal)

# 3b. OR run the desktop app
npm run app:dev
```

Then open **http://127.0.0.1:5173** and type a room name (e.g. `apex`) in the command bar.

### Build

```bash
npm run build               # production web build (dist/)
npm run app:build:win       # Windows portable desktop app
npm run app:build:mac       # macOS dmg/zip (on macOS)
```

### Cloudflare (optional)

```bash
npm run cf:build && npm run cf:deploy
```

---

## Environment variables

Copy `.env.example` → `.env`. **Nothing is required to boot** — the app degrades gracefully and many data sources need no key. Highlights:

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Jarvis reasoning brain (primary) |
| `OPENAI_API_KEY` | optional alternate model |
| `APEX_FINNHUB_KEY`, `APEX_TIINGO_KEY`, `APEX_FRED_KEY`, `APEX_MARKETAUX_KEY`, `APEX_ALPHAVANTAGE_KEY`, `APEX_COINGECKO_KEY` | APEX market data (all free tiers) |
| `BRAVE_SEARCH_API_KEY`, `EXA_API_KEY`, `NEWS_API_KEY` | web/news research tools |
| `GITHUB_TOKEN`, `FIGMA_ACCESS_TOKEN`, `GOOGLE_*`, `INSTAGRAM_*`, `HIGGSFIELD_API_KEY` | optional integrations |
| `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY` | Kalshi event-contract trading (optional) |

See `.env.example` for the full annotated list and `JARVIS_CREDENTIALS_SETUP.md` for provider setup details.

---

## NPM scripts

| Script | What it does |
|---|---|
| `npm start` | run the backend (`node server.js`, port 8799) |
| `npm run dev` | run the frontend dev server (Vite, port 5173) |
| `npm run build` | production web build |
| `npm run check` | typecheck + `node --check server.js` + build |
| `npm run app:dev` | run the Electron desktop app |
| `npm run app:build:win` / `:mac` | package the desktop app |
| `npm run test` | full suite (check + backend + feature tests) |
| `npm run test:backend` / `test:feature` | targeted test suites |
| `npm run cf:deploy` | build + deploy to Cloudflare |

(See `package.json` for the complete list, including memory-OS and device-mesh test/repair scripts.)

---

## Project structure

```
jarvis-ui/
├─ index.html · phone.html · widget-lab.html · globe*.html · boston-map.html   # Vite entry points
├─ vite.config.mjs · tsconfig*.json · package.json
├─ server.js                      # backend entry (agent brain, APIs, mesh)
├─ server/                        # backend modules
│  ├─ agent-runtime.js · tool-gateway.js · capability-engine.js
│  ├─ providers/                  # LLM providers (Gemini, …)
│  ├─ memory-*.js · neural-vault.js · procedural-memory.js
│  ├─ apex-db.js · apex-ingest.js # APEX market data + storage
│  └─ mesh-hub.js · mission-engine.js · …
├─ electron/                      # main.cjs + preload.cjs (desktop shell)
├─ public/                        # static assets (icons, manifests, apex bg, …)
├─ src/
│  ├─ main.tsx · App.tsx          # app roots
│  ├─ rooms/
│  │  └─ apex/                    # APEX room + THE FORGE (forge/**)
│  ├─ features/ · components/ · pages/ · phone/
│  ├─ globe-room/ · boston-hologram/   # 3D rooms
│  └─ api.ts · liveVoice.ts · …
├─ scripts/                       # build / test / analysis scripts
├─ docs/                          # deep-dive guides
└─ .env.example · .gitignore
```

The Forge lives under `src/rooms/apex/forge/` — `ForgeView.tsx` (UI), `forge-engine.ts` (backtest engine), `ForgeDock.tsx` / `ForgeGraph.tsx` / `ForgeStudio.tsx`, and the `improver/` engines (sentinel, darwin, terraform, meta, genesis, analyze…).

---

## Heavy assets

To keep the repo lean, large binary media are **git-ignored** and not shipped: `*.mp4`, `*.glb`/`*.gltf`, `*.blend`, high-res textures under `public/globe-room/**` and `public/boston/**`, big geojson, and everything in `design/generated/**`. The **core app (Jarvis + APEX + Forge)** needs none of these. The **Globe** and **Boston** rooms will look bare without their 3D models/textures — supply them locally (drop them back into `public/`) if you want those rooms.

---

## Security & privacy

- **No secrets are committed.** `.env`, `runtime/` (memory, DBs, screen captures), `*.dpapi`, and credential JSON are all git-ignored. All API keys are read from `process.env` — none are hardcoded.
- **Local-first.** Data lives on your machine under `runtime/`. Market data is fetched from public APIs; nothing is sent to a third party unless you configure a cloud key.
- If you fork/deploy this, **rotate any keys** and keep them in `.env` or your platform's secret store.

---

## Status & disclaimer

This is an ambitious personal project — some rooms/features are polished, others are experimental. **THE FORGE is not financial advice.** Backtests use public data and modeled costs; past performance says nothing about the future. Do your own research before risking real money.
