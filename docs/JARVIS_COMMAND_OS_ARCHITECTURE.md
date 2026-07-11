# Jarvis Command OS Architecture Plan

Status: planning document for a full rebuild. The current UI is rejected as a prototype and should not be polished into production.

Date: 2026-06-15
Workspace: `C:\Users\devan\OneDrive\Documents\Kalshi\jarvis-ui`

## 1. Executive Direction

The product should not be a themed dashboard. It should feel like a personal command operating system that can listen, see, reason, route work, and surface the right instruments only when they matter.

The UI must feel like a professional lab or mission-control workstation with cinematic holographic layers. The reference point is not a random neon website. The reference point is a serious adaptive command surface: NASA Open MCT style operational density, Jayse Hansen and Territory Studio style cinematic screen language, and modern browser-native AI workflows.

The interface should be:

- Spatial, not tabbed.
- Adaptive, not static.
- Functional, not fake.
- Calm, not childish.
- Dense where needed, but never cramped.
- Cinematic at boot and during transitions, but quiet during work.
- Permission-aware and explicit about what it can and cannot control.

The assistant should be able to:

- Route commands through Gemini automatically.
- Control local Jarvis features without exposing model choices.
- Scan camera and screen with browser permissions.
- Work with Kalshi market data.
- Manage a real canvas workspace.
- Inspect local Codex projects.
- Launch and monitor subagent-style tasks.
- Pair with a phone and expose Twilio-compatible voice webhooks.
- Draft emails and task plans.
- Shift between Study, Prepare, Project, Market, Vision, Phone, Media, and Command modes.
- Verify its own feature flows with Playwright and visible trust states.

## 2. Failure Modes From The Current Prototype

The current app should be considered a failed visual and interaction prototype for these reasons:

1. It looks like a web dashboard with sci-fi skin, not a command OS.
2. The floating widgets are visually cheap and not truly useful.
3. The central core reads as decorative noise, not a meaningful state engine.
4. The widgets overlap and compete with the center.
5. The mode system changes labels/colors more than the actual workspace.
6. The boot sequence is a CSS overlay, not a cinematic system assembly.
7. Some progress and verification states are fake.
8. Agent tasks feel like random logs rather than an operational mission board.
9. The bottom command bar is too ordinary and visually heavy.
10. Interaction affordances are weak: close, move, pin, inspect, summon, and minimize patterns are not good enough.
11. The visual hierarchy is noisy and hard to read.
12. The Google font import violates the existing local design guidance.
13. The UI overuses cyan and generic HUD lines.
14. The Higgsfield-generated assets were not directed carefully enough at first.
15. The app needs real module architecture before more visual experimentation.

Correction: rebuild the shell around real modules, real workspaces, and a professional cinematic system language.

## 3. Research References

### Product And UI References

