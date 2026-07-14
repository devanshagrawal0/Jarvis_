import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, post, streamPost } from "../../api";
import { useSynapseSession } from "./useSynapseSession";
import { SynChannel, type ChannelStatus } from "./synChannel";
import { generateIdentity } from "./synNoise";
import { useSessionChoreographer, type ChoreoEvent, type Suggestion } from "./useSessionChoreographer";
import { LiveCursorLayer, type Cursor } from "./LiveCursorLayer";
import { CallPanel } from "./CallPanel";
import type { SynCall } from "./synCall";
import "./synapse.css";

// Synapse — W1 dedicated room (P0 shell on the single-machine co-op backend).
// Six zones: header, presence rail, shared workspace, call panel (W6 placeholder), dual chat, timeline.
// Cross-machine transport, live cursors and the real call arrive in W2–W6.

const MODES = ["Code Review Mode", "Pair Build Mode", "Jarvis Debate Mode", "Screen Co-Pilot Mode", "Skill Transfer Mode"];

function fmtTime(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function initials(name?: string) {
  return String(name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}

export function SynapseRoom({ onExit }: { onExit: () => void }) {
  const syn = useSynapseSession(true, 4000);
  const { session, files, memory, busy, notice, error, run, setNotice, setError } = syn;
  const counts = memory?.counts || session?.memory?.counts || {};

  const [mode, setMode] = useState(MODES[0]);
  const [joinCode, setJoinCode] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [view, setView] = useState<"files" | "patches" | "debate" | "screen">("files");
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const [channelStatus, setChannelStatus] = useState<ChannelStatus>("closed");
  const channelRef = useRef<SynChannel | null>(null);
  const [livePeers, setLivePeers] = useState<Array<{ role: string; name: string }>>([]);
  const [cursors, setCursors] = useState<Record<string, Cursor>>({});
  const [choreoEvents, setChoreoEvents] = useState<ChoreoEvent[]>([]);
  const [following, setFollowing] = useState<string | null>(null);
  const followingRef = useRef<string | null>(null);
  useEffect(() => { followingRef.current = following; }, [following]);
  const callRef = useRef<SynCall | null>(null);
  const [callActive, setCallActive] = useState(false);
  const pushEvent = useCallback((e: Omit<ChoreoEvent, "at">) => setChoreoEvents((prev) => [...prev.slice(-19), { ...e, at: Date.now() }]), []);

  // Invite-link entry: `<host>?tool=coop&coop_code=…` pre-fills the join code (W2).
  const invitePrefilled = useRef(false);
  useEffect(() => {
    if (invitePrefilled.current) return;
    const code = new URLSearchParams(window.location.search).get("coop_code");
    if (code) { invitePrefilled.current = true; setJoinCode(code); }
  }, []);

  // Escape exits the room (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = document.activeElement?.tagName;
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
      onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  // W4: open the live signaling/relay channel while a session is active. Presence + peer chat push
  // instantly (poll stays as the ultimate fallback). Role = guest when arriving via an invite link.
  const channelSessionId = session?.id;
  const sessionCode = session?.code;
  const sessionActive = session?.status === "active";
  useEffect(() => {
    if (!channelSessionId || !sessionCode || !sessionActive) return;
    const isGuest = !!new URLSearchParams(window.location.search).get("coop_code");
    const ch = new SynChannel(sessionCode, isGuest ? "guest" : "host", isGuest ? "Dev (guest)" : (session?.hostName || "Host"), {
      onStatus: setChannelStatus,
      onPresence: (roster, event, who) => {
        setLivePeers(roster);
        if (event === "join") pushEvent({ kind: "peer-join", who });
        else if (event === "leave") pushEvent({ kind: "peer-leave", who });
        void syn.refresh();
      },
      onChat: (m) => { pushEvent({ kind: "chat", who: { name: m.name } }); void syn.refresh(); },
      onSignal: (m) => { if (m.channel === "call") void callRef.current?.onSignal(m); }, // route media SDP/ICE to the call
      onCursor: (m) => {
        if (m.kind === "view") { // follow-mode: mirror the followed peer's active workspace tab
          if (followingRef.current && (m.name === followingRef.current || m.from === followingRef.current)) setView(m.view);
          return;
        }
        const key = m.name || m.from || "peer";
        setCursors((prev) => ({ ...prev, [key]: { x: m.x, y: m.y, name: m.name, from: m.from, at: Date.now() } }));
      },
    });
    channelRef.current = ch;
    ch.connect();
    return () => { ch.close(); channelRef.current = null; setChannelStatus("closed"); setLivePeers([]); setCursors({}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelSessionId, sessionCode, sessionActive]);

  // Prune stale cursors (no update in 5s) and broadcast our active workspace tab for follow-mode.
  useEffect(() => {
    const t = window.setInterval(() => setCursors((prev) => {
      const now = Date.now(); const next: Record<string, Cursor> = {}; let changed = false;
      for (const [k, v] of Object.entries(prev)) { if (now - v.at < 5000) next[k] = v; else changed = true; }
      return changed ? next : prev;
    }), 2000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => { channelRef.current?.send({ type: "cursor", kind: "view", view }); }, [view]);

  const choreo = useSessionChoreographer({ session, livePeers, events: choreoEvents, callActive });

  const runSuggestion = useCallback((s: Suggestion) => {
    const id = session?.id;
    if (s.kind === "approve" && id) run("approve", () => post(`/api/coop-symbiote/session/${encodeURIComponent(id)}/approve-join`, {}), "Guest approved — Synapse is live.");
    else if (s.kind === "review-patch") setView("patches");
    else if (s.kind === "share") { navigator.clipboard?.writeText(session?.inviteLinks?.[0] || session?.code || ""); setNotice("Invite copied."); }
    else if (s.kind === "debate" && id) run("debate", () => post("/api/coop-symbiote/debate", { sessionId: id, topic: "What is the safest next step?" }), "Debate ran.");
    else if (s.kind === "call") setNotice("The live call turns on in W6.");
  }, [session, run, setNotice]);

  const selfRole = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("coop_code") ? "guest" : "host";

  const exportRecap = useCallback(async () => {
    if (!session?.id) return;
    try {
      const r = await api<any>(`/api/coop-symbiote/session/${encodeURIComponent(session.id)}/export?format=md`);
      const url = URL.createObjectURL(new Blob([r.content || ""], { type: "text/markdown" }));
      const a = document.createElement("a"); a.href = url; a.download = r.filename || "synapse-recap.md"; a.click();
      URL.revokeObjectURL(url);
      setNotice("Session recap exported.");
    } catch (e: any) { setError(e?.message || String(e)); }
  }, [session, setNotice, setError]);

  const isActive = session?.status === "active";
  const isPending = Boolean(session?.pendingJoin);
  const statusLabel = session ? (isPending ? "join pending" : session.status) : "idle";
  const statusLive = isActive;

  const participants = useMemo(() => {
    if (!session) return [] as any[];
    const list: any[] = [{ name: session.hostName || "Host", role: "host", live: true, kind: "human" }];
    if (session.guest) list.push({ name: session.guest.displayName, role: "guest", live: true, kind: "human" });
    else if (session.pendingJoin) list.push({ name: session.pendingJoin.displayName, role: "joining", live: false, kind: "human" });
    list.push({ name: "Jarvis · Host", role: "jarvis", live: true, kind: "jarvis" });
    if (session.guest) list.push({ name: "Jarvis · Guest", role: "jarvis", live: true, kind: "jarvis" });
    list.push({ name: "Choreographer", role: "session ux", live: isActive, kind: "jarvis" });
    return list;
  }, [session, isActive]);
  const humans = participants.filter((p) => p.kind === "human");

  const openFileAt = useCallback(async (path: string) => {
    setError("");
    try {
      const r = await api<any>(`/api/coop-symbiote/file?path=${encodeURIComponent(path)}`);
      const f = r.file || r; // route wraps the payload as { file: { content, ... } }
      setOpenFile({ path, content: f.content || "" });
    } catch (e: any) { setError(e?.message || String(e)); }
  }, [setError]);

  const sid = session?.id;
  const patchAct = (id: string, verb: string, label: string) =>
    run(`patch-${verb}-${id}`, () => post(`/api/coop-symbiote/patches/${encodeURIComponent(id)}/${verb}`, { sessionId: sid, actor: "Dev" }), label);

  return (
    <div className={`syn-room ${callActive ? "syn-oncall" : ""}`}>
      <div className="syn-mesh-bg" />

      {/* ---- Zone A: header ---- */}
      <header className="syn-header">
        <div className="syn-brand">
          <span className="syn-glyph">⬡</span>
          <div><h1>Synapse<small>two brains, one workspace</small></h1></div>
        </div>

        {session ? (
          <span className="syn-mode"><span className="syn-pill">{session.mode || mode}</span></span>
        ) : (
          <span className="syn-mode">
            <select className="syn-select" value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </span>
        )}

        <span className={`syn-pill ${statusLive ? "is-live" : isPending ? "is-warn" : ""}`}><i />{statusLabel}</span>
        {session && <span className={`syn-pill ${session.repoMatch === "exact" ? "is-live" : session.repoMatch === "mismatch" ? "is-warn" : ""}`}>repo {session.repoMatch || "waiting"}</span>}
        {session?.guest?.safetyNumber && <span className="syn-pill" title="Read these digits aloud with your collaborator to confirm no man-in-the-middle (Signal-style safety number)">🔐 {session.guest.safetyNumber}</span>}
        {isActive && <span className={`syn-pill ${channelStatus === "open" ? "is-live" : channelStatus === "connecting" ? "is-warn" : ""}`} title="Live relay channel (presence + signaling)">{channelStatus === "open" ? "⚡ live" : channelStatus === "connecting" ? "linking…" : "relay off"}</span>}

        <span className="syn-spacer" />

        {isActive && (
          <span className="syn-invite">
            <span className="syn-code">{session.code || "—"}</span>
            <button className="syn-btn sm" onClick={() => { navigator.clipboard?.writeText(session.inviteLinks?.[0] || session.code || ""); setNotice("Invite copied."); }}>Copy invite</button>
            {selfRole === "host" && <button className="syn-btn ghost sm" title="Rotate the invite code (invalidates the old one)" disabled={!!busy} onClick={() => run("rotate", () => post(`/api/coop-symbiote/session/${encodeURIComponent(session.id)}/regenerate-code`, {}), "Invite code rotated.")}>↻</button>}
          </span>
        )}
        {isActive && <button className="syn-btn ghost sm" title="Export the session recap (Markdown)" onClick={exportRecap}>Export</button>}
        {session && <button className="syn-btn danger sm" disabled={!!busy} onClick={() => run("end", () => post(`/api/coop-symbiote/session/${encodeURIComponent(session.id)}/end`, { reason: "Ended from Synapse room." }), "Session ended.")}>End</button>}
        <button className="syn-btn ghost sm syn-close" onClick={onExit}>Exit ✕</button>
      </header>

      {(error || notice) && <div className={`syn-notice ${error ? "is-error" : "is-ok"}`}>{error || notice}<button onClick={() => { setError(""); setNotice(""); }}>×</button></div>}

      {isPending && (
        <div className="syn-joinbanner">
          <span className="syn-avatar">{initials(session.pendingJoin.displayName)}</span>
          <div className="who">
            <strong>{session.pendingJoin.displayName} wants to join</strong>
            <small>{session.pendingJoin.deviceName} · Jarvis {session.pendingJoin.jarvisVersion || "?"} · repo {session.repoMatch || "checking"}</small>
          </div>
          <button className="syn-btn primary sm" disabled={!!busy} onClick={() => run("approve", () => post(`/api/coop-symbiote/session/${encodeURIComponent(session.id)}/approve-join`, {}), "Guest approved — Synapse is live.")}>Approve &amp; connect</button>
          <button className="syn-btn danger sm" disabled={!!busy} onClick={() => run("reject", () => post(`/api/coop-symbiote/session/${encodeURIComponent(session.id)}/reject-join`, {}), "Join request rejected.")}>Reject</button>
        </div>
      )}

      {/* ---- Choreographer: narration ticker + suggestion chips ---- */}
      {session && choreo.narration.length > 0 && (
        <div className="syn-narrate"><span className="syn-narrate-orb">◆</span>{choreo.narration.map((n, i) => <em key={i}>{n}</em>)}</div>
      )}
      {session && choreo.suggestions.length > 0 && (
        <div className="syn-suggests">{choreo.suggestions.map((s) => <button key={s.id} className="syn-suggest" onClick={() => runSuggestion(s)}>✦ {s.label}</button>)}</div>
      )}

      {/* ---- empty state ---- */}
      {!session && (
        <div className="syn-empty">
          <div>
            <p style={{ fontSize: 14, color: "var(--syn-ink)" }}>No active session. Host one, or join a friend's Synapse with their code.</p>
            <div className="cards">
              <div className="card">
                <h3>Host a session</h3>
                <label>Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map((m) => <option key={m}>{m}</option>)}</select>
                <button className="syn-btn primary" style={{ width: "100%" }} disabled={busy === "create"} onClick={() => run("create", () => post("/api/coop-symbiote/session/create", { title: "Synapse Session", mode }), "Session live — share the code to invite.")}>Create session</button>
              </div>
              <div className="card">
                <h3>Join with a code</h3>
                <label>Invite code from another Jarvis</label>
                <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="e.g. 776-893" maxLength={16} />
                <button className="syn-btn" style={{ width: "100%" }} disabled={!joinCode.trim() || busy === "join"} onClick={() => run("join", async () => { const idn = await generateIdentity(); return post("/api/coop-symbiote/session/join-remote", { code: joinCode.trim(), displayName: "Dev (guest)", deviceName: navigator.platform || "browser", guestPublicKey: idn?.publicKeyPem || "" }); }, "Join requested — waiting for the host to approve.").then(() => setJoinCode(""))}>Request to join</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- body grid ---- */}
      {session && (
        <div className="syn-body">
          {/* Zone B: presence rail */}
          <section className="syn-panel syn-roster">
            <header><span className="lbl">Presence</span><strong>{humans.length} here</strong></header>
            <div className="syn-scroll">
              <div className="syn-facepile">
                {humans.map((p, i) => <span key={i} className={`syn-avatar ${p.live ? "live" : "ghost"}`}>{initials(p.name)}<span className="ring" /></span>)}
              </div>
              {participants.map((p, i) => (
                <div className="syn-participant" key={i}>
                  <span className={`syn-avatar ${p.kind === "jarvis" ? "jarvis" : ""} ${p.live ? "live" : "ghost"}`} style={{ width: 30, height: 30, fontSize: 12 }}>{p.kind === "jarvis" ? "◆" : initials(p.name)}<span className="ring" /></span>
                  <div className="meta"><strong>{p.name}</strong><small>{livePeers.some((lp) => lp.role === p.role) ? "live" : p.live ? "active" : "idle"}</small></div>
                  {p.kind === "human" && p.role !== selfRole && livePeers.some((lp) => lp.role === p.role)
                    ? <button className="syn-btn ghost sm" onClick={() => setFollowing(following === p.name ? null : p.name)}>{following === p.name ? "Unfollow" : "Follow"}</button>
                    : <span className="syn-role">{p.role}</span>}
                  {selfRole === "host" && p.role === "guest" && session.guest && <button className="syn-btn danger sm" title="Remove guest (moderation)" disabled={!!busy} onClick={() => run("kick", () => post(`/api/coop-symbiote/session/${encodeURIComponent(session.id)}/kick`, { reason: "Removed by host." }), "Guest removed.")}>Kick</button>}
                </div>
              ))}
            </div>
          </section>

          {/* Zone C: shared workspace + timeline */}
          <div className="syn-center">
            <section className="syn-panel syn-workspace">
              <header>
                <div className="syn-switch">
                  {(["files", "patches", "debate", "screen"] as const).map((v) => (
                    <button key={v} aria-selected={view === v} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}{v === "patches" && session.patches?.length ? ` (${session.patches.length})` : ""}</button>
                  ))}
                </div>
                {view === "files" && openFile && <button className="syn-btn ghost sm" onClick={() => setOpenFile(null)}>← files</button>}
              </header>
              <div className="syn-scroll">
                {view === "files" && (openFile ? (
                  <>
                    <div style={{ fontSize: 11, color: "var(--syn-dim)", marginBottom: 6, fontFamily: "ui-monospace,monospace" }}>{openFile.path}</div>
                    <pre className="syn-code-view">{openFile.content}</pre>
                  </>
                ) : (
                  <div className="syn-files">
                    {files.slice(0, 200).map((f) => (
                      <div key={f.path} className={`syn-file ${f.shareMode === "blocked" ? "blocked" : ""}`} onClick={() => f.shareMode !== "blocked" && openFileAt(f.path)}>
                        <span className="path">{f.path}</span>
                        <span className="badge">{f.shareMode === "blocked" ? "blocked" : f.badge || f.language}</span>
                      </div>
                    ))}
                    {!files.length && <div className="syn-empty" style={{ height: "auto" }}>No shared files yet.</div>}
                  </div>
                ))}

                {view === "patches" && (
                  <>
                    {(session.patches || []).map((p: any) => (
                      <div className="syn-patch" key={p.id}>
                        <div className="top"><strong>{p.summary || p.filePath}</strong><span className={`syn-pill ${p.status === "approved" || p.status === "applied" ? "is-live" : p.status?.includes("fail") || p.status === "blocked" ? "is-warn" : ""}`}>{p.status}</span></div>
                        <small>{p.filePath} · {p.author}{p.hunks?.length > 1 ? ` · ${p.hunks.length} hunks` : ""}</small>
                        {p.review && <div style={{ fontSize: 11, marginTop: 4, color: p.review.verdict === "block" ? "var(--syn-danger)" : p.review.verdict === "warn" ? "var(--syn-amber)" : "var(--syn-live)" }} title={(p.review.objections || []).map((o: any) => `${o.severity}: ${o.message}`).join("\n") || "clean"}>🛡 review: <b>{p.review.verdict}</b>{p.review.objections?.length ? ` · ${p.review.objections.length} objection(s)` : " · clean"}{p.ghostResult?.checks ? ` · ${p.ghostResult.checks.filter((c: any) => c.ok).length}/${p.ghostResult.checks.length} checks` : ""}</div>}
                        <div className="acts">
                          <button className="syn-btn sm" disabled={!!busy} onClick={() => patchAct(p.id, "ghost-test", "Ghost sandbox ran.")}>Ghost test</button>
                          <button className="syn-btn sm" disabled={!!busy} onClick={() => patchAct(p.id, "approve", "Patch approved.")}>Approve</button>
                          <button className="syn-btn danger sm" disabled={!!busy} onClick={() => patchAct(p.id, "reject", "Patch rejected.")}>Reject</button>
                          <button className="syn-btn primary sm" disabled={!!busy || !["approved", "ghost_passed"].includes(p.status)} onClick={() => patchAct(p.id, "apply", "Patch applied (host).")} title="Host-only apply">Apply</button>
                        </div>
                      </div>
                    ))}
                    {!(session.patches || []).length && <div className="syn-empty" style={{ height: "auto" }}>No patches proposed. Patch Court is ready.</div>}
                  </>
                )}

                {view === "debate" && (
                  <div className="syn-debate">
                    <button className="syn-btn sm" disabled={!!busy} onClick={() => run("debate", () => post("/api/coop-symbiote/debate", { sessionId: sid, topic: "What is the safest next step?" }), "Debate ran.")} style={{ marginBottom: 10 }}>Run Jarvis debate</button>
                    {(session.jarvisMessages || []).slice(0, 8).map((m: any) => (
                      <article key={m.id} className={m.fromJarvisId === "verifier" ? "verifier" : ""}>
                        <strong>{m.fromJarvisId}</strong>
                        <p>{m.payload?.claim || m.payload?.agreement || m.payload?.nextStep || m.messageType}</p>
                      </article>
                    ))}
                    {!(session.jarvisMessages || []).length && <div className="syn-empty" style={{ height: "auto" }}>No bridge messages yet.</div>}
                  </div>
                )}

                {view === "screen" && <div className="syn-empty" style={{ height: "auto" }}><div className="syn-soon">Screen co-pilot &amp; screen-share arrive with the call — <b>W6</b>.</div></div>}
              </div>
              {following && <div className="syn-follow-ribbon">Following <b>{following}</b><button onClick={() => setFollowing(null)}>✕</button></div>}
              <LiveCursorLayer channelRef={channelRef} cursors={cursors} />
            </section>

            {/* Zone F: timeline */}
            <section className="syn-panel" style={{ flex: "0 0 auto" }}>
              <header><span className="lbl">Timeline</span><strong>{(session.timeline || []).length} events</strong></header>
              <div className="syn-scroll" style={{ padding: "6px 10px" }}>
                <div className="syn-timeline">
                  {(session.timeline || []).slice(0, 40).map((e: any) => (
                    <span className={`syn-tick ${/patch|approve|join/.test(e.eventType) ? "hot" : ""}`} key={e.id} title={`${e.eventType} · ${fmtTime(e.timestamp)}`}>{e.eventType.replace(/_/g, " ")}</span>
                  ))}
                  {!(session.timeline || []).length && <span className="syn-tick">no events yet</span>}
                </div>
              </div>
            </section>
          </div>

          {/* Zone D: the call (WebRTC voice/video/screen over the channel) */}
          <CallPanel channelRef={channelRef} callRef={callRef} sessionId={session.id} polite={selfRole === "guest"} onActive={setCallActive} />

          {/* Zone E: dual chat dock + tasks */}
          <div className="syn-dock">
            {/* collaborator chat */}
            <section className="syn-panel syn-chat">
              <header><span className="lbl">Collaborator chat</span><strong>{session.chat?.length || 0}</strong></header>
              <div className="syn-scroll">
                {(session.chat || []).slice(-40).map((m: any) => (
                  <div className={`syn-msg ${m.senderType === "jarvis" ? "jarvis" : ""}`} key={m.id}>
                    <strong>{m.senderName || m.senderType}</strong> <time>{fmtTime(m.timestamp)}</time>
                    <p>{m.text}</p>
                  </div>
                ))}
                {!(session.chat || []).length && <div className="syn-empty" style={{ height: "auto" }}>Say hello to your collaborator.</div>}
              </div>
              <div className="syn-compose">
                <input value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder="Message your collaborator…" onKeyDown={(e) => { if (e.key === "Enter" && chatDraft.trim()) (e.currentTarget.nextElementSibling as HTMLButtonElement)?.click(); }} />
                <button className="syn-btn sm" disabled={!chatDraft.trim() || !!busy} onClick={() => { const t = chatDraft; channelRef.current?.sendChat(t); run("chat", () => post("/api/coop-symbiote/chat", { sessionId: sid, senderType: "human", senderName: "Dev", text: t }), "Message sent.").then(() => setChatDraft("")); }}>Send</button>
              </div>
            </section>

            {/* private Jarvis chat (walled) */}
            <PrivateJarvisChat session={session} />

            {/* tasks + patch court summary */}
            <section className="syn-panel">
              <header><span className="lbl">Tasks &amp; Patch Court</span><strong>{(session.tasks?.length || 0) + (session.patches?.length || 0)}</strong></header>
              <div className="syn-scroll">
                <div className="syn-tasklist">
                  {(session.patches || []).slice(0, 4).map((p: any) => (
                    <div className="row" key={p.id}><span className="t">▤ {p.summary || p.filePath}</span><small>{p.status}</small></div>
                  ))}
                  {(session.tasks || []).slice(0, 8).map((t: any) => (
                    <div className="row" key={t.id}><span className="t">☐ {t.title}</span><small>{t.status}</small></div>
                  ))}
                  {!(session.tasks || []).length && !(session.patches || []).length && <div className="syn-empty" style={{ height: "auto" }}>No shared work yet.</div>}
                </div>
              </div>
              <div className="syn-compose">
                <input value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)} placeholder="Add a shared task…" onKeyDown={(e) => { if (e.key === "Enter" && taskDraft.trim()) (e.currentTarget.nextElementSibling as HTMLButtonElement)?.click(); }} />
                <button className="syn-btn sm" disabled={!taskDraft.trim() || !!busy} onClick={() => run("task", () => post("/api/coop-symbiote/tasks", { sessionId: sid, title: taskDraft }), "Task added.").then(() => setTaskDraft(""))}>Add</button>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

// Private, on-device side-channel: talks to YOUR own Jarvis brain (/api/chat/stream, Cortex),
// co-op-aware but never written to the shared session. "→ share" promotes a reply to the room.
function PrivateJarvisChat({ session }: { session: any }) {
  const [log, setLog] = useState<{ role: string; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [log]);

  const send = useCallback(async () => {
    const q = draft.trim();
    if (!q || busy) return;
    setDraft("");
    setLog((l) => [...l, { role: "you", text: q }, { role: "jarvis", text: "" }]);
    setBusy(true);
    const ctx = session ? `You are my private assistant during a Synapse co-op session ("${session.title}", mode ${session.mode}). Answer only to me. Question: ${q}` : q;
    try {
      const r = await streamPost<any>(
        "/api/chat/stream",
        { prompt: ctx, mode: "command", model: "cortex", strength: "cost-guarded", deepResearch: false },
        (delta) => setLog((l) => { const c = [...l]; c[c.length - 1] = { role: "jarvis", text: c[c.length - 1].text + delta }; return c; }),
      );
      if (typeof r?.response === "string" && r.response.trim()) setLog((l) => { const c = [...l]; c[c.length - 1] = { role: "jarvis", text: r.response }; return c; });
    } catch (e: any) {
      setLog((l) => { const c = [...l]; c[c.length - 1] = { role: "jarvis", text: `(error: ${e?.message || e})` }; return c; });
    } finally { setBusy(false); }
  }, [draft, busy, session]);

  const promote = useCallback(async (text: string) => {
    if (!session?.id) return;
    try { await post("/api/coop-symbiote/chat", { sessionId: session.id, senderType: "human", senderName: "Dev", text }); } catch { /* surfaced elsewhere */ }
  }, [session]);

  return (
    <section className="syn-panel syn-chat syn-chat--private">
      <header><span className="lbl">🔒 Private · only you</span><strong>{busy ? "…" : log.length}</strong></header>
      <div className="syn-scroll" ref={scrollRef}>
        {log.map((m, i) => (
          <div className={`syn-msg ${m.role === "you" ? "private" : "jarvis"}`} key={i}>
            <strong>{m.role === "you" ? "You" : "Your Jarvis"}</strong>
            {m.role === "jarvis" && m.text && session?.id ? <button className="syn-btn ghost sm" style={{ float: "right" }} onClick={() => promote(m.text)}>→ share</button> : null}
            <p>{m.text || "…"}</p>
          </div>
        ))}
        {!log.length && <div className="syn-empty" style={{ height: "auto" }}>Ask your own Jarvis privately — "what did they just change?", "draft a reply". Never seen by your collaborator.</div>}
      </div>
      <div className="syn-compose">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Private message to your Jarvis…" onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        <button className="syn-btn sm" disabled={!draft.trim() || busy} onClick={send}>Ask</button>
      </div>
    </section>
  );
}
