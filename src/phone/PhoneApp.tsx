import { useState, useEffect, useRef, useCallback } from "react";
import { useJarvisWs, type WsMessage } from "./useJarvisWs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeedEvent {
  id: string;
  type: string;
  summary: string;
  ts: number;
  needsApproval?: boolean;
  requestId?: string;
}

type Tab = "home" | "send" | "screen" | "camera" | "feed";

const TOKEN_KEY = "jarvis.cloud.access-token";
const DEVICE_ID_KEY = "jarvis.cloud.device-id";
const TRANSPORT_URL_KEY = "jarvis.cloud.transport-url";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
function getDeviceId() { return localStorage.getItem(DEVICE_ID_KEY) || ""; }
function getStoredTransportUrl() { return localStorage.getItem(TRANSPORT_URL_KEY) || ""; }
function setStoredTransportUrl(url: string) { if (url) localStorage.setItem(TRANSPORT_URL_KEY, url); else localStorage.removeItem(TRANSPORT_URL_KEY); }

let _activeBaseUrl = "";

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${_activeBaseUrl}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      authorization: token ? `Bearer ${token}` : "",
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    throw new Error((data as { message?: string; error?: string }).message || (data as { error?: string }).error || "Request failed");
  }
  return data as T;
}

function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch {}
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return view;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  :root {
    --bg: #02080e;
    --bg2: #06121c;
    --bg3: #091828;
    --border: rgba(0,200,255,.18);
    --border-hi: rgba(0,200,255,.45);
    --accent: #00c8ff;
    --accent2: #0066ff;
    --text: #e2f4ff;
    --text2: #7ab8d4;
    --text3: #3a6a82;
    --green: #00e676;
    --red: #ff4d4d;
    --yellow: #ffcc00;
    --card: rgba(6,18,28,.88);
    --radius: 14px;
    --font: 'Inter', system-ui, -apple-system, sans-serif;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; height: 100dvh; overflow: hidden; background: var(--bg); color: var(--text); font-family: var(--font); }
  #phone-root { height: 100%; height: 100dvh; }

  .app { display: flex; flex-direction: column; height: 100%; height: 100dvh; background: radial-gradient(ellipse at 50% -10%, #0a2540 0%, var(--bg) 62%); }
  .app-header { flex-shrink: 0; padding: env(safe-area-inset-top, 12px) 16px 0; }
  .header-row { display: flex; align-items: center; justify-content: space-between; height: 52px; border-bottom: 1px solid var(--border); }
  .logo { font-size: 14px; font-weight: 900; letter-spacing: .22em; text-transform: uppercase; color: var(--accent); }
  .ws-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); transition: background .4s; }
  .ws-dot.connected { background: var(--green); box-shadow: 0 0 8px var(--green); }

  .tabs-body { flex: 1; overflow: hidden; position: relative; }
  .tab-panel { position: absolute; inset: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px 14px calc(env(safe-area-inset-bottom, 0px) + 14px); display: flex; flex-direction: column; gap: 12px; }
  .tab-panel.hidden { display: none; }

  .tab-bar { flex-shrink: 0; display: flex; border-top: 1px solid var(--border); background: rgba(2,8,14,.94); backdrop-filter: blur(12px); padding-bottom: env(safe-area-inset-bottom, 0px); }
  .tab-btn { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; height: 58px; border: none; background: none; color: var(--text3); cursor: pointer; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; transition: color .2s; }
  .tab-btn svg { width: 22px; height: 22px; }
  .tab-btn.active { color: var(--accent); }
  .tab-btn.active svg { filter: drop-shadow(0 0 4px var(--accent)); }

  .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; }
  .card-title { font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--text2); margin-bottom: 10px; }

  .status-row { display: flex; align-items: center; gap: 10px; font-size: 14px; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .status-dot.green { background: var(--green); box-shadow: 0 0 8px var(--green); }
  .status-dot.red { background: var(--red); }
  .status-dot.yellow { background: var(--yellow); }

  textarea, input[type=text], input[type=url] { width: 100%; background: rgba(0,0,0,.4); border: 1px solid var(--border); border-radius: 10px; color: var(--text); padding: 12px; font-size: 15px; font-family: var(--font); resize: none; outline: none; }
  textarea:focus, input:focus { border-color: var(--border-hi); }

  .btn { width: 100%; padding: 14px; border-radius: 12px; border: none; font-size: 15px; font-weight: 700; cursor: pointer; letter-spacing: .04em; transition: opacity .15s, transform .1s; }
  .btn:active { transform: scale(.97); opacity: .85; }
  .btn-primary { background: linear-gradient(135deg, var(--accent2), var(--accent)); color: #001018; }
  .btn-secondary { background: rgba(0,200,255,.12); border: 1px solid var(--border); color: var(--accent); }
  .btn-danger { background: rgba(255,77,77,.15); border: 1px solid rgba(255,77,77,.4); color: var(--red); }
  .btn-approve { background: rgba(0,230,118,.15); border: 1px solid rgba(0,230,118,.4); color: var(--green); }
  .btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

  .screen-img { width: 100%; border-radius: 10px; border: 1px solid var(--border); object-fit: contain; background: #000; min-height: 160px; display: block; }
  .camera-video { width: 100%; border-radius: 10px; border: 1px solid var(--border); object-fit: cover; aspect-ratio: 4/3; background: #000; }

  .feed-item { border-left: 3px solid var(--border); padding: 10px 12px; border-radius: 0 10px 10px 0; background: rgba(0,200,255,.04); }
  .feed-item.approval { border-left-color: var(--yellow); background: rgba(255,204,0,.06); }
  .feed-item-type { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--text3); }
  .feed-item-summary { font-size: 14px; margin: 4px 0 8px; }
  .feed-item-ts { font-size: 11px; color: var(--text3); }

  .toast { position: fixed; bottom: calc(env(safe-area-inset-bottom, 0px) + 80px); left: 50%; transform: translateX(-50%); background: rgba(0,200,255,.18); border: 1px solid var(--border-hi); backdrop-filter: blur(12px); border-radius: 10px; padding: 10px 20px; font-size: 14px; font-weight: 600; white-space: nowrap; pointer-events: none; z-index: 999; animation: toast-in .25s ease; }
  @keyframes toast-in { from { opacity: 0; transform: translateX(-50%) translateY(12px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }

  .badge { display: inline-block; background: var(--red); color: #fff; border-radius: 99px; font-size: 10px; font-weight: 700; padding: 1px 6px; margin-left: 4px; }
  .empty { color: var(--text3); font-size: 14px; text-align: center; padding: 24px 0; }
  .label { font-size: 12px; color: var(--text2); margin-bottom: 6px; display: block; }
  hr { border: none; border-top: 1px solid var(--border); margin: 4px 0; }

  .no-token { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 28px; text-align: center; }
  .no-token h2 { font-size: 20px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); }
  .no-token p { font-size: 14px; color: var(--text2); line-height: 1.6; }

  .camera-fps { display: flex; gap: 8px; flex-wrap: wrap; }
  .fps-btn { padding: 6px 14px; border-radius: 99px; border: 1px solid var(--border); background: none; color: var(--text2); font-size: 13px; cursor: pointer; }
  .fps-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(0,200,255,.1); }

  .vision-result { border: 1px solid var(--border); border-radius: 10px; padding: 12px; background: rgba(0,200,255,.04); font-size: 14px; line-height: 1.6; min-height: 60px; white-space: pre-wrap; }
  .vision-loading { color: var(--text3); font-style: italic; }
`;

// ─── Icons ────────────────────────────────────────────────────────────────────

const Icon = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>,
  send: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>,
  screen: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>,
  camera: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  feed: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.01 3.18 2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.91a16 16 0 006.18 6.18l1.28-1.28a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>,
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PhoneApp() {
  const token = getToken();
  const [tab, setTab] = useState<Tab>("home");
  const [toast, setToast] = useState<string | null>(null);
  const [feedBadge, setFeedBadge] = useState(0);
  const [transport, setTransport] = useState<"detecting" | "lan" | "tunnel">("detecting");
  const [lanCandidateUrl, setLanCandidateUrl] = useState("");

  useEffect(() => {
    const isLan = window.location.protocol === "http:";
    if (isLan) {
      _activeBaseUrl = window.location.origin;
      setStoredTransportUrl(window.location.origin);
      setTransport("lan");
      return;
    }
    setTransport("tunnel");
    _activeBaseUrl = getStoredTransportUrl();
    fetch("/mesh/health", { signal: AbortSignal.timeout(4000) })
      .then(r => r.json())
      .then((h: { candidates?: Array<{ baseUrl: string; pairable: boolean; priority: number }> }) => {
        const lan = (h.candidates ?? []).filter(c => c.pairable && c.priority <= 10).sort((a, b) => a.priority - b.priority)[0];
        if (lan) setLanCandidateUrl(lan.baseUrl);
      })
      .catch(() => {});
  }, []);

  const wsUrl = transport === "lan" && _activeBaseUrl
    ? `ws://${new URL(_activeBaseUrl).host}/mesh/ws`
    : undefined;
  const { connected, lastMessage, send, sendBinary } = useJarvisWs(token || null, wsUrl);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  // Handle incoming WS messages
  useEffect(() => {
    if (!lastMessage) return;
    switch (lastMessage.type) {
      case "feed_event":
        setFeedBadge((n) => n + 1);
        if ((lastMessage.payload as { needsApproval?: boolean })?.needsApproval) {
          vibrate([80, 60, 80, 60, 200]);
        }
        break;
      case "clipboard":
        navigator.clipboard?.writeText(String((lastMessage.payload as { text?: string })?.text || "")).catch(() => {});
        showToast("Clipboard synced from laptop");
        break;
      default:
        break;
    }
  }, [lastMessage, showToast]);

  // DM-6: Subscribe to VAPID push once WS is authenticated — enables background notifications.
  useEffect(() => {
    if (!token || !connected) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "denied") return;

    let cancelled = false;
    (async () => {
      try {
        const permResult = await Notification.requestPermission();
        if (cancelled || permResult !== "granted") return;

        const { publicKey } = await api<{ publicKey: string }>("/api/mesh/push/vapid-public-key");
        if (cancelled) return;

        const reg = await navigator.serviceWorker.ready;
        if (cancelled) return;

        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }

        await api("/api/mesh/push/subscribe", {
          method: "POST",
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
      } catch (err) {
        if (!cancelled) console.warn("[push] Subscribe failed:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [token, connected]);

  if (!token) return <NoTokenScreen />;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="app">
        <header className="app-header">
          <div className="header-row">
            <span className="logo">JARVIS</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text2)" }}>
              <span>{connected ? "Connected" : "Reconnecting…"}</span>
              <div className={`ws-dot ${connected ? "connected" : ""}`} />
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: ".08em",
                padding: "2px 7px", borderRadius: 8,
                background: transport === "lan" ? "rgba(0,230,118,.15)" : "rgba(0,200,255,.1)",
                color: transport === "lan" ? "var(--green)" : "var(--text3)",
                border: `1px solid ${transport === "lan" ? "rgba(0,230,118,.3)" : "var(--border)"}`,
              }}>
                {transport === "lan" ? "LAN" : transport === "tunnel" ? "TUNNEL" : "…"}
              </span>
            </div>
          </div>
        </header>

        <div className="tabs-body">
          <div className={`tab-panel ${tab === "home" ? "" : "hidden"}`}>
            <HomeTab connected={connected} send={send} showToast={showToast} lastMessage={lastMessage} transport={transport} lanCandidateUrl={lanCandidateUrl} />
          </div>
          <div className={`tab-panel ${tab === "send" ? "" : "hidden"}`}>
            <SendTab showToast={showToast} send={send} connected={connected} />
          </div>
          <div className={`tab-panel ${tab === "screen" ? "" : "hidden"}`}>
            <ScreenTab active={tab === "screen"} connected={connected} send={send} showToast={showToast} lastMessage={lastMessage} />
          </div>
          <div className={`tab-panel ${tab === "camera" ? "" : "hidden"}`}>
            <CameraTab active={tab === "camera"} connected={connected} sendBinary={sendBinary} showToast={showToast} />
          </div>
          <div className={`tab-panel ${tab === "feed" ? "" : "hidden"}`}>
            <FeedTab active={tab === "feed"} onOpen={() => setFeedBadge(0)} lastMessage={lastMessage} showToast={showToast} />
          </div>
        </div>

        <nav className="tab-bar">
          {(["home", "send", "screen", "camera", "feed"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`tab-btn ${tab === t ? "active" : ""}`}
              onClick={() => { setTab(t); if (t === "feed") setFeedBadge(0); }}
            >
              {Icon[t]}
              {t}{t === "feed" && feedBadge > 0 && <span className="badge">{feedBadge}</span>}
            </button>
          ))}
        </nav>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

// ─── No Token Screen ──────────────────────────────────────────────────────────

function NoTokenScreen() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="no-token">
        <div style={{ fontSize: 48 }}>🔗</div>
        <h2>Pair with Jarvis</h2>
        <p>Scan the QR code from the Jarvis laptop to pair this device. Your access token will be stored automatically.</p>
        <p style={{ fontSize: 12, color: "var(--text3)" }}>Go to the Device Mesh panel on the laptop and click "Pair Phone".</p>
      </div>
    </>
  );
}

// ─── Home Tab ─────────────────────────────────────────────────────────────────

function HomeTab({ connected, send, showToast, lastMessage, transport, lanCandidateUrl }: {
  connected: boolean;
  send: (type: string, payload?: unknown) => boolean;
  showToast: (msg: string) => void;
  lastMessage: WsMessage | null;
  transport: "detecting" | "lan" | "tunnel";
  lanCandidateUrl: string;
}) {
  const [deviceInfo, setDeviceInfo] = useState<{ name?: string; role?: string; trustLevel?: string } | null>(null);
  const [inbox, setInbox] = useState<Array<{ id: string; itemType?: string; textPreview?: string; name?: string; summary?: string }>>([]);
  const [hbStatus, setHbStatus] = useState("");

  useEffect(() => {
    api<{ device: { name: string; role: string; trustLevel: string } }>("/mesh/api/me")
      .then((d) => setDeviceInfo(d.device))
      .catch(() => {});
    api<{ inbox: typeof inbox }>("/mesh/api/inbox")
      .then((d) => setInbox((d.inbox || []).slice(0, 6)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (lastMessage?.type === "device_ws_connected" || lastMessage?.type === "feed_event") {
      api<{ inbox: typeof inbox }>("/mesh/api/inbox")
        .then((d) => setInbox((d.inbox || []).slice(0, 6)))
        .catch(() => {});
    }
  }, [lastMessage]);

  async function sendHeartbeat() {
    try {
      await api("/mesh/api/heartbeat", { method: "POST", body: "{}" });
      setHbStatus("Heartbeat sent ✓");
      showToast("Jarvis knows you're here");
      send("heartbeat");
    } catch (err) {
      setHbStatus((err as Error).message);
    }
  }

  return (
    <>
      {transport === "tunnel" && lanCandidateUrl && (
        <div className="card" style={{ borderColor: "rgba(0,230,118,.25)" }}>
          <div className="card-title" style={{ color: "var(--green)" }}>LAN Available</div>
          <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 10 }}>
            Laptop is on the same WiFi. Open via LAN for lower latency:
          </p>
          <a
            href={`${lanCandidateUrl}/phone.html`}
            style={{ fontSize: 13, color: "var(--accent)", wordBreak: "break-all" }}
          >
            {lanCandidateUrl}/phone.html
          </a>
        </div>
      )}
      {transport === "lan" && (
        <div className="card" style={{ borderColor: "rgba(0,230,118,.25)" }}>
          <div className="card-title" style={{ color: "var(--green)" }}>Direct LAN Connection</div>
          <p style={{ fontSize: 13, color: "var(--text2)" }}>Connected directly to laptop on local network. Low latency mode active.</p>
        </div>
      )}
      <div className="card">
        <div className="card-title">Connection</div>
        <div className="status-row">
          <div className={`status-dot ${connected ? "green" : "red"}`} />
          <span>{connected ? `WebSocket live` : "Reconnecting…"}</span>
        </div>
        {deviceInfo && (
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 3 }}>
            <span>Device: <strong style={{ color: "var(--text)" }}>{deviceInfo.name}</strong></span>
            <span>Role: {deviceInfo.role} · Trust: {deviceInfo.trustLevel}</span>
          </div>
        )}
        <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={sendHeartbeat}>
          Ping Jarvis
        </button>
        {hbStatus && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>{hbStatus}</div>}
      </div>

      {inbox.length > 0 && (
        <div className="card">
          <div className="card-title">Recent Inbox</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {inbox.map((item) => (
              <div key={item.id} style={{ fontSize: 13, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <span style={{ color: "var(--text2)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em" }}>
                  {item.itemType || item.name || "item"}
                </span>
                <div style={{ color: "var(--text)", marginTop: 2 }}>{item.textPreview || item.summary || ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Send Tab ─────────────────────────────────────────────────────────────────

function SendTab({ showToast, send, connected }: {
  showToast: (msg: string) => void;
  send: (type: string, payload?: unknown) => boolean;
  connected: boolean;
}) {
  const [text, setText] = useState("");
  const [link, setLink] = useState("");

  // Handle Web Share Target — called when user shares to JARVIS from another app
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const sharedText = p.get("text") || "";
    const sharedUrl = p.get("url") || "";
    const sharedTitle = p.get("title") || "";
    if (sharedUrl) setLink(sharedUrl);
    else if (sharedText || sharedTitle) setText([sharedTitle, sharedText].filter(Boolean).join("\n"));
    if (sharedText || sharedUrl || sharedTitle) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const [sending, setSending] = useState(false);

  async function sendText() {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api("/mesh/api/inbox/text", { method: "POST", body: JSON.stringify({ text }) });
      showToast("Text sent to Jarvis ✓");
      setText("");
    } catch (err) { showToast((err as Error).message); }
    setSending(false);
  }

  async function sendLink() {
    if (!link.trim()) return;
    setSending(true);
    try {
      await api("/mesh/api/inbox/link", { method: "POST", body: JSON.stringify({ url: link }) });
      showToast("Link sent ✓");
      setLink("");
    } catch (err) { showToast((err as Error).message); }
    setSending(false);
  }

  async function sendFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSending(true);
    try {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      await api("/mesh/api/inbox/upload", {
        method: "POST",
        body: JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", data: dataUrl }),
      });
      showToast(`${file.name} uploaded ✓`);
    } catch (err) { showToast((err as Error).message); }
    setSending(false);
    e.target.value = "";
  }

  async function copyClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { showToast("Clipboard is empty"); return; }
      send("clipboard", { text });
      await api("/mesh/api/inbox/text", { method: "POST", body: JSON.stringify({ text: `[Clipboard] ${text}` }) });
      showToast("Clipboard synced to all devices ✓");
    } catch { showToast("Clipboard permission denied"); }
  }

  return (
    <>
      <div className="card">
        <div className="card-title">Send Text</div>
        <textarea rows={4} placeholder="Type anything for Jarvis…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={sendText} disabled={sending || !text.trim()}>
          {sending ? "Sending…" : "Send to Jarvis"}
        </button>
      </div>

      <div className="card">
        <div className="card-title">Send Link</div>
        <input type="url" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
        <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={sendLink} disabled={sending || !link.trim()}>
          Send Link
        </button>
      </div>

      <div className="card">
        <div className="card-title">Send File / Photo</div>
        <label className="btn btn-secondary" style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          Choose File or Photo
          <input type="file" style={{ display: "none" }} onChange={sendFile} accept="image/*,video/*,.pdf,.txt,.md" capture="environment" />
        </label>
      </div>

      <div className="card">
        <div className="card-title">Universal Clipboard</div>
        <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 10 }}>
          Sync your phone clipboard to Jarvis and all connected devices instantly.
        </p>
        <button className="btn btn-secondary" onClick={copyClipboard} disabled={!connected}>
          Push Clipboard Now
        </button>
      </div>
    </>
  );
}

// ─── Screen Tab ───────────────────────────────────────────────────────────────

const HOTKEYS = [
  { label: "↵ Enter", key: "enter" },
  { label: "Esc",     key: "escape" },
  { label: "⌘C",      key: "ctrl+c" },
  { label: "⌘V",      key: "ctrl+v" },
  { label: "⌘Z",      key: "ctrl+z" },
  { label: "Tab",     key: "tab" },
];

function ScreenTab({ active, connected, send, showToast, lastMessage }: {
  active: boolean;
  connected: boolean;
  send: (type: string, payload?: unknown) => boolean;
  showToast: (msg: string) => void;
  lastMessage: WsMessage | null;
}) {
  const [frameUrl, setFrameUrl]         = useState("");
  const [streaming, setStreaming]       = useState(false);
  const [hasBaton, setHasBaton]         = useState(false);
  const [controlMode, setControlMode]   = useState(false);
  const [typeText, setTypeText]         = useState("");
  const [tapFeedback, setTapFeedback]   = useState<{ x: number; y: number } | null>(null);
  const [batonSecsLeft, setBatonSecsLeft] = useState(0);
  const [sending, setSending]           = useState(false);
  const [rtcActive, setRtcActive]       = useState(false);
  const rtcPcRef       = useRef<RTCPeerConnection | null>(null);
  const videoRef       = useRef<HTMLVideoElement | null>(null);
  const hostDeviceIdRef = useRef<string | null>(null);

  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const batonTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const batonExpiresAt = useRef<number>(0);
  const touchStartRef  = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => { if (active) fetchFrame(); }, [active]);

  useEffect(() => {
    if (lastMessage?.type === "screen_frame_jpeg") {
      const jpeg = (lastMessage.payload as { jpeg?: string })?.jpeg;
      if (jpeg) setFrameUrl(`data:image/jpeg;base64,${jpeg}`);
    }
    if (lastMessage?.type === "baton_granted") {
      const durSecs = (lastMessage.payload as { durationSeconds?: number })?.durationSeconds ?? 120;
      batonExpiresAt.current = Date.now() + durSecs * 1000;
      setHasBaton(true);
      setBatonSecsLeft(durSecs);
      setControlMode(true);
      showToast("Control granted — tap screen to control laptop");
      vibrate([100, 50, 100]);
      if (batonTimerRef.current) clearInterval(batonTimerRef.current);
      batonTimerRef.current = setInterval(() => {
        const left = Math.max(0, Math.round((batonExpiresAt.current - Date.now()) / 1000));
        setBatonSecsLeft(left);
        if (left <= 0) {
          setHasBaton(false);
          setControlMode(false);
          clearInterval(batonTimerRef.current!);
          batonTimerRef.current = null;
          showToast("Control baton expired");
        }
      }, 1000);
    }
    if (lastMessage?.type === "baton_released" || lastMessage?.type === "baton_denied") {
      setHasBaton(false);
      setControlMode(false);
      if (batonTimerRef.current) { clearInterval(batonTimerRef.current); batonTimerRef.current = null; }
    }
    if (lastMessage?.type === "peers_list") {
      const peers = (lastMessage.payload as { peers?: Array<{ deviceId: string; role?: string; trustLevel?: number }> })?.peers ?? [];
      const host = peers.find(p => p.role === "host" || (p.trustLevel ?? 0) >= 3);
      if (host) hostDeviceIdRef.current = host.deviceId;
    }
    if (lastMessage?.type === "rtc_signal") {
      const { fromDeviceId, signal } = lastMessage.payload as { fromDeviceId?: string; signal?: Record<string, unknown> };
      if (!fromDeviceId || !signal) return;
      if (signal.type === "offer") handleRtcOffer(fromDeviceId, signal);
      if (signal.type === "ice_candidate" && signal.candidate) {
        rtcPcRef.current?.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit)).catch(() => {});
      }
    }
  }, [lastMessage]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (batonTimerRef.current) clearInterval(batonTimerRef.current);
    if (rtcPcRef.current) { rtcPcRef.current.close(); rtcPcRef.current = null; }
  }, []);

  async function fetchFrame() {
    try {
      const r = await api<{ frameUrl?: string; capture?: { url?: string } }>("/api/device-mesh/live/frame");
      const url = r.frameUrl || r.capture?.url;
      if (url) setFrameUrl(url);
    } catch {}
  }

  async function startStream() {
    try {
      await api("/api/device-mesh/live/start", { method: "POST", body: JSON.stringify({ quality: "balanced", targetFps: 2 }) });
      send("join_room", { room: "screen:laptop" });
      setStreaming(true);
      showToast("Screen stream started");
      timerRef.current = setInterval(fetchFrame, 2000);
    } catch (err) { showToast((err as Error).message); }
  }

  async function stopStream() {
    try {
      await api("/api/device-mesh/live/stop", { method: "POST", body: "{}" });
      send("leave_room", { room: "screen:laptop" });
    } catch {}
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setStreaming(false);
    showToast("Screen stream stopped");
  }

  async function requestBaton() {
    send("request_baton", { durationSeconds: 120 });
    showToast("Requesting control baton…");
  }

  async function releaseBaton() {
    send("release_baton");
    setHasBaton(false);
    setControlMode(false);
    if (batonTimerRef.current) { clearInterval(batonTimerRef.current); batonTimerRef.current = null; }
  }

  async function oneShot() {
    try {
      const r = await api<{ capture?: { url?: string } }>("/api/device-mesh/screen", {
        method: "POST",
        body: JSON.stringify({ reason: "Phone screenshot" }),
      });
      if (r.capture?.url) setFrameUrl(r.capture.url);
      showToast("Screenshot captured");
    } catch (err) { showToast((err as Error).message); }
  }

  async function sendCtrl(type: string, data: Record<string, unknown> = {}) {
    if (sending) return;
    setSending(true);
    try {
      await api("/api/device-mesh/control/event", {
        method: "POST",
        body: JSON.stringify({ type, ...data }),
      });
      vibrate(30);
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function sendTypeText() {
    if (!typeText.trim()) return;
    await sendCtrl("type", { text: typeText });
    setTypeText("");
  }

  async function handleRtcOffer(fromDeviceId: string, signal: Record<string, unknown>) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    rtcPcRef.current = pc;
    pc.ontrack = (e) => {
      if (videoRef.current && e.streams[0]) { videoRef.current.srcObject = e.streams[0]; setRtcActive(true); }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) send("rtc_signal", { targetDeviceId: fromDeviceId, signal: { type: "ice_candidate", candidate: e.candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") { setRtcActive(false); pc.close(); }
    };
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp as string }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send("rtc_signal", { targetDeviceId: fromDeviceId, signal: { type: "answer", sdp: answer.sdp } });
  }

  function startRtcRequest() {
    send("get_peers", {});
    send("rtc_signal", { targetDeviceId: "host", signal: { type: "screen_share_request" } });
    showToast("Requesting live screen share…");
  }

  function stopRtc() {
    rtcPcRef.current?.close();
    rtcPcRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRtcActive(false);
  }

  function handleTouchStart(e: React.TouchEvent<HTMLImageElement>) {
    if (!controlMode || !hasBaton) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLImageElement>) {
    if (!controlMode || !hasBaton || !touchStartRef.current) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    const start = touchStartRef.current;
    touchStartRef.current = null;

    const rect = (e.currentTarget as HTMLImageElement).getBoundingClientRect();
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dt = Date.now() - start.t;

    if (dist > 25) {
      sendCtrl("scroll", { deltaY: -Math.round(dy * 4), deltaX: -Math.round(dx * 4) });
    } else if (dt < 500) {
      const normalizedX = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
      const normalizedY = Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height));
      setTapFeedback({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
      setTimeout(() => setTapFeedback(null), 450);
      sendCtrl("click", { normalizedX, normalizedY });
    }
  }

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Laptop Screen</div>
          {hasBaton && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                onClick={() => setControlMode(m => !m)}
                style={{
                  fontSize: 11, padding: "3px 9px", borderRadius: 12, width: "auto",
                  background: controlMode ? "var(--accent)" : "var(--bg3)",
                  color: controlMode ? "#000" : "var(--text2)",
                  border: "none", cursor: "pointer", fontWeight: 700,
                }}
              >
                {controlMode ? "Tap: ON" : "Tap: OFF"}
              </button>
              <span style={{
                fontSize: 11, padding: "3px 8px", borderRadius: 12,
                background: batonSecsLeft <= 15 ? "rgba(248,113,113,.15)" : "rgba(0,210,195,.1)",
                color: batonSecsLeft <= 15 ? "#f87171" : "var(--accent)",
                border: `1px solid ${batonSecsLeft <= 15 ? "rgba(248,113,113,.4)" : "rgba(0,210,195,.3)"}`,
                fontVariantNumeric: "tabular-nums",
              }}>
                {batonSecsLeft}s
              </span>
            </div>
          )}
        </div>

        <div style={{ position: "relative", lineHeight: 0 }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)", background: "#000", minHeight: 160, display: rtcActive ? "block" : "none" }}
          />
          {!rtcActive && (frameUrl ? (
            <img
              className="screen-img"
              src={frameUrl}
              alt="Laptop screen"
              style={{ touchAction: controlMode ? "none" : "auto", cursor: controlMode && hasBaton ? "crosshair" : "default" }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            />
          ) : (
            <div className="screen-img" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 13 }}>No frame yet</div>
          ))}
          {tapFeedback && !rtcActive && (
            <div style={{
              position: "absolute",
              left: tapFeedback.x - 18, top: tapFeedback.y - 18,
              width: 36, height: 36, borderRadius: "50%",
              background: "rgba(0,210,195,.35)",
              border: "2px solid rgba(0,210,195,.9)",
              pointerEvents: "none",
              animation: "tap-ripple .45s ease-out forwards",
            }} />
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {!rtcActive
            ? <button className="btn btn-primary" style={{ flex: 1 }} onClick={startRtcRequest} disabled={!connected}>Live WebRTC</button>
            : <button className="btn btn-danger"  style={{ flex: 1 }} onClick={stopRtc}>Stop WebRTC</button>
          }
          {!streaming
            ? <button className="btn btn-secondary" style={{ flex: 1 }} onClick={startStream} disabled={!connected}>Start Live</button>
            : <button className="btn btn-danger"    style={{ flex: 1 }} onClick={stopStream}>Stop</button>
          }
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={oneShot}    disabled={!connected}>Screenshot</button>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={fetchFrame} disabled={!connected}>Refresh</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Remote Control</div>

        {!hasBaton ? (
          <button className="btn btn-secondary" onClick={requestBaton} disabled={!connected}>
            Request Control Baton
          </button>
        ) : (
          <>
            {/* Quick hotkeys */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {HOTKEYS.map(h => (
                <button
                  key={h.key}
                  className="btn btn-secondary"
                  style={{ width: "auto", fontSize: 12, padding: "5px 11px" }}
                  onClick={() => sendCtrl("hotkey", { hotkey: h.key })}
                  disabled={sending}
                >
                  {h.label}
                </button>
              ))}
            </div>

            {/* Type text */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                type="text"
                placeholder="Type text on laptop…"
                value={typeText}
                onChange={e => setTypeText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); sendTypeText(); } }}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                style={{ width: "auto", padding: "0 18px" }}
                onClick={sendTypeText}
                disabled={!typeText.trim() || sending}
              >
                Send
              </button>
            </div>

            {/* Scroll */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => sendCtrl("scroll", { deltaY: -400 })} disabled={sending}>↑ Scroll Up</button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => sendCtrl("scroll", { deltaY: 400 })}  disabled={sending}>↓ Scroll Down</button>
            </div>

            <button className="btn btn-danger" onClick={releaseBaton}>Release Control</button>
          </>
        )}
      </div>

      <style>{`
        @keyframes tap-ripple {
          0%   { transform: scale(.3); opacity: 1; }
          100% { transform: scale(2); opacity: 0; }
        }
      `}</style>
    </>
  );
}

// ─── Camera Tab (NF-1) ────────────────────────────────────────────────────────

const FPS_OPTIONS = [1, 3, 6, 10];

function CameraTab({ active, connected, sendBinary, showToast }: {
  active: boolean;
  connected: boolean;
  sendBinary: (buf: ArrayBuffer) => boolean;
  showToast: (msg: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [running, setRunning] = useState(false);
  const [fps, setFps] = useState(3);
  const [visionResult, setVisionResult] = useState("");
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [frameCount, setFrameCount] = useState(0);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setRunning(true);
      startSending(fps);
      showToast("Camera started — streaming to Jarvis");
    } catch (err) {
      showToast("Camera error: " + (err as Error).message);
    }
  }

  function startSending(targetFps: number) {
    if (timerRef.current) clearInterval(timerRef.current);
    const interval = Math.round(1000 / targetFps);
    timerRef.current = setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob || !connected) return;
        blob.arrayBuffer().then((jpegBuf) => {
          // Prefix with 0x01 tag (camera frame)
          const tagged = new Uint8Array(jpegBuf.byteLength + 1);
          tagged[0] = 0x01;
          tagged.set(new Uint8Array(jpegBuf), 1);
          sendBinary(tagged.buffer);
          setFrameCount((n) => n + 1);
        });
      }, "image/jpeg", 0.75);
    }, interval);
  }

  function stopCamera() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
    setFrameCount(0);
    showToast("Camera stopped");
  }

  function changeFps(newFps: number) {
    setFps(newFps);
    if (running) startSending(newFps);
  }

  async function analyzeNow() {
    setAnalyzeLoading(true);
    setVisionResult("");
    try {
      const result = await api<{ ok: boolean; analysis?: string; response?: string }>("/api/mesh/vision/camera", { method: "POST", body: "{}" });
      setVisionResult(result.analysis || result.response || "No result");
    } catch (err) {
      setVisionResult("Error: " + (err as Error).message);
    }
    setAnalyzeLoading(false);
  }

  useEffect(() => () => { stopCamera(); }, []);
  useEffect(() => { if (!active && running) stopCamera(); }, [active]);

  return (
    <>
      <div className="card">
        <div className="card-title">Live Camera → Jarvis Vision</div>
        <video ref={videoRef} className="camera-video" muted playsInline autoPlay />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {!running
            ? <button className="btn btn-primary" onClick={startCamera} disabled={!connected}>Start Camera</button>
            : <button className="btn btn-danger" onClick={stopCamera}>Stop Camera</button>
          }
        </div>
        {running && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text3)" }}>
            Streaming at {fps} FPS · {frameCount} frames sent
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Frame Rate</div>
        <div className="camera-fps">
          {FPS_OPTIONS.map((f) => (
            <button key={f} className={`fps-btn ${fps === f ? "active" : ""}`} onClick={() => changeFps(f)}>
              {f} FPS
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Ask Jarvis About Camera</div>
        <button className="btn btn-secondary" onClick={analyzeNow} disabled={analyzeLoading || !connected}>
          {analyzeLoading ? "Analyzing…" : "Analyze Latest Frame with AI"}
        </button>
        {visionResult && (
          <div className={`vision-result ${analyzeLoading ? "vision-loading" : ""}`} style={{ marginTop: 10 }}>
            {visionResult}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Feed Tab (NF-4) ──────────────────────────────────────────────────────────

function FeedTab({ active, onOpen, lastMessage, showToast }: {
  active: boolean;
  onOpen: () => void;
  lastMessage: WsMessage | null;
  showToast: (msg: string) => void;
}) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!active) return;
    onOpen();
    const token = getToken();
    const es = new EventSource(`/api/mesh/activity-feed?token=${encodeURIComponent(token)}`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as FeedEvent;
        setEvents((prev) => [evt, ...prev].slice(0, 80));
        if (evt.needsApproval) vibrate([80, 60, 80, 60, 200]);
      } catch {}
    };
    return () => { es.close(); esRef.current = null; };
  }, [active]);

  // Also ingest WS feed_event messages
  useEffect(() => {
    if (lastMessage?.type === "feed_event") {
      const p = lastMessage.payload as Partial<FeedEvent> & { feedType?: string };
      const evt: FeedEvent = {
        id: String(Date.now()),
        type: String(p.feedType || p.type || "event"),
        summary: String(p.summary || ""),
        ts: Number(p.ts || Date.now()),
        needsApproval: Boolean(p.needsApproval),
        requestId: String(p.requestId || ""),
      };
      setEvents((prev) => [evt, ...prev].slice(0, 80));
    }
  }, [lastMessage]);

  async function approve(requestId: string) {
    try {
      await api("/mesh/api/pair/approve", { method: "POST", body: JSON.stringify({ requestId, trustLevel: "upload_only" }) });
      showToast("Approved ✓");
      vibrate(200);
      setEvents((prev) => prev.filter((e) => e.requestId !== requestId));
    } catch (err) { showToast((err as Error).message); }
  }

  async function deny(requestId: string) {
    try {
      await api("/mesh/api/pair/deny", { method: "POST", body: JSON.stringify({ requestId }) });
      showToast("Denied");
      setEvents((prev) => prev.filter((e) => e.requestId !== requestId));
    } catch (err) { showToast((err as Error).message); }
  }

  return (
    <>
      {events.length === 0
        ? <div className="empty">No activity yet. Jarvis events will appear here in real time.</div>
        : events.map((evt) => (
          <div key={evt.id} className={`feed-item ${evt.needsApproval ? "approval" : ""}`}>
            <div className="feed-item-type">{evt.type}</div>
            <div className="feed-item-summary">{evt.summary}</div>
            <div className="feed-item-ts">{new Date(evt.ts).toLocaleTimeString()}</div>
            {evt.needsApproval && evt.requestId && (
              <div className="btn-row" style={{ marginTop: 10 }}>
                <button className="btn btn-approve" onClick={() => approve(evt.requestId!)}>Approve</button>
                <button className="btn btn-danger" onClick={() => deny(evt.requestId!)}>Deny</button>
              </div>
            )}
          </div>
        ))
      }
    </>
  );
}
