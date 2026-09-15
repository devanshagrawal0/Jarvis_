# JARVIS PHONE — design spec (research pass 2026-09-15, one agent + own reading)

Source: one 15-minute research agent (no branching) on premium dark phone AI apps, merged with Emil
Kowalski's design-engineering rules. Every number below is pasteable. Sources at the end.

## 1. Typography
- Body/UI: **Inter** (variable, optical sizing on). Titles: **Inter Display** (opsz ≥ 20 picks it).
  Mono: JetBrains Mono. One sans + one mono — a second sans is the #1 "template" tell.
- Roles (393 px phone): display 34/41 600 −0.6px · title-1 28/34 600 −0.4px · title-2 22/28 600 −0.3px ·
  title-3 20/25 600 −0.2px · headline 17/22 600 −0.2px · **body (assistant) 17/26 400 −0.1px** ·
  body-user 16/22 400 · callout (cards) 15/20 400 · caption 13/16 500 · micro 11–12/14 500 +0.1px ·
  mono 13/20.
- Tracking flips negative→positive around 15 px (Apple's table). Inputs ≥ 16 px or iOS zooms.
- **Weights on black: 400/500/600 only.** Antialiased smoothing makes 300 vanish and 700 bloom.
- Inter features: `font-feature-settings: "cv11" 1, "ss03" 1, "calt" 1;` numbers via
  `font-variant-numeric: tabular-nums` (not `"tnum"`, which replaces the whole feature list).

## 2. Layout & spacing
- 4 px base, 8 px rhythm; scale 4 8 12 16 20 24 32 40 48 64. Page margin 16 px → 361 px column.
  No second inner gutter on messages (the "double gutter" is a cheapness tell).
- Touch targets 44×44; 24 px glyph inside. Safe areas via env(). Thumb zone: repeated taps in the
  bottom 40 %.
- Tab bar 49 pt + safe-bottom, icons 24–25, labels 10–11/500 always shown, ≤ 5 tabs.
  Top bar 44 px + safe-top.
- Thread: **assistant has no bubble and no avatar** — full column, 17/26. User is the only bubble:
  right-aligned, max 80 %, 16/22, padding 10×14, radius 18, surface-1, never accent-filled.
  Rhythm: 24 px assistant→user, 12 px user→assistant, 32 px around a tool card. Timestamps hidden.
- Composer: 52 px pill (radius 26 → 20 when multi-line), surface-2, max 6 lines; attach left; one
  36 px circle on the right that is mic ↔ send (accent fill, black arrow) ↔ stop; 12 px side margin.

## 3. Colour & surfaces on true black
```
--bg-0:#000  --bg-1:#0a0b0d
--surface-1: rgba(255,255,255,.04)  --surface-2: .06  --surface-3: .09  --surface-4: .12
--line-1: rgba(255,255,255,.06)  --line-2: .10  --line-focus: rgba(0,229,255,.45)
--text-1: rgba(255,255,255,.92)  --text-2: .62  --text-3: .40  --text-disabled: .28
--accent:#00e5ff  --accent-text:#6ff2ff  --accent-soft: rgba(0,229,255,.12)  --accent-line: .35
--ok:#34d399 --warn:#fbbf24 --danger:#ff5c6c
```
- Elevation is a lighter fill, never a shadow (the only allowed shadow: `inset 0 1px 0 rgba(255,255,255,.06)`).
- Fill OR stroke, never both. Cards: fill, no border. Rows: 6 % dividers. Hairlines ≤ 10 % white.
- **Accent budget** (cyan): send fill, listening ring, active tab, links, focus ring, one stat number,
  progress. Never: body text, borders, bubbles, headings, large fills, the top bar, backgrounds.
- Glass: exactly two surfaces (top bar, dock): `rgba(10,11,13,.72)` + `blur(20px) saturate(140%)`;
  `prefers-reduced-transparency` → `rgba(10,11,13,.96)`, no blur.
- The globe is the only light source: ≤ 40 vh at home; small/dim behind a thread.

## 4. Motion
- Springs as CSS `linear()` (Apple presets, settling times): smooth 730 ms, snappy 700 ms, bouncy
  820 ms — strings in `src/mobile/mobile.css`. Scale for small things (×0.6–0.7).
- Curves: `--ease-out: cubic-bezier(.16,1,.3,1)`; `--ease-in-out: cubic-bezier(.65,0,.35,1)`;
  Emil's UI ease-out `cubic-bezier(.23,1,.32,1)`; iOS drawer `cubic-bezier(.32,.72,0,1)`.
  **Never ease-in.** Interactions ≤ 200 ms; nothing over 300 ms; exits faster than entrances.
- Press: `scale(.97)` 80 ms down, spring-snappy ×0.6 up; rows change fill instead of scaling.
- Send: bubble translateY(12)→0 + fade 220 ms ease-out. Receive: fade only, 150 ms (never slide —
  it fights streaming). Lists: stagger 30 ms × index, ≤ 6, translateY(6)+fade 260 ms.
- Sheets: open spring-smooth 500 ms, close ease-in-out 240 ms. Tabs: crossfade 120 ms; never slide.
- Listening ring: 1.8 s spin; opacity follows mic RMS. Scroll: top-bar tint 0→.72 over 24 px.
- Only `transform`/`opacity` (+ `filter` on ≤ a word). Never height/width/padding/blur/backdrop.
- Reduced motion: keep fades, kill transforms and the ring.

## 5. Components (short)
- Top bar 44: wordmark + status; hairline fades in with scroll tint. Titles are nouns.
- Composer as above; placeholder text-3; `enterkeyhint=send`; no autofocus on touch.
- Assistant markdown: paragraphs 17/26 with 14 px between; headings = body size 600 with 24/8
  spacing (never bigger); lists 20 px indent; links accent-text no underline; inline code 14 mono
  surface-1 r4; code blocks full-bleed to the 16 px margin, 13/20, r12, header 32 px with language +
  Copy; tables scroll-x, header 12/500 caps text-2, tabular nums, row dividers only.
- Tool cards: surface-1, r16, 14×16 padding, no border, header 12/500 text-2 + status. Sources =
  32 px chips (favicon + domain), ≤ 5 + "+n". Stat card = one number 28/600 tabular + delta chip +
  48 px sparkline, no axes/grid. Approval = 15/600 title, two 44 px buttons; Approve is the only
  other accent fill besides Send.
- Tab bar 49 + safe: 24 px icons + 10/500 labels; active accent-text; haptic on change.
- Empty state: globe ≤ 40 vh, one greeting line (title-1). No marketing copy.
- Toast: surface-4 glass r14 above the composer, spring-snappy in, 4 s. Errors inline, never modal.
- Skeletons: cards only, 3 bars, opacity .5↔1 1.2 s.

## 6. Micro-interactions
- `-webkit-tap-highlight-color: transparent` + real press states; `touch-action: manipulation`.
- Haptics: hidden `<input type=checkbox switch>` clicked via its `<label>` (Safari 18); feature-
  detect, fail silently; send / tab / approve / long-press only.
- Keyboard: visualViewport resize+scroll → composer rides above it; stay pinned to bottom if at bottom.
- Body locked, the thread is the only scroller (rubber-band inside it); `overscroll-behavior: none`
  on html/body. Never `scroll-behavior: smooth` on the thread; autoscroll instant, only within 80 px
  of the bottom; "↓" pill otherwise.
- 120 Hz: only compositor properties; batch streamed tokens per frame.

## 7. Performance (iOS WebKit)
1. backdrop-filter over a scroller repaints every frame → ≤ 2 blurred surfaces, blur ≤ 20 px, sticky.
2. No box-shadow / big blur inside the scroller. Glows are pre-rendered gradients.
3. three.js DPR ≤ 2 (1.5 on phones), pause when hidden, ≤ 4 ms/frame.
4. Streaming: append, don't re-render; `contain: content` per message; `content-visibility: auto`.
5. Preload fonts, `font-display: swap`, latin subset, no `@import`.
6. Budgets: first paint ≤ 1 s, input→pixel ≤ 100 ms, long tasks ≤ 50 ms, ≤ 20 composited layers.

## 8. Twelve cheapness tells → fix
hairline boxes everywhere → fills · bubbles both sides + avatars → assistant unbubbled · #000+#fff →
#0a0b0d + 92 % · hex greys → opacity ramps · 300/700 weights → 400/500/600 · accent on borders/headings
→ accent budget · 8 px pill radii → 18/16/26 · ease-in-out 300 ms → ease-out ≤ 200 · drop shadows →
tonal layers · glass everywhere → two surfaces · neon halos → one ring, the globe is the light ·
blog headings/hr in answers → body-size bold, 24 px space.

## 9. Ten biggest visible wins (ranked)
1 unbubbled assistant text 17/26 · 2 fills instead of hairlines · 3 Inter Display titles, cv11/ss03,
tabular · 4 52 px glass composer with the accent send · 5 streaming word fade · 6 springs via linear()
and 80/200 ms press · 7 globe as the only light, capped, dimmed behind threads · 8 native scroll
(body locked, thread scroller) · 9 49 pt glass tab bar with labels · 10 borderless cards with one
number + sparkline + 32 px source chips.

## Sources
Apple HIG typography (https://developer.apple.com/design/human-interface-guidelines/typography, table
mirror https://gist.github.com/eonist/b9c180a67980c6e18a5184f19bff68fa) · WWDC24 10074 Dynamic Type ·
rsms.me/inter · Linear "How we redesigned the Linear UI" (https://linear.app/now/how-we-redesigned-the-linear-ui) ·
Material dark theme (https://m2.material.io/design/color/dark-theme.html) · WWDC23 10158 Animate with
springs (+ wwdcnotes) · kvin.me/css-springs · Chrome linear() docs · joshwcomeau linear-timing-function ·
Emil Kowalski standards (https://github.com/emilkowalski/skills) and https://emilkowal.ski/ui/great-animations ·
rauno.me/craft/interaction-design · github.com/raunofreiberg/interfaces · streamdown.ai/docs/animation ·
WebKit Safari 18 (haptics) · github.com/tijnjh/ios-haptics · backdrop-filter jank threads ·
WWDC25 219 Liquid Glass · MDN font-smooth / VisualViewport / overscroll-behavior.
Unverified by the agent: Apple's exact `.snappy` (0.15) / `.bouncy` (0.3) bounce values.
