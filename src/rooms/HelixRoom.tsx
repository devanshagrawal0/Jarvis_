import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import gsap from "gsap";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import "./helix.css";

// ── Helix sub-components ───────────────────────────────────────────────────
import { JarvisPanel } from "./helix/JarvisPanel";
import { HelixPulseOrb } from "./helix/HelixPulseOrb";
import { EvidenceLatticeGraph } from "./helix/EvidenceLatticeGraph";
import { HelixScene } from "./helix/HelixScene";
import { EntryCard, StrategyOptionsTree, AssumptionBoard, RiskGallery, PriorArtCard } from "./helix/EntryCard";
import { ContradictionArena, InsightCard } from "./helix/ContradictionArena";
import { CausalChainOverlay } from "./helix/CausalChainOverlay";
import { RedTeamOverlay } from "./helix/RedTeamOverlay";
import { ScenarioForge } from "./helix/ScenarioForge";
import { LivingBriefOverlay } from "./helix/LivingBriefOverlay";
import { OracleOverlay } from "./helix/OracleOverlay";
import { ForgePanel } from "./helix/ForgePanel";
import { KnowledgeReservoir } from "./helix/KnowledgeReservoir";
import { WorkflowStudio, WFNodeConfig } from "./helix/WorkflowStudio";
import { RelationGraphPanel } from "./helix/RelationGraphPanel";
import { AgentBuilderPanel, AgentConstellationOverlay } from "./helix/AgentPanel";
import { WidgetWindow, WidgetContent, WidgetPickerOverlay } from "./helix/WidgetSystem";
import { DeepBriefPanel } from "./helix/DeepBriefPanel";
import { HelixAmbientStrip } from "./helix/HelixAmbientStrip";
import { IntelPatternsPanel } from "./helix/IntelPatternsPanel";
import { HelixCommandPalette, wireTypeIcon, formatWireTime } from "./helix/HelixCommandPalette";
import { HelixTopbar } from "./helix/HelixTopbar";
import { HelixDockLayout } from "./helix/HelixDockLayout";
import { useHelixStore } from "./helix/useHelixStore";

// ── Shared types (all exported from helix-types) ───────────────────────────
import type {
  Strand, HelixEntry, HelixFolder, Contradiction, RedTeamCritique, RedTeamSession, Triangulation,
  StrategyOptionsData, Assumption, Risk, CausalChain, Scenario, PriorArt, LivingBrief,
  OracleAnswer, Insight, ForgeDocument, ForgeBlock, ForgeMode, BlockType, BlockSource, ArtificerMessage, KnowledgeFile,
  FileClaim, VaultEntry, WFNodeType, WFNode, WFEdge, WFGraph, WFWorkflow, WFRun,
  WFNodeRun, HelixEntity, EntityRelation, AgentState, TokenUsage, FloatingWidget,
  WidgetType, HelixLayout, HelixSignal, AlertRule, HelixSession, HelixCapsule,
  HelixProject, StrandHealth,
} from "./helix/helix-types";
import { STRAND_META, BRIEF_SECTION_LABELS, ALL_STRANDS, STRAND_DECAY_RATES, getFreshness, freshnessColor } from "./helix/helix-types";
import { previewTabType, TAB_TYPE_META, type TabPreviewResult } from "./helix/tabPreview";

// All types/constants/helpers now imported from ./helix/helix-types


interface Props {
  onExit: () => void;
  jarvisContext?: { speaker: string; text: string }[];
}


const LEFT_TABS  = ["Evidence", "Contradiction", "Knowledge", "Graph"] as const;
const FOLDER_COLORS = ["#4a9eff","#4affa0","#c4b5fd","#ff9e4a","#ff6b9d","#4afff0","#ffe14a","#a78bfa"];
const RIGHT_TABS = ["Strategy", "Risks", "Scenarios", "Experiments", "Synthesis", "Workflows", "Relations", "Agents", "Signals", "Journal"] as const;

type LeftTab  = typeof LEFT_TABS[number];
type RightTab = typeof RIGHT_TABS[number];

