import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { HoloGlobe } from "./globe-room/HoloGlobe";
import { JarvisCommandBar } from "./globe-room/JarvisCommandBar";
import { WidgetLauncher } from "./globe-room/WidgetLauncher";
import { WidgetStrip } from "./globe-room/WidgetStrip";
import { HelixRoom } from "./rooms/HelixRoom";
import { HelixV2 } from "./rooms/helix/v2/HelixV2";
import { ApexRoom } from "./rooms/ApexRoom";
import { ArbiterRoom } from "./rooms/ArbiterRoom";
import { api, post, streamPost } from "./api";
import { LiveVoiceController } from "./liveVoice";
import type { BrainResponse, JarvisActivityEvent, JarvisArtifact, JarvisUiAction } from "./types";
import "./JarvisUI.css";

const PANEL_CSS = `
/* Accent is themable per room: a room sets --jr-a (RGB triplet) + --jr-bg1/2 +
   --jr-tx on :root (inline) while mounted, which overrides these defaults.
   Defaults MUST live on :root (not .jr-panel) so the inline override wins. */
:root {
  --jr-a: 0,180,255; --jr-bg1: 6,16,35; --jr-bg2: 3,8,20; --jr-tx: 185,240,255;
}
.jr-panel {
  position: fixed; left: 50%; bottom: calc(4.5vh + 107px);
  transform: translateX(-50%) translateY(12px);
  width: min(890px, 59vw); z-index: 29;
  opacity: 0; pointer-events: none;
  transition: opacity .22s ease, transform .22s ease;
}
.jr-panel.visible {
  opacity: 1; pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}
.jr-panel-inner {
  position: relative;
  background: linear-gradient(160deg, rgba(var(--jr-bg1),.92), rgba(var(--jr-bg2),.96));
  border: 1px solid rgba(var(--jr-a),.45);
  border-radius: 18px;
  padding: 18px 22px 16px 22px;
  box-shadow: 0 0 40px rgba(var(--jr-a),.18), 0 8px 40px rgba(0,0,0,.7),
    inset 0 1px 0 rgba(var(--jr-a),.14);
  font-family: Inter, "Segoe UI", sans-serif;
  min-height: 52px; max-height: 42vh; overflow-y: auto;
}
.jr-panel-inner::-webkit-scrollbar { width: 4px; }
.jr-panel-inner::-webkit-scrollbar-track { background: transparent; }
.jr-panel-inner::-webkit-scrollbar-thumb { background: rgba(var(--jr-a),.25); border-radius: 2px; }
.jr-label {
  font-size: 9.5px; font-weight: 600; letter-spacing: .13em; text-transform: uppercase;
  color: rgba(var(--jr-a),.5); margin-bottom: 10px; display: flex; align-items: center; gap: 7px;
}
.jr-label::after {
  content: ''; flex: 1; height: 1px;
  background: linear-gradient(90deg, rgba(var(--jr-a),.2), transparent);
}
.jr-text {
  font-size: 15px; font-weight: 300; line-height: 1.65; letter-spacing: .01em;
  color: rgba(var(--jr-tx),.88); white-space: pre-wrap; word-break: break-word;
}
.jr-cursor {
  display: inline-block; width: 2px; height: 14px;
  background: rgba(var(--jr-a),.9); vertical-align: text-bottom; margin-left: 2px;
  animation: jr-blink .8s step-end infinite;
}
@keyframes jr-blink { 0%,100% { opacity:1 } 50% { opacity:0 } }
.jr-thinking {
  display: flex; align-items: center; gap: 5px;
}
.jr-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: rgba(var(--jr-a),.6);
  animation: jr-dot-pulse 1.2s ease-in-out infinite;
}
.jr-dot:nth-child(2) { animation-delay: .2s; }
.jr-dot:nth-child(3) { animation-delay: .4s; }
@keyframes jr-dot-pulse { 0%,100% { opacity:.3; transform:scale(.8); } 50% { opacity:1; transform:scale(1.2); } }
.jr-dismiss {
  position: absolute; top: 12px; right: 14px;
  background: none; border: none; cursor: pointer;
  color: rgba(var(--jr-a),.4); font-size: 14px; line-height: 1; padding: 3px 5px;
  border-radius: 4px; transition: color .15s;
}
.jr-dismiss:hover { color: rgba(var(--jr-a),.9); background: rgba(var(--jr-a),.15); }
.jr-error { color: rgba(255,100,100,.85); }
.jr-approvals { display:grid; gap:10px; margin-top:14px; }
.jr-approval { border:1px solid rgba(255,180,70,.42); background:rgba(70,38,5,.42); border-radius:8px; padding:12px; }
.jr-approval-head { display:flex; align-items:center; gap:8px; color:#ffc16b; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
.jr-approval-tool { margin-top:7px; color:rgba(var(--jr-tx),.96); font-size:14px; font-weight:650; }
.jr-approval-summary { margin:8px 0; color:rgba(var(--jr-tx),.72); font-size:12px; line-height:1.45; white-space:pre-wrap; }
.jr-approval-actions { display:flex; gap:8px; }
.jr-approval-actions button { min-height:32px; border-radius:6px; padding:6px 12px; cursor:pointer; font-weight:650; }
.jr-approve { color:#07170f; background:#20f7a4; border:1px solid #20f7a4; }
.jr-deny { color:#ffc0c0; background:rgba(120,20,20,.22); border:1px solid rgba(255,100,100,.45); }
.jr-approval-actions button:disabled { opacity:.45; cursor:not-allowed; }
.jr-activity-rail { display:grid; gap:6px; margin:12px 0; padding:10px; border-radius:10px; background:rgba(0,20,42,.42); border:1px solid rgba(var(--jr-a),.15); }
.jr-activity-row { display:grid; grid-template-columns:9px minmax(110px,.7fr) 1.4fr; gap:8px; align-items:center; font-size:11px; color:rgba(var(--jr-tx),.62); }
.jr-activity-row strong { color:rgba(var(--jr-tx),.84); font-weight:600; }
.jr-activity-row strong, .jr-activity-row > span:last-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.jr-activity-dot { width:6px; height:6px; border-radius:50%; background:rgba(var(--jr-a),.72); box-shadow:0 0 7px rgba(var(--jr-a),.55); }
.jr-activity-row[data-status="running"] .jr-activity-dot { animation:jr-dot-pulse 1.1s infinite; }
.jr-activity-row[data-status="error"] .jr-activity-dot { background:#ff6767; }
.jr-activity-row[data-status="approval"] .jr-activity-dot { background:#ffc16b; }
.jr-cards { display:grid; gap:8px; margin-top:12px; }
.jr-card { border:1px solid rgba(var(--jr-a),.22); background:rgba(2,15,31,.55); border-radius:10px; padding:10px 12px; }
.jr-card-title { font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:rgba(var(--jr-a),.78); }
.jr-card-body { margin-top:5px; font-size:12px; line-height:1.45; color:rgba(var(--jr-tx),.72); }
.jr-files { display:grid; gap:7px; margin-top:10px; }
.jr-file { display:flex; align-items:center; gap:10px; padding:9px 11px; border:1px solid rgba(90,235,170,.28); border-radius:9px; background:rgba(15,70,48,.2); color:#a8f4c7; text-decoration:none; }
.jr-file-meta { flex:1; min-width:0; }
.jr-file-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:650; }
.jr-file-sub { margin-top:2px; font-size:10px; opacity:.65; }
.jr-trace { margin-top:10px; font-size:11px; }
.jr-trace summary { cursor:pointer; color:rgba(var(--jr-tx),.5); }
.jr-toast { position:fixed; right:26px; bottom:122px; z-index:80; width:min(360px,calc(100vw - 32px)); padding:13px; border-radius:12px; background:rgba(5,22,37,.96); border:1px solid rgba(80,235,170,.42); box-shadow:0 12px 40px rgba(0,0,0,.55); color:#d7fbe7; font-family:Inter,"Segoe UI",sans-serif; }
.jr-toast a { display:inline-block; margin-top:8px; color:#8ff0b8; font-size:12px; font-weight:700; text-decoration:none; }
`;

