// Surface transition primitive (docs/ux/05 §4). Wraps the active surface and gives
// it a directional slide + fade on change — forward vs back derived from spine order —
// while the shell (sidebar/topbar/spine) stays static. Also preserves each surface's
// scroll position across switches (perf: surfaces still unmount, so we save/restore
// scrollTop instead of keeping 11 surfaces mounted). Reduced-motion is handled in CSS.
import React, { useLayoutEffect, useRef } from "react";

// Spine / nav order. Moving to a later entry = "fwd", earlier = "back".
const ORDER = [
  "home", "projects", "ask", "evidence", "analyze",
  "build", "artifacts", "command", "explore", "observability", "team",
];

export function SurfaceSwitch({ surfaceKey, children }: { surfaceKey: string; children: React.ReactNode }) {
  const prevKey = useRef(surfaceKey);
  const scrollMap = useRef<Map<string, number>>(new Map());
  const wrapRef = useRef<HTMLDivElement>(null);

  const to = ORDER.indexOf(surfaceKey);
  const from = ORDER.indexOf(prevKey.current);
  const dir = to >= from ? "fwd" : "back";

  // On a key change, this render runs BEFORE React commits the DOM swap — so the wrapper
  // still contains the OUTGOING surface. Capture its live scrollTop now (race-free; the old
  // scroll-event approach lost the position when the node unmounted before the event fired).
  if (surfaceKey !== prevKey.current) {
    const el = wrapRef.current?.querySelector<HTMLElement>(".hxv-surface");
    if (el) scrollMap.current.set(prevKey.current, el.scrollTop);
  }

  // After the incoming surface mounts, restore its saved scroll. Re-apply once on the next
  // frame too: the enter animation + any synchronous content reflow can otherwise nudge the
  // position, so a post-paint re-set makes restoration exact.
  useLayoutEffect(() => {
    const restore = () => {
      const el = wrapRef.current?.querySelector<HTMLElement>(".hxv-surface");
      if (el) el.scrollTop = scrollMap.current.get(surfaceKey) ?? 0;
    };
    restore();
    const r = requestAnimationFrame(restore);
    prevKey.current = surfaceKey;
    return () => cancelAnimationFrame(r);
  }, [surfaceKey]);

  return (
    <div className="hxv-surfaceswitch" ref={wrapRef} data-dir={dir}>
      {/* key={surfaceKey} → the inner node remounts each switch, replaying the enter animation */}
      <div key={surfaceKey} className="hxv-surface-anim">{children}</div>
    </div>
  );
}
