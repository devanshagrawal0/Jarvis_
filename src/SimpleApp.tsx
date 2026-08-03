import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Blocks,
  Camera,
  Check,
  ChevronRight,
  CircleStop,
  FolderKanban,
  LineChart,
  Download,
  ExternalLink,
  FileText,
  Link,
  Mic,
  MonitorUp,
  Plug,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  X
} from "lucide-react";
import { api, post, resolveOwnerChallenge, saveAccessToken, streamPost } from "./api";
import { LiveVoiceController } from "./liveVoice";
import type { Project, SystemState } from "./types";
import { HelixRoom } from "./rooms/HelixRoom";
import { MeshPanel } from "./MeshPanel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { JarvisBackground, type ScreenRects } from "./JarvisBackground";
import { ScreenPanels } from "./ScreenPanels";
import "./simple.css";

type Phase = "idle" | "listening" | "thinking" | "acting" | "speaking" | "error";
type ToolView = "modules" | "projects" | "agents" | "providers" | "markets" | "vision" | "memory" | "devices" | "coop" | "receipts" | null;
type Message = {
  id: string;
  speaker: "user" | "jarvis";
  text: string;
  time: string;
  confirmations?: Array<{
    id: string;
    tool: string;
    risk: string;
    summary?: { reason?: string };
    message?: string;
  }>;
  sources?: Array<{ title: string; url: string }>;
};
type Mission = {
  id: string;
  title: string;
  role?: string;
  status: string;
  progress: number;
  error?: string;
};
type Provider = {
  label?: string;
  connected: boolean;
  credentialsPresent?: boolean;
  canConnect?: boolean;
  validationState?: string;
  missing?: string[];
  lastError?: string;
  latencyMs?: number | null;
};
type Receipt = {
  id: string;
  action: string;
  target: string;
  status: string;
  result?: string;
  createdAt: string;
};
type Market = {
  ticker: string;
  title: string;
  yesBid?: number | null;
  yesAsk?: number | null;
  volume?: number;
};
type JarvisModule = {
  id: string;
  title: string;
  category: string;
  status: "installed" | "available" | "disabled";
  summary: string;
  ready?: boolean;
  blockedReason?: string;
  missingProviders?: string[];
};
type Capability = {
  name: string;
  description: string;
  risk: string;
  confirmationRequired: boolean;
};
type LifeGraph = {
  summary: Record<string, number>;
  buckets: Record<string, Array<{ id: string; text: string; category: string; kind: string; updatedAt: string }>>;
  entities: Array<{ type: string; name: string; count: number }>;
};
type Device = {
  id: string;
  name: string;
  kind: string;
  role?: string;
  trustLevel?: string;
  status: string;
  approved: boolean;
  capabilities?: string[];
  permissions?: Record<string, boolean>;
  lastSeenAt?: string;
};
type DeviceFile = {
  name: string;
  fileName?: string;
  path: string;
  bytes: number;
  mimeType?: string;
  isImage?: boolean;
  url?: string;
  modifiedAt?: string;
  deviceId?: string;
};
type MeshObject = {
  id: string;
  type: string;
  name: string;
  summary?: string;
  sourceDeviceId?: string;
  sourceDeviceName?: string;
  mimeType?: string;
  bytes?: number;
  url?: string;
  text?: string;
  link?: string;
  tags?: string[];
  status?: string;
  createdAt?: string;
};
type MeshCommand = {
  id: string;
  type: string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  targetDeviceId?: string;
  sourceDeviceId?: string;
  priority?: string;
  status: string;
  requiresAck?: boolean;
  createdAt?: string;
  executedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
};
type MeshStatus = {
  meshVersion: string;
  meshRuntimeVersion?: string;
  currentDevice?: Device | null;
  devices: Device[];
  neuralDevices?: Device[];
  localUrls: string[];
  publicUrls?: string[];
  stablePhoneUrl?: string;
  webhookBaseUrl?: string;
  connection?: {
    host: string;
    port: number;
    candidates: Array<{ address?: string; label: string; baseUrl: string; pairUrl?: string; pairable: boolean; reason?: string; risk?: string; isLocalhost?: boolean; isLan?: boolean; isHttps?: boolean; isPublic?: boolean }>;
    preferred: { baseUrl: string; source: string };
    events: Array<{ id: string; type: string; summary: string; status: string; createdAt: string }>;
    selfTestReportPath?: string;
  };
  liveScreen?: {
    active: boolean;
    paused: boolean;
    sessionId?: string;
    startedAt?: string;
    stoppedAt?: string;
    quality?: string;
    targetFps?: number;
    lastFrameUrl?: string;
    lastFrameId?: string;
    lastFrameDimensions?: string;
    lastCaptureAt?: string;
    frameCount?: number;
    error?: string;
  };
  controlBaton?: {
    status: string;
    holderDeviceId?: string;
    holderDeviceName?: string;
    requestedBy?: string;
    reason?: string;
    grantedBy?: string;
    requestedAt?: string;
    approvedAt?: string;
    expiresAt?: string;
    lastEventAt?: string;
  };
  emergencyStopped?: boolean;
  ghostSandbox?: {
    active?: boolean;
    deviceId?: string;
    deviceName?: string;
    startedAt?: string;
    windowOpened?: boolean;
  };
  memory?: {
    devices: number;
    sessions: number;
    permissions: number;
    inboxItems: number;
    overlays: number;
    replays: number;
    lastPhoneCapture?: string;
    lastInboxItem?: string;
    lastSession?: string;
  } | null;
  objects: MeshObject[];
  commands: MeshCommand[];
  trustLevels?: Record<string, { id: string; label: string; permissions: Record<string, boolean> }>;
  roles?: Record<string, string[]>;
};
type PairPayload = {
  pairing: { code: string; expiresAt: string; status?: string };
  pairUrls: string[];
  qrDataUrl?: string;
  preferredPairUrl?: string;
  qrUrl?: string;
  expiresInSeconds?: number;
  candidates?: Array<{ address?: string; label: string; baseUrl: string; pairUrl?: string; pairable: boolean; reason?: string; risk?: string; isLocalhost?: boolean; isLan?: boolean; isHttps?: boolean; isPublic?: boolean }>;
  diagnostics?: { ok: boolean; selectedUrl?: string; qrContainsLocalhost?: boolean; needsHttpsForCamera?: boolean; message?: string; checklist?: string[] };
};
type MeshMemorySummary = {
  devices: Device[];
  sessions: Array<{ id: string; title: string; status: string; mode: string; startedAt: string; endedAt?: string }>;
  permissions: Array<{ id: string; deviceId: string; permission: string; status: string; expiresAt?: string }>;
  inboxItems: Array<{ id: string; sourceDeviceId: string; itemType: string; summary?: string; textPreview?: string; url?: string; path?: string; createdAt: string }>;
  overlays: Array<{ id: string; overlayType: string; source: string; timestamp: string }>;
  replays: Array<{ id: string; replayType: string; summary: string; createdAt: string }>;
};
type MemoryOsObject = {
  id: string;
  uri: string;
  filePath: string;
  type: string;
  title: string;
  summary?: string;
  contentPreview?: string;
  status: string;
  checksum?: string;
  updatedAt?: string;
  fileExists?: boolean;
};
type MemoryOsStatus = {
  ok: boolean;
  version: string;
  root: string;
  folders: Record<string, string>;
  counts: Record<string, number>;
  agents: Array<{ id: string; name: string; description: string; filePath: string; lastRun?: { status: string; summary: string } | null }>;
  reports: string[];
};
type MemoryOsQuery = {
  query: string;
  objects: MemoryOsObject[];
  answerSummary: string;
  confidence: number;
  lowConfidence: boolean;
};
type MemoryOsFile = {
  filePath: string;
  memoryUri?: string;
  fileType?: string;
  purposeSummary?: string;
  ownerModule?: string;
  checksum?: string;
  indexedAt?: string;
};
type CoOpFile = {
  path: string;
  size: number;
  hash: string;
  language?: string;
  modifiedAt?: string;
  shareMode: "read" | "suggest" | "edit" | "blocked";
  reasonBlocked?: string;
  badge?: string;
};
type CoOpPatch = {
  id: string;
  filePath: string;
  author: string;
  summary: string;
  status: string;
  riskLevel?: string;
  ghostResult?: { status: string; summary: string; build?: string; tests?: string };
  createdAt?: string;
};
type CoOpSession = {
  id: string;
  title: string;
  status: string;
  mode: string;
  code?: string;
  expiresAt?: string;
  inviteLinks?: string[];
  peerName?: string;
  repoMatch?: string;
  connectionMode?: string;
  transport?: { mode?: string; signaling?: string; dataChannel?: string; media?: string; relay?: string; latencyMs?: number; lastHeartbeat?: string };
  manifestSummary?: { total: number; shared: number; blocked: number };
  abilities?: Record<string, boolean>;
  pendingJoin?: { id: string; displayName: string; status: string; requestedAt: string };
  patches: CoOpPatch[];
  chat: Array<{ id: string; senderName: string; text: string; timestamp: string }>;
  jarvisMessages: Array<{ id: string; fromJarvisId: string; messageType: string; payload: Record<string, unknown>; timestamp: string }>;
  tasks: Array<{ id: string; title: string; status: string; assignedTo?: string }>;
  memoryPackets: Array<{ id: string; scope: string; status: string; blocked?: string[] }>;
  skillTransfers: Array<{ id: string; skillId: string; status: string; skillManifest?: { name?: string; description?: string } }>;
  replays: Array<{ id: string; summary: string; replayType: string; createdAt: string }>;
};
type CoOpStatus = {
  ok: boolean;
  moduleName: string;
  label: string;
  runtimeVersion: string;
  activeSession: CoOpSession | null;
  sessions: CoOpSession[];
  manifestSummary: { total: number; shared: number; blocked: number };
  repoFingerprint?: Record<string, string>;
  transportCapabilities: Record<string, unknown>;
};
type CoOpMemorySummary = {
  counts: Record<string, number>;
  sessions: Array<{ id: string; title: string; peerName?: string; status: string; summary?: string }>;
  events: Array<{ id: string; eventType: string; actor: string; timestamp: string }>;
  patches: Array<{ id: string; filePath: string; status: string; summary: string }>;
  tasks: Array<{ id: string; title: string; status: string; assignedTo?: string }>;
  replays: Array<{ id: string; replayType: string; summary: string; createdAt: string }>;
  storage?: { tables: string[] };
};
type HoloWidgetId = "jarvis" | "devices" | "agents" | "projects" | "memory" | "vision" | "modules" | "kalshi";
type HoloWidgetState = {
  id: HoloWidgetId;
  title: string;
  tool: Exclude<ToolView, null>;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  closed: boolean;
  tone: "cyan" | "blue" | "green" | "gold";
};
type WidgetInteraction = {
  id: HoloWidgetId;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  initial: HoloWidgetState;
};

const TOOLS: Array<{ id: Exclude<ToolView, null>; label: string; icon: typeof Activity }> = [
  { id: "modules", label: "Modules", icon: Blocks },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "providers", label: "Connections", icon: Plug },
  { id: "markets", label: "Kalshi", icon: LineChart },
  { id: "vision", label: "Vision", icon: Camera },
  { id: "memory", label: "Memory", icon: Sparkles },
  { id: "devices", label: "Devices", icon: MonitorUp },
  { id: "coop", label: "Co-Op", icon: Link },
  { id: "receipts", label: "Receipts", icon: Check }
];
const DEFAULT_HOLO_WIDGETS: HoloWidgetState[] = [
  { id: "devices", title: "Device Mesh", tool: "devices", x: 22, y: 72, w: 324, h: 254, z: 5, minimized: false, closed: false, tone: "cyan" },
  { id: "agents", title: "Agent Rail", tool: "agents", x: 24, y: 344, w: 316, h: 238, z: 4, minimized: false, closed: false, tone: "blue" },
  { id: "vision", title: "Vision Feed", tool: "vision", x: 368, y: 86, w: 318, h: 238, z: 6, minimized: false, closed: false, tone: "green" },
  { id: "modules", title: "Module Matrix", tool: "modules", x: 1038, y: 86, w: 318, h: 278, z: 4, minimized: false, closed: false, tone: "gold" },
  { id: "kalshi", title: "Kalshi Pulse", tool: "markets", x: 708, y: 82, w: 300, h: 214, z: 3, minimized: false, closed: false, tone: "green" },
  { id: "jarvis", title: "Jarvis Core", tool: "modules", x: 702, y: 602, w: 390, h: 182, z: 7, minimized: false, closed: false, tone: "cyan" },
];

function timeLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function greeting() {
  const hour = new Date().getHours();
  const period = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Good ${period}, sir. How can I assist you?`;
}

function phaseLabel(phase: Phase) {
  if (phase === "idle") return "Ready";
  if (phase === "listening") return "Listening";
  if (phase === "thinking") return "Thinking";
  if (phase === "acting") return "Working";
  if (phase === "speaking") return "Speaking";
  return "Needs attention";
}

async function captureStream(stream: MediaStream) {
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Camera produced no frame within five seconds.")), 5000);
    const finish = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) finish();
    else {
      video.onloadedmetadata = finish;
      video.oncanplay = finish;
    }
  });
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  if (!video.videoWidth || !video.videoHeight) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Camera returned a blank frame. Check browser camera permission and whether another app is using it.");
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image capture is unavailable.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  stream.getTracks().forEach((track) => track.stop());
  return canvas.toDataURL("image/jpeg", 0.86);
}

function mediaErrorMessage(error: unknown, source: "camera" | "screen") {
  const value = error as Error & { name?: string };
  if (value.name === "NotAllowedError") {
    return source === "camera"
      ? "Camera permission was denied. Click the camera icon in the address bar, allow camera access for this site, then try again."
      : "Screen permission was denied. Start screen analysis again and choose the window or screen to share.";
  }
  if (value.name === "NotFoundError") return "No camera device was found by the browser.";
  if (value.name === "NotReadableError") return "The camera is busy or blocked by another app. Close meeting/camera apps and try again.";
  return value.message || "Vision capture failed.";
}

export default function SimpleApp() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [command, setCommand] = useState("");
  const [toolView, setToolView] = useState<ToolView>(null);
  const [helixActive, setHelixActive] = useState(false);
  const [screenRects, setScreenRects] = useState<ScreenRects>({ left: null, right: null });
  const [holoWidgets, setHoloWidgets] = useState<HoloWidgetState[]>(() => {
    const FORCE_CLOSED = new Set(["memory", "projects"]);
    try {
      const saved = JSON.parse(localStorage.getItem("jarvis.holo.widgets.v3") || "[]") as Partial<HoloWidgetState>[];
      return DEFAULT_HOLO_WIDGETS.map((widget) => ({
        ...widget,
        ...(saved.find((item) => item.id === widget.id) || {}),
        ...(FORCE_CLOSED.has(widget.id) ? { closed: true } : {})
      }));
    } catch {
      return DEFAULT_HOLO_WIDGETS.map((widget) => ({
        ...widget,
        ...(FORCE_CLOSED.has(widget.id) ? { closed: true } : {})
      }));
    }
  });
  const [system, setSystem] = useState<SystemState | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      speaker: "jarvis",
      text: greeting(),
      time: timeLabel()
    }
  ]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [providers, setProviders] = useState<Record<string, Provider>>({});
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketQuery, setMarketQuery] = useState("");
  const [missionDraft, setMissionDraft] = useState("");
  const [modules, setModules] = useState<JarvisModule[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [apps, setApps] = useState<string[]>([]);
  const [lifeGraph, setLifeGraph] = useState<LifeGraph | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceFiles, setDeviceFiles] = useState<DeviceFile[]>([]);
  const [meshStatus, setMeshStatus] = useState<MeshStatus | null>(null);
  const [meshObjects, setMeshObjects] = useState<MeshObject[]>([]);
  const [meshCommands, setMeshCommands] = useState<MeshCommand[]>([]);
  const [latestScreenUrl, setLatestScreenUrl] = useState("");
  const [liveFrameUrl, setLiveFrameUrl] = useState("");
  const [meshMemory, setMeshMemory] = useState<MeshMemorySummary | null>(null);
  const [meshPairInfo, setMeshPairInfo] = useState<PairPayload | null>(null);
  const [meshDiagnostics, setMeshDiagnostics] = useState<Array<{ name: string; ok: boolean; detail?: string; fix?: string }>>([]);
  const [pairQr, setPairQr] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [pairUrls, setPairUrls] = useState<string[]>([]);
  const [meshObjectDraft, setMeshObjectDraft] = useState("");
  const [meshCommandDraft, setMeshCommandDraft] = useState("");
  const [memoryOsStatus, setMemoryOsStatus] = useState<MemoryOsStatus | null>(null);
  const [memoryOsObjects, setMemoryOsObjects] = useState<MemoryOsObject[]>([]);
  const [memoryOsFiles, setMemoryOsFiles] = useState<MemoryOsFile[]>([]);
  const [memoryOsQuery, setMemoryOsQuery] = useState("device mesh");
  const [memoryOsResult, setMemoryOsResult] = useState<MemoryOsQuery | null>(null);
  const [memoryGovernanceStatus, setMemoryGovernanceStatus] = useState<any>(null);
  const [memoryGovernanceApprovals, setMemoryGovernanceApprovals] = useState<any[]>([]);
  const [taskSkillStatus, setTaskSkillStatus] = useState<any>(null);
  const [taskSkillCandidates, setTaskSkillCandidates] = useState<any[]>([]);
  const [localFileStatus, setLocalFileStatus] = useState<any>(null);
  const [localFileRegistry, setLocalFileRegistry] = useState<any[]>([]);
  const [coopStatus, setCoopStatus] = useState<CoOpStatus | null>(null);
  const [coopFiles, setCoopFiles] = useState<CoOpFile[]>([]);
  const [coopMemory, setCoopMemory] = useState<CoOpMemorySummary | null>(null);
  const [coopJoinCode, setCoopJoinCode] = useState("");
  const [coopChatDraft, setCoopChatDraft] = useState("");
  const [coopPatchFile, setCoopPatchFile] = useState("README.md");
  const [coopPatchFind, setCoopPatchFind] = useState("");
  const [coopPatchReplace, setCoopPatchReplace] = useState("");
  const [coopTaskDraft, setCoopTaskDraft] = useState("");
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [moduleQuery, setModuleQuery] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [sheetStatus, setSheetStatus] = useState("");
  const [clock, setClock] = useState(timeLabel());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const liveVoiceRef = useRef<LiveVoiceController | null>(null);
  const wakeRecognitionRef = useRef<unknown>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const widgetInteractionRef = useRef<WidgetInteraction | null>(null);
  const meshWsRef = useRef<WebSocket | null>(null);
  const [meshWsConnected, setMeshWsConnected] = useState(false);
  const webrtcPeers = useRef<Map<string, RTCPeerConnection>>(new Map());

  const latestJarvis = useMemo(
    () => [...messages].reverse().find((message) => message.speaker === "jarvis"),
    [messages]
  );
  const filteredModules = useMemo(() => {
    const query = moduleQuery.trim().toLowerCase();
    if (!query) return modules;
    return modules.filter((module) =>
      `${module.title} ${module.id} ${module.category} ${module.summary}`.toLowerCase().includes(query)
    );
  }, [moduleQuery, modules]);
  const filteredCapabilities = useMemo(() => {
    const query = moduleQuery.trim().toLowerCase();
    if (!query) return capabilities;
    return capabilities.filter((capability) =>
      `${capability.name} ${capability.description} ${capability.risk}`.toLowerCase().includes(query)
    );
  }, [capabilities, moduleQuery]);
  const meshLinkRows = useMemo(() => {
    const rows: Array<{ label: string; url: string }> = [];
    const add = (label: string, url?: string) => {
      const clean = String(url || "").trim();
      if (!clean || rows.some((row) => row.url === clean)) return;
      rows.push({ label, url: clean });
    };
    add("Stable", meshStatus?.stablePhoneUrl);
    add("Tunnel", meshStatus?.webhookBaseUrl);
    for (const meshUrl of meshStatus?.localUrls || []) {
      const label = meshUrl.includes("localhost") || meshUrl.includes("127.0.0.1")
        ? "Local"
        : meshUrl.includes("workers.dev") || meshUrl.includes("trycloudflare.com")
          ? "Public"
          : "LAN";
      add(label, meshUrl);
    }
    return rows;
  }, [meshStatus]);
  const pendingPairDevices = useMemo(
    () => devices.filter((device) => device.status === "claimed_pending_approval" || (!device.approved && device.status === "pending")),
    [devices]
  );
  const openWidgets = useMemo(() => holoWidgets.filter((widget) => !widget.closed && widget.id !== "memory" && widget.id !== "projects"), [holoWidgets]);
  const closedWidgets = useMemo(() => holoWidgets.filter((widget) => widget.closed && widget.id !== "memory" && widget.id !== "projects"), [holoWidgets]);

  const refreshSystem = useCallback(async () => {
    try {
      setSystem(await api<SystemState>("/api/status"));
    } catch {
      setSystem(null);
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    const data = await api<{ projects: Project[] }>("/api/projects");
    setProjects(data.projects || []);
  }, []);

  const refreshMissions = useCallback(async () => {
    const data = await api<{ agents: Mission[] }>("/api/agents");
    setMissions(data.agents || []);
  }, []);

  const refreshProviders = useCallback(async () => {
    const data = await api<{ providers: Record<string, Provider> }>("/api/provider-health");
    setProviders(data.providers || {});
  }, []);

  const refreshReceipts = useCallback(async () => {
    const data = await api<{ receipts: Receipt[] }>("/api/receipts");
    setReceipts(data.receipts || []);
  }, []);

  const refreshLifeGraph = useCallback(async () => {
    const [graph, status, objects, files, governance, approvals, taskSkill, candidates, localFiles, registry] = await Promise.all([
      api<LifeGraph>("/api/memory/life-graph").catch(() => null),
      api<MemoryOsStatus>("/api/memory-os/v4/status").catch(() => null),
      api<{ objects: MemoryOsObject[] }>("/api/memory-os/v4/objects?limit=24").catch(() => ({ objects: [] })),
      api<{ files: MemoryOsFile[] }>("/api/memory-os/v4/files?limit=24").catch(() => ({ files: [] })),
      api<any>("/api/memory-governance/status").catch(() => null),
      api<{ approvals: any[] }>("/api/memory-governance/approvals?limit=8").catch(() => ({ approvals: [] })),
      api<any>("/api/task-to-skill/status").catch(() => null),
      api<{ candidates: any[] }>("/api/task-to-skill/candidates?limit=8").catch(() => ({ candidates: [] })),
      api<any>("/api/local-file-access/status").catch(() => null),
      api<{ files: any[] }>("/api/local-file-access/registry?limit=8").catch(() => ({ files: [] }))
    ]);
    if (graph) setLifeGraph(graph);
    setMemoryOsStatus(status);
    setMemoryOsObjects(objects.objects || []);
    setMemoryOsFiles(files.files || []);
    setMemoryGovernanceStatus(governance);
    setMemoryGovernanceApprovals(approvals.approvals || []);
    setTaskSkillStatus(taskSkill);
    setTaskSkillCandidates(candidates.candidates || []);
    setLocalFileStatus(localFiles);
    setLocalFileRegistry(registry.files || []);
  }, []);

  const refreshDevices = useCallback(async () => {
    const [data, memory] = await Promise.all([
      api<{ devices: Device[]; inbox?: DeviceFile[]; mesh?: MeshStatus & { inbox?: DeviceFile[] } }>("/api/devices"),
      api<MeshMemorySummary>("/api/device-mesh/memory").catch(() => null)
    ]);
    setDevices(data.devices || []);
    setDeviceFiles(data.mesh?.inbox || data.inbox || []);
    if (data.mesh) {
      setMeshStatus(data.mesh);
      setMeshObjects(data.mesh.objects || []);
      setMeshCommands(data.mesh.commands || []);
      if (data.mesh.liveScreen?.lastFrameUrl) setLiveFrameUrl(`${data.mesh.liveScreen.lastFrameUrl}?t=${Date.now()}`);
    }
    setMeshMemory(memory);
  }, []);

  const refreshCoOp = useCallback(async () => {
    const [status, manifest, memory] = await Promise.all([
      api<CoOpStatus>("/api/coop-symbiote/status"),
      api<{ files: CoOpFile[] }>("/api/coop-symbiote/manifest?limit=120").catch(() => ({ files: [] })),
      api<CoOpMemorySummary>("/api/coop-symbiote/memory").catch(() => null),
    ]);
    setCoopStatus(status);
    setCoopFiles(manifest.files || []);
    setCoopMemory(memory);
  }, []);

  const refreshCatalog = useCallback(async () => {
    const [moduleData, capabilityData] = await Promise.all([
      api<{ modules: JarvisModule[] }>("/api/modules"),
      api<{ capabilities: Capability[]; apps: string[] }>("/api/capabilities")
    ]);
    setModules(moduleData.modules || []);
    setCapabilities(capabilityData.capabilities || []);
    setApps(capabilityData.apps || []);
  }, []);

  useEffect(() => {
    localStorage.removeItem("jarvis.holo.widgets.v1");
    setHoloWidgets((current) =>
      current.map((w) => (w.id === "memory" || w.id === "projects" ? { ...w, closed: true } : w))
    );
    // Preload helix transition video in background so it's cached when user enters
    const preload = document.createElement("video");
    preload.src = "/assets/helix-transition-web.mp4";
    preload.preload = "auto";
    preload.muted = true;
  }, []);

  useEffect(() => {
    void refreshSystem();
    void Promise.allSettled([
      refreshCatalog(),
      refreshProjects(),
      refreshMissions(),
      refreshProviders(),
      refreshReceipts(),
      refreshLifeGraph(),
      refreshDevices()
    ]);
    const url = new URL(window.location.href);
    const suppliedTool = url.searchParams.get("tool");
    if (suppliedTool === "devices") setToolView("devices");
    if (suppliedTool === "coop") setToolView("coop");
    if (url.searchParams.get("action") === "ask") window.setTimeout(() => inputRef.current?.focus(), 300);
    const suppliedPairCode = url.searchParams.get("pair_code");
    if (suppliedPairCode) {
      url.searchParams.delete("pair_code");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      post<{ accessToken?: string; requestId: string; device: Device; message?: string }>("/api/pair", {
        code: suppliedPairCode,
        name: /iphone|ipad|android|mobile/i.test(navigator.userAgent) ? "Devansh phone" : "Paired browser",
        kind: /iphone|ipad|android|mobile/i.test(navigator.userAgent) ? "phone" : "browser",
        role: /ipad/i.test(navigator.userAgent) ? "ipad" : /iphone|android|mobile/i.test(navigator.userAgent) ? "phone" : "browser",
        trustLevel: /iphone|ipad|android|mobile/i.test(navigator.userAgent) ? "screen_view" : "upload_only",
        userAgent: navigator.userAgent,
        screen: { width: window.screen.width, height: window.screen.height, devicePixelRatio: window.devicePixelRatio },
        capabilities: ["chat", "uploadFiles", "phoneCameraUpload", "requestLaptopScreen", "object_portal", "push_cards"]
      }).then((result) => {
        if (result.accessToken) {
          saveAccessToken(result.accessToken);
          addMessage("jarvis", `${result.device.name} is paired with JARVIS, sir. This device will stay signed in.`);
          void refreshDevices();
          return;
        }
        addMessage("jarvis", `${result.device.name} requested access, sir. Approve it from the Device Mesh panel to finish pairing.`);
        const pollPairStatus = async () => {
          const status = await api<{ status: string; accessToken?: string; message?: string }>(`/api/pair/status?requestId=${encodeURIComponent(result.requestId)}`);
          if (status.status === "approved" && status.accessToken) {
            saveAccessToken(status.accessToken);
            addMessage("jarvis", `${result.device.name} is now approved and signed in, sir.`);
            void refreshDevices();
            return;
          }
          if (["denied", "expired", "revoked"].includes(status.status)) {
            addMessage("jarvis", `Device pairing ${status.status}: ${status.message || "request closed"}`);
            void refreshDevices();
            return;
          }
          window.setTimeout(() => void pollPairStatus(), 1500);
        };
        void pollPairStatus();
        void refreshDevices();
      }).catch((error) => addMessage("jarvis", `Device pairing failed: ${(error as Error).message}`));
    }
    const suppliedCoopCode = url.searchParams.get("coop_code");
    if (suppliedCoopCode) {
      setToolView("coop");
      setCoopJoinCode(suppliedCoopCode);
      window.setTimeout(() => void joinCoOpSession(suppliedCoopCode), 400);
    }
    api<{ messages: Array<{ id: string; role: "user" | "model"; text: string; createdAt: string; sources?: Message["sources"] }> }>("/api/conversation")
      .then((data) => {
        if (!data.messages.length) return;
        setMessages(data.messages.map((item) => ({
          id: item.id,
          speaker: item.role === "model" ? "jarvis" : "user",
          text: item.text,
          time: new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          sources: item.sources,
        })));
      })
      .catch(() => undefined);
    const clockTimer = window.setInterval(() => setClock(timeLabel()), 1000);
    const statusTimer = window.setInterval(() => void refreshSystem(), 8000);
    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(statusTimer);
      stopWakeWord();
      void liveVoiceRef.current?.stop();
    };
  }, [refreshSystem]);

  useEffect(() => {
    localStorage.setItem("jarvis.holo.widgets.v3", JSON.stringify(holoWidgets));
  }, [holoWidgets]);

  function sendMeshWs(type: string, payload: unknown) {
    const ws = meshWsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }

  async function handleRtcSignal(fromDeviceId: string, signal: Record<string, unknown>) {
    if (signal.type === "screen_share_request") {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 } as MediaTrackConstraints, audio: false });
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        webrtcPeers.current.set(fromDeviceId, pc);
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        pc.onicecandidate = (e) => {
          if (e.candidate) sendMeshWs("rtc_signal", { targetDeviceId: fromDeviceId, signal: { type: "ice_candidate", candidate: e.candidate.toJSON() } });
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            stream.getTracks().forEach(t => t.stop());
            webrtcPeers.current.delete(fromDeviceId);
            pc.close();
          }
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendMeshWs("rtc_signal", { targetDeviceId: fromDeviceId, signal: { type: "offer", sdp: offer.sdp } });
      } catch (err) {
        console.warn("[rtc] getDisplayMedia failed:", err);
      }
    } else if (signal.type === "answer") {
      const pc = webrtcPeers.current.get(fromDeviceId);
      if (pc && signal.sdp) await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.sdp as string }));
    } else if (signal.type === "ice_candidate" && signal.candidate) {
      const pc = webrtcPeers.current.get(fromDeviceId);
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
    }
  }

  // DM-3: WebSocket hub connection â€” laptop browser gets real-time push notifications.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: number | undefined;
    let stopped = false;

    async function connect() {
      if (stopped) return;
      try {
        const { token } = await api<{ token: string; wsUrl: string }>("/api/mesh/host-ws-token");
        if (stopped) return;
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(`${proto}//${window.location.host}/mesh/ws`);
        meshWsRef.current = ws;

        ws.onopen = () => {
          ws!.send(JSON.stringify({ type: "auth", token }));
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data as string) as { type: string; payload?: Record<string, unknown> };
            switch (msg.type) {
              case "auth_ok":
                setMeshWsConnected(true);
                break;
              case "pair_request_pending":
                // Phone is waiting for approval â€” refresh devices list instantly
                void refreshDevices();
                break;
              case "device_ws_connected":
              case "device_ws_disconnected":
                void refreshDevices();
                break;
              case "clipboard":
                // NF-3: Universal Clipboard â€” phone copied something
                if (msg.payload?.text && typeof msg.payload.text === "string") {
                  navigator.clipboard?.writeText(msg.payload.text).catch(() => {});
                }
                break;
              case "rtc_signal": {
                const from = (msg.payload as { fromDeviceId?: string })?.fromDeviceId ?? "";
                const sig = (msg.payload as { signal?: Record<string, unknown> })?.signal ?? {};
                void handleRtcSignal(from, sig);
                break;
              }
              default:
                break;
            }
          } catch {
            // ignore malformed messages
          }
        };

        ws.onclose = () => {
          setMeshWsConnected(false);
          meshWsRef.current = null;
          if (!stopped) retryTimer = window.setTimeout(connect, 8000);
        };

        ws.onerror = () => {
          // onclose will fire after onerror; retry happens there
        };
      } catch {
        if (!stopped) retryTimer = window.setTimeout(connect, 12000);
      }
    }

    void connect();

    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      if (ws) { try { ws.close(); } catch {} }
      meshWsRef.current = null;
      setMeshWsConnected(false);
    };
  }, []);

  useEffect(() => {
    const fitToViewport = () => {
      setHoloWidgets((current) => current.map((widget) => ({
        ...widget,
        x: Math.max(8, Math.min(widget.x, window.innerWidth - Math.min(widget.w, window.innerWidth - 16))),
        y: Math.max(58, Math.min(widget.y, window.innerHeight - 86)),
        w: Math.max(248, Math.min(widget.w, window.innerWidth - 24)),
        h: Math.max(118, Math.min(widget.h, window.innerHeight - 92))
      })));
    };
    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, []);

  useEffect(() => {
    const clampWidget = (widget: HoloWidgetState) => ({
      ...widget,
      x: Math.max(8, Math.min(widget.x, window.innerWidth - Math.min(widget.w, window.innerWidth - 16))),
      y: Math.max(58, Math.min(widget.y, window.innerHeight - 86)),
      w: Math.max(248, Math.min(widget.w, window.innerWidth - 24)),
      h: Math.max(118, Math.min(widget.h, window.innerHeight - 92))
    });
    const handleMove = (event: PointerEvent) => {
      const active = widgetInteractionRef.current;
      if (!active) return;
      event.preventDefault();
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      setHoloWidgets((current) => current.map((widget) => {
        if (widget.id !== active.id) return widget;
        if (active.mode === "move") return clampWidget({ ...widget, x: active.initial.x + dx, y: active.initial.y + dy });
        return clampWidget({ ...widget, w: active.initial.w + dx, h: active.initial.h + dy });
      }));
    };
    const handleUp = () => {
      widgetInteractionRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, []);

  useEffect(() => {
    conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (toolView === "modules") void refreshCatalog();
    if (toolView === "projects") void refreshProjects();
    if (toolView === "agents") void refreshMissions();
    if (toolView === "providers") void refreshProviders();
    if (toolView === "receipts") void refreshReceipts();
    if (toolView === "memory") void refreshLifeGraph();
    if (toolView === "devices") void refreshDevices();
    if (toolView === "coop") void refreshCoOp();
    if (toolView === "markets" && !markets.length) void searchMarkets();
  }, [toolView]);

  useEffect(() => {
    if (toolView !== "devices" || !meshStatus?.liveScreen?.active || meshStatus.liveScreen.paused) return;
    const timer = window.setInterval(() => void refreshLiveFrame(), 1800);
    return () => window.clearInterval(timer);
  }, [toolView, meshStatus?.liveScreen?.active, meshStatus?.liveScreen?.paused]);

  function addMessage(speaker: Message["speaker"], text: string, confirmations?: Message["confirmations"], sources?: Message["sources"]) {
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), speaker, text, time: timeLabel(), confirmations, sources }
    ].slice(-40));
  }

  async function createCoOpSession() {
    setSheetStatus("Creating Symbiote session...");
    try {
      const result = await post<{ session: CoOpSession }>("/api/coop-symbiote/session/create", {
        title: "Jarvis Co-Op Symbiote Mesh",
        mode: "Code Review Mode",
      });
      setCoopStatus((current) => ({ ...(current || {
        ok: true,
        moduleName: "CoOpSymbioteMesh",
        label: "Jarvis Co-Op Symbiote Mesh",
        runtimeVersion: "2.0.0",
        sessions: [],
        manifestSummary: { total: 0, shared: 0, blocked: 0 },
        transportCapabilities: {},
      }), activeSession: result.session, sessions: [result.session, ...(current?.sessions || [])] }));
      addMessage("jarvis", `Symbiote session created, sir. Code: ${result.session.code}`);
      setSheetStatus(`Session code ${result.session.code}.`);
      await refreshCoOp();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function joinCoOpSession(code = coopJoinCode) {
    const clean = code.trim();
    if (!clean) return;
    setSheetStatus("Joining Symbiote session...");
    try {
      const result = await post<{ session: CoOpSession; joinRequest: unknown }>("/api/coop-symbiote/session/join", {
        code: clean,
        displayName: "Trusted friend",
        deviceName: navigator.userAgent.includes("Mobile") ? "Mobile Jarvis" : "Browser Jarvis",
        jarvisVersion: "local-ui",
      });
      setSheetStatus("Join request sent. Host approval required.");
      addMessage("jarvis", `Join request prepared for ${result.session.title}. Host approval is required.`);
      await refreshCoOp();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function approveCoOpJoin(approve: boolean) {
    const session = coopStatus?.activeSession;
    if (!session) return;
    const action = approve ? "approve-join" : "reject-join";
    const result = await post<{ session: CoOpSession }>(`/api/coop-symbiote/session/${encodeURIComponent(session.id)}/${action}`, {});
    setSheetStatus(approve ? "Guest approved." : "Guest rejected.");
    setCoopStatus((current) => current ? { ...current, activeSession: result.session } : current);
    await refreshCoOp();
  }

  async function endCoOpSession() {
    const session = coopStatus?.activeSession;
    if (!session) return;
    const result = await post<{ session: CoOpSession }>(`/api/coop-symbiote/session/${encodeURIComponent(session.id)}/end`, { reason: "Ended from Co-Op Runtime Widget." });
    setSheetStatus("Symbiote session ended and access revoked.");
    setCoopStatus((current) => current ? { ...current, activeSession: result.session } : current);
    await refreshCoOp();
  }

  async function sendCoOpChat() {
    const session = coopStatus?.activeSession;
    const text = coopChatDraft.trim();
    if (!session || !text) return;
    await post("/api/coop-symbiote/chat", { sessionId: session.id, text, senderName: "Devansh" });
    setCoopChatDraft("");
    setSheetStatus("Co-op chat saved.");
    await refreshCoOp();
  }

  async function proposeCoOpPatch() {
    const session = coopStatus?.activeSession;
    if (!session) return;
    await post("/api/coop-symbiote/patches", {
      sessionId: session.id,
      filePath: coopPatchFile,
      originalText: coopPatchFind,
      replacementText: coopPatchReplace,
      summary: `Patch proposal for ${coopPatchFile}`,
      author: "Devansh",
    });
    setSheetStatus("Patch proposal sent to Patch Court.");
    setCoopPatchFind("");
    setCoopPatchReplace("");
    await refreshCoOp();
  }

  async function runCoOpGhostTest(patchId: string) {
    const session = coopStatus?.activeSession;
    if (!session) return;
    await post(`/api/coop-symbiote/patches/${encodeURIComponent(patchId)}/ghost-test`, { sessionId: session.id });
    setSheetStatus("Ghost Sandbox completed.");
    await refreshCoOp();
  }

  async function approveCoOpPatch(patchId: string, approve: boolean) {
    const session = coopStatus?.activeSession;
    if (!session) return;
    await post(`/api/coop-symbiote/patches/${encodeURIComponent(patchId)}/${approve ? "approve" : "reject"}`, { sessionId: session.id, actor: "Devansh" });
    setSheetStatus(approve ? "Patch approved in Patch Court." : "Patch rejected in Patch Court.");
    await refreshCoOp();
  }

  async function askBothJarvis() {
    const session = coopStatus?.activeSession;
    if (!session) return;
    await post("/api/coop-symbiote/debate", { sessionId: session.id, topic: "What is the safest next engineering step for this co-op session?" });
    setSheetStatus("Both Jarvis systems submitted structured opinions.");
    await refreshCoOp();
  }

  async function createCoOpTask() {
    const session = coopStatus?.activeSession;
    const title = coopTaskDraft.trim();
    if (!session || !title) return;
    await post("/api/coop-symbiote/tasks", { sessionId: session.id, title, status: "Todo", assignedTo: "Devansh" });
    setCoopTaskDraft("");
    setSheetStatus("Task added to shared board.");
    await refreshCoOp();
  }

  async function createCoOpMemoryPacket() {
    const session = coopStatus?.activeSession;
    if (!session) return;
    await post("/api/coop-symbiote/memory-packets", { sessionId: session.id, sharedBy: "Devansh" });
    setSheetStatus("Project-only memory packet preview created.");
    await refreshCoOp();
  }

  async function offerCoOpSkill() {
    const session = coopStatus?.activeSession;
    if (!session) return;
    await post("/api/coop-symbiote/skill-transfers", {
      sessionId: session.id,
      name: "co-op-safe-patch-review",
      description: "Review a patch with secret scan, Patch Court, Ghost Sandbox, and memory logging.",
    });
    setSheetStatus("Skill offer created in Skill Transfer Dock.");
    await refreshCoOp();
  }

  async function createCoOpReplay() {
    const session = coopStatus?.activeSession;
    if (!session) return;
    await post("/api/coop-symbiote/replays", { sessionId: session.id, summary: "Co-op session timeline replay." });
    setSheetStatus("Replay Theater captured the session timeline.");
    await refreshCoOp();
  }

  async function saveCoOpReplayAsSkill(replayId: string) {
    const session = coopStatus?.activeSession;
    if (!session) return;
    await post(`/api/coop-symbiote/replays/${encodeURIComponent(replayId)}/skill`, { sessionId: session.id });
    setSheetStatus("Replay converted into a skill transfer offer.");
    await refreshCoOp();
  }

  async function askJarvis(raw?: string) {
    const prompt = (raw ?? inputRef.current?.value ?? "").trim();
    if (!prompt || phase === "thinking") return;
    if (/^(helix|go to helix|open helix|launch helix)$/i.test(prompt)) {
      if (inputRef.current) inputRef.current.value = "";
      setCommand("");
      setHelixActive(true);
      return;
    }
    if (inputRef.current) inputRef.current.value = "";
    setCommand("");
    addMessage("user", prompt);
    const responseId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: responseId, speaker: "jarvis" as const, text: "", time: timeLabel() }
    ].slice(-40));
    setPhase("thinking");
    try {
      const result = await streamPost<{
        response?: string;
        error?: string;
        pendingConfirmations?: Message["confirmations"];
        sources?: Array<{ title: string; url: string }>;
      }>("/api/chat/stream", { prompt, mode: "minimal-command" }, (text) => {
        setPhase("speaking");
        setMessages((current) => current.map((message) => (
          message.id === responseId ? { ...message, text: `${message.text}${text}` } : message
        )));
      });
      setMessages((current) => current.map((message) => (
        message.id === responseId
          ? {
              ...message,
              text: message.text || result.response || result.error || "The request completed without a text response.",
              confirmations: result.pendingConfirmations,
              sources: result.sources
            }
          : message
      )));
      setPhase(result.error ? "error" : "idle");
      void refreshReceipts();
    } catch (error) {
      addMessage("jarvis", (error as Error).message);
      setPhase("error");
    }
  }

  async function approveConfirmation(id: string) {
    setPhase("acting");
    try {
      // Posting `{}` meant every approval from this surface came back 403 "Owner confirmation
      // challenge is invalid" — the engine compares a 32-byte one-time challenge.
      const ownerChallenge = await resolveOwnerChallenge(id);
      const result = await post<{ ok: boolean; error?: string; result?: unknown }>(
        `/api/confirmations/${encodeURIComponent(id)}/approve`,
        { ownerChallenge },
      );
      addMessage("jarvis", result.ok ? "Approved action completed and recorded." : result.error || "The action could not be completed.");
      setPhase(result.ok ? "idle" : "error");
      await refreshReceipts();
    } catch (error) {
      addMessage("jarvis", (error as Error).message);
      setPhase("error");
    }
  }

  async function executeCapability(tool: string, args: Record<string, unknown>, spokenRequest: string) {
    setPhase("acting");
    setSheetStatus(`Running ${tool.replaceAll("_", " ")}...`);
    addMessage("user", spokenRequest);
    try {
      const result = await post<{
        ok: boolean;
        status: string;
        error?: string;
        result?: Record<string, unknown>;
        confirmation?: NonNullable<Message["confirmations"]>[number];
      }>("/api/capabilities/execute", { tool, args });
      if (result.status === "confirmation_required" && result.confirmation) {
        addMessage("jarvis", `I have prepared ${tool.replaceAll("_", " ")}, sir. Approve it when you are ready.`, [result.confirmation]);
        setSheetStatus("Approval required.");
        setPhase("idle");
        return;
      }
      if (!result.ok) throw new Error(result.error || `${tool} failed.`);
      const detail = tool === "open_app"
        ? `Opened ${String(args.app)}, sir.`
        : tool === "open_url"
          ? `Opened ${String(result.result?.url || args.url)}, sir.`
          : `${tool.replaceAll("_", " ")} completed, sir.`;
      addMessage("jarvis", detail);
      setSheetStatus(detail);
      setPhase("idle");
      void refreshReceipts();
    } catch (error) {
      const message = (error as Error).message;
      addMessage("jarvis", message);
      setSheetStatus(message);
      setPhase("error");
    }
  }

  async function getBriefing() {
    if (phase === "thinking") return;
    setPhase("thinking");
    addMessage("user", "Give me today's briefing.");
    try {
      const result = await api<{ response?: string; error?: string; sources?: Message["sources"] }>("/api/briefing");
      addMessage("jarvis", result.response || result.error || "The briefing returned without a response.", undefined, result.sources);
      setPhase(result.error ? "error" : "idle");
    } catch (error) {
      addMessage("jarvis", (error as Error).message);
      setPhase("error");
    }
  }

  function prepareCapability(capability: Capability) {
    setToolView(null);
    window.setTimeout(() => { if (inputRef.current) { inputRef.current.value = `Use ${capability.name.replaceAll("_", " ")} to `; inputRef.current.focus(); } }, 0);
  }

  async function toggleVoice() {
    if (liveVoiceRef.current?.active) {
      await liveVoiceRef.current.stop();
      setPhase("idle");
      return;
    }
    if (!liveVoiceRef.current) {
      liveVoiceRef.current = new LiveVoiceController({
        onState: (state, detail) => {
          setPhase(state === "connecting" ? "thinking" : state);
          if (state === "error" && detail) addMessage("jarvis", detail);
        },
        onInputTranscript: (text) => { if (inputRef.current) inputRef.current.value = text; },
        onTurnComplete: ({ input, output }) => {
          if (input) addMessage("user", input);
          if (output) addMessage("jarvis", output);
          if (input || output) {
            void post("/api/conversation/append", {
              messages: [
                ...(input ? [{ role: "user", text: input }] : []),
                ...(output ? [{ role: "model", text: output }] : []),
              ],
            });
          }
          setCommand("");
        },
        onToolResult: () => void refreshReceipts()
      });
    }
    try {
      await liveVoiceRef.current.start();
      setPhase("listening");
    } catch (error) {
      addMessage("jarvis", `Voice is unavailable: ${(error as Error).message}`);
      setPhase("error");
    }
  }

  function stopWakeWord() {
    const recognition = wakeRecognitionRef.current as { stop?: () => void; abort?: () => void } | null;
    try { recognition?.stop?.(); recognition?.abort?.(); } catch { /* browser cleanup */ }
    wakeRecognitionRef.current = null;
    setWakeEnabled(false);
  }

  function toggleWakeWord() {
    if (wakeEnabled) {
      stopWakeWord();
      setSheetStatus("Wake phrase disabled.");
      return;
    }
    const SpeechRecognition = (window as unknown as {
      SpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        start: () => void;
        stop: () => void;
        abort: () => void;
        onresult: ((event: unknown) => void) | null;
        onend: (() => void) | null;
        onerror: ((event: { error?: string }) => void) | null;
      };
      webkitSpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        start: () => void;
        stop: () => void;
        abort: () => void;
        onresult: ((event: unknown) => void) | null;
        onend: (() => void) | null;
        onerror: ((event: { error?: string }) => void) | null;
      };
    }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addMessage("jarvis", "Wake phrase is not supported in this browser. Use the Talk button, sir.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: unknown) => {
      const results = (event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }).results;
      const text = Array.from(results || [])
        .flatMap((result) => Array.from(result || []))
        .map((item) => item.transcript || "")
        .join(" ")
        .toLowerCase();
      const wakePhrase = system?.settings?.wakePhrase || "jarvis";
      if (text.includes(wakePhrase.toLowerCase())) {
        addMessage("jarvis", "Yes, sir. I am listening.");
        void toggleVoice();
      }
    };
    recognition.onerror = (event: { error?: string }) => {
      setSheetStatus(`Wake phrase error: ${event.error || "unknown"}`);
    };
    recognition.onend = () => {
      if (wakeRecognitionRef.current === recognition) {
        try { recognition.start(); } catch { /* restarted when browser permits */ }
      }
    };
    wakeRecognitionRef.current = recognition;
    recognition.start();
    setWakeEnabled(true);
    setSheetStatus("Wake phrase enabled. Say Jarvis.");
  }

  function exportConversation() {
    const exportedAt = new Date().toISOString();
    const markdown = [
      "# JARVIS Conversation",
      "",
      `Exported: ${exportedAt}`,
      "",
      ...messages.flatMap((message) => [
        `## ${message.speaker === "jarvis" ? "JARVIS" : "You"}`,
        "",
        message.text,
        "",
        ...(message.sources?.length
          ? ["Sources:", ...message.sources.map((source) => `- [${source.title}](${source.url})`), ""]
          : []),
        `_${message.time}_`,
        "",
      ]),
    ].join("\n");
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jarvis-conversation-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function openProject(project: Project) {
    setSheetStatus(`Opening ${project.name}...`);
    try {
      await post("/api/projects/open", { path: project.path });
      setSheetStatus(`${project.name} opened.`);
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function deployMission() {
    const title = missionDraft.trim();
    if (!title) return;
    setSheetStatus("Deploying agent...");
    try {
      await post("/api/agents", { title, objective: title, role: "coordinator" });
      setMissionDraft("");
      setSheetStatus("Agent deployed.");
      await refreshMissions();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function controlMission(id: string, action: "pause" | "resume" | "cancel") {
    try {
      await post(`/api/agents/${id}/${action}`, {});
      await refreshMissions();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function providerAction(id: string, action: "test" | "connect" | "disconnect") {
    setSheetStatus(`${action === "test" ? "Testing" : action === "connect" ? "Connecting" : "Disconnecting"} ${id}...`);
    try {
      if (action === "test") await post(`/api/providers/${id}/test`, {});
      if (action === "disconnect") await post(`/api/oauth/${id}/disconnect`, {});
      if (action === "connect") {
        const result = await api<{ authorizationUrl: string }>(`/api/oauth/${id}/start`);
        window.open(result.authorizationUrl, `${id}-oauth`, "popup,width=720,height=820");
      }
      setSheetStatus(action === "connect" ? "Finish login in the new window, then test the connection." : `${id} ${action} complete.`);
      await refreshProviders();
    } catch (error) {
      setSheetStatus((error as Error).message);
      await refreshProviders();
    }
  }

  async function searchMarkets() {
    setSheetStatus("Loading markets...");
    try {
      const data = await api<{ markets: Market[] }>(`/api/kalshi/markets?q=${encodeURIComponent(marketQuery)}`);
      setMarkets(data.markets || []);
      setSheetStatus(`${data.markets?.length || 0} markets loaded.`);
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function analyzeVision(source: "camera" | "screen") {
    setPhase("acting");
    setSheetStatus(source === "camera" ? "Opening camera..." : "Waiting for screen selection...");
    addMessage("user", source === "camera" ? "Scan what my camera sees." : "Analyze my screen.");
    try {
      const stream = source === "camera"
        ? await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const imageData = await captureStream(stream);
      const result = await post<{ response?: string; error?: string }>("/api/brain", {
        prompt: source === "camera"
          ? "Analyze what the camera sees. Identify useful details and answer concisely."
          : "Analyze this screen. Summarize what is happening and identify the most useful next actions.",
        imageData,
        mode: "vision"
      });
      addMessage("jarvis", result.response || result.error || "Vision analysis completed.");
      setSheetStatus("Analysis added to the conversation.");
      setToolView(null);
      setPhase(result.error ? "error" : "idle");
    } catch (error) {
      const message = mediaErrorMessage(error, source);
      addMessage("jarvis", message);
      setSheetStatus(message);
      setPhase("error");
    }
  }

  async function createPairCode() {
    setSheetStatus("Creating one-time pair code...");
    try {
      const data = await api<PairPayload>("/api/pair");
      setMeshPairInfo(data);
      setPairCode(data.pairing.code);
      setPairUrls(data.preferredPairUrl ? [data.preferredPairUrl, ...(data.pairUrls || []).filter((value) => value !== data.preferredPairUrl)] : data.pairUrls || []);
      setPairQr(data.qrDataUrl || "");
      setSheetStatus(data.diagnostics?.message || "Open the pair URL on your phone or enter the code there.");
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function runMeshSelfTest() {
    try {
      const result = await post<{ ok: boolean; tests: Array<{ name: string; ok: boolean; detail?: string; fix?: string }>; reportPath: string }>("/mesh/api/self-test", {});
      setMeshDiagnostics(result.tests || []);
      setSheetStatus(`Device Mesh self-test ${result.ok ? "passed" : "needs attention"}. Report: ${result.reportPath}`);
      await refreshDevices();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function decidePairRequest(deviceId: string, decision: "approve" | "deny", trustLevel = "upload_only") {
    try {
      if (decision === "approve") {
        await post("/api/pair/approve", { requestId: deviceId, trustLevel, actor: "laptop" });
        setSheetStatus(`Pair request approved as ${trustLevel}.`);
      } else {
        await post("/api/pair/deny", { requestId: deviceId, actor: "laptop" });
        setSheetStatus("Pair request denied.");
      }
      await refreshDevices();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function scanMemoryOsFiles() {
    try {
      const result = await post<{ inspected: number; reportPath: string }>("/api/memory-os/v4/files/scan", { limit: 220 });
      setSheetStatus(`MemoryOS FileDB scanned ${result.inspected} files. Report: ${result.reportPath}`);
      await refreshLifeGraph();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function queryMemoryOs() {
    try {
      const result = await api<MemoryOsQuery>(`/api/memory-os/v4/query?q=${encodeURIComponent(memoryOsQuery)}&limit=10`);
      setMemoryOsResult(result);
      setSheetStatus(result.answerSummary);
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function runMemoryOsAgent(agentId: string) {
    try {
      const result = await post<{ run: { summary: string; reportPath?: string } }>("/api/memory-os/v4/agents/run", { agentId, limit: 180 });
      setSheetStatus(result.run.summary);
      await refreshLifeGraph();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function runMemoryGovernanceWorker() {
    try {
      const result = await post<{ ok: boolean; organized: string[]; failed: any[]; summaryPath?: string }>("/api/memory-governance/run", { runType: "manual", scope: "all", limit: 50 });
      setSheetStatus(`Memory Worker ${result.ok ? "passed" : "finished with issues"}: ${result.organized.length} organized, ${result.failed.length} failed.`);
      await refreshLifeGraph();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function indexLocalFiles() {
    try {
      const result = await post<{ indexed: number }>("/api/local-file-access/index", { limit: 220 });
      setSheetStatus(`Local File Access indexed ${result.indexed} safe files.`);
      await refreshLifeGraph();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function uploadDeviceFile(file: File) {
    setSheetStatus(`Uploading ${file.name}...`);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
    try {
      const result = await post<{ file: DeviceFile; object?: MeshObject; inbox: DeviceFile[]; objects?: MeshObject[] }>("/api/device-mesh/upload", {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        data: dataUrl
      });
      setDeviceFiles(result.inbox || [result.file]);
      if (result.objects) setMeshObjects(result.objects);
      setSheetStatus(`${file.name} uploaded to laptop inbox.`);
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  function analyzeDeviceImage(file: DeviceFile) {
    setToolView(null);
    void askJarvis(`Analyze the latest uploaded photo from my phone. File in device inbox: ${file.name}.`);
  }

  async function requestLaptopScreen() {
    setSheetStatus("Capturing laptop screen...");
    try {
      const result = await post<{ capture: { path: string; url?: string; bytes: number; dimensions?: string }; object?: MeshObject }>("/api/device-mesh/screen", {
        reason: "Device mesh screen request"
      });
      if (result.capture.url) setLatestScreenUrl(`${result.capture.url}?t=${Date.now()}`);
      if (result.object) setMeshObjects((current) => [result.object!, ...current.filter((object) => object.id !== result.object!.id)].slice(0, 60));
      setSheetStatus(`Laptop screen captured: ${result.capture.dimensions || result.capture.bytes + " bytes"}. Ask Jarvis what is on my laptop screen for analysis.`);
      await refreshReceipts();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function startLiveScreen() {
    setSheetStatus("Starting live laptop screen...");
    try {
      const result = await post<{ mesh: MeshStatus }>("/api/device-mesh/live/start", { quality: "balanced", targetFps: 1 });
      setMeshStatus(result.mesh);
      setSheetStatus("Live screen is active. Refreshing first frame...");
      await refreshLiveFrame();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function refreshLiveFrame() {
    try {
      const result = await api<{ frameUrl?: string; paused?: boolean; mesh: MeshStatus }>("/api/device-mesh/live/frame");
      if (result.frameUrl) setLiveFrameUrl(`${result.frameUrl}?t=${Date.now()}`);
      setMeshStatus(result.mesh);
      setSheetStatus(result.paused ? "Live screen is paused." : "Live frame refreshed.");
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function pauseLiveScreen() {
    try {
      const result = await post<{ mesh: MeshStatus }>("/api/device-mesh/live/pause", {});
      setMeshStatus(result.mesh);
      setSheetStatus("Live screen paused.");
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function stopLiveScreen() {
    try {
      const result = await post<{ mesh: MeshStatus }>("/api/device-mesh/live/stop", {});
      setMeshStatus(result.mesh);
      setSheetStatus("Live screen stopped and replay marker saved.");
      await refreshDevices();
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function requestMeshControl() {
    try {
      const result = await post<{ mesh: MeshStatus }>("/api/device-mesh/control/request", { reason: "Operate the laptop from this paired device", durationSeconds: 120 });
      setMeshStatus(result.mesh);
      setSheetStatus(result.mesh.controlBaton?.status === "approved" ? "Local control baton active." : "Control request sent. Approve it from the laptop.");
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function approveMeshControl() {
    try {
      const result = await post<{ mesh: MeshStatus }>("/api/device-mesh/control/approve", { durationSeconds: 120 });
      setMeshStatus(result.mesh);
      setSheetStatus("Laptop control approved for two minutes.");
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function denyMeshControl() {
    try {
      const result = await post<{ mesh: MeshStatus }>("/api/device-mesh/control/deny", {});
      setMeshStatus(result.mesh);
      setSheetStatus("Laptop control denied.");
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function emergencyStopMesh() {
    try {
      const result = await post<{ mesh: MeshStatus }>("/api/device-mesh/emergency-stop", {});
      setMeshStatus(result.mesh);
      setSheetStatus("Emergency stop active. Mesh control revoked.");
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function startGhostSandbox() {
    try {
      const batonDeviceId = meshStatus?.controlBaton?.holderDeviceId ?? "";
      const result = await post<{ ok: boolean; mesh: MeshStatus }>("/api/device-mesh/sandbox/start", { deviceId: batonDeviceId });
      setMeshStatus(result.mesh);
      await refreshDevices();
    } catch (err) { console.warn("[sandbox]", err); }
  }

  async function stopGhostSandbox() {
    try {
      const result = await post<{ ok: boolean; mesh: MeshStatus }>("/api/device-mesh/sandbox/stop", {});
      setMeshStatus(result.mesh);
      await refreshDevices();
    } catch (err) { console.warn("[sandbox]", err); }
  }

  async function sendControlEvent(event: Record<string, unknown>) {
    try {
      const result = await post<{ ok: boolean; mesh: MeshStatus; execution?: { error?: string } }>("/api/device-mesh/control/event", event);
      setMeshStatus(result.mesh);
      setSheetStatus(result.ok ? "Control event executed." : result.execution?.error || "Control event failed.");
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function addMeshObject() {
    const value = meshObjectDraft.trim();
    if (!value) return;
    setSheetStatus("Adding object to Jarvis mesh...");
    try {
      const isLink = /^https?:\/\//i.test(value);
      const result = await post<{ object: MeshObject; objects: MeshObject[] }>("/api/device-mesh/objects", {
        type: isLink ? "link" : "text",
        name: isLink ? new URL(value).hostname : value.slice(0, 48),
        text: isLink ? "" : value,
        link: isLink ? value : "",
        summary: isLink ? "Link saved from a paired device or local browser." : "Text note saved into the device mesh object portal.",
        tags: ["quick-add"]
      });
      setMeshObjectDraft("");
      setMeshObjects(result.objects || [result.object]);
      setSheetStatus("Object saved. Jarvis can reference it now.");
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function sendMeshCommand() {
    const value = meshCommandDraft.trim();
    if (!value) return;
    setSheetStatus("Creating mesh command card...");
    try {
      const result = await post<{ command: MeshCommand; commands: MeshCommand[] }>("/api/device-mesh/commands", {
        type: /^https?:\/\//i.test(value) ? "open_url" : "ask_jarvis",
        title: /^https?:\/\//i.test(value) ? "Open this URL" : "Jarvis command",
        body: value,
        payload: /^https?:\/\//i.test(value) ? { url: value } : { prompt: value },
        targetDeviceId: "any",
        priority: "normal"
      });
      setMeshCommandDraft("");
      setMeshCommands(result.commands || [result.command]);
      setSheetStatus("Command card created.");
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function ackMeshCommand(commandId: string) {
    try {
      const result = await post<{ command: MeshCommand; commands: MeshCommand[] }>(`/api/device-mesh/commands/${encodeURIComponent(commandId)}/ack`, {});
      setMeshCommands(result.commands || []);
      setSheetStatus(`Acknowledged ${result.command.title}.`);
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  async function executeMeshCommand(commandId: string) {
    setSheetStatus("Approving and executing saved action...");
    try {
      const result = await post<{ command: MeshCommand; commands: MeshCommand[]; status: string }>(`/api/device-mesh/commands/${encodeURIComponent(commandId)}/execute`, {});
      setMeshCommands(result.commands || []);
      setSheetStatus(result.status === "success" ? `Executed ${result.command.title}.` : `${result.command.title}: ${result.command.error || result.status}`);
    } catch (error) {
      setSheetStatus((error as Error).message);
    }
  }

  function focusWidget(id: HoloWidgetId) {
    setHoloWidgets((current) => {
      const maxZ = Math.max(...current.map((widget) => widget.z), 1);
      return current.map((widget) => widget.id === id ? { ...widget, z: maxZ + 1 } : widget);
    });
  }

  function beginWidgetInteraction(event: React.PointerEvent<HTMLElement>, id: HoloWidgetId, mode: "move" | "resize") {
    const widget = holoWidgets.find((item) => item.id === id);
    if (!widget) return;
    event.preventDefault();
    event.stopPropagation();
    focusWidget(id);
    widgetInteractionRef.current = {
      id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      initial: widget
    };
  }

  function toggleWidgetMinimized(id: HoloWidgetId) {
    setHoloWidgets((current) => current.map((widget) => widget.id === id ? { ...widget, minimized: !widget.minimized } : widget));
  }

  function closeWidget(id: HoloWidgetId) {
    setHoloWidgets((current) => current.map((widget) => widget.id === id ? { ...widget, closed: true } : widget));
  }

  function restoreWidget(id: HoloWidgetId) {
    setHoloWidgets((current) => {
      const maxZ = Math.max(...current.map((widget) => widget.z), 1);
      return current.map((widget) => widget.id === id ? { ...widget, closed: false, minimized: false, z: maxZ + 1 } : widget);
    });
  }

  function resetWidgetLayout() {
    setHoloWidgets(DEFAULT_HOLO_WIDGETS.map((widget) => ({ ...widget })));
  }

  function openWidgetTool(widget: HoloWidgetState) {
    setToolView(widget.tool);
  }

  function renderWidgetContent(widget: HoloWidgetState) {
    if (widget.id === "jarvis") {
      return (
        <>
          <div className="widget-orbital">
            <span />
            <i />
          </div>
          <div className="widget-wave compact" aria-hidden="true">
            {Array.from({ length: 22 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}
          </div>
          <div className="widget-metrics two">
            <article><strong>{phaseLabel(phase)}</strong><span>voice core</span></article>
            <article><strong>{system?.settings?.providers?.gemini?.connected ? "Gemini" : "Local"}</strong><span>brain layer</span></article>
          </div>
        </>
      );
    }
    if (widget.id === "devices") {
      return (
        <>
          <div className="widget-mesh-map">
            {(devices.length ? devices : [{ id: "laptop", name: "Laptop", status: "online", kind: "workstation", approved: true }]).slice(0, 6).map((device, index) => (
              <span key={device.id} style={{ "--node": index } as React.CSSProperties} title={device.name}>
                <i />
              </span>
            ))}
          </div>
          <div className="widget-metrics three">
            <article><strong>{devices.length}</strong><span>trusted</span></article>
            <article><strong>{meshCommands.length}</strong><span>cards</span></article>
            <article><strong>{meshStatus?.liveScreen?.active ? "Live" : "Idle"}</strong><span>screen</span></article>
          </div>
          <div className="widget-actions">
            <button onClick={createPairCode}>Pair link</button>
            <button onClick={startLiveScreen}>Stream</button>
            <button onClick={requestLaptopScreen}>Capture</button>
          </div>
          <p className="widget-caption">{meshLinkRows[0]?.url || "Create a pair code to expose the phone link."}</p>
        </>
      );
    }
    if (widget.id === "agents") {
      const agentRows: Mission[] = missions.length ? missions : (memoryOsStatus?.agents?.map((agent) => ({
        id: agent.id,
        title: agent.name,
        status: agent.lastRun?.status || "ready",
        progress: agent.lastRun ? 82 : 26
      })) || [
        { id: "browser-control-agent", title: "Browser Control Agent", status: "ready", progress: 68 },
        { id: "device-mesh-agent", title: "Device Mesh Agent", status: meshStatus?.liveScreen?.active ? "streaming" : "standby", progress: meshStatus?.liveScreen?.active ? 88 : 34 },
        { id: "memory-manager-agent", title: "Memory Manager Agent", status: "ready", progress: memoryOsObjects.length ? 74 : 30 },
        { id: "kalshi-briefing-agent", title: "Kalshi Briefing Agent", status: providers.kalshi?.connected ? "connected" : "needs key", progress: providers.kalshi?.connected ? 76 : 18 }
      ]);
      return (
        <>
          <div className="widget-list">
            {agentRows.slice(0, 5).map((mission) => (
              <button key={mission.id} onClick={() => setToolView("agents")}>
                <span><strong>{mission.title}</strong><em>{mission.status}</em></span>
                <i style={{ width: `${Math.max(8, Math.min(100, mission.progress || 24))}%` }} />
              </button>
            ))}
          </div>
          <div className="widget-actions">
            <button onClick={() => setToolView("agents")}>Deploy</button>
            <button onClick={() => void runMemoryOsAgent("memory-manager-agent")}>Memory agent</button>
          </div>
        </>
      );
    }
    if (widget.id === "projects") {
      return (
        <>
          <div className="widget-stack">
            {projects.slice(0, 4).map((project) => (
              <button key={project.path} onClick={() => openProject(project)}>
                <strong>{project.name}</strong>
                <span>{project.fileCount} files / {project.hasGit ? "git" : "local"}</span>
              </button>
            ))}
            {!projects.length && <button onClick={refreshProjects}><strong>Index projects</strong><span>Refresh Codex folders</span></button>}
          </div>
          <div className="widget-actions">
            <button onClick={refreshProjects}>Refresh</button>
            <button onClick={() => setToolView("projects")}>Open board</button>
          </div>
        </>
      );
    }
    if (widget.id === "memory") {
      return (
        <>
          <div className="widget-metrics three">
            <article><strong>{memoryOsObjects.length}</strong><span>objects</span></article>
            <article><strong>{memoryOsFiles.length}</strong><span>files</span></article>
            <article><strong>{taskSkillCandidates.length}</strong><span>skills</span></article>
          </div>
          <div className="widget-search">
            <input value={memoryOsQuery} onChange={(event) => setMemoryOsQuery(event.currentTarget.value)} />
            <button onClick={queryMemoryOs}>Query</button>
          </div>
          <p className="widget-caption">{memoryOsResult?.answerSummary || memoryGovernanceStatus?.version || "Neural Vault ready for file, task, and memory queries."}</p>
          <div className="widget-actions">
            <button onClick={scanMemoryOsFiles}>Scan</button>
            <button onClick={runMemoryGovernanceWorker}>Govern</button>
          </div>
        </>
      );
    }
    if (widget.id === "vision") {
      return (
        <>
          <div className="widget-camera">
            {liveFrameUrl || latestScreenUrl ? <img src={liveFrameUrl || latestScreenUrl} alt="Laptop screen preview" /> : <Camera size={36} />}
          </div>
          <div className="widget-actions">
            <button onClick={() => void analyzeVision("camera")}>Camera</button>
            <button onClick={() => void analyzeVision("screen")}>Screen</button>
            <button onClick={refreshLiveFrame}>Frame</button>
          </div>
          <p className="widget-caption">{latestScreenUrl ? "Latest laptop capture is ready for Jarvis analysis." : "Camera, screen, and phone uploads route into Jarvis vision."}</p>
        </>
      );
    }
    if (widget.id === "modules") {
      return (
        <>
          <div className="widget-metrics three">
            <article><strong>{modules.length}</strong><span>modules</span></article>
            <article><strong>{capabilities.length}</strong><span>tools</span></article>
            <article><strong>{apps.length}</strong><span>apps</span></article>
          </div>
          <div className="widget-list tight">
            {filteredCapabilities.slice(0, 4).map((capability) => (
              <button key={capability.name} onClick={() => executeCapability(capability.name, {}, `Run ${capability.name}.`)}>
                <span><strong>{capability.name.replaceAll("_", " ")}</strong><em>{capability.risk}</em></span>
              </button>
            ))}
          </div>
          <div className="widget-actions">
            <button onClick={refreshCatalog}>Refresh</button>
            <button onClick={() => setToolView("modules")}>All functions</button>
          </div>
        </>
      );
    }
    return (
      <>
        <div className="widget-metrics three">
          <article><strong>{markets.length}</strong><span>markets</span></article>
          <article><strong>{providers.kalshi?.connected ? "On" : "Off"}</strong><span>Kalshi</span></article>
          <article><strong>{providers.news?.connected ? "On" : "Web"}</strong><span>news</span></article>
        </div>
        <div className="widget-search">
          <input value={marketQuery} onChange={(event) => setMarketQuery(event.currentTarget.value)} placeholder="Search market" />
          <button onClick={searchMarkets}>Go</button>
        </div>
        <div className="widget-list tight">
          {markets.slice(0, 3).map((market) => (
            <button key={market.ticker} onClick={() => askJarvis(`Explain this Kalshi market in plain English: ${market.title} (${market.ticker}).`)}>
              <span><strong>{market.title}</strong><em>YES {market.yesBid ?? "-"} / {market.yesAsk ?? "-"}</em></span>
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <main className={`simple-shell phase-${phase}`}>
      <JarvisBackground onScreenRects={setScreenRects} />
      <ScreenPanels rects={screenRects} />
      <header className="simple-header">
        <div className="brand">
          <span className="status-dot" />
          <strong>JARVIS</strong>
          <span>{system?.state || "online"}</span>
        </div>
        <div className="header-meta">
          <span>{system?.settings?.providers?.gemini?.connected ? "Gemini connected" : "Local mode"}</span>
          <time>{clock}</time>
          <button aria-label="Export conversation" title="Export conversation" onClick={exportConversation}>
            <Download size={17} />
          </button>
          <button aria-label="Open tools" title="Tools" onClick={() => setToolView(toolView ? null : "modules")}>
            <Settings2 size={17} />
          </button>
        </div>
      </header>


      <section className="conversation" ref={conversationRef} aria-live="polite">
        {messages.map((message) => (
          <article key={message.id} className={`message ${message.speaker}`}>
            <span>{message.speaker === "jarvis" ? "J" : "You"}</span>
            <div>
              {message.speaker === "jarvis"
                ? <div className="markdown-response"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown></div>
                : <p>{message.text}</p>}
              {!!message.confirmations?.length && (
                <div className="confirmation-row">
                  {message.confirmations.map((confirmation) => (
                    <button key={confirmation.id} onClick={() => approveConfirmation(confirmation.id)}>
                      Approve {confirmation.summary?.reason || confirmation.tool.replaceAll("_", " ")}
                    </button>
                  ))}
                </div>
              )}
              {!!message.sources?.length && (
                <div className="message-sources">
                  {message.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}
                </div>
              )}
              <time>{message.time}</time>
            </div>
          </article>
        ))}
      </section>

      <nav className="tool-dock" aria-label="Jarvis tools">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <button key={tool.id} className={toolView === tool.id ? "active" : ""} onClick={() => setToolView(toolView === tool.id ? null : tool.id)} title={tool.label}>
              <Icon size={17} />
              <span>{tool.label}</span>
            </button>
          );
        })}
      </nav>

      <form className="command-bar" onSubmit={(event) => { event.preventDefault(); void askJarvis(); }}>
        <button type="button" className={phase === "listening" ? "voice active" : "voice"} onClick={toggleVoice} aria-label={phase === "listening" ? "Stop listening" : "Talk to Jarvis"}>
          {phase === "listening" ? <CircleStop size={19} /> : <Mic size={19} />}
        </button>
        <button type="button" className={wakeEnabled ? "wake active" : "wake"} onClick={toggleWakeWord} aria-label={wakeEnabled ? "Disable wake phrase" : "Enable wake phrase"} title="Wake phrase">
          <Sparkles size={18} />
        </button>
        <input
          ref={inputRef}
          defaultValue=""
          placeholder={phase === "listening" ? "Listening..." : "Ask Jarvis anything"}
          aria-label="Ask Jarvis"
          autoComplete="off"
        />
        <button type="submit" className="send" aria-label="Send command" disabled={phase === "thinking"}>
          <Send size={18} />
        </button>
      </form>

      <div className="latest-thought" aria-hidden="true">{latestJarvis?.text}</div>

      {coopStatus?.activeSession && coopStatus.activeSession.status !== "ended" && (
        <aside className="coop-runtime-widget" aria-label="Co-Op Runtime Widget">
          <button className="coop-widget-pulse" onClick={() => setToolView("coop")} title="Open Symbiote Workspace">
            <Link size={15} />
          </button>
          <div>
            <strong>Co-Op Symbiote: Active</strong>
            <span>Peer {coopStatus.activeSession.peerName || "waiting"} / {coopStatus.activeSession.repoMatch || "waiting"} repo / {coopStatus.activeSession.transport?.latencyMs || 0}ms</span>
          </div>
          <button onClick={askBothJarvis}>Ask Both</button>
          <button onClick={endCoOpSession}>End</button>
        </aside>
      )}

      {toolView && (
        <aside className="tool-sheet" aria-label={`${toolView} panel`}>
          <div className="sheet-header">
            <div>
              <span>JARVIS</span>
              <h2>{TOOLS.find((tool) => tool.id === toolView)?.label}</h2>
            </div>
            <button aria-label="Close panel" onClick={() => setToolView(null)}><X size={18} /></button>
          </div>

          {sheetStatus && <p className="sheet-status">{sheetStatus}</p>}

          {toolView === "modules" && (
            <div className="sheet-list module-sheet">
              <div className="catalog-summary">
                <strong>{modules.length} modules</strong>
                <span>{capabilities.length} executable capabilities</span>
              </div>
              <label className="catalog-search">
                <Search size={15} />
                <input value={moduleQuery} onChange={(event) => setModuleQuery(event.target.value)} placeholder="Search every Jarvis function" />
              </label>

              <section className="module-section">
                <div className="section-heading"><strong>Open an application</strong><span>{apps.length} allowlisted</span></div>
                <div className="app-grid">
                  {apps.map((app) => (
                    <button key={app} onClick={() => executeCapability("open_app", { app }, `Open ${app}.`)}>
                      {app}
                    </button>
                  ))}
                </div>
              </section>

              <section className="module-section">
                <div className="section-heading"><strong>Open a URL</strong><span>HTTP or HTTPS</span></div>
                <div className="inline-form">
                  <input
                    value={urlDraft}
                    onChange={(event) => setUrlDraft(event.target.value)}
                    placeholder="example.com or https://..."
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && urlDraft.trim()) {
                        event.preventDefault();
                        void executeCapability("open_url", { url: urlDraft }, `Open ${urlDraft}.`);
                      }
                    }}
                  />
                  <button disabled={!urlDraft.trim()} onClick={() => executeCapability("open_url", { url: urlDraft }, `Open ${urlDraft}.`)} aria-label="Open URL">
                    <ExternalLink size={16} />
                  </button>
                </div>
              </section>

              <section className="module-section">
                <div className="section-heading"><strong>Executable tools</strong><span>{filteredCapabilities.length}</span></div>
                {filteredCapabilities.map((capability) => (
                  <article className="capability-row" key={capability.name}>
                    <div>
                      <strong>{capability.name.replaceAll("_", " ")}</strong>
                      <span>{capability.description}</span>
                    </div>
                    <button onClick={() => prepareCapability(capability)}>Use</button>
                  </article>
                ))}
              </section>

              <section className="module-section">
                <div className="section-heading"><strong>Module registry</strong><span>{filteredModules.length}</span></div>
                {filteredModules.map((module) => (
                  <article className="module-row" key={module.id}>
                    <i className={module.ready ? "ready" : module.status === "installed" ? "blocked" : "adapter"} />
                    <div>
                      <strong>{module.title}</strong>
                      <span>{module.summary}</span>
                      <em>{module.category} / {module.ready ? "ready" : module.blockedReason || "adapter registered"}</em>
                    </div>
                    <button onClick={() => {
                      setToolView(null);
                      window.setTimeout(() => { if (inputRef.current) { inputRef.current.value = `Help me use ${module.title}. `; inputRef.current.focus(); } }, 0);
                    }}>Ask</button>
                  </article>
                ))}
              </section>
            </div>
          )}

          {toolView === "projects" && (
            <div className="sheet-list">
              <button className="sheet-refresh" onClick={refreshProjects}><RefreshCw size={15} /> Refresh</button>
              {projects.map((project) => (
                <button className="list-row" key={project.path} onClick={() => openProject(project)}>
                  <div><strong>{project.name}</strong><span>{project.package?.name || `${project.fileCount} files`}</span></div>
                  <ChevronRight size={16} />
                </button>
              ))}
              {!projects.length && <Empty text="No projects indexed." />}
            </div>
          )}

          {toolView === "agents" && (
            <div className="sheet-list">
              <div className="inline-form">
                <input value={missionDraft} onChange={(event) => setMissionDraft(event.target.value)} placeholder="Give an agent a mission" />
                <button onClick={deployMission} aria-label="Deploy agent"><Send size={16} /></button>
              </div>
              {missions.map((mission) => (
                <article className="mission-row" key={mission.id}>
                  <div><strong>{mission.title}</strong><span>{mission.role || "agent"} Â· {mission.status}</span></div>
                  <div className="mission-progress"><i style={{ width: `${mission.progress}%` }} /></div>
                  <div className="row-actions">
                    {mission.status === "paused"
                      ? <button onClick={() => controlMission(mission.id, "resume")}>Resume</button>
                      : <button onClick={() => controlMission(mission.id, "pause")}>Pause</button>}
                    <button onClick={() => controlMission(mission.id, "cancel")}>Cancel</button>
                  </div>
                  {mission.error && <em>{mission.error}</em>}
                </article>
              ))}
              {!missions.length && <Empty text="No active agents." />}
            </div>
          )}

          {toolView === "providers" && (
            <div className="sheet-list">
              <button className="sheet-refresh" onClick={refreshProviders}><RefreshCw size={15} /> Refresh</button>
              {Object.entries(providers).map(([id, provider]) => (
                <article className="provider-row" key={id}>
                  <span className={provider.connected ? "provider-light connected" : "provider-light"} />
                  <div>
                    <strong>{provider.label || id}</strong>
                    <span>{provider.validationState || (provider.connected ? "connected" : "not connected")}</span>
                    {!!provider.missing?.length && <em>{provider.missing.join(" Â· ")}</em>}
                    {provider.lastError && <em>{provider.lastError}</em>}
                  </div>
                  <div className="row-actions">
                    {provider.credentialsPresent && <button onClick={() => providerAction(id, "test")}>Test</button>}
                    {(id === "google" || id === "canvas") && provider.canConnect && !provider.credentialsPresent && (
                      <button onClick={() => providerAction(id, "connect")}>Connect</button>
                    )}
                    {(id === "google" || id === "canvas") && provider.credentialsPresent && (
                      <button onClick={() => providerAction(id, "disconnect")}>Disconnect</button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {toolView === "markets" && (
            <div className="sheet-list">
              <div className="inline-form">
                <input value={marketQuery} onChange={(event) => setMarketQuery(event.target.value)} placeholder="Search Kalshi markets" onKeyDown={(event) => { if (event.key === "Enter") void searchMarkets(); }} />
                <button onClick={searchMarkets} aria-label="Search markets"><LineChart size={16} /></button>
              </div>
              {markets.map((market) => (
                <article className="market-row" key={market.ticker}>
                  <div><strong>{market.title}</strong><span>{market.ticker}</span></div>
                  <div className="market-price"><b>{market.yesBid ?? "â€”"}</b><span>bid</span><b>{market.yesAsk ?? "â€”"}</b><span>ask</span></div>
                </article>
              ))}
              {!markets.length && <Empty text="No matching markets." />}
            </div>
          )}

          {toolView === "vision" && (
            <div className="vision-actions">
              <button onClick={() => analyzeVision("camera")}><Camera size={22} /><strong>Look through camera</strong><span>Identify an object, document, or scene.</span></button>
              <button onClick={() => analyzeVision("screen")}><MonitorUp size={22} /><strong>Analyze my screen</strong><span>Understand the current app and suggest actions.</span></button>
            </div>
          )}

          {toolView === "memory" && (
            <div className="sheet-list">
              <div className="row-actions mesh-action-row">
                <button className="sheet-refresh" onClick={refreshLifeGraph}><RefreshCw size={15} /> Refresh</button>
                <button onClick={scanMemoryOsFiles}><FolderKanban size={15} /> Scan FileDB</button>
                <button onClick={() => void runMemoryOsAgent("memory-manager-agent")}><Bot size={15} /> Run Manager</button>
              </div>
              <section className="module-section memory-os-hero">
                <div className="section-heading"><strong>Neural Vault v4 MemoryOS</strong><span>{memoryOsStatus?.version || "loading"}</span></div>
                <div className="mesh-stats">
                  <article><strong>{memoryOsStatus?.counts?.objects || 0}</strong><span>objects</span></article>
                  <article><strong>{memoryOsStatus?.counts?.fileIndex || 0}</strong><span>FileDB</span></article>
                  <article><strong>{memoryOsStatus?.counts?.queries || 0}</strong><span>queries</span></article>
                  <article><strong>{memoryOsStatus?.counts?.agentRuns || 0}</strong><span>agent runs</span></article>
                  <article><strong>{memoryOsStatus?.agents?.length || 0}</strong><span>agents</span></article>
                  <article><strong>{memoryOsStatus?.reports?.length || 0}</strong><span>reports</span></article>
                </div>
                <p className="subtle-copy">{memoryOsStatus?.root || "File-backed MemoryOS root will appear here."}</p>
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>Hybrid Query Console</strong><span>{memoryOsResult?.confidence ? `${Math.round(memoryOsResult.confidence * 100)}%` : "path + keyword + FileDB"}</span></div>
                <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void queryMemoryOs(); }}>
                  <input value={memoryOsQuery} onChange={(event) => setMemoryOsQuery(event.currentTarget.value)} placeholder="search memory, old conversations, files, commands..." />
                  <button aria-label="Query MemoryOS"><Search size={16} /></button>
                </form>
                {memoryOsResult && (
                  <article className={memoryOsResult.lowConfidence ? "receipt-row warning-row" : "receipt-row"}>
                    <Sparkles size={15} />
                    <div>
                      <strong>{memoryOsResult.answerSummary}</strong>
                      <span>{memoryOsResult.objects.length} object(s) / confidence {Math.round(memoryOsResult.confidence * 100)}%</span>
                      {memoryOsResult.lowConfidence && <p>Low confidence: Jarvis should say not found or ask instead of inventing.</p>}
                    </div>
                  </article>
                )}
                {(memoryOsResult?.objects || []).map((object) => (
                  <article className="receipt-row" key={object.id}>
                    <FileText size={15} />
                    <div>
                      <strong>{object.title}</strong>
                      <span>{object.type} / {object.uri}</span>
                      <p>{object.summary || object.contentPreview}</p>
                    </div>
                  </article>
                ))}
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>Memory Agents</strong><span>{memoryOsStatus?.agents?.length || 0} runnable</span></div>
                {(memoryOsStatus?.agents || []).slice(0, 10).map((agent) => (
                  <article className="capability-row" key={agent.id}>
                    <div>
                      <strong>{agent.name}</strong>
                      <span>{agent.description}</span>
                      {agent.lastRun && <em>{agent.lastRun.status}: {agent.lastRun.summary}</em>}
                    </div>
                    <button onClick={() => void runMemoryOsAgent(agent.id)}>Run</button>
                  </article>
                ))}
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>Recent Memory Objects</strong><span>{memoryOsObjects.length}</span></div>
                {memoryOsObjects.slice(0, 10).map((object) => (
                  <article className="receipt-row" key={object.id}>
                    <Sparkles size={15} />
                    <div>
                      <strong>{object.title}</strong>
                      <span>{object.type} / {object.status} / {object.fileExists === false ? "missing file" : "file-backed"}</span>
                      <p>{object.uri}</p>
                    </div>
                  </article>
                ))}
                {!memoryOsObjects.length && <Empty text="No v4 memory objects yet. Run FileDB scan or a memory agent." />}
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>FileDB Index</strong><span>{memoryOsFiles.length}</span></div>
                {memoryOsFiles.slice(0, 8).map((file) => (
                  <article className="receipt-row" key={file.filePath}>
                    <FileText size={15} />
                    <div>
                      <strong>{file.filePath.split(/[\\/]/).pop()}</strong>
                      <span>{file.fileType || "file"} / {file.ownerModule || "project"} / {file.memoryUri}</span>
                      <p>{file.purposeSummary}</p>
                    </div>
                  </article>
                ))}
              </section>
              {lifeGraph && (
                <>
                  <div className="catalog-summary">
                    <strong>Life Graph</strong>
                    <span>{Object.values(lifeGraph.summary || {}).reduce((total, count) => total + count, 0)} memories mapped</span>
                  </div>
                  {["people", "classes", "projects", "preferences", "routines", "goals", "accounts"].map((bucket) => (
                    <section className="module-section" key={bucket}>
                      <div className="section-heading"><strong>{bucket}</strong><span>{lifeGraph.buckets?.[bucket]?.length || 0}</span></div>
                      {(lifeGraph.buckets?.[bucket] || []).slice(0, 6).map((item) => (
                        <article className="module-row" key={item.id}>
                          <i className="ready" />
                          <div><strong>{item.category}</strong><span>{item.text}</span><em>{item.kind} / {new Date(item.updatedAt).toLocaleDateString()}</em></div>
                        </article>
                      ))}
                    </section>
                  ))}
                  <section className="module-section">
                    <div className="section-heading"><strong>Entities</strong><span>{lifeGraph.entities?.length || 0}</span></div>
                    {(lifeGraph.entities || []).slice(0, 12).map((entity) => (
                      <article className="capability-row" key={`${entity.type}:${entity.name}`}>
                        <div><strong>{entity.name}</strong><span>{entity.type} / {entity.count} reference{entity.count === 1 ? "" : "s"}</span></div>
                      </article>
                    ))}
                  </section>
                </>
              )}
              {!lifeGraph && <Empty text="Life Graph has not loaded yet." />}
            </div>
          )}

          {toolView === "devices" && (
            <div className="sheet-list">
              <button className="sheet-refresh" onClick={refreshDevices}><RefreshCw size={15} /> Refresh</button>
              <section className="module-section">
                <div className="section-heading"><strong>Device Constellation</strong><span>{meshStatus?.meshRuntimeVersion || meshStatus?.meshVersion || "2.0"}</span></div>
                <div className="mesh-stats">
                  <article><strong>{devices.length}</strong><span>trusted nodes</span></article>
                  <article><strong>{meshObjects.length}</strong><span>objects</span></article>
                  <article><strong>{meshCommands.filter((item) => item.status !== "acknowledged").length}</strong><span>open cards</span></article>
                  <article><strong>{meshStatus?.liveScreen?.active ? "Live" : "Off"}</strong><span>screen</span></article>
                  <article><strong>{meshStatus?.controlBaton?.status || "idle"}</strong><span>control</span></article>
                  <article><strong>{meshStatus?.memory?.inboxItems || 0}</strong><span>mesh memory</span></article>
                </div>
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>Connection Guide</strong><span>same Wi-Fi or tunnel</span></div>
                <div className="mesh-stats">
                  <article><strong>{meshStatus?.connection?.host || "0.0.0.0"}</strong><span>bind host</span></article>
                  <article><strong>{meshStatus?.connection?.port || "8799"}</strong><span>port</span></article>
                  <article><strong>{meshStatus?.connection?.preferred?.source || "lan"}</strong><span>preferred</span></article>
                  <article><strong>{meshPairInfo?.expiresInSeconds || "600"}</strong><span>QR seconds</span></article>
                </div>
                <div className="row-actions mesh-action-row">
                  <button onClick={createPairCode}><MonitorUp size={15} /> Generate QR</button>
                  <button onClick={runMeshSelfTest}><Check size={15} /> Run Self-Test</button>
                  {meshPairInfo?.preferredPairUrl && <button onClick={() => void navigator.clipboard?.writeText(meshPairInfo.preferredPairUrl || "")}>Copy QR URL</button>}
                  {pairCode && <button onClick={() => void navigator.clipboard?.writeText(pairCode)}>Copy Code</button>}
                </div>
                {meshPairInfo?.diagnostics?.qrContainsLocalhost && (
                  <article className="receipt-row warning-row">
                    <X size={15} />
                    <div>
                      <strong>This QR will not work on your phone because it uses localhost.</strong>
                      <span>Choose a LAN/Tailscale/Cloudflare URL instead.</span>
                    </div>
                  </article>
                )}
                {meshPairInfo?.preferredPairUrl && (
                  <article className="receipt-row">
                    <ExternalLink size={15} />
                    <div>
                      <strong>QR URL</strong>
                      <span>{meshPairInfo.preferredPairUrl}</span>
                      <p>{meshPairInfo.diagnostics?.message}</p>
                    </div>
                  </article>
                )}
                <div className="mesh-links">
                  {(meshPairInfo?.candidates || meshStatus?.connection?.candidates || []).slice(0, 5).map((candidate) => (
                    <button key={candidate.baseUrl} onClick={() => void navigator.clipboard?.writeText(pairCode ? `${candidate.baseUrl}/mesh/pair?code=${pairCode}` : candidate.baseUrl)}>
                      <ExternalLink size={13} /> <strong>{candidate.label}</strong><span>{pairCode ? `${candidate.baseUrl}/mesh/pair?code=${pairCode}` : candidate.baseUrl}</span>
                    </button>
                  ))}
                  {meshLinkRows.slice(0, 4).map((meshUrl) => (
                    <button key={meshUrl.url} onClick={() => void navigator.clipboard?.writeText(meshUrl.url)}>
                      <ExternalLink size={13} /> <strong>{meshUrl.label}</strong><span>{meshUrl.url}</span>
                    </button>
                  ))}
                  {!meshLinkRows.length && <small>No Cloudflare or local mesh links are configured.</small>}
                </div>
                <article className="receipt-row">
                  <MonitorUp size={15} />
                  <div>
                    <strong>Phone connection steps</strong>
                    <span>Open the first reachable URL on your phone, scan a pair code, then use this Devices panel as the Mesh Cockpit.</span>
                    <p>Same Wi-Fi uses LAN links. Away from home, configure a stable Cloudflare/Tailscale URL in settings.</p>
                  </div>
                </article>
                {!!meshDiagnostics.length && (
                  <div className="diagnostic-list">
                    {meshDiagnostics.map((test) => (
                      <article className={test.ok ? "capability-row" : "capability-row warning-row"} key={test.name}>
                        <div><strong>{test.ok ? "PASS" : "FAIL"} {test.name}</strong><span>{test.detail || test.fix || ""}</span></div>
                      </article>
                    ))}
                  </div>
                )}
                {!!meshStatus?.connection?.events?.length && (
                  <div className="diagnostic-list">
                    <div className="section-heading secondary-heading"><strong>Event Log</strong><span>{meshStatus.connection.events.length}</span></div>
                    {meshStatus.connection.events.slice(0, 6).map((event) => (
                      <article className="receipt-row" key={event.id}>
                        <Sparkles size={15} />
                        <div><strong>{event.type}</strong><span>{new Date(event.createdAt).toLocaleTimeString()}</span><p>{event.summary}</p></div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <section className="module-section mesh-live-section">
                <div className="section-heading"><strong>Live Screen Panel</strong><span>{meshStatus?.liveScreen?.active ? `${meshStatus.liveScreen.frameCount || 0} frames` : "idle"}</span></div>
                <div className="row-actions mesh-action-row">
                  <button onClick={startLiveScreen}>Start</button>
                  <button onClick={refreshLiveFrame} disabled={!meshStatus?.liveScreen?.active}>Frame</button>
                  <button onClick={pauseLiveScreen} disabled={!meshStatus?.liveScreen?.active}>Pause</button>
                  <button onClick={stopLiveScreen} disabled={!meshStatus?.liveScreen?.active}>Stop</button>
                </div>
                {(liveFrameUrl || latestScreenUrl || meshStatus?.liveScreen?.lastFrameUrl) && (
                  <article className="screen-preview live-preview">
                    <img src={liveFrameUrl || latestScreenUrl || `${meshStatus?.liveScreen?.lastFrameUrl}?t=${Date.now()}`} alt="Live laptop screen frame" />
                    <div className="row-actions">
                      <button className="mini-action" onClick={() => void askJarvis("Inspect the latest live laptop screen frame and tell me what is on my laptop screen.")}>Ask Jarvis</button>
                      <button className="mini-action" onClick={() => void sendControlEvent({ action: "fullscreen" })}>Fullscreen key</button>
                    </div>
                  </article>
                )}
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>Control Center</strong><span>{meshStatus?.emergencyStopped ? "stopped" : meshStatus?.controlBaton?.status || "idle"}</span></div>
                <div className="section-heading secondary-heading"><strong>Permission Reactor</strong><span>audited baton</span></div>
                <article className="provider-row">
                  <span className={meshStatus?.controlBaton?.status === "approved" ? "provider-light connected" : "provider-light"} />
                  <div>
                    <strong>{meshStatus?.controlBaton?.holderDeviceName || meshStatus?.controlBaton?.requestedBy || "No active controller"}</strong>
                    <span>{meshStatus?.controlBaton?.reason || "Control requires an approval baton."}</span>
                    <em>{meshStatus?.controlBaton?.expiresAt ? `Expires ${new Date(meshStatus.controlBaton.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No active expiry"}</em>
                  </div>
                </article>
                <div className="row-actions mesh-action-row">
                  <button onClick={requestMeshControl}>Request</button>
                  <button onClick={approveMeshControl}>Approve</button>
                  <button onClick={denyMeshControl}>Deny</button>
                  <button onClick={emergencyStopMesh}>Emergency stop</button>
                </div>
                <div className="row-actions mesh-action-row">
                  <button onClick={() => void sendControlEvent({ action: "hotkey", hotkey: "ctrl_l" })}>Focus address</button>
                  <button onClick={() => void sendControlEvent({ action: "type", text: "avery shut up" })}>Type test</button>
                  <button onClick={() => void sendControlEvent({ action: "hotkey", hotkey: "enter" })}>Enter</button>
                </div>
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>Pair phone or iPad</strong><span>one time</span></div>
                <button className="sheet-refresh" onClick={createPairCode}><MonitorUp size={15} /> Create pair link</button>
                {pairCode && (
                  <article className="provider-row">
                    <span className="provider-light connected" />
                    <div>
                      <strong>{pairCode}</strong>
                      <span>Open this link on your phone, then it stays signed in.</span>
                      {pairQr && <img className="pair-qr" src={pairQr} alt="Device Mesh pairing QR code" />}
                      {pairUrls.slice(0, 2).map((pairUrl) => <em key={pairUrl}>{pairUrl}</em>)}
                    </div>
                  </article>
                )}
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>Phone Sensor Dock</strong><span>media and capture</span></div>
                <div className="vision-actions">
                  <label className="upload-card">
                    <Camera size={22} />
                    <strong>Send file/photo to laptop</strong>
                    <span>Stores in the JARVIS device inbox.</span>
                    <input type="file" hidden onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void uploadDeviceFile(file);
                      event.currentTarget.value = "";
                    }} />
                  </label>
                  <button onClick={requestLaptopScreen}><MonitorUp size={22} /><strong>Capture laptop screen</strong><span>Creates evidence for Jarvis vision analysis.</span></button>
                </div>
                {latestScreenUrl && (
                  <article className="screen-preview">
                    <img src={latestScreenUrl} alt="Latest laptop screen capture" />
                    <button className="mini-action" onClick={() => void askJarvis("Inspect the latest laptop screen capture and tell me what is on my screen.")}>Ask Jarvis about screen</button>
                  </article>
                )}
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>Photo / Media Inbox</strong><span>{meshObjects.length}</span></div>
                <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void addMeshObject(); }}>
                  <input value={meshObjectDraft} onChange={(event) => setMeshObjectDraft(event.currentTarget.value)} placeholder="Paste text, a URL, or a note for Jarvis..." />
                  <button aria-label="Add object"><Send size={16} /></button>
                </form>
                {meshObjects.slice(0, 10).map((object) => (
                  <article className={object.type === "image" || object.type === "screen" ? "receipt-row device-file image-file" : "receipt-row device-file"} key={object.id}>
                    {(object.type === "image" || object.type === "screen") && object.url ? <img className="device-thumb" src={object.url} alt={object.name} /> : object.type === "link" ? <Link size={15} /> : <FileText size={15} />}
                    <div>
                      <strong>{object.name}</strong>
                      <span>{object.type} / {object.sourceDeviceName || "mesh"}{object.bytes ? ` / ${Math.round(object.bytes / 1024)} KB` : ""}</span>
                      <p>{object.summary || object.text || object.link}</p>
                      {(object.type === "image" || object.type === "screen") && <button className="mini-action" onClick={() => analyzeDeviceImage({ name: object.name, path: object.id, bytes: object.bytes || 0, url: object.url, isImage: true })}>Analyze</button>}
                    </div>
                  </article>
                ))}
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>Mesh Tools Panel</strong><span>{meshCommands.length} cards</span></div>
                {["PairingService", "ScreenStreamManager", "ControlBatonManager", "PhoneSensorService", "MeshFileTeleport", "MeshOverlayEngine", "MeshReplayEngine", "MeshSkillCompiler", "MeshMemoryWriter"].map((moduleName) => (
                  <article className="capability-row" key={moduleName}>
                    <div>
                      <strong>{moduleName}</strong>
                      <span>{moduleName === "ScreenStreamManager" ? (meshStatus?.liveScreen?.active ? "loaded / streaming" : "idle / on demand") : moduleName === "ControlBatonManager" ? (meshStatus?.controlBaton?.status || "idle") : "available / on demand"}</span>
                    </div>
                    <button onClick={() => void askJarvis(`show mesh module health for ${moduleName}`)}>Ask</button>
                  </article>
                ))}
                <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void sendMeshCommand(); }}>
                  <input value={meshCommandDraft} onChange={(event) => setMeshCommandDraft(event.currentTarget.value)} placeholder="Send a command card to paired devices..." />
                  <button aria-label="Send command"><Send size={16} /></button>
                </form>
                {meshCommands.slice(0, 8).map((commandCard) => (
                  <article className="receipt-row" key={commandCard.id}>
                    <Sparkles size={15} />
                    <div>
                      <strong>{commandCard.title}</strong>
                      <span>{commandCard.type} / {commandCard.targetDeviceId || "any"} / {commandCard.status}</span>
                      <p>{commandCard.error || commandCard.result || commandCard.body}</p>
                      {commandCard.type === "saved_action" && !["completed", "executing", "blocked"].includes(commandCard.status) && <button className="mini-action" onClick={() => void executeMeshCommand(commandCard.id)}>Execute</button>}
                      {commandCard.status !== "acknowledged" && <button className="mini-action" onClick={() => void ackMeshCommand(commandCard.id)}>Acknowledge</button>}
                    </div>
                  </article>
                ))}
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>Mesh Memory Trace</strong><span>{meshMemory?.inboxItems?.length || 0} inbox</span></div>
                {(meshMemory?.inboxItems || []).slice(0, 6).map((item) => (
                  <article className="receipt-row" key={item.id}>
                    <Sparkles size={15} />
                    <div>
                      <strong>{item.itemType} from {item.sourceDeviceId}</strong>
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                      <p>{item.summary || item.textPreview || item.url || item.path}</p>
                    </div>
                  </article>
                ))}
                <div className="section-heading secondary-heading"><strong>Replay Theater</strong><span>{meshMemory?.replays?.length || 0} replays</span></div>
                {(meshMemory?.replays || []).slice(0, 3).map((replay) => (
                  <article className="receipt-row" key={replay.id}>
                    <RefreshCw size={15} />
                    <div><strong>{replay.replayType}</strong><span>{new Date(replay.createdAt).toLocaleString()}</span><p>{replay.summary}</p></div>
                  </article>
                ))}
                {!meshMemory?.inboxItems?.length && <Empty text="No mesh memory entries yet." />}
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>Trusted devices</strong><span>{devices.length}</span></div>
                {devices.map((device) => (
                  <article className="provider-row" key={device.id}>
                    <span className={device.approved ? "provider-light connected" : "provider-light"} />
                    <div>
                      <strong>{device.name}</strong>
                      <span>{device.role || device.kind} / {device.trustLevel || "mesh"} / {device.status}</span>
                      <em>{Object.entries(device.permissions || {}).filter(([, value]) => value).map(([key]) => key).join(" Â· ")}</em>
                    </div>
                  </article>
                ))}
              </section>
              <section className="module-section">
                <div className="section-heading"><strong>File inbox</strong><span>{deviceFiles.length}</span></div>
                {deviceFiles.slice(0, 12).map((file) => (
                  <article className={file.isImage ? "receipt-row device-file image-file" : "receipt-row device-file"} key={file.path}>
                    {file.isImage && file.url ? <img className="device-thumb" src={file.url} alt={file.name} /> : <Check size={15} />}
                    <div>
                      <strong>{file.name}</strong>
                      <span>{Math.round(file.bytes / 1024)} KB / {file.deviceId || "device"}{file.mimeType ? ` / ${file.mimeType}` : ""}</span>
                      <p>{file.path}</p>
                      {file.isImage && <button className="mini-action" onClick={() => analyzeDeviceImage(file)}>Analyze photo</button>}
                    </div>
                  </article>
                ))}
              </section>
            </div>
          )}

          {toolView === "coop" && (
            <div className="sheet-list coop-workspace">
              <button className="sheet-refresh" onClick={refreshCoOp}><RefreshCw size={15} /> Refresh</button>
              <section className="module-section coop-hero">
                <div className="section-heading"><strong>Jarvis Co-Op Symbiote Mesh</strong><span>{coopStatus?.runtimeVersion || "v2"}</span></div>
                <div className="mesh-stats">
                  <article><strong>{coopStatus?.activeSession?.code || "----"}</strong><span>session code</span></article>
                  <article><strong>{coopStatus?.activeSession?.repoMatch || "waiting"}</strong><span>repo match</span></article>
                  <article><strong>{coopStatus?.activeSession?.transport?.latencyMs || 0}ms</strong><span>latency</span></article>
                  <article><strong>{coopStatus?.activeSession?.patches?.length || 0}</strong><span>patches</span></article>
                  <article><strong>{coopMemory?.counts?.events || 0}</strong><span>memory events</span></article>
                </div>
                <div className="row-actions mesh-action-row">
                  <button onClick={createCoOpSession}>Create Symbiote Session</button>
                  <button onClick={askBothJarvis} disabled={!coopStatus?.activeSession}>Ask Both Jarvis</button>
                  <button onClick={createCoOpMemoryPacket} disabled={!coopStatus?.activeSession}>Memory Packet</button>
                  <button onClick={endCoOpSession} disabled={!coopStatus?.activeSession}>End Session</button>
                </div>
                <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void joinCoOpSession(); }}>
                  <input value={coopJoinCode} onChange={(event) => setCoopJoinCode(event.currentTarget.value)} placeholder="Join code: 827-419" />
                  <button aria-label="Join Symbiote session"><Link size={16} /></button>
                </form>
                {coopStatus?.activeSession?.inviteLinks?.slice(0, 2).map((invite) => (
                  <button className="mesh-link-copy" key={invite} onClick={() => void navigator.clipboard?.writeText(invite)}>
                    <ExternalLink size={13} /> {invite}
                  </button>
                ))}
                {coopStatus?.activeSession?.pendingJoin && (
                  <article className="provider-row warning-row">
                    <span className="provider-light" />
                    <div>
                      <strong>Join request: {coopStatus.activeSession.pendingJoin.displayName}</strong>
                      <span>{coopStatus.activeSession.pendingJoin.status}</span>
                    </div>
                    <div className="row-actions">
                      <button onClick={() => void approveCoOpJoin(true)}>Approve</button>
                      <button onClick={() => void approveCoOpJoin(false)}>Deny</button>
                    </div>
                  </article>
                )}
              </section>

              <section className="module-section">
                <div className="section-heading"><strong>Connection Status</strong><span>{coopStatus?.activeSession?.connectionMode || "LAN first"}</span></div>
                <article className="provider-row">
                  <span className={coopStatus?.activeSession ? "provider-light connected" : "provider-light"} />
                  <div>
                    <strong>{coopStatus?.activeSession?.peerName || "Waiting for trusted friend"}</strong>
                    <span>{coopStatus?.activeSession?.transport?.signaling || "websocket-ready"} / {coopStatus?.activeSession?.transport?.dataChannel || "fallback-http-active"}</span>
                    <em>Live screen/control plugs into Device Mesh; relay mode remains optional.</em>
                  </div>
                </article>
              </section>

              <section className="module-section shared-file-tree">
                <div className="section-heading"><strong>Shared File Tree</strong><span>{coopFiles.filter((file) => file.shareMode !== "blocked").length}/{coopFiles.length} safe</span></div>
                {coopFiles.slice(0, 16).map((file) => (
                  <article className="capability-row" key={file.path}>
                    <div>
                      <strong>{file.path}</strong>
                      <span>{file.badge} / {file.language} / {file.shareMode}{file.reasonBlocked ? ` / ${file.reasonBlocked}` : ""}</span>
                    </div>
                    <button disabled={file.shareMode === "blocked"} onClick={() => {
                      setCoopPatchFile(file.path);
                      setSheetStatus(`Selected ${file.path} for Patch Court.`);
                    }}>Select</button>
                  </article>
                ))}
              </section>

              <section className="module-section">
                <div className="section-heading"><strong>Co-Op Chatbox</strong><span>{coopStatus?.activeSession?.chat?.length || 0}</span></div>
                <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void sendCoOpChat(); }}>
                  <input value={coopChatDraft} onChange={(event) => setCoopChatDraft(event.currentTarget.value)} placeholder="Message trusted friend..." />
                  <button aria-label="Send co-op chat"><Send size={16} /></button>
                </form>
                {(coopStatus?.activeSession?.chat || []).slice(0, 5).map((message) => (
                  <article className="receipt-row" key={message.id}>
                    <Sparkles size={15} />
                    <div><strong>{message.senderName}</strong><span>{new Date(message.timestamp).toLocaleTimeString()}</span><p>{message.text}</p></div>
                  </article>
                ))}
              </section>

              <section className="module-section patch-court-panel">
                <div className="section-heading"><strong>Patch Court</strong><span>{coopStatus?.activeSession?.patches?.length || 0} pending</span></div>
                <label className="catalog-search"><FileText size={15} /><input value={coopPatchFile} onChange={(event) => setCoopPatchFile(event.currentTarget.value)} placeholder="file path" /></label>
                <textarea value={coopPatchFind} onChange={(event) => setCoopPatchFind(event.currentTarget.value)} placeholder="Original text to replace" />
                <textarea value={coopPatchReplace} onChange={(event) => setCoopPatchReplace(event.currentTarget.value)} placeholder="Replacement text" />
                <button className="sheet-refresh" onClick={proposeCoOpPatch} disabled={!coopStatus?.activeSession || !coopPatchFile.trim()}>Propose Patch</button>
                {(coopStatus?.activeSession?.patches || []).slice(0, 6).map((patch) => (
                  <article className="receipt-row patch-row" key={patch.id}>
                    <FileText size={15} />
                    <div>
                      <strong>{patch.summary}</strong>
                      <span>{patch.filePath} / {patch.status} / {patch.riskLevel || "risk pending"}</span>
                      {patch.ghostResult && <p>{patch.ghostResult.status}: {patch.ghostResult.summary}</p>}
                      <div className="row-actions">
                        <button onClick={() => void runCoOpGhostTest(patch.id)}>Ghost Test</button>
                        <button onClick={() => void approveCoOpPatch(patch.id, true)}>Approve</button>
                        <button onClick={() => void approveCoOpPatch(patch.id, false)}>Reject</button>
                      </div>
                    </div>
                  </article>
                ))}
              </section>

              <section className="module-section">
                <div className="section-heading"><strong>Jarvis-to-Jarvis Bridge</strong><span>{coopStatus?.activeSession?.jarvisMessages?.length || 0}</span></div>
                <button className="sheet-refresh" onClick={askBothJarvis} disabled={!coopStatus?.activeSession}><Bot size={15} /> Start Jarvis Debate</button>
                {(coopStatus?.activeSession?.jarvisMessages || []).slice(0, 6).map((message) => (
                  <article className="receipt-row" key={message.id}>
                    <Bot size={15} />
                    <div>
                      <strong>{message.fromJarvisId} / {message.messageType}</strong>
                      <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                      <p>{String(message.payload?.claim || message.payload?.agreement || message.payload?.nextStep || JSON.stringify(message.payload).slice(0, 160))}</p>
                    </div>
                  </article>
                ))}
              </section>

              <section className="module-section">
                <div className="section-heading"><strong>Shared Task Board</strong><span>{coopStatus?.activeSession?.tasks?.length || 0}</span></div>
                <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void createCoOpTask(); }}>
                  <input value={coopTaskDraft} onChange={(event) => setCoopTaskDraft(event.currentTarget.value)} placeholder="Add task..." />
                  <button aria-label="Create co-op task"><Send size={16} /></button>
                </form>
                {(coopStatus?.activeSession?.tasks || []).slice(0, 6).map((task) => (
                  <article className="capability-row" key={task.id}>
                    <div><strong>{task.title}</strong><span>{task.status} / {task.assignedTo || "unassigned"}</span></div>
                  </article>
                ))}
              </section>

              <section className="module-section">
                <div className="section-heading"><strong>Project Memory Packets</strong><span>{coopStatus?.activeSession?.memoryPackets?.length || 0}</span></div>
                <button className="sheet-refresh" onClick={createCoOpMemoryPacket} disabled={!coopStatus?.activeSession}>Create Project Memory Packet</button>
                {(coopStatus?.activeSession?.memoryPackets || []).slice(0, 4).map((packet) => (
                  <article className="receipt-row" key={packet.id}>
                    <Sparkles size={15} />
                    <div>
                      <strong>{packet.scope}</strong>
                      <span>{packet.status}</span>
                      <p>Blocked: {(packet.blocked || []).slice(0, 4).join(" / ")}</p>
                    </div>
                  </article>
                ))}
              </section>

              <section className="module-section">
                <div className="section-heading"><strong>Skill Transfer Dock</strong><span>{coopStatus?.activeSession?.skillTransfers?.length || 0}</span></div>
                <button className="sheet-refresh" onClick={offerCoOpSkill} disabled={!coopStatus?.activeSession}>Offer Safe Skill</button>
                {(coopStatus?.activeSession?.skillTransfers || []).slice(0, 4).map((transfer) => (
                  <article className="receipt-row" key={transfer.id}>
                    <Blocks size={15} />
                    <div><strong>{transfer.skillManifest?.name || transfer.skillId}</strong><span>{transfer.status}</span><p>{transfer.skillManifest?.description}</p></div>
                  </article>
                ))}
              </section>

              <section className="module-section">
                <div className="section-heading"><strong>Replay Theater</strong><span>{coopStatus?.activeSession?.replays?.length || 0}</span></div>
                <button className="sheet-refresh" onClick={createCoOpReplay} disabled={!coopStatus?.activeSession}>Capture Replay</button>
                {(coopStatus?.activeSession?.replays || []).slice(0, 4).map((replay) => (
                  <article className="receipt-row" key={replay.id}>
                    <RefreshCw size={15} />
                    <div>
                      <strong>{replay.replayType}</strong>
                      <span>{new Date(replay.createdAt).toLocaleString()}</span>
                      <p>{replay.summary}</p>
                      <button className="mini-action" onClick={() => void saveCoOpReplayAsSkill(replay.id)}>Save as skill</button>
                    </div>
                  </article>
                ))}
              </section>

              <section className="module-section">
                <div className="section-heading"><strong>Co-Op Memory Storage</strong><span>{coopMemory?.storage?.tables?.length || 0} tables</span></div>
                <div className="mesh-stats">
                  {Object.entries(coopMemory?.counts || {}).slice(0, 10).map(([key, value]) => (
                    <article key={key}><strong>{value}</strong><span>{key}</span></article>
                  ))}
                </div>
                {(coopMemory?.events || []).slice(0, 6).map((event) => (
                  <article className="receipt-row" key={event.id}>
                    <Check size={15} />
                    <div><strong>{event.eventType}</strong><span>{event.actor} / {new Date(event.timestamp).toLocaleTimeString()}</span></div>
                  </article>
                ))}
              </section>
            </div>
          )}

          {toolView === "receipts" && (
            <div className="sheet-list">
              <button className="sheet-refresh" onClick={refreshReceipts}><RefreshCw size={15} /> Refresh</button>
              {receipts.map((receipt) => (
                <article className="receipt-row" key={receipt.id}>
                  <Check size={15} />
                  <div><strong>{receipt.action}</strong><span>{receipt.target} Â· {receipt.status}</span><p>{receipt.result}</p></div>
                </article>
              ))}
              {!receipts.length && <Empty text="No actions recorded yet." />}
            </div>
          )}
        </aside>
      )}
      {helixActive && <HelixRoom jarvisContext={messages.slice(-6).map(m => ({ speaker: m.speaker, text: m.text }))} onExit={() => { window.location.reload(); }} />}
    </main>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty"><Activity size={20} /><span>{text}</span></div>;
}
