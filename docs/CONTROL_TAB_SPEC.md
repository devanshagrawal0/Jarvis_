# Control tab — spec (2026-09-16, own research, no agent)

Sources: docs/PHONE_DESIGN_SPEC.md (tokens, accent budget, cheapness tells); Tesla / Apple Home
device-control pattern (device image → identity + status line → one row of round quick actions →
grouped sections, everything else behind a tap); Chrome Remote Desktop + Steam Link + Jump Desktop
session UIs (hidden toolbar revealed by edge tab or three-finger gesture; touch vs trackpad
modes; keyboard button directly above the keyboard; tap / double-tap / hold / two-finger scroll /
pinch zoom); Apple HIG (44 pt targets, 16 pt margins, 8 pt grid, primary action in the thumb zone).

## Command screen, top to bottom (361 px column, 24 px between sections)
1. **Hero — the PC** (no card, no stroke): live frame 16:9, radius 16. On it: glass status pill
   top-left (`● Online · JARVIS on screen`), bottom gradient with the window in front
   (`Chrome — Assignments`). The whole frame is the Take-over button; a small `Take over ›`
   caption bottom-right.
2. **Identity line**: `NucBox K8 Plus` 17/600 · `Online · CPU 21% · RAM 85% · up 2h 38m` 13/400
   text-2, tabular numbers. No kickers, no boxes.
3. **Quick actions**: five 56 px circles + 11/500 labels, evenly spaced. Take over (accent fill,
   the one accent fill on the page) · Keys (sheet) · Media (sheet) · Shot · Lock. Circles are
   surface-2 fills; press = scale .92, 80 ms.
   - **Keys sheet**: glass bottom sheet r24, groups of 44 px keys: System (Esc Tab Enter ⌫ Win
     Alt+Tab Win+D Alt+F4 F11 PrtSc), Arrows (↑ ↓ ← → Home End PgUp PgDn), Combos (Ctrl+C V X Z A S,
     Ctrl+Shift+Esc, Win+L). Every key = one real SendInput event; the sheet stays open.
   - **Media sheet**: ⏮ ⏯ ⏭ · Vol− Vol+ Mute.
4. **Rooms**: title 15/600 + text-3 note. 2 × 2 tiles, 72 px: 40 px icon on accent-soft, name
   16/600, description 12 text-3 (2 lines). Fill only, radius 16.
5. **Apps**: title + `126 installed`. 46 px search (surface-1). Groups: Recent (from receipts) ·
   Games · All A→Z (6 rows + Show all). Rows 58 px: real Windows icon 36 px, name 15/600, kind 12
   text-3, chevron text-3. Fill only.
6. **Command**: title + Clear. Thread (same components as home). Empty: one hint line.
7. Composer in the dock, tabs under it.

Accent budget on this page: Take-over circle, active tab, focus ring, tile icon tint. Nothing else.
No strokes on fills. No drop shadows. Section titles are words, not uppercase kickers.

## Takeover
- Full-screen video, landscape on a portrait phone (rotated frame). Chrome hidden after 3 s;
  revealed by the edge handle (top edge of the landscape frame) or a three-finger tap.
- Bar: readout (res · fps · Mb/s · buffer · tap ms · zoom) · Touch/Trackpad · Keyboard · Quality ·
  Stop. Keyboard button sits directly above the keyboard when it is open.
- Gestures: tap click · double-tap double-click · hold right-click · hold+drag drag · two-finger
  scroll · pinch zoom (1× button when zoomed) · three-finger tap = keyboard.
- Trackpad mode: finger moves the cursor relatively (1.6×), tap clicks where the cursor is.
