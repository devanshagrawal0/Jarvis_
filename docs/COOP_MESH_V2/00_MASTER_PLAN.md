# Synapse — Master Build Plan

*The junction where two Jarvis brains connect. A dedicated widget + full-screen room for real, cross-machine, two-person collaboration between two independently-owned Jarvis instances — live presence, a WebRTC call, dual chat, shared missions, shared memory, and a hard security boundary.*

**Product/widget/room name:** **Synapse.** (Backend engine keeps its code name `coop-symbiote`; UI/product is Synapse. Components: `SynapseWidget.tsx`, `SynapseRoom.tsx`, `syn-*` CSS, `src/globe-room/synapse/*`.)

Status: **PLAN v2 — LOCKED, hardened via 3-pass review (2026-07-14), pre-build.**
Author pass: 3-bot research (Transport & Security · Capabilities · UI/UX) → synthesized → 3-loop hardening (architecture/ordering · security/correctness · completeness/ambition). Change-log in §11.
Aligns with: `[[jarvis-project]]`, `[[jarvis-coding-rules]]`, `[[jarvis-build-reference]]`, `[[jarvis-widget-design]]`, `[[eclipse-spec]]`, `[[arbiter-integration]]`, `[[feedback_server_restarts]]`, `[[feedback_commit_cadence]]`.

---

## 0. The one-sentence truth

Everything the collaboration *feels* like — sessions, chat, Patch Court, ghost sandbox, debate, memory packets, skill transfer, replays, the ability envelope, the secret scanner — **is already built** in `server/coop-symbiote.js`. What is genuinely missing is only four things:

