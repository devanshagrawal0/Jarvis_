# JARVIS PHONE — plan v2 (2026-09-14, after the reset)

Supersedes `PHONE_APP_PLAN.md` §1 (material) and §4 (batches). Screens (§2), architecture (§3) and the
research list in v1 still stand. This file is the one I follow; nothing gets built that is not in it.

## 0. What happened and why v1 was thrown away

Batch 1 shipped and Dev rejected it: the centrepiece read as a flat 2D blob, the "space" was drawn
dots on a gradient (cheap), the chrome was bulky (44 px pills, 16 px text, big radii), and a row of
three green status dots was noise. I then over-corrected by copying the desktop command bar into the
phone — not asked for. Everything under `src/mobile/`, `app.html`, the manifest, the worker and the
built output is deleted. Kept: the `/app` server route and the Vite proxy line (plumbing only).

Rules that come out of that, binding for every screen from now on:
1. **One centrepiece, real 3D, on a black world.** No painted stars, no gradient meshes, no grain.
   Depth comes from the object, not from a backdrop.
2. **Chrome is hairline and thin.** 12–13.5 px UI text, 1 px lines at ≤ 25 % alpha, radius ≤ 10 px,
   touch targets 40 px but drawn small. Nothing is a "pill". No status-dot rows.
3. **Nothing decorative.** Every element on screen is either content, a control, or the
   centrepiece. If it cannot be explained in one sentence, it is not there.
4. **Every batch ends with a screenshot on Dev's phone or in the pane at phone size, and Dev
   gates.** No "verified" without the picture in the same message.

## 1. The centrepiece — Plan A (find or make) vs Plan B (globe + rings)

### Plan B — the desktop globe and rings, nothing else
`src/globe-room/HoloGlobe.tsx` (country outlines, lat/long grid, fresnel rim, the halo arcs) in an
R3F canvas on a black world. Same camera as the desktop (fov 50, [0, 1.5, 8]). It sits centred while
the thread is empty and glides (position/scale lerp, one group) into the top bar once a
conversation starts. Already proven to render on the phone size in the pane. Zero new assets.

### Plan A — something of its own
Three candidates, researched. Recommendation first.

**A1 · "Cortex" — a GPU particle core (make, recommended).**
30 000 points on the GPU (positions/velocities in data textures, updated in a fragment shader —
the Codrops GPGPU technique). The points have *forms* they are pulled toward, and the state of
JARVIS chooses the form:
- idle — a hollow sphere shell, slow breathing rotation, a few loose orbit streams;
- thinking — the shell collapses into a dense spinning core with two bright orbit rings;
- speaking — a horizontal ring that expands/contracts as a waveform;
- listening — the shell reacts to mic amplitude (batch 2);
- **globe form** — the same country outlines the desktop globe uses (`globe-room/countries.geojson`)
  sampled into points, so the cloud can *become* the JARVIS globe with its rings. Plan B lives
  inside Plan A as one form.
Additive point sprites, ice/cyan only, half-resolution bloom (`@react-three/postprocessing`
Bloom with `resolutionScale 0.5`, disabled on low-tier devices). Morphs are a `mix()` between
target textures — no CPU work per frame.
Why it wins: it is ours (no licence), it is alive (state is visible from across the room), it
scales down (10 k points, bloom off) instead of breaking, and it keeps Dev's globe as a form.
Risk: iPhone frame budget — measured in batch 1 with a visible FPS read before anything else is
built; if 30 k + bloom cannot hold 60 fps it drops to 15 k / no bloom, and if that still fails we
fall to Plan B.

**A2 · Arc reactor (find).**
A real reactor GLB with emissive rings and bloom — the literal Iron Man object. Candidates:
Sketchfab "Sci-Fi Reactor Core" (Yewon Kim, CC-BY, 30.6 k tris, credit required) and iedalton's
"SciFi Reactor Core" (WIP); Meshy's hologram/reactor tags (CC0, GLB). Looks iconic, but it is a
static prop — it spins, it does not *respond* — and it carries someone else's mesh and licence.
Kept as an option if Dev wants the literal reactor.

**A3 · Volumetric energy sphere (make).**
One quad, one raymarched fragment shader: plasma/nebula volume inside a glass sphere (the Apple
Intelligence/Siri orb but truly 3D). Cheapest to run (one draw call). Hardest to get right — my
first shader sphere is exactly what read as "2D". Not recommended as the first attempt.

**Decision needed from Dev:** A1 (recommended), A2, A3, or B. The listening edge-glow (Siri-style
conic ring, 1.8 s cycle) from v1 research stays as the only glow in the app regardless of choice.

## 2. The world and the chrome (replaces v1 §1)

- **World:** `#000`–`#04070c`, a single soft radial vignette toward the edges. That is all.
- **Top bar (36 px + safe area):** wordmark (Orbitron 12 px, .3 em), live dot (5 px) + owner's
  name, spend today (mono 11 px). Hairline under it. Backdrop blur 8 px only here.
