import { Fragment, type ReactNode } from "react";
import { JarvisMarkdown } from "./JarvisMarkdown";
import { CalendarWidget } from "./StageCalendar";
import { StageChart, type ChartPoint, type ChartKind } from "./StageChart";
export type { ChartPoint, ChartKind };

// ── Stage block registry (W3a) ────────────────────────────────────────────────────────────────
// The Stage's core bet (master plan §2.1): the model never emits UI code — it references blocks
// from THIS fixed catalog of hand-built components and binds data to them. A Surface is a flat,
// ID-referenced tree; the renderer walks it, validates each block's props, and DEGRADES a bad or
// unknown block to a text block instead of crashing the whole surface. New block types (calendar,
// chart, map…) are added by dropping one entry into REGISTRY — that's what makes them cheap.

export type CalEvent = { title: string; startAt?: string; endAt?: string; allDay?: boolean; location?: string };

export type RBlock =
  | { id: string; type: "stack"; children: string[] }
  | { id: string; type: "grid"; props?: { cols?: number }; children: string[] }
  | { id: string; type: "stat_row"; children: string[] }
  | { id: string; type: "heading"; props: { text: string } }
  | { id: string; type: "text"; props: { md: string } }
  | { id: string; type: "stat"; props: { label?: string; value?: string; delta?: string } }
  | { id: string; type: "list"; props: { items: string[] } }
  | { id: string; type: "calendar"; props: { events: CalEvent[]; upcoming?: CalEvent[]; dateLabel?: string } }
  | { id: string; type: "chart"; props: { points: ChartPoint[]; kind?: ChartKind; label?: string } }
  | { id: string; type: "divider" };

export type Surface = { root: string; blocks: Record<string, RBlock> };



// Strip markdown from text that is rendered as plain characters. Deliberately narrow: leading
// heading hashes, wrapping emphasis, and backticks — things that can only be markup. A ticker like
// A*B or a label with an underscore is left exactly as written.
function stripMarkup(text: string): string {
  return String(text || "")
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim();
}

type Entry = { validate: (b: any) => boolean; render: (b: any, kids: ReactNode) => ReactNode };

// The catalog. `kids` is the already-rendered children array for container blocks (null for leaves).
export const REGISTRY: Record<string, Entry> = {
  stack: { validate: () => true, render: (_b, kids) => <div className="jr-blocks">{kids}</div> },
  // The plan's §W3a container pair is stack/grid. `grid` lays its children in columns — the thing a
  // stack cannot express: two charts side by side, a 2x2 of stats, a label column beside a value
  // column. Column count is clamped rather than trusted; a model asking for 9 columns in a 380px
  // panel produces slivers, and a bad number must degrade to a sane layout, never to a broken one.
  grid: {
    validate: () => true,
    render: (b, kids) => {
      const asked = Number(b?.props?.cols);
      const cols = Number.isFinite(asked) ? Math.min(4, Math.max(2, Math.round(asked))) : 2;
      return <div className="jr-blk-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{kids}</div>;
    },
  },
  stat_row: { validate: () => true, render: (_b, kids) => <div className="jr-blk-stats">{kids}</div> },
  // The heading renders as PLAIN TEXT, so any markdown the model puts in it would be shown as
  // characters — a surface went out titled "## NVDA 1-Month Trend (Daily)", hashes and all. The
  // block already means "this is a heading"; the markup is redundant by the time it arrives, so it
  // is stripped rather than honoured. Only unambiguous syntax is removed, never content.
  heading: {
    validate: (b) => typeof b?.props?.text === "string" && b.props.text.trim().length > 0,
    render: (b) => <div className="jr-blk-heading">{stripMarkup(b.props.text)}</div>,
  },
  text: { validate: (b) => typeof b?.props?.md === "string" && b.props.md.trim().length > 0, render: (b) => <div className="jr-blk-text"><JarvisMarkdown text={b.props.md} /></div> },
  stat: {
    validate: (b) => b?.props && (b.props.value || b.props.label),
    render: (b) => {
      const d = b.props.delta || "";
      const dir = /^\s*\+/.test(d) ? "up" : /^\s*[-−]/.test(d) ? "down" : "flat";
      return (
        <div className="jr-blk-stat">
          <span className="jr-blk-stat-val">{b.props.value || "—"}</span>
          {b.props.label ? <span className="jr-blk-stat-lbl">{b.props.label}</span> : null}
          {d ? <span className={`jr-blk-stat-delta ${dir}`}>{d}</span> : null}
        </div>
      );
    },
  },
  list: { validate: (b) => Array.isArray(b?.props?.items) && b.props.items.length > 0, render: (b) => <ul className="jr-blk-list">{b.props.items.map((it: string, k: number) => <li key={k}>{it}</li>)}</ul> },
  // The reusable Calendar widget — hand-built once, filled with REAL events each run (never generated
  // by the model). Full HUD day view: header + tabs, time-grid, mini-month, today's schedule, upcoming.
  calendar: {
    validate: (b) => Array.isArray(b?.props?.events),
    // The one block that FILLS its parent instead of sizing to its content.
    //
    // CalendarWidget is a fixed 1180x740 design canvas that measures its own root and scales to fit
    // it. Every other block sizes to content, so the registry's `stack` container has no height —
    // and the calendar measured its root as 1260x0, hit its own `if (!W || !H) return;` guard, never
    // applied the scale transform, and painted NOTHING. Verified 2026-08-23: the DOM was complete
    // and every element reported visible with opacity 1, while the panel was blank on screen.
    // A wrapper that claims the remaining height is what makes the measurement real.
    render: (b) => <div className="jr-blk-cal"><CalendarWidget events={b.props.events} upcoming={b.props.upcoming} /></div>,
  },
  // W3c — the chart block. Hand-built once (lightweight-charts), fed a plain series the server has
  // already checked against real fetched data. `validate` demands at least two finite points: a
  // one-point "chart" is a number wearing a graph's clothes, and it degrades to text instead.
  chart: {
    validate: (b) => Array.isArray(b?.props?.points)
      && b.props.points.filter((p: any) => p && typeof p.t === "string" && Number.isFinite(p.v)).length >= 2,
    render: (b) => <StageChart points={b.props.points} kind={b.props.kind} label={b.props.label} />,
  },
  divider: { validate: () => true, render: () => <div className="jr-blk-div" /> },
};