1. **Rendezvous** — a way for a guest's 6-digit code on machine B to resolve to the host's session on machine A (today `joinSession` matches the code against the *local* store, so cross-machine join is structurally impossible).
2. **An authenticated E2E channel** between two mutually-untrusting strangers (Noise XX with human-verifiable fingerprints).
3. **A guest capability lease** that keeps the host sovereign over disk writes (extend `server/eclipse/capabilities/lease.js`, don't rebuild).
4. **The WebRTC data + media planes** (shared state + the call), with a WS-relay fallback so it never dies on hostile networks.

We already own the signaling server (`server/mesh-hub.js` relays `rtc_signal`, has rooms, heartbeat), the public URL (`server/tunnel-manager.js` Cloudflare tunnel), and the authority algebra (Eclipse leases). **The gap is narrower than it looks.**

---

## 0.5 Synapse is a WIDGET first, a room second

Per `[[jarvis-widget-design]]`, Synapse enters the app as a canonical **`WidgetShell` tile** — it lives on the board like every other Jarvis widget, then **expands to the full-screen room** when engaged.

- **`<SynapseWidget>`** (compact, on the board) — a live-status card using the canonical WidgetShell pattern (accent = Synapse cyan `--syn-cyan`). It shows: session state pill (`idle / hosting · code 776-893 / live · 2 here / guest`), a **facepile** of present participants (with live/idle rings), unread badges (chat · patches · call), a transport-health dot, and a primary action that changes with state — **Start a session** / **Join with a code** / **Enter room**. Tick-flash on new activity, live/stale badge, focus reticle — all the standard widget liveliness. This is the "when I enter a co-op thing" surface: it's always visible, always truthful about session state.
- **`<SynapseRoom>`** (expanded, full-viewport overlay) — the dedicated room in §3. Opening = the widget's "Enter room" action, `⌘⇧S`, or auto-open on an inbound join request. Closing collapses back to the widget; the session keeps running in the widget's status.

The widget is the persistent anchor (glanceable, honest); the room is the workspace. Both share one state store (§3.2) so they never disagree.

---

## 1. Architecture

### 1.1 The transport stack (primary + fallback chain)

```
Session code (6-digit, host-minted) + host key fingerprint (in the invite QR/link)
        │
  1. SIGNALING (control plane) — over the host's NAMED tunnel (see §9)
     Guest → wss://<host-stable-url>/mesh/coop/ws
     carries: join request, Noise XX handshake, ICE candidates, host approval
        │
  2. DATA PLANE (bulk collab traffic) — best available path:
     PRIMARY   WebRTC DataChannel  (P2P, E2E, host↔guest direct, STUN)
     FALLBACK-1 WebRTC DataChannel relayed via Cloudflare ephemeral TURN
     FALLBACK-2 Noise-sealed frames tunneled over the signaling WS (host relays) ← never dies
     FALLBACK-3 LAN / Tailscale (100.x) direct
        │
  3. MEDIA PLANE (the call) — a SECOND WebRTC PeerConnection
     audio (Opus) · video (VP8/9/AV1) · screen (getDisplayMedia) · optional Jarvis-TTS track
```

**Topology: host-as-server (primary).** The host exposes a stable public HTTPS/WS URL (named Cloudflare tunnel / Tailscale funnel per the §9 decision); the guest connects directly to the host's `/mesh/coop/ws`. The host is the authority anyway (owns the filesystem, applies patches), so anchoring the connection there matches the trust model and reuses `mesh-hub.js` almost verbatim. A third-party rendezvous relay (Cloudflare Worker + Durable Object) is a **fallback only**.

**Why WebRTC DataChannel for the data plane:** once signaling completes, chat/tasks/patch-metadata/cursors/CRDT updates flow peer-to-peer, off our infrastructure, SCTP ordered+reliable with built-in DTLS. Signaling is small and mandatory; the bulk never touches the tunnel.

**Why the WS-relay fallback is non-negotiable:** ~8–15% of P2P attempts fail even with TURN on hostile networks. The host already holds an authenticated signaling WS to the guest, so we degrade to shipping the *same* Noise-sealed CRDT frames over that socket. Slower, host-mediated, never dead — strictly better than today (which is dead).

**STUN/TURN:** Google public STUN + **Cloudflare Realtime TURN** ($0.05/GB, **1,000 GB/mo free**). TURN creds are **ephemeral, HMAC-time-limited**, minted host-side only after approval (`username=<unixExpiry>:<sessionId>`, `credential=base64(HMAC-SHA1(username, secret))`).

### 1.2 Shared-state consistency — CRDT (Yjs), not OT

Peer-to-peer with either side able to drop → CRDTs converge without a guaranteed-online authority. **Yjs**: smallest bundle, **no WASM** (clean for Vite + the no-build ethos), mature `Y.Array`/`Y.Map`/`Y.Text`, awareness protocol for presence.

```
Y.Doc "coop:<sessionId>"
 ├─ Y.Array chat        (append-only feed)
 ├─ Y.Array tasks       (Kanban board; concurrent edits merge)
 ├─ Y.Map   patches     (patch METADATA/status — never file bytes)
 ├─ Y.Map   presence    (awareness: cursor, selection, "viewing file X" — ephemeral)
 └─ Y.Text  canvas      (shared scratch/whiteboard)
```

**What is NOT a CRDT:** file contents and patch *application*. Source-of-truth is the host's real filesystem, hashed (`baseHash`). Patches keep the existing **propose → ghost-test → host-approve → apply** flow with the base-hash guard. CRDTs coordinate *proposals and discussion*; the host's disk is the linearizable authority for *applies*. Never let a CRDT write your friend's edits straight to disk.

**Reconnect/durability:** Yjs state-vector delta sync on reconnect; host persists `Y.encodeStateAsUpdate` into the session JSON (atomic write) so a dropped guest catches up and the doc survives a host restart. Host is the persistence anchor; guest is a replica.

### 1.3 What runs where

| Plane | Runs on | Module |
|---|---|---|
| Signaling WS | **Host** `node server.js` | `mesh-hub.js` extended + new `/mesh/coop/ws` room |
| Rendezvous by code | Host publishes stable URL bound to code; guest resolves | new `server/coop-transport.js` |
| WebRTC peer (data + media) | **Both** browsers | new `src/globe-room/synapse/synRtc.ts` + `synCall.ts` |
| Noise E2E | **Both** browsers | `synNoise.ts` (`noise-protocol`, `tweetnacl` fallback) |
| CRDT doc | **Both** browsers; host is durable persist point | `synDoc.ts` (Yjs) |
| Capability leases | **Host** | `server/coop-leases.js` (wraps `eclipse/capabilities/lease.js`) |
| TURN | Cloudflare Realtime (external) | creds minted host-side |

### 1.4 The node↔browser authority bridge *(added in Pass 1 — was a gap)*

Each participant runs **two** things: a **Jarvis node server** (the authority — owns the filesystem, DPAPI secrets, patch-apply, mission launch) and a **browser** (the Synapse UI — holds the RTC peer + the Yjs doc). The RTC/CRDT link is **browser↔browser**. So a side-effect a guest *proposes* must cross three hops to become real, and the authority hop is one-way:

```
GUEST browser ──RTC(Noise)──▶ HOST browser ──local authed API──▶ HOST node ──▶ disk
   (proposal only)              (renders it in Patch Court)      (host human clicks Apply)
```

**Hard rules (enforced, not conventions):**
- The **host node never accepts a side-effecting command that arrived over the RTC/signaling channel.** Apply / mission-launch / screen-control requests are accepted **only** from the host's own **local authenticated browser session** (the existing `validateMutationRequest` local-session gate) — the same gate that already rejects curl POSTs. A guest frame can *populate* Patch Court (a proposal, over CRDT) but can never *be* the apply call.
- The guest's browser talks to the **host's** node **never directly** — only via the host browser relaying an explicit, human-initiated action. The guest's own node is *its* authority for *its* private side-channel (§4.6) and nothing on the host.
- Every RTC→UI-surfaced proposal is tagged `origin: guest` and carries the guest's lease id; the host UI shows provenance; the apply path re-checks `actor == host-local-session`.

This is what makes "the guest is never side-effecting" (§2.2) *true at the wire*, not just at the flag.

---

## 2. Security & trust model (the guardrails)

The whole existing mesh assumes **one owner** (`verifyToken → my device registry`). Synapse introduces a **stranger**. Central rule: **a Synapse guest gets a co-op *lease*, never a device token — it must never ride the device-mesh auth path.**

### 2.1 Hardened join handshake (7 steps)

```
Host A                     Signaling (host WS)                 Guest B
 createSession() → code (6-digit display), codeHash=HKDF(code),
   hostNoiseStatic(X25519) pinned, publish {codeHash→instance}
                     (1) guest enters code + host URL/QR ──────────┤
                     (2) wss://host/mesh/coop/ws {coop_pending,
                          codeProof=HMAC(salt,code), guestEphemeralPub}
 ◄── (3) verify codeProof constant-time · GLOBAL + per-CLIENT-IP rate limit ─┤
 (4) Noise XX handshake  (mutual auth + forward secrecy) ◄────────►
     → both pin peer static key → human-verifiable safety-number
 (5) HOST APPROVAL GATE (human) — sees name, device, key fingerprint,
     repo match, requested capabilities → Approve mints the LEASE
 (6) WebRTC perfect-negotiation (host=impolite, guest=polite);
     SDP/ICE travel INSIDE the Noise channel → DataChannel opens
 (7) authenticated session: every frame Noise-sealed, lease-scoped
```

**Fixes to current weaknesses:**
- **Code-spray gap (real bug):** today's rate limit keys on `codeHash`, so spraying *random* codes gets a fresh bucket each time → bypassable. Fix = **global + per-client-IP** limiter (20/min/IP, 100/min global, backoff).
- **Per-IP behind a tunnel (Pass 2 fix):** behind a named Cloudflare tunnel / Tailscale funnel, `req.socket.remoteAddress` is the tunnel's IP, so naïve per-IP limiting collapses to one bucket. **Read the real client IP from `CF-Connecting-IP`** (Cloudflare) / the Tailscale peer identity, validated against a trusted-proxy allowlist so the header can't be spoofed by a direct connection. Per-IP limiting keys on *that*.
- **Code as PAKE-password, not bearer token:** pair the 6-digit code with the host's **public-key fingerprint delivered out-of-band** (extend `inviteUrls()` to carry a truncated `hostKeyFp`). Code authorizes the join; the pinned host key stops an evil/wrong host answering; the code is confirmed *inside* the Noise handshake so a MITM without it can't complete. (Optional W-hard upgrade: SPAKE2/OPAQUE so the code never crosses the wire at all.)
- **Single-use + 5-min pre-approval expiry**; invalidate on first successful Noise completion.
- **`codeProof` not `code`** on the wire; constant-time compare.
- **Noise XX** (`Noise_XX_25519_ChaChaPoly_BLAKE2b`): neither stranger knows the other's static key in advance; yields mutual auth, forward secrecy, and a Signal-style safety number the two humans can read to each other.

### 2.2 Capability lease across the boundary (extend Eclipse, don't rebuild)

Guest gets a **root co-op lease** at approval; every guest action is `verify()`-checked against it. `narrow()` is monotonically-narrowing and `verify()` catches tamper/expiry/revoke → a guest can never widen its own authority.

```
New coop scopes (additive to lease.js SCOPES):
  coop.chat  coop.task.write  coop.patch.propose  coop.source.readtree
  coop.source.readfile  coop.bridge.msg  coop.memory.packet
  coop.skill.offer  coop.call.join  coop.cursor.share  coop.canvas.write

Guest root lease @ approval:
  scopes  = intersection(host-granted abilities, guest-requested)
  globs   = ["coop:session/<id>/*"]     ← this session only
  sideEffecting = false                 ← guest is NEVER side-effecting
  mayDelegate = false · depth = 1        ← can't sub-delegate your authority
  expiresAt = session end or 4h
```

**Guest CAN:** read safe manifest + safe file contents; chat; create tasks; send bridge messages; run debates; **propose** patches + request ghost tests; **offer** skills/memory packets (host accepts); join the call; share cursor/canvas.

**Guest CANNOT (host stays sovereign):** **apply** a patch (host-local-session-only per §1.4); read any blocked path or secret-bearing file (denylist + value-scan run **on the host** before anything crosses the wire); touch `.env`/keys/DPAPI vault/private neural-vault; run terminal/live-edit/remote-control (off by default; if ever enabled, per-action host confirmation, not a standing lease); escalate (`mayDelegate=false` + depth cap).

### 2.3 Secret boundary — enforcement points

1. **At rest:** DPAPI (`secret-store.js`) — per-Windows-user, inherently non-portable.
2. **At manifest/read time:** `isBlockedPath` + `scanSecrets` (already there).
3. **At the semantic layer, before CRDT commit (Pass 2 fix):** Yjs deltas are **binary** — scanning the wire bytes won't catch a pasted key. So `scanSecrets` runs on the **string value before it is inserted into `Y.Array chat` / `Y.Text canvas` / a task title** (client-side pre-commit + host-side on receive as defense-in-depth). Reject or redact, surface a "secret blocked" chip.
4. **At egress, for structured payloads:** file/patch/skill-manifest/memory-packet payloads (not raw CRDT binary) pass a final `scanSecrets` gate in `coop-transport.js`. **Universal across payload types, not per-endpoint.**

### 2.4 Audit trail

`record()` already writes every event to `session.timeline` + append-only `logs/events.jsonl` + neural vault. **Extend** each event with: peer Noise static-key fingerprint, transport mode (`webrtc-p2p`/`turn`/`ws-relay`), lease id, monotonic sequence number → tamper-evident, per-peer, attributable.

### 2.5 Session resume after a host restart *(added in Pass 2 — was a gap)*

The Y.Doc persists across a host restart but the **Noise session key does not** (forward secrecy — keys are ephemeral, never written to disk). On host restart or tunnel-URL change:
- The guest's channel drops; the widget shows `reconnecting…`.
- Resume = a **fresh Noise handshake**, but skip the full approval gate with a **short-lived resume token**: at approval the host issues `resumeToken = sign(hostStatic, {sessionId, guestStaticFp, exp: +30min})`. On reconnect the guest presents it; the host verifies the signature + that the guest static key matches the pinned one, and re-establishes the channel **without** a second human approval (within the window). Past the window → full re-approval. Token is single-use and rotated each reconnect.
- Yjs state-vector delta sync then catches the guest up. No lost work.

---

## 3. The Synapse room (expanded UI)

A **full-viewport overlay room** (`position:fixed; inset:0; z-index:900`) over the globe room with a backdrop blur — a spatial layer, not a page swap. Opened from the `<SynapseWidget>` (§0.5), `⌘⇧S`, or auto-open on inbound join. Holds the holographic cyan / dark-glass language. New files `SynapseRoom.tsx` + `SynapseRoom.css` (`syn-*` namespace).

### 3.1 Zone map (12-col grid, full height)

```
┌──────────────────────────────────────────────────────────────────┐
│  A · SESSION HEADER  (mode · status · invite code/QR · timer · End)│ 56px
├────────┬─────────────────────────────────────────────┬────────────┤
│  B     │            C · SHARED WORKSPACE              │  D · CALL  │
│PRESENCE│   (diff / canvas / debate / screen)          │  (tiles,   │
│ RAIL   │   + live-cursor overlay                      │  voice/vid/│
│ 232px  ├─────────────────────────────────────────────┤  screen)   │
│        │        F · TIMELINE / REPLAY SCRUBBER        │  300px     │
├────────┴─────────────────────────────────────────────┴────────────┤
│  E · DUAL CHAT DOCK  (⟵ Collaborator | Private Jarvis ⟶) + Tasks  │ ~260px
└──────────────────────────────────────────────────────────────────┘
grid-template-columns: 232px minmax(0,1fr) var(--call-w,300px)
```

- **A · Session Header** — mode chip (5-mode flyout), status pill (`idle/hosting/live/guest`), repo-match badge, invite cluster (big-mono code + QR popover + copy), session timer, End (confirm-guarded). Pulses amber on `pendingJoin`.
- **B · Presence / Roster Rail** — facepile (per-participant color ring, ghosted=recent/solid=live), participant cards (avatar, role, status line "editing App.tsx", speaking meter, mic/cam), Jarvis participants (diamond avatar + "thinking…" shimmer), the **Choreographer** (§3.3), hover-**Follow**, **Wave** gesture.
- **C · Shared Workspace** — mode-driven stage w/ view switcher: **Diff/Patch view** (file tree from `/manifest`, side-by-side syntax diff, inline Patch Court actions), **Shared canvas** (whiteboard-lite, P2), **Debate view** (two-column Jarvis-vs-Jarvis transcript), **Screen view** (device-mesh live frame + control-baton overlay). Absolutely-positioned **live-cursor overlay** (colored arrows + labels + fading trails, ~33ms throttle), **Follow ribbon**.
- **D · Call Panel** — Discord/Zoom-grounded tile grid (speaking ring brightens on voice, screen-share promotes to large tile), controls (mic, **push-to-talk** on held Space, camera, screen-share, leave), call-active breathing vignette, spatial-audio pan (P2). Collapses to a "Join call" strip when idle. Ship order: screen-tile (existing frames) → voice → video.
- **E · Dual Chat Dock** — **Collaborator chat** (`/chat` + `/bridge`, color-coded, inline system events) **and** a visually-walled **Private Jarvis chat** (violet, "Private · only you", talks to your *own* brain; §3.4) **and** a compact **Tasks/Patch Court strip**.
- **F · Timeline / Replay Scrubber** — event ticks (patches/joins/chat/calls/skills) on a track; scrubber head play/pause replays the session (`/replays`, `/replays/:id/skill`). Collapsed 28px → expands 96px.

### 3.2 Component tree + shared state

```
<SynapseWidget/>                  // board tile; expands to →
<SynapseRoom>                     // fixed overlay, owns session state + WS/RTC
├─ <SynScrim/>
├─ <SessionHeader/> → <ModePicker/> <InviteCluster/>→<QRPopover/> <SessionTimer/> <EndSessionButton/>
├─ <JoinRequestBanner/>           // conditional (pendingJoin)
├─ <NarrationTicker/>             // Choreographer output
├─ <SynBody>
│  ├─ <PresenceRail/> → <Facepile/> <ParticipantCard×n/> <FollowControl/>
│  ├─ <SharedWorkspace/> → <WorkspaceSwitcher/> {<DiffView/>|<SharedCanvas/>|<DebateView/>|<ScreenView/>} <LiveCursorLayer/> <FollowRibbon/>
│  ├─ <CallPanel/> → <CallTileGrid/>→<CallTile×n/> <CallControlBar/>
│  ├─ <TimelineScrubber/>
│  └─ <SuggestionChips/>          // Choreographer chips
├─ <ChatDock> → <SharedChat/> <PrivateJarvisChat/> <TasksStrip/>
└─ <EmergencyStopButton/>         // reused device-mesh safety
```

**State:** one `useSynapseSession()` store shared by the widget and the room (single source of truth so they never disagree). Mirrors `DeviceMeshCommandCenter`'s `action(name, work, message)` optimistic + toast pattern. `useSynChannel(sessionId)` opens the WS/RTC, dispatches `presence|cursor|chat|patch|activity`, falls back to 2s poll if the channel is down.

### 3.3 The Session UX Agent — "Choreographer" (the dedicated UI bot)

A Jarvis-diamond participant (violet-cyan) devoted to **driving the surface**, not the code. Hook `useSessionChoreographer(session, presence, callState) → { layout, narration[], suggestions[], focusMode }`. **Zero side effects of its own** — suggestions are *proposed*; the user clicks to execute. Default is a **deterministic rule engine** (zero model cost); optional debounced Cortex/Eco call only to phrase narration.

**Rule table (Pass 3 — was hand-wavy, now concrete):**

| Trigger (from presence/activity/call state) | Layout action | Narration / Suggestion |
|---|---|---|
| Call becomes active | widen D to 380px, dim F to strip, add call-glow | "Call started." |
| Both cursors in the same file >5s | widen C, collapse D to strip | narrate "You're both in `X`"; suggest "Follow Alex?" |
| Guest proposes a patch | flash Patch Court in E | "Alex proposed patch #N"; chip "Review patch" |
| Inbound `pendingJoin` | collapse all behind the approval banner | banner "Alex wants to join" |
| Debate launched | promote Debate view in C | "Debate running — round 1/N" |
| Screen-share starts | switch C to Screen view | "Alex is sharing their screen." |
| User idle >2min while peer active | enter Focus dim on idle zones | (silent) |
| ≥3 noisy events in 10s | batch into one ticker line | "3 updates from Alex" |
| Session nearing 4h lease expiry | header amber | chip "Extend session?" |

It's rendered as a roster participant, so the user can tell it "hide the call panel" via the private chat.

### 3.4 Private-Jarvis side-channel — exact wiring (Pass 3 — was unnamed)

The violet `<PrivateJarvisChat>` talks to the **user's own local brain** via the **existing chat dispatch** (`POST /api/chat/stream`, the same endpoint `JarvisUI.handleSubmit` uses — Cortex by default, user's chosen model/effort), **not** `/api/coop-symbiote/chat`. It:
- Reads shared session state **read-only** as context (manifest, patches, timeline, debate) so it can answer "what did Alex just change?".
- **Writes stay local** — never to `session.chat[]` / `events.jsonl` / any co-op payload. Kept out of `publicSession` entirely.
- Offers **Promote to shared** on any message → an explicit, one-click bridge that reposts the text via `/api/coop-symbiote/chat` or files it as a patch/task. Promotion is the *only* path from private → shared.

