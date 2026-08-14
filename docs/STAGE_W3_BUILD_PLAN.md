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
