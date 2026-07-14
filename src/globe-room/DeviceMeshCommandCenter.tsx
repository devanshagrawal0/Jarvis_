import { useCallback, useEffect, useMemo, useState } from "react";
import { api, post } from "../api";
import "./DeviceMeshCommandCenter.css";

type Tab = "overview" | "pair" | "portal" | "screen" | "coop" | "security";

type MeshBundle = {
  devices: any[];
  pairings: any[];
  mesh: any;
  memory: any;
  coop: any;
  coopMemory: any;
  files: any[];
};

const EMPTY: MeshBundle = { devices: [], pairings: [], mesh: null, memory: null, coop: null, coopMemory: null, files: [] };

function Metric({ label, value, tone = "cyan", sub }: { label: string; value: string | number; tone?: string; sub?: string }) {
  return <div className={`dm-metric dm-tone-${tone}`}><span>{label}</span><strong>{value}</strong>{sub ? <small>{sub}</small> : null}</div>;
}

function StatePill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`dm-state ${ok ? "is-live" : "is-idle"}`}><i />{children}</span>;
}

function time(value?: string) {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DeviceMeshCommandCenter() {
  const [tab, setTab] = useState<Tab>("overview");
  const [bundle, setBundle] = useState<MeshBundle>(EMPTY);
  const [pair, setPair] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [coopMode, setCoopMode] = useState("Code Review Mode");
  const [coopDraft, setCoopDraft] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [devices, mesh, memory, coop, coopMemory, manifest] = await Promise.all([
        api<any>("/api/devices"),
        api<any>("/api/device-mesh/status"),
        api<any>("/api/device-mesh/memory").catch(() => null),
        api<any>("/api/coop-symbiote/status").catch(() => null),
        api<any>("/api/coop-symbiote/memory").catch(() => null),
        api<any>("/api/coop-symbiote/manifest?limit=80").catch(() => ({ files: [] })),
      ]);
      setBundle({ devices: devices.devices || [], pairings: devices.pairings || [], mesh, memory, coop, coopMemory, files: manifest.files || [] });
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); const timer = window.setInterval(refresh, 12_000); return () => window.clearInterval(timer); }, [refresh]);

  const action = useCallback(async (name: string, work: () => Promise<any>, message: string) => {
    setBusy(name); setError(""); setNotice("");
    try { const result = await work(); setNotice(message); await refresh(); return result; }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); return null; }
    finally { setBusy(""); }
  }, [refresh]);

  const approved = bundle.devices.filter((device) => device.approved && device.status === "approved");
  const pending = bundle.devices.filter((device) => !device.approved || device.status === "pending");
  const online = approved.filter((device) => device.lastSeen && Date.now() - new Date(device.lastSeen).getTime() < 90_000);
  const mesh = bundle.mesh || {};
  const coop = bundle.coop?.activeSession || null;
  const coopCounts = bundle.coopMemory?.counts || coop?.memory?.counts || {};
  const publicUrl = mesh.publicUrls?.[0] || mesh.connection?.preferred || mesh.localUrls?.find((url: string) => !/localhost|127\.0\.0\.1/.test(url)) || "";
  const inbox = mesh.inbox || [];
  const objects = mesh.objects || [];
  const events = mesh.connection?.events || [];
  const screen = mesh.liveScreen || {};
  const baton = mesh.controlBaton || {};

  const tabs = useMemo(() => [
    ["overview", "Mesh", approved.length], ["pair", "Pair", pending.length], ["portal", "Portal", inbox.length + objects.length],
    ["screen", "Screen", screen.active ? "LIVE" : 0], ["coop", "Co-op", coop?.status === "active" ? 1 : 0], ["security", "Security", mesh.emergencyStopped ? 1 : 0],
  ] as Array<[Tab, string, string | number]>, [approved.length, pending.length, inbox.length, objects.length, screen.active, coop?.status, mesh.emergencyStopped]);

  return (
    <div className="dm-command">
      <div className="dm-hero">
        <div><span className="dm-kicker">OmniPresence Fabric</span><h2>Device Mesh <em>×</em> Co-op</h2><p>One control plane for every trusted screen, file, session and collaborator.</p></div>
        <div className="dm-hero-status"><StatePill ok={!error && Boolean(mesh.meshVersion)}>Mesh {mesh.meshRuntimeVersion || "offline"}</StatePill><StatePill ok={coop?.status === "active"}>Co-op {coop?.status || "idle"}</StatePill></div>
      </div>

      <div className="dm-tabs" role="tablist">{tabs.map(([id, label, badge]) => <button role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}><span>{label}</span>{badge ? <b>{badge}</b> : null}</button>)}</div>
      {(error || notice) ? <div className={`dm-notice ${error ? "is-error" : "is-ok"}`}>{error || notice}<button onClick={() => { setError(""); setNotice(""); }}>×</button></div> : null}
      {loading ? <div className="dm-loading"><i /><span>Synchronizing mesh substrate…</span></div> : null}

      {tab === "overview" ? <div className="dm-pane">
        <div className="dm-metrics"><Metric label="Paired nodes" value={approved.length} sub={`${online.length} online`} /><Metric label="Object portal" value={objects.length} sub={`${inbox.length} inbox`} tone="green" /><Metric label="Mesh sessions" value={mesh.memory?.sessions || 0} sub={`${mesh.memory?.replays || 0} replays`} tone="violet" /><Metric label="Co-op events" value={coopCounts.events || 0} sub={`${coopCounts.patches || 0} patches`} tone="amber" /></div>
        <div className="dm-grid dm-grid-2">
          <section className="dm-panel"><header><div><span>Trusted constellation</span><strong>Devices & presence</strong></div><button onClick={refresh}>Sync</button></header><div className="dm-device-map">{approved.slice(0, 12).map((device, index) => <article key={device.id} style={{ "--node-index": index } as React.CSSProperties}><span className="dm-device-orb"><i /></span><div><strong>{device.name}</strong><small>{device.role || device.kind} · {device.trustLevel || "paired"}</small></div><StatePill ok={online.some((item) => item.id === device.id)}>{online.some((item) => item.id === device.id) ? "online" : time(device.lastSeen)}</StatePill></article>)}</div></section>
          <section className="dm-panel"><header><div><span>Transport fabric</span><strong>Routes & reachability</strong></div></header><div className="dm-route-primary"><span>Preferred route</span><strong>{publicUrl || "No phone-reachable route"}</strong><small>{mesh.connection?.host}:{mesh.connection?.port} · {mesh.publicUrls?.length || 0} public · {mesh.localUrls?.length || 0} local</small></div><div className="dm-route-list">{(mesh.connection?.candidates || []).slice(0, 5).map((route: any) => <div key={route.baseUrl}><StatePill ok={route.pairable}>{route.label}</StatePill><span>{route.baseUrl}</span></div>)}</div></section>
        </div>
        <section className="dm-panel"><header><div><span>Live telemetry</span><strong>Recent mesh activity</strong></div><small>{events.length} retained</small></header><div className="dm-timeline">{events.slice(0, 12).map((event: any) => <article key={event.id}><i data-status={event.status || "ok"} /><div><strong>{event.type?.replace(/_/g, " ")}</strong><span>{event.summary}</span></div><time>{time(event.createdAt)}</time></article>)}</div></section>
      </div> : null}

      {tab === "pair" ? <div className="dm-pane dm-grid dm-grid-2">
        <section className="dm-panel dm-pairing"><header><div><span>Zero-friction onboarding</span><strong>Secure QR pairing</strong></div><button disabled={busy === "pair"} onClick={() => void action("pair", async () => { const result = await api<any>("/api/pair"); setPair(result); return result; }, "Fresh pairing route generated.")}>Generate QR</button></header>{pair ? <div className="dm-qr"><div className="dm-qr-frame"><img src={pair.qrDataUrl} alt="Device Mesh pairing QR" /></div><div><span>Secure one-use token</span><strong>{pair.pairing?.displayCode || pair.pairing?.code?.slice(0, 6).toUpperCase()}</strong><small>Expires in {Math.max(0, Math.round((pair.expiresInSeconds || 0) / 60))} min · {pair.addressSource}</small><p>{pair.diagnostics?.message}</p><div className="dm-actions"><button onClick={() => navigator.clipboard?.writeText(pair.preferredPairUrl || "")}>Copy invite</button><button onClick={() => window.open(pair.preferredPairUrl, "_blank")}>Open link</button></div></div></div> : <div className="dm-empty">Generate a fresh encrypted pairing route. JARVIS selects Cloudflare, Tailscale or LAN before localhost.</div>}</section>
        <section className="dm-panel"><header><div><span>Approval queue</span><strong>Pending devices</strong></div><b>{pending.length}</b></header>{pending.length ? <div className="dm-list">{pending.map((device) => <article key={device.id}><div><strong>{device.name}</strong><small>{device.kind || device.role} · requested {time(device.requestedAt)}</small></div><div className="dm-actions"><button onClick={() => void action(`approve-${device.id}`, () => post(`/api/devices/${encodeURIComponent(device.id)}/approve`, {}), `${device.name} approved.`)}>Approve</button><button className="danger" onClick={() => void action(`deny-${device.id}`, () => post(`/api/devices/${encodeURIComponent(device.id)}/revoke`, {}), `${device.name} rejected.`)}>Deny</button></div></article>)}</div> : <div className="dm-empty">No pairing requests waiting.</div>}</section>
        <section className="dm-panel dm-span-2"><header><div><span>Permission lattice</span><strong>Trust levels</strong></div></header><div className="dm-permissions">{Object.values(mesh.trustLevels || {}).map((level: any) => <article key={level.id}><strong>{level.label}</strong><span>{Object.entries(level.permissions || {}).filter(([, allowed]) => allowed).map(([name]) => name.replace(/([A-Z])/g, " $1")).join(" · ") || "No granted actions"}</span></article>)}</div></section>
      </div> : null}

      {tab === "portal" ? <div className="dm-pane"><div className="dm-metrics"><Metric label="Inbox" value={inbox.length} /><Metric label="Objects" value={objects.length} tone="green" /><Metric label="Commands" value={mesh.commands?.length || 0} tone="violet" /><Metric label="Vault items" value={mesh.memory?.inboxItems || 0} tone="amber" /></div><div className="dm-grid dm-grid-2"><section className="dm-panel"><header><div><span>Cross-device payloads</span><strong>Universal inbox</strong></div></header><div className="dm-gallery">{inbox.slice(0, 18).map((item: any) => <article key={item.id || item.path}>{item.url && /image|photo|screen/i.test(`${item.mimeType} ${item.itemType}`) ? <img src={item.url} alt="" /> : <span className="dm-file-icon">{item.itemType === "link" ? "↗" : "▤"}</span>}<div><strong>{item.name || item.itemType || "Mesh item"}</strong><small>{item.sourceDeviceName || item.sourceDeviceId || "device"} · {item.bytes ? `${Math.round(item.bytes / 1024)} KB` : time(item.createdAt || item.modifiedAt)}</small><p>{item.summary || item.textPreview || item.url || "No preview"}</p></div></article>)}</div></section><section className="dm-panel"><header><div><span>Object portal</span><strong>Addressable objects</strong></div></header><div className="dm-list">{objects.slice(0, 24).map((item: any) => <article key={item.id}><div><strong>{item.name || item.type}</strong><small>{item.type} · {item.sourceDeviceName || "mesh"}</small><p>{item.summary}</p></div><StatePill ok={Boolean(item.url || item.path)}>stored</StatePill></article>)}</div></section></div></div> : null}

      {tab === "screen" ? <div className="dm-pane"><div className="dm-metrics"><Metric label="Stream" value={screen.active ? "LIVE" : "IDLE"} tone={screen.active ? "green" : "cyan"} sub={`${screen.frameCount || 0} frames`} /><Metric label="Resolution" value={screen.lastFrameDimensions || "—"} /><Metric label="Control baton" value={baton.status || "idle"} tone="amber" /><Metric label="Emergency" value={mesh.emergencyStopped ? "STOPPED" : "armed"} tone={mesh.emergencyStopped ? "amber" : "green"} /></div><div className="dm-grid dm-grid-2"><section className="dm-panel dm-screen"><header><div><span>Live visual channel</span><strong>Laptop screen</strong></div><StatePill ok={screen.active}>{screen.active ? "streaming" : "idle"}</StatePill></header>{screen.lastFrameUrl ? <img src={`${screen.lastFrameUrl}?t=${Date.now()}`} alt="Latest Device Mesh screen" /> : <div className="dm-empty">No verified screen frame available.</div>}<div className="dm-actions"><button disabled={screen.active || Boolean(busy)} onClick={() => void action("screen-start", () => post("/api/device-mesh/live/start", { title: "Spatial workspace live screen", quality: "balanced", targetFps: 1 }), "Live screen started.")}>Start stream</button><button disabled={!screen.active || Boolean(busy)} onClick={() => void action("screen-stop", () => post("/api/device-mesh/live/stop", {}), "Live screen stopped.")}>Stop</button></div></section><section className="dm-panel"><header><div><span>Bounded remote control</span><strong>Control baton</strong></div><StatePill ok={baton.status === "approved"}>{baton.status || "idle"}</StatePill></header><div className="dm-baton"><strong>{baton.holderDeviceName || baton.requestedBy || "No controller"}</strong><span>{baton.reason || "Control is denied until explicitly requested and approved."}</span><small>Requested {time(baton.requestedAt)} · expires {time(baton.expiresAt)}</small></div><div className="dm-actions"><button onClick={() => void action("control-approve", () => post("/api/device-mesh/control/approve", { requestId: baton.requestId, durationSeconds: 120 }), "Control baton approved for two minutes.")}>Approve</button><button onClick={() => void action("control-deny", () => post("/api/device-mesh/control/deny", { requestId: baton.requestId }), "Control request denied.")}>Deny</button></div><div className="dm-sandbox"><div><strong>Ghost Sandbox</strong><small>Isolated browser surface for remote actions</small></div><div className="dm-actions"><button disabled={baton.status !== "approved"} onClick={() => void action("sandbox-start", () => post("/api/device-mesh/sandbox/start", {}), "Ghost Sandbox started.")}>Start</button><button onClick={() => void action("sandbox-stop", () => post("/api/device-mesh/sandbox/stop", {}), "Ghost Sandbox stopped.")}>Stop</button></div></div></section></div></div> : null}

      {tab === "coop" ? <div className="dm-pane"><div className="dm-metrics"><Metric label="Session" value={coop?.status || "none"} tone={coop?.status === "active" ? "green" : "cyan"} /><Metric label="Shared files" value={bundle.files.length} /><Metric label="Patches" value={coopCounts.patches || 0} tone="violet" /><Metric label="Tasks" value={coopCounts.tasks || 0} tone="amber" /></div><div className="dm-grid dm-grid-2"><section className="dm-panel"><header><div><span>Symbiote link</span><strong>{coop?.title || "Create co-op session"}</strong></div><StatePill ok={coop?.status === "active"}>{coop?.status || "idle"}</StatePill></header>{coop?.status === "active" ? <div className="dm-session"><div className="dm-session-code"><span>Invite code</span><strong>{coop.code || "hidden"}</strong></div><p>{coop.mode} · {coop.connectionMode} · repo {coop.repoMatch || "waiting"}</p><div className="dm-actions"><button onClick={() => navigator.clipboard?.writeText(coop.inviteLinks?.[0] || "")}>Copy invite</button><button className="danger" onClick={() => void action("coop-end", () => post(`/api/coop-symbiote/session/${encodeURIComponent(coop.id)}/end`, { reason: "Ended from spatial command center." }), "Co-op session ended.")}>End session</button></div></div> : coop?.pendingJoin ? <div className="dm-session"><div className="dm-session-code"><span>Join request</span><strong>{coop.pendingJoin.displayName}</strong></div><p>{coop.pendingJoin.deviceName} · Jarvis {coop.pendingJoin.jarvisVersion || "?"} · repo {coop.repoMatch || "checking"} · {String(coop.pendingJoin.status || "").replace(/_/g, " ")}</p><div className="dm-actions"><button onClick={() => void action("coop-approve", () => post(`/api/coop-symbiote/session/${encodeURIComponent(coop.id)}/approve-join`, {}), "Guest approved — co-op is live.")}>Approve & connect</button><button className="danger" onClick={() => void action("coop-reject", () => post(`/api/coop-symbiote/session/${encodeURIComponent(coop.id)}/reject-join`, {}), "Join request rejected.")}>Reject</button></div></div> : <div className="dm-create"><label>Mode<select value={coopMode} onChange={(event) => setCoopMode(event.target.value)}><option>Code Review Mode</option><option>Pair Build Mode</option><option>Jarvis Debate Mode</option><option>Screen Co-Pilot Mode</option><option>Skill Transfer Mode</option></select></label><button onClick={() => void action("coop-create", () => post("/api/coop-symbiote/session/create", { title: "Jarvis Co-Op Symbiote Mesh", mode: coopMode }), "Co-op session created.")}>Create secure session</button><div style={{ marginTop: 12, borderTop: "1px solid rgba(120,160,205,0.16)", paddingTop: 12 }}><span style={{ fontSize: 11.5, color: "rgba(150,175,205,0.75)" }}>Have an invite code from another Jarvis? Enter it to connect.</span><div className="dm-compose" style={{ marginTop: 6 }}><input value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="Paste co-op invite code" maxLength={16} onKeyDown={(event) => { if (event.key === "Enter" && joinCode.trim()) (event.currentTarget.nextElementSibling as HTMLButtonElement)?.click(); }} /><button disabled={!joinCode.trim() || busy === "coop-join"} onClick={() => void action("coop-join", () => post("/api/coop-symbiote/session/join", { code: joinCode.trim(), displayName: "Dev (guest)" }), "Join requested — waiting for the host to approve.").then(() => setJoinCode(""))}>Join session</button></div></div></div>}</section><section className="dm-panel"><header><div><span>Capability envelope</span><strong>Shared abilities</strong></div></header><div className="dm-abilities">{Object.entries(coop?.abilities || {}).map(([name, enabled]) => <span className={enabled ? "enabled" : "disabled"} key={name}>{enabled ? "✓" : "×"} {name.replace(/([A-Z])/g, " $1")}</span>)}</div></section>
        <section className="dm-panel"><header><div><span>Human channel</span><strong>Co-op chat</strong></div><b>{coop?.chat?.length || 0}</b></header><div className="dm-chat">{(coop?.chat || []).slice(-8).map((message: any) => <article key={message.id}><strong>{message.senderName || message.senderType}</strong><p>{message.text}</p><time>{time(message.timestamp)}</time></article>)}</div><div className="dm-compose"><input value={coopDraft} onChange={(event) => setCoopDraft(event.target.value)} placeholder="Message your collaborator…" /><button disabled={!coop?.id || !coopDraft.trim()} onClick={() => void action("coop-chat", () => post("/api/coop-symbiote/chat", { sessionId: coop.id, senderType: "human", senderName: "Dev", text: coopDraft }), "Message added.").then(() => setCoopDraft(""))}>Send</button></div></section><section className="dm-panel"><header><div><span>Shared execution</span><strong>Tasks & Patch Court</strong></div><b>{(coop?.tasks?.length || 0) + (coop?.patches?.length || 0)}</b></header><div className="dm-list">{(coop?.patches || []).slice(0, 6).map((patch: any) => <article key={patch.id}><div><strong>{patch.summary || patch.filePath}</strong><small>{patch.status} · {patch.filePath}</small></div><StatePill ok={patch.status === "approved"}>{patch.status}</StatePill></article>)}{(coop?.tasks || []).slice(0, 6).map((task: any) => <article key={task.id}><div><strong>{task.title}</strong><small>{task.status} · {task.assignedTo || "unassigned"}</small></div></article>)}</div><div className="dm-compose"><input value={taskDraft} onChange={(event) => setTaskDraft(event.target.value)} placeholder="Add a shared task…" /><button disabled={!coop?.id || !taskDraft.trim()} onClick={() => void action("coop-task", () => post("/api/coop-symbiote/tasks", { sessionId: coop.id, title: taskDraft }), "Shared task created.").then(() => setTaskDraft(""))}>Add</button></div></section></div>
        <section className="dm-panel"><header><div><span>Session memory</span><strong>Replay, bridge & knowledge transfer</strong></div></header><div className="dm-memory-grid">{[["Jarvis bridge", coopCounts.jarvisMessages], ["Memory packets", coopCounts.memoryPackets], ["Skill transfers", coopCounts.skillTransfers], ["Replays", coopCounts.replays], ["Ghost tests", coop?.testRuns?.length || 0], ["Timeline", coop?.timeline?.length || 0]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value || 0}</strong></div>)}</div></section>
      </div> : null}

      {tab === "security" ? <div className="dm-pane dm-grid dm-grid-2"><section className="dm-panel"><header><div><span>Trust boundary</span><strong>Device permissions</strong></div></header><div className="dm-list">{approved.map((device) => <article key={device.id}><div><strong>{device.name}</strong><small>{device.trustLevel || "paired"} · {(device.capabilities || []).slice(0, 5).join(" · ")}</small></div><button className="danger" onClick={() => void action(`revoke-${device.id}`, () => post(`/api/devices/${encodeURIComponent(device.id)}/revoke`, {}), `${device.name} revoked.`)}>Revoke</button></article>)}</div></section><section className="dm-panel"><header><div><span>Fail-safe plane</span><strong>Safety controls</strong></div><StatePill ok={!mesh.emergencyStopped}>{mesh.emergencyStopped ? "stopped" : "armed"}</StatePill></header><div className="dm-safety"><article><strong>Control expiry</strong><span>Every remote-control baton is bounded and expires automatically.</span></article><article><strong>Host authority</strong><span>Pair approval, patch apply and sensitive actions remain owner-controlled.</span></article><article><strong>Secret boundary</strong><span>Co-op blocks .env, keys, raw private memory and suspicious token content.</span></article><article><strong>Ghost isolation</strong><span>Remote screen actions can run in a separate sandbox window.</span></article></div><button className="dm-emergency" onClick={() => { if (window.confirm("Emergency stop cancels active local missions and remote control. Continue?")) void action("emergency", () => post("/api/emergency-stop", { reason: "Spatial Device Mesh emergency stop" }), "Emergency stop applied."); }}>Emergency stop all control</button></section><section className="dm-panel dm-span-2"><header><div><span>Mesh memory substrate</span><strong>Durable audit coverage</strong></div></header><div className="dm-memory-grid">{Object.entries(mesh.memory || {}).filter(([, value]) => typeof value === "number").map(([label, value]) => <div key={label}><span>{label.replace(/([A-Z])/g, " $1")}</span><strong>{String(value)}</strong></div>)}</div></section></div> : null}
    </div>
  );
}