### 3.5 Aesthetic tokens (`syn-*`, extends `dm-*`)

```css
--syn-cyan:#26dfff; --syn-cyan-hot:#63e6ff; --syn-live:#20f7a4;
--syn-violet:#a58aff;  /* private-Jarvis + Choreographer */
--syn-amber:#ffb858;   /* join requests / repo drift */
--syn-frost:rgba(26,36,51,.72); --syn-blur:40px;
--syn-p1:#42d8ff; --syn-p2:#ff7ac2; --syn-p3:#7cff9e; --syn-p4:#ffcf5c; --syn-p5:#b98cff; /* cursor hues */
```
Motion is `prefers-reduced-motion`-gated; glow only on live/active elements; idle zones desaturate to ~45%; never >1 breathing animation per region; trails cap at 6 dots. *Alive, not noisy* — the Choreographer suppresses motion when a user is heads-down. Theme-aware (dark default + `:root[data-theme="light"]` overrides).

---

## 4. Feature catalog

### 4.1 Current features, made WAY better

| Feature | Upgrade |
|---|---|
| **Shared chat** | Message graph (threads, reactions, `@mentions`), inline **live cards** (`ui_render_card`), provenance chips, **streaming tokens over WS**, slash-commands (`/patch /mission /debate /skill /call`) |
| **Shared tasks** | Kanban w/ isolated lanes (Replit model), task→agent binding (`agent_deploy` reports back), assignee = person *or* Jarvis, WIP limits/deps, bi-directional sync w/ each user's personal task OS |
| **Patch Court** | Real multi-hunk unified diffs + side-by-side viewer; **ghost sandbox → real CI-lite** (`git worktree` + `tsc --noEmit` + lint + tests + secret-scan, evidence attached); adversarial guest red-team review; stacked patches + auto-rebase on drift; **apply stays host-local-only** |
| **Jarvis↔Jarvis bridge** | Typed protocol w/ Zod schema registry (reuse Eclipse contracts); capability handshake (exchange tool manifest + model tier); HMAC-signed messages |
| **Jarvis debate** | Real multi-round adversarial loop (host Cortex Prime, guest Eclipse) → **verified** answer; verifier = Eclipse evidence-promotion gate; debate tree + convergence score; persisted as replay |
| **Memory packets** | Real redacted export from `memory-vectors`+`neural-vault` w/ per-chunk `scanSecrets`, semantic scope filters, signed + expiring, import-diff preview |
| **Skill transfers** | Compile-and-test on import (`skill_compile` sandbox w/ declared validators), **skill fusion** (§4.2), versioning + provenance chain |
| **Session replays** | Scrubbable timeline theater, deterministic replay→regression fixture, model-generated summary |
| **Screen Co-Pilot** | Real WebRTC screen-share track, annotate-on-screen + follow-mode, AI-narrated pointer (`screen_inspect`), consent-gated per-action control |
| **Control baton** | Explicit baton object (one driver; accept-to-pass; auto-return on idle); **scoped batons** (editor/terminal/screen/mission independently) |
| **Modes** | Mode = preset `{abilities, defaultTools, models, surfaces}` w/ "what changes" summary; new modes: Eclipse War-Room, Kalshi/Quant War-Room, Ghost Pair-Run, Teach Mode; higher-trust modes require host re-consent |