- **Composer:** one 1 px-hairline rounded rect (radius 10), 44 px tall single-line growing to 4
  lines; inside: mic (left), text, attach + send (right). Under it a 10.5 px meta line:
  `Cortex Balanced · Research Fast` (both tappable). No glow, no gradient fill.
- **Tab strip:** five 18 px line icons + 9.5 px uppercase labels, 40 px tall, hairline above.
  Jarvis · Control · Files · Rooms · You. Stays — Dev did not ask for it to go; if he does, it goes.
- **Thread:** owner turns right-aligned in a hairline box (no fill), JARVIS turns as prose 14.5 px
  with a 5 px rail dot. Cards: black panel, 1 px cyan hairline at 18 %, kicker 9.5 px caps.
  Stage blocks reuse the desktop registry (`SurfaceRenderer`) — calendar/chart/stats render as
  they do on the desktop, restyled compact.
- **Motion:** 120/200/320 ms, transform/opacity only; the centrepiece is the only thing that
  moves continuously.

## 3. Build order (each row = one gate; Dev sees the picture, says go)

| # | Batch | What Dev sees |
|---|---|---|
| 0 | Centrepiece decision (this document) | — |
| 1 | The centrepiece alone on a black phone screen, with a live FPS/ms read in the corner, idle → thinking → speaking → globe form on tap | phone screenshot + the FPS number |
| 2 | Shell: top bar, composer, tab strip, empty thread; centrepiece docks when a turn starts (free deterministic turn, no Gemini) | phone screenshot, both states |
| 3 | Thread + cards (stage/sources/artifact/approval/contact) with the real stream | pane screenshot with an injected thread + one real free turn |
| 4 | PWA install over Tailscale (`/app.html`), first real turn by Dev ("my name is X, call me Y" → name in the top bar) | Dev's own phone |
| 5 | Voice (hold-to-talk, open mic, edge glow, waveform form) | Dev speaks, sees transcript, hears reply |
| 6 | Control · 7 Files · 8 Rooms · 9 Setup/profile/push — as v1 §2 | per v1 table |

Batch 1 is the whole risk. Nothing else is touched until the centrepiece is right on the phone.

## 4. Resources (researched 2026-09-14)

Technique
- GPGPU particles, FBO ping-pong, MeshSurfaceSampler, motion bloom — Codrops "Dreamy Particle
  Effect" https://tympanus.net/codrops/2024/12/19/crafting-a-dreamy-particle-effect-with-three-js-and-gpgpu/ (repo https://github.com/DGFX/codrops-dreamy-particles)
- Particle morphing between forms (mix between target textures) — Three.js Journey "Particles
  Morphing Shader" https://threejs-journey.com/lessons/particles-morphing-shader ; Maxime Heckel
  https://blog.maximeheckel.com/posts/the-magical-world-of-particles-with-react-three-fiber-and-shaders/
- R3F scene performance (frame budget, Drei helpers) — Codrops 2025-02-11 https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/
- Bloom on mobile: use `Bloom` not `SelectiveBloom`, `resolutionScale`, `<EffectComposer disabled>`
  on low tier — https://react-postprocessing.docs.pmnd.rs/effects/bloom
- Listening edge glow (conic ring, 1.8 s, blurred halo behind) — https://github.com/jacobamobin/AppleIntelligenceGlowEffect , https://theosoti.com/blog/animated-gradient-borders/

Reference builds (looked at, not copied)
- Reactor core with orbital rings + particles, MIT — https://github.com/kariimmoalla1-source/jarvis-ui
- Holographic globe on webcam AR — https://github.com/MuhammadFahru/jarvis-hud
- Voice-reactive orb (Perlin displacement + fresnel) — https://github.com/aguscruiz/voiceorb
- Orb component libraries (too "mascot" for JARVIS, noted for the audio adapters):
  https://github.com/alexanderqchen/orb-ui , https://github.com/Ibrahim-dvp/react-3d-ai-assistant

Assets (only if A2)
- Sci-Fi Reactor Core, Yewon Kim, CC-BY, 30.6 k tris — https://sketchfab.com/3d-models/sci-fi-reactor-core-a996292bc068406590b4ddd045f7bd19
- SciFi Reactor Core, iedalton — https://sketchfab.com/3d-models/scifi-reactor-core-b3fe00d6b73841a0b6b3a288efc03668
- Meshy CC0 hologram/reactor GLBs — https://www.meshy.ai/tags/hologram

Already in the repo
- `src/globe-room/HoloGlobe.tsx` + `public/globe-room/countries.geojson` (the globe and rings)
- `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` (installed)
- `src/StageRegistry.tsx` (cards), `src/JarvisMarkdown.tsx`, `src/api.ts` (stream client)

## 5. Performance budget for the centrepiece (batch 1 pass/fail)
- iPhone: ≥ 55 fps sustained for 60 s at DPR 2, canvas ≤ 320² CSS px; frame ≤ 12 ms.
- Fallback ladder: 30 k + bloom → 15 k + bloom → 15 k no bloom → Plan B.
- Loop pauses when the tab is hidden; `prefers-reduced-motion` renders a still frame.
