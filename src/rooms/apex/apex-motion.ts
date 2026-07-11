/* APEX Home v3 — motion primitives. All effects are gated by
   prefers-reduced-motion. Browser-only (uses requestAnimationFrame). */

import { useEffect, useRef, useState } from "react";

export const reduceMotion = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Returns a CSS class ("ax-flash-up"/"ax-flash-dn") for ~400ms when `value` changes. */
export function useFlash(value: number | null | undefined): string {
  const prev = useRef<number | null | undefined>(value);
  const [cls, setCls] = useState("");
  useEffect(() => {
    if (value == null || prev.current == null) { prev.current = value; return; }
    if (value !== prev.current && !reduceMotion()) {
      setCls(value > prev.current ? "ax-flash-up" : "ax-flash-dn");
      const t = setTimeout(() => setCls(""), 420);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return cls;
}

/** Eases the displayed number toward `target` (~420ms cubic-out). Instant under reduced-motion. */
export function useNumberRoll(target: number | null | undefined, ms = 420): number | null {
  const [val, setVal] = useState<number | null>(target ?? null);
  const raf = useRef(0);
  const from = useRef<number>(target ?? 0);
  useEffect(() => {
    if (target == null) { setVal(null); return; }
    if (reduceMotion()) { setVal(target); from.current = target; return; }
    const start = performance.now();
    const a = from.current, b = target;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(a + (b - a) * e);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else from.current = b;
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return val;
}

/** Inline style giving a per-index animation delay for staggered reveals. */
export function stagger(i: number, step = 40): React.CSSProperties | undefined {
  return reduceMotion() ? undefined : { animationDelay: `${i * step}ms` };
}
