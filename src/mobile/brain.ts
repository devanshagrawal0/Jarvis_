import { api, streamPost } from "../api";
import type { BrainResponse, JarvisActivityEvent, JarvisUiAction } from "../types";

// One client for the phone. Same brain, same route, same session cookie as the desktop
// (`POST /api/chat/stream`, ndjson `event|delta|progress|ui|done`). Nothing here decides intent —
// the brain does; this file only carries text in and renders what comes back.

export type Strength = "cost-guarded" | "balanced" | "full";
export const STRENGTH_LABEL: Record<Strength, string> = { "cost-guarded": "Eco", balanced: "Balanced", full: "Max" };

export type Turn = {
  id: string;
  role: "user" | "model";
  text: string;
  at: string;
  streaming?: boolean;
  error?: string;
  image?: string;
  files?: string[];
  result?: BrainResponse;
  uiActions?: JarvisUiAction[];
  activity?: JarvisActivityEvent[];
  phase?: string;
};

export type Profile = {
  available: boolean;
  identity?: { preferred_name?: string | null; legal_name?: string | null } | null;
  location?: { resolved?: { placeName?: string; ianaTz?: string; source?: string; travelling?: boolean }; home?: { label?: string; address?: string } | null };
  cost?: { today?: { cost?: number; calls?: number }; month?: { cost?: number } } | null;
};

export type Health = { ok: boolean; startedAt?: string; providers?: Record<string, { connected?: boolean; label?: string }> };

type ClientContext = { timezone?: string; lat?: number; lon?: number; source?: string };
let clientContext: ClientContext = {};
try { clientContext = JSON.parse(localStorage.getItem("jarvis.mobile.clientContext") || "{}"); } catch { /* fresh */ }

export async function resolveClientContext(): Promise<ClientContext> {
  try { clientContext = { ...clientContext, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }; } catch { /* keep */ }
  if (navigator.geolocation) {
    try {
      const pos = await new Promise<GeolocationPosition>((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { timeout: 7000, maximumAge: 15 * 60 * 1000, enableHighAccuracy: false }));
      clientContext = { ...clientContext, lat: pos.coords.latitude, lon: pos.coords.longitude, source: "geolocation" };
    } catch { /* denied or slow — timezone still travels */ }
  }
  try { localStorage.setItem("jarvis.mobile.clientContext", JSON.stringify(clientContext)); } catch { /* ignore */ }
  return clientContext;
}

// GET first so the server stamps the `jarvis_session` cookie; mutation requests without it 403.
export async function bootSession(): Promise<Health | null> { try { return await api<Health>("/api/health"); } catch { return null; } }
export async function fetchProfile(): Promise<Profile | null> { try { return await api<Profile>("/api/profile"); } catch { return null; } }

export type PreparedFile = { name: string; mimeType: string; bytes: number; text?: string; dataUrl?: string };

export async function prepareFiles(files: File[]): Promise<PreparedFile[]> {
  const selected = files.slice(0, 5);
  if (selected.reduce((sum, f) => sum + f.size, 0) > 8 * 1024 * 1024) throw new Error("Attachments must be under 8 MB combined.");
  return Promise.all(selected.map(async (file) => {
    const textLike = file.type.startsWith("text/") || /\.(txt|csv|md|json|log|js|ts|tsx|py|html|xml|ya?ml|ini|cfg)$/i.test(file.name);
    if (textLike) return { name: file.name, mimeType: file.type || "text/plain", bytes: file.size, text: (await file.text()).slice(0, 60000) };
    const dataUrl = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result || "")); r.onerror = () => no(r.error || new Error("Could not read file")); r.readAsDataURL(file); });
    return { name: file.name, mimeType: file.type || "application/octet-stream", bytes: file.size, dataUrl };
  }));
}

export type StreamHandlers = {
  onDelta: (text: string) => void;
  onPhase: (phase: string, message: string) => void;
  onEvent: (event: JarvisActivityEvent) => void;
  onUi: (actions: JarvisUiAction[]) => void;
};

export async function askJarvis(prompt: string, history: Turn[], opts: { strength: Strength; deepResearch: boolean; files: PreparedFile[] }, h: StreamHandlers): Promise<BrainResponse> {
  const inline = opts.files.find((f) => f.dataUrl && f.mimeType.startsWith("image/"));
  const attachments = opts.files.filter((f) => f !== inline);
  const body = {
    prompt, mode: inline ? "vision" : "command", strength: opts.strength, deepResearch: opts.deepResearch,
    imageData: inline?.dataUrl, attachments, clientContext, surface: "phone",
    history: history.slice(-16).map((t) => ({ role: t.role, text: t.text })),
  };
  return streamPost<BrainResponse>("/api/chat/stream", body, h.onDelta, h.onPhase,
    (event, envelope) => h.onEvent({ id: `${String(envelope.turnId || "turn")}-${String(envelope.sequence || 0)}`, kind: String(event.kind || "run"), status: String(event.status || "running"), label: String(event.label || "Activity"), detail: event.detail ? String(event.detail) : undefined, tool: event.tool ? String(event.tool) : undefined, sequence: Number(envelope.sequence || 0) }),
    (actions) => h.onUi(actions as JarvisUiAction[]));
}

const THREAD_KEY = "jarvis.mobile.thread.v2";
export function loadThread(): Turn[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(THREAD_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map((t: Turn) => ({ ...t, streaming: false, phase: undefined })).slice(-60) : [];
  } catch { return []; }
}
export function saveThread(turns: Turn[]) {
  try { localStorage.setItem(THREAD_KEY, JSON.stringify(turns.slice(-60).map((t) => ({ ...t, image: t.image && t.image.length > 200_000 ? undefined : t.image, activity: undefined })))); } catch { /* full or private */ }
}