// A bad/unknown block never crashes the surface — salvage any human text and show it as text.
function degrade(b: any): ReactNode {
  const txt = b?.props?.text || b?.props?.md || b?.props?.label || b?.props?.value
    || (Array.isArray(b?.props?.items) ? b.props.items.join(", ") : "");
  return txt ? <div className="jr-blk-text"><JarvisMarkdown text={String(txt)} /></div> : null;
}

export function SurfaceRenderer({ surface }: { surface: Surface }) {
  const seen = new Set<string>();
  // KEYED BY BLOCK ID, never by array position.
  //
  // This walked children with `.map((c, k) => renderId(c, k))` and keyed the Fragment on `k`, the
  // index. React's own rule (react.dev, "Preserving and Resetting State") is that state follows
  // position when the key is an index, so patching one block by id, or inserting a block ahead of
  // others, re-associates every later block with the wrong element — a chart remounts and redraws
  // from scratch instead of updating in place. Harmless while a surface was only ever replaced
  // whole; not harmless now that `applySurfaceEvent` below patches a single block by id, and fatal
  // for the shared-element morph in W5, which needs an element to persist across the change.
  const renderId = (id: string): ReactNode => {
    const b: any = surface.blocks[id];
    if (!b || seen.has(id)) return null; // missing or cycle guard
    seen.add(id);
    const entry = REGISTRY[b.type];
    const kids = Array.isArray(b.children) ? b.children.map((c: string) => renderId(c)) : null;
    const el = entry && entry.validate(b) ? entry.render(b, kids) : degrade(b);
    return el ? <Fragment key={id}>{el}</Fragment> : null;
  };
  return renderId(surface.root);
}

