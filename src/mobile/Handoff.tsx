import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Monitor, ChevronRight, Globe, Download, Smartphone, Folder, Clipboard,
  ArrowDown, Link2, Type, Image as ImageIcon,
  Clock, Star, FileText, ClipboardCheck,
} from "lucide-react";
import { api, post, authHeaders } from "../api";

// DROP — a constellation hand-off deck. A central Drop core is ringed by six PC
// destinations. Load a link / photo / file / clipboard, then tap a destination —
// the packet flies down the wire and the real endpoint fires. Icons are the real
// lucide set + the real VS Code mark, not hand-drawn paths.

type Kind = "link" | "file" | "text";
type Payload = { kind: Kind; label: string; url?: string; text?: string; file?: File } | null;
type Sent = { label: string; where: string; at: number; kind: Kind };
const KEY = "jarvis.drop.recent.v4";

const VscodeMark = ({ size = 22 }: { size?: number }) => (
  <svg className="brand" viewBox="0 0 24 24" width={size} height={size} aria-hidden>
    <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
  </svg>
);

type Dest = { id: string; label: string; side: "L" | "R"; row: 0 | 1 | 2; icon: React.ReactNode; accepts: Kind[] };
const DESTS: Dest[] = [
  { id: "vscode", label: "VS Code", side: "L", row: 0, icon: <VscodeMark size={22} />, accepts: ["link", "text"] },
  { id: "browser", label: "Browser", side: "L", row: 1, icon: <Globe size={22} />, accepts: ["link"] },
  { id: "files", label: "Files", side: "L", row: 2, icon: <Folder size={22} />, accepts: ["link", "file", "text"] },
  { id: "downloads", label: "Downloads", side: "R", row: 0, icon: <Download size={22} />, accepts: ["file"] },
  { id: "phone", label: "Phone", side: "R", row: 1, icon: <Smartphone size={22} />, accepts: ["file", "text", "link"] },
  { id: "clipboard", label: "Clipboard", side: "R", row: 2, icon: <Clipboard size={22} />, accepts: ["link", "text"] },
];

