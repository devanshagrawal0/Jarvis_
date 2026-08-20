import { Fragment, type ReactNode } from "react";
import { JarvisMarkdown } from "./JarvisMarkdown";
import { CalendarWidget } from "./StageCalendar";

// ── Stage block registry (W3a) ────────────────────────────────────────────────────────────────
// The Stage's core bet (master plan §2.1): the model never emits UI code — it references blocks
// from THIS fixed catalog of hand-built components and binds data to them. A Surface is a flat,
// ID-referenced tree; the renderer walks it, validates each block's props, and DEGRADES a bad or
// unknown block to a text block instead of crashing the whole surface. New block types (calendar,
// chart, map…) are added by dropping one entry into REGISTRY — that's what makes them cheap.

export type CalEvent = { title: string; startAt?: string; endAt?: string; allDay?: boolean; location?: string };

export type RBlock =
  | { id: string; type: "stack"; children: string[] }
  | { id: string; type: "stat_row"; children: string[] }
  | { id: string; type: "heading"; props: { text: string } }
  | { id: string; type: "text"; props: { md: string } }
  | { id: string; type: "stat"; props: { label?: string; value?: string; delta?: string } }
  | { id: string; type: "list"; props: { items: string[] } }
  | { id: string; type: "calendar"; props: { events: CalEvent[]; upcoming?: CalEvent[]; dateLabel?: string } }
  | { id: string; type: "divider" };

export type Surface = { root: string; blocks: Record<string, RBlock> };



type Entry = { validate: (b: any) => boolean; render: (b: any, kids: ReactNode) => ReactNode };

// The catalog. `kids` is the already-rendered children array for container blocks (null for leaves).
export const REGISTRY: Record<string, Entry> = {
  stack: { validate: () => true, render: (_b, kids) => <div className="jr-blocks">{kids}</div> },
  stat_row: { validate: () => true, render: (_b, kids) => <div className="jr-blk-stats">{kids}</div> },
  heading: { validate: (b) => typeof b?.props?.text === "string" && b.props.text.trim().length > 0, render: (b) => <div className="jr-blk-heading">{b.props.text}</div> },
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
    render: (b) => <CalendarWidget events={b.props.events} upcoming={b.props.upcoming} />,
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
  const renderId = (id: string, key: number | string): ReactNode => {
    const b: any = surface.blocks[id];
    if (!b || seen.has(id)) return null; // missing or cycle guard
    seen.add(id);
    const entry = REGISTRY[b.type];
    const kids = Array.isArray(b.children) ? b.children.map((c: string, k: number) => renderId(c, k)) : null;
    const el = entry && entry.validate(b) ? entry.render(b, kids) : degrade(b);
    return el ? <Fragment key={key}>{el}</Fragment> : null;
  };
  return renderId(surface.root, "root");
}

// Adapter: the current flat Block[] the pipeline emits → a Surface. Consecutive stats group into a
// stat_row (preserving the side-by-side card layout). Lets the whole existing pipeline render
// through the registry with zero server change.
type FlatBlock = { type: string; text?: string; label?: string; value?: string; delta?: string; items?: string[]; events?: CalEvent[]; upcoming?: CalEvent[]; dateLabel?: string };
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
    else if (b.type === "divider") rootChildren.push(add({ type: "divider" } as any));
    else rootChildren.push(add({ type: "text", props: { md: b.text || "" } } as any));
    i++;
  }
  return { root: add({ type: "stack", children: rootChildren } as any), blocks: bmap };
}
