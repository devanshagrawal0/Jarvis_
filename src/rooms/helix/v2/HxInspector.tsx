// Feature #6 — contextual right-rail Inspector. A persistent, collapsible panel that
// rebinds to whatever you select (claim / source / assertion / graph node), and when
// nothing is selected shows pinned + recent + a surface-aware context so it's never dead
// space. Also implements the pin system (#21). Selection flows through SelectionProvider.
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Ico } from "./hxIcons";
import { ConfBar } from "./hxViz";
import { useUI } from "./HxUI";

export interface SelItem {
  id: string; kind: string; title: string; subtitle?: string;
  confidence?: number; support?: { sup: number; con: number };
  meta?: [string, string][]; tags?: string[];
  backlinks?: { kind: string; title: string; via?: string; onClick?: () => void }[];
  actions?: { label: string; run: () => void }[];
}

interface SelCtxV {
  sel: SelItem | null; recent: SelItem[]; pins: SelItem[]; compare: SelItem[];
  select: (i: SelItem) => void; clear: () => void;
  togglePin: (i: SelItem) => void; isPinned: (id: string) => boolean;
  toggleCompare: (i: SelItem) => void; inCompare: (id: string) => boolean; clearCompare: () => void;
  notes: Record<string, string[]>; addNote: (id: string, text: string) => void; delNote: (id: string, idx: number) => void;
}
const SelCtx = createContext<SelCtxV>({ sel: null, recent: [], pins: [], compare: [], select: () => {}, clear: () => {}, togglePin: () => {}, isPinned: () => false, toggleCompare: () => {}, inCompare: () => false, clearCompare: () => {}, notes: {}, addNote: () => {}, delNote: () => {} });
export const useSelection = () => useContext(SelCtx);

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [sel, setSel] = useState<SelItem | null>(null);
  const [recent, setRecent] = useState<SelItem[]>([]);
  const [pins, setPins] = useState<SelItem[]>(() => { try { return JSON.parse(localStorage.getItem("helix-pins") || "[]"); } catch { return []; } });
  const [compare, setCompare] = useState<SelItem[]>([]);
  const [notes, setNotes] = useState<Record<string, string[]>>(() => { try { return JSON.parse(localStorage.getItem("helix-notes") || "{}"); } catch { return {}; } });
  const persistNotes = (n: Record<string, string[]>) => { setNotes(n); localStorage.setItem("helix-notes", JSON.stringify(n)); };
  const addNote = useCallback((id: string, text: string) => setNotes(n => { const next = { ...n, [id]: [...(n[id] || []), text] }; localStorage.setItem("helix-notes", JSON.stringify(next)); return next; }), []);
  const delNote = useCallback((id: string, idx: number) => setNotes(n => { const arr = (n[id] || []).filter((_, i) => i !== idx); const next = { ...n, [id]: arr }; if (!arr.length) delete next[id]; localStorage.setItem("helix-notes", JSON.stringify(next)); return next; }), []);
  const select = useCallback((i: SelItem) => { setSel(i); setRecent(r => [i, ...r.filter(x => x.id !== i.id)].slice(0, 6)); }, []);
  const clear = useCallback(() => setSel(null), []);
  const togglePin = useCallback((i: SelItem) => setPins(p => {
    const has = p.some(x => x.id === i.id);
    const n = has ? p.filter(x => x.id !== i.id) : [{ ...i, actions: undefined }, ...p].slice(0, 14);
    localStorage.setItem("helix-pins", JSON.stringify(n)); return n;
  }), []);
  const isPinned = useCallback((id: string) => pins.some(x => x.id === id), [pins]);
  const toggleCompare = useCallback((i: SelItem) => setCompare(c => c.some(x => x.id === i.id) ? c.filter(x => x.id !== i.id) : [...c, { ...i, actions: undefined }].slice(0, 4)), []);
  const inCompare = useCallback((id: string) => compare.some(x => x.id === id), [compare]);
  const clearCompare = useCallback(() => setCompare([]), []);
  return <SelCtx.Provider value={{ sel, recent, pins, compare, select, clear, togglePin, isPinned, toggleCompare, inCompare, clearCompare, notes, addNote, delNote }}>{children}</SelCtx.Provider>;
}

const KIND_COLOR: Record<string, string> = { source: "#3f8cff", claim: "#34cfe0", evidence: "#34cfe0", analysis: "#33d69a", assertion: "#33d69a", decision: "#f2b03d", artifact: "#9b6cff", node: "#33c2d1", file: "#3f8cff" };
const kcol = (k: string) => KIND_COLOR[(k || "").toLowerCase().split(" ")[0]] || "#33c2d1";

