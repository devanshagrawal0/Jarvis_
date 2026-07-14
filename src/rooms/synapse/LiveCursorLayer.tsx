import { useEffect, useRef } from "react";
import type { SynChannel } from "./synChannel";

// Synapse W5 — live cursor overlay. Broadcasts the local pointer (throttled, normalised 0..1 over
// the workspace) over the channel and renders remote peers' cursors as colored arrows + labels.
// Stale cursors (no update >5s) are pruned by the room.

export type Cursor = { x: number; y: number; name?: string; from?: string; at: number };

const COLORS = ["#42d8ff", "#ff7ac2", "#7cff9e", "#ffcf5c", "#b98cff"];
export function cursorColor(key: string): string {
  let h = 0;
  for (const c of String(key || "peer")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function LiveCursorLayer({ channelRef, cursors }: {
  channelRef: React.MutableRefObject<SynChannel | null>;
  cursors: Record<string, Cursor>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(0);

  useEffect(() => {
    const host = ref.current?.parentElement; // the workspace panel this overlay covers
    if (!host) return;
    const onMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - last.current < 40) return; // ~25/s throttle (ephemeral, never journaled)
      last.current = now;
      const r = host.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) channelRef.current?.sendCursor(x, y);
    };
    host.addEventListener("mousemove", onMove);
    return () => host.removeEventListener("mousemove", onMove);
  }, [channelRef]);

  return (
    <div className="syn-cursors" ref={ref}>
      {Object.entries(cursors).map(([id, c]) => (
        <div key={id} className="syn-cursor" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, color: cursorColor(c.name || id) }}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2 L2 13 L5.2 10 L8 15 L10 14 L7.2 9 L12 9 Z" fill="currentColor" stroke="#0a0f18" strokeWidth="0.6" /></svg>
          <span className="syn-cursor-lbl" style={{ background: cursorColor(c.name || id) }}>{c.name || c.from || "peer"}</span>
        </div>
      ))}
    </div>
  );
}