type ApprovalRequest = {
  id: string;
  tool: string;
  risk?: string;
  summary?: Record<string, unknown>;
  expiresAt?: string;
  ownerChallenge?: string;
};

type PreparedAttachment = { dataUrl?: string; text?: string; name: string; mimeType?: string; bytes: number };

function fileSize(bytes?: number) {
  if (!bytes) return "file";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function prepareAttachments(files: File[]): Promise<PreparedAttachment[]> {
  const selected = files.slice(0, 5);
  const total = selected.reduce((sum, file) => sum + file.size, 0);
  if (total > 8 * 1024 * 1024) throw new Error("Attachments must be under 8 MB combined for this chat surface.");
  return Promise.all(selected.map(async (file) => {
    const textLike = file.type.startsWith("text/") || /\.(txt|csv|md|json|log|js|ts|tsx|py|html|xml|ya?ml|ini|cfg)$/i.test(file.name);
    return textLike
      ? { name: file.name, mimeType: file.type || "text/plain", bytes: file.size, text: (await file.text()).slice(0, 60000) }
      : { name: file.name, mimeType: file.type || "application/octet-stream", bytes: file.size, dataUrl: await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error || new Error("Could not read attachment")); reader.readAsDataURL(file); }) };
  }));
}

export function JarvisUI() {
  const [response, setResponse] = useState("");
  const [activity, setActivity] = useState("");
  const [activityEvents, setActivityEvents] = useState<JarvisActivityEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [helixOpen, setHelixOpen] = useState(false);
  const [apexOpen, setApexOpen] = useState(false);
  const [arbiterOpen, setArbiterOpen] = useState(false);
  const [voiceMode, setVoiceMode] = useState<"dictate" | "live">("dictate");
  const [liveVoiceState, setLiveVoiceState] = useState<"idle" | "connecting" | "listening" | "speaking" | "error">("idle");
  const liveVoiceRef = useRef<LiveVoiceController | null>(null);
  // Cortex v4 P1.4 — Strength dial (cost-guarded default). Cycles on click; sent with each request.
  const [model, setModel] = useState<"cortex" | "cortex-prime">("cortex"); // Cortex v4 — model selector
  const [strength, setStrength] = useState<"cost-guarded" | "balanced" | "full">("cost-guarded");
  const cycleStrength = useCallback(() => {
    setStrength((s) => (s === "cost-guarded" ? "balanced" : s === "balanced" ? "full" : "cost-guarded"));
  }, []);
  const [research, setResearch] = useState<"fast" | "deep">("fast");
  const toggleResearch = useCallback(() => setResearch((r) => (r === "fast" ? "deep" : "fast")), []);
  // Cortex v4 P1.2-lite — response footer meta (which model answered + sources).
  const [meta, setMeta] = useState<Partial<BrainResponse>>({});
  const [toastArtifact, setToastArtifact] = useState<JarvisArtifact | null>(null);
  // Cortex v4 P1.6 — attachments. Backend vision path already works (inline_data);
  // read the selected image to a data URL so the next message can carry it.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const id = "jr-panel-styles";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = PANEL_CSS;
  }, []);

  // Intercept helix widget open event
  useEffect(() => {
    function handle(e: Event) {
      if ((e as CustomEvent).detail?.id === "helix") {
        setHelixOpen(true);
        setLauncherOpen(false);
      }
    }
    document.addEventListener("jarvis:open-widget", handle);
    return () => document.removeEventListener("jarvis:open-widget", handle);
  }, []);

  const toggleLiveVoice = useCallback(async () => {
    if (liveVoiceRef.current?.active) {
      await liveVoiceRef.current.stop();
      setLiveVoiceState("idle");
      return;
    }
    if (!liveVoiceRef.current) {
      liveVoiceRef.current = new LiveVoiceController({
        onState: (state, detail) => {
          setLiveVoiceState(state);
          if (state === "error" && detail) { setResponse(detail); setHasError(true); setVisible(true); }
        },
        onOutputTranscript: (text) => { setResponse(text); setVisible(true); },
        onTurnComplete: ({ output }) => { if (output) { setResponse(output); setVisible(true); } },
        onToolResult: (tool) => setActivityEvents((items) => [...items, { id: crypto.randomUUID(), kind: "tool", status: "complete", label: tool.replace(/_/g, " "), detail: "Live tool result received" }].slice(-18)),
      });
    }
    try { await liveVoiceRef.current.start(); }
    catch (error) { setLiveVoiceState("error"); setResponse(error instanceof Error ? error.message : String(error)); setHasError(true); setVisible(true); }
  }, []);

  useEffect(() => () => { void liveVoiceRef.current?.stop(); }, []);

  const handleSubmit = useCallback(async (text: string, files: File[] = []) => {
    // Forgiving room-entry matcher — tolerates casing, trailing punctuation
    // (voice input adds "."), and prefixes like "open/enter/go to … room".
    const norm = text.trim().toLowerCase().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ").trim();
    if (/^(?:(?:go to|open|launch|enter|show|take me to)\s+)?helix(?:\s+room)?$/.test(norm)) {
      setHelixOpen(true);
      return;
    }
    if (/^(?:(?:go to|open|launch|enter|show|take me to)\s+)?apex(?:\s+room)?$/.test(norm)) {
      setApexOpen(true);
      return;
    }
    // Arbiter — accept "arbiter"/"arbitrer" (common spelling) with the same prefixes.
    if (/^(?:(?:go to|open|launch|enter|show|take me to)\s+)?arbit(?:er|re)?r?(?:\s+room)?$/.test(norm)) {
      setArbiterOpen(true);
      return;
    }
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setResponse("");
    setActivity("");
    setActivityEvents([]);
    setToastArtifact(null);
    setHasError(false);
    setApprovals([]);
    setStreaming(true);
    setVisible(true);

    try {
      setMeta({});
      const preparedFiles = await prepareAttachments(files);
      if (preparedFiles.length) setActivity(`Prepared ${preparedFiles.length} attachment${preparedFiles.length === 1 ? "" : "s"}`);
      const primaryInline = preparedFiles.find((file) => file.dataUrl);
      const remainingAttachments = primaryInline ? preparedFiles.filter((file) => file !== primaryInline) : preparedFiles;
      const result = await streamPost<BrainResponse>(
        "/api/chat/stream",
        { prompt: text, mode: primaryInline ? "vision" : "command", model, strength, deepResearch: research === "deep", imageData: primaryInline?.dataUrl, attachments: remainingAttachments },
        (delta) => { setActivity(""); setResponse((r) => r + delta); },
        (phase, message) => {
          setActivity(message);
          setActivityEvents((items) => [...items, { id: crypto.randomUUID(), kind: "research", status: "running", label: phase || "Research", detail: message }].slice(-18));
        },
        (event, envelope) => setActivityEvents((items) => [...items, {
          id: `${String(envelope.turnId || "turn")}-${String(envelope.sequence || items.length)}`,
          kind: String(event.kind || "run"), status: String(event.status || "running"),
          label: String(event.label || "Activity"), detail: event.detail ? String(event.detail) : undefined,
          timestamp: envelope.timestamp ? String(envelope.timestamp) : undefined,
          sequence: Number(envelope.sequence || 0), tool: event.tool ? String(event.tool) : undefined,
        }].slice(-18))
      );
      const r = result;
      // Cortex v4 — snap to the canonical final text (kills any streamed-delta doubling glitch).
      if (typeof r?.response === "string" && r.response.trim()) setResponse(r.response);
      setMeta(r);
      if (r.artifacts?.[0]) setToastArtifact(r.artifacts[0]);
      if (Array.isArray(r?.pendingConfirmations) && r.pendingConfirmations.length > 0) {
        try {
          const pending = await api<{ confirmations?: ApprovalRequest[] }>("/api/confirmations/pending");
          setApprovals(Array.isArray(pending.confirmations) ? pending.confirmations : r.pendingConfirmations);
        } catch {
          // Remote/paired surfaces may see that approval is required, but only
          // the direct owner surface receives the one-time approval challenge.
          setApprovals(r.pendingConfirmations);
        }
      }
      // Cortex v4 P1.3 — HUD actions from the backend (open a widget, optionally in focus mode).
      if (Array.isArray(r?.uiActions)) {
        for (const a of r.uiActions) {
          if (a?.type === "open-widget" && a.id) {
            document.dispatchEvent(new CustomEvent("jarvis:open-widget", { detail: { id: a.id, focus: !!a.focus } }));
          } else {
            document.dispatchEvent(new CustomEvent("jarvis:ui", { detail: a as JarvisUiAction }));
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "AbortError") {
        setResponse(msg);
        setHasError(true);
      }
    } finally {
      setStreaming(false);
      setActivity("");
    }
  }, [model, strength, research]);

  useEffect(() => {
    function handleWidgetCommand(event: Event) {
      const detail = (event as CustomEvent<{ text?: string; files?: File[] }>).detail || {};
      const text = String(detail.text || "").trim();
      if (text) void handleSubmit(text, Array.isArray(detail.files) ? detail.files : []);
    }
    document.addEventListener("jarvis:command", handleWidgetCommand);
    return () => document.removeEventListener("jarvis:command", handleWidgetCommand);
  }, [handleSubmit]);

  const decideApproval = useCallback(async (approval: ApprovalRequest, decision: "approve" | "deny") => {
    if (!approval.ownerChallenge) return;
    setApprovalBusy(approval.id);
    try {
      const result = await post<any>(`/api/confirmations/${encodeURIComponent(approval.id)}/${decision}`, {
        ownerChallenge: approval.ownerChallenge,
      });
      setApprovals((items) => items.filter((item) => item.id !== approval.id));
      const outcome = decision === "approve"
        ? result?.result ?? result?.message ?? `${approval.tool} completed.`
        : result?.message ?? `${approval.tool} denied.`;
      const rendered = typeof outcome === "string" ? outcome : JSON.stringify(outcome, null, 2);
      setResponse((current) => `${current}${current ? "\n\n" : ""}${rendered}`);
    } catch (error) {
      setResponse((current) => `${current}${current ? "\n\n" : ""}Approval failed: ${error instanceof Error ? error.message : String(error)}`);
      setHasError(true);
    } finally {
      setApprovalBusy(null);
    }
  }, []);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    setVisible(false);
    setStreaming(false);
  }, []);

  return (
    <div className="jarvis-ui">
      {helixOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
          <HelixV2 onExit={() => setHelixOpen(false)} />
        </div>
      )}

      {apexOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
          <ApexRoom onExit={() => setApexOpen(false)} />
        </div>
      )}

      {arbiterOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
          <ArbiterRoom onExit={() => setArbiterOpen(false)} />
        </div>
      )}

      <img className="jarvis-bg" src="/jarvis_room_bg.png" alt="" />
      <Canvas
        camera={{ fov: 50, position: [0, 1.5, 8.0], near: 0.1, far: 1000 }}
        gl={{ alpha: true, antialias: true }}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        <group position={[0, 0.2, 0]} scale={1.32}>
          <HoloGlobe centerY={0} />
        </group>
      </Canvas>

      <div className={`jr-panel${visible ? " visible" : ""}`}>
        <div className="jr-panel-inner">
          <button className="jr-dismiss" onClick={dismiss} title="Dismiss">✕</button>
          <div className="jr-label">Jarvis</div>
          {streaming && !response ? (
            <div>
              <div className="jr-thinking">
                <span className="jr-dot" />
                <span className="jr-dot" />
                <span className="jr-dot" />
              </div>
              {activity ? (
                <div className="jr-activity" style={{ marginTop: 8, fontSize: 12, color: "#7fb8e6", opacity: 0.9, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10 }}>◈</span>{activity}
                </div>
              ) : null}
            </div>
          ) : (
            <div className={`jr-text${hasError ? " jr-error" : ""}`}>
              {response}
              {streaming && <span className="jr-cursor" />}
            </div>
          )}
          {activityEvents.length > 0 ? (
            <div className="jr-activity-rail" aria-label="JARVIS activity">
              {activityEvents.slice(-7).map((event) => (
                <div className="jr-activity-row" data-status={event.status} key={event.id}>
                  <span className="jr-activity-dot" /><strong>{event.label}</strong><span>{event.detail || event.kind}</span>
                </div>
              ))}
            </div>
          ) : null}
          {!streaming && !hasError && (meta.model || (meta.sources && meta.sources.length > 0) || (meta.artifacts && meta.artifacts.length > 0)) ? (
            <div className="jr-meta" style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 11 }}>
              {meta.model ? (
                <span style={{ padding: "2px 8px", border: "1px solid rgba(120,200,255,0.25)", borderRadius: 10, color: "#7fb8e6", opacity: 0.85 }}>
                  via {meta.model.replace("gemini-", "")}
                </span>
              ) : null}
              {(meta.sources || []).slice(0, 4).map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer"
                   style={{ padding: "2px 8px", border: "1px solid rgba(120,200,255,0.2)", borderRadius: 10, color: "#8fd0ff", textDecoration: "none", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  🔗 {(s.title || s.url).replace(/^https?:\/\//, "").slice(0, 38)}
                </a>
              ))}
              {(meta.artifacts || []).slice(0, 4).map((a, i) => {
                const fn = a.title || a.name || a.filename || "";
                if (!fn) return null;
                const url = a.downloadUrl || `/api/files/${encodeURIComponent(fn)}`;
                const isImg = /\.(png|jpe?g|webp|gif)$/i.test(fn);
                return isImg ? (
                  <a key={`a${i}`} href={url} target="_blank" rel="noreferrer" style={{ flexBasis: "100%", marginTop: 6 }}>
                    <img src={url} alt={fn} style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 8, border: "1px solid rgba(120,200,255,0.25)", display: "block" }} />
                  </a>
                ) : (
                  <a key={`a${i}`} href={url} download
                     style={{ padding: "2px 10px", border: "1px solid rgba(120,255,180,0.35)", borderRadius: 10, color: "#8ff0b8", textDecoration: "none", background: "rgba(40,120,70,0.15)" }}>
                    ⬇ {fn.slice(0, 40)}
                  </a>
                );
              })}
            </div>
          ) : null}
          {!streaming && (meta.usage || meta.strength || meta.timing) ? <div className="jr-meta" style={{ marginTop: 8, display: "flex", gap: 9, fontSize: 10.5, color: "rgba(180,225,250,.58)" }}>
            {meta.strength ? <span>{meta.strength}</span> : null}
            {meta.usage?.totalTokens ? <span>{meta.usage.totalTokens.toLocaleString()} tokens</span> : null}
            {typeof meta.usage?.costUsd === "number" ? <span>${meta.usage.costUsd.toFixed(4)}</span> : null}
            {meta.timing?.totalMs ? <span>{(meta.timing.totalMs / 1000).toFixed(1)}s</span> : null}
          </div> : null}
          {(meta.cards || []).length ? <div className="jr-cards">{meta.cards!.map((card, index) => <div className="jr-card" key={`${card.title}-${index}`}><div className="jr-card-title">{card.title}{card.value ? ` · ${card.value}` : ""}</div>{card.body ? <div className="jr-card-body">{card.body}</div> : null}{card.items?.length ? <div className="jr-card-body">{card.items.map((item) => <div key={item}>• {item}</div>)}</div> : null}</div>)}</div> : null}
          {meta.receipt || meta.timing ? <details className="jr-trace"><summary>Technical trace</summary><pre className="jr-card-body">{JSON.stringify({ receipt: meta.receipt, timing: meta.timing, usage: meta.usage }, null, 2)}</pre></details> : null}
          {approvals.length > 0 ? (
            <div className="jr-approvals" aria-label="Actions awaiting owner approval">
              {approvals.map((approval) => {
                const summary = Object.entries(approval.summary || {}).map(([key, value]) => `${key}: ${String(value)}`).join("\n");
                const ownerReady = Boolean(approval.ownerChallenge);
                return (
                  <div className="jr-approval" key={approval.id}>
                    <div className="jr-approval-head"><span>◆</span>{approval.risk || "execute"} · owner approval</div>
                    <div className="jr-approval-tool">{approval.tool.replace(/_/g, " ")}</div>
                    {summary ? <div className="jr-approval-summary">{summary}</div> : null}
                    <div className="jr-approval-actions">
                      <button className="jr-approve" disabled={!ownerReady || approvalBusy === approval.id} onClick={() => decideApproval(approval, "approve")}>Approve once</button>
                      <button className="jr-deny" disabled={!ownerReady || approvalBusy === approval.id} onClick={() => decideApproval(approval, "deny")}>Deny</button>
                    </div>
                    {!ownerReady ? <div className="jr-approval-summary">Open JARVIS directly on the owner computer to decide this action.</div> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {toastArtifact ? <div className="jr-toast" role="status">
        <strong>JARVIS created {toastArtifact.title || toastArtifact.name || "an artifact"}</strong>
        <div style={{ marginTop: 4, fontSize: 11, opacity: .65 }}>{fileSize(toastArtifact.bytes)} · {toastArtifact.status || "ready"}</div>
        <a href={toastArtifact.downloadUrl || `/api/files/${encodeURIComponent(toastArtifact.name || toastArtifact.filename || toastArtifact.title || "artifact")}`} download>Download</a>
        <button className="jr-dismiss" onClick={() => setToastArtifact(null)} title="Dismiss artifact notification">×</button>
      </div> : null}

      <WidgetStrip mode="main" showChips={false} />
      <WidgetLauncher open={launcherOpen} onClose={() => setLauncherOpen(false)} />

      <JarvisCommandBar
        onSubmit={handleSubmit}
        onMicToggle={(active) => { if (!active && !response) setVisible(false); }}
        voiceMode={voiceMode}
        onSetVoiceMode={(value) => setVoiceMode(value as "dictate" | "live")}
        liveVoiceActive={["connecting", "listening", "speaking"].includes(liveVoiceState)}
        onLiveVoiceToggle={toggleLiveVoice}
        onModules={() => setLauncherOpen(o => !o)}
        model={model}
        onSetModel={(v) => setModel(v as "cortex" | "cortex-prime")}
        strength={strength}
        onCycleStrength={cycleStrength}
        onSetStrength={(v) => setStrength(v as "cost-guarded" | "balanced" | "full")}
        research={research}
        onToggleResearch={toggleResearch}
        onSetResearch={(v) => setResearch(v as "fast" | "deep")}
      />
    </div>
  );
}
