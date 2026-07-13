// Command palette (Feature #2). ⌘K / Ctrl-K — navigate surfaces, fire actions, jump to
// projects. Controlled by HelixV2 (so the top-bar search and other commands can open it).
// Fuzzy subsequence matching ("evctr" → "Evidence: contradictions") + shortcut hints.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ico } from "./hxIcons";

export interface Cmd { group: string; label: string; ico: keyof typeof Ico; run: () => void; hint?: string; keywords?: string; }

// Subsequence fuzzy score: all query chars must appear in order. Lower = better;
// rewards contiguous runs and start-of-word matches. Returns null if no match.
function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase(), t = text.toLowerCase();
  if (!q) return 0;
  let qi = 0, score = 0, prev = -2, run = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      run = ti === prev + 1 ? run + 1 : 0;
      let cost = ti - prev;               // gaps cost distance
      if (ti === 0 || /[\s\-_/]/.test(t[ti - 1])) cost -= 3; // word-start bonus
      cost -= run;                         // contiguity bonus
      score += cost; prev = ti; qi++;
    }
  }
  return qi === q.length ? score : null;
}

export function CommandPalette({ commands, open, onClose }: { commands: Cmd[]; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const filtered = useMemo(() => {
    if (!q.trim()) return commands;
    return commands
      .map(c => ({ c, s: fuzzyScore(q, c.label + " " + c.group + " " + (c.keywords || "")) }))
      .filter(x => x.s !== null)
      .sort((a, b) => (a.s! - b.s!))
      .map(x => x.c);
  }, [commands, q]);

  useEffect(() => { setSel(s => Math.min(s, Math.max(0, filtered.length - 1))); }, [filtered.length]);
  if (!open) return null;

  // Preserve group order as first-seen in the (already score-sorted) filtered list.
  const groups = [...new Set(filtered.map(c => c.group))];
  const flat = filtered; // sel indexes into the flat filtered list

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(flat.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const c = flat[sel]; if (c) { onClose(); c.run(); } }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  let idx = -1;
  return (
    <div className="hxv-cmdk-scrim" onClick={onClose}>
      <div className="hxv-cmdk" onClick={e => e.stopPropagation()}>
        <div className="hxv-cmdk-inwrap">
          <span className="hxv-cmdk-glyph"><Ico.search /></span>
          <input ref={inputRef} className="hxv-cmdk-in" placeholder="Search commands, surfaces, actions…  ('gph', 'new proj', 'contra')"
            value={q} onChange={e => { setQ(e.target.value); setSel(0); }} onKeyDown={onKeyDown} />
          <kbd className="hxv-cmdk-esc">esc</kbd>
        </div>
        <div className="hxv-cmdk-list">
          {flat.length === 0 && <div className="hxv-cmdk-opt" style={{ color: "var(--v-text3)" }}>No matches for “{q}”.</div>}
          {groups.map(g => (
            <div key={g}>
              <div className="hxv-cmdk-grp">{g}</div>
              {flat.filter(c => c.group === g).map(c => {
                idx++; const here = idx; const IconC = Ico[c.ico];
                return (
                  <div key={g + c.label} className={"hxv-cmdk-opt" + (sel === here ? " on" : "")}
                    onMouseEnter={() => setSel(here)} onClick={() => { onClose(); c.run(); }}>
                    <span className="hxv-nav-ico" style={{ fontSize: 15 }}><IconC /></span>
                    <span className="hxv-cmdk-lbl">{c.label}</span>
                    {c.hint && <kbd className="hxv-cmdk-hint">{c.hint}</kbd>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="hxv-cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> run</span><span><kbd>esc</kbd> close</span>
          <span style={{ marginLeft: "auto", opacity: 0.7 }}>{flat.length} / {commands.length}</span>
        </div>
      </div>
    </div>
  );
}