export function HxInspector({ open, onToggle, surface, onNav }:
  { open: boolean; onToggle: () => void; surface: string; onNav: (s: string) => void }) {
  const { sel, recent, pins, clear, togglePin, isPinned, select, toggleCompare, inCompare, notes, addNote, delNote } = useSelection();
  const { prompt } = useUI();
  const selNotes = sel ? (notes[sel.id] || []) : [];

  const SURFACE_CTX: Record<string, { tip: string; jumps: [string, string][] }> = {
    home: { tip: "Select a file or metric to inspect it here.", jumps: [["Ask a question", "ask"], ["Review evidence", "evidence"], ["Open 3D graph", "explore"]] },
    evidence: { tip: "Click any claim to see its support, sources and confidence.", jumps: [["Analyze contradictions", "analyze"], ["Build an artifact", "build"]] },
    analyze: { tip: "Select an assertion to trace its evidence and confidence.", jumps: [["Back to evidence", "evidence"], ["Compose a decision", "analyze"]] },
    explore: { tip: "Click a graph node to inspect it and its connections.", jumps: [["Search everything", "explore"], ["Command Center", "command"]] },
    build: { tip: "Select an artifact to see its manifest and citations.", jumps: [["Review analysis", "analyze"]] },
  };
  const ctx = SURFACE_CTX[surface] || { tip: "Select anything to inspect it here.", jumps: [["Home", "home"]] };

  return (
    <aside className={"hxv-insp" + (open ? " open" : "")}>
      <div className="hxv-insp-head">
        <span className="hxv-u">{sel ? "Inspector" : "Context"}</span>
        <button className="hxv-insp-x" onClick={onToggle} title="Collapse inspector (I)"><Ico.chevron /></button>
      </div>

      {sel ? (
        <div className="hxv-insp-body">
          <div className="hxv-insp-kind" style={{ color: kcol(sel.kind) }}>
            <span className="hxv-insp-kdot" style={{ background: kcol(sel.kind), boxShadow: `0 0 8px ${kcol(sel.kind)}` }} />{sel.kind}
          </div>
          <div className="hxv-insp-title">{sel.title}</div>
          {sel.subtitle && <div className="hxv-insp-sub">{sel.subtitle}</div>}

          {sel.confidence != null && (
            <div className="hxv-insp-block">
              <div className="hxv-u">Confidence</div>
              <ConfBar value={sel.confidence} band={[Math.max(0, sel.confidence - 0.08), Math.min(1, sel.confidence + 0.08)]} width={210} />
            </div>
          )}
          {sel.support && (
            <div className="hxv-insp-block">
              <div className="hxv-u">Support</div>
              <div className="hxv-insp-support">
                <span className="hxv-insp-sc g">{sel.support.sup} supporting</span>
                <span className={"hxv-insp-sc " + (sel.support.con ? "r" : "z")}>{sel.support.con} contradicting</span>
              </div>
            </div>
          )}
          {!!sel.meta?.length && (
            <div className="hxv-insp-block">
              <div className="hxv-u">Details</div>
              {sel.meta.map(([k, v]) => <div className="hxv-insp-mrow" key={k}><span>{k}</span><span className="hxv-mono">{v}</span></div>)}
            </div>
          )}
          {!!sel.tags?.length && <div className="hxv-insp-tags">{sel.tags.map(t => <span key={t} className="hxv-tag">{t}</span>)}</div>}

          {!!sel.backlinks?.length && (
            <div className="hxv-insp-block">
              <div className="hxv-u">Connected <span className="hxv-insp-n">{sel.backlinks.length}</span></div>
              {sel.backlinks.map((b, i) => (
                <div className="hxv-insp-item" key={i} onClick={b.onClick}>
                  <span className="hxv-insp-idot" style={{ background: kcol(b.kind) }} />
                  <span className="hxv-insp-ititle">{b.title}</span>
                  {b.via && <span className="hxv-insp-via">{b.via}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="hxv-insp-block">
            <div className="hxv-u" style={{ justifyContent: "space-between", display: "flex", alignItems: "center" }}>Notes <span className="hxv-savelink" onClick={async () => { const t = await prompt({ title: "Add note", label: `Annotate "${sel.title.slice(0, 40)}"`, placeholder: "Your note…", confirmText: "Add" }); if (t) addNote(sel.id, t); }}>＋ Note</span></div>
            {selNotes.length === 0 && <div className="hxv-insp-empty">No notes yet.</div>}
            {selNotes.map((n, i) => (
              <div className="hxv-insp-note" key={i}><span>{n}</span><button className="hxv-insp-unpin" onClick={() => delNote(sel.id, i)} title="Delete note">×</button></div>
            ))}
          </div>

          <div className="hxv-insp-actions">
            <button className={"hxv-btn" + (isPinned(sel.id) ? " solid" : "")} onClick={() => togglePin(sel)}>{isPinned(sel.id) ? "★ Pinned" : "☆ Pin"}</button>
            <button className={"hxv-btn" + (inCompare(sel.id) ? " solid" : " ghost")} onClick={() => toggleCompare(sel)}>{inCompare(sel.id) ? "⊟ In compare" : "⊞ Compare"}</button>
            {sel.actions?.map(a => <button key={a.label} className="hxv-btn ghost" onClick={a.run}>{a.label}</button>)}
            <button className="hxv-btn ghost" onClick={clear}>Clear</button>
          </div>
        </div>
      ) : (
        <div className="hxv-insp-body">
          <div className="hxv-insp-tip">{ctx.tip}</div>

          <div className="hxv-insp-block">
            <div className="hxv-u">Pinned <span className="hxv-insp-n">{pins.length}</span></div>
            {pins.length === 0 && <div className="hxv-insp-empty">Pin anything to keep it one click away.</div>}
            {pins.map(p => (
              <div className="hxv-insp-item" key={p.id} onClick={() => select(p)}>
                <span className="hxv-insp-idot" style={{ background: kcol(p.kind) }} />
                <span className="hxv-insp-ititle">{p.title}</span>
                <button className="hxv-insp-unpin" onClick={e => { e.stopPropagation(); togglePin(p); }} title="Unpin">×</button>
              </div>
            ))}
          </div>

          <div className="hxv-insp-block">
            <div className="hxv-u">Recent</div>
            {recent.length === 0 && <div className="hxv-insp-empty">Items you inspect appear here.</div>}
            {recent.map(p => (
              <div className="hxv-insp-item" key={p.id} onClick={() => select(p)}>
                <span className="hxv-insp-idot" style={{ background: kcol(p.kind) }} />
                <span className="hxv-insp-ititle">{p.title}</span>
              </div>
            ))}
          </div>

          <div className="hxv-insp-block">
            <div className="hxv-u">Quick actions</div>
            {ctx.jumps.map(([label, nav]) => (
              <div className="hxv-insp-jump" key={label} onClick={() => onNav(nav)}><Ico.arrow /><span>{label}</span></div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

// Comparison mode (#5): a floating tray accumulates items; the overlay lays them out in
// synchronized columns with aligned attribute rows, highlighting where they differ.
export function CompareTray() {
  const { compare, toggleCompare, clearCompare } = useSelection();
  const [open, setOpen] = useState(false);
  if (!compare.length) return null;
  return (
    <>
      <div className="hxv-cmptray">
        <span className="hxv-u" style={{ flex: "none" }}>Compare</span>
        <div className="hxv-cmptray-chips">
          {compare.map(c => (
            <span className="hxv-cmpchip" key={c.id}>
              <span className="hxv-insp-idot" style={{ background: kcol(c.kind) }} />{c.title.slice(0, 26)}
              <button onClick={() => toggleCompare(c)} title="Remove">×</button>
            </span>
          ))}
        </div>
        <button className="hxv-btn solid" disabled={compare.length < 2} style={{ opacity: compare.length < 2 ? 0.5 : 1 }} onClick={() => setOpen(true)}>Compare {compare.length}</button>
        <button className="hxv-btn ghost" onClick={clearCompare}>Clear</button>
      </div>
      {open && <CompareOverlay onClose={() => setOpen(false)} />}
    </>
  );
}

function CompareOverlay({ onClose }: { onClose: () => void }) {
  const { compare } = useSelection();
  const metaKeys = [...new Set(compare.flatMap(c => (c.meta || []).map(m => m[0])))];
  const cell = (vals: (string | null)[], render: (v: string | null, i: number) => React.ReactNode) => {
    const differ = new Set(vals.map(v => v ?? "—")).size > 1;
    return vals.map((v, i) => <div className={"hxv-cmp-cell" + (differ ? " diff" : "")} key={i}>{render(v, i)}</div>);
  };
  return (
    <div className="hxv-cmp-scrim" onClick={onClose}>
      <div className="hxv-cmp" onClick={e => e.stopPropagation()}>
        <div className="hxv-cmp-head"><span className="hxv-cmp-t">Comparing {compare.length} items <span className="hxv-cmp-hint">· highlighted rows differ</span></span><button className="hxv-btn ghost" onClick={onClose}>Close</button></div>
        <div className="hxv-cmp-grid" style={{ gridTemplateColumns: `150px repeat(${compare.length}, minmax(160px, 1fr))` }}>
          <div className="hxv-cmp-rk" />
          {compare.map(c => (
            <div className="hxv-cmp-colh" key={c.id}>
              <span className="hxv-insp-kind" style={{ color: kcol(c.kind) }}><span className="hxv-insp-kdot" style={{ background: kcol(c.kind) }} />{c.kind}</span>
              <div className="hxv-cmp-title">{c.title}</div>
            </div>
          ))}

          <div className="hxv-cmp-rk">Confidence</div>
          {cell(compare.map(c => c.confidence != null ? c.confidence.toFixed(2) : null), (v) => v == null ? "—" : <ConfBar value={Number(v)} width={120} />)}

          <div className="hxv-cmp-rk">Support</div>
          {cell(compare.map(c => c.support ? `${c.support.sup}/${c.support.con}` : null), (v) => v == null ? "—" : <span className="hxv-mono">{v.split("/")[0]} sup · {v.split("/")[1]} con</span>)}

          {metaKeys.map(k => (
            <React.Fragment key={k}>
              <div className="hxv-cmp-rk">{k}</div>
              {cell(compare.map(c => (c.meta || []).find(m => m[0] === k)?.[1] ?? null), (v) => <span>{v ?? "—"}</span>)}
            </React.Fragment>
          ))}

          <div className="hxv-cmp-rk">Connections</div>
          {cell(compare.map(c => String(c.backlinks?.length ?? 0)), (v) => <span className="hxv-mono">{v}</span>)}
        </div>
      </div>
    </div>
  );
}
