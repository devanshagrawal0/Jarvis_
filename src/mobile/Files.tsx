import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, post, authHeaders } from "../api";
import { Sheet } from "./Control";

// Files — browse THIS PC from the phone. Quick-access roots, folder navigation with a breadcrumb,
// search, image thumbnails, and per-file actions (open on the PC, reveal, download to the phone).
// Everything is the real filesystem over the owner's tailnet; nothing is mocked.

type Entry = { name: string; path: string; dir: boolean; kind: string; size: number; mtime: number };
type Root = { id: string; name: string; path: string; icon: string };
type Listing = { path: string; parent: string; name: string; entries: Entry[] };

const KIND_ACCENT: Record<string, string> = { folder: "#6ff2ff", image: "#7dd3fc", video: "#f0abfc", audio: "#86efac", doc: "#fca5a5", sheet: "#86efac", code: "#fcd34d", archive: "#fdba74", app: "#c4b5fd", file: "#9ca3af", drive: "#6ff2ff" };

const I = {
  chevron: <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>,
  up: <svg viewBox="0 0 24 24"><path d="M12 19V6M6 12l6-6 6 6" /></svg>,
  search: <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>,
  home: <svg viewBox="0 0 24 24"><path d="M4 11l8-6 8 6M6 10v9h12v-9" /></svg>,
  desktop: <svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="12" rx="1.5" /><path d="M8.5 20h7M12 16.5V20" /></svg>,
  download: <svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>,
  doc: <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></svg>,
  image: <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M5 17l4.5-4 3 2.5L16 11l3 3.5" /></svg>,
  video: <svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M10 9.5v5l4.5-2.5z" /></svg>,
  audio: <svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></svg>,
  drive: <svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="2" /><circle cx="8" cy="12" r="1.3" /><path d="M13 12h5" /></svg>,
  sheet: <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 4v16" /></svg>,
  code: <svg viewBox="0 0 24 24"><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" /></svg>,
  archive: <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 4v6M10 7h4M10 12h4v3h-4z" /></svg>,
  app: <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h6v6H9z" /></svg>,
  file: <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></svg>,
  music: <svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></svg>,
  openPc: <svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" /></svg>,
  reveal: <svg viewBox="0 0 24 24"><path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>,
  send: <svg viewBox="0 0 24 24"><path d="M12 20V7M6 13l6-6 6 6" /></svg>,
};
const kindIcon = (k: string): React.ReactNode => (I as any)[k] || I.file;

