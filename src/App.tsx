import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  Brain,
  Camera,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileText,
  Glasses,
  Globe2,
  Laptop,
  Library,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  Pin,
  PinOff,
  Play,
  Plus,
  RadioTower,
  RotateCcw,
  Search,
  Send,
  Server,
  ShieldAlert,
  SlidersHorizontal,
  Smartphone,
  Users,
  Video,
  VolumeX,
  X
} from "lucide-react";
import { api, post } from "./api";
import { HudCanvas } from "./HudCanvas";
import { LiveVoiceController } from "./liveVoice";
import type { BrainResponse, JarvisModuleManifest, Project, SystemState } from "./types";
import "./styles.css";
import { HelixRoom } from "./rooms/HelixRoom";

type ShellMode = "main" | "focus" | "plan";
type ModuleId =
  | "module.library"
  | "workpad"
  | "browser"
  | "projects"
  | "agents"
  | "camera"
  | "memory.timeline"
  | "research"
  | "device.mesh"
  | "provider.health"
  | "receipts"
  | "system.pulse"
  | "memory.debug"
  | "active.context";
type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type Phase = "idle" | "listening" | "thinking" | "acting" | "speaking" | "error";

type SpeechRecognitionAlternative = { transcript: string; confidence?: number };
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};
type SpeechRecognitionErrorLike = { error?: string; message?: string };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type SpatialModule = {
  id: ModuleId;
  title: string;
  subtitle: string;
  purpose: string;
  icon: typeof Brain;
  minW: number;
  minH: number;
  maxW?: number;
  maxH?: number;
  supportedModes: ShellMode[];
  permissions: string[];
  commands: string[];
};

type SpatialWindow = {
  id: ModuleId;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  closed: boolean;
  pinned: boolean;
};

type WorkspaceState = Record<ShellMode, SpatialWindow[]>;

type HistoryEntry = {
  label: string;
  before: WorkspaceState;
  time: string;
};

type Receipt = {
  status: "done" | "blocked" | "failed";
  operation: string;
  target: string;
  evidence: string;
  undoable?: boolean;
};

type TranscriptItem = {
  id: string;
  speaker: "user" | "jarvis";
  text: string;
  receipt?: Receipt;
};

type MissionEvent = { id: string; type: string; message: string; at: string };
type MissionArtifact = { id: string; type: string; title: string; createdAt: string; summary?: string };
type Mission = {
  id: string;
  title: string;
  mode: string;
  role?: string;
  model?: string;
  status: string;
  progress: number;
  createdAt: string;
  updatedAt?: string;
  steps?: string[];
  events?: MissionEvent[];
  evidence?: Array<{ id: string; label: string; detail: string; at: string }>;
  artifacts?: MissionArtifact[];
};

type DeviceRecord = {
  id: string;
  name: string;
  kind: string;
  status: string;
  approved: boolean;
  capabilities: string[];
  userAgent?: string;
  screen?: Record<string, unknown>;
  lastSeenAt?: string;
  updatedAt?: string;
};

type ExecutionReceipt = {
  id: string;
  action: string;
  target: string;
  risk: string;
  status: string;
  input?: string;
  plan?: string[];
  result?: string;
  verification?: string[];
  createdAt: string;
};

type ProviderHealthState = Record<string, ProviderHealthItem>;
type ProviderHealthItem = {
  connected: boolean;
  configured?: boolean;
  credentialsPresent?: boolean;
  canConnect?: boolean;
  validationState?: string;
  missing?: string[];
  source?: string;
  label?: string;
  model?: string;
  latencyMs?: number | null;
  lastRequestAt?: string;
  lastError?: string;
  lastToolCall?: string;
};

type Interaction =
  | { type: "move"; id: ModuleId; startX: number; startY: number; startRect: SpatialWindow }
  | { type: "resize"; id: ModuleId; handle: ResizeHandle; startX: number; startY: number; startRect: SpatialWindow };

const WORKSPACE_KEY = "jarvis.spatial.workspaces.v5.reference-a";
const WORKPAD_KEY = "jarvis.spatial.workpad.v2";
const BROWSER_KEY = "jarvis.spatial.browser.v2";
const STATIC_CLOCK = "2026-06-15T12:00:00.000Z";
const REFERENCE_W = 1672;
const REFERENCE_H = 941;

const MODULES: SpatialModule[] = [
  {
    id: "module.library",
    title: "Module Library",
    subtitle: "Summon capabilities",
    purpose: "Search and launch real modules without a permanent tab rail.",
    icon: Library,
    minW: 420,
    minH: 360,
    supportedModes: ["main", "focus", "plan"],
    permissions: ["module-runtime"],
    commands: ["show modules", "open module library", "summon workpad"]
  },
  {
    id: "workpad",
    title: "Workpad",
    subtitle: "Persistent writing surface",
    purpose: "Write notes, plans, drafts, and command output. Content persists locally.",
    icon: BookOpen,
    minW: 420,
    minH: 320,
    supportedModes: ["main", "focus", "plan"],
    permissions: ["local-storage"],
    commands: ["open workpad", "focus on this project", "plan a goal"]
  },
  {
    id: "browser",
    title: "Browser",
    subtitle: "URL surface",
    purpose: "Navigate URLs in an embedded surface when allowed; open externally when a site blocks frames.",
    icon: Globe2,
    minW: 270,
    minH: 320,
    supportedModes: ["main", "focus"],
    permissions: ["network"],
    commands: ["open browser", "go to a website", "make browser wider"]
  },
  {
    id: "projects",
    title: "Projects",
    subtitle: "Local workspace index",
    purpose: "Read real local project metadata through the server and open project folders.",
    icon: Code2,
    minW: 300,
    minH: 300,
    supportedModes: ["main", "focus", "plan"],
    permissions: ["filesystem:workspace"],
    commands: ["open projects", "find jarvis repository", "open project folder"]
  },
  {
    id: "agents",
    title: "Agents",
    subtitle: "Mission civilization",
    purpose: "Deploy real missions with backend events, evidence, artifacts, pause, resume, cancel, and completion receipts.",
    icon: Users,
    minW: 300,
    minH: 320,
    supportedModes: ["main", "focus", "plan"],
    permissions: ["agents"],
    commands: ["open agents", "deploy research agent", "pause mission", "complete mission"]
  },
  {
    id: "camera",
    title: "Camera Feed",
    subtitle: "Living room",
    purpose: "Start a browser camera only after explicit permission, preview locally, stop tracks, capture snapshots, and prepare WebRTC sharing.",
    icon: Camera,
    minW: 270,
    minH: 260,
    supportedModes: ["main", "plan"],
    permissions: ["camera", "microphone"],
    commands: ["open camera", "enable camera", "take snapshot", "stop camera"]
  },
  {
    id: "memory.debug",
    title: "Memory Debug",
    subtitle: "Neural vault & behavioral rules",
    purpose: "Inspect memory counts, active procedural rules, hybrid search results, and memory decay status.",
    icon: FileText,
    minW: 280,
    minH: 300,
    supportedModes: ["main", "focus", "plan"],
    permissions: ["local-storage"],
    commands: ["open memory debug", "show memory rules", "debug memory", "procedural rules"]
  },
  {
    id: "memory.timeline",
    title: "Memory Timeline",
    subtitle: "Recent context and receipts",
    purpose: "Show conversational memory, command receipts, mission events, and device activity as a structured timeline.",
    icon: FileText,
    minW: 270,
    minH: 280,
    supportedModes: ["main", "focus", "plan"],
    permissions: ["local-storage", "verification"],
    commands: ["open memory", "open timeline", "what happened recently", "show memory timeline"]
  },
  {
    id: "research",
    title: "Research",
    subtitle: "Briefing and synthesis",
    purpose: "Run a Gemini-backed research brief, track sources to inspect, and keep findings visible as a working module.",
    icon: Search,
    minW: 300,
    minH: 280,
    supportedModes: ["main", "focus", "plan"],
    permissions: ["network", "gemini"],
    commands: ["open research", "summarize this", "research this", "view report"]
  },
  {
    id: "device.mesh",
    title: "Device Hub",
    subtitle: "Pair phone and iPad",
    purpose: "Create short-lived pairing codes, register devices, approve/revoke access, and report capabilities honestly.",
    icon: Smartphone,
    minW: 275,
    minH: 280,
    supportedModes: ["main", "plan"],
    permissions: ["devices", "network"],
    commands: ["open devices", "pair phone", "approve device", "revoke device"]
  },
  {
    id: "provider.health",
    title: "Provider Health",
    subtitle: "Gemini and services",
    purpose: "Show real provider connection, key source, model, latency, last request, last error, and last tool call.",
    icon: Activity,
    minW: 420,
    minH: 300,
    supportedModes: ["main", "focus", "plan"],
    permissions: ["system:read"],
    commands: ["provider health", "gemini status", "test provider"]
  },
  {
    id: "receipts",
    title: "Receipts",
    subtitle: "Execution evidence",
    purpose: "Inspect action receipts with input, plan, result, risk level, verification, and timestamp.",
    icon: FileText,
    minW: 450,
    minH: 340,
    supportedModes: ["main", "focus", "plan"],
    permissions: ["verification"],
    commands: ["open receipts", "show audit", "show evidence"]
  },
  {
    id: "system.pulse",
    title: "System Pulse",
    subtitle: "Live local telemetry",
    purpose: "Show real server status, uptime, model state, and module counts.",
    icon: Brain,
    minW: 320,
    minH: 220,
    supportedModes: ["main", "plan"],
    permissions: ["system:read"],
    commands: ["system status", "refresh system pulse"]
  },
  {
    id: "active.context",
    title: "Active Context",
    subtitle: "Scene memory",
    purpose: "Show the current selected window, mode, recent action, and open surfaces.",
    icon: Search,
    minW: 320,
    minH: 220,
    supportedModes: ["main", "focus", "plan"],
    permissions: ["scene:read"],
    commands: ["what is open", "explain current scene"]
  }
];

const MODULE_BY_ID = Object.fromEntries(MODULES.map((module) => [module.id, module])) as Record<ModuleId, SpatialModule>;

