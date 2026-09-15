# JARVIS PHONE — the full build plan (2026-09-13)

A phone-first JARVIS, not a remote control. One app the owner opens, talks or types to, and from it
controls the PC, the rooms and moves files. Same brain (`:8799`), same profile, same memory as the
desktop. Installable PWA, iOS Safari first, served over Tailscale HTTPS
(`https://nucbox-k8-plus.tail6f924a.ts.net/app`). Sources: one 15-minute research pass on the best
phone assistant / remote-control / finance UIs (cited inline as [R]), our normative UX docs
(`docs/ux/*`, cited as [UX-NN]), the density standard and widget design memories, and the live API
surface read from `server.js`.

Laws that bind every screen: 100 ms feedback on every touch [UX-02/04] · nothing blocks > 400 ms
without progress + escape [UX-04] · one spacing/type/motion/z scale [UX-03/05] · animate only
`transform`/`opacity`, honour `prefers-reduced-motion` [UX-05] · honest states (not-run ≠ empty ≠
error) [UX-02] · content ≥ 85 % of a panel, ONE accent, no neon-kid colours, no gradient banners,
no glow except the listening state (density standard) · LAW 0: nothing routed by regex — the brain
decides, the app renders.

---

## 1. What it looks like (the material)

Not "dark CSS". A real material system, three layers, each with a job:

1. **The world (content layer, opaque).** Near-black navy `#04070c` with a *fixed* full-screen
   backdrop: a slow-drifting radial mesh (deep blue `#031427` → black) + a static film-grain PNG at
   ~4 % opacity + a very faint star-field parallax that moves 6–8 px against scroll. This is the same
   family as the desktop Command OS (space, globe, cyan) so it reads as one product. The mesh is one
   pre-rendered 1024² WebP, not live gradients — cost ≈ 0.
2. **Glass (the floating control layer ONLY).** Two surfaces, never more: the top status bar and the
   bottom composer. `backdrop-filter: blur(14px) saturate(140%)`, `-webkit-` prefixed, 1 px inner
   hairline `rgba(255,255,255,.08)`, top edge highlight, shadow that *grows as text scrolls under it*
   (scroll-driven, transform/opacity only). Never glass on glass, never `position:fixed` + blur
   (iOS repaint jank) — the composer is `sticky` inside the scroll container; never animate the blur
   value. Apple's Liquid Glass rules, verbatim [R: WWDC25 219 notes; Empire UI backdrop-filter notes].
3. **Instruments (cards).** Opaque panels `rgba(6,12,20,.92)` on the world, 1 px line
   `rgba(196,208,205,.14)`, 12 px radius, the scanline `<i class="scanline">` from the WidgetShell
   pattern at 3 % — so a phone card and a desktop widget are recognisably siblings.

**Colour.** Base graphite/navy. ONE accent: JARVIS cyan `#31d7ff` (`--accent`), used for exactly
one thing per screen — the live/selected state. Status semantics are the desktop's own: `--cmd-live
#73e6aa` (ok), `--cmd-warn #d5b46a` (warn), rose `#ff5ab8` (bad), and they are dots and hairlines,
never fills. No per-room rainbow; a room's own accent appears only inside that room's card header
hairline.

