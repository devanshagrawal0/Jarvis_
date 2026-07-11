/* THE FORGE — Strategy DNA fingerprint.
   A deterministic generative glyph unique to a strategy: the same spec always
   draws the same sigil, different specs diverge. Encodes signal count (rays),
   indicator types (ring segments), and entry complexity (core). Pure SVG, ice
   palette — a recognizable identity badge for each strategy. */

import { useMemo } from "react";
import { isLogic, type BotSpec, type EntryNode } from "./forge-spec";

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function depth(n: EntryNode): number { return isLogic(n) ? 1 + Math.max(0, ...n.operands.map(depth)) : 0; }

export function ForgeDNA({ spec, size = 46 }: { spec: BotSpec; size?: number }) {
  const glyph = useMemo(() => {
    const key = JSON.stringify({ s: spec.signals.map(s => [s.type, s.params]), e: spec.entry, x: spec.exit });
    const rnd = mulberry(hashStr(key));
    const c = size / 2;
    const rays = Math.max(4, spec.signals.length * 2 + 2);
    const dpt = Math.min(4, depth(spec.entry) + 1);
    const petals: string[] = [];
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const r = size * (0.24 + rnd() * 0.2);
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      const rr = 1 + rnd() * 2.2;
      petals.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(1)}" fill="rgba(220,236,250,${(0.4 + rnd() * 0.5).toFixed(2)})"/>`);
      petals.push(`<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(180,205,230,${(0.12 + rnd() * 0.2).toFixed(2)})" stroke-width="0.6"/>`);
    }
    const rings: string[] = [];
    for (let d = 0; d < dpt; d++) rings.push(`<circle cx="${c}" cy="${c}" r="${(size * (0.12 + d * 0.11)).toFixed(1)}" fill="none" stroke="rgba(174,188,203,${(0.3 - d * 0.05).toFixed(2)})" stroke-width="0.7"/>`);
    return `<circle cx="${c}" cy="${c}" r="${(2 + dpt).toFixed(1)}" fill="#eaf6ff"/>${rings.join("")}${petals.join("")}`;
  }, [spec, size]);
  return <svg className="fg-dna" width={size} height={size} viewBox={`0 0 ${size} ${size}`} dangerouslySetInnerHTML={{ __html: glyph }} aria-label="strategy fingerprint" />;
}