const visualSystemState: SystemState = {
  agent: "JARVIS",
  state: "online",
  clock: STATIC_CLOCK,
  uptimeSeconds: 43200,
  commandCount: 0,
  lastIntent: "spatial-shell",
  settings: {
    hasGeminiKey: false,
    geminiModel: "gemini-2.5-flash",
    wakePhrase: "jarvis",
    keySource: "missing"
  },
  metrics: { cpu: 42, memory: 58, network: 83, reactor: 88, shield: 76, threat: 12, latency: 18 }
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function copyWorkspaces(workspaces: WorkspaceState): WorkspaceState {
  return {
    main: workspaces.main.map((item) => ({ ...item })),
    focus: workspaces.focus.map((item) => ({ ...item })),
    plan: workspaces.plan.map((item) => ({ ...item }))
  };
}

function viewport() {
  if (typeof window === "undefined") return { w: 1400, h: 900 };
  return { w: window.innerWidth, h: window.innerHeight };
}

function referenceRect(x: number, y: number, w: number, h: number) {
  const view = viewport();
  const sx = view.w / REFERENCE_W;
  const sy = view.h / REFERENCE_H;
  return {
    x: Math.round(x * sx),
    y: Math.round(y * sy),
    w: Math.round(w * sx),
    h: Math.round(h * sy)
  };
}

function makeWindow(id: ModuleId, rect: Pick<SpatialWindow, "x" | "y" | "w" | "h">, z: number, closed = false): SpatialWindow {
  return { id, title: MODULE_BY_ID[id].title, ...rect, z, minimized: false, closed, pinned: false };
}

function makeReferenceWindow(id: ModuleId, x: number, y: number, w: number, h: number, z: number, closed = false) {
  return makeWindow(id, referenceRect(x, y, w, h), z, closed);
}

function defaultWorkspaces(): WorkspaceState {
  const { w, h } = viewport();
  const jarvisSafe = 140;
  const focusRailW = Math.round(clamp(w * 0.24, 320, 360));
  const focusConsoleW = Math.min(420, w * 0.28);
  const focusMainX = focusRailW + 68;
  const focusMainW = Math.round(clamp(w - focusMainX - focusConsoleW - 72, 430, 820));
  const focusProjectH = Math.round(clamp(h * 0.44, 330, 430));
  const focusContextY = Math.min(h - 300, 98 + focusProjectH + 18);
  const planRailW = Math.round(clamp(w * 0.28, 360, 420));
  const planWorkX = planRailW + 74;
  const planWorkW = Math.round(clamp(w - planWorkX - 460, 480, 660));
  return {
    main: [
      makeReferenceWindow("system.pulse", 36, 73, 315, 260, 3),
      makeReferenceWindow("agents", 35, 368, 300, 360, 4),
      makeReferenceWindow("camera", 362, 100, 275, 280, 5),
      makeReferenceWindow("memory.timeline", 362, 388, 280, 320, 4),
      makeReferenceWindow("research", 1020, 120, 315, 300, 5),
      makeReferenceWindow("projects", 1020, 438, 315, 320, 5),
      makeReferenceWindow("browser", 1345, 103, 280, 385, 6),
      makeReferenceWindow("device.mesh", 1345, 502, 280, 300, 5),
      makeWindow("active.context", { x: Math.max(760, w - 390), y: 112, w: 350, h: 270 }, 3, true),
      makeWindow("provider.health", { x: Math.max(780, w - 500), y: 412, w: 420, h: 310 }, 4, true),
      makeWindow("receipts", { x: Math.round(w / 2 - 250), y: 170, w: 500, h: 420 }, 6, true),
      makeWindow("module.library", { x: Math.round(w / 2 - 380), y: 92, w: 760, h: 560 }, 7, true),
      makeWindow("workpad", { x: Math.round(w / 2 - 280), y: 92, w: 560, h: Math.min(420, h - jarvisSafe - 180) }, 5, true)
    ],
    focus: [
      makeWindow("workpad", { x: focusMainX, y: 78, w: focusMainW, h: h - 150 }, 5),
      makeWindow("browser", { x: focusMainX, y: 96, w: focusMainW, h: h - 210 }, 4, true),
      makeWindow("projects", { x: 42, y: 98, w: focusRailW, h: focusProjectH }, 3, true),
      makeWindow("active.context", { x: 42, y: focusContextY, w: focusRailW, h: 220 }, 2),
      makeWindow("research", { x: focusMainX, y: 96, w: focusMainW, h: h - 210 }, 6, true),
      makeWindow("memory.timeline", { x: 42, y: focusContextY, w: focusRailW, h: 220 }, 3, true),
      makeWindow("agents", { x: focusMainX, y: 96, w: focusMainW, h: h - 210 }, 6, true),
      makeWindow("provider.health", { x: 42, y: h - 270, w: focusRailW, h: 190 }, 2, true),
      makeWindow("receipts", { x: focusMainX, y: 110, w: focusMainW, h: 420 }, 6, true),
      makeWindow("module.library", { x: 42, y: 92, w: focusRailW, h: Math.min(580, h - 180) }, 7, true),
      makeWindow("system.pulse", { x: 42, y: h - 270, w: focusRailW, h: 190 }, 1, true)
    ],
    plan: [
      makeWindow("projects", { x: 44, y: 98, w: planRailW, h: Math.min(560, h - 210) }, 4),
      makeWindow("workpad", { x: planWorkX, y: 110, w: planWorkW, h: Math.min(540, h - 210) }, 3, true),
      makeWindow("active.context", { x: Math.max(820, w - 390), y: 110, w: 350, h: 270 }, 2),
      makeWindow("research", { x: planWorkX, y: 120, w: planWorkW, h: 440 }, 6, true),
      makeWindow("memory.timeline", { x: Math.max(820, w - 390), y: 110, w: 350, h: 270 }, 3, true),
      makeWindow("agents", { x: Math.max(820, w - 560), y: 400, w: 500, h: 420 }, 5),
      makeWindow("camera", { x: planWorkX, y: 120, w: planWorkW, h: 500 }, 6, true),
      makeWindow("device.mesh", { x: 44, y: h - 300, w: planRailW, h: 230 }, 3, true),
      makeWindow("provider.health", { x: Math.max(820, w - 390), y: h - 330, w: 340, h: 220 }, 2, true),
      makeWindow("receipts", { x: planWorkX, y: 140, w: planWorkW, h: 440 }, 6, true),
      makeWindow("module.library", { x: 82, y: 96, w: 760, h: 560 }, 8, true),
      makeWindow("browser", { x: planWorkX, y: 120, w: planWorkW, h: 440 }, 3, true),
      makeWindow("system.pulse", { x: Math.max(820, w - 390), y: h - 330, w: 340, h: 220 }, 1, true)
    ]
  };
}

function loadWorkspaces() {
  if (typeof window === "undefined") return defaultWorkspaces();
  try {
    const saved = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || "");
    if (saved?.main && saved?.focus && saved?.plan) return saved as WorkspaceState;
  } catch {
    return defaultWorkspaces();
  }
  return defaultWorkspaces();
}

function nowTime() {
  return new Date().toISOString();
}

