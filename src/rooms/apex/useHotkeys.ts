/* APEX Home v3 — global keyboard shortcuts.
   Registers one window listener; ignores keystrokes while typing in inputs.
   Keys: "mod+k" (⌘/Ctrl+K), "/", "?", single letters. */

import { useEffect, useRef } from "react";

type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

export function useHotkeys(map: HotkeyMap): void {
  const ref = useRef<HotkeyMap>(map);
  ref.current = map;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const m = ref.current;
      const mod = e.metaKey || e.ctrlKey;
      const combo = (mod ? "mod+" : "") + (e.key.length === 1 ? e.key.toLowerCase() : e.key);
      const handler = m[combo] || (!mod ? m[e.key] : undefined);
      if (handler) { e.preventDefault(); handler(e); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export const HOTKEY_HELP: [string, string][] = [
  ["⌘ K", "Command palette"],
  ["/", "Search tickers"],
  ["B", "Market brief"],
  ["A", "New alert"],
  ["T", "Paper trade"],
  ["1–4", "Switch Jarvis mode"],
  ["?", "This cheatsheet"],
  ["Esc", "Close overlay"],
];
