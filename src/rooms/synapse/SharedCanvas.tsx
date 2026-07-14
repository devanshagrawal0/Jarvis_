import { useCallback, useEffect, useRef, useState } from "react";
import type { SynChannel } from "./synChannel";
import { cursorColor } from "./LiveCursorLayer";

// Synapse W9 — shared whiteboard. Strokes live in a Yjs Y.Array on the channel's CRDT doc, so both
// collaborators draw on one surface and it converges over the relay (no server round-trip). Points
// are normalised 0..1 so the board scales with the panel.

type Stroke = { points: number[][]; color: string; by: string };

export function SharedCanvas({ channelRef, me, ready }: {
  channelRef: React.MutableRefObject<SynChannel | null>;
  me: string;
  ready: boolean;
}) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [live, setLive] = useState<Stroke | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Subscribe to the shared canvas array whenever the channel is ready.
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !ready) return;
    const arr = ch.doc.getArray<Stroke>("canvas");
    const sync = () => setStrokes(arr.toArray());
    sync();
    arr.observe(sync);
    return () => arr.unobserve(sync);
  }, [channelRef, ready]);

  const norm = useCallback((e: React.PointerEvent): number[] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }, []);

  const down = (e: React.PointerEvent) => { (e.target as Element).setPointerCapture?.(e.pointerId); setLive({ points: [norm(e)], color: cursorColor(me), by: me }); };
  const move = (e: React.PointerEvent) => setLive((s) => (s ? { ...s, points: [...s.points, norm(e)] } : s));
  const up = () => {
    if (live && channelRef.current) channelRef.current.doc.getArray<Stroke>("canvas").push([live]);
    setLive(null);
  };
  const clear = () => { const arr = channelRef.current?.doc.getArray("canvas"); if (arr) arr.delete(0, arr.length); };

  const d = (pts: number[][]) => pts.map((p, i) => `${i ? "L" : "M"}${(p[0] * 1000).toFixed(1)},${(p[1] * 600).toFixed(1)}`).join(" ");

  return (
    <div className="syn-canvas-wrap">
      <div className="syn-canvas-bar"><span>Shared whiteboard · {strokes.length} strokes</span><button className="syn-btn ghost sm" onClick={clear}>Clear</button></div>
      <svg ref={svgRef} className="syn-canvas" viewBox="0 0 1000 600" preserveAspectRatio="none"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
        {strokes.map((s, i) => <path key={i} d={d(s.points)} stroke={s.color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
        {live && <path d={d(live.points)} stroke={live.color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />}
      </svg>
    </div>
  );
}
