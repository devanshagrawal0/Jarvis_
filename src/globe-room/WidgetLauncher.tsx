import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WIDGETS, WIDGET_GROUPS, accentFor, rankWidgets, type WidgetDef } from "./widget-registry";
import "./WidgetLauncher.css";

// The Module Deck.
//
// This is the entry point to every surface Jarvis has, so it is the screen most often looked at and
// it was the least designed: a narrow column of seventeen identical rows, taller than the command
// bar it hung off, with no search, no grouping, no description of what anything did, and no way to
// see what was already open. Four things were wrong and only one of them was paint.
//
//   1. seventeen items is past the point where a list can be scanned — it needs a filter;
//   2. an id and a glyph do not say what a thing is. "Vision" and "Graph" mean nothing cold;
//   3. opening a widget that is already on screen looked identical to opening a new one;
//   4. the list itself was a hand-copied duplicate of the real registry, quietly drifting.

const OPEN_EVENT = "jarvis:open-widget";
const CHANGED_EVENT = "jarvis:widgets-changed";
const QUERY_EVENT = "jarvis:widgets-query";

export function WidgetLauncher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [openIds, setOpenIds] = useState<string[]>([]);

  // Browsing and searching want different shapes. With nothing typed the groups ARE the information
  // — they say what kind of thing each module is. Once something is typed, the grouping fights the
  // answer: it scatters matches across five headings and forces the best one down the panel. So a
  // query collapses to one ranked list, best first, which is where the eye already is.
  const searching = query.trim().length > 0;
  const ranked = useMemo(() => rankWidgets(query), [query]);
  const groups = useMemo(() => (searching
    ? [{ key: "results" as const, label: `${ranked.length} match${ranked.length === 1 ? "" : "es"}`, accent: "#48D8FF", items: ranked }]
    : WIDGET_GROUPS
      .map((group) => ({ ...group, items: WIDGETS.filter((widget) => widget.group === group.key) }))
      .filter((group) => group.items.length > 0)
  ), [searching, ranked]);
  // Display order, which is also the order the arrow keys walk.
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  const launch = useCallback((widget: WidgetDef) => {
    // The same event whether or not it is already open — the strip raises and un-minimises an
    // existing window, which is what "open" should mean for something already on screen.
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { id: widget.id } }));
    onClose();
  }, [onClose]);

  // Which widgets are currently on screen. The strip owns that state, so it is asked rather than
  // guessed at — reading a cached copy would confidently label a closed widget "open".
  useEffect(() => {
    if (!open) return;
    function handle(event: Event) {
      const detail = (event as CustomEvent).detail || {};
      if (Array.isArray(detail.ids)) setOpenIds(detail.ids.map(String));
    }
    document.addEventListener(CHANGED_EVENT, handle);
    document.dispatchEvent(new CustomEvent(QUERY_EVENT));
    return () => document.removeEventListener(CHANGED_EVENT, handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    // Typing is the fastest path through seventeen things, so the field is ready without a click.
    const focus = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(focus);
  }, [open]);

  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (!flat.length) return;
      // Two columns, so Up/Down move a row and Left/Right move one tile.
      const step = event.key === "ArrowDown" ? 2 : event.key === "ArrowUp" ? -2
        : event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step) {
        event.preventDefault();
        setCursor((current) => Math.max(0, Math.min(flat.length - 1, current + step)));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const widget = flat[Math.min(cursor, flat.length - 1)];
        if (widget) launch(widget);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, flat, cursor, launch]);

  if (!open) return null;

  return (
    <>
      <div className="jml-backdrop" aria-hidden="true" />
      <div className="jml" ref={panelRef} role="dialog" aria-modal="true" aria-label="Module deck">
        <div className="jml-head">
          <b>Module Deck</b>
          <span className="jml-count">{flat.length}{query ? ` / ${WIDGETS.length}` : ""}</span>
          <span className="jml-hint"><kbd>↑↓</kbd><em>move</em><kbd>enter</kbd><em>open</em><kbd>esc</kbd><em>close</em></span>
          <button className="jml-x" onClick={onClose} aria-label="Close module deck">×</button>
        </div>

        <div className="jml-search">
          <i aria-hidden="true">⌕</i>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search modules — name or what it does…"
            aria-label="Search modules"
          />
        </div>

        <div className="jml-body">
          {flat.length === 0 ? (
            <div className="jml-empty">
              <b>Nothing matches “{query}”</b>
              Jarvis has {WIDGETS.length} modules. Try a word from what it does — “tasks”, “memory”, “paired”.
            </div>
          ) : groups.map((group) => (
            <section className="jml-group" key={group.key} style={{ ["--jml-accent" as string]: group.accent }}>
              <header><span>{group.label}</span><i /></header>
              <div className="jml-grid">
                {group.items.map((widget) => {
                  const index = flat.indexOf(widget);
                  const isOpen = openIds.includes(widget.id);
                  return (
                    <button
                      key={widget.id}
                      className="jml-tile"
                      style={{ ["--jml-accent" as string]: accentFor(widget.group) }}
                      data-cursor={index === cursor}
                      data-open={isOpen}
                      onClick={() => launch(widget)}
                      onMouseEnter={() => setCursor(index)}
                    >
                      <span className="jml-glyph" aria-hidden="true">{widget.icon}</span>
                      <span className="jml-text">
                        <strong>{widget.label}</strong>
                        <small>{widget.blurb}</small>
                      </span>
                      {isOpen ? <span className="jml-open">open</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