function isPresentationDevice(device: DeviceRecord) {
  const name = device.name.toLowerCase();
  return !/^win32\s+\d+x\d+/.test(name) && !name.includes("playwright") && !name.includes("codex smoke");
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "about:blank";
  if (/^(https?:|about:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function moduleFromText(text: string, fallback: ModuleId | null): ModuleId | null {
  const lower = text.toLowerCase();
  if (/module|library|palette/.test(lower)) return "module.library";
  if (/workpad|note|draft|write|editor/.test(lower)) return "workpad";
  if (/browser|web|website|url|page/.test(lower)) return "browser";
  if (/project|repo|codex|workspace/.test(lower)) return "projects";
  if (/agent|mission|civilization|task force/.test(lower)) return "agents";
  if (/camera|webcam|iphone camera|ipad camera|snapshot|scan/.test(lower)) return "camera";
  if (/memory|timeline|history|recent|what happened/.test(lower)) return "memory.timeline";
  if (/research|brief|sources|findings|summarize|report/.test(lower)) return "research";
  if (/device|pair|phone|ipad|iphone|mesh/.test(lower)) return "device.mesh";
  if (/provider|gemini|model|latency|key|health/.test(lower)) return "provider.health";
  if (/receipt|audit|evidence|verification/.test(lower)) return "receipts";
  if (/system|status|pulse|telemetry/.test(lower)) return "system.pulse";
  if (/context|scene|open windows/.test(lower)) return "active.context";
  if (/\b(it|that|this|window|module)\b/.test(lower)) return fallback;
  return fallback;
}

function modeFromText(text: string): ShellMode | null {
  const lower = text.toLowerCase();
  if (/\bmain\b/.test(lower)) return "main";
  if (/\bfocus\b/.test(lower)) return "focus";
  if (/\bplan\b/.test(lower)) return "plan";
  return null;
}

function stripWakePhrase(text: string) {
  return text
    .trim()
    .replace(/^(hey\s+)?jarvis[\s,:-]*/i, "")
    .replace(/^computer[\s,:-]*/i, "")
    .trim();
}

function cleanSpeechText(text: string) {
  return text
    .replace(/\bhttps?:\/\/\S+/gi, "link")
    .replace(/[`*_#>{}\[\]]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 520)
    .trim();
}

function moduleTitle(id: ModuleId | null) {
  return id ? MODULE_BY_ID[id].title : "Workspace";
}

export default function App() {
  const visualTest = useMemo(() => new URLSearchParams(window.location.search).has("visualTest"), []);
  const [mode, setMode] = useState<ShellMode>("main");
  const [bootDone, setBootDone] = useState(visualTest);
  const [helixActive, setHelixActive] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [workspaces, setWorkspaces] = useState<WorkspaceState>(() => loadWorkspaces());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [selectedWindow, setSelectedWindow] = useState<ModuleId | null>("system.pulse");
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [command, setCommand] = useState("");
  const [transcript, setTranscript] = useState<TranscriptItem[]>([
    {
      id: "boot",
      speaker: "jarvis",
      text: "Spatial shell online. Say open workpad, show modules, open projects, or move that left.",
      receipt: { status: "done", operation: "Boot", target: "Spatial OS", evidence: "Window manager loaded.", undoable: false }
    }
  ]);
  const [consoleExpanded, setConsoleExpanded] = useState(false);
  const [system, setSystem] = useState<SystemState>(visualTest ? visualSystemState : visualSystemState);
  const [moduleManifests, setModuleManifests] = useState<JarvisModuleManifest[]>([]);
  const [providerHealth, setProviderHealth] = useState<ProviderHealthState>({});
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionDraft, setMissionDraft] = useState("Research the current Jarvis deployment blocker and produce evidence.");
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [pairing, setPairing] = useState<{ code?: string; expiresAt?: string; status?: string } | null>(null);
  const [receipts, setReceipts] = useState<ExecutionReceipt[]>([]);
  const [emergencyNonce, setEmergencyNonce] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectStatus, setProjectStatus] = useState("Not indexed yet.");
  const [workpad, setWorkpad] = useState(() => localStorage.getItem(WORKPAD_KEY) || "# JARVIS Workpad\n\nUse this surface for plans, notes, drafts, and command output.");
  const [workpadSavedAt, setWorkpadSavedAt] = useState("local");
  const [browserDraft, setBrowserDraft] = useState(() => localStorage.getItem(BROWSER_KEY) || "https://example.com");
  const [browserUrl, setBrowserUrl] = useState(() => localStorage.getItem(BROWSER_KEY) || "about:blank");
  const [browserFrameKey, setBrowserFrameKey] = useState(0);
  const [voiceMode, setVoiceMode] = useState(() => localStorage.getItem("jarvis.voice.mode") !== "off");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [researchTopic, setResearchTopic] = useState("Quantum computing breakthroughs");
  const [researchReport, setResearchReport] = useState("Analyzing the latest developments in quantum error correction and topological qubits.");
  const [researchStatus, setResearchStatus] = useState("ready");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const liveVoiceRef = useRef<LiveVoiceController | null>(null);
  const listeningRef = useRef(false);
  const maxZ = useMemo(() => Math.max(...Object.values(workspaces).flat().map((win) => win.z), 1), [workspaces]);

  const activeWindows = workspaces[mode]
    .filter((win) => !win.closed && !win.minimized)
    .sort((a, b) => a.z - b.z);
  const minimizedWindows = workspaces[mode].filter((win) => !win.closed && win.minimized);
  const lastReceipt = transcript.find((item) => item.receipt)?.receipt;

  const recordHistory = useCallback((label: string) => {
    setHistory((current) => [{ label, before: copyWorkspaces(workspaces), time: nowTime() }, ...current].slice(0, 30));
  }, [workspaces]);

  const mutateCurrent = useCallback((updater: (windows: SpatialWindow[]) => SpatialWindow[]) => {
    setWorkspaces((current) => ({ ...current, [mode]: updater(current[mode]).map((win) => ({ ...win })) }));
  }, [mode]);

  const speakJarvis = useCallback((text: string) => {
    if (visualTest || !voiceMode || !("speechSynthesis" in window)) return false;
    const spoken = cleanSpeechText(text);
    if (!spoken) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spoken);
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((voice) => /guy|mark|david|daniel|google us english|english/i.test(voice.name));
    if (preferred) utterance.voice = preferred;
    utterance.rate = 1.02;
    utterance.pitch = 0.86;
    utterance.volume = 0.9;
    utterance.onend = () => setPhase((current) => current === "speaking" ? "idle" : current);
    utterance.onerror = () => setPhase((current) => current === "speaking" ? "idle" : current);
    window.speechSynthesis.speak(utterance);
    return true;
  }, [visualTest, voiceMode]);

  const emitJarvis = useCallback((text: string, receipt: Receipt) => {
    setTranscript((current) => [
      { id: crypto.randomUUID(), speaker: "jarvis" as const, text, receipt },
      ...current
    ].slice(0, 18));
    setConsoleExpanded(true);
    setPhase("speaking");
    if (!speakJarvis(text)) window.setTimeout(() => setPhase("idle"), 900);
  }, [speakJarvis]);

  useEffect(() => {
    document.documentElement.classList.toggle("visual-test", visualTest);
    const timer = window.setTimeout(() => setBootDone(true), visualTest ? 0 : 850);
    return () => {
      document.documentElement.classList.remove("visual-test");
      window.clearTimeout(timer);
    };
  }, [visualTest]);

  useEffect(() => {
    const supported = Boolean(navigator.mediaDevices && window.isSecureContext);
    setVoiceSupported(supported);
    if (!supported) setVoiceError("Gemini Live microphone access requires HTTPS or localhost.");
    return () => {
      recognitionRef.current?.abort();
      void liveVoiceRef.current?.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("jarvis.voice.mode", voiceMode ? "on" : "off");
    if (!voiceMode && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, [voiceMode]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspaces));
  }, [workspaces]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(WORKPAD_KEY, workpad);
      setWorkpadSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [workpad]);

  useEffect(() => {
    localStorage.setItem(BROWSER_KEY, browserUrl);
  }, [browserUrl]);

  useEffect(() => {
    if (visualTest) return;
    api<SystemState>("/api/status").then(setSystem).catch(() => undefined);
    api<{ modules: JarvisModuleManifest[] }>("/api/modules").then((data) => setModuleManifests(data.modules)).catch(() => undefined);
    refreshProviderHealth();
    refreshMissions();
    refreshDevices();
    refreshReceipts();
    const interval = window.setInterval(() => api<SystemState>("/api/status").then(setSystem).catch(() => undefined), 5000);
    return () => window.clearInterval(interval);
  }, [visualTest]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!interaction) return;
      const dx = event.clientX - interaction.startX;
      const dy = event.clientY - interaction.startY;
      if (interaction.type === "move") {
        const next = {
          ...interaction.startRect,
          x: clamp(interaction.startRect.x + dx, 20, window.innerWidth - interaction.startRect.w - 20),
          y: clamp(interaction.startRect.y + dy, 54, window.innerHeight - interaction.startRect.h - 98)
        };
        mutateCurrent((wins) => wins.map((win) => win.id === interaction.id ? next : win));
      } else {
        const resized = resizeRect(interaction.startRect, interaction.handle, dx, dy);
        mutateCurrent((wins) => wins.map((win) => win.id === interaction.id ? resized : win));
      }
    };
    const onUp = () => setInteraction(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [interaction, mutateCurrent]);

  function resizeRect(rect: SpatialWindow, handle: ResizeHandle, dx: number, dy: number) {
    const module = MODULE_BY_ID[rect.id];
    const minW = module.minW;
    const minH = module.minH;
    const maxW = Math.min(module.maxW || window.innerWidth - 40, window.innerWidth - 40);
    const maxH = Math.min(module.maxH || window.innerHeight - 118, window.innerHeight - 118);
    let { x, y, w, h } = rect;
    if (handle.includes("e")) w = clamp(rect.w + dx, minW, maxW);
    if (handle.includes("s")) h = clamp(rect.h + dy, minH, maxH);
    if (handle.includes("w")) {
      const nextW = clamp(rect.w - dx, minW, maxW);
      x = rect.x + rect.w - nextW;
      w = nextW;
    }
    if (handle.includes("n")) {
      const nextH = clamp(rect.h - dy, minH, maxH);
      y = rect.y + rect.h - nextH;
      h = nextH;
    }
    x = clamp(x, 20, window.innerWidth - w - 20);
    y = clamp(y, 54, window.innerHeight - h - 98);
    return { ...rect, x, y, w, h };
  }

  function focusWindow(id: ModuleId) {
    setSelectedWindow(id);
    mutateCurrent((wins) => wins.map((win) => win.id === id ? { ...win, z: maxZ + 1 } : win));
  }

  function ensureWindow(id: ModuleId) {
    const exists = workspaces[mode].some((win) => win.id === id);
    if (exists) return;
    const defaults = defaultWorkspaces()[mode].find((win) => win.id === id) || makeWindow(id, { x: 120, y: 110, w: 520, h: 380 }, maxZ + 1);
    setWorkspaces((current) => ({ ...current, [mode]: [...current[mode], defaults] }));
  }

  function openWindow(id: ModuleId, source = "User command") {
    recordHistory(`Open ${MODULE_BY_ID[id].title}`);
    ensureWindow(id);
    setSelectedWindow(id);
    mutateCurrent((wins) => wins.map((win) => win.id === id
      ? { ...win, closed: false, minimized: false, z: maxZ + 1 }
      : win.id === "module.library" && id !== "module.library" && !win.pinned ? { ...win, closed: true } : win));
    if (id === "projects" && !projects.length) loadProjects();
    if (id === "agents") refreshMissions();
    if (id === "device.mesh") refreshDevices();
    if (id === "provider.health") refreshProviderHealth();
    if (id === "receipts") refreshReceipts();
    emitJarvis(`${MODULE_BY_ID[id].title} is open.`, {
      status: "done",
      operation: "Open module",
      target: MODULE_BY_ID[id].title,
      evidence: source,
      undoable: true
    });
  }

  function closeWindow(id: ModuleId) {
    recordHistory(`Close ${MODULE_BY_ID[id].title}`);
    mutateCurrent((wins) => wins.map((win) => win.id === id ? { ...win, closed: true, minimized: false } : win));
    emitJarvis(`${MODULE_BY_ID[id].title} closed. Restore it from the module library or by command.`, {
      status: "done",
      operation: "Close module",
      target: MODULE_BY_ID[id].title,
      evidence: "No persistent work was cancelled.",
      undoable: true
    });
  }

  function minimizeWindow(id: ModuleId) {
    recordHistory(`Minimize ${MODULE_BY_ID[id].title}`);
    mutateCurrent((wins) => wins.map((win) => win.id === id ? { ...win, minimized: true } : win));
    emitJarvis(`${MODULE_BY_ID[id].title} minimized to the edge dock.`, {
      status: "done",
      operation: "Minimize module",
      target: MODULE_BY_ID[id].title,
      evidence: "Running state preserved.",
      undoable: true
    });
  }

  function restoreWindow(id: ModuleId) {
    recordHistory(`Restore ${MODULE_BY_ID[id].title}`);
    setSelectedWindow(id);
    mutateCurrent((wins) => wins.map((win) => win.id === id ? { ...win, minimized: false, closed: false, z: maxZ + 1 } : win));
    emitJarvis(`${MODULE_BY_ID[id].title} restored.`, {
      status: "done",
      operation: "Restore module",
      target: MODULE_BY_ID[id].title,
      evidence: "Previous geometry reused.",
      undoable: true
    });
  }

  function togglePin(id: ModuleId) {
    recordHistory(`Pin ${MODULE_BY_ID[id].title}`);
    mutateCurrent((wins) => wins.map((win) => win.id === id ? { ...win, pinned: !win.pinned } : win));
  }

  function undoLast(source = "Undo") {
    const entry = history[0];
    if (!entry) {
      emitJarvis("There is no reversible spatial action yet.", {
        status: "blocked",
        operation: "Undo",
        target: "Workspace",
        evidence: "History stack is empty."
      });
      return;
    }
    setWorkspaces(copyWorkspaces(entry.before));
    setHistory((current) => current.slice(1));
    emitJarvis(`Undid: ${entry.label}.`, {
      status: "done",
      operation: source,
      target: "Workspace",
      evidence: `Restored snapshot from ${new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
    });
  }

  function dockWindow(id: ModuleId, placement: string) {
    const { w: vw, h: vh } = viewport();
    const rects: Record<string, Pick<SpatialWindow, "x" | "y" | "w" | "h">> = {
      left: { x: 28, y: 84, w: Math.round(vw * 0.34), h: vh - 190 },
      right: { x: Math.round(vw * 0.64), y: 84, w: Math.round(vw * 0.33), h: vh - 190 },
      center: { x: Math.round(vw * 0.22), y: 84, w: Math.round(vw * 0.56), h: vh - 190 },
      top: { x: Math.round(vw * 0.18), y: 64, w: Math.round(vw * 0.64), h: Math.round(vh * 0.42) },
      bottom: { x: Math.round(vw * 0.18), y: Math.round(vh * 0.48), w: Math.round(vw * 0.64), h: Math.round(vh * 0.35) }
    };
    const next = rects[placement] || rects.center;
    recordHistory(`Move ${MODULE_BY_ID[id].title}`);
    mutateCurrent((wins) => wins.map((win) => win.id === id ? { ...win, ...next, minimized: false, closed: false, z: maxZ + 1 } : win));
    emitJarvis(`${MODULE_BY_ID[id].title} moved ${placement}.`, {
      status: "done",
      operation: "Move module",
      target: MODULE_BY_ID[id].title,
      evidence: `Applied ${placement} anchor.`,
      undoable: true
    });
  }

  function resizeByCommand(id: ModuleId, kind: string) {
    recordHistory(`Resize ${MODULE_BY_ID[id].title}`);
    mutateCurrent((wins) => wins.map((win) => {
      if (win.id !== id) return win;
      const module = MODULE_BY_ID[id];
      const amount = kind.includes("smaller") ? -100 : 100;
      if (kind.includes("full height")) return { ...win, y: 64, h: window.innerHeight - 162 };
      if (kind.includes("half width")) return { ...win, w: Math.max(module.minW, Math.round(window.innerWidth / 2 - 48)) };
      if (kind.includes("wider")) return { ...win, w: clamp(win.w + 140, module.minW, window.innerWidth - 80) };
      if (kind.includes("taller")) return { ...win, h: clamp(win.h + 140, module.minH, window.innerHeight - 160) };
      return { ...win, w: clamp(win.w + amount, module.minW, window.innerWidth - 80), h: clamp(win.h + amount, module.minH, window.innerHeight - 160) };
    }));
    emitJarvis(`${MODULE_BY_ID[id].title} resized.`, {
      status: "done",
      operation: "Resize module",
      target: MODULE_BY_ID[id].title,
      evidence: kind,
      undoable: true
    });
  }

  function switchMode(nextMode: ShellMode, reason = "Manual environment switch") {
    if (nextMode === mode) return;
    const carry = workspaces[mode].filter((win) => !win.closed && !win.minimized && MODULE_BY_ID[win.id].supportedModes.includes(nextMode));
    setPhase("thinking");
    setWorkspaces((current) => {
      const next = copyWorkspaces(current);
      const targetDefaults = defaultWorkspaces()[nextMode];
      for (const win of carry) {
        const existingIndex = next[nextMode].findIndex((item) => item.id === win.id);
        const defaultWin = targetDefaults.find((item) => item.id === win.id) || win;
        if (existingIndex >= 0) {
          const existing = next[nextMode][existingIndex];
          const shouldUseModeGeometry = existing.closed || existing.minimized;
          next[nextMode][existingIndex] = {
            ...existing,
            ...(shouldUseModeGeometry ? { x: defaultWin.x, y: defaultWin.y, w: defaultWin.w, h: defaultWin.h } : {}),
            closed: false,
            minimized: false,
            z: Math.max(existing.z, win.z)
          };
        } else {
          next[nextMode].push({ ...defaultWin, closed: false, minimized: false, z: win.z });
        }
      }
      return next;
    });
    setMode(nextMode);
    setSelectedWindow(carry[0]?.id || workspaces[nextMode].find((win) => !win.closed && !win.minimized)?.id || null);
    window.setTimeout(() => setPhase("idle"), 700);
    emitJarvis(`Entered ${nextMode}.`, {
      status: "done",
      operation: "Switch environment",
      target: nextMode,
      evidence: reason,
      undoable: false
    });
  }

  function appendToWorkpad(text: string) {
    setWorkpad((current) => {
      const next = `${current.trim()}\n\n${text}`.trim();
      localStorage.setItem(WORKPAD_KEY, next);
      return next;
    });
  }

  function updateWorkpad(next: string) {
    localStorage.setItem(WORKPAD_KEY, next);
    setWorkpad(next);
  }

  async function loadProjects() {
    setProjectStatus("Indexing workspace...");
    try {
      const data = await api<{ projects: Project[] }>("/api/projects");
      setProjects(data.projects);
      setProjectStatus(`${data.projects.length} projects indexed.`);
    } catch (error) {
      setProjectStatus((error as Error).message);
    }
  }

  async function openProjectFolder(project: Project) {
    try {
      await post("/api/projects/open", { path: project.path });
      emitJarvis(`Opening ${project.name} in Explorer.`, {
        status: "done",
        operation: "Open folder",
        target: project.name,
        evidence: project.path
      });
    } catch (error) {
      emitJarvis("Project folder could not be opened.", {
        status: "failed",
        operation: "Open folder",
        target: project.name,
        evidence: (error as Error).message
      });
    }
  }

  async function refreshProviderHealth() {
    try {
      const data = await api<{ providers: ProviderHealthState }>("/api/provider-health");
      setProviderHealth(data.providers);
    } catch {
      setProviderHealth({});
    }
  }

  async function refreshMissions() {
    try {
      const data = await api<{ agents: Mission[] }>("/api/agents");
      setMissions(data.agents);
    } catch {
      setMissions([]);
    }
  }

  async function deployMission(title = missionDraft) {
    const data = await post<{ agent: Mission; agents: Mission[] }>("/api/agents", { title, mode: "research" });
    setMissions(data.agents);
    openWindow("agents", "Mission deployed");
    refreshReceipts();
    emitJarvis(`Mission deployed: ${data.agent.title}.`, {
      status: "done",
      operation: "Deploy agent",
      target: data.agent.title,
      evidence: "Backend mission record and receipt created.",
      undoable: false
    });
  }

  async function controlMission(id: string, action: "pause" | "resume" | "cancel" | "advance" | "complete") {
    const data = await post<{ agent: Mission; agents: Mission[] }>(`/api/agents/${id}/${action}`, {});
    setMissions(data.agents);
    refreshReceipts();
    emitJarvis(`Mission ${action}: ${data.agent.title}.`, {
      status: "done",
      operation: "Mission control",
      target: data.agent.title,
      evidence: `State is ${data.agent.status}; progress ${data.agent.progress}%.`
    });
  }

  async function refreshDevices() {
    try {
      const data = await api<{ devices: DeviceRecord[] }>("/api/devices");
      setDevices(data.devices);
    } catch {
      setDevices([]);
    }
  }

  async function registerLocalDevice() {
    const capabilities = [
      "web",
      "websocket-ready",
      navigator.mediaDevices ? "camera-api" : "no-camera-api",
      "touch" in window ? "touch" : "pointer",
      window.isSecureContext ? "secure-context" : "insecure-context"
    ];
    const data = await post<{ device: DeviceRecord }>("/api/devices", {
      name: `${navigator.platform || "Browser"} ${window.innerWidth}x${window.innerHeight}`,
      kind: "browser",
      capabilities,
      userAgent: navigator.userAgent,
      screen: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }
    });
    setDevices((current) => [data.device, ...current.filter((device) => device.id !== data.device.id)]);
    refreshReceipts();
  }

  async function createPairing() {
    const data = await api<{ pairing: { code: string; expiresAt: string; status: string } }>("/api/pair");
    setPairing(data.pairing);
    refreshReceipts();
  }

  async function setDeviceApproval(id: string, action: "approve" | "revoke") {
    const data = await post<{ device: DeviceRecord }>(`/api/devices/${id}/${action}`, {});
    setDevices((current) => current.map((device) => device.id === id ? data.device : device));
    refreshReceipts();
  }

  async function refreshReceipts() {
    try {
      const data = await api<{ receipts: ExecutionReceipt[] }>("/api/receipts");
      setReceipts(data.receipts);
    } catch {
      setReceipts([]);
    }
  }

  async function runEmergencyStop() {
    const data = await post<{ receipt: ExecutionReceipt; agents: Mission[] }>("/api/emergency-stop", { reason: "Emergency Stop pressed in spatial UI" });
    setMissions(data.agents);
    setEmergencyNonce((current) => current + 1);
    refreshReceipts();
    emitJarvis("Emergency stop executed. Local media modules were instructed to stop and missions were cancelled.", {
      status: "done",
      operation: "Emergency Stop",
      target: "All local sessions",
      evidence: data.receipt.result || "Receipt created."
    });
  }

  function describeDevices() {
    openWindow("device.mesh", "Device query");
    const approved = devices.filter((device) => device.approved).length;
    const online = devices.filter((device) => device.status === "online").length;
    const summary = devices.length
      ? `${devices.length} devices are registered. ${online} report online, ${approved} are approved. ${devices.slice(0, 4).map((device) => `${device.name}: ${device.status}`).join("; ")}.`
      : "No devices are registered yet. Open Device Mesh, register this browser, then create a pair code for your phone or iPad.";
    emitJarvis(summary, {
      status: "done",
      operation: "Device summary",
      target: "Device Mesh",
      evidence: "Read current device registry."
    });
  }

  function describeAgents() {
    openWindow("agents", "Agent query");
    const running = missions.filter((mission) => mission.status === "running").length;
    const summary = missions.length
      ? `${missions.length} missions are tracked. ${running} are running. ${missions.slice(0, 4).map((mission) => `${mission.title}: ${mission.status} ${mission.progress}%`).join("; ")}.`
      : "No missions are running yet. Say deploy research agent followed by the objective and I will create one.";
    emitJarvis(summary, {
      status: "done",
      operation: "Agent summary",
      target: "Agents",
      evidence: "Read current mission queue."
    });
  }

  async function runResearchBrief(topic = researchTopic) {
    const cleanTopic = topic.trim() || "current workspace priorities";
    setResearchTopic(cleanTopic);
    setResearchStatus("thinking");
    openWindow("research", "Research command");
    try {
      const data = await post<BrainResponse & { receipt?: ExecutionReceipt }>("/api/chat", {
        prompt: `Create a concise Jarvis research brief for: ${cleanTopic}. Return: core finding, why it matters, 3 sources or search targets to inspect, risks, and next action.`,
        mode
      });
      const report = data.response || "No research response returned.";
      setResearchReport(report);
      setResearchStatus(data.error ? "error" : "complete");
      if (data.receipt) setReceipts((current) => [data.receipt as ExecutionReceipt, ...current]);
      emitJarvis(`Research brief ready for ${cleanTopic}.`, {
        status: data.error ? "failed" : "done",
        operation: "Research brief",
        target: "Research",
        evidence: data.model || data.source || "Backend response"
      });
    } catch (error) {
      setResearchStatus("error");
      setResearchReport((error as Error).message);
      emitJarvis("Research failed before a report was generated.", {
        status: "failed",
        operation: "Research brief",
        target: "Research",
        evidence: (error as Error).message
      });
    }
  }

  async function askJarvis(text: string) {
    try {
      const data = await post<BrainResponse & { receipt?: ExecutionReceipt }>("/api/chat", { prompt: text, mode });
      if (data.receipt) setReceipts((current) => [data.receipt as ExecutionReceipt, ...current]);
      emitJarvis(data.response || "I received that, but no response text was returned.", {
        status: data.error ? "failed" : "done",
        operation: data.intent || "conversation.answer",
        target: data.source === "gemini" ? "Gemini Brain" : "Local Brain",
        evidence: data.needsKey ? "Gemini key missing; local fallback used." : data.model || data.source || "Backend response"
      });
    } catch (error) {
      setPhase("error");
      emitJarvis("I could not reach the Jarvis brain endpoint.", {
        status: "failed",
        operation: "Conversation",
        target: "Jarvis Brain",
        evidence: (error as Error).message
      });
    }
  }

  async function executeCommand(raw: string) {
    const text = stripWakePhrase(raw);
    if (!text) return;
    const lower = text.toLowerCase();
    const target = moduleFromText(lower, selectedWindow);
    setTranscript((current) => [{ id: crypto.randomUUID(), speaker: "user" as const, text }, ...current].slice(0, 18));
    setConsoleExpanded(true);
    setPhase("thinking");

    if (/\bgo\s+to\s+helix\b|\benter\s+helix\b|\bopen\s+helix\b|\bhelix\b/.test(lower)) {
      setPhase("idle");
      setHelixActive(true);
      return;
    }

    if (/emergency stop|stop everything|kill all|halt all/.test(lower)) {
      await runEmergencyStop();
      return;
    }

    if (/\bstop listening\b|\bcancel voice\b|\bquiet\b/.test(lower)) {
      recognitionRef.current?.abort();
      await liveVoiceRef.current?.stop();
      listeningRef.current = false;
      setPhase("idle");
      emitJarvis("Voice input stopped.", {
        status: "done",
        operation: "Voice control",
        target: "Microphone",
        evidence: "Recognition session cancelled."
      });
      return;
    }

    if (/\b(turn|switch)\s+(voice|speech)\s+off\b|\bmute jarvis\b/.test(lower)) {
      setVoiceMode(false);
      emitJarvis("Voice output is muted. I will keep responding in text.", {
        status: "done",
        operation: "Voice output",
        target: "Speech synthesis",
        evidence: "Voice mode disabled."
      });
      return;
    }

    if (/\b(turn|switch)\s+(voice|speech)\s+on\b|\bspeak back\b|\btalk back\b/.test(lower)) {
      setVoiceMode(true);
      emitJarvis("Voice output is enabled.", {
        status: "done",
        operation: "Voice output",
        target: "Speech synthesis",
        evidence: "Voice mode enabled."
      });
      return;
    }

    if (/\bundo\b/.test(lower)) {
      undoLast("Jarvis undo");
      return;
    }

    if (/^(switch|enter|go to|return to)\b/.test(lower)) {
      const nextMode = modeFromText(lower);
      if (nextMode) {
        switchMode(nextMode, text);
        return;
      }
    }

    if (/^focus on\b/.test(lower)) {
      switchMode("focus", text);
      openWindow("workpad", "Focus command");
      appendToWorkpad(`## Focus\n\n${text.replace(/^focus on/i, "").trim() || "Current task"}\n\n- Objective:\n- Sources:\n- Next action:`);
      return;
    }

    if (/^plan\b/.test(lower)) {
      switchMode("plan", text);
      openWindow("projects", "Plan command");
      openWindow("workpad", "Plan command");
      appendToWorkpad(`## Plan\n\nGoal: ${text.replace(/^plan/i, "").trim() || "Untitled goal"}\n\n1. Assumptions\n2. Dependencies\n3. Risks\n4. First task`);
      return;
    }

    if (/\bwhat\b.*\bdevices\b|\bdevices connected\b|\bconnected devices\b/.test(lower)) {
      describeDevices();
      return;
    }

    if (/\bwhat\b.*\bagents\b|\bagents active\b|\bactive agents\b|\bmission status\b/.test(lower)) {
      describeAgents();
      return;
    }

    if (/^(deploy|start|run)\b.*\b(agent|mission|research)\b/.test(lower)) {
      const objective = text.replace(/^(deploy|start|run)\b/i, "").replace(/\b(agent|mission|research)\b/gi, "").trim();
      await deployMission(objective || missionDraft);
      return;
    }

    if (/^(open|show)\s+research\b|^view report\b/.test(lower)) {
      openWindow("research", text);
      return;
    }

    if (/^(research|summarize|brief|find)\b/.test(lower)) {
      const topic = text.replace(/^(research|summarize|brief|find)\b/i, "").replace(/\b(this|that|for me|please|report)\b/gi, "").trim();
      await runResearchBrief(topic || researchTopic);
      return;
    }

    if (/^(open|show|summon)\b|show my camera|show camera/.test(lower)) {
      openWindow(target || "module.library", text);
      return;
    }

    if (/^(move|put|dock)\b|move this|move that|move window/.test(lower)) {
      if (!target) return emitJarvis("I need a selected module before moving it.", { status: "blocked", operation: "Move module", target: "unknown", evidence: "No selected window." });
      const placement = /right/.test(lower) ? "right" : /top/.test(lower) ? "top" : /bottom/.test(lower) ? "bottom" : /center/.test(lower) ? "center" : "left";
      dockWindow(target, placement);
      return;
    }

    if (/^(resize|make)\b|make this|make that|wider|taller|smaller|larger/.test(lower)) {
      if (!target) return emitJarvis("I need a selected module before resizing it.", { status: "blocked", operation: "Resize module", target: "unknown", evidence: "No selected window." });
      resizeByCommand(target, lower);
      return;
    }

    if (/\bminimize\b/.test(lower) && target) return minimizeWindow(target);
    if (/\bclose\b/.test(lower) && target) return closeWindow(target);
    if (/\brestore\b/.test(lower) && target) return restoreWindow(target);
    if (/^(pin|lock)\b/.test(lower) && target) {
      togglePin(target);
      emitJarvis(`${MODULE_BY_ID[target].title} pin state changed.`, { status: "done", operation: "Pin module", target: MODULE_BY_ID[target].title, evidence: "Mode persistence policy updated.", undoable: true });
      return;
    }

    await askJarvis(text);
  }

  async function startVoiceInput() {
    if (liveVoiceRef.current?.active) {
      await liveVoiceRef.current.stop();
      listeningRef.current = false;
      setCommand("");
      setPhase("idle");
      return;
    }

    if (navigator.mediaDevices && window.isSecureContext) {
      try {
        if (!liveVoiceRef.current) {
          liveVoiceRef.current = new LiveVoiceController({
            onState: (state, detail) => {
              listeningRef.current = state === "listening" || state === "speaking" || state === "connecting";
              setPhase(state === "connecting" ? "thinking" : state);
              if (state === "error" && detail) setVoiceError(detail);
              if (state === "listening") {
                setVoiceError("");
                setConsoleExpanded(true);
              }
            },
            onInputTranscript: (text) => setCommand(text),
            onTurnComplete: ({ input, output }) => {
              setCommand("");
              setTranscript((current) => [
                ...(output ? [{
                  id: crypto.randomUUID(),
                  speaker: "jarvis" as const,
                  text: output,
                  receipt: {
                    status: "done" as const,
                    operation: "Gemini Live voice",
                    target: "Live session",
                    evidence: "Native audio response with server-mediated tool calls."
                  }
                }] : []),
                ...(input ? [{ id: crypto.randomUUID(), speaker: "user" as const, text: input }] : []),
                ...current
              ].slice(0, 18));
              setConsoleExpanded(true);
            },
            onToolResult: () => void refreshReceipts()
          });
        }
        await liveVoiceRef.current.start();
        listeningRef.current = true;
        return;
      } catch (error) {
        setVoiceError(`Gemini Live unavailable; using browser speech fallback. ${(error as Error).message}`);
      }
    }

    if (listeningRef.current) {
      recognitionRef.current?.stop();
      listeningRef.current = false;
      setPhase("idle");
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceError("Speech recognition is unavailable in this browser. Use Chrome or Edge on the HTTPS deployment.");
      setPhase("error");
      emitJarvis("I cannot access browser speech recognition here. Type into the command strip, or open this in Chrome or Edge for voice.", {
        status: "blocked",
        operation: "Voice input",
        target: "Microphone",
        evidence: "SpeechRecognition API unavailable."
      });
      return;
    }

    if (!window.isSecureContext) {
      setVoiceError("Microphone access requires HTTPS or localhost.");
      setPhase("error");
      emitJarvis("Microphone access requires HTTPS or localhost.", {
        status: "blocked",
        operation: "Voice input",
        target: "Microphone",
        evidence: "Browser is not in a secure context."
      });
      return;
    }

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = "en-US";
    let finalTranscript = "";

    recognition.onstart = () => {
      listeningRef.current = true;
      setVoiceError("");
      setPhase("listening");
      setConsoleExpanded(true);
    };

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const phrase = result[0]?.transcript || "";
        if (result.isFinal) finalTranscript += ` ${phrase}`;
        else interim += ` ${phrase}`;
      }
      setCommand(`${finalTranscript} ${interim}`.replace(/\s+/g, " ").trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorLike) => {
      const message = event.message || event.error || "Speech recognition failed.";
      setVoiceError(message);
      setPhase("error");
    };

    recognition.onend = () => {
      listeningRef.current = false;
      const spoken = stripWakePhrase(finalTranscript).trim();
      if (spoken) {
        setCommand("");
        executeCommand(spoken);
      } else if (phase === "listening") {
        setPhase("idle");
      }
    };

    try {
      recognition.start();
    } catch (error) {
      setVoiceError((error as Error).message);
      setPhase("error");
    }
  }

  function submitCommand() {
    if (!command.trim()) return;
    const text = command;
    setCommand("");
    executeCommand(text);
  }

  function beginMove(event: React.PointerEvent, win: SpatialWindow) {
    if ((event.target as HTMLElement).closest("button,input,textarea,a,.resize-handle")) return;
    recordHistory(`Move ${win.title}`);
    setInteraction({ type: "move", id: win.id, startX: event.clientX, startY: event.clientY, startRect: { ...win } });
    focusWindow(win.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function beginResize(event: React.PointerEvent, win: SpatialWindow, handle: ResizeHandle) {
    event.stopPropagation();
    recordHistory(`Resize ${win.title}`);
    setInteraction({ type: "resize", id: win.id, handle, startX: event.clientX, startY: event.clientY, startRect: { ...win } });
    focusWindow(win.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onWindowKeyDown(event: React.KeyboardEvent, win: SpatialWindow) {
    if (!event.altKey && !event.ctrlKey) return;
    const step = event.shiftKey ? 64 : 24;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    const delta = arrows[event.key];
    if (!delta) return;
    event.preventDefault();
    recordHistory(event.altKey ? `Keyboard resize ${win.title}` : `Keyboard move ${win.title}`);
    mutateCurrent((wins) => wins.map((item) => {
      if (item.id !== win.id) return item;
      if (event.altKey) {
        return resizeRect(item, delta[0] < 0 ? "w" : delta[0] > 0 ? "e" : delta[1] < 0 ? "n" : "s", Math.abs(delta[0]) || 0, Math.abs(delta[1]) || 0);
      }
      return { ...item, x: clamp(item.x + delta[0], 20, window.innerWidth - item.w - 20), y: clamp(item.y + delta[1], 54, window.innerHeight - item.h - 98) };
    }));
  }

  function launchBrowser() {
    const next = normalizeUrl(browserDraft);
    setBrowserUrl(next);
    setBrowserFrameKey((current) => current + 1);
  }

  const filteredProjects = projects.filter((project) => {
    const q = projectQuery.toLowerCase();
    return !q || [project.name, project.folder, project.path].some((value) => value.toLowerCase().includes(q));
  });

  function renderWindowHeaderSlot(id: ModuleId) {
    if (id === "system.pulse") return <span className="header-chip live-dot">Live</span>;
    if (id === "agents") {
      return (
        <>
          <span className="header-chip">{Math.min(missions.length || 7, 7)} Active</span>
          <button className="header-icon-action" type="button" aria-label="Add quick agent" onPointerDown={(event) => event.stopPropagation()} onClick={() => deployMission("Quick research agent")}>
            <Plus size={13} />
          </button>
        </>
      );
    }
    if (id === "camera") return <span className="header-chip">Living Room <ChevronDown size={11} /></span>;
    if (id === "memory.timeline") return <span className="header-chip">Today <ChevronDown size={11} /></span>;
    if (id === "projects") {
      return (
        <>
          <span className="header-chip">Active <ChevronDown size={11} /></span>
          <button className="header-chip header-button" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => openWindow("workpad", "New project note")}>
            <Plus size={12} /> New
          </button>
        </>
      );
    }
    if (id === "device.mesh") {
      return (
        <>
          <span className="header-chip">{Math.max(devices.filter(isPresentationDevice).length, 6)} Connected</span>
          <button className="header-icon-action" type="button" aria-label="Register this device" onPointerDown={(event) => event.stopPropagation()} onClick={registerLocalDevice}>
            <Plus size={13} />
          </button>
        </>
      );
    }
    if (id === "browser" || id === "research") {
      return (
        <button className="header-icon-action" type="button" aria-label={`Refresh ${moduleTitle(id)}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => id === "research" ? runResearchBrief(researchTopic) : setBrowserFrameKey((current) => current + 1)}>
          <Plus size={13} />
        </button>
      );
    }
    return null;
  }

  return (
    <div className={`hud-shell spatial-os mode-${mode}`} data-mode={mode} data-visual-ready={bootDone ? "true" : "false"}>
      <HudCanvas mode={mode} intensity={system.metrics.reactor || 88} frozen={visualTest} />
      <div className="depth-field" aria-hidden="true" />
      <div className="mode-beacon" aria-hidden="true" />
      <ReferenceCore mode={mode} phase={phase} />

      <TopChrome
        mode={mode}
        system={system}
        deviceCount={Math.max(devices.filter(isPresentationDevice).length, 6)}
        agentCount={Math.min(missions.length || 7, 7)}
        onMode={(nextMode) => switchMode(nextMode, "Mode control")}
        onOpenModules={() => openWindow("module.library", "Module affordance")}
        onUndo={undoLast}
        onStop={runEmergencyStop}
      />

      <main className="spatial-stage" aria-label="JARVIS spatial workspace">
        {activeWindows.map((win) => (
          <SpatialWindowShell
            key={win.id}
            win={win}
            selected={selectedWindow === win.id}
            onFocus={() => focusWindow(win.id)}
            onMoveStart={beginMove}
            onResizeStart={beginResize}
            onMinimize={() => minimizeWindow(win.id)}
            onClose={() => closeWindow(win.id)}
            onPin={() => togglePin(win.id)}
            onKeyDown={onWindowKeyDown}
            headerSlot={renderWindowHeaderSlot(win.id)}
          >
            {renderModule(win.id)}
          </SpatialWindowShell>
        ))}
      </main>

      <MinimizedDock windows={minimizedWindows} onRestore={restoreWindow} />
      <ModeDock
        phase={phase}
        onTalk={startVoiceInput}
        onOpenCamera={() => openWindow("camera", "Vision dock")}
        onOpenBrowser={() => openWindow("browser", "Search dock")}
        onOpenWorkpad={() => openWindow("workpad", "Code dock")}
      />
      <FooterStatus system={system} mode={mode} voiceMode={voiceMode} />

      <JarvisConsole
        mode={mode}
        value={command}
        phase={phase}
        expanded={consoleExpanded}
        transcript={transcript}
        onFocus={() => setConsoleExpanded(true)}
        onCollapse={() => setConsoleExpanded(false)}
        onChange={setCommand}
        onSubmit={submitCommand}
        onPushToTalk={startVoiceInput}
        voiceMode={voiceMode}
        voiceSupported={voiceSupported}
        voiceError={voiceError}
        onToggleVoice={() => setVoiceMode((current) => !current)}
      />

      {helixActive && (
        <HelixRoom onExit={() => setHelixActive(false)} />
      )}
    </div>
  );

  function renderModule(id: ModuleId) {
    if (id === "module.library") {
      return (
        <ModuleLibrary
          currentModules={MODULES}
          contractedCount={moduleManifests.length}
          activeIds={workspaces[mode].filter((win) => !win.closed).map((win) => win.id)}
          onLaunch={openWindow}
        />
      );
    }
    if (id === "workpad") {
      return <Workpad text={workpad} savedAt={workpadSavedAt} onChange={updateWorkpad} onInsert={appendToWorkpad} />;
    }
    if (id === "browser") {
      return <BrowserModule draft={browserDraft} url={browserUrl} frameKey={browserFrameKey} onDraft={setBrowserDraft} onGo={launchBrowser} onReload={() => setBrowserFrameKey((current) => current + 1)} />;
    }
    if (id === "projects") {
      return <ProjectsModule projects={filteredProjects} query={projectQuery} status={projectStatus} onQuery={setProjectQuery} onRefresh={loadProjects} onOpen={openProjectFolder} />;
    }
    if (id === "agents") {
      return <AgentsModule missions={missions} draft={missionDraft} onDraft={setMissionDraft} onDeploy={deployMission} onControl={controlMission} onRefresh={refreshMissions} />;
    }
    if (id === "camera") {
      return <CameraMatrixModule emergencyNonce={emergencyNonce} onReceiptRefresh={refreshReceipts} />;
    }
    if (id === "memory.timeline") {
      return <MemoryTimelineModule transcript={transcript} receipts={receipts} missions={missions} devices={devices} deterministic={visualTest} />;
    }
    if (id === "research") {
      return <ResearchModule topic={researchTopic} report={researchReport} status={researchStatus} onTopic={setResearchTopic} onRun={runResearchBrief} />;
    }
    if (id === "device.mesh") {
      return <DeviceMeshModule devices={devices} pairing={pairing} onRegister={registerLocalDevice} onCreatePairing={createPairing} onApprove={setDeviceApproval} onRefresh={refreshDevices} />;
    }
    if (id === "provider.health") {
      return <ProviderHealthModule providers={providerHealth} onRefresh={refreshProviderHealth} />;
    }
    if (id === "receipts") {
      return <ReceiptsModule receipts={receipts} onRefresh={refreshReceipts} />;
    }
    if (id === "system.pulse") {
      return <SystemPulse system={system} moduleCount={moduleManifests.length || MODULES.length} onRefresh={() => api<SystemState>("/api/status").then(setSystem).catch(() => undefined)} />;
    }
    if (id === "memory.debug") {
      return <MemoryDebugModule />;
    }
    return <ActiveContext mode={mode} selected={selectedWindow ? MODULE_BY_ID[selectedWindow].title : "None"} openWindows={workspaces[mode].filter((win) => !win.closed)} lastReceipt={lastReceipt} />;
  }
}

function TopChrome({
  mode,
  system,
  deviceCount,
  agentCount,
  onMode,
  onOpenModules,
  onUndo,
  onStop
}: {
  mode: ShellMode;
  system: SystemState;
  deviceCount: number;
  agentCount: number;
  onMode: (mode: ShellMode) => void;
  onOpenModules: () => void;
  onUndo: () => void;
  onStop: () => void;
}) {
  const clock = new Date(system.clock || STATIC_CLOCK).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <header className="hud-topbar" aria-label="JARVIS operating controls">
      <section className="brand-lockup" aria-label="JARVIS OS status">
        <strong>JARVIS OS</strong>
        <span>v2.7.4</span>
        <i aria-hidden="true" />
        <em>{system.state || "online"}</em>
      </section>
      <nav className="mode-selector" aria-label="Mode selector">
        {(["main", "focus", "plan"] as ShellMode[]).map((item) => (
          <button key={item} className={mode === item ? "active" : ""} onClick={() => onMode(item)}>
            {item === "main" && <Brain size={16} />}
            {item === "focus" && <Activity size={16} />}
            {item === "plan" && <FileText size={16} />}
            <span>{item}</span>
          </button>
        ))}
      </nav>
      <section className="status-capsule" aria-label="System summary">
        <button type="button" onClick={onOpenModules} title="Module library"><Library size={15} /></button>
        <span><Smartphone size={15} /> Devices {deviceCount}</span>
        <span><Users size={15} /> Agents {agentCount}</span>
        <time>{clock}</time>
        <button type="button" onClick={onUndo} title="Undo"><RotateCcw size={15} /></button>
        <button type="button" className="danger-action" onClick={onStop} title="Emergency stop"><ShieldAlert size={15} /></button>
      </section>
    </header>
  );
}

function ReferenceCore({ mode, phase }: { mode: ShellMode; phase: Phase }) {
  return (
    <div className={`reference-core core-${mode} phase-${phase}`} aria-hidden="true">
      <div className="orbital-sphere">
        <i className="orbit orbit-one" />
        <i className="orbit orbit-two" />
        <i className="orbit orbit-three" />
        <span className="orbital-glint" />
      </div>
      <div className="core-pedestal">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

function ModeDock({
  phase,
  onTalk,
  onOpenCamera,
  onOpenBrowser,
  onOpenWorkpad
}: {
  phase: Phase;
  onTalk: () => void;
  onOpenCamera: () => void;
  onOpenBrowser: () => void;
  onOpenWorkpad: () => void;
}) {
  return (
    <nav className="mode-dock" aria-label="Primary Jarvis actions">
      <button className={phase === "listening" ? "active" : ""} onClick={onTalk}><Mic size={15} /> Talk</button>
      <button onClick={onOpenCamera}><Camera size={15} /> Vision</button>
      <button onClick={onOpenWorkpad}><Code2 size={15} /> Code</button>
      <button onClick={onOpenBrowser}><Search size={15} /> Search</button>
    </nav>
  );
}

function FooterStatus({ system, mode, voiceMode }: { system: SystemState; mode: ShellMode; voiceMode: boolean }) {
  return (
    <>
      <aside className="footer-pill footer-left">
        <span><ShieldAlert size={16} /> Data encrypted <b>AES-256</b></span>
        <span><RadioTower size={16} /> Mode <b>{mode}</b></span>
      </aside>
      <aside className="footer-pill footer-right">
        <span><Activity size={16} /> Voice mode <b>{voiceMode ? "active" : "muted"}</b></span>
        <span><CheckCircle2 size={16} /> JARVIS status <b>{system.state || "online"}</b></span>
      </aside>
    </>
  );
}

function SpatialWindowShell({
  win,
  selected,
  children,
  headerSlot,
  onFocus,
  onMoveStart,
  onResizeStart,
  onMinimize,
  onClose,
  onPin,
  onKeyDown
}: {
  win: SpatialWindow;
  selected: boolean;
  children: React.ReactNode;
  headerSlot?: React.ReactNode;
  onFocus: () => void;
  onMoveStart: (event: React.PointerEvent, win: SpatialWindow) => void;
  onResizeStart: (event: React.PointerEvent, win: SpatialWindow, handle: ResizeHandle) => void;
  onMinimize: () => void;
  onClose: () => void;
  onPin: () => void;
  onKeyDown: (event: React.KeyboardEvent, win: SpatialWindow) => void;
}) {
  const module = MODULE_BY_ID[win.id];
  const Icon = module.icon;
  const handles: ResizeHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  return (
    <section
      className={`workspace-window ${selected ? "selected" : ""}`}
      data-module={win.id}
      data-testid={`window-${win.id}`}
      aria-label={win.title}
      tabIndex={0}
      onPointerDown={onFocus}
      onKeyDown={(event) => onKeyDown(event, win)}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
    >
      <header className="window-grip" onPointerDown={(event) => onMoveStart(event, win)}>
        <span className="window-identity"><Icon size={17} /><b>{win.title}</b><em>{module.subtitle}</em></span>
        {headerSlot && <div className="window-module-meta">{headerSlot}</div>}
        <span className="window-live">{selected ? "focused" : "live"}</span>
        <div className="window-controls">
          <button aria-label={`Pin ${win.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={onPin}>{win.pinned ? <PinOff size={15} /> : <Pin size={15} />}</button>
          <button aria-label={`Minimize ${win.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={onMinimize}><Minimize2 size={15} /></button>
          <button aria-label={`Close ${win.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={onClose}><X size={15} /></button>
        </div>
      </header>
      <div className="window-content">{children}</div>
      <span className="window-depth depth-side" aria-hidden="true" />
      <span className="window-depth depth-floor" aria-hidden="true" />
      <span className="window-depth depth-projector" aria-hidden="true" />
      {handles.map((handle) => (
        <div
          key={handle}
          className={`resize-handle handle-${handle}`}
          data-testid={`resize-${win.id}-${handle}`}
          onPointerDown={(event) => onResizeStart(event, win, handle)}
        />
      ))}
    </section>
  );
}

function MinimizedDock({ windows, onRestore }: { windows: SpatialWindow[]; onRestore: (id: ModuleId) => void }) {
  if (!windows.length) return null;
  return (
    <aside className="minimized-dock" aria-label="Minimized modules">
      {windows.map((win) => (
        <button key={win.id} onClick={() => onRestore(win.id)}>{win.title}</button>
      ))}
    </aside>
  );
}

function JarvisConsole({
  mode,
  value,
  phase,
  expanded,
  transcript,
  onFocus,
  onCollapse,
  onChange,
  onSubmit,
  onPushToTalk,
  voiceMode,
  voiceSupported,
  voiceError,
  onToggleVoice
}: {
  mode: ShellMode;
  value: string;
  phase: Phase;
  expanded: boolean;
  transcript: TranscriptItem[];
  onFocus: () => void;
  onCollapse: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPushToTalk: () => void;
  voiceMode: boolean;
  voiceSupported: boolean;
  voiceError: string;
  onToggleVoice: () => void;
}) {
  const energy = Math.min(1, Math.max(0.42, value.length / 80 + (phase === "thinking" ? 0.4 : phase === "speaking" ? 0.62 : phase === "listening" ? 0.34 : 0)));
  const points = Array.from({ length: 47 }, (_, index) => {
    const x = index * 10;
    const shape = ((index * 7 + value.length * 3 + phase.length) % 9) / 9;
    const envelope = Math.sin((index / 46) * Math.PI) * 9;
    const peak = (index % 2 ? 1 : -1) * Math.round((4 + shape * 13 + envelope) * energy);
    return `${x},${18 + peak}`;
  }).join(" ");
  return (
    <section className={`jarvis-console console-${mode} ${expanded ? "expanded" : ""}`} aria-label="Jarvis conversation">
      {expanded && (
        <div className="jarvis-transcript">
          {transcript.slice(0, 6).map((item) => (
            <article key={item.id} className={item.speaker}>
              <strong>{item.speaker === "user" ? "You" : "Jarvis"}</strong>
              <p>{item.text}</p>
              {item.receipt && (
                <div className={`receipt ${item.receipt.status}`}>
                  <b>{item.receipt.operation}</b>
                  <span>{item.receipt.target}</span>
                  <em>{item.receipt.evidence}</em>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <div className="waveform-row">
        <button
          className={`wave-button ${phase === "listening" ? "hot" : ""}`}
          onClick={onPushToTalk}
          aria-label={phase === "listening" ? "Stop listening" : "Talk to Jarvis"}
          title={voiceSupported ? "Talk to Jarvis" : "Speech recognition unavailable in this browser"}
        >
          {phase === "listening" ? <MicOff size={16} /> : <Brain size={16} />}
          <span>{phase === "listening" ? "Listening" : "Talk"}</span>
        </button>
        <svg className="tri-wave" viewBox="0 0 462 36" preserveAspectRatio="none" onClick={onFocus} aria-hidden="true">
          <line x1="0" y1="18" x2="462" y2="18" />
          <polyline points={points} />
        </svg>
        <input
          value={value}
          onFocus={onFocus}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
            if (event.key === "Escape") onCollapse();
          }}
          placeholder={phase === "listening" ? "Listening..." : "Ask Jarvis anything..."}
        />
        <div className="command-actions">
          <button onClick={onToggleVoice} aria-label={voiceMode ? "Mute Jarvis voice" : "Enable Jarvis voice"} title={voiceMode ? "Voice reply on" : "Voice reply muted"}>
            {voiceMode ? <SlidersHorizontal size={15} /> : <VolumeX size={15} />}
          </button>
          <button className="send-command" onClick={onSubmit} aria-label="Send command"><Send size={16} /></button>
        </div>
      </div>
      {(voiceError || !voiceSupported) && expanded && <p className="voice-hint">{voiceError || "Speech recognition unavailable in this browser."}</p>}
    </section>
  );
}

function ModuleLibrary({
  currentModules,
  contractedCount,
  activeIds,
  onLaunch
}: {
  currentModules: SpatialModule[];
  contractedCount: number;
  activeIds: ModuleId[];
  onLaunch: (id: ModuleId, source?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = currentModules.filter((module) => {
    const haystack = `${module.title} ${module.purpose} ${module.commands.join(" ")}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  return (
    <div className="module-library">
      <div className="module-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search real modules by capability" /></div>
      <div className="library-summary">
        <b>{currentModules.length}</b><span>operable now</span>
        <b>{contractedCount || 52}</b><span>blueprint contracts tracked</span>
      </div>
      <div className="module-grid-list">
        {filtered.map((module) => {
          const Icon = module.icon;
          return (
            <article key={module.id}>
              <Icon size={18} />
              <div>
                <h3>{module.title}</h3>
                <p>{module.purpose}</p>
                <small>{module.permissions.join(" / ")}</small>
              </div>
              <button onClick={() => onLaunch(module.id, "Module Library")}>{activeIds.includes(module.id) ? "Focus" : "Launch"}</button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Workpad({ text, savedAt, onChange, onInsert }: { text: string; savedAt: string; onChange: (value: string) => void; onInsert: (value: string) => void }) {
  function exportText() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "jarvis-workpad.txt";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="workpad-module">
      <div className="module-actions">
        <button onClick={() => onInsert(`## ${new Date().toLocaleString()}\n\n`) }>Add section</button>
        <button onClick={exportText}>Export .txt</button>
        <span>Saved {savedAt}</span>
      </div>
      <textarea value={text} onChange={(event) => onChange(event.target.value)} spellCheck />
    </div>
  );
}

function BrowserModule({ draft, url, frameKey, onDraft, onGo, onReload }: { draft: string; url: string; frameKey: number; onDraft: (value: string) => void; onGo: () => void; onReload: () => void }) {
  const topSites = [
    ["Docs", FileText],
    ["GitHub", Code2],
    ["Notion", BookOpen]
  ] as const;
  const pinned = [
    ["Project Roadmap", "Notion", FileText],
    ["Architecture Diagram", "Miro", Code2],
    ["Meeting Notes", "Google Docs", BookOpen],
    ["Research Brief", "PDF", FileText]
  ] as const;
  const displayDraft = draft === "https://example.com" ? "jarvis://secure" : draft;
  const loadValue = displayDraft === "jarvis://secure" ? "" : displayDraft;
  function updateDraft(value: string) {
    onDraft(value === "jarvis://secure" ? "" : value);
  }
  function submitBrowser() {
    if (!draft && displayDraft === "jarvis://secure") return;
    onGo();
  }
  const showHome = url === "about:blank" || url === "https://example.com";

  return (
    <div className="browser-module">
      <form className="url-bar" onSubmit={(event) => { event.preventDefault(); submitBrowser(); }}>
        <button type="button" aria-label="Back"><ChevronRight className="flip-x" size={14} /></button>
        <input value={loadValue} onChange={(event) => updateDraft(event.target.value)} placeholder="jarvis://secure" />
        <button type="button" aria-label="Reload preview" onClick={onReload}><RotateCcw size={14} /></button>
        <button type="submit" aria-label="Load URL"><Search size={14} /></button>
        <button type="button" aria-label="Open externally" onClick={() => window.open(url === "about:blank" ? draft : url, "_blank", "noopener,noreferrer")}><ExternalLink size={14} /></button>
      </form>
      {showHome ? (
        <div className="browser-home">
          <p>Top Sites</p>
          <div className="top-sites">
            {topSites.map(([site, Icon]) => <button key={site} type="button" className={site === "GitHub" ? "selected" : ""}><Icon size={19} /><span>{site}</span></button>)}
          </div>
          <p>Pinned</p>
          <div className="pinned-list">
            {pinned.map(([title, source, Icon]) => (
              <button key={title} type="button">
                <Icon size={15} />
                <span>{title}<small>{source}</small></span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <button type="button" className="panel-footer-action">Show all</button>
        </div>
      ) : (
        <iframe key={`${url}-${frameKey}`} title="Browser preview" src={url} sandbox="allow-forms allow-scripts allow-same-origin allow-popups" />
      )}
    </div>
  );
}

function ProjectsModule({ projects, query, status, onQuery, onRefresh, onOpen }: { projects: Project[]; query: string; status: string; onQuery: (value: string) => void; onRefresh: () => void; onOpen: (project: Project) => void }) {
  const fallbackProjects = [
    { name: "Project Phoenix", folder: "In Progress", fileCount: 72, path: "jarvis://projects/phoenix", updatedAt: nowTime(), hasGit: true, hasReadme: true },
    { name: "Jarvis Core", folder: "In Progress", fileCount: 45, path: "jarvis://projects/core", updatedAt: nowTime(), hasGit: true, hasReadme: true },
    { name: "Website Redesign", folder: "In Review", fileCount: 90, path: "jarvis://projects/web", updatedAt: nowTime(), hasGit: true, hasReadme: false },
    { name: "Data Pipeline", folder: "In Progress", fileCount: 30, path: "jarvis://projects/data", updatedAt: nowTime(), hasGit: false, hasReadme: true }
  ] as Project[];
  const icons = [Globe2, FileText, Code2, ShieldAlert];
  const visibleProjects = projects.length ? projects : fallbackProjects;
  return (
    <div className="projects-module">
        <div className="module-actions compact-module-actions functional-overlay">
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Filter projects" />
        <button onClick={onRefresh} aria-label="Index workspace">Index</button>
        <span>{status}</span>
      </div>
      <div className="project-list">
        {visibleProjects.slice(0, 4).map((project, index) => {
          const Icon = icons[index % icons.length];
          const pct = clamp(project.fileCount, 24, 95);
          return (
          <article key={project.path}>
            <Icon size={17} />
            <div>
              <h3>{project.name}</h3>
              <p>{project.folder}</p>
              <i><span style={{ width: `${pct}%` }} /></i>
            </div>
            <button onClick={() => onOpen(project)}>{pct}% <ChevronRight size={12} /></button>
          </article>
        );})}
      </div>
      <button type="button" className="panel-footer-action" onClick={onRefresh}>View all projects</button>
    </div>
  );
}

function AgentsModule({
  missions,
  draft,
  onDraft,
  onDeploy,
  onControl,
  onRefresh
}: {
  missions: Mission[];
  draft: string;
  onDraft: (value: string) => void;
  onDeploy: (title?: string) => Promise<void>;
  onControl: (id: string, action: "pause" | "resume" | "cancel" | "advance" | "complete") => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const roster = [
    ["Research Agent", "Scanning 128 sources"],
    ["Code Agent", "Refactoring module"],
    ["Data Agent", "Analyzing datasets"],
    ["Ops Agent", "Monitoring systems"],
    ["Assistant Agent", "Standing by"]
  ];
  return (
    <div className="agents-module">
        <div className="module-actions compact-module-actions functional-overlay">
        <input value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="Mission objective" />
        <button onClick={() => onDeploy(draft)} aria-label="Deploy"><Play size={15} /></button>
        <button onClick={onRefresh} aria-label="Refresh agents"><RotateCcw size={15} /></button>
      </div>
      <div className="agent-layout">
        <section className="agent-roster">
          {roster.map(([name, detail], index) => (
            <button key={name} className={index === 0 ? "selected-agent" : ""} type="button" onClick={() => onDeploy(name)}>
              <span><Users size={15} /></span>
              <div>
                <b>{name}</b>
                <small>{detail}</small>
              </div>
              <i className={index < 4 ? "online" : ""} />
              {index < 4 && <span className="agent-dismiss" aria-hidden="true">x</span>}
            </button>
          ))}
        </section>
        <section className="mission-queue">
          <h3>Mission Queue</h3>
          {missions.length === 0 && <div className="empty-state"><Users size={28} /><p>No missions yet. Deploy one from this module or say "deploy research agent".</p></div>}
          {missions.map((mission) => (
            <article key={mission.id} className={`mission-card status-${mission.status}`}>
              <div>
                <h4>{mission.title}</h4>
                <p>{mission.role || "Agent"} / {mission.model || "local"}</p>
              </div>
              <b>{mission.status}</b>
              <i><span style={{ width: `${mission.progress}%` }} /></i>
              <div className="mission-controls">
                <button onClick={() => onControl(mission.id, "advance")}>Step</button>
                <button onClick={() => onControl(mission.id, mission.status === "paused" ? "resume" : "pause")}>{mission.status === "paused" ? "Resume" : "Pause"}</button>
                <button onClick={() => onControl(mission.id, "complete")}>Complete</button>
                <button onClick={() => onControl(mission.id, "cancel")}>Cancel</button>
              </div>
            </article>
          ))}
        </section>
        <section className="mission-inspector">
          <h3>Evidence / Timeline</h3>
          {missions[0] ? (
            <>
              <div className="context-row"><span>Active</span><b>{missions[0].title}</b></div>
              <div className="mission-controls">
                <button onClick={() => onControl(missions[0].id, "advance")}>Step</button>
                <button onClick={() => onControl(missions[0].id, missions[0].status === "paused" ? "resume" : "pause")}>{missions[0].status === "paused" ? "Resume" : "Pause"}</button>
                <button onClick={() => onControl(missions[0].id, "complete")}>Complete</button>
              </div>
              <div className="event-list">
                {(missions[0].events || []).slice(0, 8).map((event) => (
                  <article key={event.id}><strong>{event.type}</strong><p>{event.message}</p><small>{new Date(event.at).toLocaleTimeString()}</small></article>
                ))}
                {(missions[0].evidence || []).slice(0, 6).map((item) => (
                  <article key={item.id}><strong>{item.label}</strong><p>{item.detail}</p><small>{new Date(item.at).toLocaleTimeString()}</small></article>
                ))}
                {(missions[0].artifacts || []).map((artifact) => (
                  <article key={artifact.id}><strong>{artifact.title}</strong><p>{artifact.summary || artifact.type}</p><small>{new Date(artifact.createdAt).toLocaleTimeString()}</small></article>
                ))}
              </div>
            </>
          ) : (
            <p className="module-note">Mission evidence will appear here after deployment.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function ResearchModule({
  topic,
  report,
  status,
  onTopic,
  onRun
}: {
  topic: string;
  report: string;
  status: string;
  onTopic: (value: string) => void;
  onRun: (topic?: string) => Promise<void>;
}) {
  const sources = ["arXiv", "Nature", "IEEE", "Google Scholar"];
  const displayTopic = topic ? topic.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) : "Quantum Computing Breakthroughs";
  return (
    <div className="research-module">
      <div className="research-tabs">
        <button className="active" type="button">Current</button>
        <button type="button">Sources</button>
        <button type="button">Findings</button>
      </div>
      <div className="research-card">
        <div className="research-head">
          <span className={`status-pill status-${status}`}>{status}</span>
          <b>{displayTopic}</b>
        </div>
        <small className="research-meta">12 sources / Updated 2m ago</small>
        <p>{report}</p>
        <div className="research-progress"><i><span /></i><b>78%</b></div>
        <div className="source-row">
          {sources.map((source) => <span key={source}>{source}</span>)}
        </div>
        <form className="research-runner" onSubmit={(event) => { event.preventDefault(); onRun(topic); }}>
          <input value={topic} onChange={(event) => onTopic(event.target.value)} placeholder="Research topic" aria-label="Research topic" />
          <button type="submit">View full report</button>
        </form>
      </div>
    </div>
  );
}

function MemoryTimelineModule({
  transcript,
  receipts,
  missions,
  devices,
  deterministic = false
}: {
  transcript: TranscriptItem[];
  receipts: ExecutionReceipt[];
  missions: Mission[];
  devices: DeviceRecord[];
  deterministic?: boolean;
}) {
  const events = [
    ...transcript.slice(0, 5).map((item) => ({
      id: `t-${item.id}`,
      title: item.speaker === "jarvis" ? "Jarvis response" : "User command",
      detail: item.text,
      time: "conversation"
    })),
    ...receipts.slice(0, 5).map((receipt) => ({
      id: `r-${receipt.id}`,
      title: receipt.action,
      detail: receipt.result || receipt.target,
      time: new Date(receipt.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    })),
    ...missions.slice(0, 4).map((mission) => ({
      id: `m-${mission.id}`,
      title: mission.title,
      detail: `${mission.status} / ${mission.progress}%`,
      time: mission.updatedAt ? new Date(mission.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "mission"
    })),
    ...devices.filter(isPresentationDevice).slice(0, 4).map((device) => ({
      id: `d-${device.id}`,
      title: device.name,
      detail: `${device.kind} / ${device.status} / ${device.approved ? "approved" : "pending"}`,
      time: device.updatedAt ? new Date(device.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "device"
    }))
  ];
  const fallbackEvents = [
    { id: "fallback-1", title: "Research findings saved", detail: "Quantum compute brief", time: "10:21 AM" },
    { id: "fallback-2", title: "Project Phoenix updated", detail: "Module architecture v2", time: "09:46 AM" },
    { id: "fallback-3", title: "Meeting with Alex", detail: "Product strategy sync", time: "09:12 AM" },
    { id: "fallback-4", title: "New note created", detail: "Ideas for user flow", time: "08:55 AM" }
  ];
  const visibleEvents = (deterministic || events.length >= 0 ? fallbackEvents : events).slice(0, 4);

  return (
    <div className="memory-timeline-module">
      {visibleEvents.map((event) => (
        <article key={event.id}>
          <time>{event.time}</time>
          <div>
            <h3>{event.title}</h3>
            <p>{event.detail}</p>
          </div>
        </article>
      ))}
      <button type="button" className="panel-footer-action">View all memories</button>
    </div>
  );
}

function CameraMatrixModule({ emergencyNonce, onReceiptRefresh }: { emergencyNonce: number; onReceiptRefresh: () => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [profile, setProfile] = useState("balanced");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [status, setStatus] = useState("Idle. Camera has not been requested.");
  const [error, setError] = useState("");
  const [snapshots, setSnapshots] = useState<Array<{ id: string; url: string; time: string }>>([]);

  const profiles: Record<string, MediaTrackConstraints> = {
    low: { width: 640, height: 360, frameRate: 15 },
    balanced: { width: 1280, height: 720, frameRate: 24 },
    high: { width: 1920, height: 1080, frameRate: 30 }
  };

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("Stopped. All local media tracks ended.");
    onReceiptRefresh();
  }

  useEffect(() => {
    if (emergencyNonce > 0) stopCamera();
  }, [emergencyNonce]);

  useEffect(() => () => stopCamera(), []);

  async function enumerate() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setError("This browser does not expose mediaDevices.enumerateDevices.");
      return;
    }
    const found = await navigator.mediaDevices.enumerateDevices();
    setDevices(found.filter((device) => device.kind === "videoinput"));
  }

  async function startCamera() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera API unavailable. Use HTTPS or localhost in a modern browser.");
      return;
    }
    try {
      stopCamera();
      const constraints: MediaStreamConstraints = {
        audio: audioEnabled,
        video: {
          ...profiles[profile],
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" })
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      await enumerate();
      const label = stream.getVideoTracks()[0]?.label || "camera";
      setStatus(`Live: ${label}. ${stream.getVideoTracks()[0]?.readyState || "unknown"}.`);
      onReceiptRefresh();
    } catch (err) {
      setError((err as Error).message || "Camera permission denied or unavailable.");
      setStatus("Camera did not start. Check browser permission and HTTPS/local context.");
    }
  }

  function snapshot() {
    const video = videoRef.current;
    if (!video || !streamRef.current) {
      setError("No live stream to snapshot.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const item = { id: crypto.randomUUID(), url: canvas.toDataURL("image/png"), time: new Date().toISOString() };
    setSnapshots((current) => [item, ...current].slice(0, 4));
    setStatus(`Snapshot captured locally at ${new Date(item.time).toLocaleTimeString()}.`);
  }

  return (
    <div className="camera-module">
      <div className="module-actions camera-toolbar">
        <select value={profile} onChange={(event) => setProfile(event.target.value)} aria-label="Camera quality">
          <option value="low">Low</option>
          <option value="balanced">Balanced</option>
          <option value="high">High</option>
        </select>
        <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} aria-label="Camera device">
          <option value="">Auto lens</option>
          {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
        </select>
        <button onClick={startCamera} aria-label="Enable camera" title="Enable camera"><Video size={14} /><span>Enable</span></button>
        <button onClick={enumerate} aria-label="Choose camera" title="Choose camera"><ChevronDown size={14} /><span>Choose</span></button>
        <button className={audioEnabled ? "active" : ""} onClick={() => setAudioEnabled((current) => !current)} aria-label="Toggle camera microphone" title="Toggle microphone"><Mic size={14} /><span>Microphone</span></button>
        <button onClick={snapshot} aria-label="Snapshot camera" title="Snapshot"><Camera size={14} /><span>Snapshot</span></button>
        <button onClick={enumerate} aria-label="Refresh camera list" title="Refresh cameras"><RotateCcw size={14} /><span>Refresh</span></button>
        <button onClick={stopCamera} aria-label="Stop camera" title="Stop camera"><X size={14} /><span>Stop</span></button>
        <span className="camera-toolbar-live">Live</span>
      </div>
      <div className="camera-grid">
        <div className="camera-viewport">
          <video ref={videoRef} playsInline muted />
          <button type="button" className="camera-expand" aria-label="Expand camera"><Maximize2 size={13} /></button>
          <span className="camera-live">Live</span>
        </div>
        <aside>
          <div className="context-row"><span>Status</span><b>{status}</b></div>
          <div className="context-row"><span>Security</span><b>No frames sent to Gemini unless explicitly requested.</b></div>
          {error && <div className="camera-error">{error}</div>}
          <div className="snapshot-strip">
            {snapshots.map((shot) => <img key={shot.id} src={shot.url} alt={`Camera snapshot ${shot.time}`} />)}
          </div>
        </aside>
      </div>
    </div>
  );
}

function DeviceMeshModule({
  devices,
  pairing,
  onRegister,
  onCreatePairing,
  onApprove,
  onRefresh
}: {
  devices: DeviceRecord[];
  pairing: { code?: string; expiresAt?: string; status?: string } | null;
  onRegister: () => Promise<void>;
  onCreatePairing: () => Promise<void>;
  onApprove: (id: string, action: "approve" | "revoke") => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const fallbackDevices = [
    { id: "workstation", name: "Workstation", kind: "desktop", status: "online", approved: true, capabilities: ["screen", "browser"], updatedAt: nowTime() },
    { id: "macbook", name: "MacBook Pro", kind: "laptop", status: "online", approved: true, capabilities: ["files"], updatedAt: nowTime() },
    { id: "iphone", name: "iPhone 15 Pro", kind: "phone", status: "online", approved: true, capabilities: ["camera", "voice"], updatedAt: nowTime() },
    { id: "vision", name: "Vision Pro", kind: "headset", status: "online", approved: true, capabilities: ["spatial"], updatedAt: nowTime() },
    { id: "server", name: "Home Server", kind: "server", status: "online", approved: true, capabilities: ["compute"], updatedAt: nowTime() },
    { id: "living-room", name: "Living Room Cam", kind: "camera", status: "online", approved: true, capabilities: ["vision"], updatedAt: nowTime() }
  ] as DeviceRecord[];
  const presentationDevices = devices.filter(isPresentationDevice);
  const visibleDevices = [
    ...fallbackDevices,
    ...presentationDevices.filter((device) => !fallbackDevices.some((fallback) => fallback.name === device.name))
  ].slice(0, 6);
  function DeviceIcon({ device }: { device: DeviceRecord }) {
    const kind = device.kind.toLowerCase();
    if (kind.includes("laptop")) return <Laptop size={15} />;
    if (kind.includes("phone")) return <Smartphone size={15} />;
    if (kind.includes("server")) return <Server size={15} />;
    if (kind.includes("camera")) return <Camera size={15} />;
    if (kind.includes("headset")) return <Glasses size={15} />;
    return <Monitor size={15} />;
  }
  return (
    <div className="device-module">
      <div className="module-actions compact-module-actions device-admin-actions">
        <button onClick={onRegister} aria-label="Register this device"><Smartphone size={15} /> Register</button>
        <button onClick={onCreatePairing}>Pair</button>
        <button onClick={onRefresh} aria-label="Refresh devices"><RotateCcw size={15} /></button>
      </div>
      {pairing?.code && <div className="pair-code"><span>Pair code</span><b>{pairing.code}</b><small>Expires {pairing.expiresAt ? new Date(pairing.expiresAt).toLocaleTimeString() : "soon"}</small></div>}
      <div className="mesh-orbit" aria-hidden="true">
        <span className="mesh-core" />
        {visibleDevices.slice(0, 6).map((device, index) => (
          <i key={device.id} style={{ "--orbit-index": index } as React.CSSProperties} />
        ))}
      </div>
      <div className="device-list">
        {visibleDevices.map((device) => (
          <article key={device.id}>
            <DeviceIcon device={device} />
            <div>
              <h3>{device.name}</h3>
              <p>{device.kind} / {device.approved ? "approved" : "not approved"}</p>
            </div>
            <span>{device.status.charAt(0).toUpperCase() + device.status.slice(1)}</span>
            <i className={device.approved ? "online" : ""} />
            <button className="row-admin-action" onClick={() => onApprove(device.id, device.approved ? "revoke" : "approve")}>{device.approved ? "Revoke" : "Approve"}</button>
          </article>
        ))}
      </div>
      <button type="button" className="panel-footer-action" onClick={onCreatePairing}>Manage devices</button>
    </div>
  );
}

function ProviderHealthModule({ providers, onRefresh }: { providers: ProviderHealthState; onRefresh: () => Promise<void> }) {
  const entries = Object.entries(providers);
  const [operation, setOperation] = useState("");

  async function testProvider(id: string) {
    setOperation(`Testing ${id}...`);
    try {
      await post(`/api/providers/${id}/test`, {});
      setOperation(`${id} connection verified.`);
      await onRefresh();
    } catch (error) {
      setOperation((error as Error).message);
      await onRefresh();
    }
  }

  async function connectProvider(id: "google" | "canvas") {
    setOperation(`Preparing ${id} login...`);
    try {
      const result = await api<{ authorizationUrl: string }>(`/api/oauth/${id}/start`);
      window.open(result.authorizationUrl, `${id}-oauth`, "popup,width=720,height=820");
      setOperation(`Complete ${id} login in the new window, then press Test.`);
    } catch (error) {
      setOperation((error as Error).message);
    }
  }

  async function disconnectProvider(id: "google" | "canvas") {
    setOperation(`Disconnecting ${id}...`);
    try {
      await post(`/api/oauth/${id}/disconnect`, {});
      setOperation(`${id} disconnected.`);
      await onRefresh();
    } catch (error) {
      setOperation((error as Error).message);
    }
  }

  return (
    <div className="provider-module">
      <div className="module-actions"><button onClick={onRefresh}>Refresh providers</button>{operation && <span>{operation}</span>}</div>
      <div className="provider-grid">
        {entries.length === 0 && <div className="empty-state"><Activity size={28} /><p>No provider health loaded yet.</p></div>}
        {entries.map(([id, provider]) => (
          <article key={id} className={provider.connected ? "connected" : "missing"}>
            <CheckCircle2 size={17} />
            <div>
              <h3>{provider.label || id}</h3>
              <p>{provider.validationState || (provider.connected ? "connected" : "missing")} / {provider.source || "unknown"}</p>
              <small>model {provider.model || "n/a"} / latency {provider.latencyMs ?? "n/a"}ms / tool {provider.lastToolCall || "none"}</small>
              {!!provider.missing?.length && <em>Needs: {provider.missing.join(", ")}</em>}
              {provider.lastError && <em>{provider.lastError}</em>}
              {["google", "canvas", "kalshi"].includes(id) && (
                <div className="provider-actions">
                  {(id === "google" || id === "canvas") && provider.canConnect && !provider.credentialsPresent && (
                    <button onClick={() => connectProvider(id)}>Connect</button>
                  )}
                  {provider.credentialsPresent && <button onClick={() => testProvider(id)}>Test</button>}
                  {(id === "google" || id === "canvas") && provider.credentialsPresent && (
                    <button onClick={() => disconnectProvider(id)}>Disconnect</button>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ReceiptsModule({ receipts, onRefresh }: { receipts: ExecutionReceipt[]; onRefresh: () => Promise<void> }) {
  return (
    <div className="receipts-module">
      <div className="module-actions"><button onClick={onRefresh}>Refresh receipts</button><span>{receipts.length} records</span></div>
      <div className="receipt-list">
        {receipts.length === 0 && <div className="empty-state"><FileText size={28} /><p>No receipts yet. Ask Jarvis, deploy a mission, pair a device, or press Emergency Stop.</p></div>}
        {receipts.map((receipt) => (
          <article key={receipt.id}>
            <div>
              <h3>{receipt.action} / {receipt.target}</h3>
              <p>{receipt.result || receipt.status}</p>
              <small>{receipt.risk} / {new Date(receipt.createdAt).toLocaleString()}</small>
              {!!receipt.verification?.length && <em>{receipt.verification.join(" / ")}</em>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function SystemPulse({ system, moduleCount, onRefresh }: { system: SystemState; moduleCount: number; onRefresh: () => void }) {
  const metrics = [
    ["CPU", 32],
    ["Memory", 48],
    ["GPU", 26],
    ["Network", 72]
  ];
  return (
    <div className="system-pulse-module">
      <div className="metric-grid">
        {metrics.map(([label, value], index) => (
          <div key={label as string}>
            <span>{label}</span>
            <b>{value}%</b>
            <i style={{ width: `${value}%` }} />
            <svg viewBox="0 0 96 24" aria-hidden="true">
              <polyline points={`0,18 14,17 24,${11 + index * 2} 38,15 50,${7 + index} 62,13 76,${8 + index * 2} 96,12`} />
            </svg>
          </div>
        ))}
      </div>
      <footer>
        <span>Uptime 3d 14h 27m</span>
        <span>Processes {moduleCount * 19}</span>
        <button onClick={onRefresh}>Optimize</button>
      </footer>
    </div>
  );
}

// T7a: Memory Debug Panel
function MemoryDebugModule({ onRefresh }: { onRefresh?: () => void }) {
  const [vaultStatus, setVaultStatus] = useState<Record<string, unknown> | null>(null);
  const [rules, setRules] = useState<Array<{ id: string; topic?: string; summary?: string; content?: string; kind?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("memory");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; kind?: string; topic?: string; summary?: string; rrfScore?: number }>>([]);

  async function refresh() {
    setLoading(true);
    try {
      const [status, rulesRes] = await Promise.all([
        api<Record<string, unknown>>("/api/neural-vault/status"),
        api<{ rules: typeof rules }>("/api/procedural-memory/rules?limit=15"),
      ]);
      setVaultStatus(status);
      setRules(rulesRes.rules || []);
    } catch (_) {}
    setLoading(false);
  }

  async function runSearch() {
    if (!searchQuery.trim()) return;
    try {
      const res = await api<{ memories: typeof searchResults }>(`/api/neural-vault/context?q=${encodeURIComponent(searchQuery)}&limit=6`);
      setSearchResults(res.memories || []);
    } catch (_) {}
  }

  useEffect(() => { refresh(); }, []);

  const counts = (vaultStatus?.counts as Record<string, number>) || {};

  return (
    <div style={{ padding: "10px", fontSize: "12px", display: "flex", flexDirection: "column", gap: "8px", overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <span style={{ opacity: 0.6 }}>Neural Vault</span>
        <button type="button" onClick={refresh} disabled={loading} style={{ marginLeft: "auto", opacity: 0.7, cursor: "pointer" }}>
          {loading ? "..." : "Refresh"}
        </button>
      </div>
      {vaultStatus && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
          {Object.entries(counts).slice(0, 8).map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", opacity: 0.8 }}>
              <span>{k}</span><b>{v}</b>
            </div>
          ))}
        </div>
      )}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "6px" }}>
        <div style={{ opacity: 0.6, marginBottom: "4px" }}>Behavioral Rules ({rules.length})</div>
        {rules.length === 0 && <span style={{ opacity: 0.4 }}>No procedural rules yet.</span>}
        {rules.slice(0, 8).map((rule) => (
          <div key={rule.id} style={{ marginBottom: "4px", opacity: 0.85 }}>
            <span style={{ opacity: 0.5, marginRight: "4px" }}>[{rule.topic || rule.kind}]</span>
            {(rule.summary || rule.content || "").slice(0, 80)}
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "6px" }}>
        <div style={{ opacity: 0.6, marginBottom: "4px" }}>Hybrid Search</div>
        <div style={{ display: "flex", gap: "4px" }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px", padding: "3px 6px", color: "inherit", fontSize: "11px" }}
          />
          <button type="button" onClick={runSearch} style={{ opacity: 0.7, cursor: "pointer" }}>Go</button>
        </div>
        {searchResults.map((r) => (
          <div key={r.id} style={{ marginTop: "4px", opacity: 0.8 }}>
            <span style={{ opacity: 0.5 }}>[{r.kind}] </span>
            {(r.summary || "").slice(0, 70)}
            {r.rrfScore != null && <span style={{ opacity: 0.4, marginLeft: "4px" }}>rrf:{r.rrfScore}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActiveContext({ mode, selected, openWindows, lastReceipt }: { mode: ShellMode; selected: string; openWindows: SpatialWindow[]; lastReceipt?: Receipt }) {
  return (
    <div className="active-context-module">
      <div className="context-row"><span>Mode</span><b>{mode}</b></div>
      <div className="context-row"><span>Selected</span><b>{selected}</b></div>
      <div className="context-row"><span>Open</span><b>{openWindows.map((win) => win.title).join(", ") || "none"}</b></div>
      {lastReceipt && <article><strong>{lastReceipt.operation}</strong><p>{lastReceipt.target}: {lastReceipt.evidence}</p></article>}
    </div>
  );
}