const short = (u: string) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, ""); } catch { return u; } };
const ago = (ms: number) => { const s = (Date.now() - ms) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const isUrl = (t: string) => /^https?:\/\/[^\s]+$/i.test(t.trim());
const initialFor = (label: string) => (label.replace(/^https?:\/\/(www\.)?/i, "")[0] || "•").toUpperCase();
const tint = (label: string) => { const p = ["#ff3b5c", "#3b8ef7", "#34d399", "#a78bfa", "#fbbf24", "#22d3ee"]; let h = 0; for (const c of label) h = (h * 31 + c.charCodeAt(0)) >>> 0; return p[h % p.length]; };

export function Handoff({ active, onOpenTab }: { active: boolean; onOpenTab?: (t: string) => void }) {
  const [payload, setPayload] = useState<Payload>(null);
  const [hot, setHot] = useState<string>("");
  const [flash, setFlash] = useState<string>("");
  const [toast, setToast] = useState("");
  const [recent, setRecent] = useState<Sent[]>(() => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } });
  const [fg, setFg] = useState("");
  const [online, setOnline] = useState(true);
  const [downloads, setDownloads] = useState("");
  const [clip, setClip] = useState<{ text: string; kind: Kind } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null), photoRef = useRef<HTMLInputElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 360, h: 300 });

  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast(""), 2400); };
  const push = (e: Sent) => setRecent((r) => { const n = [e, ...r].slice(0, 12); try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* full */ } return n; });

  // measure the constellation so connector lines are crisp at any width
  useLayoutEffect(() => {
    const el = stageRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    (async () => { try { const r = await api<{ roots: Array<{ id: string; path: string }> }>("/api/device-mesh/fs"); setDownloads(r.roots.find((x) => x.id === "downloads")?.path || ""); } catch { /* offline */ } })();
    try { const q = new URLSearchParams(location.search); const l = (q.get("handoff") || q.get("url") || q.get("text") || "").match(/https?:\/\/[^\s]+/)?.[0]; if (l) { history.replaceState(null, "", location.pathname); setPayload({ kind: "link", label: short(l), url: l }); } } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!active) return; let alive = true;
    const pull = async () => { try { const r = await api<{ foreground: { title: string; process: string } | null }>("/api/device-mesh/pc/foreground"); if (alive) { setFg(r.foreground?.title || r.foreground?.process || ""); setOnline(true); } } catch { if (alive) setOnline(false); } };
    void pull(); const t = window.setInterval(pull, 6000); return () => { alive = false; window.clearInterval(t); };
  }, [active]);

  // ---- destination geometry (measured px) ----
  const cardW = Math.min(138, dims.w * 0.34);
  const rowY = [dims.h * 0.15, dims.h * 0.5, dims.h * 0.85];
  const hub = { x: dims.w / 2, y: dims.h * 0.5, r: dims.w < 340 ? 42 : 44 };
  const anchor = (d: Dest) => ({ x: d.side === "L" ? cardW : dims.w - cardW, y: rowY[d.row] });
  const wireStart = (d: Dest) => { const a = anchor(d); const dx = a.x - hub.x, dy = a.y - hub.y; const m = Math.hypot(dx, dy) || 1; return { x: hub.x + (dx / m) * hub.r, y: hub.y + (dy / m) * hub.r }; };

  const fire = useCallback(async (destId: string) => {
    if (!payload) { say("Load something first"); return; }
    const dest = DESTS.find((d) => d.id === destId)!;
    if (!dest.accepts.includes(payload.kind)) { say(`${dest.label} can't take that`); return; }
    const label = payload.label;
    setFlash(destId); window.setTimeout(() => setFlash(""), 620);
    try {
      if (destId === "browser" || (destId === "vscode" && payload.kind === "link")) {
        const r = await post<{ ok: boolean; error?: string }>("/api/device-mesh/pc/open-url", { url: payload.url });
        if (!r.ok) throw new Error(r.error || "Didn't land"); say(`Opened in ${dest.label}`); push({ label, where: dest.label, at: Date.now(), kind: payload.kind });
      } else if (destId === "clipboard") {
        await navigator.clipboard.writeText(payload.url || payload.text || label); say("Copied to clipboard"); push({ label, where: "Clipboard", at: Date.now(), kind: payload.kind });
      } else if (destId === "downloads" && payload.file) {
        if (!downloads) { say("Can't reach Downloads"); return; }
        const res = await fetch(`/api/device-mesh/fs/upload?path=${encodeURIComponent(downloads)}&name=${encodeURIComponent(payload.file.name)}`, { method: "POST", headers: { "content-type": "application/octet-stream", ...authHeaders() }, body: payload.file });
        const j = await res.json().catch(() => ({})); if (!res.ok || !j.ok) throw new Error(j.error || "Upload failed");
        say("Landed in Downloads"); push({ label, where: "Downloads", at: Date.now(), kind: payload.kind });
      } else if (destId === "files") { onOpenTab?.("files"); say("Opening Files"); return;
      } else { say(`${dest.label} — coming soon`); return; }
    } catch (e) { say(e instanceof Error ? e.message : String(e)); return; }
    setPayload(null);
  }, [payload, downloads, onOpenTab]);

  const loadClip = async () => { try { const t = (await navigator.clipboard.readText())?.trim(); if (!t) { say("Clipboard is empty"); return; } setPayload(isUrl(t) ? { kind: "link", label: short(t), url: t } : { kind: "text", label: t.slice(0, 40), text: t }); } catch { say("Allow clipboard access"); } };
  const peekClip = async () => { try { const t = (await navigator.clipboard.readText())?.trim(); if (t) setClip({ text: t, kind: isUrl(t) ? "link" : "text" }); else say("Clipboard is empty"); } catch { say("Allow clipboard access"); } };
  const loadFile = (f: File | undefined, kind: "file") => { if (f) setPayload({ kind, label: f.name, file: f }); };
  const loadText = () => { const t = window.prompt("Text to send"); if (t?.trim()) setPayload({ kind: "text", label: t.trim().slice(0, 40), text: t.trim() }); };
  const loadLink = () => { const t = window.prompt("Paste a link"); if (t && isUrl(t.trim())) setPayload({ kind: "link", label: short(t.trim()), url: t.trim() }); else if (t) say("That's not a link"); };
  const sendClip = () => { if (!clip) return; const smart = clip.kind === "link" ? "browser" : "clipboard"; setPayload(clip.kind === "link" ? { kind: "link", label: short(clip.text), url: clip.text } : { kind: "text", label: clip.text.slice(0, 40), text: clip.text }); window.setTimeout(() => fire(smart), 30); };

  const wireOn = (d: Dest) => payload && d.accepts.includes(payload.kind);

  return (
    <div className="drop">
      {/* 1 · linked banner */}
      <button type="button" className="dp-link" onClick={() => onOpenTab?.("control")}>
        <span className="dp-link-ic"><Monitor size={22} /></span>
        <span className="dp-link-t">
          <b>Linked <em>to your PC</em> · <i>{fg ? (fg.split(/[—|·\-]/)[0].trim().replace(/[\s|·-]+$/, "").slice(0, 16) || "Claude") : "Claude"}</i></b>
          <small><span className={`dp-dot ${online ? "ok" : "bad"}`} />{online ? "Online · Ready to transfer" : "Reconnecting…"}</small>
        </span>
        <ChevronRight size={20} className="dp-chev" />
      </button>

      {/* 2 · constellation */}
      <div className="dp-const" ref={stageRef}>
        <svg className="dp-wire" viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="none" aria-hidden>
          {DESTS.map((d) => { const s = wireStart(d), a = anchor(d); const on = wireOn(d), fl = flash === d.id; return (
            <line key={d.id} x1={s.x} y1={s.y} x2={a.x} y2={a.y} className={`dp-line ${on ? "on" : ""} ${fl ? "fl" : ""}`} />
          ); })}
        </svg>

        {DESTS.map((d) => { const a = anchor(d); const on = wireOn(d); return (
          <button type="button" key={d.id}
            className={`dp-dest ${d.side === "L" ? "l" : "r"} ${on ? "live" : ""} ${flash === d.id ? "flash" : ""} ${hot === d.id ? "hot" : ""}`}
            style={{ top: a.y, ["--x" as string]: `${d.side === "L" ? 0 : dims.w - cardW}px`, width: cardW }}
            onPointerEnter={() => setHot(d.id)} onPointerLeave={() => setHot("")} onClick={() => fire(d.id)}>
            <span className="dp-dest-ic" style={{ ["--a" as string]: d.id === "vscode" ? "#3b8ef7" : "var(--accent-text)" }}>{d.icon}</span>
            <span className="dp-dest-t"><b><span className={`dp-dot ${on ? "live" : "ok"}`} />{d.label}</b><small>{on ? "Send" : "Ready"}</small></span>
          </button>
        ); })}

        <div ref={hubRef} className={`dp-hub ${payload ? "loaded" : ""}`} style={{ left: hub.x, top: hub.y, width: hub.r * 2, height: hub.r * 2 }}>
          <svg className="dp-hub-rings" viewBox="0 0 100 100" aria-hidden><circle className="hr1" cx="50" cy="50" r="48" /><circle className="hr2" cx="50" cy="50" r="39" /></svg>
          <span className="dp-hub-core">
            {payload ? (
              <>
                <span className="dp-hub-ic">{payload.kind === "link" ? <Link2 size={22} /> : payload.kind === "file" ? <FileText size={22} /> : <Type size={22} />}</span>
                <b className="dp-hub-load">{payload.label}</b>
              </>
            ) : (
              <><span className="dp-hub-ic"><ArrowDown size={24} /></span><b>Drop</b><small>Send</small></>
            )}
          </span>
        </div>
      </div>
      <div className="dp-tag"><span>DRAG · DROP · SEND</span><em>ANYTHING. EVERYWHERE.</em></div>

      {/* 3 · load dock */}
      <div className="dp-dock">
        <button type="button" className={payload ? "" : "prime"} onClick={loadClip}><ClipboardCheck size={19} /><span>Paste</span></button>
        <button type="button" onClick={() => photoRef.current?.click()}><ImageIcon size={19} /><span>Photo</span></button>
        <button type="button" onClick={() => fileRef.current?.click()}><FileText size={19} /><span>File</span></button>
        <button type="button" onClick={loadLink}><Link2 size={19} /><span>Link</span></button>
        <button type="button" onClick={loadText}><Type size={19} /><span>Text</span></button>
      </div>
      <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => { loadFile(e.target.files?.[0], "file"); e.target.value = ""; }} />
      <input ref={fileRef} type="file" hidden onChange={(e) => { loadFile(e.target.files?.[0], "file"); e.target.value = ""; }} />

      {/* 4 · detected clipboard */}
      <section className="dp-clip">
        <header><span className="dp-clip-ic"><ClipboardCheck size={18} /></span><b>Detected clipboard</b><small>{clip ? "just now" : ""}</small></header>
        {clip ? (
          <div className="dp-clip-body">
            <p>{clip.text.length > 90 ? clip.text.slice(0, 90) + "…" : clip.text}</p>
            <button type="button" className="dp-clip-send" onClick={sendClip}>
              {clip.kind === "link" ? <Globe size={18} /> : <Clipboard size={18} />}
              <span>Send to<br /><em>{clip.kind === "link" ? "Browser" : "Clipboard"}</em></span><ChevronRight size={16} />
            </button>
          </div>
        ) : (
          <button type="button" className="dp-clip-peek" onClick={peekClip}>Tap to read what you copied</button>
        )}
      </section>

      {/* bottom split */}
      <div className="dp-split">
        <section className="dp-recent">
          <header><span className="dp-hi"><Clock size={16} /></span><b>Recent drops</b>{recent.length ? <button type="button" className="dp-clear" onClick={() => { setRecent([]); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }}>Clear</button> : <ChevronRight size={16} />}</header>
          {recent.length ? recent.slice(0, 3).map((s, i) => (
            <div key={i} className="dp-rrow">
              <span className="dp-rrow-ic" style={{ background: tint(s.label) }}>{s.kind === "file" ? <FileText size={15} /> : s.kind === "link" ? initialFor(s.label) : <Type size={14} />}</span>
              <span className="dp-rrow-t"><b>{s.label}</b><small>→ {s.where}</small></span>
              <small className="dp-rrow-ago">{ago(s.at)}</small>
            </div>
          )) : <div className="dp-empty">Nothing sent yet</div>}
        </section>
        <div className="dp-side">
          <button type="button" className="dp-card" onClick={() => onOpenTab?.("files")}>
            <header><span className="dp-hi"><Monitor size={17} /></span><b>Pull from PC</b><ChevronRight size={16} /></header>
            <p>Browse and import files from your computer.</p>
            <span className="dp-card-cta"><Folder size={16} />Browse PC</span>
          </button>
          <div className="dp-card soft">
            <header><span className="dp-hi"><Star size={17} /></span><b>Smart destinations</b><ChevronRight size={16} /></header>
            <p>Jarvis learns your patterns and suggests targets.</p>
          </div>
        </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
