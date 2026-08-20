import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { HoloGlobe } from "./globe-room/HoloGlobe";
import { JarvisCommandBar } from "./globe-room/JarvisCommandBar";
import { JarvisMarkdown } from "./JarvisMarkdown";
import { WidgetLauncher } from "./globe-room/WidgetLauncher";
import { WidgetStrip } from "./globe-room/WidgetStrip";
import { StageSurface } from "./StageSurface";
import { HelixRoom } from "./rooms/HelixRoom";
import { HelixV2 } from "./rooms/helix/v2/HelixV2";
import { ApexRoom } from "./rooms/ApexRoom";
import { ArbiterRoom } from "./rooms/ArbiterRoom";
import { SynapseRoom } from "./rooms/synapse/SynapseRoom";
import { api, post, resolveOwnerChallenge, streamPost } from "./api";
import { LiveVoiceController } from "./liveVoice";
import type { BrainResponse, JarvisActivityEvent, JarvisArtifact, JarvisContactCandidate, JarvisResponseCard, JarvisUiAction } from "./types";
import "./JarvisUI.css";

// ── Client location context ────────────────────────────────────────────────
// The server only knows a seeded "home" (Boston), so weather / "near me" / local
// time answers were wrong whenever Dev is somewhere else. The browser is the only
// thing that actually knows where he is right now: its IANA timezone is free and
// instant, and geolocation (with permission) gives real coordinates we reverse-
// geocode to a city. We resolve this ONCE on load, cache it, and attach it to every
// chat turn so the backend can answer from his real current location, not a guess.
type ClientContext = { timezone?: string; placeName?: string; lat?: number; lon?: number; source?: string };
let CLIENT_CONTEXT: ClientContext = {};
try {
  const cached = localStorage.getItem("jarvis.clientContext");
  if (cached) CLIENT_CONTEXT = JSON.parse(cached);
} catch { /* private mode / disabled storage — fine, we re-resolve below */ }

async function resolveClientContext(): Promise<void> {
  // Timezone is always available and needs no permission — set it immediately.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) CLIENT_CONTEXT = { ...CLIENT_CONTEXT, timezone: tz, source: CLIENT_CONTEXT.placeName ? CLIENT_CONTEXT.source : "timezone" };
  } catch { /* ignore */ }
  // Best-effort precise location. Permission-gated; if denied we keep the timezone.
  if (typeof navigator !== "undefined" && navigator.geolocation) {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 7000, maximumAge: 15 * 60 * 1000, enableHighAccuracy: false }));
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      CLIENT_CONTEXT = { ...CLIENT_CONTEXT, lat, lon, source: "geolocation" };
      // Reverse-geocode to a human city name via a keyless, CORS-friendly service.
      try {
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
        if (r.ok) {
          const g = await r.json();
          const place = [g.city || g.locality, g.principalSubdivisionCode?.split("-").pop() || g.principalSubdivision, g.countryCode && g.countryCode !== "US" ? g.countryCode : ""].filter(Boolean).join(", ");
          if (place) CLIENT_CONTEXT = { ...CLIENT_CONTEXT, placeName: place };
        }
      } catch { /* name is a nicety; coords already work for weather */ }
    } catch { /* permission denied or timed out — timezone still applies */ }
  }
  try { localStorage.setItem("jarvis.clientContext", JSON.stringify(CLIENT_CONTEXT)); } catch { /* ignore */ }
}
if (typeof window !== "undefined") { void resolveClientContext(); }

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
  color: rgba(var(--jr-tx),.88); word-break: break-word;
  /* Markdown is now rendered to real <p>/<ul>/<pre> by JarvisMarkdown, so the block must NOT
     use white-space: pre-wrap (that would double-space the parsed output). Whitespace preservation
     lives inside the generated <pre>/<code> in JarvisMarkdown's own styles. */
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

/* Floating approval dock — fixed above the command bar, cannot be scrolled past.
   Premium dark-glass card: purple/blue/cyan gradient accents, tight hierarchy. */