### 4.2 Ten MIND-BLOWING new capabilities

1. **Shared Eclipse mission with agents from BOTH users** — one `runMission` graph, Foundry roster seeded from both users' agents + tool leases; per-user cost attribution; both watch the same SSE stream.
2. **Dual-Jarvis adversarial debate to a *verified* answer** — two model tiers argue N rounds; won't finalize until claims pass the Eclipse citation gate + convergence threshold.
3. **Live shared memory graph** — force-directed graph of *merged* project memory from both vaults; other side's nodes ghosted until imported.
4. **Real-time co-editing with two AI copilots in one file** — both humans edit one CRDT buffer while each user's Jarvis proposes inline completions in its own color; suggestions gated by baton before commit.
5. **Cross-user skill fusion** — merge two peers' skills into a superset neither had (diff manifests → LLM-synthesize merged step graph → `skill_compile` + test → dual provenance).
6. **Shared browser co-drive** — one synchronized browser both users + both Jarvises see and take turns driving (baton-scoped); safety rules enforced server-side (no credential entry, no injection-sourced nav).
7. **"Ghost" pair-runs** — before any real change, both Jarvises run the whole proposed workflow in isolated `git worktree` sandboxes in parallel and diff outcomes; only promote the run that passes.
8. **Collaborative Kalshi/Quant War-Room** — shared live board + a dual-Jarvis divergence engine (ties to `[[arbiter-integration]]`) debating theses to a verified brief. **Advisory only — never executes trades, no personalized financial advice.**
9. **Synced dual-model "second opinion" overlay** — one-click send any answer to the *other user's* Jarvis (different tier) for an independent verification pass (agree/disagree + evidence).
10. **Shared Artifact Reactor** — both users co-produce one live artifact (report/dashboard/spec) that regenerates as either side adds evidence/patches; versions journaled.