// ── The surface event reducer (master plan §2.4) ──────────────────────────────────────────────
//
// The plan calls for typed events applied by ONE client reducer to a live surface tree, rather than
// shipping a whole spec each time. The event names follow A2UI v0.9 (a2ui.org), which is the closest
// published standard and whose model this registry already matches: a flat, id-referenced component
// list whose root is the block called `root`, with "sending a component with an existing id updates
// that component". That is exactly `surface.block` below.
//
// `surface.data` is the RFC 6902 shape narrowed to what a block patch actually needs — a replace at
// one prop of one block. The full RFC allows add/remove/move/copy/test over arbitrary pointers; a
// surface never needs move or copy, and honouring only `replace` keeps a malformed patch from being
// able to restructure the tree. RFC 6902's atomicity rule is kept: a patch that does not apply
// cleanly leaves the surface untouched rather than half-applied.
//
// Deliberately NOT here: binding blocks to a separate DataBag by JSON Pointer (§2.10). Blocks carry
// their own data today, and splitting that is a change to every block and the server with it. Not
// on W3's checklist; it belongs with the wave that needs it.
export type SurfaceEvent =
  | { kind: "surface.start"; root?: string }
  | { kind: "surface.block"; block: RBlock; parent?: string }
  | { kind: "surface.data"; id: string; prop: string; value: unknown }
  | { kind: "surface.done" };

export function emptySurface(): Surface {
  return { root: "root", blocks: { root: { id: "root", type: "stack", children: [] } } };
}

export function applySurfaceEvent(surface: Surface | null, event: SurfaceEvent): Surface | null {
  switch (event.kind) {
    case "surface.start":
      return { root: event.root || "root", blocks: { root: { id: event.root || "root", type: "stack", children: [] } as RBlock } };
    case "surface.block": {
      const base = surface || emptySurface();
      const b = event.block;
      if (!b || typeof b.id !== "string" || !b.id) return base;      // an id-less block cannot be addressed
      const parentId = event.parent || base.root;
      const parent: any = base.blocks[parentId];
      const known = Boolean(base.blocks[b.id]);
      const blocks = { ...base.blocks, [b.id]: b };
      // Appended once. Re-sending the same id UPDATES it in place (A2UI) and must not push a second
      // reference into the parent, or the block renders twice and the cycle guard hides the second.
      if (!known && parent && Array.isArray(parent.children) && !parent.children.includes(b.id)) {
        blocks[parentId] = { ...parent, children: [...parent.children, b.id] };
      }
      return { ...base, blocks };
    }
    case "surface.data": {
      if (!surface) return surface;
      const target: any = surface.blocks[event.id];
      if (!target) return surface;                                   // replace on a missing target: no-op, per RFC 6902
      return { ...surface, blocks: { ...surface.blocks, [event.id]: { ...target, props: { ...(target.props || {}), [event.prop]: event.value } } } };
    }
    case "surface.done":
    default:
      return surface;
  }
}

// Adapter: the current flat Block[] the pipeline emits → a Surface. Consecutive stats group into a
// stat_row (preserving the side-by-side card layout). Lets the whole existing pipeline render
// through the registry with zero server change.
type FlatBlock = { type: string; text?: string; label?: string; value?: string; delta?: string; items?: string[]; events?: CalEvent[]; upcoming?: CalEvent[]; dateLabel?: string; points?: ChartPoint[]; kind?: ChartKind };
export function blocksToSurface(blocks: FlatBlock[]): Surface {
  const bmap: Record<string, RBlock> = {};
  let n = 0;
  const add = (b: Omit<RBlock, "id">): string => { const id = `b${n++}`; bmap[id] = { ...(b as any), id }; return id; };
  const rootChildren: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === "stat") {
      const kids: string[] = [];
      while (i < blocks.length && blocks[i].type === "stat") {
        const s = blocks[i];
        kids.push(add({ type: "stat", props: { label: s.label, value: s.value, delta: s.delta } } as any));
        i++;
      }
      rootChildren.push(add({ type: "stat_row", children: kids } as any));
      continue;
    }
    if (b.type === "heading") rootChildren.push(add({ type: "heading", props: { text: b.text || "" } } as any));
    else if (b.type === "list") rootChildren.push(add({ type: "list", props: { items: Array.isArray(b.items) ? b.items : [] } } as any));
    else if (b.type === "calendar") rootChildren.push(add({ type: "calendar", props: { events: Array.isArray(b.events) ? b.events : [], upcoming: Array.isArray(b.upcoming) ? b.upcoming : [], dateLabel: b.dateLabel } } as any));
    else if (b.type === "chart") rootChildren.push(add({ type: "chart", props: { points: Array.isArray(b.points) ? b.points : [], kind: b.kind, label: b.label } } as any));
    else if (b.type === "divider") rootChildren.push(add({ type: "divider" } as any));
    else rootChildren.push(add({ type: "text", props: { md: b.text || "" } } as any));
    i++;
  }
  return { root: add({ type: "stack", children: rootChildren } as any), blocks: bmap };
}
