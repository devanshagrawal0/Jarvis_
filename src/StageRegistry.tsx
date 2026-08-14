import { Fragment, type ReactNode } from "react";
import { JarvisMarkdown } from "./JarvisMarkdown";

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
  | { id: string; type: "calendar"; props: { events: CalEvent[]; dateLabel?: string } }
  | { id: string; type: "divider" };

export type Surface = { root: string; blocks: Record<string, RBlock> };


// ── Calendar day view (W3b) ───────────────────────────────────────────────────────────────────
const IcoPeople = () => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5.5" /><path d="M21 20a6 6 0 0 0-4-5.7" /></svg>);
const IcoPhone = () => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L20 13l1 4v3a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z" /></svg>);
const IcoFolder = () => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>);
const IcoChart = () => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 20V10M12 20V4M19 20v-7" /></svg>);
const IcoDot = () => (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 1.5" /></svg>);

// Cosmetic category → color + icon by keyword (never routing; just the visual accent, like the ref).
function catFor(title: string): { color: string; icon: ReactNode } {
  const t = (title || "").toLowerCase();
  if (/\b(call|dial|phone|ring|voice)\b/.test(t)) return { color: "#4ade80", icon: <IcoPhone /> };
  if (/\b(meet|meeting|briefing|sync|standup|stand-up|1:1|1-1|interview|review|catch ?up|lunch|coffee|dinner)\b/.test(t)) return { color: "#a78bfa", icon: <IcoPeople /> };
  if (/\b(deadline|report|doc|document|deliver|submit|due|paper|file)\b/.test(t)) return { color: "#fb923c", icon: <IcoFolder /> };
  if (/\b(market|analysis|stats|metrics|earnings|trade|trading|data|numbers)\b/.test(t)) return { color: "#22d3ee", icon: <IcoChart /> };
  return { color: "#6ec8f0", icon: <IcoDot /> };
}

const HH = 58; // px per hour — tall enough that a 1-hour event fits time + title + location
const hourOf = (iso?: string) => { if (!iso) return 0; const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };
const fmt24 = (iso?: string) => { if (!iso) return ""; try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return ""; } };

function CalendarDay({ events }: { events: CalEvent[] }) {
  const timed = events.filter((e) => !e.allDay && e.startAt);
  const allDay = events.filter((e) => e.allDay);
  const starts = timed.map((e) => Math.floor(hourOf(e.startAt)));
  const ends = timed.map((e) => Math.ceil(hourOf(e.endAt || e.startAt) + (e.endAt ? 0 : 1)));
  const s = timed.length ? Math.max(0, Math.min(8, ...starts)) : 8;
  const en = timed.length ? Math.min(24, Math.max(18, ...ends)) : 18;
  const gridH = (en - s) * HH;
  const now = new Date();
  const dateObj = timed[0]?.startAt ? new Date(timed[0].startAt) : now;
  const isToday = dateObj.toDateString() === now.toDateString();
  const nowTop = isToday ? (hourOf(now.toISOString()) - s) * HH : -1;
  const dateTitle = dateObj.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const hours: number[] = []; for (let h = s; h <= en; h++) hours.push(h);

  return (
    <div className="jr-cal-day">
      <div className="jr-cal-day-head">{dateTitle}</div>
      {allDay.length ? (
        <div className="jr-cal-allday">
          <span className="jr-cal-allday-lbl">ALL DAY</span>
          <div className="jr-cal-allday-items">{allDay.map((e, k) => <span className="jr-cal-allday-chip" key={k}>{e.title || "(no title)"}</span>)}</div>
        </div>
      ) : null}
      <div className="jr-cal-grid" style={{ height: gridH }}>
        {hours.map((h) => (
          <div className="jr-cal-hour" style={{ top: (h - s) * HH }} key={h}>
            <span className="jr-cal-hour-lbl">{String(h).padStart(2, "0")}:00</span>
            <span className="jr-cal-hour-line" />
          </div>
        ))}
        {nowTop >= 0 && nowTop <= gridH ? (
          <div className="jr-cal-now" style={{ top: nowTop }}>
            <span className="jr-cal-now-lbl">{fmt24(now.toISOString())}</span>
            <span className="jr-cal-now-dot" />
            <span className="jr-cal-now-line" />
          </div>
        ) : null}
        {timed.map((e, k) => {
          const top = (hourOf(e.startAt) - s) * HH;
          const dur = e.endAt ? Math.max(0.25, hourOf(e.endAt) - hourOf(e.startAt)) : 1;
          const h = Math.max(34, dur * HH - 4);
          const cat = catFor(e.title);
          return (
            <div className="jr-cal-ev" style={{ top: top + 2, height: h, borderColor: cat.color + "40" }} key={k}>
              <span className="jr-cal-ev-rail" style={{ background: cat.color }} />
              <div className="jr-cal-ev-body">
                <div className="jr-cal-ev-time">{fmt24(e.startAt)}{e.endAt ? ` – ${fmt24(e.endAt)}` : ""}</div>
                <div className="jr-cal-ev-title">{e.title || "(no title)"}</div>
                {e.location ? <div className="jr-cal-ev-loc">{e.location}</div> : null}
              </div>
              <span className="jr-cal-ev-icon" style={{ color: cat.color }}>{cat.icon}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  // The reusable Calendar shell — hand-built once, filled with REAL events each run (never generated
  // by the model). Agenda view: a time column + a title per event. Empty day is a valid render.
  calendar: {
    validate: (b) => Array.isArray(b?.props?.events),
    render: (b) => {
      const events: CalEvent[] = b.props.events;
      if (!events.length) return <div className="jr-cal-empty">Nothing scheduled{b.props.dateLabel ? ` ${b.props.dateLabel}` : ""}.</div>;
      return <CalendarDay events={events} />;
    },
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
type FlatBlock = { type: string; text?: string; label?: string; value?: string; delta?: string; items?: string[]; events?: CalEvent[]; dateLabel?: string };
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
    else if (b.type === "calendar") rootChildren.push(add({ type: "calendar", props: { events: Array.isArray(b.events) ? b.events : [], dateLabel: b.dateLabel } } as any));
    else if (b.type === "divider") rootChildren.push(add({ type: "divider" } as any));
    else rootChildren.push(add({ type: "text", props: { md: b.text || "" } } as any));
    i++;
  }
  return { root: add({ type: "stack", children: rootChildren } as any), blocks: bmap };
}