### 4.3 Ten NEW features

1. Shared scratchpad/whiteboard · 2. Decision log (ADR-style, exportable) · 3. Session bookmarks & jump-to · 4. Live test dashboard · 5. Code annotations / inline comments · 6. Snippet/clipboard sharing (secret-scan on send) · 7. Shared command palette (⌘K) · 8. Session templates · 9. Reputation/trust score per peer (`eclipse/agents/reputation.js`) · 10. Cost & token meter.

### 4.4 Fifteen REQUIRED features

1. Presence · 2. Roles & permissions (Owner/Editor/Commenter/Viewer → ability envelope) · 3. Granular permission toggles · 4. Invite management (named/single-use/reusable, expiry, revoke, queue) · 5. Reconnection & resume (§2.5) · 6. History & audit log (searchable) · 7. Notifications (toasts + optional `send_email`, permission-gated) · 8. File sharing (size + secret guards) · 9. Moderation & kill-switch · 10. Export (MD/JSON/`.docx`) · 11. Session directory (SQLite-backed) · 12. Rate limiting & abuse guards · 13. Consent gates on every side-effect · 14. Connection status & diagnostics (real, not placeholder) · 15. Data retention & wipe (soft-delete + confirm).

### 4.5 Thirty UPGRADES to the current system

**Real-time & transport:** 1. WS gateway (push, not poll). 2. WebRTC data channel + signaling. 3. Ephemeral cursor sampling ~33ms. 4. Heartbeat + backoff reconnect. 5. TURN relay config in `secretStore`.
**Storage & reliability:** 6. Co-op state JSON → **better-sqlite3 WAL**. 7. Optimistic-concurrency versioning on `saveSession`. 8. Idempotency keys on all mutations. 9. `events.jsonl` compaction + rotation. 10. Session snapshot/restore.
**Security & privacy:** 11. HMAC-sign bridge + control messages. 12. Longer high-entropy codes for sensitive sessions. 13. Per-action audit signing. 14. Extend `scanSecrets` patterns (JWT, GitHub/Slack, cloud keys) + run on chat/snippet paths. 15. Egress guard vs injection-sourced recipients.
**UX affordances:** 16. Real diff viewer. 17. Presence-aware file tree. 18. ⌘K palette. 19. Notification center + unread badges. 20. Keyboard shortcuts + follow-mode. 21. Mode-switch preview.
**Agents & memory:** 22. Per-peer capability leases (revocable mid-session). 23. Co-op agents in Eclipse Foundry roster w/ per-user cost. 24. Real memory-packet extraction w/ redaction + TTL + import diff. 25. Reputation weighting. 26. Real model-driven, evidence-gated debate.
**Observability & ops:** 27. Live transport health widget. 28. Per-session metrics. 29. Structured error surface w/ retry/rollback. 30. Ghost sandbox → full `git worktree` runs w/ lint/typecheck/tests + evidence.