export function HelixRoom({ onExit, jarvisContext = [] }: Props) {
  // ── Persisted UI state (zustand) ─────────────────────────────────────────
  const {
    leftTab, setLeftTab, rightTab, setRightTab,
    leftCollapsed, setLeftCollapsed, rightCollapsed, setRightCollapsed,
    density, setDensity, heatMap, setHeatMap, panelSplit, setPanelSplit,
    topbarCollapsed, setTopbarCollapsed,
  } = useHelixStore();

  // Require 5px move before dnd-kit considers it a drag — prevents button clicks being swallowed
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [loadProgress, setLoadProgress] = useState(0);
  const [dataReady, setDataReady] = useState(false);
  const [phase, setPhase] = useState<"boot" | "ui">("boot");
  const [visible, setVisible] = useState(false);

  const [project, setProject]         = useState<HelixProject | null>(null);
  const [entries, setEntries]         = useState<HelixEntry[]>([]);
  const [vault, setVault]             = useState<VaultEntry[]>([]);
  const [health, setHealth]           = useState<StrandHealth>({ evidence: 0, strategy: 0, construction: 0, memory: 0, signal: 0, synthesis: 0 });
  const [activeStrand, setStrand]     = useState<Strand>("evidence");
  const [processing, setProcessing]   = useState(false);
  const [previewChips, setPreviewChips] = useState<TabPreviewResult[]>([]);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // leftTab/rightTab managed by useHelixStore above
  const [showVault, setShowVault]           = useState(false);
  const [editObjective, setEditObj]         = useState(false);
  const [objDraft, setObjDraft]             = useState("");
  const [wireItems, setWireItems]           = useState<{ text: string; t: number; type?: string }[]>([{ text: "HELIX online — Intelligence Chamber ready", t: 0, type: "system" }]);
  const [wireOpen, setWireOpen]             = useState(false);
  const [voidItems, setVoidItems]           = useState<HelixEntry[]>([]);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [openContradictionCount, setOpenContradictionCount] = useState(0);
  // heatMap managed by useHelixStore above

  // Wave 3 — Red Team & Triangulation
  const [redTeamActive, setRedTeamActive]   = useState(false);
  const [redTeamEntry, setRedTeamEntry]     = useState<HelixEntry | null>(null);
  const [redTeamSession, setRedTeamSession] = useState<RedTeamSession | null>(null);
  const [redTeamLoading, setRedTeamLoading] = useState(false);
  const [triangulations, setTriangulations] = useState<Record<string, Triangulation>>({});
  const [triangulatingIds, setTriangulatingIds] = useState<Set<string>>(new Set());
  const focusedCardRef = useRef<string | null>(null);

  // Wave 4 — Strategy Intelligence
  const [strategyOptions, setStrategyOptions] = useState<Record<string, StrategyOptionsData>>({});
  const [assumptions, setAssumptions]         = useState<Assumption[]>([]);
  const [risks, setRisks]                     = useState<Risk[]>([]);
  const [causalChain, setCausalChain]         = useState<CausalChain | null>(null);
  const [causalActive, setCausalActive]       = useState(false);
  const [developingIds, setDevelopingIds]     = useState<Set<string>>(new Set());
  const [tracingIds, setTracingIds]           = useState<Set<string>>(new Set());
  const [redTeamTargetText, setRedTeamTargetText] = useState<string | null>(null);

  // Wave 5 — Scenario Forge & Prior Art
  const [scenarios, setScenarios]           = useState<Record<string, Scenario>>({});
  const [priorArt, setPriorArt]             = useState<Record<string, PriorArt>>({});
  const [scenarioActive, setScenarioActive] = useState(false);
  const [scenarioEntry, setScenarioEntry]   = useState<HelixEntry | null>(null);
  const [forkingIds, setForkingIds]         = useState<Set<string>>(new Set());
  const [scanningIds, setScanningIds]       = useState<Set<string>>(new Set());

  // Wave 6 — Living Brief & Oracle
  const [brief, setBrief]                     = useState<LivingBrief | null>(null);
  const [showBrief, setShowBrief]             = useState(false);
  const [briefLoading, setBriefLoading]       = useState(false);
  const [briefHasNew, setBriefHasNew]         = useState(false);
  const [changedSections, setChangedSections] = useState<Record<string, boolean>>({});
  const [oracleActive, setOracleActive]       = useState(false);
  const [oracleQuery, setOracleQuery]         = useState("");
  const [oracleAnswer, setOracleAnswer]       = useState<OracleAnswer | null>(null);
  const [oracleLoading, setOracleLoading]     = useState(false);
  const [insights, setInsights]               = useState<Insight[]>([]);
  const [insightsGenerating, setInsightsGenerating] = useState(false);

  // Wave 8 — The Forge
  const [forgeOpen, setForgeOpen]               = useState(false);
  const [forgeDocs, setForgeDocs]               = useState<ForgeDocument[]>([]);
  const [forgeDoc, setForgeDoc]                 = useState<ForgeDocument | null>(null);
  const [forgeBlocks, setForgeBlocks]           = useState<ForgeBlock[]>([]);
  const [forgeSaving, setForgeSaving]           = useState(false);
  const [forgeArtificerMessages, setArtificerMessages] = useState<ArtificerMessage[]>([]);
  const [artificerInput, setArtificerInput]     = useState("");
  const [artificerLoading, setArtificerLoading] = useState(false);
  const [artificerActive, setArtificerActive]   = useState(true);
  const [forgeRail, setForgeRail]               = useState<"outline" | "artificer">("artificer");
  const [forgeRelevant, setForgeRelevant]       = useState<HelixEntry[]>([]);
  const [forgeActiveBlockId, setForgeActiveBlockId] = useState<string | null>(null);
  const [forgeFocusMode, setForgeFocusMode]         = useState(false);
  const [forgeIntelSearch, setForgeIntelSearch]     = useState("");
  const [forgeLastSaved, setForgeLastSaved]         = useState<Date | null>(null);
  const forgeSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forgeWordCount = useMemo(
    () => forgeBlocks.reduce((n, b) => n + b.content.split(/\s+/).filter(Boolean).length, 0),
    [forgeBlocks]
  );

  // Wave 9 — Workflow Studio
  const [wfOpen, setWfOpen]                       = useState(false);
  const [wfWorkflows, setWfWorkflows]             = useState<WFWorkflow[]>([]);
  const [wfActiveId, setWfActiveId]               = useState<string | null>(null);
  const [wfGraph, setWfGraph]                     = useState<WFGraph>({ nodes: [], edges: [] });
  const [wfSelectedNodeId, setWfSelectedNodeId]   = useState<string | null>(null);
  const [wfRun, setWfRun]                         = useState<WFRun | null>(null);
  const [wfNodeRuns, setWfNodeRuns]               = useState<WFNodeRun[]>([]);
  const [wfRunning, setWfRunning]                 = useState(false);
  const [wfRunHistory, setWfRunHistory]           = useState<WFRun[]>([]);
  const [wfRightPanel, setWfRightPanel]           = useState<"config" | "log">("config");
  const [wfSaving, setWfSaving]                   = useState(false);
  const [wfEdgeDraw, setWfEdgeDraw]               = useState<{ fromId: string } | null>(null);
  const wfPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Wave 10 — Relation Graph & Entity System
  const [entities, setEntities]                         = useState<HelixEntity[]>([]);
  const [entityRelations, setEntityRelations]           = useState<EntityRelation[]>([]);
  const [extractingEntities, setExtractingEntities]     = useState(false);
  const [probeEntryId, setProbeEntryId]                 = useState<string | null>(null);
  const [probeConnected, setProbeConnected]             = useState<Set<string>>(new Set());
  const [briefEntry, setBriefEntry]                     = useState<HelixEntry | null>(null);
  // Wave 10 — Agent Constellation & Builder
  const [agents, setAgents]                             = useState<AgentState[]>([]);
  const [agentConstOpen, setAgentConstOpen]             = useState(false);
  const [agentBuilderName, setAgentBuilderName]         = useState("");
  const [agentBuilderPrompt, setAgentBuilderPrompt]     = useState("");
  const [agentBuilderTrigger, setAgentBuilderTrigger]   = useState("manual");
  const [agentBuilderOutput, setAgentBuilderOutput]     = useState("text");
  const [agentBuilderRunNow, setAgentBuilderRunNow]     = useState(false);
  const [agentBuilderInput, setAgentBuilderInput]       = useState("");
  const [agentBuilderSaving, setAgentBuilderSaving]     = useState(false);
  const [agentRunResult, setAgentRunResult]             = useState<string | null>(null);
  const [tokenUsage, setTokenUsage]                     = useState<TokenUsage | null>(null);

  // Wave 11 — Widget System & Layout Engine
  // panelSplit, leftCollapsed, rightCollapsed managed by useHelixStore above
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);
  const [widgets, setWidgets]             = useState<FloatingWidget[]>([]);
  const [layouts, setLayouts]             = useState<HelixLayout[]>([]);
  const [layoutSaveOpen, setLayoutSaveOpen] = useState(false);
  const [layoutSaveName, setLayoutSaveName] = useState("");

  // Wave 12 — Signal Strand
  const [signals, setSignals]             = useState<HelixSignal[]>([]);
  const [alertRules, setAlertRules]       = useState<AlertRule[]>([]);
  const [signalLiveOnly, setSignalLiveOnly] = useState(true);
  const [signalFormOpen, setSignalFormOpen] = useState(false);
  const [signalForm, setSignalForm]       = useState({ title: "", source: "manual", signal_type: "price", value: "", ttl_seconds: 3600 });
  const [alertFormOpen, setAlertFormOpen] = useState(false);
  const [alertForm, setAlertForm]         = useState<{ name: string; signal_type: string; source: string; condition: "above" | "below" | "equals"; threshold: number; message: string }>({ name: "", signal_type: "price", source: "kalshi", condition: "above", threshold: 0, message: "" });

  // Wave 13 — Sessions, Capsules, Journal
  const [sessions, setSessions]               = useState<HelixSession[]>([]);
  const [capsules, setCapsules]               = useState<HelixCapsule[]>([]);
  const [sessionId, setSessionId]             = useState<string | null>(null);
  const [sessionInquiryCount, setSessionInquiryCount] = useState(0);
  const [journalReplayId, setJournalReplayId] = useState<string | null>(null);
  const [capsuleExporting, setCapsuleExporting] = useState(false);
  const [capsuleImportOpen, setCapsuleImportOpen] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const sessionDataRef = useRef<{ inquiryCount: number; wireSnapshot: string[] }>({ inquiryCount: 0, wireSnapshot: [] });

  // Wave 7 — Knowledge Reservoir
  const [knowledgeFiles, setKnowledgeFiles]   = useState<KnowledgeFile[]>([]);
  const [fileClaims, setFileClaims]           = useState<Record<string, FileClaim[]>>({});
  const [expandedFileId, setExpandedFileId]   = useState<string | null>(null);
  const [dropActive, setDropActive]           = useState(false);
  const [ingestingFile, setIngestingFile]     = useState(false);
  const dropPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Upgrade features: ambient strip, patterns panel, brief tracking
  const [briefedEntryIds, setBriefedEntryIds] = useState<Set<string>>(new Set());
  const [lastActionTs, setLastActionTs]       = useState<number | null>(null);
  const [patternsOpen, setPatternsOpen]       = useState(false);

  // UI-2 — Jarvis panel
  const [showJarvis, setShowJarvis]       = useState(false);

  // UI-5 — Dock mode
  const [dockMode, setDockMode] = useState(false);

  // v5 — HCI upgrade state
  const [toasts, setToasts]               = useState<{ id: string; type: string; msg: string; sub?: string; icon: string }[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [lastAnalysis, setLastAnalysis]   = useState<{ strand: string; confidence: number } | null>(null);
  const [spotlightId, setSpotlightId]     = useState<string | null>(null);
  // density managed by useHelixStore above
  const [leftPanelSearch, setLeftPanelSearch]   = useState("");
  const [rightPanelSearch, setRightPanelSearch] = useState("");
  const [leftPanelSort, setLeftPanelSort]   = useState<"freshness" | "confidence" | "recent">("recent");
  const [rightPanelSort, setRightPanelSort] = useState<"freshness" | "confidence" | "recent">("recent");
  const [leftPanelFlash, setLeftPanelFlash]   = useState(false);
  const [rightPanelFlash, setRightPanelFlash] = useState(false);

  // Folder system
  const [folders, setFolders]               = useState<HelixFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [showFolderCreate, setShowFolderCreate] = useState(false);
  const [newFolderName, setNewFolderName]       = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft]           = useState("");

  const inputRef   = useRef<HTMLInputElement>(null);
  const leftRef    = useRef<HTMLDivElement>(null);
  const rightRef   = useRef<HTMLDivElement>(null);
  const starCanvasRef = useRef<HTMLCanvasElement>(null);
  const entriesRef = useRef<HelixEntry[]>([]);
  const mainRef    = useRef<HTMLDivElement>(null);
  const resizeDrag = useRef<{ startX: number; startSplit: number; side: 'left' | 'right' } | null>(null);
  const widgetResize = useRef<{ id: string; sx: number; sy: number; sw: number; sh: number } | null>(null);

  // ── Wave 11: Panel resize + widget drag global mouse handlers ────────────
  useEffect(() => {
    function onMove(e: MouseEvent) {
      // Panel resize
      if (resizeDrag.current) {
        const mainEl = mainRef.current;
        if (!mainEl) return;
        const avail = mainEl.clientWidth - 260;
        const delta = e.clientX - resizeDrag.current.startX;
        const fracDelta = delta / avail;
        const rawSplit = resizeDrag.current.side === 'left'
          ? resizeDrag.current.startSplit + fracDelta
          : resizeDrag.current.startSplit - fracDelta;
        setPanelSplit(Math.max(0.15, Math.min(0.85, rawSplit)));
      }
      // Widget resize
      if (widgetResize.current) {
        const d = widgetResize.current;
        updateWidget(d.id, {
          width: Math.max(120, d.sw + (e.clientX - d.sx)),
          height: Math.max(80, d.sh + (e.clientY - d.sy)),
        });
      }
    }
    function onUp() {
      if (resizeDrag.current) {
        setPanelSplit(v => snapSplit(v));
        resizeDrag.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.body.classList.remove("helix-panel-resizing");
      }
      widgetResize.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  // Animate progress bar 0→85% while data loads, then snap to 100% and enter UI
  useEffect(() => {
    let raf: number | null = null;
    const start = performance.now();
    const FILL_MS = 1800;
    const animate = (now: number) => {
      const t = Math.min((now - start) / FILL_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setLoadProgress(eased * 0.85);
      if (t < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    void loadProject().finally(() => setDataReady(true));
    return () => {
      if (raf) cancelAnimationFrame(raf);
      void closeSession();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dataReady) return;
    setLoadProgress(1);
    const t = setTimeout(() => setPhase("ui"), 500);
    return () => clearTimeout(t);
  }, [dataReady]);

  // Star-warp canvas — runs while boot screen is visible
  useEffect(() => {
    if (phase !== "boot") return;
    const canvas = starCanvasRef.current;
    if (!canvas) return;
    let animId: number;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    const STAR_COUNT = 220;
    const stars = Array.from({ length: STAR_COUNT }, () => ({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random(),
      pz: 1,
    }));
    let prev = performance.now();
    const draw = (now: number) => {
      const dt = Math.min((now - prev) / 16.67, 3);
      prev = now;
      const w = canvas.width; const h = canvas.height;
      const cx = w / 2; const cy = h / 2;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgba(0,2,10,0.28)";
      ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        s.pz = s.z;
        s.z -= 0.0045 * dt;
        if (s.z <= 0.001) { s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2; s.z = 1; s.pz = 1; continue; }
        const sx = cx + (s.x / s.z) * cx;
        const sy = cy + (s.y / s.z) * cy;
        const px = cx + (s.x / s.pz) * cx;
        const py = cy + (s.y / s.pz) * cy;
        if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) { s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2; s.z = 1; s.pz = 1; continue; }
        const alpha = Math.min(1, (1 - s.z) * 1.6);
        const size = Math.max(0.4, (1 - s.z) * 2.2);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy);
        ctx.strokeStyle = `rgba(160,200,255,${alpha})`; ctx.lineWidth = size; ctx.stroke();
      }
      animId = requestAnimationFrame(draw);
    };
    animId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, [phase]);

  useEffect(() => () => { if (forgeSaveTimerRef.current) clearTimeout(forgeSaveTimerRef.current); }, []);
  useEffect(() => () => { if (wfPollRef.current) clearInterval(wfPollRef.current); }, []);

  useEffect(() => {
    if (phase !== "ui") return;
    const t = setTimeout(() => { setVisible(true); setTimeout(() => inputRef.current?.focus(), 400); }, 80);
    return () => clearTimeout(t);
  }, [phase]);

  async function loadProject() {
    try {
      const r = await fetch("/api/helix/projects");
      const d = await r.json() as { projects: HelixProject[] };
      let proj = d.projects?.[0];
      if (!proj) {
        const cr = await fetch("/api/helix/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Untitled Project" }) });
        const cd = await cr.json() as { project: HelixProject };
        proj = cd.project;
      }
      setProject(proj);
      await Promise.allSettled([
        loadEntries(proj.id),
        loadVault(proj.id),
        loadContradictions(proj.id),
        loadTriangulations(proj.id),
        loadStrategyData(proj.id),
        loadInsights(proj.id),
        loadFiles(proj.id),
        (async () => { const r = await fetch(`/api/helix/forge/documents?projectId=${proj.id}`); if (r.ok) { const d = await r.json() as { documents: ForgeDocument[] }; setForgeDocs(d.documents ?? []); } })(),
        loadWfWorkflows(proj.id),
        loadRelationGraph(proj.id),
        loadAgents(proj.id),
        loadTokenUsage(proj.id),
        loadLayouts(proj.id),
        loadSignals(proj.id),
        loadAlertRules(proj.id),
        loadSessions(proj.id),
        loadCapsules(proj.id),
        loadBriefedIds(proj.id),
      ]);
      void openSession(proj.id);
    } catch (e) {
      addWire("Connection error — backend unreachable");
    }
  }

  async function loadFolders(projectId: string) {
    try {
      const r = await fetch(`/api/helix/folders?projectId=${encodeURIComponent(projectId)}`);
      if (r.ok) { const d = await r.json() as { folders: HelixFolder[] }; setFolders(d.folders ?? []); }
    } catch { /* non-fatal */ }
  }

  async function loadBriefedIds(projectId: string) {
    try {
      const r = await fetch(`/api/helix/briefs?projectId=${encodeURIComponent(projectId)}`);
      if (r.ok) {
        const d = await r.json() as { briefedEntryIds: string[] };
        setBriefedEntryIds(new Set(d.briefedEntryIds ?? []));
      }
    } catch { /* non-fatal */ }
  }

  async function loadEntries(projectId: string) {
    const r = await fetch(`/api/helix/entries?projectId=${projectId}`);
    const d = await r.json() as { entries: HelixEntry[]; health: StrandHealth; project: HelixProject };
    setEntries(d.entries ?? []);
    if (d.health) setHealth(d.health);
    if (d.project) setProject(d.project);
    void loadFolders(projectId);
  }

  async function loadVault(projectId: string) {
    const r = await fetch(`/api/helix/vault?projectId=${projectId}`);
    const d = await r.json() as { vault: VaultEntry[] };
    setVault(d.vault ?? []);
  }

  async function loadContradictions(projectId: string) {
    try {
      const r = await fetch(`/api/helix/contradictions?projectId=${projectId}`);
      const d = await r.json() as { contradictions: Contradiction[]; openCount: number };
      setContradictions(d.contradictions ?? []);
      setOpenContradictionCount(d.openCount ?? 0);
    } catch { /**/ }
  }

  async function loadTriangulations(projectId: string) {
    try {
      const r = await fetch(`/api/helix/triangulations?projectId=${projectId}`);
      const d = await r.json() as { triangulations: Triangulation[] };
      const map: Record<string, Triangulation> = {};
      for (const t of (d.triangulations ?? [])) map[t.entry_id] = t;
      setTriangulations(map);
    } catch { /**/ }
  }

  async function loadStrategyData(projectId: string) {
    try {
      const [stratRes, scenRes, priorRes] = await Promise.allSettled([
        fetch(`/api/helix/strategy/developed?projectId=${projectId}`).then(r => r.json()),
        fetch(`/api/helix/scenarios?projectId=${projectId}`).then(r => r.json()),
        fetch(`/api/helix/prior-art?projectId=${projectId}`).then(r => r.json()),
      ]);
      if (stratRes.status === "fulfilled") {
        const d = stratRes.value as { options: StrategyOptionsData[]; assumptions: Assumption[]; risks: Risk[] };
        const optMap: Record<string, StrategyOptionsData> = {};
        for (const opt of (d.options ?? [])) optMap[opt.entry_id] = opt;
        setStrategyOptions(optMap);
        setAssumptions(d.assumptions ?? []);
        setRisks(d.risks ?? []);
      }
      if (scenRes.status === "fulfilled") {
        const d = scenRes.value as { scenarios: Scenario[] };
        const scenMap: Record<string, Scenario> = {};
        for (const s of (d.scenarios ?? [])) scenMap[s.entry_id] = s;
        setScenarios(scenMap);
      }
      if (priorRes.status === "fulfilled") {
        const d = priorRes.value as { priorArt: PriorArt[] };
        const paMap: Record<string, PriorArt> = {};
        for (const pa of (d.priorArt ?? [])) paMap[pa.entry_id] = pa;
        setPriorArt(paMap);
      }
    } catch { /**/ }
  }

  async function loadInsights(projectId: string) {
    try {
      const r = await fetch(`/api/helix/insights?projectId=${projectId}`);
      const d = await r.json() as { insights: Insight[] };
      setInsights(d.insights ?? []);
    } catch { /**/ }
  }

  async function loadFiles(projectId: string) {
    try {
      const r = await fetch(`/api/helix/files?projectId=${projectId}`);
      if (!r.ok) return;
      const d = await r.json() as { files: KnowledgeFile[] };
      setKnowledgeFiles(d.files ?? []);
    } catch { /**/ }
  }

  async function loadFileClaims(fileId: string) {
    try {
      const r = await fetch(`/api/helix/files/${fileId}/claims`);
      if (!r.ok) return;
      const d = await r.json() as { claims: FileClaim[] };
      setFileClaims(prev => ({ ...prev, [fileId]: d.claims ?? [] }));
    } catch { /**/ }
  }

  async function ingestFile(file: File) {
    if (!project || ingestingFile) return;
    setIngestingFile(true);
    addWire(`Ingesting "${file.name}"…`);
    try {
      const buf = await file.arrayBuffer();
      const arr = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
      const b64 = btoa(bin);
      const r = await fetch("/api/helix/file/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, filename: file.name, data: b64, mimetype: file.type }),
      });
      if (!r.ok) { addWire(`Ingest failed: ${file.name}`); return; }
      const d = await r.json() as { fileId: string; status: string; claimCount?: number };
      if (d.status === "cached") {
        addWire(`"${file.name}" already indexed — ${d.claimCount ?? 0} claims`);
        await loadFiles(project.id);
      } else {
        addWire(`"${file.name}" processing…`);
        await loadFiles(project.id);
        setLeftTab("Knowledge");
        const pid = project.id;
        let polls = 0;
        dropPollRef.current = setInterval(async () => {
          polls++;
          try {
            const r2 = await fetch(`/api/helix/files?projectId=${pid}`);
            if (!r2.ok) return;
            const updated = await r2.json() as { files: KnowledgeFile[] };
            setKnowledgeFiles(updated.files ?? []);
            const f = (updated.files ?? []).find(f2 => f2.id === d.fileId);
            if (f && (f.status === "ready" || f.status === "failed" || polls > 30)) {
              if (dropPollRef.current) clearInterval(dropPollRef.current);
              dropPollRef.current = null;
              if (f.status === "ready") addWire(`"${file.name}" ready — ${f.claim_count} claims extracted`);
              else addWire(`"${file.name}" processing failed`);
            }
          } catch { /**/ }
        }, 2000);
      }
    } catch { addWire(`Ingest error: ${file.name}`); }
    finally { setIngestingFile(false); }
  }

  async function deleteKnowledgeFile(fileId: string) {
    setKnowledgeFiles(prev => prev.filter(f => f.id !== fileId));
    try {
      await fetch(`/api/helix/files/${fileId}`, { method: "DELETE" });
    } catch {
      if (project) await loadFiles(project.id);
    }
  }

  // ── The Forge (Wave 8) ─────────────────────────────────────────────────────
  async function loadForgeDocs() {
    if (!project) return;
    try {
      const r = await fetch(`/api/helix/forge/documents?projectId=${project.id}`);
      if (!r.ok) return;
      const d = await r.json() as { documents: ForgeDocument[] };
      setForgeDocs(d.documents ?? []);
    } catch { /**/ }
  }

  async function openForge(doc?: ForgeDocument) {
    if (!project) return;
    setForgeOpen(true);
    if (doc) {
      setForgeDoc(doc);
      setArtificerMessages([]);
      setArtificerInput("");
      setForgeRelevant([]);
      setForgeActiveBlockId(null);
      try {
        const r = await fetch(`/api/helix/forge/documents/${doc.id}`);
        if (!r.ok) return;
        const d = await r.json() as { document: ForgeDocument; blocks: ForgeBlock[] };
        setForgeDoc(d.document);
        setForgeBlocks(d.blocks ?? []);
      } catch { /**/ }
    } else {
      await loadForgeDocs();
      setForgeDoc(null);
      setForgeBlocks([]);
    }
  }

  async function newForgeDoc() {
    if (!project) return;
    try {
      const r = await fetch("/api/helix/forge/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, title: "Untitled", mode: "document" }),
      });
      if (!r.ok) return;
      const d = await r.json() as { document: ForgeDocument };
      setForgeDocs(prev => [d.document, ...prev]);
      setForgeDoc(d.document);
      setForgeBlocks([]);
      setArtificerMessages([]);
    } catch { /**/ }
  }

  function scheduleForgeSave(doc: ForgeDocument, blocks: ForgeBlock[]) {
    if (forgeSaveTimerRef.current) clearTimeout(forgeSaveTimerRef.current);
    forgeSaveTimerRef.current = setTimeout(() => void saveForgeBlocks(doc, blocks), 1200);
  }

  async function saveForgeBlocks(doc: ForgeDocument, blocks: ForgeBlock[]) {
    setForgeSaving(true);
    try {
      const r = await fetch(`/api/helix/forge/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      });
      if (!r.ok) return;
      const d = await r.json() as { document: ForgeDocument; blocks: ForgeBlock[] };
      setForgeDoc(d.document);
      setForgeBlocks(d.blocks ?? []);
      setForgeLastSaved(new Date());
    } catch { /**/ }
    finally { setForgeSaving(false); }
  }

  function updateForgeBlock(id: string, content: string) {
    if (!forgeDoc) return;
    const updated = forgeBlocks.map(b => b.id === id ? { ...b, content } : b);
    setForgeBlocks(updated);
    scheduleForgeSave(forgeDoc, updated);
  }

  function addForgeBlock(type: BlockType, content = "", sourceType: BlockSource = "manual", sourceId: string | null = null, strand: Strand | null = null, confidence = 1.0) {
    if (!forgeDoc) return;
    const rawIdx = forgeActiveBlockId ? forgeBlocks.findIndex(b => b.id === forgeActiveBlockId) : -1;
    const insertIdx = rawIdx < 0 ? forgeBlocks.length - 1 : rawIdx;
    const newBlock: ForgeBlock = {
      id: crypto.randomUUID(),
      document_id: forgeDoc.id,
      type, content,
      source_type: sourceType,
      source_id: sourceId,
      confidence,
      strand,
      order_index: insertIdx + 1,
      locked: 0,
      created_at: new Date().toISOString(),
    };
    const updated = [
      ...forgeBlocks.slice(0, insertIdx + 1),
      newBlock,
      ...forgeBlocks.slice(insertIdx + 1).map((b, i) => ({ ...b, order_index: insertIdx + 2 + i })),
    ];
    setForgeBlocks(updated);
    setForgeActiveBlockId(newBlock.id);
    scheduleForgeSave(forgeDoc, updated);
  }

  function removeForgeBlock(id: string) {
    if (!forgeDoc) return;
    const updated = forgeBlocks.filter(b => b.id !== id).map((b, i) => ({ ...b, order_index: i }));
    setForgeBlocks(updated);
    scheduleForgeSave(forgeDoc, updated);
  }

  function pullEntryToForge(entry: HelixEntry) {
    addForgeBlock("quote", entry.text, "pulled", entry.id, entry.strand as Strand, entry.confidence);
  }

  async function askArtificer(msg: string) {
    if (!forgeDoc || !msg.trim() || artificerLoading) return;
    setArtificerLoading(true);
    const userMsg: ArtificerMessage = { role: "user", content: msg };
    setArtificerMessages(prev => [...prev, userMsg]);
    setArtificerInput("");
    try {
      const r = await fetch("/api/helix/forge/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: forgeDoc.id, projectId: project?.id, message: msg }),
      });
      if (!r.ok) throw new Error("agent failed");
      const d = await r.json() as { reply: string; messages: ArtificerMessage[] };
      setArtificerMessages(d.messages ?? []);
    } catch { setArtificerMessages(prev => [...prev, { role: "assistant", content: "The Artificer encountered an error." }]); }
    finally { setArtificerLoading(false); }
  }

  async function updateForgeTitle(title: string) {
    if (!forgeDoc) return;
    try {
      const r = await fetch(`/api/helix/forge/documents/${forgeDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!r.ok) return;
      const d = await r.json() as { document: ForgeDocument };
      setForgeDoc(d.document);
      setForgeDocs(prev => prev.map(dd => dd.id === d.document.id ? d.document : dd));
    } catch { /**/ }
  }

  async function exportForge() {
    if (!forgeDoc) return;
    try {
      const r = await fetch("/api/helix/forge/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: forgeDoc.id }),
      });
      if (!r.ok) return;
      const d = await r.json() as { markdown: string; title: string };
      const blob = new Blob([d.markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(d.title || "forge-doc").replace(/\s+/g, "-").toLowerCase()}.md`;
      a.click();
      URL.revokeObjectURL(url);
      addWire(`Exported "${d.title}" as Markdown`);
    } catch { addWire("Export failed"); }
  }

  async function loadForgeRelevant() {
    if (!forgeDoc || !project || forgeBlocks.length === 0) return;
    try {
      const r = await fetch(`/api/helix/forge/relevant?documentId=${forgeDoc.id}&projectId=${project.id}`);
      if (!r.ok) return;
      const d = await r.json() as { relevant: HelixEntry[] };
      setForgeRelevant(d.relevant ?? []);
    } catch { /**/ }
  }

  async function switchForgeMode(mode: ForgeMode) {
    if (!forgeDoc) return;
    try {
      const r = await fetch(`/api/helix/forge/documents/${forgeDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!r.ok) return;
      const d = await r.json() as { document: ForgeDocument };
      setForgeDoc(d.document);
      setForgeDocs(prev => prev.map(dd => dd.id === d.document.id ? d.document : dd));
    } catch { /**/ }
  }

  async function deleteForgeDoc(id: string) {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    try {
      const r = await fetch(`/api/helix/forge/documents/${id}`, { method: "DELETE" });
      if (!r.ok) return;
      const remaining = forgeDocs.filter(d => d.id !== id);
      setForgeDocs(remaining);
      if (forgeDoc?.id === id) {
        if (remaining.length > 0) void openForge(remaining[0]);
        else { setForgeDoc(null); setForgeBlocks([]); }
      }
    } catch { /**/ }
  }

  function moveForgeBlock(id: string, dir: "up" | "down") {
    if (!forgeDoc) return;
    const idx = forgeBlocks.findIndex(b => b.id === id);
    if (idx < 0) return;
    const newIdx = dir === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= forgeBlocks.length) return;
    const updated = [...forgeBlocks];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    const reindexed = updated.map((b, i) => ({ ...b, order_index: i }));
    setForgeBlocks(reindexed);
    scheduleForgeSave(forgeDoc, reindexed);
  }

  function insertArtificerBlock(content: string) {
    addForgeBlock("paragraph", content, "ai", null, null, 0.9);
  }

  function duplicateForgeBlock(id: string) {
    const block = forgeBlocks.find(b => b.id === id);
    if (!block) return;
    addForgeBlock(block.type, block.content, block.source_type, block.source_id, block.strand, block.confidence);
  }

  // ── Wave 9: Workflow Studio functions ──────────────────────────────────────
  async function loadWfWorkflows(pid: string) {
    try {
      const r = await fetch(`/api/helix/workflows?projectId=${pid}`);
      if (r.ok) { const d = await r.json() as { workflows: WFWorkflow[] }; setWfWorkflows(d.workflows ?? []); }
    } catch { /**/ }
  }

  function openWfWorkflow(wf: WFWorkflow) {
    setWfActiveId(wf.id);
    let graph: WFGraph = { nodes: [], edges: [] };
    try { graph = JSON.parse(wf.graph_json) as WFGraph; } catch { /**/ }
    setWfGraph(graph);
    setWfSelectedNodeId(null);
    setWfRun(null);
    setWfNodeRuns([]);
    setWfRightPanel("config");
    void loadWfRunHistory(wf.id);
  }

  async function loadWfRunHistory(wfId: string) {
    try {
      const r = await fetch(`/api/helix/workflows/${wfId}/runs`);
      if (r.ok) { const d = await r.json() as { runs: WFRun[] }; setWfRunHistory(d.runs ?? []); }
    } catch { /**/ }
  }

  async function newWfWorkflow() {
    if (!project) return;
    try {
      const r = await fetch("/api/helix/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, name: "New Workflow", description: "" }),
      });
      if (!r.ok) return;
      const d = await r.json() as { id: string };
      // Single fetch to refresh list and open new workflow (removed redundant loadWfWorkflows call)
      const updated = await fetch(`/api/helix/workflows?projectId=${project.id}`);
      if (updated.ok) {
        const ud = await updated.json() as { workflows: WFWorkflow[] };
        setWfWorkflows(ud.workflows ?? []);
        const fresh = ud.workflows.find(w => w.id === d.id);
        if (fresh) openWfWorkflow(fresh);
      }
    } catch { /**/ }
  }

  async function saveWfGraph() {
    if (!wfActiveId) return;
    const wf = wfWorkflows.find(w => w.id === wfActiveId);
    if (!wf || wf.is_builtin) return;
    setWfSaving(true);
    try {
      await fetch(`/api/helix/workflows/${wfActiveId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: wf.name, description: wf.description, graph: wfGraph }),
      });
      // Update local copy
      setWfWorkflows(ws => ws.map(w => w.id === wfActiveId ? { ...w, graph_json: JSON.stringify(wfGraph) } : w));
    } catch { /**/ } finally { setWfSaving(false); }
  }

  async function runWfWorkflow() {
    if (!project || !wfActiveId || wfRunning) return;
    setWfRunning(true);
    setWfRun(null);
    setWfNodeRuns([]);
    setWfRightPanel("log");
    try {
      const r = await fetch(`/api/helix/workflows/${wfActiveId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!r.ok) { setWfRunning(false); return; }
      const d = await r.json() as { runId: string };
      startWfPoll(d.runId);
    } catch { setWfRunning(false); }
  }

  function startWfPoll(runId: string) {
    if (wfPollRef.current) clearInterval(wfPollRef.current);
    const pid = project?.id;
    async function doPoll() {
      try {
        const r = await fetch(`/api/helix/workflow/run/${runId}?projectId=${pid}`);
        if (!r.ok) return;
        const d = await r.json() as { run: WFRun; nodeRuns: WFNodeRun[] };
        setWfRun(d.run);
        setWfNodeRuns(d.nodeRuns);
        if (d.run.status === "complete" || d.run.status === "failed") {
          clearInterval(wfPollRef.current!);
          wfPollRef.current = null;
          setWfRunning(false);
          setWfRunHistory(h => [d.run, ...h.slice(0, 19)]);
          if (d.run.status === "complete" && project) void loadVault(project.id);
        }
      } catch { /**/ }
    }
    void doPoll(); // immediate first poll — don't wait 1500ms
    wfPollRef.current = setInterval(doPoll, 1500);
  }

  function addWfNode(type: WFNodeType) {
    const NODE_TYPE_DEFAULTS: Record<WFNodeType, Partial<WFNode>> = {
      query:     { label: "Query",     config: { prompt: "", strand: "evidence" } },
      filter:    { label: "Filter",    config: { strand: "", min_confidence: 0 } },
      verify:    { label: "Verify",    config: { depth: 2 } },
      analyze:   { label: "Analyze",   config: { analysis_type: "assumptions" } },
      summarize: { label: "Summarize", config: { instructions: "" } },
      store:     { label: "Store",     config: { vault_label: "Result" } },
    };
    const defaults = NODE_TYPE_DEFAULTS[type];
    const existingCount = wfGraph.nodes.filter(n => n.type === type).length;
    const newNode: WFNode = {
      id: crypto.randomUUID(),
      type,
      label: `${defaults.label} ${existingCount + 1}`,
      x: 60 + (wfGraph.nodes.length % 4) * 200,
      y: 80 + Math.floor(wfGraph.nodes.length / 4) * 140,
      config: { ...(defaults.config ?? {}) },
    };
    const updated = { ...wfGraph, nodes: [...wfGraph.nodes, newNode] };
    setWfGraph(updated);
    setWfSelectedNodeId(newNode.id);
  }

  function moveWfNode(id: string, x: number, y: number) {
    setWfGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === id ? { ...n, x: Math.max(0, x), y: Math.max(0, y) } : n) }));
  }

  function addWfEdge(fromId: string, toId: string) {
    if (fromId === toId) return;
    if (wfGraph.edges.some(e => e.from === fromId && e.to === toId)) return;
    // Cycle detection: DFS from toId — if we can reach fromId then adding this edge creates a cycle
    const adj: Record<string, string[]> = {};
    for (const n of wfGraph.nodes) adj[n.id] = [];
    for (const e of wfGraph.edges) adj[e.from]?.push(e.to);
    const visited = new Set<string>();
    const stack = [toId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === fromId) return; // would create a cycle — silently block
      if (!visited.has(cur)) { visited.add(cur); for (const nb of (adj[cur] ?? [])) stack.push(nb); }
    }
    const edge: WFEdge = { id: crypto.randomUUID(), from: fromId, to: toId };
    setWfGraph(g => ({ ...g, edges: [...g.edges, edge] }));
    setWfEdgeDraw(null);
  }

  function removeWfEdge(id: string) {
    setWfGraph(g => ({ ...g, edges: g.edges.filter(e => e.id !== id) }));
  }

  function deleteWfNode(id: string) {
    setWfGraph(g => ({
      nodes: g.nodes.filter(n => n.id !== id),
      edges: g.edges.filter(e => e.from !== id && e.to !== id),
    }));
    if (wfSelectedNodeId === id) setWfSelectedNodeId(null);
  }

  function updateWfNodeConfig(id: string, patch: Partial<WFNode>) {
    setWfGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === id ? { ...n, ...patch } : n) }));
  }

  async function deleteWfWorkflow(id: string) {
    if (!window.confirm("Delete this workflow?")) return;
    try {
      await fetch(`/api/helix/workflows/${id}`, { method: "DELETE" });
      if (wfActiveId === id) { setWfActiveId(null); setWfGraph({ nodes: [], edges: [] }); }
      if (project) void loadWfWorkflows(project.id);
    } catch { /**/ }
  }

  // ── Wave 10: Relation Graph, Entity System, Agent Builder ───────────────────

  async function loadRelationGraph(pId: string) {
    try {
      const r = await fetch(`/api/helix/relation-graph?projectId=${pId}`);
      if (!r.ok) return;
      const data = await r.json() as { entities: HelixEntity[]; relations: EntityRelation[] };
      setEntities((data.entities || []).map(e => ({ ...e, aliases: e.aliases || [] })));
      setEntityRelations(data.relations || []);
    } catch { /**/ }
  }

  async function extractEntities() {
    if (!project || extractingEntities) return;
    setExtractingEntities(true);
    try {
      const r = await fetch("/api/helix/entities/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!r.ok) return;
      const data = await r.json() as { entities: HelixEntity[]; relations: EntityRelation[] };
      setEntities((data.entities || []).map(e => ({ ...e, aliases: e.aliases || [] })));
      setEntityRelations(data.relations || []);
      addWire(`Entity graph built: ${data.entities?.length ?? 0} entities extracted`);
    } finally {
      setExtractingEntities(false);
    }
  }

  async function probeEntry(entryId: string) {
    if (!project) return;
    if (probeEntryId === entryId) { setProbeEntryId(null); setProbeConnected(new Set()); return; }
    try {
      const r = await fetch("/api/helix/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, entryId }),
      });
      if (!r.ok) return;
      const data = await r.json() as { connectedEntryIds: string[] };
      setProbeEntryId(entryId);
      setProbeConnected(new Set(data.connectedEntryIds || []));
    } catch { /**/ }
  }

  async function loadAgents(pId?: string) {
    const id = pId ?? project?.id;
    if (!id) return;
    try {
      const r = await fetch(`/api/helix/agents?projectId=${id}`);
      if (!r.ok) return;
      const data = await r.json() as { agents: AgentState[] };
      setAgents(data.agents || []);
    } catch { /**/ }
  }

  async function spawnAgent() {
    if (!project || !agentBuilderName.trim() || !agentBuilderPrompt.trim() || agentBuilderSaving) return;
    setAgentBuilderSaving(true);
    setAgentRunResult(null);
    try {
      const r = await fetch("/api/helix/agent/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          name: agentBuilderName,
          systemPrompt: agentBuilderPrompt,
          triggerType: agentBuilderTrigger,
          outputFormat: agentBuilderOutput,
          runNow: agentBuilderRunNow,
          runInput: agentBuilderInput,
        }),
      });
      if (r.ok) {
        const d = await r.json() as { result?: string };
        if (d.result) setAgentRunResult(d.result);
        setAgentBuilderName("");
        setAgentBuilderPrompt("");
        setAgentBuilderInput("");
        await loadAgents();
        addWire(`Custom agent "${agentBuilderName}" created`);
        void loadTokenUsage();
      }
    } finally {
      setAgentBuilderSaving(false);
    }
  }

  async function deleteCustomAgent(agentId: string) {
    try {
      await fetch(`/api/helix/custom-agents/${agentId}`, { method: "DELETE" });
      await loadAgents();
    } catch { /**/ }
  }

  async function loadTokenUsage(pId?: string) {
    const id = pId ?? project?.id;
    if (!id) return;
    try {
      const r = await fetch(`/api/helix/session-tokens?projectId=${id}`);
      if (!r.ok) return;
      setTokenUsage(await r.json() as TokenUsage);
    } catch { /**/ }
  }

  // ── Wave 11 — Layout & Widget functions ───────────────────────────────────

  function snapSplit(v: number): number {
    const snaps = [0.25, 0.33, 0.5, 0.67, 0.75];
    // Must initialise accumulator to first snap point, not v, so condition can ever be true
    const nearest = snaps.reduce((best, s) => Math.abs(s - v) < Math.abs(best - v) ? s : best, snaps[0]);
    return Math.abs(nearest - v) < 0.03 ? nearest : v;
  }

  function applyPreset(preset: string) {
    const presets: Record<string, number> = {
      balanced: 0.5, "research-heavy": 0.65, "strategy-heavy": 0.35,
      "brief-mode": 0.25, "battle-mode": 0.55,
    };
    const split = presets[preset] ?? 0.5;
    setPanelSplit(split);
    setLeftCollapsed(false);
    setRightCollapsed(false);
  }

  async function loadLayouts(pId?: string) {
    const id = pId ?? project?.id;
    if (!id) return;
    try {
      const r = await fetch(`/api/helix/layouts?projectId=${id}`);
      if (!r.ok) return;
      const d = await r.json() as { layouts: HelixLayout[] };
      setLayouts(d.layouts || []);
    } catch { /**/ }
  }

  async function saveLayout() {
    if (!project || !layoutSaveName.trim()) return;
    try {
      await fetch("/api/helix/layouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, name: layoutSaveName, config: { panelSplit, leftCollapsed, rightCollapsed } }),
      });
      setLayoutSaveName("");
      setLayoutSaveOpen(false);
      await loadLayouts();
    } catch { /**/ }
  }

  async function deleteLayout(layoutId: string) {
    try {
      await fetch(`/api/helix/layouts/${layoutId}`, { method: "DELETE" });
      await loadLayouts();
    } catch { /**/ }
  }

  function applyLayout(layout: HelixLayout) {
    const cfg = layout.config;
    if (!cfg) return;
    if (typeof cfg.panelSplit === "number") setPanelSplit(Math.max(0.15, Math.min(0.85, cfg.panelSplit)));
    if (typeof cfg.leftCollapsed === "boolean") setLeftCollapsed(cfg.leftCollapsed);
    if (typeof cfg.rightCollapsed === "boolean") setRightCollapsed(cfg.rightCollapsed);
  }

  function addWidget(type: WidgetType) {
    const WIDGET_DEFAULTS: Record<WidgetType, { title: string; width: number; height: number }> = {
      "score-meter":           { title: "Helix Score", width: 180, height: 140 },
      "contradiction-counter": { title: "Contradictions", width: 160, height: 100 },
      "agent-hud":             { title: "Active Agents", width: 220, height: 200 },
      "strand-radar":          { title: "Strand Radar", width: 200, height: 200 },
      "wire-feed":             { title: "The Wire", width: 280, height: 240 },
      "quick-notes":           { title: "Quick Notes", width: 240, height: 180 },
      "vault-preview":         { title: "Vault Preview", width: 260, height: 200 },
      "focus-timer":           { title: "Focus Timer", width: 160, height: 120 },
    };
    const def = WIDGET_DEFAULTS[type];
    const existing = widgets.filter(w => w.type === type).length;
    setWidgets(ws => [...ws, {
      id: `w-${Date.now()}`,
      type,
      x: 80 + existing * 24,
      y: 80 + existing * 24,
      width: def.width,
      height: def.height,
      minimized: false,
      pinned: false,
      opacity: 1,
      title: def.title,
    }]);
    setWidgetPickerOpen(false);
  }

  function removeWidget(id: string) { setWidgets(ws => ws.filter(w => w.id !== id)); }
  function updateWidget(id: string, patch: Partial<FloatingWidget>) { setWidgets(ws => ws.map(w => w.id === id ? { ...w, ...patch } : w)); }

  // ── Wave 12 — Signal Strand functions ─────────────────────────────────────

  async function loadSignals(pId?: string, liveOverride?: boolean) {
    const id = pId ?? project?.id;
    if (!id) return;
    const live = liveOverride !== undefined ? liveOverride : signalLiveOnly;
    try {
      const r = await fetch(`/api/helix/signals?projectId=${id}&liveOnly=${live}`);
      if (!r.ok) return;
      const d = await r.json() as { signals: HelixSignal[] };
      setSignals(d.signals || []);
    } catch { /**/ }
  }

  async function loadAlertRules(pId?: string) {
    const id = pId ?? project?.id;
    if (!id) return;
    try {
      const r = await fetch(`/api/helix/alert-rules?projectId=${id}`);
      if (!r.ok) return;
      const d = await r.json() as { rules: AlertRule[] };
      setAlertRules(d.rules || []);
    } catch { /**/ }
  }

  async function submitSignal() {
    if (!project || !signalForm.title.trim()) return;
    let parsedValue: unknown = null;
    if (signalForm.value.trim()) {
      try { parsedValue = JSON.parse(signalForm.value); } catch { parsedValue = signalForm.value; }
    }
    try {
      const r = await fetch("/api/helix/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, source: signalForm.source, signalType: signalForm.signal_type, title: signalForm.title, value: parsedValue, ttlSeconds: signalForm.ttl_seconds }),
      });
      if (!r.ok) return;
      const d = await r.json() as { signal: HelixSignal & { triggeredAlerts?: { id: string; name: string; message: string }[] } };
      if (d.signal.triggeredAlerts?.length) {
        for (const alert of d.signal.triggeredAlerts) addWire(`⚡ Alert: ${alert.name} — ${alert.message}`);
      }
      setSignalForm({ title: "", source: "manual", signal_type: "price", value: "", ttl_seconds: 3600 });
      setSignalFormOpen(false);
      await loadSignals();
    } catch { /**/ }
  }

  async function deleteSignal(id: string) {
    try {
      await fetch(`/api/helix/signals/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
      setSignals(ss => ss.filter(s => s.id !== id));
    } catch { /**/ }
  }

  async function signalToEvidence(sig: HelixSignal) {
    if (!project) return;
    try {
      await fetch("/api/helix/signal/to-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, signalId: sig.id }),
      });
      addWire(`Signal "${sig.title}" promoted to Evidence`);
      await loadSignals();
    } catch { /**/ }
  }

  async function submitAlertRule() {
    if (!project || !alertForm.name.trim()) return;
    try {
      await fetch("/api/helix/alert-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, ...alertForm }),
      });
      setAlertForm({ name: "", signal_type: "price", source: "kalshi", condition: "above", threshold: 0, message: "" });
      setAlertFormOpen(false);
      await loadAlertRules();
    } catch { /**/ }
  }

  async function deleteAlertRule(id: string) {
    try {
      await fetch(`/api/helix/alert-rules/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
      setAlertRules(rs => rs.filter(r => r.id !== id));
    } catch { /**/ }
  }

  // ── Wave 13 — Session, Journal & Capsule functions ────────────────────────

  async function openSession(pId: string) {
    // Close any existing session before opening a new one (prevents orphaned rows on capsule import)
    if (sessionRef.current) { await closeSession(); }
    try {
      const r = await fetch("/api/helix/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: pId, inquiryCount: 0 }),
      });
      if (!r.ok) return;
      const d = await r.json() as { id: string };
      sessionRef.current = d.id;
      setSessionId(d.id);
    } catch { /**/ }
  }

  async function closeSession() {
    const sid = sessionRef.current;
    if (!sid) return;
    try {
      const { inquiryCount, wireSnapshot } = sessionDataRef.current;
      await fetch(`/api/helix/sessions/${sid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inquiryCount,
          wireSnapshot,
        }),
      });
      sessionRef.current = null;
      setSessionId(null);
    } catch { /**/ }
  }

  async function generateSessionSummary(): Promise<string> {
    if (!project || entries.length === 0) return "";
    try {
      const r = await fetch("/api/helix/oracle?q=" + encodeURIComponent("Summarize this session in 2 sentences: what was researched and what was decided?") + "&projectId=" + project.id);
      if (!r.ok) return "";
      const d = await r.json() as { answer?: string };
      return (d.answer || "").slice(0, 500);
    } catch { return ""; }
  }

  async function loadSessions(pId?: string) {
    const id = pId ?? project?.id;
    if (!id) return;
    try {
      const r = await fetch(`/api/helix/sessions?projectId=${id}`);
      if (!r.ok) return;
      const d = await r.json() as { sessions: HelixSession[] };
      setSessions(d.sessions || []);
    } catch { /**/ }
  }

  async function loadCapsules(pId?: string) {
    const id = pId ?? project?.id;
    if (!id) return;
    try {
      const r = await fetch(`/api/helix/capsules?projectId=${id}`);
      if (!r.ok) return;
      const d = await r.json() as { capsules: HelixCapsule[] };
      setCapsules(d.capsules || []);
    } catch { /**/ }
  }

  async function exportCapsule() {
    if (!project || capsuleExporting) return;
    setCapsuleExporting(true);
    try {
      const label = `${project.name} — ${new Date().toLocaleDateString()}`;
      const r = await fetch("/api/helix/capsule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, label }),
      });
      if (!r.ok) { setCapsuleExporting(false); return; }
      const d = await r.json() as { id: string; entryCount: number; vaultCount: number };
      addWire(`Capsule exported: ${d.entryCount} entries, ${d.vaultCount} decisions`);
      await loadCapsules();
    } catch { /**/ }
    setCapsuleExporting(false);
  }

  async function importCapsule(capsuleId: string) {
    if (!project) return;
    try {
      const r = await fetch("/api/helix/capsule/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capsuleId, targetProjectId: project.id }),
      });
      if (!r.ok) return;
      const d = await r.json() as { imported: number; total: number };
      addWire(`Capsule imported: ${d.imported}/${d.total} entries restored`);
      await loadProject();
    } catch { /**/ }
  }

  async function deleteCapsule(id: string) {
    if (!project) return;
    try {
      await fetch(`/api/helix/capsule/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      setCapsules(cs => cs.filter(c => c.id !== id));
    } catch { /**/ }
  }

  async function exportToRoom(targetRoom: string) {
    if (!project) return;
    try {
      const r = await fetch("/api/helix/export/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, targetRoom }),
      });
      if (!r.ok) return;
      const d = await r.json() as { summary: string; entryCount: number; vaultCount: number };
      addWire(`Exported to ${targetRoom}: ${d.entryCount} entries + ${d.vaultCount} decisions`);
    } catch { /**/ }
  }

  async function loadBrief(): Promise<boolean> {
    if (!project) return false;
    if (briefLoading) return false;
    setBriefLoading(true);
    try {
      const r = await fetch(`/api/helix/living-brief?projectId=${project.id}`);
      if (!r.ok) { addWire("Brief unavailable"); return false; }
      const d = await r.json() as { brief: LivingBrief; changedSections: Record<string, boolean> };
      setBrief(d.brief);
      setChangedSections(d.changedSections ?? {});
      return true;
    } catch { addWire("Brief unavailable"); return false; }
    finally { setBriefLoading(false); }
  }

  async function openBrief() {
    if (!project) return;
    setBriefHasNew(false);
    setShowBrief(true);
    const success = await loadBrief();
    if (success) {
      fetch("/api/helix/living-brief/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id }) }).catch(() => {});
    }
  }

  async function submitOracle() {
    if (!project || oracleLoading || !oracleQuery.trim()) return;
    setOracleLoading(true);
    setOracleAnswer(null);
    addWire(`Oracle querying: "${oracleQuery.slice(0, 50)}…"`);
    try {
      const r = await fetch(`/api/helix/oracle?q=${encodeURIComponent(oracleQuery)}&projectId=${project.id}`);
      if (!r.ok) throw new Error("oracle failed");
      const d = await r.json() as { answer: OracleAnswer };
      setOracleAnswer(d.answer ?? null);
    } catch { addWire("Oracle query failed"); }
    finally { setOracleLoading(false); }
  }

  async function generateInsights() {
    if (!project || insightsGenerating) return;
    setInsightsGenerating(true);
    addWire("Insight Engine scanning patterns…");
    try {
      const r = await fetch("/api/helix/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!r.ok) throw new Error("server error");
      const d = await r.json() as { insights: Insight[] };
      setInsights(d.insights ?? []);
      addWire(`${d.insights?.length ?? 0} insight${d.insights?.length !== 1 ? "s" : ""} surfaced`);
    } catch { addWire("Insight generation failed"); }
    finally { setInsightsGenerating(false); }
  }

  async function dismissInsightItem(id: string) {
    const item = insights.find(i => i.id === id);
    setInsights(prev => prev.filter(i => i.id !== id));
    try {
      const r = await fetch(`/api/helix/insights/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("dismiss failed");
    } catch {
      if (item) {
        setInsights(cur => [...cur, item].sort((a, b) => b.confidence - a.confidence));
        addWire("Insight dismiss failed — restored");
      }
    }
  }

  async function developStrategy(entry: HelixEntry) {
    if (!project || developingIds.has(entry.id)) return;
    setDevelopingIds(prev => new Set([...prev, entry.id]));
    addWire(`Strategy Architect developing options for "${entry.query.slice(0, 50)}…"`);
    try {
      const r = await fetch("/api/helix/strategy/develop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, projectId: project.id }),
      });
      const d = await r.json() as { options: StrategyOptionsData; assumptions: Assumption[]; risks: Risk[] };
      if (d.options) setStrategyOptions(prev => ({ ...prev, [entry.id]: d.options }));
      if (d.assumptions?.length) setAssumptions(prev => [...prev.filter(a => a.entry_id !== entry.id), ...d.assumptions]);
      if (d.risks?.length) setRisks(prev => [...prev.filter(r => r.entry_id !== entry.id), ...d.risks]);
      addWire(`${d.options?.options?.length ?? 0} options · ${d.assumptions?.length ?? 0} assumptions · ${d.risks?.length ?? 0} risks mapped`);
    } catch { addWire("Strategy development failed"); }
    finally { setDevelopingIds(prev => { const s = new Set(prev); s.delete(entry.id); return s; }); setLastActionTs(Date.now()); }
  }

  async function challengeAssumption(assumption: Assumption) {
    if (!project || redTeamLoading) return;
    setRedTeamTargetText(assumption.text);
    setRedTeamEntry(null);
    setRedTeamSession(null);
    setRedTeamActive(true);
    setRedTeamLoading(true);
    addWire(`Challenging assumption: "${assumption.text.slice(0, 60)}…"`);
    try {
      const r = await fetch("/api/helix/assumption/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assumptionId: assumption.id, assumptionText: assumption.text, projectId: project.id }),
      });
      const d = await r.json() as { session: RedTeamSession };
      setRedTeamSession(d.session ?? null);
      setAssumptions(prev => prev.map(a => a.id === assumption.id ? { ...a, status: "challenged", challenge_session_id: d.session?.id ?? null } : a));
      addWire("Assumption challenged — verdict ready");
    } catch {
      addWire("Assumption challenge failed");
      setRedTeamActive(false);
    } finally { setRedTeamLoading(false); setLastActionTs(Date.now()); }
  }

  async function traceChain(entry: HelixEntry) {
    if (!project || tracingIds.has(entry.id)) return;
    setTracingIds(prev => new Set([...prev, entry.id]));
    setCausalChain(null);
    addWire(`Tracing causal chain from "${entry.query.slice(0, 45)}…"`);
    try {
      const r = await fetch("/api/helix/causal/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, projectId: project.id }),
      });
      const d = await r.json() as { chain: CausalChain };
      if (d.chain) { setCausalChain(d.chain); setCausalActive(true); }
    } catch { addWire("Causal trace failed"); }
    finally { setTracingIds(prev => { const s = new Set(prev); s.delete(entry.id); return s; }); setLastActionTs(Date.now()); }
  }

  async function forkScenario(entry: HelixEntry, scenarioType = "full") {
    if (!project || forkingIds.has(entry.id)) return;
    setForkingIds(prev => new Set([...prev, entry.id]));
    setScenarioEntry(entry);
    setScenarioActive(true);
    addWire(`Scenario Modeler forking "${entry.query.slice(0, 45)}…"`);
    try {
      const r = await fetch("/api/helix/scenario/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, projectId: project.id, scenarioType }),
      });
      if (!r.ok) { addWire("Scenario fork failed"); setScenarioActive(false); return; }
      const d = await r.json() as { scenario: Scenario };
      if (d.scenario) {
        setScenarios(prev => ({ ...prev, [entry.id]: d.scenario }));
        addWire(`${d.scenario.variants.length} scenarios forked — divergence: "${(d.scenario.divergence_point ?? "").slice(0, 50)}"`);
      } else {
        addWire("Scenario fork returned no data"); setScenarioActive(false);
      }
    } catch { addWire("Scenario fork failed"); setScenarioActive(false); }
    finally { setForkingIds(prev => { const s = new Set(prev); s.delete(entry.id); return s; }); setLastActionTs(Date.now()); }
  }

  async function scanPriorArt(entry: HelixEntry) {
    if (!project || scanningIds.has(entry.id)) return;
    setScanningIds(prev => new Set([...prev, entry.id]));
    addWire(`Prior Art Scanner analyzing "${entry.query.slice(0, 45)}…"`);
    try {
      const r = await fetch("/api/helix/prior-art/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, projectId: project.id }),
      });
      const d = await r.json() as { priorArt: PriorArt };
      if (d.priorArt) {
        setPriorArt(prev => ({ ...prev, [entry.id]: d.priorArt }));
        addWire(`Prior art: ${d.priorArt.exists.items?.length ?? 0} exist · ${d.priorArt.failures.items?.length ?? 0} failures · ${d.priorArt.gaps.items?.length ?? 0} gaps`);
      }
    } catch { addWire("Prior art scan failed"); }
    finally { setScanningIds(prev => { const s = new Set(prev); s.delete(entry.id); return s; }); setLastActionTs(Date.now()); }
  }

  async function launchRedTeam(entry: HelixEntry) {
    if (!project || redTeamLoading) return;
    setRedTeamEntry(entry);
    setRedTeamTargetText(null);
    setRedTeamSession(null);
    setRedTeamActive(true);
    setRedTeamLoading(true);
    addWire(`Red Team launched — 5 agents analyzing "${entry.query.slice(0, 50)}…"`);
    try {
      const r = await fetch("/api/helix/redteam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, projectId: project.id }),
      });
      const d = await r.json() as { session: RedTeamSession };
      setRedTeamSession(d.session ?? null);
      addWire("Red Team complete — verdict ready");
    } catch {
      addWire("Red Team failed — backend error");
      setRedTeamActive(false);
    } finally {
      setRedTeamLoading(false);
      setLastActionTs(Date.now());
    }
  }

  async function triangulate(entry: HelixEntry) {
    if (!project || triangulatingIds.has(entry.id)) return;
    setTriangulatingIds(prev => new Set([...prev, entry.id]));
    addWire(`Triangulating "${entry.query.slice(0, 50)}…"`);
    try {
      const r = await fetch("/api/helix/triangulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, projectId: project.id }),
      });
      const d = await r.json() as { triangulation: Triangulation };
      if (d.triangulation) {
        setTriangulations(prev => ({ ...prev, [entry.id]: d.triangulation }));
        const t = d.triangulation;
        addWire(`Triangulation done — agree:${t.agree} contested:${t.contested} oppose:${t.oppose}`);
      }
    } catch {
      addWire("Triangulation failed");
    } finally {
      setTriangulatingIds(prev => { const s = new Set(prev); s.delete(entry.id); return s; });
      setLastActionTs(Date.now());
    }
  }

  async function resolveContradiction(id: string) {
    if (!project) return;
    try {
      const r = await fetch("/api/helix/contradiction/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, projectId: project.id, resolution_type: "acknowledged", resolution_text: "Manually resolved" }),
      });
      const d = await r.json() as { score?: number; openCount: number };
      if (d.score !== undefined) setProject(p => p ? { ...p, helix_score: d.score! } : p);
      setOpenContradictionCount(d.openCount ?? 0);
      setContradictions(prev => prev.map(c => c.id === id ? { ...c, status: "resolved" } : c));
      addWire("Contradiction resolved");
    } catch { addWire("Resolve failed"); }
  }

  function addWire(msg: string, type?: string) {
    setWireItems(prev => [{ text: msg, t: Date.now(), type }, ...prev.slice(0, 19)]);
    sessionDataRef.current.wireSnapshot = [msg, ...sessionDataRef.current.wireSnapshot].slice(0, 50);
  }

  // ── Folder helpers ──────────────────────────────────────────────────────────
  async function createFolder(name: string) {
    if (!project || !name.trim()) return;
    const r = await fetch("/api/helix/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, name: name.trim(), color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length], icon: "◈" }),
    });
    if (r.ok) { const d = await r.json() as { folder: HelixFolder }; setFolders(prev => [...prev, d.folder]); }
  }

  async function renameFolder(id: string, name: string) {
    const folder = folders.find(f => f.id === id);
    if (!folder || !name.trim()) return;
    const r = await fetch(`/api/helix/folders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), color: folder.color, icon: folder.icon }),
    });
    if (r.ok) { const d = await r.json() as { folder: HelixFolder }; setFolders(prev => prev.map(f => f.id === id ? d.folder : f)); }
  }

  async function deleteFolder(id: string) {
    await fetch(`/api/helix/folders/${id}`, { method: "DELETE" });
    setFolders(prev => prev.filter(f => f.id !== id));
    setEntries(prev => prev.map(e => e.folder_id === id ? { ...e, folder_id: null } : e));
    if (activeFolderId === id) setActiveFolderId(null);
  }

  async function moveEntryToFolder(entryId: string, folderId: string | null) {
    await fetch(`/api/helix/entry/${entryId}/folder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, folder_id: folderId } : e));
  }

  function addToast(t: { type: string; msg: string; sub?: string; icon: string }) {
    const id = `toast-${Date.now()}`;
    setToasts(prev => [...prev, { id, ...t }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 4000);
  }

  // ── Submit inquiry ─────────────────────────────────────────────────────────
  async function submit() {
    const text = inputRef.current?.value.trim() ?? "";
    if (!text || processing || !project) return;
    if (inputRef.current) inputRef.current.value = "";
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    setPreviewChips([]);

    const lower = text.toLowerCase();
    if (/^(back|exit|return|go back|jarvis|leave)$/.test(lower)) { onExit(); return; }
    if (/^vault$/.test(lower)) { setShowVault(v => !v); return; }

    setProcessing(true);
    setSessionInquiryCount(n => n + 1);
    sessionDataRef.current.inquiryCount++;
    addWire(`Inquiry routed — classifying strand…`);

    try {
      const res = await fetch("/api/helix/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, projectId: project.id, jarvisContext, folderId: activeFolderId }),
      });
      const data = await res.json() as { entry: HelixEntry; health: StrandHealth; score: number; strand: Strand; openContradictionCount?: number };
      if (data.entry) {
        setEntries(prev => [...prev, data.entry]);
        if (data.health) setHealth(data.health);
        if (data.score !== undefined) setProject(p => p ? { ...p, helix_score: data.score } : p);
        if (data.openContradictionCount !== undefined) setOpenContradictionCount(data.openContradictionCount);
        setStrand(data.strand);
        setBriefHasNew(true);
        setLastAnalysis({ strand: data.strand, confidence: data.entry.confidence });
        addWire(`${STRAND_META[data.strand].label} entry added — confidence ${data.entry.confidence.toFixed(2)}`, "analysis");
        addToast({ type: "analysis", msg: `${STRAND_META[data.strand].label} analysis complete`, sub: `Confidence ${data.entry.confidence.toFixed(2)}`, icon: "◈" });
        setLeftPanelFlash(true); setTimeout(() => setLeftPanelFlash(false), 6100);
        // Refresh contradictions after detection completes async on server (~2s)
        if (project) setTimeout(() => void loadContradictions(project.id), 3000);
        if (data.strand === "strategy" || data.strand === "construction" || data.strand === "synthesis") {
          setRightTab(data.strand === "synthesis" ? "Synthesis" : "Strategy");
          setTimeout(() => rightRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth" }), 100);
        } else {
          setLeftTab("Evidence");
          setTimeout(() => leftRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth" }), 100);
        }
      }
    } catch {
      addWire("Error — backend unreachable");
    } finally {
      setProcessing(false);
      setLastActionTs(Date.now());
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }

  // ── Add entry from Jarvis response ────────────────────────────────────────
  async function addEntryFromJarvis(text: string) {
    if (!text.trim() || !project) return;
    try {
      const res = await fetch("/api/helix/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 1200), projectId: project.id, jarvisContext }),
      });
      const data = await res.json() as { entry: HelixEntry; health: StrandHealth; score: number; strand: Strand; openContradictionCount?: number };
      if (data.entry) {
        setEntries(prev => [...prev, data.entry]);
        if (data.health) setHealth(data.health);
        if (data.score !== undefined) setProject(p => p ? { ...p, helix_score: data.score } : p);
        if (data.openContradictionCount !== undefined) setOpenContradictionCount(data.openContradictionCount);
        setStrand(data.strand);
        setBriefHasNew(true);
        setLeftPanelFlash(true); setTimeout(() => setLeftPanelFlash(false), 6100);
        addToast({ type: "analysis", msg: `Jarvis → ${STRAND_META[data.strand].label}`, sub: `Confidence ${data.entry.confidence.toFixed(2)}`, icon: "⊕" });
      }
    } catch {
      addToast({ type: "error", msg: "Failed to add Jarvis response to evidence", icon: "✕" });
    }
  }

  // ── Lock to vault ──────────────────────────────────────────────────────────
  async function lockEntry(entry: HelixEntry) {
    if (!project || entry.locked) return;
    try {
      const res = await fetch("/api/helix/vault/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, projectId: project.id }),
      });
      const data = await res.json() as { vaultEntry: VaultEntry; score: number };
      if (data.vaultEntry) {
        setVault(prev => [data.vaultEntry, ...prev]);
        setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, locked: 1 } : e));
        if (data.score !== undefined) setProject(p => p ? { ...p, helix_score: data.score } : p);
        addWire(`Locked to Vault — "${entry.query.slice(0, 50)}"`, "lock");
        addToast({ type: "vault", msg: "Entry locked to Vault", sub: entry.query.slice(0, 55), icon: "⊕" });
      }
    } catch { addWire("Lock failed"); }
  }

  // ── Tab type override — optimistic state update after PATCH ────────────────
  function handleTabTypeChanged(entryId: string, newPrimary: string) {
    setEntries(prev => prev.map(e =>
      e.id === entryId ? { ...e, tab_primary: newPrimary as HelixEntry["tab_primary"] } : e
    ));
  }

  // ── Wave 2-D: Synthesis offer chip ─────────────────────────────────────────
  // Compute tab types with ≥ 3 non-voided, non-synthesis entries
  const synthesisCandidates = (() => {
    const counts: Record<string, string[]> = {};
    entries.forEach(e => {
      if (e.voided || !e.tab_primary || e.tab_primary === "research" || (e.tab_primary as string).startsWith("synthesis-")) return;
      if (!counts[e.tab_primary]) counts[e.tab_primary] = [];
      counts[e.tab_primary].push(e.id);
    });
    return Object.entries(counts).filter(([, ids]) => ids.length >= 3);
  })();

  async function runSynthesis(tabType: string, entryIds: string[]) {
    if (!project) return;
    try {
      addWire(`Synthesizing ${entryIds.length} ${tabType} entries…`);
      const r = await fetch("/api/helix/synthesize-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, tabType, entryIds }),
      });
      if (!r.ok) throw new Error("Synthesis failed");
      const { entry } = await r.json();
      if (entry) {
        setEntries(prev => [entry, ...prev]);
        addWire(`Synthesis entry created for ${tabType}`);
      }
    } catch { addWire("Synthesis failed"); }
  }

  // ── Void entry ─────────────────────────────────────────────────────────────
  async function voidEntry(entry: HelixEntry) {
    try {
      await fetch(`/api/helix/entries/${entry.id}`, { method: "DELETE" });
      setEntries(prev => prev.filter(e => e.id !== entry.id));
      setVoidItems(prev => [entry, ...prev]);
      addWire(`Sent to Void — "${entry.query.slice(0, 40)}"`, "void");
    } catch { addWire("Void failed"); }
  }

  // ── Objective ──────────────────────────────────────────────────────────────
  async function saveObjective() {
    if (!project) return;
    setEditObj(false);
    try {
      const r = await fetch(`/api/helix/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: project.name, objective: objDraft }),
      });
      const d = await r.json() as { project: HelixProject };
      if (d.project) setProject(d.project);
    } catch { /**/ }
  }

  // ── Keyboard global ────────────────────────────────────────────────────────
  // entriesRef keeps the listener stable — no re-register on every entry change
  entriesRef.current = entries;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const tag = (e.target as HTMLElement).tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA";
      if (ctrl && e.key === "v") { e.preventDefault(); setShowVault(x => !x); return; }
      if (ctrl && e.key === "h") { e.preventDefault(); setHeatMap(x => !x); return; }
      if (ctrl && e.key === "b") { e.preventDefault(); void openBrief(); return; }
      if (ctrl && e.key === "o") { e.preventDefault(); setOracleActive(true); return; }
      if (ctrl && e.key === "k") { e.preventDefault(); setCmdPaletteOpen(x => !x); return; }
      if (ctrl && e.key === "j") { e.preventDefault(); setShowJarvis(x => !x); return; }
      if (!inInput && e.key === "?") { e.preventDefault(); setShowShortcuts(x => !x); return; }
      if (!inInput && e.key === "D") { e.preventDefault(); setDensity(d => d === "comfortable" ? "compact" : d === "compact" ? "spacious" : "comfortable"); return; }
      if (ctrl && e.key === "f") { e.preventDefault(); if (forgeOpen) setForgeOpen(false); else void openForge(); return; }
      if (ctrl && e.key === "w" && e.shiftKey) { e.preventDefault(); setWidgetPickerOpen(x => !x); return; }
      if (ctrl && e.key === "w" && !e.shiftKey) { e.preventDefault(); setWfOpen(x => !x); return; }
      if (ctrl && e.key === "a") { e.preventDefault(); setAgentConstOpen(x => !x); return; }
      if (ctrl && e.key === "d") { e.preventDefault(); setDockMode(x => !x); return; }
      if (!inInput && ctrl && e.key === "p" && focusedCardRef.current) { e.preventDefault(); void probeEntry(focusedCardRef.current); return; }
      if (!inInput && !redTeamActive && !causalActive && !scenarioActive && !showBrief && !oracleActive && focusedCardRef.current) {
        const id = focusedCardRef.current;
        const entry = entriesRef.current.find(en => en.id === id);
        if (e.key === "r" && entry) { e.preventDefault(); void launchRedTeam(entry); return; }
        if (e.key === "t" && entry) { e.preventDefault(); void triangulate(entry); return; }
        if (e.key === "d" && entry?.strand === "strategy") { e.preventDefault(); void developStrategy(entry); return; }
        if (e.key === "c" && entry) { e.preventDefault(); void traceChain(entry); return; }
        if (e.key === "s" && entry) { e.preventDefault(); void forkScenario(entry); return; }
        if (e.key === "p" && entry) { e.preventDefault(); void scanPriorArt(entry); return; }
      }
      if (e.key === "Escape") {
        if (cmdPaletteOpen) { setCmdPaletteOpen(false); return; }
        if (showJarvis) { setShowJarvis(false); return; }
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (spotlightId) { setSpotlightId(null); return; }
        if (widgetPickerOpen) { setWidgetPickerOpen(false); return; }
        if (layoutSaveOpen) { setLayoutSaveOpen(false); return; }
        if (patternsOpen) { setPatternsOpen(false); return; }
        if (oracleActive) { setOracleActive(false); return; }
        if (showBrief) { setShowBrief(false); return; }
        if (scenarioActive) { setScenarioActive(false); return; }
        if (causalActive) { setCausalActive(false); return; }
        if (redTeamActive) { setRedTeamActive(false); return; }
        if (forgeOpen) { setForgeOpen(false); return; }
        if (wfOpen) { setWfOpen(false); return; }
        if (agentConstOpen) { setAgentConstOpen(false); return; }
        if (probeEntryId) { setProbeEntryId(null); setProbeConnected(new Set()); return; }
        if (showVault) { setShowVault(false); return; }
        onExit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showVault, showJarvis, onExit, redTeamActive, causalActive, scenarioActive, showBrief, oracleActive, patternsOpen, forgeOpen, wfOpen, agentConstOpen, probeEntryId, widgetPickerOpen, layoutSaveOpen, cmdPaletteOpen, showShortcuts, spotlightId]);

  useEffect(() => {
    return () => { if (dropPollRef.current) clearInterval(dropPollRef.current); };
  }, []);

  // UI-4: GSAP stagger card reveals when entries change
  useEffect(() => {
    const el = leftRef.current;
    if (!el) return;
    const cards = el.querySelectorAll<HTMLElement>(".helix-entry-card:not([data-staggered])");
    if (cards.length === 0) return;
    cards.forEach(c => c.setAttribute("data-staggered", "1"));
    gsap.fromTo(cards,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.25, stagger: 0.04, ease: "power2.out", delay: 0.05 }
    );
  }, [entries]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const leftEntries  = entries
    .filter(e => !["strategy", "construction", "synthesis"].includes(e.strand))
    .filter(e => !activeFolderId || e.folder_id === activeFolderId);
  const rightEntries = entries
    .filter(e => ["strategy", "construction", "synthesis"].includes(e.strand))
    .filter(e => !activeFolderId || e.folder_id === activeFolderId);
  const visibleAssumptions = useMemo(
    () => assumptions.filter(a => rightEntries.some(e => e.id === a.entry_id)),
    [assumptions, rightEntries]
  );
  const strandCounts = ALL_STRANDS.reduce((acc, s) => ({ ...acc, [s]: entries.filter(e => e.strand === s).length }), {} as Record<Strand, number>);

  const scoreColor = (project?.helix_score ?? 0) >= 70 ? "#4aff9e" : (project?.helix_score ?? 0) >= 40 ? "#ffe14a" : "#ff6b6b";

  // Client-side contradicted set — stays in sync when async detection updates contradictions state
  const contradictedIds = useMemo(() => {
    const s = new Set<string>();
    contradictions.filter(c => c.status === "open").forEach(c => { s.add(c.entry_a_id); s.add(c.entry_b_id); });
    return s;
  }, [contradictions]);

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (phase === "boot") {
    const pct = Math.round(loadProgress * 100);
    return (
      <div className="helix-boot">
        <canvas ref={starCanvasRef} className="helix-boot-stars" />
        <div className="helix-boot-init">
          <div className="helix-boot-wordmark">HELIX</div>
          <div className="helix-boot-tagline">Intelligence Chamber</div>
          <div className="helix-boot-bar-wrap">
            <div className="helix-boot-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="helix-boot-pct">{pct < 100 ? `${pct}%` : "Launching…"}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="helix-shell"
      onDragOver={e => { e.preventDefault(); setDropActive(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false); }}
      onDrop={e => {
        e.preventDefault();
        setDropActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void ingestFile(file);
      }}
    >
      {/* UI-3: Three.js ambient particle background */}
      <HelixScene />

      {dropActive && (
        <div className="helix-drop-overlay">
          <div className="helix-drop-prompt">
            <span className="helix-drop-icon">⬇</span>
            <span className="helix-drop-label">Drop to ingest into Knowledge Reservoir</span>
          </div>
        </div>
      )}
      <div className={`helix-room${visible ? " helix-room--visible" : ""}${heatMap ? " helix-heatmap-active" : ""}`}>

        {/* ── Topbar ──────────────────────────────────────────────────────── */}
        <HelixTopbar
          onExit={onExit}
          project={project}
          scoreColor={scoreColor}
          activeStrand={activeStrand}
          strandCounts={strandCounts}
          setStrand={setStrand}
          heatMap={heatMap}
          setHeatMap={setHeatMap}
          oracleActive={oracleActive}
          setOracleActive={setOracleActive}
          showBrief={showBrief}
          briefHasNew={briefHasNew}
          openBrief={() => void openBrief()}
          forgeOpen={forgeOpen}
          setForgeOpen={setForgeOpen}
          openForge={() => void openForge()}
          forgeDocs={forgeDocs}
          wfOpen={wfOpen}
          setWfOpen={setWfOpen}
          wfWorkflows={wfWorkflows}
          agentConstOpen={agentConstOpen}
          setAgentConstOpen={setAgentConstOpen}
          agents={agents}
          showJarvis={showJarvis}
          setShowJarvis={setShowJarvis}
          tokenUsage={tokenUsage}
          probeEntryId={probeEntryId}
          setProbeEntryId={setProbeEntryId}
          probeConnected={probeConnected}
          setProbeConnected={setProbeConnected}
          showVault={showVault}
          setShowVault={setShowVault}
          vault={vault}
          layouts={layouts}
          applyLayout={applyLayout}
          applyPreset={applyPreset}
          setLayoutSaveOpen={setLayoutSaveOpen}
          widgetPickerOpen={widgetPickerOpen}
          setWidgetPickerOpen={setWidgetPickerOpen}
          widgets={widgets}
          topbarCollapsed={topbarCollapsed}
          setTopbarCollapsed={setTopbarCollapsed}
          dockMode={dockMode}
          setDockMode={setDockMode}
        />

        {/* ── Ambient Intelligence Strip ───────────────────────────────── */}
        <HelixAmbientStrip
          entries={entries}
          triangulations={triangulations}
          priorArt={priorArt}
          strategyOptions={strategyOptions}
          risks={risks}
          briefedEntryIds={briefedEntryIds}
          lastActionTs={lastActionTs}
          processing={processing}
          onOpenPatterns={() => setPatternsOpen(true)}
        />

        {/* ── Main ────────────────────────────────────────────────────────── */}
        <div className="helix-main" ref={mainRef}>

          {/* Left panel */}
          <section className={`helix-panel helix-panel--left${leftCollapsed ? " helix-panel--collapsed" : ""}`}
            style={leftCollapsed ? { flex: "none", width: 44, minWidth: 44 } : { flex: panelSplit }}>
            <div className="helix-panel-tabs">
              {!leftCollapsed && LEFT_TABS.map(t => (
                <button key={t} className={`helix-panel-tab${leftTab === t ? " active" : ""}`} onClick={() => setLeftTab(t)}>{t}</button>
              ))}
              <button className="helix-panel-collapse-btn" title={leftCollapsed ? "Expand panel" : "Collapse panel"} onClick={() => setLeftCollapsed(x => !x)}>
                {leftCollapsed ? "▷" : "◁"}
              </button>
            </div>
            {leftCollapsed && (
              <div className="helix-panel-icon-strip">
                {LEFT_TABS.map(t => (
                  <button key={t} className={`helix-panel-icon-tab${leftTab === t ? " active" : ""}`} title={t} onClick={() => { setLeftTab(t); setLeftCollapsed(false); }}>{t[0]}</button>
                ))}
              </div>
            )}
            {!leftCollapsed && (
            <>
            {/* ── Folder bar ─────────────────────────────────────────────────── */}
            {folders.length > 0 && (
              <div className="helix-folder-bar">
                <button
                  className={`helix-folder-chip${activeFolderId === null ? " active" : ""}`}
                  onClick={() => setActiveFolderId(null)}
                  title="Show all entries"
                >
                  <span className="helix-folder-chip-icon">⊞</span>
                  <span className="helix-folder-chip-name">All</span>
                  <span className="helix-folder-chip-count">{entries.length}</span>
                </button>
                {folders.map(f => {
                  const count = entries.filter(e => e.folder_id === f.id).length;
                  return renamingFolderId === f.id ? (
                    <form key={f.id} className="helix-folder-rename" onSubmit={e => { e.preventDefault(); void renameFolder(f.id, renameDraft); setRenamingFolderId(null); }}>
                      <input
                        className="helix-folder-rename-input"
                        autoFocus
                        value={renameDraft}
                        onChange={e => setRenameDraft(e.target.value)}
                        onBlur={() => { void renameFolder(f.id, renameDraft); setRenamingFolderId(null); }}
                        onKeyDown={e => { if (e.key === "Escape") setRenamingFolderId(null); }}
                        style={{ "--fc": f.color } as React.CSSProperties}
                      />
                    </form>
                  ) : (
                    <button
                      key={f.id}
                      className={`helix-folder-chip${activeFolderId === f.id ? " active" : ""}`}
                      style={{ "--fc": f.color } as React.CSSProperties}
                      onClick={() => setActiveFolderId(id => id === f.id ? null : f.id)}
                      onDoubleClick={() => { setRenamingFolderId(f.id); setRenameDraft(f.name); }}
                      title={`${f.name} (${count} entries) — double-click to rename`}
                    >
                      <span className="helix-folder-chip-icon">{f.icon}</span>
                      <span className="helix-folder-chip-name">{f.name}</span>
                      <span className="helix-folder-chip-count">{count}</span>
                    </button>
                  );
                })}
                {/* New folder */}
                {showFolderCreate ? (
                  <form className="helix-folder-create-form" onSubmit={e => { e.preventDefault(); void createFolder(newFolderName); setNewFolderName(""); setShowFolderCreate(false); }}>
                    <input
                      className="helix-folder-create-input"
                      autoFocus
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      placeholder="Folder name…"
                      onBlur={() => { if (!newFolderName.trim()) setShowFolderCreate(false); }}
                      onKeyDown={e => { if (e.key === "Escape") { setShowFolderCreate(false); setNewFolderName(""); } }}
                    />
                  </form>
                ) : (
                  <button className="helix-folder-add" onClick={() => setShowFolderCreate(true)} title="New folder">+</button>
                )}
              </div>
            )}
            <div className="helix-panel-header">
              <span className="helix-ph-stat">{leftEntries.length} entries</span>
              {leftEntries.length > 0 && <span className="helix-ph-stat">· avg {(leftEntries.reduce((a, e) => a + e.confidence, 0) / leftEntries.length).toFixed(2)}</span>}
              {openContradictionCount > 0 && <span className="helix-ph-contra">⚡ {openContradictionCount}</span>}
              <input className="helix-ph-search" placeholder="Filter…" value={leftPanelSearch} onChange={e => setLeftPanelSearch(e.target.value)} />
              <select className="helix-ph-sort" value={leftPanelSort} onChange={e => setLeftPanelSort(e.target.value as typeof leftPanelSort)}>
                <option value="recent">Recent</option>
                <option value="confidence">Confidence</option>
                <option value="freshness">Freshness</option>
              </select>
            </div>
            {/* Wave 2-D: Synthesis offer chips */}
            {synthesisCandidates.length > 0 && (
              <div className="helix-synth-chips">
                {synthesisCandidates.map(([tabType, ids]) => {
                  const tm = TAB_TYPE_META[tabType as keyof typeof TAB_TYPE_META] ?? { icon: "◆", label: tabType, color: "#94a3b8" };
                  return (
                    <button
                      key={tabType}
                      className="helix-synth-chip"
                      style={{ "--synth-color": tm.color } as React.CSSProperties}
                      onClick={() => runSynthesis(tabType, ids)}
                      title={`Synthesize ${ids.length} ${tm.label} entries into a meta-entry`}
                    >
                      {tm.icon} {ids.length} {tm.label} — synthesize?
                    </button>
                  );
                })}
              </div>
            )}
            <div className={`helix-panel-body density-${density}${leftPanelFlash ? " helix-panel--flash" : ""}${spotlightId ? " spotlight-active" : ""}`} ref={leftRef}>
              {leftTab === "Evidence" && (
                <>
                  {processing && (
                    <div className="helix-analyzing-card">
                      <span className="helix-analyzing-label">ANALYZING</span>
                      <span className="helix-analyzing-stage">{["Routing strand…", "Building context…", "Cross-referencing…", "Synthesizing…"][Math.floor(Date.now() / 800) % 4]}</span>
                      <div className="helix-analyzing-dots"><span /><span /><span /></div>
                    </div>
                  )}
                  {leftEntries.length === 0 && !processing && (
                    <div className="helix-empty"><span>Ask a research question to populate evidence</span></div>
                  )}
                  {leftEntries
                    .filter(e => !leftPanelSearch || e.query.toLowerCase().includes(leftPanelSearch.toLowerCase()) || e.text.toLowerCase().includes(leftPanelSearch.toLowerCase()))
                    .sort((a, b) => leftPanelSort === "confidence" ? b.confidence - a.confidence : leftPanelSort === "freshness" ? (getFreshness(b.created_at, b.strand) - getFreshness(a.created_at, a.strand)) : 0)
                    .map(entry => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      allEntries={entries}
                      assumptions={assumptions.filter(a => a.entry_id === entry.id)}
                      risks={risks.filter(r => r.entry_id === entry.id)}
                      strategyOptions={strategyOptions[entry.id] ?? null}
                      priorArt={priorArt[entry.id] ?? null}
                      triangulation={triangulations[entry.id]}
                      triangulating={triangulatingIds.has(entry.id)}
                      tracing={tracingIds.has(entry.id)}
                      forking={forkingIds.has(entry.id)}
                      scanning={scanningIds.has(entry.id)}
                      onLock={() => lockEntry(entry)}
                      onVoid={() => voidEntry(entry)}
                      onRedTeam={() => void launchRedTeam(entry)}
                      onTriangulate={() => void triangulate(entry)}
                      onTrace={() => void traceChain(entry)}
                      onFork={() => void forkScenario(entry)}
                      onScan={() => void scanPriorArt(entry)}
                      onProbe={() => void probeEntry(entry.id)}
                      onDeepBrief={() => setBriefEntry(entry)}
                      onChallenge={(a) => void challengeAssumption(a)}
                      formatTime={formatTime}
                      isContradicted={contradictedIds.has(entry.id)}
                      isProbeSource={probeEntryId === entry.id}
                      isProbeLinked={probeConnected.has(entry.id)}
                      onFocus={() => { focusedCardRef.current = entry.id; }}
                      onTabTypeChanged={handleTabTypeChanged}
                      projectId={project?.id}
                      folders={folders}
                      onMoveToFolder={moveEntryToFolder}
                      hasBrief={briefedEntryIds.has(entry.id)}
                    />
                  ))}
                </>
              )}
              {leftTab === "Contradiction" && (
                <ContradictionArena
                  contradictions={contradictions}
                  entries={entries}
                  onResolve={(id) => void resolveContradiction(id)}
                  formatTime={formatTime}
                />
              )}
              {leftTab === "Knowledge" && (
                <KnowledgeReservoir
                  files={knowledgeFiles}
                  fileClaims={fileClaims}
                  expandedFileId={expandedFileId}
                  ingesting={ingestingFile}
                  onExpand={async (fileId) => {
                    if (expandedFileId === fileId) { setExpandedFileId(null); return; }
                    setExpandedFileId(fileId);
                    if (!fileClaims[fileId]) await loadFileClaims(fileId);
                  }}
                  onDelete={deleteKnowledgeFile}
                  onDropFile={(file) => void ingestFile(file)}
                />
              )}
              {leftTab === "Graph" && (
                <EvidenceLatticeGraph
                  entries={entries}
                  contradictions={contradictions}
                  heatMap={heatMap}
                  onNodeClick={(entry) => {
                    setSpotlightId(entry.id);
                    setLeftTab("Evidence");
                  }}
                />
              )}
            </div>
            </>
            )}
          </section>
          {/* Left → Core resize handle */}
          {!leftCollapsed && !rightCollapsed && (
            <div className="helix-resize-handle helix-resize-handle--left"
              onMouseDown={e => { e.preventDefault(); resizeDrag.current = { startX: e.clientX, startSplit: panelSplit, side: 'left' }; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; document.body.classList.add("helix-panel-resizing"); }} />
          )}

          {/* Helix Core */}
          <section className="helix-core">
            <HelixPulseOrb health={health} processing={processing} />
            <div className="helix-core-threads">
              {entries.length} thread{entries.length !== 1 ? "s" : ""} active
            </div>

            <div className="helix-score-block">
              <div className="helix-score-num" style={{ color: scoreColor }}>{project?.helix_score ?? 0}</div>
              <div className="helix-score-label">Helix Score</div>
              <div
                className={`helix-contradiction-count${openContradictionCount > 0 ? " helix-contradiction-count--active" : ""}`}
                onClick={() => setLeftTab("Contradiction")}
                title="Click to open Contradiction Arena"
              >
                {openContradictionCount > 0 ? `⚠ ${openContradictionCount} conflict${openContradictionCount > 1 ? "s" : ""}` : "✓ clean"}
              </div>
            </div>

            <div className="helix-objective">
              <span className="helix-obj-label">Objective</span>
              {editObjective ? (
                <div className="helix-obj-edit">
                  <input autoFocus value={objDraft} onChange={e => setObjDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void saveObjective(); if (e.key === "Escape") setEditObj(false); }} placeholder="Define the north star…" />
                  <button onClick={() => void saveObjective()}>Set</button>
                </div>
              ) : (
                <button className="helix-obj-text" onClick={() => { setObjDraft(project?.objective ?? ""); setEditObj(true); }}>
                  {project?.objective || "Click to set objective"}
                </button>
              )}
            </div>

            <div className="helix-strand-bars">
              {ALL_STRANDS.map(s => (
                <div key={s} className="helix-bar-row">
                  <span className="helix-bar-label" style={{ color: STRAND_META[s].color }}>{STRAND_META[s].label.slice(0, 3).toUpperCase()}</span>
                  <div className="helix-bar-track">
                    <div className="helix-bar-fill" style={{ width: `${health[s] * 100}%`, backgroundColor: STRAND_META[s].color }} />
                  </div>
                  <span className="helix-bar-count">{strandCounts[s]}</span>
                </div>
              ))}
            </div>

            <div className="helix-core-stats">
              <div className="helix-stat"><strong>{entries.length}</strong><span>inquiries</span></div>
              <div className="helix-stat"><strong>{vault.length}</strong><span>locked</span></div>
              <div className="helix-stat"><strong>{entries.length > 0 ? Math.round(entries.reduce((a, e) => a + e.confidence, 0) / entries.length * 100) : 0}%</strong><span>avg conf</span></div>
            </div>
          </section>

          {/* Right panel */}
          {/* Core → Right resize handle */}
          {!leftCollapsed && !rightCollapsed && (
            <div className="helix-resize-handle helix-resize-handle--right"
              onMouseDown={e => { e.preventDefault(); resizeDrag.current = { startX: e.clientX, startSplit: panelSplit, side: 'right' }; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; document.body.classList.add("helix-panel-resizing"); }} />
          )}

          <section className={`helix-panel helix-panel--right${rightCollapsed ? " helix-panel--collapsed" : ""}`}
            style={rightCollapsed ? { flex: "none", width: 44, minWidth: 44 } : { flex: 1 - panelSplit }}>
            <div className="helix-panel-tabs">
              {!rightCollapsed && RIGHT_TABS.map(t => (
                <button key={t} className={`helix-panel-tab${rightTab === t ? " active" : ""}`} onClick={() => setRightTab(t)}>{t}</button>
              ))}
              <button className="helix-panel-collapse-btn" title={rightCollapsed ? "Expand panel" : "Collapse panel"} onClick={() => setRightCollapsed(x => !x)}>
                {rightCollapsed ? "◁" : "▷"}
              </button>
            </div>
            {rightCollapsed && (
              <div className="helix-panel-icon-strip">
                {RIGHT_TABS.map(t => (
                  <button key={t} className={`helix-panel-icon-tab${rightTab === t ? " active" : ""}`} title={t} onClick={() => { setRightTab(t); setRightCollapsed(false); }}>{t[0]}</button>
                ))}
              </div>
            )}
            {!rightCollapsed && (
            <>
            <div className="helix-panel-header">
              <span className="helix-ph-stat">{rightEntries.length} entries</span>
              {rightEntries.length > 0 && <span className="helix-ph-stat">· avg {(rightEntries.reduce((a, e) => a + e.confidence, 0) / rightEntries.length).toFixed(2)}</span>}
              <input className="helix-ph-search" placeholder="Filter…" value={rightPanelSearch} onChange={e => setRightPanelSearch(e.target.value)} />
              <select className="helix-ph-sort" value={rightPanelSort} onChange={e => setRightPanelSort(e.target.value as typeof rightPanelSort)}>
                <option value="recent">Recent</option>
                <option value="confidence">Confidence</option>
                <option value="freshness">Freshness</option>
              </select>
            </div>
            <div className={`helix-panel-body density-${density}${rightPanelFlash ? " helix-panel--flash" : ""}`} ref={rightRef}>
              {rightTab === "Strategy" && (
                <>
                  {rightEntries.length === 0 && (
                    <div className="helix-empty-state">
                      <div className="helix-empty-state-icon">◈</div>
                      <div className="helix-empty-state-title">No strategy entries yet</div>
                      <div className="helix-empty-state-hint">
                        Ask a strategy question in the inquiry bar (set strand to Strategy), or click an evidence entry below to develop options from it.
                      </div>
                      {entries.length > 0 && (
                        <>
                          <div className="helix-empty-state-hint" style={{ marginTop: 4, opacity: 0.5 }}>Click an entry → Develop Options</div>
                          <div className="helix-empty-state-entries">
                            {entries.slice(0, 10).map(e => (
                              <div key={e.id} className="helix-empty-entry-row" onClick={() => { setStrand("strategy"); setTimeout(() => void developStrategy(e), 50); }}>
                                <div className="helix-empty-entry-row-dot" style={{ background: STRAND_META[e.strand].color }} />
                                <span className="helix-empty-entry-row-text">{e.query.slice(0, 80)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      <button className="helix-empty-cta-btn" onClick={() => setStrand("strategy")}>
                        Switch to Strategy Strand →
                      </button>
                    </div>
                  )}
                  {rightEntries.map(entry => (
                    <div key={entry.id} className="helix-strategy-wrapper">
                      <EntryCard entry={entry} onLock={() => lockEntry(entry)} onVoid={() => voidEntry(entry)} onRedTeam={() => void launchRedTeam(entry)} onTriangulate={() => void triangulate(entry)} onDevelop={entry.strand === "strategy" ? () => void developStrategy(entry) : undefined} onTrace={() => void traceChain(entry)} onFork={() => void forkScenario(entry)} onScan={() => void scanPriorArt(entry)} onProbe={() => void probeEntry(entry.id)} onDeepBrief={() => setBriefEntry(entry)} developing={developingIds.has(entry.id)} tracing={tracingIds.has(entry.id)} forking={forkingIds.has(entry.id)} scanning={scanningIds.has(entry.id)} triangulation={triangulations[entry.id]} triangulating={triangulatingIds.has(entry.id)} formatTime={formatTime} isContradicted={contradictedIds.has(entry.id)} isProbeSource={probeEntryId === entry.id} isProbeLinked={probeConnected.has(entry.id)} onFocus={() => { focusedCardRef.current = entry.id; }} onTabTypeChanged={handleTabTypeChanged} projectId={project?.id} folders={folders} onMoveToFolder={moveEntryToFolder} hasBrief={briefedEntryIds.has(entry.id)} />
                      {strategyOptions[entry.id] && <StrategyOptionsTree options={strategyOptions[entry.id]} />}
                      {priorArt[entry.id] && <PriorArtCard priorArt={priorArt[entry.id]} />}
                    </div>
                  ))}
                  {visibleAssumptions.length > 0 && (
                    <AssumptionBoard assumptions={visibleAssumptions} onChallenge={(a) => void challengeAssumption(a)} />
                  )}
                </>
              )}
              {rightTab === "Risks" && (
                risks.length === 0 ? (
                  <div className="helix-empty-state">
                    <div className="helix-empty-state-icon">⚠</div>
                    <div className="helix-empty-state-title">No risks mapped yet</div>
                    <div className="helix-empty-state-hint">
                      Risks are extracted automatically when you develop strategy options. Go to the Strategy tab and click any entry to develop options — risks will appear here.
                    </div>
                    <button className="helix-empty-cta-btn" onClick={() => setRightTab("Strategy" as RightTab)}>
                      Go to Strategy →
                    </button>
                  </div>
                ) : <RiskGallery risks={risks} />
              )}
              {rightTab === "Scenarios" && (
                <div className="helix-scenarios-panel">
                  {Object.values(scenarios).length === 0 ? (
                    <div className="helix-empty-state">
                      <div className="helix-empty-state-icon">⎇</div>
                      <div className="helix-empty-state-title">No scenarios forked yet</div>
                      <div className="helix-empty-state-hint">Click any entry below to fork a scenario — explore alternate outcomes from that evidence.</div>
                      {entries.length > 0 && (
                        <div className="helix-empty-state-entries">
                          {entries.slice(0, 10).map(e => (
                            <div key={e.id} className="helix-empty-entry-row" onClick={() => void forkScenario(e)}>
                              <div className="helix-empty-entry-row-dot" style={{ background: STRAND_META[e.strand].color }} />
                              <span className="helix-empty-entry-row-text">{e.query.slice(0, 80)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="helix-scenarios-header">
                        <span className="helix-scenarios-title">Scenario Forge</span>
                        <span className="helix-scenarios-sub">{Object.values(scenarios).length} scenario{Object.values(scenarios).length !== 1 ? "s" : ""} · S = fork · P = prior art</span>
                      </div>
                      {Object.values(scenarios).map(s => {
                        const entryForS = entries.find(e => e.id === s.entry_id);
                        return (
                          <div key={s.id} className="helix-scenario-list-card" onClick={() => { if (entryForS) setScenarioEntry(entryForS); setScenarioActive(true); }}>
                            <div className="helix-scenario-list-head">
                              <span className="helix-scenario-list-name">{s.name}</span>
                              <span className="helix-scenario-list-count">{s.variants.length} variants</span>
                            </div>
                            <p className="helix-scenario-list-entry">{entryForS?.query ?? s.entry_id.slice(0, 40)}</p>
                            {s.divergence_point && <p className="helix-scenario-list-div">⎇ {s.divergence_point.slice(0, 90)}</p>}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
              {rightTab === "Experiments" && (
                <div className="helix-experiments">
                  <div className="helix-exp-header">
                    <span className="helix-exp-title">Red Team Arena</span>
                    <span className="helix-exp-sub">Hover a card and press R to red-team it. T to triangulate.</span>
                  </div>
                  {redTeamSession && (
                    <button className="helix-exp-session-btn" onClick={() => setRedTeamActive(true)}>
                      View last red team — {redTeamSession.critiques.length} agents · {entries.find(e => e.id === redTeamSession.entry_id)?.query?.slice(0, 50) ?? redTeamSession.entry_id.slice(0, 8)}
                    </button>
                  )}
                  {!redTeamSession && (
                    <div className="helix-empty-state">
                      <div className="helix-empty-state-icon">⚔</div>
                      <div className="helix-empty-state-title">No red team sessions yet</div>
                      <div className="helix-empty-state-hint">Click any entry to launch a red team — adversarial agents will challenge and stress-test it.</div>
                      {entries.length > 0 && (
                        <div className="helix-empty-state-entries">
                          {entries.slice(0, 10).map(e => (
                            <div key={e.id} className="helix-empty-entry-row" onClick={() => void launchRedTeam(e)}>
                              <div className="helix-empty-entry-row-dot" style={{ background: STRAND_META[e.strand].color }} />
                              <span className="helix-empty-entry-row-text">{e.query.slice(0, 80)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {rightTab === "Synthesis"   && (
                <div className="helix-insight-feed">
                  <div className="helix-insight-feed-header">
                    <span className="helix-insight-feed-title">Insight Engine</span>
                    <button
                      className={`helix-insight-generate-btn${insightsGenerating ? " loading" : ""}`}
                      onClick={() => void generateInsights()}
                      disabled={insightsGenerating}
                    >
                      {insightsGenerating ? <span className="helix-spinner" /> : "⚡ Scan"}
                    </button>
                  </div>
                  {insights.length === 0 && !insightsGenerating && (
                    <div className="helix-empty"><span>Press ⚡ Scan to surface patterns, gaps, and cross-strand implications</span></div>
                  )}
                  {insights.map(ins => (
                    <InsightCard key={ins.id} insight={ins} onDismiss={() => void dismissInsightItem(ins.id)} />
                  ))}
                  {brief && Object.keys(brief.sections).length > 0 && (
                    <div className="helix-brief-preview">
                      <div className="helix-brief-preview-head">
                        <span>Living Brief</span>
                        <button className="helix-brief-preview-open" onClick={() => void openBrief()}>Open Full ↗</button>
                      </div>
                      {["current_state", "whats_next"].map(key => brief.sections[key] ? (
                        <div key={key} className={`helix-brief-preview-section${changedSections[key] ? " changed" : ""}`}>
                          <span className="helix-brief-preview-label">{BRIEF_SECTION_LABELS[key] ?? key}</span>
                          <p>{brief.sections[key]}</p>
                        </div>
                      ) : null)}
                    </div>
                  )}
                </div>
              )}
              {rightTab === "Workflows" && (
                <div className="helix-wf-tab">
                  <div className="helix-wf-tab-header">
                    <span className="helix-wf-tab-title">⚡ Workflow Studio</span>
                    <button className="helix-wf-tab-open" onClick={() => setWfOpen(true)}>Open Studio ⌘W</button>
                  </div>
                  <div className="helix-wf-list">
                    {wfWorkflows.length === 0 && <div className="helix-empty"><span>No workflows — open Studio to create</span></div>}
                    {wfWorkflows.map(wf => (
                      <div key={wf.id} className={`helix-wf-list-item${wf.is_builtin ? " builtin" : ""}`} onClick={() => { openWfWorkflow(wf); setWfOpen(true); }}>
                        <div className="helix-wf-list-name">{wf.name}</div>
                        <div className="helix-wf-list-desc">{wf.description?.slice(0, 80)}</div>
                        <div className="helix-wf-list-meta">{wf.is_builtin ? "Built-in" : "Custom"} · {(() => { try { return JSON.parse(wf.graph_json || "{}").nodes?.length ?? 0; } catch { return 0; } })()} nodes</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {rightTab === "Relations" && (
                <RelationGraphPanel
                  entities={entities}
                  relations={entityRelations}
                  extracting={extractingEntities}
                  onExtract={() => void extractEntities()}
                  entryCount={entries.length}
                />
              )}

              {rightTab === "Agents" && (
                <AgentBuilderPanel
                  agents={agents}
                  name={agentBuilderName}
                  prompt={agentBuilderPrompt}
                  trigger={agentBuilderTrigger}
                  output={agentBuilderOutput}
                  runNow={agentBuilderRunNow}
                  input={agentBuilderInput}
                  saving={agentBuilderSaving}
                  runResult={agentRunResult}
                  onChangeName={setAgentBuilderName}
                  onChangePrompt={setAgentBuilderPrompt}
                  onChangeTrigger={setAgentBuilderTrigger}
                  onChangeOutput={setAgentBuilderOutput}
                  onChangeRunNow={setAgentBuilderRunNow}
                  onChangeInput={setAgentBuilderInput}
                  onSpawn={() => void spawnAgent()}
                  onDelete={deleteCustomAgent}
                  onOpenConstellation={() => setAgentConstOpen(true)}
                />
              )}

              {/* ── Wave 12: Signal Strand ──────────────────────────────────── */}
              {rightTab === "Signals" && (
                <div className="hs-panel">
                  {/* Header toolbar */}
                  <div className="hs-toolbar">
                    <span className="hs-toolbar-title">Signal Feed</span>
                    <button
                      className={`hs-toggle-btn${signalLiveOnly ? " active" : ""}`}
                      onClick={() => { const next = !signalLiveOnly; setSignalLiveOnly(next); void loadSignals(undefined, next); }}
                    >
                      {signalLiveOnly ? "Live" : "All"}
                    </button>
                    <button className="hs-add-btn" onClick={() => setSignalFormOpen(v => !v)}>+ Signal</button>
                    <button className="hs-refresh-btn" onClick={() => void loadSignals()}>↻</button>
                  </div>

                  {/* Manual signal ingestion form */}
                  {signalFormOpen && (
                    <div className="hs-form">
                      <div className="hs-form-title">New Signal</div>
                      <input className="hs-input" placeholder="Title…" value={signalForm.title}
                        onChange={e => setSignalForm(f => ({ ...f, title: e.target.value }))} />
                      <div className="hs-form-row">
                        <select className="hs-select" value={signalForm.source}
                          onChange={e => setSignalForm(f => ({ ...f, source: e.target.value }))}>
                          <option value="manual">manual</option>
                          <option value="kalshi">kalshi</option>
                          <option value="polymarket">polymarket</option>
                          <option value="news">news</option>
                        </select>
                        <select className="hs-select" value={signalForm.signal_type}
                          onChange={e => setSignalForm(f => ({ ...f, signal_type: e.target.value }))}>
                          <option value="price">price</option>
                          <option value="volume">volume</option>
                          <option value="sentiment">sentiment</option>
                          <option value="event">event</option>
                          <option value="correlation">correlation</option>
                        </select>
                      </div>
                      <input className="hs-input" placeholder="Value (JSON or text)…" value={signalForm.value}
                        onChange={e => setSignalForm(f => ({ ...f, value: e.target.value }))} />
                      <div className="hs-form-row">
                        <label className="hs-label">TTL (s)</label>
                        <input className="hs-input hs-input-sm" type="number" min={60} max={86400}
                          value={signalForm.ttl_seconds}
                          onChange={e => setSignalForm(f => ({ ...f, ttl_seconds: parseInt(e.target.value) || 3600 }))} />
                      </div>
                      <div className="hs-form-actions">
                        <button className="hs-confirm-btn" onClick={() => void submitSignal()}
                          disabled={!signalForm.title.trim()}>Ingest</button>
                        <button className="hs-cancel-btn" onClick={() => setSignalFormOpen(false)}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Signal cards */}
                  <div className="hs-feed">
                    {signals.length === 0 && (
                      <div className="hs-empty">No signals. Ingest one manually or connect a data source.</div>
                    )}
                    {signals.map(sig => {
                      const now = Date.now();
                      const expires = new Date(sig.expires_at).getTime();
                      const created = new Date(sig.created_at).getTime();
                      const total = expires - created;
                      const remaining = Math.max(0, expires - now);
                      const pct = total > 0 ? Math.round((remaining / total) * 100) : 0;
                      const isExpired = sig.expired || remaining === 0;
                      return (
                        <div key={sig.id} className={`hs-card${isExpired ? " hs-card--expired" : ""}`}>
                          <div className="hs-card-header">
                            <span className="hs-card-type">{sig.signal_type}</span>
                            <span className="hs-card-source">{sig.source}</span>
                            <div className="hs-card-actions">
                              {!isExpired && (
                                <button className="hs-card-btn" title="Promote to Evidence"
                                  onClick={() => void signalToEvidence(sig)}>→E</button>
                              )}
                              <button className="hs-card-btn hs-card-del" onClick={() => void deleteSignal(sig.id)}>✕</button>
                            </div>
                          </div>
                          <div className="hs-card-title">{sig.title}</div>
                          {sig.value !== null && sig.value !== undefined && (
                            <div className="hs-card-value">
                              {typeof sig.value === "object" ? JSON.stringify(sig.value) : String(sig.value)}
                            </div>
                          )}
                          <div className="hs-ttl-bar">
                            <div className="hs-ttl-fill" style={{ width: `${pct}%`, background: pct > 50 ? "#4aff9e" : pct > 20 ? "#ffe14a" : "#ff6b6b" }} />
                          </div>
                          <div className="hs-card-meta">
                            {isExpired ? "Expired" : `${Math.ceil(remaining / 1000)}s remaining`}
                            {sig.linked_evidence_id && <span className="hs-card-linked"> · Linked to evidence</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Alert Rules section */}
                  <div className="hs-section-divider" />
                  <div className="hs-toolbar">
                    <span className="hs-toolbar-title">Alert Rules</span>
                    <button className="hs-add-btn" onClick={() => setAlertFormOpen(v => !v)}>+ Rule</button>
                  </div>

                  {alertFormOpen && (
                    <div className="hs-form">
                      <div className="hs-form-title">New Alert Rule</div>
                      <input className="hs-input" placeholder="Rule name…" value={alertForm.name}
                        onChange={e => setAlertForm(f => ({ ...f, name: e.target.value }))} />
                      <div className="hs-form-row">
                        <select className="hs-select" value={alertForm.source}
                          onChange={e => setAlertForm(f => ({ ...f, source: e.target.value }))}>
                          <option value="kalshi">kalshi</option>
                          <option value="polymarket">polymarket</option>
                          <option value="manual">manual</option>
                          <option value="news">news</option>
                        </select>
                        <select className="hs-select" value={alertForm.signal_type}
                          onChange={e => setAlertForm(f => ({ ...f, signal_type: e.target.value }))}>
                          <option value="price">price</option>
                          <option value="volume">volume</option>
                          <option value="sentiment">sentiment</option>
                          <option value="event">event</option>
                        </select>
                      </div>
                      <div className="hs-form-row">
                        <select className="hs-select" value={alertForm.condition}
                          onChange={e => setAlertForm(f => ({ ...f, condition: e.target.value as AlertRule["condition"] }))}>
                          <option value="above">above</option>
                          <option value="below">below</option>
                          <option value="equals">equals</option>
                        </select>
                        <input className="hs-input hs-input-sm" type="number" step="any" placeholder="Threshold"
                          value={alertForm.threshold}
                          onChange={e => setAlertForm(f => ({ ...f, threshold: parseFloat(e.target.value) || 0 }))} />
                      </div>
                      <input className="hs-input" placeholder="Alert message…" value={alertForm.message}
                        onChange={e => setAlertForm(f => ({ ...f, message: e.target.value }))} />
                      <div className="hs-form-actions">
                        <button className="hs-confirm-btn" onClick={() => void submitAlertRule()}
                          disabled={!alertForm.name.trim()}>Create</button>
                        <button className="hs-cancel-btn" onClick={() => setAlertFormOpen(false)}>Cancel</button>
                      </div>
                    </div>
                  )}

                  <div className="hs-rules-list">
                    {alertRules.length === 0 && (
                      <div className="hs-empty">No alert rules. Rules fire when ingested signals match.</div>
                    )}
                    {alertRules.map(rule => (
                      <div key={rule.id} className={`hs-rule${rule.active ? "" : " hs-rule--inactive"}`}>
                        <div className="hs-rule-header">
                          <span className="hs-rule-name">{rule.name}</span>
                          <button className="hs-card-btn hs-card-del" onClick={() => void deleteAlertRule(rule.id)}>✕</button>
                        </div>
                        <div className="hs-rule-desc">
                          {rule.source} · {rule.signal_type} {rule.condition} {rule.threshold}
                        </div>
                        {rule.message && <div className="hs-rule-msg">{rule.message}</div>}
                        {rule.last_triggered_at && (
                          <div className="hs-rule-triggered">
                            Last fired: {new Date(rule.last_triggered_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Wave 13: Journal & Capsules ─────────────────────────────── */}
              {rightTab === "Journal" && (
                <div className="hj-panel">
                  {/* Multi-room export bridge */}
                  <div className="hj-section">
                    <div className="hj-section-title">Export Bridge</div>
                    <div className="hj-export-row">
                      <button className="hj-export-btn" onClick={() => void exportToRoom("forge")}>→ Forge</button>
                      <button className="hj-export-btn" onClick={() => void exportToRoom("abyss")}>→ Abyss</button>
                      <button className="hj-export-btn" onClick={() => void exportToRoom("athenaeum")}>→ Athenaeum</button>
                    </div>
                  </div>

                  {/* Capsule section */}
                  <div className="hj-section-divider" />
                  <div className="hj-section">
                    <div className="hj-section-header">
                      <span className="hj-section-title">Capsules</span>
                      <button
                        className={`hj-action-btn${capsuleExporting ? " loading" : ""}`}
                        onClick={() => void exportCapsule()}
                        disabled={capsuleExporting}
                      >
                        {capsuleExporting ? "Exporting…" : "⊙ Export"}
                      </button>
                    </div>
                    {capsules.length === 0 && (
                      <div className="hj-empty">No capsules. Export one to compress the full project state.</div>
                    )}
                    {capsules.map(cap => (
                      <div key={cap.id} className="hj-capsule">
                        <div className="hj-capsule-header">
                          <span className="hj-capsule-label">{cap.label}</span>
                          <div className="hj-capsule-actions">
                            <button className="hj-mini-btn" title="Import into current project"
                              onClick={() => void importCapsule(cap.id)}>↓ Import</button>
                            <button className="hj-mini-btn hj-mini-del" onClick={() => void deleteCapsule(cap.id)}>✕</button>
                          </div>
                        </div>
                        <div className="hj-capsule-meta">
                          {cap.entry_count} entries · {cap.vault_count} decisions · {new Date(cap.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Session Journal */}
                  <div className="hj-section-divider" />
                  <div className="hj-section">
                    <div className="hj-section-header">
                      <span className="hj-section-title">Session Journal</span>
                      <button className="hj-action-btn" onClick={() => void loadSessions()}>↻</button>
                    </div>
                    {sessionId && (
                      <div className="hj-active-session">
                        <span className="hj-active-dot" /> Active — {sessionInquiryCount} {sessionInquiryCount === 1 ? "inquiry" : "inquiries"} this session
                      </div>
                    )}
                    {sessions.length === 0 && (
                      <div className="hj-empty">No past sessions yet. Sessions are saved automatically when you leave.</div>
                    )}
                    {sessions.map(sess => (
                      <div
                        key={sess.id}
                        className={`hj-session${journalReplayId === sess.id ? " active" : ""}`}
                        onClick={() => setJournalReplayId(v => v === sess.id ? null : sess.id)}
                      >
                        <div className="hj-session-header">
                          <span className="hj-session-date">{new Date(sess.started_at).toLocaleDateString()}</span>
                          <span className="hj-session-stats">{sess.inquiry_count}q · {sess.decisions_locked}d</span>
                        </div>
                        {sess.summary && <div className="hj-session-summary">{sess.summary}</div>}
                        {journalReplayId === sess.id && sess.wire_snapshot.length > 0 && (
                          <div className="hj-session-replay">
                            <div className="hj-replay-title">Session Wire</div>
                            {sess.wire_snapshot.map((msg, i) => (
                              <div key={i} className="hj-replay-item">{msg}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
            </>
            )}
          </section>
        </div>

        {/* ── UI-5: Dock Mode Overlay (dockview-react) ─────────────────────── */}
        {dockMode && (
          <HelixDockLayout
            leftContent={
              <div style={{ padding: 8, height: "100%", overflow: "auto" }}>
                <div className="helix-panel-tabs" style={{ marginBottom: 8 }}>
                  {LEFT_TABS.map(t => (
                    <button key={t} className={`helix-panel-tab${leftTab === t ? " active" : ""}`} onClick={() => setLeftTab(t)}>{t}</button>
                  ))}
                </div>
                <div className={`helix-panel-body density-${density}`} ref={leftRef}>
                  {leftTab === "Evidence" && leftEntries.map(e => (
                    <div key={e.id} className="helix-mini-entry" style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-subtle)", fontSize: 12 }}>
                      <span style={{ color: STRAND_META[e.strand].color, marginRight: 6 }}>◈</span>
                      {e.query.slice(0, 80)}{e.query.length > 80 ? "…" : ""}
                    </div>
                  ))}
                  {leftTab === "Contradiction" && <ContradictionArena contradictions={contradictions} entries={entries} onResolve={(id) => void resolveContradiction(id)} formatTime={formatTime} />}
                  {leftTab === "Knowledge" && <KnowledgeReservoir files={knowledgeFiles} fileClaims={fileClaims} expandedFileId={expandedFileId} ingesting={ingestingFile} onExpand={async (fid) => { setExpandedFileId(fid); if (!fileClaims[fid]) await loadFileClaims(fid); }} onDelete={deleteKnowledgeFile} onDropFile={(file) => void ingestFile(file)} />}
                  {leftTab === "Graph" && <EvidenceLatticeGraph entries={entries} contradictions={contradictions} heatMap={heatMap} onNodeClick={(entry) => { setSpotlightId(entry.id); setLeftTab("Evidence"); }} />}
                </div>
              </div>
            }
            coreContent={
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 16, gap: 12, height: "100%", justifyContent: "center" }}>
                <HelixPulseOrb health={health} processing={processing} />
                <div className="helix-core-threads">{entries.length} thread{entries.length !== 1 ? "s" : ""} active</div>
                <div className="helix-score-num" style={{ color: scoreColor, fontSize: 32, fontFamily: "Orbitron, sans-serif" }}>{project?.helix_score ?? 0}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Helix Score</div>
              </div>
            }
            rightContent={
              <div style={{ padding: 8, height: "100%", overflow: "auto" }}>
                <div className="helix-panel-tabs" style={{ marginBottom: 8 }}>
                  {RIGHT_TABS.map(t => (
                    <button key={t} className={`helix-panel-tab${rightTab === t ? " active" : ""}`} onClick={() => setRightTab(t)}>{t}</button>
                  ))}
                </div>
                <div className={`helix-panel-body density-${density}`}>
                  {rightTab === "Strategy" && rightEntries.map(e => (
                    <div key={e.id} className="helix-mini-entry" style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-subtle)", fontSize: 12 }}>
                      <span style={{ color: STRAND_META[e.strand].color, marginRight: 6 }}>◈</span>
                      {e.query.slice(0, 80)}{e.query.length > 80 ? "…" : ""}
                    </div>
                  ))}
                  {rightTab === "Risks" && <RiskGallery risks={risks} />}
                  {rightTab === "Scenarios" && rightEntries.filter(e => scenarios[e.id]).map(e => (
                    <div key={e.id} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-subtle)", fontSize: 12 }}>{e.query.slice(0, 80)}</div>
                  ))}
                </div>
              </div>
            }
          />
        )}

        {/* ── Toast Notifications ──────────────────────────────────────────── */}
        <div className="helix-toasts">
          {toasts.map(t => (
            <div key={t.id} className={`helix-toast helix-toast--${t.type}`}>
              <span className="helix-toast-icon">{t.icon}</span>
              <div className="helix-toast-body">
                <div className="helix-toast-msg">{t.msg}</div>
                {t.sub && <div className="helix-toast-sub">{t.sub}</div>}
              </div>
              <button className="helix-toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>✕</button>
            </div>
          ))}
        </div>

        {/* ── Shortcuts Modal ──────────────────────────────────────────────── */}
        {showShortcuts && (
          <div className="helix-shortcuts-overlay" onClick={() => setShowShortcuts(false)}>
            <div className="helix-shortcuts-modal" onClick={e => e.stopPropagation()}>
              <div className="helix-shortcuts-head">
                <span>KEYBOARD SHORTCUTS</span>
                <button className="helix-shortcuts-close" onClick={() => setShowShortcuts(false)}>✕</button>
              </div>
              <div className="helix-shortcuts-grid">
                {([
                  ["⌘K", "Command palette"],
                  ["⌘J", "Jarvis chat panel"],
                  ["?", "This shortcut guide"],
                  ["⌘V", "Toggle vault"],
                  ["⌘H", "Heatmap overlay"],
                  ["⌘B", "Living brief"],
                  ["⌘O", "Oracle query"],
                  ["⌘F", "The Forge"],
                  ["⌘W", "Workflow studio"],
                  ["⌘A", "Agent constellation"],
                  ["D", "Cycle density mode"],
                  ["R (card)", "Red team"],
                  ["T (card)", "Triangulate"],
                  ["D (strategy)", "Develop options"],
                  ["C (card)", "Trace causal chain"],
                  ["S (card)", "Fork scenario"],
                  ["P (card)", "Prior art scan"],
                  ["⌘P (card)", "Probe connections"],
                  ["Esc", "Close / Back"],
                ] as [string, string][]).map(([kbd, desc]) => (
                  <div key={kbd} className="helix-shortcut-row">
                    <kbd>{kbd}</kbd><span>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Command Palette (cmdk) ───────────────────────────────────────── */}
        <HelixCommandPalette
          open={cmdPaletteOpen}
          onClose={() => setCmdPaletteOpen(false)}
          onAction={(action) => {
            if (action === "vault") setShowVault(true);
            else if (action === "brief") void openBrief();
            else if (action === "oracle") setOracleActive(true);
            else if (action === "forge") void openForge();
            else if (action === "workflow") setWfOpen(true);
            else if (action === "agents") setAgentConstOpen(true);
            else if (action === "jarvis") setShowJarvis(true);
            else if (action === "heatmap") setHeatMap(x => !x);
            else if (action === "shortcuts") setShowShortcuts(true);
            else if (action === "knowledge") setLeftTab("Knowledge");
            else if (action === "density-compact") setDensity("compact");
            else if (action === "density-comfortable") setDensity("comfortable");
            else if (action === "density-spacious") setDensity("spacious");
          }}
        />

        {/* ── UI-2: Jarvis Panel ──────────────────────────────────────────── */}
        <AnimatePresence>
          {showJarvis && (
            <JarvisPanel
              key="jarvis-panel"
              onClose={() => setShowJarvis(false)}
              helixContext={{
                projectName: project?.name ?? "Unknown",
                entryCount: entries.length,
                contradictionCount: openContradictionCount,
                activeStrand,
                recentEntries: [...entries].reverse().slice(0, 6).map(e => ({
                  query: e.query,
                  strand: e.strand,
                  confidence: e.confidence,
                })),
              }}
              onAddToEvidence={addEntryFromJarvis}
            />
          )}
        </AnimatePresence>

        {/* ── Wave 11: Layout save dialog ──────────────────────────────── */}
        {layoutSaveOpen && (
          <div className="helix-layout-save-dialog" onClick={() => setLayoutSaveOpen(false)}>
            <div className="helix-layout-save-panel" onClick={e => e.stopPropagation()}>
              <div className="helix-layout-save-title">Save Layout</div>
              <input className="helix-layout-save-input" autoFocus placeholder="Layout name…"
                value={layoutSaveName} onChange={e => setLayoutSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void saveLayout(); if (e.key === "Escape") setLayoutSaveOpen(false); }} />
              <div className="helix-layout-save-actions">
                <button className="helix-layout-save-confirm" onClick={() => void saveLayout()} disabled={!layoutSaveName.trim()}>Save</button>
                <button className="helix-layout-save-cancel" onClick={() => setLayoutSaveOpen(false)}>Cancel</button>
              </div>
              {layouts.length > 0 && (
                <div className="helix-layout-saved-list">
                  <div className="helix-layout-saved-title">Saved Layouts</div>
                  {layouts.map(l => (
                    <div key={l.id} className="helix-layout-saved-row">
                      <span className="helix-layout-saved-name" onClick={() => { applyLayout(l); setLayoutSaveOpen(false); }}>{l.name}</span>
                      <button className="helix-layout-saved-del" onClick={() => void deleteLayout(l.id)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Wave 11: Widget Picker ────────────────────────────────────── */}
        {widgetPickerOpen && (
          <WidgetPickerOverlay onAdd={addWidget} onClose={() => setWidgetPickerOpen(false)} activeCount={widgets.length} />
        )}

        {/* ── Wave 11: Widget Layer (@dnd-kit) ─────────────────────────── */}
        <DndContext
          sensors={dndSensors}
          modifiers={[restrictToWindowEdges]}
          onDragEnd={({ active, delta }) => {
            const w = widgets.find(ww => ww.id === active.id);
            if (w) updateWidget(w.id, {
              x: Math.max(0, Math.min(window.innerWidth - 120, w.x + delta.x)),
              y: Math.max(0, Math.min(window.innerHeight - 32, w.y + delta.y)),
            });
          }}
        >
          {widgets.map(w => (
            <WidgetWindow
              key={w.id}
              widget={w}
              onClose={() => removeWidget(w.id)}
              onUpdate={patch => updateWidget(w.id, patch)}
              onResizeStart={(sx, sy) => { widgetResize.current = { id: w.id, sx, sy, sw: w.width, sh: w.height }; }}
            >
              <WidgetContent widget={w} project={project} entries={entries} vault={vault} wireItems={wireItems} health={health} openContradictionCount={openContradictionCount} agents={agents} />
            </WidgetWindow>
          ))}
        </DndContext>

        {/* ── Bottom strip ────────────────────────────────────────────────── */}
        <div className="helix-bottom-strip">
          <div className="helix-void-strip">
            <span>Void</span>
            {voidItems.length > 0 && <span className="helix-void-count">{voidItems.length}</span>}
          </div>
          <div className="helix-bench-strip"><span>Bench</span></div>
        </div>

        {/* ── Wire ────────────────────────────────────────────────────────── */}
        <div className={`helix-wire${wireOpen ? " helix-wire--open" : ""}`}>
          <div className="helix-wire-head" onClick={() => setWireOpen(x => !x)}>
            <span className="helix-wire-label">THE WIRE</span>
            <div className={`helix-wire-live-dot${processing ? "" : " idle"}`} />
            <div className="helix-wire-ticker">{wireItems[0]?.text}</div>
            <span className="helix-wire-toggle">{wireOpen ? "▾" : "▸"}</span>
          </div>
          {wireOpen && (
            <div className="helix-wire-events">
              {wireItems.slice(0, 15).map(item => (
                <div key={item.t} className="helix-wire-event">
                  <span className="helix-wire-event-icon">{wireTypeIcon(item.type)}</span>
                  <span className="helix-wire-event-text">{item.text}</span>
                  <span className="helix-wire-event-ts">{formatWireTime(item.t)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Next Actions ───────────────────────────────────────────────── */}
        {lastAnalysis && (
          <div className="helix-next-actions">
            <span className="helix-next-label">NEXT</span>
            <button className="helix-next-btn" onClick={() => { void launchRedTeam(entries[entries.length - 1]); setLastAnalysis(null); }}>Red team</button>
            <button className="helix-next-btn" onClick={() => { void triangulate(entries[entries.length - 1]); setLastAnalysis(null); }}>Triangulate</button>
            <button className="helix-next-btn" onClick={() => { void openBrief(); setLastAnalysis(null); }}>Brief</button>
            <button className="helix-next-btn" onClick={() => { setRightTab("Risks"); setLastAnalysis(null); }}>View risks</button>
            <button className="helix-next-dismiss" onClick={() => setLastAnalysis(null)}>✕</button>
          </div>
        )}
        {/* ── Inquiry Well ────────────────────────────────────────────────── */}
        <div className="helix-inquiry-well">
          {previewChips.length > 0 && (
            <div className="helix-preview-chips">
              {previewChips.map(chip => (
                <span
                  key={chip.type}
                  className="helix-preview-chip"
                  style={{ "--chip-color": TAB_TYPE_META[chip.type].color } as React.CSSProperties}
                >
                  {TAB_TYPE_META[chip.type].icon} {TAB_TYPE_META[chip.type].label}
                </span>
              ))}
            </div>
          )}
          <div className="helix-inquiry-row">
            <input
              ref={inputRef}
              className="helix-inquiry-input"
              placeholder="Ask anything — a market, a codebase, a decision, a research question…"
              onKeyDown={e => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onExit(); }}
              onChange={e => {
                const val = e.target.value;
                if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
                if (!val.trim()) { setPreviewChips([]); return; }
                previewDebounceRef.current = setTimeout(() => setPreviewChips(previewTabType(val)), 300);
              }}
              disabled={processing}
            />
            <button className={`helix-inquiry-send${processing ? " processing" : ""}`} onClick={() => void submit()} disabled={processing}>
              {processing ? <span className="helix-spinner" /> : "ANALYZE"}
            </button>
            <button className="helix-help-btn" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts (?)">?</button>
          </div>
        </div>

        {/* ── Intel Patterns Panel ─────────────────────────────────────────── */}
        {patternsOpen && project && (
          <IntelPatternsPanel
            projectId={project.id}
            entryCount={entries.filter(e => !e.voided).length}
            onClose={() => setPatternsOpen(false)}
          />
        )}

        {/* ── Deep Brief Panel ─────────────────────────────────────────────── */}
        {briefEntry && project && (
          <DeepBriefPanel
            entry={briefEntry}
            projectId={project.id}
            onClose={() => setBriefEntry(null)}
            onBriefReady={(id) => {
              setBriefedEntryIds(prev => { const next = new Set(prev); next.add(id); return next; });
              setLastActionTs(Date.now());
            }}
            onFireAction={(key) => {
              const e = briefEntry;
              setBriefEntry(null);
              if (key === "triangulate") void triangulate(e);
              else if (key === "redteam") void launchRedTeam(e);
              else if (key === "priorart") void scanPriorArt(e);
              else if (key === "develop") void developStrategy(e);
              else if (key === "trace") void traceChain(e);
              else if (key === "fork") void forkScenario(e);
              else if (key === "lock") lockEntry(e);
            }}
          />
        )}

        {/* ── Red Team Overlay ────────────────────────────────────────────── */}
        {redTeamActive && (
          <RedTeamOverlay
            entry={redTeamEntry}
            targetText={redTeamTargetText ?? undefined}
            session={redTeamSession}
            loading={redTeamLoading}
            onClose={() => { setRedTeamActive(false); setRedTeamTargetText(null); }}
          />
        )}

        {/* ── Causal Chain Overlay ─────────────────────────────────────────── */}
        {causalActive && causalChain && (
          <CausalChainOverlay chain={causalChain} entries={entries} onClose={() => setCausalActive(false)} />
        )}

        {/* ── Scenario Forge Overlay ───────────────────────────────────────── */}
        {scenarioActive && scenarioEntry && (
          <ScenarioForge
            entry={scenarioEntry}
            scenario={scenarios[scenarioEntry.id] ?? null}
            loading={forkingIds.has(scenarioEntry.id)}
            onClose={() => setScenarioActive(false)}
          />
        )}

        {/* ── The Forge ───────────────────────────────────────────────────── */}
        {forgeOpen && (
          <ForgePanel
            doc={forgeDoc}
            docs={forgeDocs}
            blocks={forgeBlocks}
            saving={forgeSaving}
            wordCount={forgeWordCount}
            lastSaved={forgeLastSaved}
            focusMode={forgeFocusMode}
            intelSearch={forgeIntelSearch}
            artificerMessages={forgeArtificerMessages}
            artificerInput={artificerInput}
            artificerLoading={artificerLoading}
            artificerActive={artificerActive}
            rail={forgeRail}
            relevant={forgeRelevant}
            entries={entries}
            vault={vault}
            activeBlockId={forgeActiveBlockId}
            onSelectDoc={(d) => void openForge(d)}
            onNewDoc={() => void newForgeDoc()}
            onDeleteDoc={(id) => void deleteForgeDoc(id)}
            onUpdateTitle={(t) => void updateForgeTitle(t)}
            onSwitchMode={(m) => void switchForgeMode(m)}
            onUpdateBlock={updateForgeBlock}
            onAddBlock={(type, content, sourceType, sourceId, strand, conf) =>
              addForgeBlock(type, content, sourceType, sourceId, strand, conf)}
            onRemoveBlock={removeForgeBlock}
            onMoveBlock={moveForgeBlock}
            onDuplicateBlock={duplicateForgeBlock}
            onPullEntry={pullEntryToForge}
            onInsertArtificerBlock={insertArtificerBlock}
            onArtificerInput={setArtificerInput}
            onArtificerSubmit={(m) => void askArtificer(m)}
            onToggleArtificerActive={() => setArtificerActive(a => !a)}
            onSetRail={(r) => setForgeRail(r as "outline" | "artificer")}
            onLoadRelevant={() => void loadForgeRelevant()}
            onExport={() => void exportForge()}
            onSetActiveBlock={setForgeActiveBlockId}
            onFocusMode={() => setForgeFocusMode(f => !f)}
            onIntelSearch={setForgeIntelSearch}
            onClose={() => setForgeOpen(false)}
          />
        )}

        {/* ── Workflow Studio Overlay ──────────────────────────────────────── */}
        {wfOpen && (
          <WorkflowStudio
            workflows={wfWorkflows}
            activeId={wfActiveId}
            graph={wfGraph}
            selectedNodeId={wfSelectedNodeId}
            run={wfRun}
            nodeRuns={wfNodeRuns}
            running={wfRunning}
            runHistory={wfRunHistory}
            rightPanel={wfRightPanel}
            saving={wfSaving}
            edgeDraw={wfEdgeDraw}
            onOpenWorkflow={openWfWorkflow}
            onNewWorkflow={() => void newWfWorkflow()}
            onDeleteWorkflow={(id) => void deleteWfWorkflow(id)}
            onSaveGraph={() => void saveWfGraph()}
            onRunWorkflow={() => void runWfWorkflow()}
            onAddNode={addWfNode}
            onMoveNode={moveWfNode}
            onSelectNode={setWfSelectedNodeId}
            onAddEdge={addWfEdge}
            onRemoveEdge={removeWfEdge}
            onDeleteNode={deleteWfNode}
            onUpdateNode={updateWfNodeConfig}
            onSetRightPanel={setWfRightPanel}
            onSetEdgeDraw={setWfEdgeDraw}
            onClose={() => setWfOpen(false)}
          />
        )}

        {/* ── Agent Constellation Overlay ──────────────────────────────────── */}
        {agentConstOpen && (
          <AgentConstellationOverlay
            agents={agents}
            onClose={() => setAgentConstOpen(false)}
          />
        )}

        {/* ── Living Brief Overlay ─────────────────────────────────────────── */}
        {showBrief && (
          <LivingBriefOverlay
            brief={brief}
            loading={briefLoading}
            changedSections={changedSections}
            onClose={() => setShowBrief(false)}
          />
        )}

        {/* ── Oracle Overlay ───────────────────────────────────────────────── */}
        {oracleActive && (
          <OracleOverlay
            query={oracleQuery}
            answer={oracleAnswer}
            loading={oracleLoading}
            entries={entries}
            onQueryChange={setOracleQuery}
            onSubmit={() => void submitOracle()}
            onClose={() => { setOracleActive(false); setOracleAnswer(null); setOracleQuery(""); }}
          />
        )}

        {/* ── Vault Overlay ───────────────────────────────────────────────── */}
        {showVault && (
          <aside className="helix-vault-overlay">
            <div className="helix-vault-head">
              <span className="helix-vault-title">Decision Vault</span>
              <span className="helix-vault-sub">{vault.length} locked</span>
              <button className="helix-vault-close" onClick={() => setShowVault(false)}>×</button>
            </div>
            <div className="helix-vault-body">
              {vault.length === 0 && (
                <div className="helix-empty"><span>No locked decisions yet — click ⊕ on any card to lock it</span></div>
              )}
              {vault.map(v => (
                <article key={v.id} className={`helix-vault-card strand-${v.strand}`} style={{ "--strand-color": STRAND_META[v.strand as Strand]?.color ?? "#4a9eff" } as React.CSSProperties}>
                  <div className="helix-card-head">
                    <span className="helix-card-strand-badge">{STRAND_META[v.strand as Strand]?.label}</span>
                    <time>{formatTime(v.created_at)}</time>
                  </div>
                  <p className="helix-card-query">{v.query}</p>
                </article>
              ))}
            </div>
          </aside>
        )}

      </div>
    </div>
  );
}

