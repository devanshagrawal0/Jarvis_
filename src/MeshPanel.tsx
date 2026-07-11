import { useState } from "react";
import {
  Activity,
  Bell,
  Camera,
  Check,
  ChevronRight,
  ExternalLink,
  FileText,
  Inbox,
  Link,
  Monitor,
  MonitorUp,
  RefreshCw,
  Send,
  Smartphone,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";

// ─── Minimal type shapes ───────────────────────────────────────────────────────

interface Device {
  id: string;
  name: string;
  role?: string;
  status?: string;
  approved?: boolean;
  trustLevel?: string;
  kind?: string;
  capabilities?: string[];
  lastSeen?: string;
}

interface DeviceFile {
  id?: string;
  name: string;
  itemType?: string;
  mimeType?: string;
  url?: string;
  textPreview?: string;
  summary?: string;
  sourceDeviceId?: string;
  sourceDeviceName?: string;
  createdAt?: string;
  bytes?: number;
}

interface MeshObject {
  id: string;
  name: string;
  type?: string;
  url?: string;
  text?: string;
  link?: string;
  summary?: string;
  sourceDeviceName?: string;
  bytes?: number;
}

interface ControlBaton {
  status?: string;
  holderDeviceName?: string;
  requestedBy?: string;
  reason?: string;
  expiresAt?: string;
}

interface LiveScreen {
  active?: boolean;
  paused?: boolean;
  frameCount?: number;
  lastFrameUrl?: string;
}

interface MeshStatus {
  meshVersion?: string;
  meshRuntimeVersion?: string;
  controlBaton?: ControlBaton;
  liveScreen?: LiveScreen;
  emergencyStopped?: boolean;
  stablePhoneUrl?: string;
  webhookBaseUrl?: string;
  localUrls?: string[];
  connection?: {
    host?: string;
    port?: number;
    preferred?: { source?: string };
    events?: Array<{ id: string; type: string; summary?: string; createdAt: string; label?: string }>;
  };
  ghostSandbox?: {
    active?: boolean;
    deviceId?: string;
    deviceName?: string;
    startedAt?: string;
    windowOpened?: boolean;
  };
}

interface PairPayload {
  preferredPairUrl?: string;
  expiresInSeconds?: number;
  diagnostics?: { qrContainsLocalhost?: boolean; message?: string };
  candidates?: Array<{ baseUrl: string; label: string; pairable?: boolean; pairUrl?: string; reason?: string }>;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MeshPanelProps {
  devices: Device[];
  deviceFiles: DeviceFile[];
  meshObjects: MeshObject[];
  meshStatus: MeshStatus | null;
  meshPairInfo: PairPayload | null;
  pairCode: string;
  pairQr: string;
  pairUrls: string[];
  pendingPairDevices: Device[];
  wsConnected: boolean;
  meshDiagnostics: Array<{ name: string; ok: boolean; detail?: string; fix?: string }>;
  latestScreenUrl: string;
  liveFrameUrl: string;
  meshLinkRows: Array<{ label: string; url: string; pairable?: boolean }>;
  onRefresh: () => void;
  onCreatePair: () => void;
  onDecidePair: (deviceId: string, action: "approve" | "deny", trustLevel?: string) => void;
  onStartScreen: () => void;
  onStopScreen: () => void;
  onRefreshFrame: () => void;
  onRequestControl: () => void;
  onApproveControl: () => void;
  onDenyControl: () => void;
  onEmergencyStop: () => void;
  onStartSandbox: () => void;
  onStopSandbox: () => void;
}

type MeshTab = "devices" | "inbox" | "notify" | "screen" | "feed";

// ─── Styles ───────────────────────────────────────────────────────────────────

const TAB_BAR: React.CSSProperties = {
  display: "flex", gap: 3, padding: "8px 0 10px",
  borderBottom: "1px solid rgba(0,200,255,.12)", marginBottom: 10,
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "7px 2px",
    background: active ? "rgba(0,200,255,.1)" : "transparent",
    border: active ? "1px solid rgba(0,200,255,.28)" : "1px solid transparent",
    borderRadius: 7, color: active ? "#00c8ff" : "#7ab8d4",
    fontSize: 11, fontWeight: active ? 700 : 400, cursor: "pointer",
    letterSpacing: ".04em", transition: "all .18s", position: "relative",
  };
}

const BADGE: React.CSSProperties = {
  position: "absolute", top: 2, right: 3,
  minWidth: 14, height: 14, borderRadius: 7,
  background: "#ff4d4d", color: "#fff",
  fontSize: 8, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: "0 2px",
};

const DOT_ON: React.CSSProperties  = { width: 8, height: 8, borderRadius: "50%", background: "#00e676", boxShadow: "0 0 6px #00e676", flexShrink: 0 };
const DOT_OFF: React.CSSProperties = { width: 8, height: 8, borderRadius: "50%", background: "#3a6a82", flexShrink: 0 };

const CARD: React.CSSProperties = {
  background: "rgba(6,18,28,.7)", border: "1px solid rgba(0,200,255,.1)",
  borderRadius: 10, padding: "10px 12px", marginBottom: 6,
  display: "flex", alignItems: "flex-start", gap: 10,
};

const CHIP: React.CSSProperties = {
  display: "inline-block", padding: "1px 7px", borderRadius: 4,
  fontSize: 10, fontWeight: 600, letterSpacing: ".06em",
  background: "rgba(0,200,255,.1)", color: "#00c8ff", border: "1px solid rgba(0,200,255,.2)",
};

// ─── Tab: Devices ─────────────────────────────────────────────────────────────

function DevicesTab({ devices, wsConnected, meshStatus, onRefresh }: MeshPanelProps) {
  const approved = devices.filter((d) => d.approved && d.status === "approved");
  const now = Date.now();

  function isOnline(d: Device) {
    if (!d.lastSeen) return false;
    return now - new Date(d.lastSeen).getTime() < 90_000;
  }

  const trustLabel: Record<string, string> = {
    admin: "Admin", screen_control_prepare: "Controller", screen_view: "Screen viewer",
    upload_only: "Upload only", chat_only: "Chat only", approve_sensitive_actions: "Approver",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "#7ab8d4" }}>
          {approved.length} paired · WS{" "}
          <span style={{ color: wsConnected ? "#00e676" : "#ff4d4d" }}>{wsConnected ? "live" : "off"}</span>
          {meshStatus?.connection?.host ? ` · ${meshStatus.connection.host}:${meshStatus.connection.port}` : ""}
        </span>
        <button className="mini-action" onClick={onRefresh}><RefreshCw size={12} /></button>
      </div>

      {approved.length === 0 && (
        <div style={{ color: "#3a6a82", fontSize: 12, textAlign: "center", padding: "24px 0" }}>
          No paired devices yet — generate a QR in Notifications.
        </div>
      )}

      {approved.map((d) => {
        const online = isOnline(d);
        return (
          <div key={d.id} style={CARD}>
            <div style={{ marginTop: 2 }}>
              {online ? <span style={DOT_ON} /> : <span style={DOT_OFF} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <Smartphone size={13} color="#00c8ff" />
                <strong style={{ fontSize: 13 }}>{d.name}</strong>
                {d.trustLevel && <span style={CHIP}>{trustLabel[d.trustLevel] ?? d.trustLevel}</span>}
              </div>
              <div style={{ fontSize: 11, color: "#7ab8d4" }}>
                {d.role ?? d.kind ?? "device"}
                {d.lastSeen ? ` · ${online ? "online" : `last seen ${new Date(d.lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}` : ""}
              </div>
              {(d.capabilities ?? []).length > 0 && (
                <div style={{ fontSize: 10, color: "#3a6a82", marginTop: 3 }}>
                  {(d.capabilities ?? []).slice(0, 5).join(" · ")}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: Inbox ───────────────────────────────────────────────────────────────

function InboxTab({ deviceFiles, meshObjects }: MeshPanelProps) {
  const isImage = (f: DeviceFile | MeshObject) => {
    const mt = (f as DeviceFile).mimeType ?? "";
    const tp = (f as DeviceFile).itemType ?? (f as MeshObject).type ?? "";
    return mt.startsWith("image/") || tp === "image" || tp === "screen" || tp === "photo";
  };

  const files: Array<{ key: string; name: string; sub: string; thumb?: string; preview?: string }> = [
    ...deviceFiles.map((f) => ({
      key: f.id ?? f.name,
      name: f.name,
      sub: `${f.itemType ?? "file"} · ${f.sourceDeviceName ?? f.sourceDeviceId ?? "device"}${f.bytes ? ` · ${Math.round(f.bytes / 1024)} KB` : ""}`,
      thumb: isImage(f) ? f.url : undefined,
      preview: f.textPreview ?? f.summary,
    })),
    ...meshObjects.map((o) => ({
      key: o.id,
      name: o.name,
      sub: `${o.type ?? "object"} · ${o.sourceDeviceName ?? "mesh"}${o.bytes ? ` · ${Math.round(o.bytes / 1024)} KB` : ""}`,
      thumb: (o.type === "image" || o.type === "screen") ? o.url : undefined,
      preview: o.summary ?? o.text ?? o.link,
    })),
  ];

  if (files.length === 0) {
    return (
      <div style={{ color: "#3a6a82", fontSize: 12, textAlign: "center", padding: "24px 0" }}>
        No items in inbox yet — send files or text from the phone app.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 11, color: "#7ab8d4", marginBottom: 8 }}>{files.length} item{files.length !== 1 ? "s" : ""}</div>
      {files.map((f) => (
        <div key={f.key} style={CARD}>
          {f.thumb
            ? <img src={f.thumb} alt={f.name} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
            : <div style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {f.sub.includes("link") ? <Link size={16} color="#7ab8d4" /> : f.sub.includes("text") ? <FileText size={16} color="#7ab8d4" /> : <Camera size={16} color="#7ab8d4" />}
              </div>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
            <div style={{ fontSize: 11, color: "#7ab8d4" }}>{f.sub}</div>
            {f.preview && <div style={{ fontSize: 11, color: "#3a6a82", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.preview}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tab: Notifications ───────────────────────────────────────────────────────

function NotifyTab({ pendingPairDevices, pairCode, pairQr, pairUrls, meshPairInfo, meshLinkRows, onCreatePair, onDecidePair }: MeshPanelProps) {
  return (
    <div>
      {/* Pending pair requests */}
      {pendingPairDevices.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#ff4d4d", fontWeight: 700, marginBottom: 8, letterSpacing: ".06em" }}>
            PAIRING REQUESTS — {pendingPairDevices.length} pending
          </div>
          {pendingPairDevices.map((d) => (
            <div key={d.id} style={{ ...CARD, border: "1px solid rgba(255,77,77,.25)", marginBottom: 8 }}>
              <Bell size={15} color="#ff4d4d" style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{d.name}</div>
                <div style={{ fontSize: 11, color: "#7ab8d4", marginBottom: 8 }}>
                  {d.kind ?? d.role ?? "device"} · waiting for approval
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button className="mini-action" onClick={() => onDecidePair(d.id, "approve", "upload_only")} style={{ background: "rgba(0,230,118,.1)", color: "#00e676", border: "1px solid rgba(0,230,118,.25)" }}>
                    <Check size={11} /> Upload only
                  </button>
                  <button className="mini-action" onClick={() => onDecidePair(d.id, "approve", "screen_view")} style={{ background: "rgba(0,200,255,.08)", color: "#00c8ff" }}>
                    <Monitor size={11} /> Screen viewer
                  </button>
                  <button className="mini-action" onClick={() => onDecidePair(d.id, "approve", "approve_sensitive_actions")} style={{ background: "rgba(0,102,255,.08)", color: "#0066ff" }}>
                    <Zap size={11} /> Admin
                  </button>
                  <button className="mini-action" onClick={() => onDecidePair(d.id, "deny")} style={{ background: "rgba(255,77,77,.08)", color: "#ff4d4d" }}>
                    <X size={11} /> Deny
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Pair link generator */}
      <section>
        <div style={{ fontSize: 11, color: "#7ab8d4", fontWeight: 600, marginBottom: 8, letterSpacing: ".06em" }}>PAIR NEW DEVICE</div>
        <button className="sheet-refresh" onClick={onCreatePair} style={{ marginBottom: 10 }}>
          <MonitorUp size={14} /> Generate pairing code
        </button>

        {meshPairInfo?.diagnostics?.qrContainsLocalhost && (
          <div style={{ ...CARD, border: "1px solid rgba(255,200,0,.3)", background: "rgba(255,200,0,.04)", marginBottom: 8 }}>
            <X size={14} color="#ffcc00" />
            <span style={{ fontSize: 11, color: "#ffcc00" }}>QR uses localhost — won't work from phone. Tunnel not active.</span>
          </div>
        )}

        {pairCode && (
          <div style={{ background: "rgba(0,10,20,.85)", border: "1px solid rgba(0,200,255,.2)", borderRadius: 12, padding: "18px 14px", textAlign: "center" }}>
            {/* QR code with corner bracket frame */}
            {pairQr && (
              <div style={{ position: "relative", display: "inline-block", margin: "0 auto 14px" }}>
                <div style={{ position: "absolute", top: -4, left: -4, width: 16, height: 16, borderTop: "2px solid #00c8ff", borderLeft: "2px solid #00c8ff", borderRadius: "2px 0 0 0" }} />
                <div style={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderTop: "2px solid #00c8ff", borderRight: "2px solid #00c8ff", borderRadius: "0 2px 0 0" }} />
                <div style={{ position: "absolute", bottom: -4, left: -4, width: 16, height: 16, borderBottom: "2px solid #00c8ff", borderLeft: "2px solid #00c8ff", borderRadius: "0 0 0 2px" }} />
                <div style={{ position: "absolute", bottom: -4, right: -4, width: 16, height: 16, borderBottom: "2px solid #00c8ff", borderRight: "2px solid #00c8ff", borderRadius: "0 0 2px 0" }} />
                <img src={pairQr} alt="Pair QR" style={{ display: "block", width: 160, height: 160, borderRadius: 6 }} />
              </div>
            )}
            {/* 6-char code */}
            <div style={{ fontSize: 11, color: "#7ab8d4", marginBottom: 8, letterSpacing: ".08em" }}>PAIRING CODE</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 12 }}>
              {pairCode.toUpperCase().split("").slice(0, 6).map((ch, i) => (
                <div key={i} style={{ width: 32, height: 40, background: "rgba(0,200,255,.08)", border: "1px solid rgba(0,200,255,.3)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: "#00c8ff", letterSpacing: 0 }}>
                  {ch}
                </div>
              ))}
            </div>
            {meshPairInfo?.expiresInSeconds && (
              <div style={{ fontSize: 10, color: "#3a6a82", marginBottom: 10 }}>
                Expires in {Math.round(meshPairInfo.expiresInSeconds / 60)} min
              </div>
            )}
            <div style={{ fontSize: 10, color: "#7ab8d4", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {meshPairInfo?.preferredPairUrl ?? pairUrls[0] ?? ""}
            </div>
            {meshPairInfo?.diagnostics?.message && (
              <div style={{ fontSize: 10, color: "#3a6a82", marginBottom: 8 }}>{meshPairInfo.diagnostics.message}</div>
            )}
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              {meshPairInfo?.preferredPairUrl && (
                <button className="mini-action" onClick={() => navigator.clipboard?.writeText(meshPairInfo.preferredPairUrl ?? "")}>
                  <Send size={11} /> Copy link
                </button>
              )}
              <button className="mini-action" onClick={() => navigator.clipboard?.writeText(pairCode.toUpperCase())}>
                <Send size={11} /> Copy code
              </button>
            </div>
          </div>
        )}

        {meshLinkRows.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, color: "#3a6a82", marginBottom: 6, letterSpacing: ".06em" }}>AVAILABLE URLS</div>
            {meshLinkRows.slice(0, 4).map((r) => (
              <button key={r.url} className="receipt-row" style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: "5px 0" }}
                onClick={() => navigator.clipboard?.writeText(r.url)}>
                <ExternalLink size={12} color="#7ab8d4" />
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 11 }}>{r.label}</strong>
                  <span style={{ fontSize: 10, color: "#3a6a82", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.url}</span>
                </div>
                <ChevronRight size={12} color="#3a6a82" />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Tab: Screen ──────────────────────────────────────────────────────────────

function ScreenTab({ meshStatus, liveFrameUrl, latestScreenUrl, onStartScreen, onStopScreen, onRefreshFrame, onRequestControl, onApproveControl, onDenyControl, onEmergencyStop, onStartSandbox, onStopSandbox }: MeshPanelProps) {
  const live = meshStatus?.liveScreen?.active;
  const baton = meshStatus?.controlBaton;
  const emergency = meshStatus?.emergencyStopped;
  const frameUrl = liveFrameUrl || latestScreenUrl || meshStatus?.liveScreen?.lastFrameUrl;

  return (
    <div>
      {/* Live screen */}
      <section style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {live ? <span style={DOT_ON} /> : <span style={DOT_OFF} />}
            <span style={{ fontSize: 12, fontWeight: 600, color: live ? "#00e676" : "#7ab8d4" }}>
              {live ? `Screen live · ${meshStatus?.liveScreen?.frameCount ?? 0} frames` : "Screen idle"}
            </span>
          </div>
        </div>

        {frameUrl && (
          <div className="screen-preview" style={{ marginBottom: 8 }}>
            <img src={`${frameUrl}?t=${Date.now()}`} alt="Screen" style={{ width: "100%", borderRadius: 8 }} />
          </div>
        )}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="mini-action" onClick={onStartScreen} disabled={!!live} style={{ color: !live ? "#00e676" : undefined }}>
            <Monitor size={12} /> Start
          </button>
          <button className="mini-action" onClick={onRefreshFrame} disabled={!live}>
            <RefreshCw size={12} /> Frame
          </button>
          <button className="mini-action" onClick={onStopScreen} disabled={!live} style={{ color: live ? "#ff4d4d" : undefined }}>
            <X size={12} /> Stop
          </button>
        </div>
      </section>

      {/* Control baton */}
      <section>
        <div style={{ fontSize: 11, color: "#7ab8d4", fontWeight: 600, marginBottom: 8, letterSpacing: ".06em" }}>CONTROL BATON</div>
        <div style={CARD}>
          <div style={{ marginTop: 2 }}>
            {baton?.status === "approved" ? <span style={DOT_ON} /> : <span style={DOT_OFF} />}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
              {baton?.holderDeviceName ?? baton?.requestedBy ?? "No active controller"}
            </div>
            <div style={{ fontSize: 11, color: "#7ab8d4" }}>
              {baton?.status ?? "idle"}
              {baton?.expiresAt ? ` · expires ${new Date(baton.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
            </div>
            {baton?.reason && <div style={{ fontSize: 11, color: "#3a6a82", marginTop: 2 }}>{baton.reason}</div>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <button className="mini-action" onClick={onRequestControl}>Request</button>
          <button className="mini-action" onClick={onApproveControl} style={{ color: "#00e676" }}>Approve</button>
          <button className="mini-action" onClick={onDenyControl}>Deny</button>
          <button className="mini-action" onClick={onEmergencyStop} style={{ color: "#ff4d4d", border: "1px solid rgba(255,77,77,.3)" }}>
            {emergency ? "🔴 STOPPED" : "Emergency stop"}
          </button>
        </div>

        {/* Ghost Sandbox */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", letterSpacing: ".1em", textTransform: "uppercase" }}>Ghost Sandbox</span>
            {meshStatus?.ghostSandbox?.active && (
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(0,230,118,.12)", color: "var(--green)", border: "1px solid rgba(0,230,118,.3)" }}>
                ACTIVE
              </span>
            )}
          </div>
          {meshStatus?.ghostSandbox?.active ? (
            <>
              <p style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 8px" }}>
                Sandbox window open for <strong style={{ color: "var(--text)" }}>{meshStatus.ghostSandbox.deviceName}</strong>.
                {meshStatus.ghostSandbox.windowOpened ? " Browser window launched." : ""}
              </p>
              <button className="sheet-btn danger sm" onClick={onStopSandbox}>Stop Sandbox</button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12, color: "var(--text3)", margin: "0 0 8px" }}>
                Open an isolated browser window for the controlling device. Keeps remote actions out of your main session.
              </p>
              <button className="sheet-btn sm" onClick={onStartSandbox} disabled={meshStatus?.controlBaton?.status !== "approved"}>
                Start Ghost Sandbox
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Tab: Feed ────────────────────────────────────────────────────────────────

function FeedTab({ meshStatus, wsConnected, meshDiagnostics }: MeshPanelProps) {
  const events = meshStatus?.connection?.events ?? [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        {wsConnected
          ? <><Wifi size={13} color="#00e676" /><span style={{ fontSize: 11, color: "#00e676" }}>WebSocket live</span></>
          : <><WifiOff size={13} color="#ff4d4d" /><span style={{ fontSize: 11, color: "#ff4d4d" }}>WebSocket disconnected</span></>}
      </div>

      {events.length === 0 && (
        <div style={{ color: "#3a6a82", fontSize: 12, textAlign: "center", padding: "20px 0" }}>
          No events yet — activity appears here in real time.
        </div>
      )}

      {events.slice(0, 20).map((ev) => (
        <div key={ev.id} style={{ ...CARD, padding: "8px 10px", marginBottom: 4 }}>
          <Activity size={12} color="#7ab8d4" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{ev.label ?? ev.type}</span>
              <span style={{ fontSize: 10, color: "#3a6a82" }}>{new Date(ev.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </div>
            {ev.summary && <div style={{ fontSize: 11, color: "#7ab8d4", marginTop: 1 }}>{ev.summary}</div>}
          </div>
        </div>
      ))}

      {meshDiagnostics.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: "#3a6a82", marginBottom: 6, letterSpacing: ".06em" }}>SELF-TEST RESULTS</div>
          {meshDiagnostics.map((t) => (
            <div key={t.name} style={{ fontSize: 11, color: t.ok ? "#00e676" : "#ff4d4d", marginBottom: 3 }}>
              {t.ok ? "✓" : "✗"} {t.name}{t.detail ? ` — ${t.detail}` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

const TABS: Array<{ id: MeshTab; label: string; icon: React.ReactNode }> = [
  { id: "devices",  label: "Devices",  icon: <Smartphone size={12} /> },
  { id: "inbox",    label: "Inbox",    icon: <Inbox size={12} /> },
  { id: "notify",   label: "Notify",   icon: <Bell size={12} /> },
  { id: "screen",   label: "Screen",   icon: <Monitor size={12} /> },
  { id: "feed",     label: "Feed",     icon: <Activity size={12} /> },
];

export function MeshPanel(props: MeshPanelProps) {
  const [tab, setTab] = useState<MeshTab>("devices");

  const badges: Partial<Record<MeshTab, number>> = {
    notify: props.pendingPairDevices.length,
    inbox: props.deviceFiles.length + props.meshObjects.length,
  };

  return (
    <div className="sheet-list" style={{ paddingTop: 4 }}>
      {/* Tab bar */}
      <div style={TAB_BAR}>
        {TABS.map(({ id, label, icon }) => {
          const badge = badges[id] ?? 0;
          return (
            <button key={id} style={tabStyle(tab === id)} onClick={() => setTab(id)}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                {icon} {label}
              </span>
              {badge > 0 && <span style={BADGE}>{badge > 9 ? "9+" : badge}</span>}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {tab === "devices"  && <DevicesTab  {...props} />}
        {tab === "inbox"    && <InboxTab    {...props} />}
        {tab === "notify"   && <NotifyTab   {...props} />}
        {tab === "screen"   && <ScreenTab   {...props} />}
        {tab === "feed"     && <FeedTab     {...props} />}
      </div>
    </div>
  );
}
