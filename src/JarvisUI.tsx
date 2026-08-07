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
import { SynapseRoom } from "./rooms/synapse/SynapseRoom";
import { api, post, resolveOwnerChallenge, streamPost } from "./api";
import { LiveVoiceController } from "./liveVoice";
import type { BrainResponse, JarvisActivityEvent, JarvisArtifact, JarvisContactCandidate, JarvisResponseCard, JarvisUiAction } from "./types";
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
/* The commit card. The decision is "does this one action go out or not", so the action itself is
   the only thing set at reading size; the instruction and destination sit under it as context. */
.jr-approval-intent { margin:8px 0 2px; color:rgba(var(--jr-tx),.96); font-size:15px; font-weight:600; line-height:1.35; }
.jr-approval-facts { display:grid; gap:5px; margin:9px 0 11px; font-size:12px; line-height:1.45; }
.jr-approval-fact { display:grid; grid-template-columns:58px 1fr; gap:9px; align-items:baseline; }
.jr-approval-fact > dt { color:rgba(var(--jr-tx),.45); font-size:10.5px; letter-spacing:.07em; text-transform:uppercase; }
.jr-approval-fact > dd { margin:0; color:rgba(var(--jr-tx),.8); min-width:0; overflow-wrap:anywhere; }
.jr-approval-caveat { color:#ffc16b; font-size:11.5px; margin:-2px 0 10px; }
/* An unconfirmed or mismatched recipient is the one fact worth interrupting the eye for. */
.jr-approval-fact-warn dd { color:#ffc16b; font-weight:600; }
.jr-approval-hint { margin-top:8px; color:rgba(var(--jr-tx),.42); font-size:11.5px; }
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
.jr-contact-choice { border-color:rgba(255,193,107,.34); background:rgba(28,20,6,.42); }
.jr-contact-choice .jr-card-title { color:#ffc16b; }
.jr-contact-grid { display:grid; gap:7px; margin-top:9px; }
.jr-contact-option { display:flex; align-items:center; gap:11px; width:100%; padding:9px 11px; text-align:left; cursor:pointer;
  border:1px solid rgba(var(--jr-a),.24); border-radius:10px; background:rgba(2,15,31,.62); color:inherit; font:inherit;
  transition:border-color .14s ease, background .14s ease, transform .14s ease; }
.jr-contact-option:hover:not(:disabled) { border-color:rgba(255,193,107,.62); background:rgba(10,28,48,.78); transform:translateY(-1px); }
.jr-contact-option:focus-visible { outline:2px solid rgba(255,193,107,.75); outline-offset:2px; }
.jr-contact-option:disabled { opacity:.5; cursor:progress; }
.jr-contact-avatar { width:40px; height:40px; border-radius:50%; object-fit:cover; flex:0 0 auto;
  border:1px solid rgba(var(--jr-a),.3); background:rgba(0,20,42,.7); }
.jr-contact-avatar-blank { display:flex; align-items:center; justify-content:center; font-weight:700; font-size:15px; color:rgba(var(--jr-a),.8); }
.jr-contact-meta { display:grid; gap:2px; flex:1; min-width:0; }
.jr-contact-name { font-size:13px; font-weight:650; color:rgba(var(--jr-tx),.9); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.jr-contact-handle { font-size:11.5px; font-weight:600; color:#ffc16b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.jr-contact-detail { font-size:10.5px; color:rgba(var(--jr-tx),.52); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.jr-contact-pick { flex:0 0 auto; font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:rgba(var(--jr-a),.72); }
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
  // Present only for a paused browser/screen commit — the one case where we can say precisely what
  // approving does. Every field is copied from the DOM-authored boundary descriptor.
  commit?: {
    intent: string;
    target?: string;
    url?: string;
    surface?: string;
    task?: string;
    action?: string;
    key?: string;
    unlabelled?: boolean;
    /** Who receives this, read off the page. `confirmed: false` means the page did not say. */
    recipient?: { text: string; confirmed: boolean; kind?: string } | null;
  } | null;
  expiresAt?: string;
  ownerChallenge?: string;
};

type PreparedAttachment = { dataUrl?: string; text?: string; name: string; mimeType?: string; bytes: number };

// Two people can share a display name. An inbox with two rows both reading "Tg" is ordinary, and
// the machine genuinely cannot tell them apart while the owner can, instantly — but only if it is
// shown the handle and the face, which is exactly what a bare name-tie refusal withheld.
//
// One question, asked once. The answer is saved, and every later mention of that name goes straight
// to the right conversation without a search.
function ContactChoiceCard({ card, onChoose }: { card: JarvisResponseCard; onChoose: (card: JarvisResponseCard, candidate: JarvisContactCandidate) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pick = async (candidate: JarvisContactCandidate) => {
    setBusy(candidate.handle || candidate.label);
    setError("");
    try {
      await onChoose(card, candidate);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="jr-card jr-contact-choice">
      <div className="jr-card-title">{card.title}</div>
      {card.body ? <div className="jr-card-body">{card.body}</div> : null}
      <div className="jr-contact-grid">
        {card.candidates!.map((candidate, index) => (
          <button
            type="button"
            key={`${candidate.handle || candidate.label}-${index}`}
            className="jr-contact-option"
            onClick={() => void pick(candidate)}
            disabled={busy !== null}
          >
            {candidate.avatarUrl
              ? <img className="jr-contact-avatar" src={candidate.avatarUrl} alt="" referrerPolicy="no-referrer" />
              : <span className="jr-contact-avatar jr-contact-avatar-blank">{(candidate.label || "?").trim().charAt(0).toUpperCase()}</span>}
            <span className="jr-contact-meta">
              <span className="jr-contact-name">{candidate.label}</span>
              {/* The handle is the thing that actually distinguishes two people with one name. */}
              {candidate.handle ? <span className="jr-contact-handle">@{candidate.handle}</span> : null}
              {candidate.detail ? <span className="jr-contact-detail">{candidate.detail}</span> : null}
            </span>
            <span className="jr-contact-pick">{busy === (candidate.handle || candidate.label) ? "saving…" : "this one"}</span>
          </button>
        ))}
      </div>
      {error ? <div className="jr-card-body" style={{ color: "#ff9a9a" }}>{error}</div> : null}
    </div>
  );
}

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
  // Persist which room is open so a page reload lands back in the same room (not the Jarvis home).
  const savedRoom = (() => { try { return localStorage.getItem("jarvis.activeRoom") || ""; } catch { return ""; } })();
  const [helixOpen, setHelixOpen] = useState(savedRoom === "helix");
  const [apexOpen, setApexOpen] = useState(savedRoom === "apex");
  const [arbiterOpen, setArbiterOpen] = useState(savedRoom === "arbiter");
  const [synapseOpen, setSynapseOpen] = useState(false); // Synapse is a Jarvis FEATURE, not a room — not persisted
  useEffect(() => {
    const r = apexOpen ? "apex" : helixOpen ? "helix" : arbiterOpen ? "arbiter" : "";
    try { localStorage.setItem("jarvis.activeRoom", r); } catch { /* ignore */ }
  }, [apexOpen, helixOpen, arbiterOpen]);
  const [voiceMode, setVoiceMode] = useState<"dictate" | "live">("dictate");
  const [liveVoiceState, setLiveVoiceState] = useState<"idle" | "connecting" | "listening" | "speaking" | "error">("idle");
  const liveVoiceRef = useRef<LiveVoiceController | null>(null);
  // Cortex v4 P1.4 — Strength dial (cost-guarded default). Cycles on click; sent with each request.
  const [model, setModel] = useState<"cortex" | "eclipse">("cortex"); // Cortex chat/reasoning or Eclipse mission runtime
  const [strength, setStrength] = useState<"cost-guarded" | "balanced" | "full" | "pulse" | "deep" | "totality">("cost-guarded");
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

  // Synapse — the board widget tile expands to the full-screen room via this event.
  useEffect(() => {
    function openSynapse() { setSynapseOpen(true); setLauncherOpen(false); }
    document.addEventListener("jarvis:open-synapse-room", openSynapse);
    return () => document.removeEventListener("jarvis:open-synapse-room", openSynapse);
  }, []);

  // Arriving via a Synapse invite link (`?tool=coop&coop_code=…`) opens the room straight away.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("coop_code")) setSynapseOpen(true);
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

  // `decideApproval` is what the card's buttons call and is declared further down, after the
  // callbacks it depends on. handleSubmit needs it too, so that answering the prompt out loud lands
  // on exactly the same path as clicking; a latest-ref avoids an ordering where one const would
  // reference the other before initialisation.
  const decideApprovalRef = useRef<((approval: ApprovalRequest, decision: "approve" | "deny") => Promise<void>) | null>(null);

  const handleSubmit = useCallback(async (text: string, files: File[] = []) => {
    // Forgiving room-entry matcher — tolerates casing, trailing punctuation
    // (voice input adds "."), and prefixes like "open/enter/go to … room".
    const norm = text.trim().toLowerCase().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ").trim();

    // Answering the approval prompt in words, typed or spoken. JARVIS asks "approve this?" and the
    // only way to say yes was to click — and saying it did harm: `setApprovals([])` below clears the
    // card on every submit, so typing "confirm" dismissed the pending action AND sent the word to
    // the model as a fresh request. The action was abandoned silently.
    //
    // The match is deliberately whole-utterance. A test that fired on "yes" appearing ANYWHERE in a
    // sentence would let an ordinary message commit someone's pending send, and the entire purpose
    // of this gate is deliberate consent — so the utterance has to be nothing but the decision.
    if (approvals.length) {
      const spokenApproval = /^(confirm|confirmed|approve|approved|yes|yep|yeah|ok|okay|do it|send it|go ahead|proceed)$/.test(norm);
      const spokenDenial = /^(deny|denied|cancel|no|nope|stop|abort)$/.test(norm);
      if (spokenApproval || spokenDenial) {
        // With several pending, a bare "confirm" does not say which — and picking one for the owner
        // is exactly the guess this gate exists to prevent.
        if (approvals.length > 1) {
          setResponse(`${approvals.length} actions are waiting. Use the buttons so it is unambiguous which one you mean.`);
          return;
        }
        await decideApprovalRef.current?.(approvals[0], spokenApproval ? "approve" : "deny");
        return;
      }
    }
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
    if (/^(?:(?:go to|open|launch|enter|show|take me to)\s+)?synapse(?:\s+room)?$/.test(norm)) {
      setSynapseOpen(true);
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
      // Eclipse — route to the durable multi-agent mission runtime instead of Cortex chat.
      if (model === "eclipse") {
        const launchRes = await fetch("/api/eclipse/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text, effort: strength }), signal: abortRef.current?.signal });
        const launch = await launchRes.json();
        if (!launchRes.ok) throw new Error(launch.error || "Eclipse launch failed");
        const missionId = String(launch.missionId);
        setActivity("Eclipse mission launched…");
        const detailOf = (p: any) => (p ? String(p.node || p.tool || p.persona || p.uri || p.claimId || "") || undefined : undefined);
        await new Promise<void>((resolve) => {
          let done = false;
          const es = new EventSource(`/api/eclipse/missions/${missionId}/stream`);
          const finish = (r?: any) => {
            if (done) return; done = true;
            clearInterval(poll); es.close();
            const res = (r && r.result) || {};
            if (typeof res.answer === "string" && res.answer.trim()) setResponse(res.answer);
            else { setResponse(r?.error || "Eclipse mission ended without a synthesis."); if (r?.status === "failed") setHasError(true); }
            setMeta({ model: "eclipse" } as BrainResponse);
            resolve();
          };
          es.onmessage = (ev) => {
            try {
              const d = JSON.parse(ev.data);
              setActivity(String(d.type || "Eclipse"));
              setActivityEvents((items) => [...items, { id: `ecl-${d.sequence}`, kind: "run", status: /complete|failed/.test(String(d.type)) ? "done" : "running", label: String(d.type), detail: detailOf(d.payload) }].slice(-18));
            } catch { /* ignore malformed frame */ }
          };
          es.onerror = () => { /* polling below drives completion */ };
          const poll = setInterval(async () => {
            try {
              const r = await (await fetch(`/api/eclipse/missions/${missionId}`)).json();
              if (r.status && r.status !== "running") finish(r);
            } catch { /* keep polling */ }
          }, 2000);
        });
        return;
      }
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
    // `approvals` is a dependency now: without it this closes over the list as it was when the
    // callback was created — empty — and a spoken "confirm" would never see anything pending.
  }, [model, strength, research, approvals]);

  useEffect(() => {
    function handleWidgetCommand(event: Event) {
      const detail = (event as CustomEvent<{ text?: string; files?: File[] }>).detail || {};
      const text = String(detail.text || "").trim();
      if (text) void handleSubmit(text, Array.isArray(detail.files) ? detail.files : []);
    }
    document.addEventListener("jarvis:command", handleWidgetCommand);
    return () => document.removeEventListener("jarvis:command", handleWidgetCommand);
  }, [handleSubmit]);

  // Picking a person from the disambiguation card. Saves who they are, then re-runs the request
  // that could not identify them — so the answer is given once and the original intent still
  // happens, rather than the owner having to retype it.
  const chooseContact = useCallback(async (card: JarvisResponseCard, candidate: JarvisContactCandidate) => {
    const name = String(card.query || candidate.label || "").trim();
    const channel = String(card.channel || "instagram");
    await post<any>("/api/contacts", {
      name,
      aliases: candidate.handle && candidate.handle !== name ? [candidate.handle] : [],
      channels: {
        [channel]: {
          handle: candidate.handle || "",
          threadUrl: candidate.threadUrl || "",
          profileUrl: candidate.profileUrl || "",
          avatarUrl: candidate.avatarUrl || "",
        },
      },
    });
    if (card.task) await handleSubmit(card.task, []);
  }, [handleSubmit]);

  const decideApproval = useCallback(async (approval: ApprovalRequest, decision: "approve" | "deny") => {
    // `if (!approval.ownerChallenge) return;` made the button do nothing, with no error shown,
    // on the fallback path — `requestConfirmation`'s inline confirmations deliberately omit the
    // challenge, so any turn where the pending fetch had failed produced a dead button. Resolve
    // it now, and if this surface genuinely cannot approve, say so.
    setApprovalBusy(approval.id);
    try {
      const ownerChallenge = await resolveOwnerChallenge(approval.id, approval.ownerChallenge);
      const result = await post<any>(`/api/confirmations/${encodeURIComponent(approval.id)}/${decision}`, {
        ownerChallenge,
      });
      // Approving re-executes the task, and that run can stop at another commit boundary. The reply
      // is then `{ok:false, status:"confirmation_required", confirmation}` — which fell through to
      // `${tool} completed.` and dropped the new card on the floor. So the owner pressed Approve,
      // was told it had completed, and nothing had happened. Whatever comes back, show it.
      const next = result?.confirmation;
      if (decision === "approve" && result?.status === "confirmation_required" && next?.id) {
        // The inline confirmation deliberately omits the one-time owner challenge, and the card's
        // buttons are disabled without it — so pushing `next` straight in would swap one dead end
        // for another. Take the challenge-bearing copy from the pending list, as the normal turn does.
        let card: ApprovalRequest = next;
        try {
          const pending = await api<{ confirmations?: ApprovalRequest[] }>("/api/confirmations/pending");
          card = pending.confirmations?.find((item) => item.id === next.id) || next;
        } catch { /* remote surface: fall back to the inline card, which will say it cannot decide */ }
        setApprovals((items) => [...items.filter((item) => item.id !== approval.id), card]);
        setResponse((current) => `${current}${current ? "\n\n" : ""}That step is done. The run stopped at another action that needs your approval.`);
        return;
      }
      setApprovals((items) => items.filter((item) => item.id !== approval.id));
      if (decision === "approve" && result?.ok === false) {
        setResponse((current) => `${current}${current ? "\n\n" : ""}${result?.error || `${approval.tool} did not complete.`}`);
        setHasError(true);
        return;
      }
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
  // Kept current so a spoken "confirm" in handleSubmit runs this exact function, not a copy of it.
  decideApprovalRef.current = decideApproval;

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

      {synapseOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
          <SynapseRoom onExit={() => setSynapseOpen(false)} />
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
          {(meta.cards || []).length ? <div className="jr-cards">{meta.cards!.map((card, index) => (
            card.kind === "contact-choice" && card.candidates?.length
              ? <ContactChoiceCard key={`contact-${index}`} card={card} onChoose={chooseContact} />
              : <div className="jr-card" key={`${card.title}-${index}`}><div className="jr-card-title">{card.title}{card.value ? ` · ${card.value}` : ""}</div>{card.body ? <div className="jr-card-body">{card.body}</div> : null}{card.items?.length ? <div className="jr-card-body">{card.items.map((item) => <div key={item}>• {item}</div>)}</div> : null}</div>
          ))}</div> : null}
          {meta.receipt || meta.timing ? <details className="jr-trace"><summary>Technical trace</summary><pre className="jr-card-body">{JSON.stringify({ receipt: meta.receipt, timing: meta.timing, usage: meta.usage }, null, 2)}</pre></details> : null}
          {approvals.length > 0 ? (
            <div className="jr-approvals" aria-label="Actions awaiting owner approval">
              {approvals.map((approval) => {
                const commit = approval.commit;
                // Without a commit boundary (any other capability) there is nothing better to show
                // than the arguments, so that stays as the fallback rather than being deleted.
                const summary = commit ? "" : Object.entries(approval.summary || {}).map(([key, value]) => `${key}: ${String(value)}`).join("\n");
                const ownerReady = Boolean(approval.ownerChallenge);
                const busy = approvalBusy === approval.id;
                return (
                  <div className="jr-approval" key={approval.id}>
                    <div className="jr-approval-head"><span>◆</span>{approval.risk || "execute"} · owner approval</div>
                    {commit ? (
                      <>
                        {/* Headline is the owner's own instruction — the thing actually being
                            authorised, in their words, with nothing inferred. The mechanic sits
                            below it: true and worth showing, but not the decision. */}
                        <div className="jr-approval-intent">{commit.task || commit.intent}</div>
                        <dl className="jr-approval-facts">
                          {/* WHO comes first and cannot be scrolled past. Four messages went to a
                              group chat while this card described only the action, so the recipient
                              is the first fact, and an unconfirmed one says so instead of hiding. */}
                          {commit.recipient ? (
                            <div className={`jr-approval-fact${commit.recipient.confirmed ? "" : " jr-approval-fact-warn"}`}>
                              <dt>To</dt><dd>{commit.recipient.text}</dd>
                            </div>
                          ) : null}
                          {commit.task ? <div className="jr-approval-fact"><dt>Action</dt><dd>{commit.intent}</dd></div> : null}
                          {commit.url || commit.surface ? <div className="jr-approval-fact"><dt>On</dt><dd>{commit.url || commit.surface}</dd></div> : null}
                        </dl>
                        {commit.unlabelled ? <div className="jr-approval-caveat">That control has no name on the page — it was identified by role and position.</div> : null}
                      </>
                    ) : (
                      <>
                        <div className="jr-approval-tool">{approval.tool.replace(/_/g, " ")}</div>
                        {summary ? <div className="jr-approval-summary">{summary}</div> : null}
                      </>
                    )}
                    <div className="jr-approval-actions">
                      <button className="jr-approve" disabled={!ownerReady || busy} onClick={() => decideApproval(approval, "approve")}>{busy ? "Working…" : "Approve once"}</button>
                      <button className="jr-deny" disabled={!ownerReady || busy} onClick={() => decideApproval(approval, "deny")}>Deny</button>
                    </div>
                    {busy ? <div className="jr-approval-summary">Running the approved step. This takes a few seconds — the page is being driven now.</div> : null}
                    {/* An affordance nobody is told about is not an affordance. */}
                    {!busy && ownerReady && approvals.length === 1
                      ? <div className="jr-approval-hint">or type or say “confirm”</div>
                      : null}
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
        onSetModel={(v) => setModel(v as "cortex" | "eclipse")}
        strength={strength}
        onCycleStrength={cycleStrength}
        onSetStrength={(v) => setStrength(v as "cost-guarded" | "balanced" | "full" | "pulse" | "deep" | "totality")}
        research={research}
        onToggleResearch={toggleResearch}
        onSetResearch={(v) => setResearch(v as "fast" | "deep")}
      />
    </div>
  );
}