### 4.6 The CALL + the private CHAT-with-your-own-Jarvis

- **CALL** — WebRTC voice + optional video + screen-share (second PeerConnection, same signaling path). Both Jarvises can listen/assist on request (Eclipse `liveCall` transcribes; optional Jarvis-TTS track). Both-party consent to start; recording opt-in and disclosed; degradation ladder screen→video→audio→chat; the call is **additive** — media failure leaves data-plane collab intact.
- **PRIVATE side-channel** — §3.4. Personal vault + tools + model; never enters shared state; explicit Promote-to-shared.

### 4.7 Session Intelligence — the missing link *(added in Pass 3)*

Call transcription, decision log, replay, and skills were four disconnected features. Thread them into **one Session Intelligence layer**:
- The call's live transcript (Eclipse `liveCall`) + chat + patch decisions + debate outcomes all feed **one running session narrative**.
- The Choreographer / a background pass extracts **decisions** ("approved patch #4 to fix the race") into the **decision log** automatically, each linked to its timeline moment.
- At session end, an auto-generated **recap** (what we built, decided, and open threads) is offered for **export** (MD/`.docx`) and can be **crystallized into a skill** or a memory packet in one click.
- Everything is attributable (who said/did/decided) via the §2.4 audit fields.

This turns a session from ephemeral into a durable, searchable, reusable artifact — and connects call ↔ debate ↔ decisions ↔ replay ↔ skill that were previously siloed.

---

## 5. The unified wave plan *(reordered in Pass 1)*

Reorder rationale: **build the Synapse surface first** (W1) so every later cross-machine wave has a real UI to drive and verify against, then wire cross-machine underneath. Commit + push after every ~2 waves per `[[feedback_commit_cadence]]`; restart the backend freely per `[[feedback_server_restarts]]`. No secrets/junk in git.

> **Critical path:** substrate → **surface** → rendezvous+signaling → Noise+leases → CRDT/RTC → alive+Choreographer → call → real patch/debate/missions → hardening → differentiators.

### W0 — Foundation substrate *(backend)*
Co-op state JSON → better-sqlite3 (WAL); optimistic-concurrency versioning; idempotency keys; `events.jsonl` rotation; SQLite-backed session directory.
**Accept:** existing single-machine co-op still fully works on the new store; concurrent writes don't lose updates; >20 sessions retained.

### W1 — Synapse widget + room P0 shell *(UI, on the current single-machine backend)*
`<SynapseWidget>` (WidgetShell tile, live status/facepile/actions) + `<SynapseRoom>` overlay + the 6-zone grid; `SessionHeader`, `InviteCluster`+QR, `JoinByCode`, `JoinRequestBanner`; `PresenceRail` (from status), `SharedChat` + walled `PrivateJarvisChat` (§3.4), `TasksStrip` + Patch Court, `Diff/ScreenView`, static `TimelineScrubber`, `EmergencyStop`. Full aesthetic pass. Uses the existing (single-machine) `/api/coop-symbiote/*` so it's real immediately.
**Accept:** the cramped tab is replaced by the Synapse widget + room; full local create→share→join→approve flow runs in it (browser-verified). **This is the surface all later waves test against.**

### W2 — Rendezvous & named-tunnel signaling + cross-machine test harness *(backend)* ← **unblocks cross-machine**
- **Named tunnel / Tailscale funnel setup** (§9 decision): stable host URL; `preferredMeshBaseUrl()` prefers it; still subscribe to tunnel-manager `"url"` for the fallback path.
- `server/coop-transport.js`: `registerRendezvous/resolveRendezvous`, IP-dimensioned rate limiter reading `CF-Connecting-IP` behind a trusted-proxy allowlist (§2.1), universal egress `scanSecrets` gate (§2.3.4).
- Extend `mesh-hub.js`: `coop_pending` socket state (clone `_handlePairPending`), `coop:<sessionId>` room, route `_handleRtcSignal` by coop-peer (not owned-device). Origin check stays a coarse filter; auth is codeProof + Noise.
- `coop-symbiote.js`: `joinSession` accepts a **remote** join via signaling; `createSession` mints+pins host Noise static key; `inviteUrls()` carries stable URL + `hostKeyFp`. Re-publish rendezvous on tunnel `"url"` change.
- New routes: signaling-aware `/session/join`, `GET /mesh/coop/ws` upgrade, `POST /session/:id/turn-credentials`.
- **Cross-machine test harness (Pass 1 gap):** a scripted two-peer smoke — **two node instances** (two ports + two `RUNTIME_DIR`s) or two browser profiles against one tunnel — that runs create→join→approve→exchange and asserts the loop. Add to `server/eclipse/evals`-style suite so it's repeatable.
**Accept:** a guest on a **second machine/instance** enters the code → reaches the host's `pendingJoin` → host approves → authenticated socket open, **verified by the harness**, live.

