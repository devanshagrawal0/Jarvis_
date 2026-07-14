import { useCallback, useEffect, useRef, useState } from "react";
import { api, post } from "../../api";
import "./synapse.css";

// Synapse board tile (WidgetShell body). Glanceable, always-honest session status; expands to
// the full room. Opening the room = dispatch "jarvis:open-synapse-room" (JarvisUI listens).

function initials(name?: string) {
  return String(name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}
function openRoom() { document.dispatchEvent(new CustomEvent("jarvis:open-synapse-room")); }

export function SynapseWidget() {
  const [session, setSession] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const s = await api<any>("/api/coop-symbiote/status").catch(() => null);
      if (mounted.current) setSession(s?.activeSession || null);
    } catch { /* transient */ }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const t = window.setInterval(() => void refresh(), 6000);
    return () => { mounted.current = false; window.clearInterval(t); };
  }, [refresh]);

  const active = session?.status === "active";
  const pending = Boolean(session?.pendingJoin);
  const humans = active || pending
    ? [session.hostName || "Host", ...(session.guest ? [session.guest.displayName] : session.pendingJoin ? [session.pendingJoin.displayName] : [])]
    : [];
  const counts = session?.memory?.counts || {};

  const host = useCallback(async () => {
    setBusy(true);
    try { await post("/api/coop-symbiote/session/create", { title: "Synapse Session", mode: "Code Review Mode" }); await refresh(); openRoom(); }
    finally { if (mounted.current) setBusy(false); }
  }, [refresh]);

  return (
    <div className="syn-widget">
      <div className="top">
        <span className={`syn-pill ${active ? "is-live" : pending ? "is-warn" : ""}`}><i />{session ? (pending ? "join pending" : `${session.status}${session.code ? ` · ${session.code}` : ""}`) : "idle"}</span>
        {humans.length > 0 && <div className="fp">{humans.map((n: string, i: number) => <span key={i} className="syn-avatar live" style={{ width: 28, height: 28, fontSize: 11 }}>{initials(n)}</span>)}</div>}
      </div>

      {active || pending ? (
        <>
          <div className="stat">
            <div className="cell"><span>Patches</span><strong>{counts.patches || session?.patches?.length || 0}</strong></div>
            <div className="cell"><span>Tasks</span><strong>{counts.tasks || session?.tasks?.length || 0}</strong></div>
            <div className="cell"><span>Chat</span><strong>{counts.chat || session?.chat?.length || 0}</strong></div>
          </div>
          <div className="unread"><b>{session?.mode || "session"}</b> · repo {session?.repoMatch || "waiting"}</div>
          <button className="syn-btn primary" onClick={openRoom}>Enter room</button>
        </>
      ) : (
        <>
          <div className="unread">The junction where two Jarvis brains connect. Host a session or join a friend's with a code.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="syn-btn primary" style={{ flex: 1 }} disabled={busy} onClick={host}>Start a session</button>
            <button className="syn-btn" style={{ flex: 1 }} onClick={openRoom}>Join with a code</button>
          </div>
        </>
      )}
    </div>
  );
}