.jr-approval-dock {
  position: fixed; left: 50%; bottom: calc(4.5vh + 107px);
  transform: translateX(-50%);
  width: min(560px, calc(100vw - 28px)); z-index: 1200;
  display: grid; gap: 12px;
  animation: jr-appr-in .3s cubic-bezier(.2,.9,.3,1.12);
}
@keyframes jr-appr-in { from { opacity:0; transform:translateX(-50%) translateY(18px) scale(.98); } to { opacity:1; transform:translateX(-50%) translateY(0) scale(1); } }
.jr-approval {
  position:relative; border-radius:24px; padding:22px 24px 18px; font-family:Inter,"Segoe UI",sans-serif;
  border:1px solid transparent;
  background:
    linear-gradient(#0a0b0e,#0a0b0e) padding-box,
    linear-gradient(140deg, rgba(255,255,255,.15), rgba(255,255,255,.05) 45%, rgba(255,255,255,.12)) border-box;
  box-shadow:
    0 50px 120px rgba(0,0,0,.85),
    0 18px 54px rgba(0,0,0,.6),
    inset 0 1px 0 rgba(255,255,255,.07);
}
.jr-approval::before {
  content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none; z-index:0;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size:130px 130px; mix-blend-mode:soft-light; opacity:.5;
}
.jr-approval > * { position:relative; z-index:1; }
.jr-appr-header { display:flex; align-items:center; gap:14px; }
.jr-appr-badge { flex:0 0 auto; width:46px; height:46px; border-radius:50%; display:grid; place-items:center; color:#bfe4ff;
  background:linear-gradient(rgba(16,20,30,1),rgba(14,17,27,1)) padding-box, linear-gradient(135deg,#b47bff,#4a9cf7 55%,#22d3ee) border-box;
  border:2.5px solid transparent;
  box-shadow:0 0 14px rgba(110,130,255,.26), inset 0 0 12px rgba(90,160,255,.18); }
.jr-appr-badge svg { filter:drop-shadow(0 0 5px rgba(120,180,255,.6)); }
.jr-appr-titles { flex:1; min-width:0; }
.jr-appr-title { color:#eaf0fb; font-size:16px; font-weight:750; letter-spacing:.22em; text-transform:uppercase; }
.jr-appr-sub { margin-top:3px; color:rgba(175,190,220,.6); font-size:12.5px; }
.jr-appr-close { flex:0 0 auto; width:30px; height:30px; border:none; background:transparent; color:rgba(180,195,225,.5); cursor:pointer; border-radius:8px; display:grid; place-items:center; }
.jr-appr-close:hover:not(:disabled) { color:#eaf0fb; background:rgba(180,200,255,.08); }
.jr-appr-divider { height:1px; margin:16px -4px 2px; background:linear-gradient(90deg, transparent, rgba(150,170,220,.16) 12%, rgba(150,170,220,.16) 88%, transparent); }
.jr-appr-label { margin:15px 2px 8px; color:rgba(130,155,205,.75); font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; }
.jr-appr-field { border:1px solid rgba(150,165,210,.12); border-radius:14px;
  background:rgba(255,255,255,.022);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04); }
.jr-appr-to { display:flex; align-items:center; gap:13px; padding:11px 14px; }
.jr-appr-ig { flex:0 0 auto; width:38px; height:38px; border-radius:11px; display:grid; place-items:center; color:#fff;
  background:linear-gradient(135deg,#feda75,#fa7e1e 25%,#d62976 55%,#962fbf 80%,#4f5bd5);
  box-shadow:0 4px 16px rgba(214,41,118,.42), 0 0 22px rgba(180,60,200,.3), inset 0 1px 0 rgba(255,255,255,.35); }
.jr-appr-globe { flex:0 0 auto; width:38px; height:38px; border-radius:11px; display:grid; place-items:center; color:#9fd4ff; background:rgba(90,140,255,.14); }
.jr-appr-to-text { flex:1; min-width:0; }
.jr-appr-handle { color:#f0f4fc; font-size:16px; font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.jr-appr-platform { color:rgba(170,185,215,.55); font-size:12.5px; margin-top:1px; }
.jr-appr-unconf { color:#ff9d5c; font-weight:600; }
.jr-appr-chevron { flex:0 0 auto; color:rgba(180,195,225,.4); display:grid; place-items:center; }
.jr-appr-msg { position:relative; padding:14px 16px 30px; min-height:64px; }
.jr-appr-msg-text { color:#eef3fc; font-size:15.5px; line-height:1.5; overflow-wrap:anywhere; white-space:pre-wrap; }
.jr-appr-msg-meta { position:absolute; right:14px; bottom:10px; display:flex; align-items:center; gap:9px; color:rgba(165,180,210,.5); font-size:12px; }
.jr-appr-url { display:flex; align-items:center; gap:11px; padding:11px 14px; margin-top:10px; }
.jr-appr-url-text { flex:1; min-width:0; color:rgba(190,200,225,.72); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.jr-appr-ic { color:#a78bfa; flex:0 0 auto; display:grid; place-items:center; }
.jr-appr-intent { color:#eef3fc; font-size:16px; font-weight:600; line-height:1.4; padding:2px; overflow-wrap:anywhere; }
.jr-appr-caveat { color:#ffc16b; font-size:12px; margin:10px 2px 0; }
.jr-appr-actions { display:flex; gap:12px; margin-top:20px; }
.jr-appr-btn { flex:1; min-height:54px; border-radius:15px; display:flex; align-items:center; justify-content:center; gap:10px; cursor:pointer; font-size:14.5px; font-weight:750; letter-spacing:.12em; text-transform:uppercase; transition:filter .14s, transform .06s; }
.jr-appr-btn:active:not(:disabled){ transform:translateY(1px); }
.jr-appr-btn:disabled{ opacity:.5; cursor:not-allowed; }
.jr-appr-send { position:relative; overflow:hidden; color:#f2f5ff; border:1px solid rgba(150,140,255,.8);
  background:linear-gradient(135deg, rgba(88,120,255,.5), rgba(150,95,255,.5));
  box-shadow:0 4px 14px rgba(50,50,120,.35), inset 0 1px 0 rgba(255,255,255,.22), inset 0 -10px 20px rgba(30,20,90,.3); text-shadow:0 1px 6px rgba(40,40,120,.45); }
.jr-appr-send::after { content:''; position:absolute; inset:0 0 50%; background:linear-gradient(180deg, rgba(255,255,255,.14), transparent); pointer-events:none; }
.jr-appr-send:hover:not(:disabled){ filter:brightness(1.1); }
.jr-appr-cancel { color:#ff8b9c; border:1px solid rgba(255,95,115,.55);
  background:linear-gradient(135deg, rgba(255,80,100,.16), rgba(190,40,70,.16));
  box-shadow:0 4px 12px rgba(120,30,45,.28), inset 0 1px 0 rgba(255,200,205,.12); }
.jr-appr-cancel:hover:not(:disabled){ filter:brightness(1.1); }
.jr-appr-footer { margin-top:14px; text-align:center; color:rgba(165,180,210,.5); font-size:12.5px; }
.jr-appr-footer kbd { display:inline-block; padding:2px 9px; margin:0 3px; border-radius:7px; border:1px solid rgba(160,175,220,.32); background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.02)); box-shadow:inset 0 1px 0 rgba(255,255,255,.12), 0 1px 2px rgba(0,0,0,.35); color:#d3ddf2; font-family:inherit; font-size:12px; font-weight:600; }
.jr-appr-note { margin-top:12px; text-align:center; color:rgba(175,190,220,.55); font-size:12px; }

/* "Sent ✓" success confirmation — top-center, matched to the card's dark-glass look. */
.jr-sent-toast {
  position:fixed; left:50%; transform:translateX(-50%); top:26px; z-index:1250;
  display:flex; align-items:center; gap:12px; padding:13px 20px; border-radius:16px;
  background:linear-gradient(180deg, rgba(20,24,34,.95), rgba(11,13,20,.97));
  border:1px solid rgba(60,220,160,.4); box-shadow:0 20px 50px rgba(0,0,0,.5), 0 0 30px rgba(40,220,150,.18);
  backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px);
  color:#eafaf2; font-family:Inter,"Segoe UI",sans-serif;
  animation:jr-sent-in .3s cubic-bezier(.2,.9,.3,1.12);
}
@keyframes jr-sent-in { from { opacity:0; transform:translateX(-50%) translateY(-14px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
.jr-sent-check { display:grid; place-items:center; width:28px; height:28px; border-radius:50%; background:linear-gradient(135deg,#3dffb0,#16c99a); color:#04170f; font-weight:800; font-size:15px; }
.jr-sent-toast strong { font-size:14px; }
.jr-sent-detail { margin-top:2px; font-size:11.5px; opacity:.65; }
@media (prefers-reduced-motion: reduce) { .jr-approval-dock, .jr-sent-toast { animation:none; } }
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
// Dispatch backend UI actions to the HUD. Shared by the final result AND mid-stream `ui` events
// (the Stage skeleton streamed while a slow panel renders), so both take the exact same path.
function dispatchUiActions(actions: unknown[]) {
  for (const a of (actions as Array<{ type?: string; id?: string; focus?: boolean }>)) {
    if (a?.type === "open-widget" && a.id) {
      document.dispatchEvent(new CustomEvent("jarvis:open-widget", { detail: { id: a.id, focus: !!a.focus } }));
    } else {
      document.dispatchEvent(new CustomEvent("jarvis:ui", { detail: a as JarvisUiAction }));
    }
  }
}

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

// Approval-card icons (inline SVG so they inherit color and need no assets).
const IcoPlane = ({ s = 20 }: { s?: number }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></svg>);
const IcoClose = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>);
const IcoChevron = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>);
const IcoLink = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>);
const IcoExternal = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>);
const IcoPencil = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>);
const IcoXCircle = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></svg>);
const IcoInstagram = () => (<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="2.8" y="2.8" width="18.4" height="18.4" rx="5.4" /><circle cx="12" cy="12" r="4.6" /><circle cx="17.4" cy="6.6" r="1.15" fill="currentColor" stroke="none" /></svg>);
const IcoGlobe = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" /></svg>);

// Which platform an approval targets, for the "To" row icon + label.
function platformOf(commit?: { url?: string; surface?: string; task?: string; intent?: string } | null): { name: string; cls: string; icon: React.ReactNode } {
  const s = `${commit?.url || ""} ${commit?.surface || ""} ${commit?.task || ""} ${commit?.intent || ""}`.toLowerCase();
  if (/instagram|insta\b/.test(s)) return { name: "Instagram", cls: "jr-appr-ig", icon: <IcoInstagram /> };
  return { name: "Web", cls: "jr-appr-globe", icon: <IcoGlobe /> };
}

function shortUrl(u?: string): string {
  return String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

// Pull the actual message the owner wants to send out of their instruction so the approval card can
// show it in a quote bubble — "text tg saying wasgud" -> "wasgud". Best-effort; returns null when the
// instruction isn't a "say X" form, in which case the card falls back to showing the instruction.
function extractMessageBody(task?: string): string | null {
  const t = String(task || "").trim();
  if (!t) return null;
  const m = t.match(/\b(?:saying|that says|says|message[:,]?|telling (?:\w+ )?|reply(?:ing)?[:,]?|text(?:ing)?[:,]?|write[:,]?|wrote[:,]?)\s+["']?(.+?)["']?\s*$/i);
  const body = m?.[1]?.trim();
  if (!body || body.length < 1 || body.length > 600) return null;
  // Guard against grabbing the whole instruction when there was no real "say X" split.
  if (body.length >= t.length - 2) return null;
  return body;
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
  // Success confirmation after an approved action (e.g. a sent DM). Auto-dismisses; a "✓ Sent" the
  // owner cannot miss, so approving no longer feels like nothing happened.
  const [sentToast, setSentToast] = useState<{ title: string; detail?: string } | null>(null);
  const sentToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // (Calendar opens as a real strip widget — see WidgetStrip's "calendar" case — so no separate
  // Stage render here; that would double-open. The widget fetches /api/stage/calendar itself.)

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

    // RW0 — the deterministic front-end pre-routes for calendar / email / inbox / capture were REMOVED.
    // They bypassed the brain AND the conversation recorder, so turns weren't saved, there was no
    // history, and short follow-ups ("yes", "send it now", "it") hallucinated (wrong recipient, made-up
    // email, phantom files). Everything now goes to the brain below, which records the turn, loads the
    // full history, and uses the real typed tools (atlas_today / atlas_add_* / calendar_* / email).
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
      // W1/W2 awareness: tell the brain which widgets are on screen right now (so it can answer
      // "what's open?", close/arrange them) AND which one is focused/in front — so "move it",
      // "expand this", "switch to markets" resolve to the widget the owner is actually looking at,
      // not a stale one mentioned earlier in chat.
      let openWidgets: { id: string; mode: string }[] = [];
      let focusedWidget = "";
      try {
        const spatial = JSON.parse(localStorage.getItem("jarvis.spatial-widgets.v1") || "{}");
        const all = Object.values(spatial) as any[];
        openWidgets = all.map((w) => ({ id: String(w.id), mode: String(w.mode || "normal") }));
        const front = all.filter((w) => w.mode !== "minimized").sort((a, b) => (b.z || 0) - (a.z || 0))[0];
        focusedWidget = front ? String(front.id) : "";
      } catch { /* no workspace yet */ }
      const result = await streamPost<BrainResponse>(
        "/api/chat/stream",
        { prompt: text, mode: primaryInline ? "vision" : "command", model, strength, deepResearch: research === "deep", imageData: primaryInline?.dataUrl, attachments: remainingAttachments, clientContext: CLIENT_CONTEXT, openWidgets, focusedWidget },
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
        }].slice(-18)),
        // Mid-stream UI actions (e.g. the Stage skeleton shown while a slow panel renders).
        (uiActions) => dispatchUiActions(uiActions)
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
      if (Array.isArray(r?.uiActions)) dispatchUiActions(r.uiActions);
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
        ? result?.result ?? result?.message ?? "Done."
        : result?.message ?? "Cancelled.";
      // Never dump a raw JSON object into the conversation — surface a human sentence. On a successful
      // approve, also raise a "✓ Sent"/"✓ Done" toast so approving no longer feels like nothing happened.
      const rendered = typeof outcome === "string" ? outcome
        : (outcome?.message || outcome?.summary || "Done.");
      setResponse((current) => `${current}${current ? "\n\n" : ""}${rendered}`);
      if (decision === "approve") {
        const recipient = approval.commit?.recipient?.text;
        const isMessage = /send|message|dm|reply|text|email|post|comment/i.test(String(approval.commit?.intent || approval.commit?.task || approval.tool || ""));
        setSentToast({
          title: isMessage ? (recipient ? `Sent to ${recipient}` : "Sent") : "Done",
          detail: isMessage ? undefined : (typeof rendered === "string" ? rendered.slice(0, 90) : undefined),
        });
        if (sentToastTimer.current) clearTimeout(sentToastTimer.current);
        sentToastTimer.current = setTimeout(() => setSentToast(null), 5000);
      }
    } catch (error) {
      setResponse((current) => `${current}${current ? "\n\n" : ""}Approval failed: ${error instanceof Error ? error.message : String(error)}`);
      setHasError(true);
    } finally {
      setApprovalBusy(null);
    }
  }, []);
  // Kept current so a spoken "confirm" in handleSubmit runs this exact function, not a copy of it.
  decideApprovalRef.current = decideApproval;

  // "or press Enter to confirm" — honor it when exactly one action is pending and the owner isn't
  // typing (Enter in the command bar still submits a message; that guard keeps both behaviours).
  useEffect(() => {
    if (approvals.length !== 1) return;
    const only = approvals[0];
    if (!only.ownerChallenge || approvalBusy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
      e.preventDefault();
      void decideApproval(only, "approve");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approvals, approvalBusy, decideApproval]);

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
              <JarvisMarkdown text={response} />
              {streaming && <span className="jr-cursor" />}
            </div>
          )}
          {streaming && activityEvents.length > 0 ? (
            <div className="jr-activity-rail" aria-label="JARVIS activity">
              {activityEvents.slice(-7).map((event) => (
                <div className="jr-activity-row" data-status={event.status} key={event.id}>
                  <span className="jr-activity-dot" /><strong>{event.label}</strong><span>{event.detail || event.kind}</span>
                </div>
              ))}
            </div>
          ) : null}
          {!streaming && !hasError && ((meta.sources && meta.sources.length > 0) || (meta.artifacts && meta.artifacts.length > 0)) ? (
            <div className="jr-meta" style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 11 }}>
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
          {(meta.cards || []).length ? <div className="jr-cards">{meta.cards!.map((card, index) => (
            card.kind === "contact-choice" && card.candidates?.length
              ? <ContactChoiceCard key={`contact-${index}`} card={card} onChoose={chooseContact} />
              : <div className="jr-card" key={`${card.title}-${index}`}><div className="jr-card-title">{card.title}{card.value ? ` · ${card.value}` : ""}</div>{card.body ? <div className="jr-card-body">{card.body}</div> : null}{card.items?.length ? <div className="jr-card-body">{card.items.map((item) => <div key={item}>• {item}</div>)}</div> : null}</div>
          ))}</div> : null}
          {meta.receipt || meta.timing ? <details className="jr-trace"><summary>Technical trace</summary><pre className="jr-card-body">{JSON.stringify({ receipt: meta.receipt, timing: meta.timing, usage: meta.usage }, null, 2)}</pre></details> : null}
          {/* Approvals no longer render buried at the bottom of this scrolling panel — they are a
              fixed, un-missable floating dock rendered below (see jr-approval-dock). */}
        </div>
      </div>

      {approvals.length > 0 ? (
        <div className="jr-approval-dock" aria-label="Actions awaiting owner approval" role="alertdialog" aria-modal="false">
          {approvals.map((approval) => {
            const commit = approval.commit;
            const summary = commit ? "" : Object.entries(approval.summary || {}).map(([key, value]) => `${key}: ${String(value)}`).join("\n");
            const ownerReady = Boolean(approval.ownerChallenge);
            const busy = approvalBusy === approval.id;
            const messageBody = extractMessageBody(commit?.task);
            const isMessage = /send|message|dm|reply|text|email|post|comment/i.test(String(commit?.intent || commit?.task || approval.tool || ""));
            const plat = platformOf(commit);
            const url = commit?.url || commit?.surface || "";
            return (
              <div className="jr-approval" key={approval.id}>
                <div className="jr-appr-header">
                  <span className="jr-appr-badge"><IcoPlane s={20} /></span>
                  <div className="jr-appr-titles">
                    <div className="jr-appr-title">{isMessage ? "Approve to send" : "Approve to continue"}</div>
                    <div className="jr-appr-sub">{isMessage ? "Review your message before it’s sent" : "Review this action before JARVIS runs it"}</div>
                  </div>
                  <button className="jr-appr-close" title="Cancel" disabled={!ownerReady || busy} onClick={() => decideApproval(approval, "deny")}><IcoClose /></button>
                </div>
                <div className="jr-appr-divider" />

                {commit && (commit.recipient || isMessage) ? (
                  <>
                    <div className="jr-appr-label">To</div>
                    <div className="jr-appr-field jr-appr-to">
                      <span className={plat.cls}>{plat.icon}</span>
                      <div className="jr-appr-to-text">
                        <div className="jr-appr-handle">{commit.recipient?.text || plat.name}</div>
                        <div className="jr-appr-platform">{plat.name}{commit.recipient && !commit.recipient.confirmed ? <span className="jr-appr-unconf"> · unconfirmed</span> : null}</div>
                      </div>
                      <span className="jr-appr-chevron"><IcoChevron /></span>
                    </div>
                  </>
                ) : null}

                {messageBody ? (
                  <>
                    <div className="jr-appr-label">Message preview</div>
                    <div className="jr-appr-field jr-appr-msg">
                      <div className="jr-appr-msg-text">{messageBody}</div>
                      <div className="jr-appr-msg-meta"><span>{messageBody.length} / 2200</span><span className="jr-appr-ic" style={{ color: "rgba(165,180,210,.5)" }}><IcoPencil /></span></div>
                    </div>
                  </>
                ) : (
                  <div className="jr-appr-intent" style={{ marginTop: 14 }}>{commit ? (commit.task || commit.intent) : approval.tool.replace(/_/g, " ")}</div>
                )}

                {url ? (
                  <div className="jr-appr-field jr-appr-url">
                    <span className="jr-appr-ic"><IcoLink /></span>
                    <span className="jr-appr-url-text">{shortUrl(url)}</span>
                    <span className="jr-appr-ic"><IcoExternal /></span>
                  </div>
                ) : null}
                {commit?.unlabelled ? <div className="jr-appr-caveat">That control has no name on the page — identified by role and position.</div> : null}
                {!commit && summary ? <div className="jr-appr-note" style={{ textAlign: "left", whiteSpace: "pre-wrap" }}>{summary}</div> : null}

                <div className="jr-appr-actions">
                  <button className="jr-appr-btn jr-appr-send" disabled={!ownerReady || busy} onClick={() => decideApproval(approval, "approve")}>
                    {busy ? "Sending…" : <><IcoPlane s={18} />{isMessage ? "Send it" : "Approve"}</>}
                  </button>
                  <button className="jr-appr-btn jr-appr-cancel" disabled={!ownerReady || busy} onClick={() => decideApproval(approval, "deny")}>
                    <IcoXCircle />Cancel
                  </button>
                </div>
                {!busy && ownerReady && approvals.length === 1 ? <div className="jr-appr-footer">or press <kbd>Enter</kbd> to confirm</div> : null}
                {!ownerReady ? <div className="jr-appr-note">Open JARVIS on the owner computer to decide this.</div> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {sentToast ? <div className="jr-sent-toast" role="status">
        <span className="jr-sent-check">✓</span>
        <div><strong>{sentToast.title}</strong>{sentToast.detail ? <div className="jr-sent-detail">{sentToast.detail}</div> : null}</div>
      </div> : null}

      {toastArtifact ? <div className="jr-toast" role="status">
        <strong>JARVIS created {toastArtifact.title || toastArtifact.name || "an artifact"}</strong>
        <div style={{ marginTop: 4, fontSize: 11, opacity: .65 }}>{fileSize(toastArtifact.bytes)} · {toastArtifact.status || "ready"}</div>
        <a href={toastArtifact.downloadUrl || `/api/files/${encodeURIComponent(toastArtifact.name || toastArtifact.filename || toastArtifact.title || "artifact")}`} download>Download</a>
        <button className="jr-dismiss" onClick={() => setToastArtifact(null)} title="Dismiss artifact notification">×</button>
      </div> : null}

      <WidgetStrip mode="main" showChips={false} />
      <StageSurface />
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