### W3 — Noise E2E + capability leases *(frontend crypto + backend authority)*
- **Opens with a Vite/WASM bundling spike** (§9): try `noise-protocol` (libsodium); if it fights the build, fall back to `tweetnacl` Noise-lite. Decide before building the rest.
- `synNoise.ts`: Noise XX handshake, session-key mgmt, peer fingerprint → safety-number UI.
- `server/coop-leases.js`: mint guest root lease at `approveJoin`, `verify()` on every co-op mutation route, `revoke()` on end/kick; add coop scopes to `lease.js`. Hard-gate `applyPatch`/`decidePatch` on **host-local session** per §1.4 (not a client flag). Issue the §2.5 resume token at approval.
**Accept:** guest actions are lease-checked; a guest-originated apply is rejected at the node authority; ending the session revokes the lease; two humans read matching safety numbers; a host restart resumes within the token window without re-approval.

### W4 — WebRTC data plane + Yjs CRDT *(frontend)*
- `synRtc.ts`: `RTCPeerConnection`, perfect-negotiation (host=impolite), DataChannel, ICE (STUN + ephemeral TURN), **WS-data fallback**.
- `synDoc.ts`: Yjs `Y.Doc`, custom provider over DataChannel/WS-fallback, awareness for presence/cursors; host persists `encodeStateAsUpdate`; **client-side pre-commit `scanSecrets`** (§2.3.3). Migrate chat/tasks/patch-metadata to the Y.Doc.
**Accept:** chat/tasks/patch-metadata/cursors sync P2P; kill the DataChannel → traffic continues over WS relay; guest drops and rejoins → catches up via delta sync; a pasted secret is blocked pre-commit.

### W5 — Alive layer + Choreographer *(UI)*
`LiveCursorLayer` (cursors/trails/wave), live facepile states, Follow-mode + ribbon. `useSessionChoreographer` with the §3.3 rule table: auto-layout, `NarrationTicker`, `SuggestionChips`, Focus mode. Presence pulses, speaking rings, call-active glow scaffolding.
**Accept:** remote cursor + presence render live; the Choreographer re-weights the grid and narrates real events per the rule table; motion respects reduced-motion.

### W6 — The Call *(frontend + backend TURN)*
`synCall.ts`: second `RTCPeerConnection` for media; `getUserMedia`/`getDisplayMedia`; `CallPanel`/`CallTileGrid`/`CallControlBar` (mic/PTT/cam/screen/leave); degradation ladder; optional Jarvis-TTS track. Ephemeral TURN creds from W2.
**Accept:** two machines hold a voice call; screen-share renders on the peer; forced-TURN path keeps audio; media failure leaves data-plane collab intact.

### W7 — Real Patch Court + real debate + shared missions *(backend + UI)*
Multi-hunk diffs + side-by-side viewer; ghost sandbox → `git worktree` CI-lite w/ evidence; adversarial guest review. Real evidence-gated debate loop. Shared Eclipse mission w/ dual rosters + leases + per-user cost.
**Accept:** a guest-proposed patch runs real tests in a worktree, gets an adversarial review, and only the host can apply it; a debate finalizes only when claims pass the citation gate; a two-user mission cites sources and splits cost.

### W8 — Required-features hardening + Session Intelligence *(cross-cutting)*
Roles/permissions + granular toggles; invite management (revoke/expiry/single-use); notifications center; export (MD/JSON/docx); reconnection resume UI; data retention/wipe; moderation/kill-switch; connection-health widget; per-session metrics; structured error surface. **Session Intelligence** (§4.7): decision log + auto-recap + export/crystallize.
**Accept:** the §4.4 checklist passes; every side-effect has a consent gate; kill-switch instantly revokes; a session exports a truthful recap and can become a skill.

### W9 — P2 differentiators *(needs W7 missions + W4 CRDT)*
Live shared memory graph; dual-copilot CRDT co-edit; shared browser co-drive; ghost pair-runs; cross-user skill fusion; second-opinion overlay; shared Artifact Reactor; Kalshi/Quant War-Room (advisory only); reputation weighting; session templates; whiteboard; cost meter; spatial audio; light theme.
**Accept:** each differentiator demoed on two live instances with guardrails intact.

### W-hard — Continuous hardening (folded across W2–W8)
Extend `record()` with fingerprint/transport-mode/lease-id/sequence; per-capability mid-session revoke UI; single-use code + 5-min pre-approval expiry; optional SPAKE2 PAKE upgrade.

---

## 6. Dependencies to add

| npm | Where | Why | Notes |
|---|---|---|---|
| `yjs` | frontend | CRDT shared state | pure JS, no WASM, Vite-friendly |
| `noise-protocol` *(default)* / `tweetnacl` *(fallback)* | frontend (+ optional backend) | Noise XX E2E | W3 spike decides; `tweetnacl` guaranteed Vite-clean |
| `tweetnacl` | backend | X25519/HMAC, TURN cred signing, resume-token sign | tiny, pure JS, CommonJS ✓ |
| `ws` · `cloudflared` · `better-sqlite3` | already installed | signaling · tunnel · store | reuse |

WebRTC/`getDisplayMedia` are browser built-ins; Cloudflare TURN is a service. **No native compilation beyond what's vendored. No server build step.** CommonJS backend throughout.

