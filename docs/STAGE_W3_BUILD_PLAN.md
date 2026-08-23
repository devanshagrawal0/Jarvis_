# Stage W3 — Generative Stage v1 (block registry) — build plan

The master plan's core bet (§2.1): the LLM never emits UI code. It picks blocks from a **fixed
catalog of hand-built, reusable React components** and binds data to them. Reusable *shells* Jarvis
fills each run — faster, safer, consistent. This doc tracks the W3 slices to get there.

## The shift
- **From:** LLM emits ad-hoc `{heading, stat, list, text}`, whole panel regenerated each time.
- **To (§2.10):** a `Surface` spec — a flat, ID-referenced tree of blocks from a catalog. Each block
  is a real component that renders a **skeleton first**, then binds data from a separate `DataBag`
  and hydrates by id. Props validated; a bad block degrades to `text`, never crashes the surface.

## Keep (already built + verified)
- The pipeline (route → fetch real data → **fabrication gate**) — still the spine; the render step
  now emits a Surface spec instead of ad-hoc blocks.
- The streaming skeleton — becomes per-block skeleton-first hydration.
- stat/list/text blocks — migrate into the catalog as the first entries.

## Slices (each testable end-to-end; Dev is the gate)

### W3a — Block-registry foundation  ← START HERE
- `Surface` + `Block` types (`stack`/`grid`, `heading`, `text`, `stat`, `list`, `divider`).
- **Registry renderer**: walks the tree, renders each block from a component map, validates props,
  degrades to `text` on unknown type / bad props.
- Adapter `blocksToSurface(blocks)` so the current pipeline output (flat array) renders through the
  registry unchanged.
- **Test:** today's stat/list/text panels (mountains, BTC) render identically — now via the registry.
- No server/pipeline change. Isolated frontend refactor.

### W3b — Calendar block (the reusable calendar shell — flagship)
- Hand-built reusable `Calendar` component (agenda/day view, time slots, event cards).
- Pipeline pulls the owner's **real Google Calendar events** into the DataBag and binds them.
- **Test (plan's W3 acceptance):** "what's on my calendar today" → real calendar with actual events.

### W3c — Chart block
- Reusable `Chart` component (line/bar first; candlestick later). LIVE series still gated.
- **Test:** "chart bitcoin over the last week" → a real line chart.

### W3d — Two-phase generation + skeleton-first per block
- Phase-1 free-text UI plan → Phase-2 constrained Surface spec (§2.2). Per-block skeleton (§2.5).
- Sets up W5 morph.

### W3e — Router + provenance wiring
- Presentation router picks "generative surface"; gate + source badges ride on the surface.

## Guardrails
- Blocks default; code is the escape hatch (later wave). No fabrication — LIVE data stays gated.
- Each slice: real browser proof it renders, no regression on existing panels, before the next.


---

## STATUS — closed 2026-08-23 (verified in the running UI, not from commit messages)

| slice | state | evidence |
|---|---|---|
| W3a registry | **done** | `StageRegistry.tsx` — validation, degrade-to-text, cycle guard, `blocksToSurface`. `grid` added and rendered: `grid-template-columns: 165.5px 165.5px`, 2 children |
| W3b calendar | **done** | `calendar` is in `stage_render`'s block catalog; the model emits `{"type":"calendar"}` with NO data and the server binds the owner's real events. Rendered full HUD day view with his actual 16:30-17:30 event, mini-month, upcoming |
| W3c chart | **done** | real AMD/BTC series drawn |
| W3d think-first + skeleton | **done** | `plan` field with `propertyOrdering`; skeleton raised at render start |
| W3e gate + provenance | **done** | fabrication gate + `APEX PRICE HISTORY` source badge rendered |
| event-stream reducer (§2.4) | **done, client side** | `applySurfaceEvent` — start/block/data/done. Re-sending an id UPDATES in place (A2UI v0.9), `surface.data` replaces one prop (RFC 6902 shape). Verified live: 111 -> 999 without duplication, 222 -> 777 by patch |

### Three defects found and fixed while closing it
1. **`calendar` was not in `stage_render`'s catalog at all** — the model could never choose it. The
   only route was `detectCalendarStageRequest`, a keyword regex whose noun/verb lists matched this
   document's own acceptance sentence. The gate is deleted; the block is in the catalog.
2. **The block survival filter dropped every calendar block.** It kept blocks with
   `text|value|label|items|points`; a calendar carries `events`, so the array emptied and the render
   threw "The Stage needs some blocks to render". The model emitted a correct calendar block and
   silently fell back to a text list.
3. **The calendar painted nothing.** It is a fixed 1180x740 canvas that measures its root and scales
   to fit; inside the registry's content-sized `stack` its root measured 1260x0, so its own
   `if (!W || !H) return;` guard skipped the transform. DOM complete, every element "visible", panel
   blank. Fixed with a fill rule scoped by `:has` so no other surface changes.

### What is NOT done, and belongs to W4
The plan's acceptance sentence "what's on my calendar today" still answers in CHAT. Measured over
six phrasings: the calendar reaches the panel 4/6, and every success contained an explicit show
instruction ("on the panel", "where i can see it", "show me visually"). Deciding SHOW vs TELL is the
presentation router — W4 — and the deleted keyword gate was faking that decision.

### Also not done
Nothing on the server emits `surface.*` events yet, so the reducer is exercised but unused in
production; the model returns a whole `stage_render` call in one piece (non-streaming
`generateContent`). Binding blocks to a separate DataBag by JSON Pointer (§2.10) was deliberately
left out — it changes every block and the server with it, and is not on W3's checklist.