**Type.** Inter (UI, 15/16 px body — arm's-length legible), Orbitron only for the wordmark and the
big numbers on instrument cards (tabular figures), Cascadia/mono for key–value rows and code. Scale:
11.5 / 13 / 15 / 17 / 22 / 34. Three levels max on any screen.

**Motion.** Our tokens [UX-05]: fast 120 / base 200 / slow 320 / slower 480 ms; springs as
`linear()` easings generated from Apple's duration+bounce presets — *smooth* (0 bounce) for sheets,
*snappy* (small bounce) for chips and cards, *bouncy* reserved for the mic orb only [R: WWDC23
10158]. Press = scale .97 in 90 ms; list entrances stagger 30–50 ms capped at 300 ms. Reduced
motion: everything → 0.01 ms, glow off.

**Haptics.** iOS Safari has no `navigator.vibrate`; the working trick is a hidden
`<input type="checkbox" switch>` toggled from a real click gesture (system switch haptic)
[R: ios-vibrator-pro-max]. Used for: send, mic engage, scrub ticks, remote tap acknowledgement.
Unverified in standalone mode — batch 1 checks it on the real phone before it's relied on.

**The listening state.** The only glow in the app: a full-perimeter edge light (fixed inset-0,
animated conic gradient, blurred, 1.5 px) exactly like Siri on Apple Intelligence [R: Pocket-lint /
SlashGear], plus a pill waveform at the bottom that scales with *your* mic amplitude and changes
colour when JARVIS speaks [R: Gemini Live 2026 refresh]. Off the moment listening ends.

---

## 2. The screens (five, thumb-reachable, bottom tab bar in the glass layer)

### 2.1 JARVIS (home) — the chat
- **Thread** of turns. The owner's turns right-aligned, plain; JARVIS turns left, prose rendered
  as markdown (same `JarvisMarkdown` rules as the desktop: bold lead-ins, tables scroll inside their
  own box, code fenced).
- **Results render as instrument cards inside the thread**, not walls of text: calendar/task/
  reminder (from the `uiActions`/`stage_render` payloads the brain already emits), market number
  (one hero number + one single-colour line, long-press to scrub with haptic ticks [R: Robinhood]),
  sources row (horizontal card row above the prose, inline numbered citation chips, follow-up chips
  under it [R: Perplexity]), artifact (image/file with a download/open button), agent/mission status
  (live from the ECLIPSE SSE stream).
- **Composer (glass, sticky bottom):** text box that grows to 5 lines, attach (photo / camera /
  file → `attachments`/`imageData`), the **mic** as the primary button, send. Above it a chip row of
  *contextual* quick actions the brain proposes (`followups`), never a hardcoded list.
- **Voice lives inside the thread — no modal takeover** [R: ChatGPT redesign]. Two modes,
  switchable in the composer: **hold-to-talk** (release = send; the way the orb works, right for
  noisy rooms) and **open mic** with a *barge-in toggle* and a hard **mute** [R: Claude / Gemini
  Live]. The transcript appears in the thread as it's heard. Spoken reply through `speechSynthesis`
  (needs one user gesture first), with a visible stop-square to interrupt.
- **STT reality:** `webkitSpeechRecognition` does nothing inside an installed iOS PWA
  [R: whatpwacando]. So mic audio streams to *our* backend (the same Gemini transcription path the
  orb uses) over WebSocket — not the browser's speech API. Getting the mic also forces audio to the
  speaker on iOS and a second `getUserMedia` kills the first — one stream, kept alive per session.
- **Top bar (glass):** wordmark, the live dot (brain reachable / tunnel / offline), the owner's
  name once known, and the *Cortex* effort pill (Eco/Balanced/Max — same `strength` field).

### 2.2 Control — the PC
- **Watch mode** (default, cheap): a scaled screenshot of the desktop polled from
  `/api/device-mesh/screen` / `live/frame`; tap on it = click at that pixel, sent through
  `/api/device-mesh/screen/control`. Enough for "click that", "type this".
- **Control mode** (escalate): the live stream via the mesh WebSocket (`/mesh/ws`), Moonlight's
  touch grammar [R: Moonlight #284]: tap = left click · hold one finger + tap second = right click ·
  long-press 0.5 s then drag = drag · two-finger drag = scroll · pinch = zoom · two-finger pan ·
  three-finger tap = keyboard. A **Trackpad / Direct** mode switch like Jump Desktop
  [R: Jump]. Latency budget < 100 ms glass-to-glass; if the mesh stream can't hit it, we
  tune encoder/jitter first (Hopp's numbers: VP9 quantizer 36, 200 ms optimal buffer,
  screencast flag) [R: Hopp] — measured, not assumed.
- **Hotkey strip** in the glass layer: Enter, Esc, Tab, ⌘C/V/Z, arrows, a text-injection field
  (the existing `ScreenTab` shortcuts, redesigned). **Emergency stop** always visible
  (`/api/device-mesh/emergency-stop`).
- **Wake Lock** held while this tab is active (works installed since iOS 18.4) [R: web.dev].
- Says what's true: "watching" vs "controlling" vs "PC unreachable" are three designed states.

### 2.3 Files — data transfer, both ways
- **To the PC:** share-sheet / picker / camera → `/mesh/api/inbox/upload` (and text/links via
  `/mesh/api/inbox/text|link`). Progress bar per item, 100 ms feedback, retry on failure.
- **From the PC:** the artifacts the brain produces (`/api/files/:name`), the device-inbox list
  (`/api/device-mesh/files`), and — new, small backend route — a browse of an allowed folder set
  (Downloads, Desktop, a "Phone" folder) with **Send to phone**. iOS caps: no File System Access
  API, 50 MB storage; downloads go through Safari's share sheet, so big files open in a new tab
  rather than "save" [R: MagicBell PWA guide].
- Clipboard both ways (read on a tap gesture only).

### 2.4 Rooms — HELIX / APEX / ECLIPSE / ATLAS
- A **favourites-first tile grid** with sparkline/trend inside each tile [R: Home Assistant 2025.9]:
  APEX (watchlist movers), HELIX (latest brief), ECLIPSE (running missions), Today (next event /
  open tasks). Tiles read from the rooms' own APIs (`/api/apex/*`, `/api/helix/*`,
  `/api/eclipse/*`, `/api/atlas/*`) — the same data the desktop rooms show, compacted to a phone.
- Tap a tile → a **room sheet** (bottom sheet, snap points ½ and full): the room's phone view, not
  the desktop room shrunk. APEX = hero number + chart + movers table; HELIX = the brief with
  sources; ECLIPSE = mission list → replay of its stream (the fleet console's reducer, reused).
- Every room action a phone can't do well (deep terminal work) hands off: "Open on PC" → the brain
  opens the room on the desktop (`open-widget` uiAction) and Control shows it.

### 2.5 Setup & profile — the "who am I" screen
- The first-run setup from the fresh-start plan, phone-native: what to call you / what to call me
  → "I see you're in <auto-detected city> — is this home?" → connections (Gmail, Instagram, Kalshi,
  phone: green/red, connect/disconnect) → how you like answers → what needs confirmation → quiet
  hours. Each answer is a `profile_update` call; nothing hardcoded.
- **Profile card**: every fact JARVIS holds about you, its source (you said / it inferred / a
  document), with delete. **This week's changes** list. Re-run any step by asking.
- Push: an install-first coach screen ("Add to Home Screen from the Share sheet"), then a single
  **Enable notifications** button — permission must be requested from a tap, after A2HS, over
  HTTPS, via the service worker; icon badging for unread [R: Pushpad / OneSignal / MagicBell].

---

## 3. Architecture (what gets built, where)

- **New Vite entry** `app.html` → `src/mobile/main.tsx`, own manifest (`/app-manifest.webmanifest`,
  `display: standalone`, dark theme-colour, icons), own service worker (app shell cache, push
  handler, badge). Added to `vite.config.mjs` `rollupOptions.input` and a dev proxy for `/app`.
  Server route `GET /app` serves `dist/app.html` (same shape as the `/phone.html` route). The old
  `/phone.html` remote stays until Control reaches parity, then redirects to `/app#control`.
- **One brain client** `src/mobile/brain.ts`: `GET /` once for the `jarvis_session` cookie, then
  `POST /api/chat/stream` with `{prompt, history(-16), clientContext{timezone, lat/lon if granted},
  imageData, attachments, strength, deepResearch}`; parses ndjson `event|delta|progress|done`,
  drives the thread, cards and follow-up chips from `result.uiActions / artifacts / sources`.
- **Voice** `src/mobile/voice.ts`: mic capture (one stream), PCM chunks over a WS to a small new
  backend route that reuses the orb's Gemini transcription; TTS via `speechSynthesis` with a
  gesture-primed unlock; the listening/speaking state machine drives the edge glow + waveform.
- **Control/Files/Rooms** talk to the existing mesh/room routes listed above; no new brain logic.
  Two small backend additions: the STT WS route, and the allowed-folder browse + "send to phone".
- **Auth reality:** through `tailscale serve` every request arrives from loopback, so JARVIS treats
  the phone as the owner. Fine for a one-person tailnet; if that changes, a device token gate goes
  in front of `/app` (the mesh pairing already has one).
- **Layout plumbing:** `viewport-fit=cover`, `env(safe-area-inset-*)`, `100dvh`; re-measure after
  the first `resize`/`visibilitychange` because cold-start PWAs report wrong values [R: gist].
  No Background Sync, no File System Access, 7-day eviction if unopened — designed around, not
  assumed away.

---

## 4. Batches (each ends with the real thing on Dev's phone, then Dev gates)

| # | Batch | Proof on the phone |
|---|---|---|
| 1 | Shell + material + **chat** to the real brain, cards for calendar/task/source/artifact, follow-up chips, install as PWA over Tailscale | type "my name is X, call me Y" → answer streams, profile row shows it, desktop shows the same profile |
| 2 | **Voice**: hold-to-talk + open-mic/barge-in/mute, edge glow, waveform, spoken reply; haptic hack verified or dropped | speak a question, see transcript in thread, hear the reply, interrupt it |
| 3 | **Control**: watch mode + tap-to-click, hotkey strip, emergency stop; then control mode with the Moonlight grammar + latency measured | click a button on the PC from the phone; scroll a page; type into it |
| 4 | **Files** both ways + clipboard | photo → PC inbox; PC file → phone share sheet |
| 5 | **Rooms** tiles + sheets (APEX, HELIX, ECLIPSE, Today) + "Open on PC" hand-off | APEX movers on the phone match the desktop; a mission replays |
| 6 | **Setup + profile + push** | first-run flow end to end; a reminder arrives as a push |

Batch size stays small (≤ 2 risky pieces each). Nothing is called done without the phone screenshot
/ DOM read in the same message.

## 5. Open questions for Dev (decide, or I default as noted)
1. Name on the icon: "JARVIS" (default) or something else.
2. Open-mic default on or off (default: off — hold-to-talk first, per the interruption complaints [R]).
3. Which folders the PC exposes for "send to phone" (default: Downloads + Desktop + `~\Phone`).
4. Keep `cost-meter` spend visible on the phone top bar (default: yes, one number).

## 6. Not verified (from the research) — checked in batch 1/2 on the real device
- The switch-input haptic in standalone mode; `speechSynthesis` behaviour after the first gesture;
  mic capture in standalone (sources conflict); exact latency of the mesh stream on the tailnet.