---

## 7. Non-negotiable guardrails (every wave)

1. **Host-only patch apply** — accepted only from the host's local authenticated session (§1.4), never from RTC/signaling.
2. **`scanSecrets` / `isBlockedPath` / `safeResolve` on every path** — plus semantic pre-commit CRDT scan + universal structured-payload egress gate.
3. **Per-action consent** for apply / screen-control / mission-launch / email.
4. **Personal memory + private-channel content never enter shared state** without explicit user promotion.
5. **A Synapse guest never rides the device-mesh auth path** — co-op lease, never a device token.
6. **Kalshi/Quant War-Room is advisory only** — no automated execution, no personalized financial advice.
7. **No hard-delete** — retention/wipe is soft-delete + explicit confirm.

---

## 8. Hardest risks (flagged early)

1. **NAT traversal reliability** → **WS-data fallback mandatory**, built in W2/W4.
2. **Tunnel URL stability** → named tunnel / Tailscale (§9); re-publish rendezvous on `"url"` change; resume tokens (§2.5) so restarts don't force re-approval.
3. **Origin/host trust vs a real stranger** → do not widen `mesh-hub.js` origin trust; authenticate via codeProof + Noise; security-review this boundary.
4. **Two-humans ≠ two-devices-I-own** → audit every device-token path so a guest gets a co-op lease.
5. **Browser Noise + Yjs in a no-build repo** → W3 opens with a bundling spike; `tweetnacl` is the escape hatch.
6. **Secret egress via non-file channels** → semantic pre-commit scan + universal egress gate.
7. **Node↔browser authority confusion (§1.4)** → the single most security-critical seam; get the host-local-only apply gate right first.

---

## 9. Decisions — LOCKED (2026-07-14)

- **Name → Synapse.** Widget + room + product. Backend engine stays `coop-symbiote`.
- **Stable URL → NAMED TUNNEL / TAILSCALE.** Stable host URL as the reachability anchor; Quick Tunnel demoted to dev fallback. W2 one-time setup; `preferredMeshBaseUrl()` prefers it; subscribe to `"url"` events for the fallback.
- **Crypto → the rigorous one (`noise-protocol`, libsodium).** W3 opens with a Vite/WASM bundling spike; fall back to `tweetnacl` Noise-lite only if WASM fights the build.
- **PAKE → deferred** to W-hard optional (fingerprint-pinning + codeProof ships in v2).
- **Scope → friends-only, host approves.** No anonymous/public sessions in v2.

---

## 10. Alignment with memory & Jarvis

- Extends `[[jarvis-project]]` (device mesh, co-op symbiote) and the just-shipped guest join-by-code precursor.
- Reuses `[[eclipse-spec]]` leases/evidence/Foundry/artifact-reactor rather than rebuilding — shared missions are a second `userId` into `runMission`.
- UI obeys `[[jarvis-widget-design]]` (WidgetShell tile) and the holographic globe-room language.
- Backend obeys `[[jarvis-coding-rules]]` (CommonJS, atomic writes, better-sqlite3 WAL, secret guards, raw-http routing, no build step).
- War-room honors the standing safety rules (`[[arbiter-integration]]` divergence engine is advisory only).
- Cadence per `[[feedback_commit_cadence]]`; restart freely per `[[feedback_server_restarts]]`.

---

## 11. Three-pass hardening review — change-log

The plan was looped three times, each pass a distinct adversarial lens. What each found and how it was fixed:

**Pass 1 — Architecture & ordering.**
- *Ordering error:* the UI room was built at W4, after transport, leaving no surface to drive/verify cross-machine during the hard waves. → **Reordered: Synapse widget + room shell is now W1** (on the existing single-machine backend); every later wave tests against it.
- *Architecture gap:* RTC/CRDT is browser↔browser but patch-apply authority is node; the node↔browser bridge was unspecified. → **Added §1.4** — the host node only accepts side-effecting commands from its own local authenticated session; a guest frame can populate Patch Court but can never *be* the apply call.
- *Testability gap:* no way to verify cross-machine. → **Added a two-instance test harness** to W2 acceptance.

**Pass 2 — Security & correctness.**
- *Rate-limit defeated by the named tunnel* (all traffic from one Cloudflare IP). → **Read `CF-Connecting-IP`** behind a trusted-proxy allowlist (§2.1).
- *Secret scan can't read Yjs binary deltas.* → **Moved scanning to the semantic layer** — before a string commits to the CRDT (§2.3.3), with structured-payload egress as a second gate.
- *Host restart kills the Noise key with no resume path.* → **Added §2.5 resume tokens** (host-signed, short-lived, single-use) so a restart reconnects without a second human approval, then Yjs delta-syncs.

**Pass 3 — Completeness & ambition.**
- *Choreographer rules were vibes.* → **Concrete rule table** (§3.3).
- *Private-Jarvis endpoint unnamed.* → **Named it** (`/api/chat/stream`, read-only shared context, local-only writes, explicit promote) (§3.4).
- *Widget undefined against the design system.* → **Added §0.5** — canonical WidgetShell tile that expands to the room.
- *Missing link:* call transcript, decision log, replay, skill were four silos. → **Added §4.7 Session Intelligence** threading them into one durable, exportable narrative.
- *Upgrades sufficiency:* the 30 upgrades + 10/10/15 catalog are advanced and cover transport/storage/security/UX/agents/observability; Session Intelligence closes the one thematic gap. Judged **enough and advanced** for v2; further ideas (trust-ladder progressive unlock, offline guest-action queue) parked for post-v2.

**Verdict after 3 passes:** ordering is correct (surface-first), the security seams are named and closed, the empty sections are filled, and the ambition matches the ask. **Plan is build-ready.**

---

*Next step on "go": **W0 (SQLite substrate) → W1 (Synapse widget + room shell)**. W1 gives you the real, dedicated Synapse surface immediately on the current backend; W2 makes it cross-machine. Commit + push after every ~2 waves.*