function fmtSize(b: number) { if (!b) return ""; const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0, n = b; while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; } return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`; }
function fmtDate(ms: number) { if (!ms) return ""; const d = new Date(ms), now = Date.now(); const day = 86400000; const diff = now - d.getTime(); if (diff < day && d.getDate() === new Date().getDate()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); if (diff < 7 * day) return d.toLocaleDateString([], { weekday: "short" }); return d.toLocaleDateString([], { month: "short", day: "numeric" }); }

export function Files({ active }: { active: boolean }) {
  const [roots, setRoots] = useState<Root[]>([]);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [reach, setReach] = useState<"checking" | "ok" | "down">("checking");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Entry[] | null>(null);
  const [sel, setSel] = useState<Entry | null>(null);
  const [toast, setToast] = useState("");
  const [uploading, setUploading] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast(""), 2600); };

  const loadRoots = useCallback(async () => {
    try { const r = await api<{ roots: Root[] }>("/api/device-mesh/fs"); setRoots(r.roots); setReach("ok"); }
    catch (e) { setReach("down"); setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  const open = useCallback(async (dirPath: string) => {
    setLoading(true); setErr(""); setResults(null); setQ("");
    try { const r = await api<{ ok: boolean; error?: string } & Listing>(`/api/device-mesh/fs?path=${encodeURIComponent(dirPath)}`); if (r.ok) setListing(r); else setErr(r.error || "Could not open that folder."); setReach("ok"); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setReach("down"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (active && !roots.length) void loadRoots(); }, [active, roots.length, loadRoots]);

  // Phone → PC: stream each chosen file straight into the folder we're viewing.
  const onPick = useCallback(async (files: FileList | null) => {
    if (!files || !files.length || !listing) return;
    const dest = listing.path;
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      setUploading(`${f.name}${files.length > 1 ? ` (${i + 1}/${files.length})` : ""}`);
      try {
        const res = await fetch(`/api/device-mesh/fs/upload?path=${encodeURIComponent(dest)}&name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { "content-type": "application/octet-stream", ...authHeaders() }, body: f });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) throw new Error(j.error || `Upload failed (${res.status})`);
      } catch (e) { say(e instanceof Error ? e.message : String(e)); setUploading(""); return; }
    }
    setUploading("");
    say(files.length > 1 ? `Sent ${files.length} files to ${listing.name}` : `Sent to ${listing.name}`);
    void open(dest);
  }, [listing, open]);

  // debounced search under the current folder (or home)
  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    const t = window.setTimeout(async () => {
      try { const base = listing?.path || ""; const r = await api<{ results: Entry[] }>(`/api/device-mesh/fs/search?q=${encodeURIComponent(q)}${base ? `&path=${encodeURIComponent(base)}` : ""}`); setResults(r.results); }
      catch { setResults([]); }
    }, 350);
    return () => window.clearTimeout(t);
  }, [q, listing?.path]);

  const crumbs = useMemo(() => {
    if (!listing) return [];
    const parts = listing.path.split(/[\\/]+/).filter(Boolean);
    const sep = listing.path.includes("\\") ? "\\" : "/";
    const out: Array<{ name: string; path: string }> = [];
    let acc = listing.path.startsWith("/") ? "" : "";
    for (let i = 0; i < parts.length; i += 1) { acc = i === 0 && !listing.path.startsWith("/") ? parts[0] + sep : acc + parts[i] + (i < parts.length - 1 ? sep : ""); out.push({ name: parts[i], path: listing.path.startsWith("/") ? "/" + parts.slice(0, i + 1).join("/") : acc.replace(/[\\/]+$/, "") }); }
    return out;
  }, [listing]);

  const onFile = useCallback(async (e: Entry) => {
    if (e.dir) { void open(e.path); return; }
    setSel(e);
  }, [open]);
  const openOnPc = useCallback(async (e: Entry) => {
    say(`Opening ${e.name} on the PC…`);
    try { const r = await post<{ ok: boolean; error?: string }>("/api/device-mesh/fs/open", { path: e.path }); say(r.ok ? `Opened ${e.name} on the PC` : r.error || "Could not open it"); }
    catch (err) { say(err instanceof Error ? err.message : String(err)); }
    setSel(null);
  }, []);
  const reveal = useCallback(async (e: Entry) => {
    try { await post("/api/device-mesh/fs/reveal", { path: e.path }); say("Shown in Explorer on the PC"); } catch { /* ignore */ }
    setSel(null);
  }, []);
  const download = useCallback((e: Entry) => {
    const url = `/api/device-mesh/fs/file?path=${encodeURIComponent(e.path)}&download=1`;
    const a = document.createElement("a"); a.href = url; a.download = e.name; document.body.appendChild(a); a.click(); a.remove();
    say(`Downloading ${e.name}…`); setSel(null);
  }, []);

  const list = results ?? listing?.entries ?? [];
  const atRoots = !listing && !results;

  return (
    <div className="files">
      <label className="find">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder={listing ? `Search in ${listing.name}` : "Search the PC"} autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" /></label>

      {/* quick access — always available */}
      <div className="froots">
        {roots.map((r) => (
          <button key={r.id} type="button" className={`froot ${listing?.path === r.path ? "on" : ""}`} onClick={() => void open(r.path)}>
            <span className="froot-ico">{kindIcon(r.icon)}</span><small>{r.name}</small>
          </button>
        ))}
      </div>

      {/* breadcrumb / up / send-to-this-folder */}
      {listing ? (
        <div className="fbar">
          {listing.parent ? <button type="button" className="fup" onClick={() => void open(listing.parent)}>{I.up}</button> : null}
          <div className="fcrumbs">{crumbs.map((c, i) => <React.Fragment key={c.path}>{i > 0 ? <i>›</i> : null}<button type="button" onClick={() => void open(c.path)}>{c.name}</button></React.Fragment>)}</div>
          <button type="button" className="fsend" onClick={() => fileInput.current?.click()} aria-label="Send files from phone to this folder">{I.send}<span>Send</span></button>
        </div>
      ) : null}
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void onPick(e.target.files); e.target.value = ""; }} />
      {uploading ? <div className="fup-bar"><i className="spin" /><span>Sending {uploading} to the PC…</span></div> : null}

      {err ? <div className="err">{err}</div> : null}
      {reach === "down" ? <div className="ctl-hint">PC not reachable.</div> : null}

      {atRoots && !err ? <div className="ctl-hint">Pick a place above, or search the PC.</div> : null}
      {results && !results.length ? <div className="ctl-hint">Nothing matches “{q}”.</div> : null}
      {loading ? <div className="ctl-hint">Opening…</div> : null}

      <div className="flist">
        {list.map((e) => (
          <button key={e.path} type="button" className="frow" onClick={() => void onFile(e)}>
            {e.kind === "image" ? <img className="fthumb" src={`/api/device-mesh/fs/thumb?path=${encodeURIComponent(e.path)}`} alt="" loading="lazy" onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }} /> : null}
            <span className="fico" style={{ color: KIND_ACCENT[e.kind] || KIND_ACCENT.file }}>{kindIcon(e.kind)}</span>
            <span className="frow-t"><b>{e.name}</b><small>{e.dir ? "Folder" : [fmtSize(e.size), fmtDate(e.mtime)].filter(Boolean).join(" · ")}</small></span>
            <span className="frow-go">{I.chevron}</span>
          </button>
        ))}
      </div>

      {sel ? (
        <Sheet title={sel.name} sub={[sel.kind !== "file" ? sel.kind[0].toUpperCase() + sel.kind.slice(1) : "File", fmtSize(sel.size), fmtDate(sel.mtime)].filter(Boolean).join(" · ")} onClose={() => setSel(null)}>
          {sel.kind === "image" ? <img className="fpreview" src={`/api/device-mesh/fs/file?path=${encodeURIComponent(sel.path)}`} alt={sel.name} /> : null}
          <div className="list">
            <button type="button" className="tile" onClick={() => void openOnPc(sel)}><span className="tile-ico">{I.openPc}</span><span className="tile-t"><b>Open on the PC</b><small>Launch with its default app</small></span></button>
            <button type="button" className="tile" onClick={() => download(sel)}><span className="tile-ico">{I.download}</span><span className="tile-t"><b>Download to phone</b><small>Save a copy here</small></span></button>
            <button type="button" className="tile" onClick={() => void reveal(sel)}><span className="tile-ico">{I.reveal}</span><span className="tile-t"><b>Show in Explorer</b><small>Reveal on the PC</small></span></button>
          </div>
        </Sheet>
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