- [NASA Open MCT](https://github.com/nasa/openmct) and [Open MCT docs](https://nasa.github.io/openmct/): use as the grounding reference for professional mission-control density, telemetry, object inspection, and non-childish operational UI.
- [MARCCHERGGI/jarvis-home](https://github.com/MARCCHERGGI/jarvis-home): study the cinematic desktop shell, Earth zoom, HUD reveal, and pluggable brain concept.
- [jarvis-openclaw-assistant/stark-systems](https://github.com/jarvis-openclaw-assistant/stark-systems): use as vanilla HTML/CSS/JS reference for boot sequence, arc-reactor composition, and panel reveal mechanics. Verify license before copying any code.
- [cam-hm/jarvis](https://github.com/cam-hm/jarvis): study voice assistant flow, Three.js arc-reactor interface, and realtime responses.
- [ishaan1013/jarvis](https://github.com/ishaan1013/jarvis): study gesture-controlled 3D hologram architecture with MediaPipe/OpenCV/WebSockets/Next.js. Treat as inspiration if license is unclear.
- [harsh-raj00/my-jarvis](https://github.com/harsh-raj00/my-jarvis): study React/Three/Gemini structure, particle sphere, voice orb, boot flow, and plugin ideas.
- [mkr-infinity/jarvis](https://github.com/mkr-infinity/jarvis): study desktop assistant direction, voice capabilities, and Electron/FastAPI split.
- [Arwes](https://github.com/arwes/arwes): study sci-fi UI animation/sound patterns, but do not force an Arwes rewrite unless it improves maintainability.
- [Jayse Hansen HUD work](https://jayse.tv/v2/?portfolio=hud-2-2): visual inspiration only. Do not copy Marvel assets, layouts, names, marks, or sounds.
- [Perception Iron Man 2](https://www.experienceperception.com/work/iron-man-2/): visual inspiration for transparent table interfaces and holographic interaction.
- [Territory Studio Age of Ultron](https://territorystudio.com/project/marvels-avengers-age-of-ultron/): visual inspiration for darker lab screens, AI diagnostics, robotics, and serious screen language.

### Implementation References

- [Three.js](https://threejs.org/) and [Three.js examples](https://threejs.org/examples/): central hologram, particle systems, bloom, depth, camera transitions.
- [Three.js UnrealBloomPass docs](https://threejs.org/docs/pages/UnrealBloomPass.html): cinematic glow and high-quality bloom.
- [GSAP docs](https://gsap.com/docs/v3/GSAP/): boot choreography, timeline sequencing, panel transitions.
- [Motion docs](https://motion.dev/docs): future React motion path.
- [Rive](https://rive.app/) and [Rive features](https://rive.app/features): interactive vector animation engine for voice orb, boot glyphs, and state machines.
- [MediaPipe Hand Landmarker Web docs](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js): gesture control path.
- [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): camera and microphone permission behavior.
- [MDN getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia): screen capture permission behavior.
- [MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API): browser voice support and limitations.
- [Gemini API docs](https://ai.google.dev/gemini-api/docs) and [Gemini models docs](https://ai.google.dev/gemini-api/docs/models): automatic brain routing and model capability discovery.
- [Kalshi API docs](https://docs.kalshi.com/): public market data and future authenticated trading gates.
- [Twilio Voice Webhooks](https://www.twilio.com/docs/usage/webhooks/voice-webhooks): phone number and call bridge integration path.

## 4. Installed Libraries For The Rebuild

Already installed locally in `jarvis-ui`:

- `three`: WebGL 3D scene, hologram, camera, particles.
- `gsap`: cinematic sequencing and mode transitions.
- `@mediapipe/tasks-vision`: camera/gesture path.
- `echarts`: serious data visualization for markets, telemetry, calibration, and portfolios.
- `lottie-web`: lightweight boot and subsystem animations.
- `@rive-app/canvas`: stateful interactive vector animations, especially voice orb and command status.

Recommended for the rebuild:

- `vite`, `typescript`, `react`, `react-dom`
- `zustand` or a small custom store
- `@tanstack/react-query` if the API surface grows
- `lucide-react` for quiet professional icons
- `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` if moving 3D scene into React
- `motion` if React UI transitions need layout-aware animation

## 5. Product Model

Jarvis Command OS has five layers:

1. Command Layer: user input, voice input, wake phrase, global command palette.
2. Brain Layer: automatic Gemini routing, local fallback, tool routing, memory, permissions.
3. Workspace Layer: modes, canvas, projects, markets, agents, vision, phone, media.
4. Instrument Layer: contextual widgets, inspectors, charts, transcripts, previews.
5. Trust Layer: verification, permissions, audit log, confirmations, kill switch.

The user never chooses the model. The user gives an objective. Jarvis selects the right route based on:

- Intent
- Data sensitivity
- Required modality
- Required tool
- Risk level
- Current mode
- Connection state
- Available keys/providers
- Verification requirements

## 6. Frontend Architecture

### Direction

Use Vite + React + TypeScript for the next rebuild. The current vanilla DOM-string approach makes complex interactive workspaces too brittle.

### Shell Layout

The UI should be a real workstation shell:

- Center: active command run and primary workspace.
- Left rail: compact mode/object launcher, not tabs.
- Right inspector: selected object details, provider state, permissions, artifacts.
- Bottom command strip: voice orb, command input, active run status, kill switch.
- Overlay layer: cinematic boot, modal approvals, screen/camera capture surface.
- 3D layer: hologram scene behind or inside the active workspace, not as meaningless scribbles.

### Core Interaction Pattern

The user should be able to say or type:

- "Jarvis, scan my screen and explain this."
- "Open Kalshi and build a thesis for weather markets."
- "Launch two agents: one checks the repo, one tests the UI."
- "Prepare me for tomorrow's call with Alex."
- "Draft the email but do not send it."
- "Pair my phone."
- "Open my canvas for this project."

Jarvis should:

1. Parse intent.
2. Select workspace.
3. Summon only needed instruments.
4. Show tool routing.
5. Ask confirmation if action is risky.
6. Execute allowed actions.
7. Verify result.
8. Log outcome.

## 7. Visual Direction

### Use

- Dark command-room base.
- Subtle cyan/white/gold accents.
- Red only for risk, threat, or failed verification.
- Real operational panels with clear titles and useful data.
- Floating instruments that snap to zones and never cover the main content unless summoned.
- Holographic depth through parallax, blur, thin lines, and shadow, not huge glow.
- Slow camera moves and physical transitions.
- Data visualizations that map to real state.
- Boot sequence that assembles modules and checks real connections.
- Mode workspaces that change structure, not just color.

### Avoid

- Rainbow neon.
- Fake numbers.
- Random terminal spam.
- Marvel logos, exact Iron Man/JARVIS branding, suit silhouettes, or copied HUD assets.
- Big decorative reactor with no function.
- Floating card soup.
- Tiny unreadable all-caps labels.
- Overlapping panels.
- Heavy hero text.
- A bottom bar that looks like a website contact form.
- Tabs as primary navigation.

### Mode-Specific Workspace Feel

- Command: minimal, centered active run, global suggestions, queue, trust state.
- Markets: ECharts market grid, event inspector, watchlist, risk preview, thesis builder.
- Projects: repo/object browser, file summaries, running tasks, test results, Codex queue.
- Vision: large camera/screen preview, overlay annotations, capture history, analysis inspector.
- Canvas: spatial infinite board with nodes, links, screenshots, agents, and generated diagrams.
- Agents: mission board, role lanes, run replay, verification state, artifacts.
- Phone: pairing surface, call lifecycle, webhook state, approvals, mobile command feed.
- Study: quiet focus chamber, timer, notes, flashcards, quiz panel, spaced repetition.
- Prepare: briefing packet, email composer, agenda, rehearsal, source cards.
- Media: ambient mode, queue, recommendations, voice-first controls.
- Settings: credentials, provider status, permissions, vault, audit.

## 8. Boot Sequence And Higgsfield Visual Pipeline

The boot should not be a fake loader. It should be a cinematic system assembly.

### Boot Sequence Phases

1. Black room wake:
   - Low hum.
   - Small central light.
   - No UI panels yet.

2. Holographic table assembly:
   - Thin wireframe grid rises from the bottom.
   - Particle lines trace the command table.
   - Camera pushes forward.

3. Subsystem formation:
   - Brain, voice, vision, markets, projects, agents, phone, canvas, and verification glyphs assemble around the table.
   - Each glyph maps to a real readiness check.

4. Identity and permission check:
   - Brain key status.
   - Mic/camera/screen permission state.
   - Phone bridge state.
   - Kalshi public data state.

5. Ready state:
   - The active workspace opens.
   - Command orb becomes interactive.
   - First suggested actions appear.

### Higgsfield Asset Plan

Use Higgsfield for original visual assets, not functional UI logic.

Assets to generate:

1. Command table hero still: dark lab, holographic table, empty center for UI overlay.
2. Boot storyboard still 1: single reactor spark in black space.
3. Boot storyboard still 2: wireframe grid assembling upward.
4. Boot storyboard still 3: floating subsystem glyphs forming around the table.
5. Vision mode still: camera scan overlay style reference.
6. Market mode still: professional probability grid reference.
7. Project mode still: code/repo operations bay reference.
8. Phone bridge still: secure communications relay reference.
9. Canvas mode still: holographic node graph reference.
10. Media mode still: ambient orbital visualizer reference.

Video generation:

- Preferred: Seedance 2.0, 8 to 12 seconds, 16:9, cinematic boot sequence.
- Current limitation: the Higgsfield account previously blocked video generation due to plan restrictions. If video generation remains blocked, use storyboard stills plus local Three.js/Rive/Lottie animation.
- Do not use any prompt that can become a product, shoe, sneaker, car ad, or random object.

Example Higgsfield prompt:

```text
Original premium AI command operating system boot sequence, dark futuristic lab, holographic table assembling from blue-white particles, wireframe grids rising from the floor, subsystem glyphs forming in orbit, cinematic camera push, professional mission-control UI, readable empty center for overlay, no people, no products, no shoes, no logos, no Marvel assets, no text, no cartoon, no rainbow neon, no clutter.
```

## 9. Backend Architecture

Keep the Node server initially, but split it into modules.

### Modules

- `config`: settings, environment variables, key status, secret masking.
- `events`: server-sent events for live run updates.
- `commands`: parse commands, create runs, maintain run state.
- `brain`: Gemini route/respond, local fallback, model discovery hidden from user.
- `projects`: scan projects, safe open, future file summaries.
- `markets`: Kalshi public market data, watchlists, thesis builder, future auth gates.
- `vision`: analyze camera/screen frames.
- `phone`: pairing, Twilio webhook, phone command, approvals.
- `canvas`: nodes, edges, artifacts, export.
- `agents`: mission board, subagent task records, run replay.
- `higgsfield`: generated asset jobs, job status, saved assets.
- `email`: draft/search/send gates.
- `verification`: real checks, not random confidence.
- `permissions`: provider/permission state.
- `audit`: high-risk action log and kill switch.

### Event Model

Every action should become a run:

```json
{
  "id": "run_...",
  "type": "brain|vision|market|project|agent|phone|email|canvas|verify",
  "status": "queued|running|needs_approval|blocked|failed|verified|complete",
  "intent": "string",
  "mode": "string",
  "inputs": {},
  "outputs": {},
  "events": [],
  "verification": {}
}
```

### Secret Rule

The browser never receives raw API keys. It only receives:

```json
{
  "hasGeminiKey": true,
  "keySource": "env|local|missing",
  "providers": {
    "gemini": "ready",
    "twilio": "missing",
    "kalshi": "public-only"
  }
}
```

## 10. The 50 Feature Architecture

### Core Brain And Routing

1. Gemini Automatic Brain Router
   - Routes prompts to Gemini, Codex, local tools, web, vision, Kalshi, phone, or agents.
   - Endpoint: `POST /api/brain/route`
   - Verify: mixed prompts route correctly.

2. Multi-Model Response Arbiter
   - Compares Gemini, local fallback, web/tool output, and verifier results.
   - Endpoint: `POST /api/brain/arbitrate`
   - Verify: mocked competing outputs choose the right source.

3. Command Memory Graph
   - Stores people, projects, preferences, recurring workflows, files, and decisions.
   - Endpoints: `GET/POST /api/memory`, `GET /api/memory/search`
   - Verify: add memory, reload, recall in command response.

4. Natural Command Parser
   - Converts text/speech into structured intent, slots, confidence, required permissions.
   - Endpoint: `POST /api/commands/parse`
   - Verify: ambiguous command triggers confirmation.

5. Action Confirmation Layer
   - Blocks risky actions: trades, calls, emails, deletes, OS control, purchases.
   - Endpoint: `POST /api/actions/confirm`
   - Verify: risky action cannot execute before approval.

### Voice, Vision, And Ambient Input

6. Voice Activation
   - Wake phrase and local activation state.
   - Endpoint: `POST /api/voice/session`
   - Limit: microphone permission required.
   - Verify: listening state and fallback.

7. Push-To-Talk Command Bar
   - Focused input with transcript editing.
   - Endpoint: `POST /api/voice/transcribe`
   - Verify: shortcut opens command overlay.

8. Speaker Identification
   - Optional voice profile for security and personalization.
   - Endpoint: `POST /api/voice/identify`
   - Limit: biometric opt-in required.
   - Verify: fixture voice matches profile.

9. Camera Scene Scan
   - Captures frame and analyzes objects/documents.
   - Endpoint: `POST /api/vision/camera-scan`
   - Limit: camera permission required.
   - Verify: camera denied and fixture allowed states.

10. Screen Scan
   - User-selected screen/window/tab analysis.
   - Endpoint: `POST /api/vision/screen-scan`
   - Limit: cannot capture silently.
   - Verify: user-click flow and result rendering.

11. OCR And Document Read
   - Extracts text from images, screenshots, PDFs, forms.
   - Endpoint: `POST /api/vision/ocr`
   - Verify: fixture text appears.

12. Visual Command Grounding
   - Maps "click that" or "summarize this" to visual targets.
   - Endpoint: `POST /api/vision/ground-command`
   - Limit: OS clicking needs native helper.
   - Verify: coordinates map to UI element.

### Workspace, Canvas, And Codex Projects

13. Unified Canvas
   - Infinite board for notes, files, screenshots, agents, charts, plans.
   - Endpoints: `GET/POST /api/canvas`, `PATCH /api/canvas/:id`
   - Verify: nodes persist after reload.

14. Canvas Command Nodes
   - Nodes can run prompts, scripts, Codex tasks, and data queries.
   - Endpoint: `POST /api/canvas/nodes/:id/run`
   - Verify: output attaches to node.

15. Codex Project Registry
   - Indexes local projects, branches, docs, tests, dev servers.
   - Endpoints: `GET /api/codex/projects`, `POST /api/codex/index`
   - Verify: local project metadata renders.

16. Codex Task Launcher
   - Starts scoped tasks with test plan and branch policy.
   - Endpoint: `POST /api/codex/tasks`
   - Verify: task lifecycle appears.

17. Project Snapshot Timeline
   - Stores summaries, diffs, decisions, tests, screenshots.
   - Endpoint: `GET/POST /api/projects/:id/snapshots`
   - Verify: snapshot appears in timeline.

18. File And Artifact Inbox
   - Drop files, screenshots, links, transcripts into triage.
   - Endpoints: `POST /api/inbox/items`, `GET /api/inbox`
   - Verify: file fixture preview appears.

### Subagents And Task Board

19. Subagent Task Board
   - Kanban for researcher, coder, verifier, planner, operator agents.
   - Endpoints: `GET/POST /api/agents/tasks`, `PATCH /api/agents/tasks/:id`
   - Verify: drag task and persist status.

20. Agent Capability Registry
   - Defines available tools, permissions, trust levels, and limits per agent.
   - Endpoint: `GET/POST /api/agents/registry`
   - Verify: capability toggle changes routing.

21. Parallel Research Agents
   - Splits research across sources, then synthesizes citations.
   - Endpoint: `POST /api/agents/research`
   - Verify: multiple child runs and synthesis.

22. Verifier Agent
   - Checks claims, code, screenshots, and task completion.
   - Endpoint: `POST /api/agents/verify`
   - Verify: false claim fails.

23. Human Escalation Queue
   - High-judgment items go to review.
   - Endpoint: `GET/POST /api/escalations`
   - Verify: uncertain trade/email creates escalation.

24. Agent Run Replay
   - Shows prompts, tools, permissions, outputs, errors, artifacts.
   - Endpoint: `GET /api/agents/runs/:id`
   - Verify: event log ordering.

### Kalshi, Finance, And Decisioning

25. Kalshi Market Scanner
   - Watch markets, spreads, volume, triggers.
   - Endpoints: `GET /api/kalshi/markets`, `POST /api/kalshi/watchlist`
   - Verify: watchlist alert.

26. Kalshi Thesis Builder
   - Builds probability thesis from sources, prices, assumptions.
   - Endpoint: `POST /api/kalshi/thesis`
   - Verify: assumptions table exists.

27. Trade Ticket Drafting
   - Drafts order ticket with price, size, max loss, payout.
   - Endpoint: `POST /api/kalshi/tickets`
   - Limit: final submit requires explicit confirmation.
   - Verify: submit disabled until approved.

28. Portfolio Risk Dashboard
   - Exposure, concentration, P/L, max loss, correlation.
   - Endpoint: `GET /api/portfolio/risk`
   - Verify: mock portfolio risk warnings.

29. Market Event Explainer
   - Explains why a market moved using price/news/data.
   - Endpoint: `POST /api/markets/explain-move`
   - Verify: price jump fixture gets explanation.

30. Prediction Journal
   - Logs forecasts, confidence, resolution, calibration.
   - Endpoints: `GET/POST /api/predictions`
   - Verify: calibration chart updates.

### Phone, Email, Tasks, And Communications

31. Phone Calling Bridge
   - Twilio/VoIP/native companion places calls, logs results.
   - Endpoints: `POST /api/phone/call`, `POST /api/phone/webhook`
   - Limit: browser alone cannot own a carrier number.
   - Verify: mocked provider lifecycle.

32. SMS And Messaging Bridge
   - Drafts, sends with approval, receives replies, summarizes threads.
   - Endpoints: `GET/POST /api/messages`
   - Verify: confirmation before send.

33. Email Command Center
   - Search, draft, summarize, label, follow-up, send with approval.
   - Endpoints: `GET /api/email/search`, `POST /api/email/draft`, `POST /api/email/send`
   - Verify: draft works, send blocked until approved.

34. Task Manager Sync
   - Local tasks plus Todoist/Google/Microsoft sync.
   - Endpoints: `GET/POST /api/tasks`, `POST /api/tasks/sync`
   - Verify: task sync badge.

35. Calendar Planner
   - Focus blocks, calls, reminders, prep windows, conflicts.
   - Endpoints: `GET/POST /api/calendar/events`
   - Verify: conflict warning.

36. Contact Intelligence
   - Relationship notes, recent context, next actions.
   - Endpoints: `GET/POST /api/contacts`
   - Verify: contact context appears.

### Modes And Daily Operating System

37. Study Mode
   - Syllabus, flashcards, summaries, quizzes, spaced repetition.
   - Endpoint: `POST /api/modes/study/session`
   - Verify: quiz generated from notes.

38. Prepare Mode
   - Briefing packets for meetings, interviews, calls, markets, travel.
   - Endpoint: `POST /api/modes/prepare/brief`
   - Verify: briefing sections render.

39. Project Mode
   - Active goals, files, blockers, agents, commits, next actions.
   - Endpoint: `GET /api/modes/project/:id`
   - Verify: project workspace renders.

40. Entertainment Mode
   - Movies, music, games, ambient plans, watch queue.
   - Endpoint: `POST /api/modes/entertainment/recommend`
   - Verify: ranked recommendations appear.

41. Morning Command Brief
   - Calendar, tasks, markets, weather, messages, priorities.
   - Endpoint: `GET /api/briefs/morning`
   - Verify: digest cards from mock data.

42. Evening Review
   - Completed work, unresolved items, forecasts, tomorrow setup.
   - Endpoint: `POST /api/briefs/evening`
   - Verify: review reflects completed tasks.

### Proactive Widgets And Interface

43. Proactive Widget Rail
   - Contextual instruments for markets, tasks, calendar, agents, inbox, health.
   - Endpoints: `GET/POST /api/widgets`
   - Verify: reorder and persist.

44. Contextual Suggestion Cards
   - Suggest next actions from time, visible state, active project, commitments.
   - Endpoint: `GET /api/suggestions`
   - Verify: relevant suggestion appears.

45. Notification Orchestrator
   - Routes alerts to desktop, phone, email, silent queue.
   - Endpoint: `POST /api/notifications/route`
   - Verify: urgency changes channel.

46. Universal Command Palette
   - Search actions, files, contacts, agents, modes, app commands.
   - Endpoints: `GET /api/search`, `POST /api/commands/run`
   - Verify: keyboard-only execution.

### Verification, Permissions, And Security

47. Verification Matrix
   - Every feature declares unit, integration, browser, provider mock, human approval.
   - Endpoint: `GET /api/verification/matrix`
   - Verify: each feature has coverage status.

48. Permission Ledger
   - Tracks mic, camera, screen, files, email, phone, calendar, Kalshi, agents.
   - Endpoints: `GET/POST /api/permissions`
   - Verify: dependent features lock/unlock.

49. Security Vault
   - Stores API keys, OAuth tokens, secrets encrypted and masked.
   - Endpoints: `POST /api/vault/secrets`, `GET /api/vault/status`
   - Verify: raw secret never appears in browser.

50. Audit And Kill Switch
   - Global pause for agents/actions and immutable high-risk log.
   - Endpoints: `POST /api/security/kill-switch`, `GET /api/audit`
   - Verify: running mock job stops.

## 11. Feature Module Map

### Module A: Command Runtime

Owns:

- Runs
- Intent parsing
- Command history
- Active route
- Confirmation state

Initial endpoints:

- `POST /api/commands`
- `GET /api/runs`
- `GET /api/runs/:id`
- `GET /api/events`

### Module B: Brain

Owns:

- Gemini key status
- Automatic model selection
- Prompt templates
- Multimodal routing
- Local fallback

Initial endpoints:

- `POST /api/brain/respond`
- `POST /api/brain/route`
- `GET /api/brain/status`

### Module C: Workspace

Owns:

- Mode state
- Layout
- Active object
- Workspaces

Initial endpoints:

- `GET /api/workspaces`
- `POST /api/workspaces/switch`
- `GET/POST /api/widgets`

### Module D: Vision

Owns:

- Camera capture frames
- Screen capture frames
- OCR
- Object/scene analysis
- Visual command grounding

Initial endpoints:

- `POST /api/vision/analyze-frame`
- `POST /api/vision/ocr`

### Module E: Markets

Owns:

- Kalshi public data
- Watchlist
- Thesis builder
- Ticket drafts
- Risk gate

Initial endpoints:

- `GET /api/kalshi/markets`
- `GET /api/kalshi/markets/:ticker`
- `POST /api/kalshi/thesis`
- `POST /api/kalshi/tickets`

### Module F: Projects And Codex

Owns:

- Project registry
- Project snapshots
- Task requests
- Test status
- Dev server status

Initial endpoints:

- `GET /api/projects`
- `POST /api/projects/open`
- `POST /api/codex/tasks`

### Module G: Agents

Owns:

- Mission board
- Agent registry
- Run replay
- Verifier jobs
- Artifacts

Initial endpoints:

- `GET/POST /api/agents/tasks`
- `PATCH /api/agents/tasks/:id`
- `GET /api/agents/runs/:id`

### Module H: Phone And Comms

Owns:

- Phone pairing
- Twilio webhook
- SMS/call future integration
- Email drafts
- Approvals

Initial endpoints:

- `GET /api/phone/pair`
- `GET/POST /api/phone/voice`
- `POST /api/phone/voice-command`
- `POST /api/email/draft`

### Module I: Higgsfield Assets

Owns:

- Generated visuals
- Job states
- Asset library
- Quota/provider errors

Initial endpoints:

- `POST /api/higgsfield/jobs`
- `GET /api/higgsfield/jobs/:id`
- `GET /api/higgsfield/assets`

### Module J: Trust

Owns:

- Verification matrix
- Permission ledger
- Audit log
- Secret vault
- Kill switch

Initial endpoints:

- `GET /api/verification/matrix`
- `POST /api/verify/run`
- `GET/POST /api/permissions`
- `GET /api/audit`
- `POST /api/security/kill-switch`

## 12. Data Objects

### Run

```ts
type Run = {
  id: string;
  type: "command" | "brain" | "vision" | "market" | "project" | "agent" | "phone" | "email" | "canvas" | "verify";
  status: "queued" | "running" | "needs_approval" | "blocked" | "failed" | "verified" | "complete";
  mode: string;
  intent: string;
  createdAt: string;
  updatedAt: string;
  events: RunEvent[];
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  verification?: VerificationResult;
};
```

### Workspace

```ts
type Workspace = {
  id: string;
  title: string;
  activeObjectId?: string;
  instruments: string[];
  layout: WorkspaceLayout;
};
```

### Instrument

```ts
type Instrument = {
  id: string;
  kind: "chart" | "inspector" | "preview" | "mission" | "composer" | "timeline" | "permission" | "artifact";
  title: string;
  state: "hidden" | "collapsed" | "active" | "pinned" | "blocked";
  sourceRunId?: string;
};
```

### Permission

```ts
type PermissionState = {
  id: "mic" | "camera" | "screen" | "files" | "gemini" | "kalshi" | "phone" | "email" | "calendar";
  status: "ready" | "missing" | "prompt" | "blocked" | "provider_needed";
  reason?: string;
};
```

## 13. Verification Plan

Every milestone must pass these before being considered done:

1. `npm run check`
2. Typecheck
3. Lint
4. API smoke tests
5. Browser open via Playwright
6. Console errors and warnings clean
7. Desktop screenshot at `1440x1000`
8. Mobile screenshot at `390x844`
9. No incoherent overlap
10. No horizontal scroll on mobile
11. WebGL canvas nonblank pixel check
12. Reduced-motion mode check
13. Permission denied state for camera
14. Permission denied state for screen
15. Voice unsupported fallback
16. Gemini missing-key fallback
17. Gemini key saved without exposing raw key
18. Kalshi public markets load
19. Trade submit blocked until confirmation
20. Phone webhook returns valid TwiML
21. Email draft renders
22. Agents can be created and updated without wiping inputs
23. Canvas nodes persist
24. Verification matrix shows real checks, not random confidence
25. Kill switch stops mock actions

## 14. Playwright Scenario Matrix

### Boot

- Open app.
- Wait for boot complete.
- Assert shell visible.
- Assert no console errors.
- Screenshot desktop and mobile.

### Command Routing

- Type: "scan my screen and explain it."
- Assert Vision workspace opens.
- Assert screen capture requires click/permission.

### Gemini Setup

- Open Settings.
- Enter fake key.
- Test returns setup error without leaking key.
- If real key is present, test returns ready.

### Kalshi

- Switch to Markets.
- Search "weather".
- Assert market results or explicit empty state.
- Draft ticket.
- Assert submit is blocked by approval.

### Canvas

- Switch to Canvas.
- Create node.
- Connect node.
- Save.
- Reload.
- Assert node exists.

### Projects

- Switch to Projects.
- Load workspace projects.
- Open safe project path.
- Attempt bad path and assert blocked.

### Agents

- Create mission.
- Move status.
- Open run replay.
- Verify event log.

### Phone

- Pair phone.
- Assert PIN and LAN URL.
- Assert TwiML endpoint valid XML.
- Mock phone command.

### Vision

- Camera denied state.
- Fixture image analysis.
- Stop stream cleanup.

### Study

- Start timer.
- Generate quiz from notes.
- Pause/reset.

### Prepare

- Draft email.
- Rehearse questions.
- Send action remains approval-gated.

### Entertainment

- Ask for movie/music mode.
- Assert recommendations surface.
- Autoplay warning if media cannot play.

## 15. Security And Permission Rules

1. Never expose raw Gemini keys to the browser.
2. Never execute trades without explicit confirmation.
3. Never send emails without explicit confirmation.
4. Never place phone calls without explicit confirmation.
5. Never silently capture screen.
6. Never silently open camera or microphone.
7. Never browse or index private files outside the approved workspace.
8. Never let an agent perform destructive actions without a permission grant.
9. Always show provider limitations clearly.
10. Always keep a visible kill switch.

## 16. Hard Limits

### Browser Limits

- Screen capture cannot be silent. `getDisplayMedia` requires user selection and permission.
- Camera/microphone cannot be silent. `getUserMedia` requires permission.
- Web Speech recognition is not supported in every browser.
- Browser apps cannot fully control the OS without a native helper.
- Browser apps cannot place carrier phone calls without a provider/native bridge.

### Provider Limits

- Higgsfield video generation may require a paid plan depending on model.
- Twilio or another provider is required for a real phone number.
- Email/calendar/task sync needs OAuth provider setup.
- Kalshi trading requires authenticated API credentials and compliance gates.
- Gemini quality depends on key, quota, and selected endpoint availability.

## 17. Rebuild Phases

### Phase 0: Freeze The Prototype

- Keep current files as legacy reference.
- Stop polishing the rejected UI.
- Create an architecture branch.
- Preserve generated assets, but do not rely on them.

### Phase 1: Backend Stabilization

- Split server into modules.
- Add run model.
- Add event stream.
- Replace fake verification with real check records.
- Keep current working endpoints.

### Phase 2: React/Vite Shell

- Add Vite + React + TypeScript.
- Build app shell, command strip, workspace layout, settings panel.
- Serve under `/next` first.
- Verify desktop/mobile.

### Phase 3: Command Runtime

- Implement command parser.
- Implement brain route.
- Implement run timeline.
- Add confirmation layer.
- Add kill switch.

### Phase 4: Real Workspaces

- Markets workspace.
- Projects workspace.
- Vision workspace.
- Canvas workspace.
- Agents workspace.
- Phone workspace.
- Study/Prepare/Media workspaces.

### Phase 5: Cinematic Visual System

- Replace fake reactor with meaningful 3D object.
- Add Rive or Lottie voice orb.
- Add boot sequence from real subsystem checks.
- Add mode transition choreography.
- Add reduced-motion support.

### Phase 6: Higgsfield Visual Assets

- Generate storyboard stills.
- If plan allows, generate boot video.
- Otherwise build boot locally from stills, Three.js, Rive, and GSAP.
- Add job/asset manager.

### Phase 7: Verification Lock

- Full Playwright matrix.
- Screenshot review.
- Console clean.
- Pixel checks.
- Permission checks.
- API smoke tests.

## 18. Definition Of Done

The rebuild is not done until:

- The UI no longer reads as a website.
- There is no tab-primary navigation.
- Each mode is a distinct workspace.
- All visible widgets are useful and interactive.
- The boot sequence has real subsystem checks.
- Gemini setup is one-place and automatic.
- Voice/camera/screen states are permission-correct.
- Kalshi, projects, canvas, agents, phone, prepare, study, and media have working flows.
- Risky actions require confirmation.
- Playwright screenshots pass desktop and mobile.
- Console has no errors or warnings.
- The final app can be opened at `http://localhost:8799`.

