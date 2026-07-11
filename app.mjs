import * as THREE from "/vendor/three/three.module.js";
import { gsap } from "/vendor/gsap/index.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const modes = [
  { id: "command", label: "Command", title: "Command Core", kicker: "adaptive operating layer", brief: "Ask once. The workspace moves around the task." },
  { id: "kalshi", label: "Kalshi", title: "Market War Room", kicker: "probability intelligence", brief: "Live market pulse, event search, risk previews, and thesis cards." },
  { id: "canvas", label: "Canvas", title: "Holographic Canvas", kicker: "strategy geometry", brief: "Map ideas, diagrams, trades, projects, and next actions in one space." },
  { id: "projects", label: "Projects", title: "Codex Bay", kicker: "local build control", brief: "Inspect projects, route tasks, and keep work moving from one console." },
  { id: "agents", label: "Agents", title: "Mission Control", kicker: "sub-agent operations", brief: "Launch visible workers, track progress, and verify completion." },
  { id: "vision", label: "Vision", title: "Vision Array", kicker: "camera and screen scan", brief: "Capture the world or your screen, then send it to the brain for analysis." },
  { id: "phone", label: "Phone", title: "Remote Bridge", kicker: "mobile command relay", brief: "Pair a phone, expose TwiML voice hooks, and approve remote tasks." },
  { id: "study", label: "Study", title: "Focus Chamber", kicker: "learning optimizer", brief: "Timer, notes, flashcards, quiz generation, and clean focus state." },
  { id: "prepare", label: "Prepare", title: "Briefing Room", kicker: "email and rehearsal", brief: "Draft messages, build agendas, and rehearse before the next move." },
  { id: "entertainment", label: "Media", title: "Media Nebula", kicker: "ambient control", brief: "Queue media, set ambience, and flip out of work mode cleanly." },
];

const modeById = Object.fromEntries(modes.map((mode) => [mode.id, mode]));
const defaultWidgets = [
  { id: "voice", title: "Voice Orb", mode: "all", x: 52, y: 104, w: 270, h: 172, pinned: true },
  { id: "markets", title: "Kalshi Pulse", mode: "kalshi", x: 64, y: 158, w: 388, h: 330, pinned: true },
  { id: "canvas", title: "Holo Canvas", mode: "canvas", x: 72, y: 462, w: 430, h: 292, pinned: true },
  { id: "projects", title: "Codex Projects", mode: "projects", x: 78, y: 158, w: 390, h: 330, pinned: true },
  { id: "agents", title: "Mission Agents", mode: "agents", x: 980, y: 146, w: 372, h: 330, pinned: true },
  { id: "vision", title: "Vision Scan", mode: "vision", x: 930, y: 146, w: 420, h: 358, pinned: true },
  { id: "phone", title: "Phone Bridge", mode: "phone", x: 982, y: 480, w: 360, h: 230, pinned: true },
  { id: "prepare", title: "Briefing Room", mode: "prepare", x: 72, y: 156, w: 420, h: 380, pinned: true },
  { id: "study", title: "Focus Stack", mode: "study", x: 982, y: 148, w: 360, h: 314, pinned: true },
  { id: "media", title: "Media Nebula", mode: "entertainment", x: 80, y: 158, w: 390, h: 310, pinned: true },
  { id: "verify", title: "Trust Matrix", mode: "all", x: 514, y: 676, w: 430, h: 156, pinned: true },
];

const state = {
  mode: "command",
  settings: {},
  widgets: defaultWidgets,
  metrics: {},
  timeline: [],
  markets: [],
  projects: [],
  agents: [],
  verification: [],
  phone: null,
  lastFrame: "",
  mediaStream: null,
  screenStream: null,
  recognition: null,
  wakeActive: false,
  gesture: "not loaded",
  focusSeconds: 25 * 60,
  focusTimer: null,
  mediaQueue: ["Ambient Reactor Mix", "Market Close Brief", "Deep Work Pulse"],
  canvasData: null,
};

const bootLines = [
  "Cold-starting reactor lattice.",
  "Aligning orbital widgets.",
  "Linking voice array.",
  "Calibrating verification matrix.",
  "Command OS online.",
];

let renderer;
let scene;
let camera;
let reactorGroup;
let particleSystem;
let startedAt = performance.now();
let dragState = null;

init().catch((error) => {
  console.error(error);
  addTimeline("fault", error.message || "Jarvis boot fault.");
});

async function init() {
  initThree();
  renderModeWheel();
  bindGlobalEvents();
  await Promise.all([loadSystemState(), loadSettings(), loadCanvas(), loadAgents()]);
  renderWidgets();
  updateModeText();
  startBoot();
  setInterval(refreshStatus, 2400);
  setInterval(() => loadAgents(true), 5000);
  setInterval(updateClock, 1000);
  updateClock();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `Request failed: ${path}`);
  return data;
}

function startBoot() {
  const boot = $("#bootSequence");
  const percent = $("#bootPercent");
  const line = $("#bootLine");
  let value = 0;
  const timer = setInterval(() => {
    value += Math.ceil(Math.random() * 14);
    const capped = Math.min(value, 100);
    percent.textContent = `${capped}%`;
    line.textContent = bootLines[Math.min(bootLines.length - 1, Math.floor(capped / 24))];
    if (capped >= 100) {
      clearInterval(timer);
      setTimeout(() => boot.classList.add("done"), 360);
      addTimeline("system", "Command OS boot sequence completed.");
      runVerification("Boot sequence", ["api", "ui", "animation"]);
    }
  }, 150);
}

async function loadSystemState() {
  try {
    const data = await api("/api/system/state");
    state.metrics = data.metrics || {};
    state.settings = data.settings || state.settings;
    state.widgets = mergeWidgets(data.widgets || []);
    state.verification = data.verification || [];
    state.mode = data.mode?.mode || state.mode;
    document.body.dataset.mode = state.mode;
    updateStatus(data);
  } catch (error) {
    state.widgets = defaultWidgets;
    addTimeline("fault", error.message);
  }
}

function mergeWidgets(serverWidgets) {
  const byId = new Map(defaultWidgets.map((widget) => [widget.id, { ...widget }]));
  for (const widget of serverWidgets) byId.set(widget.id, { ...(byId.get(widget.id) || {}), ...widget });
  return Array.from(byId.values());
}

async function loadSettings() {
  const settings = await api("/api/settings");
  state.settings = settings;
  $("#wakePhrase").value = settings.wakePhrase || "jarvis";
  $("#phoneNumber").value = settings.phoneNumber || "";
  $("#webhookBaseUrl").value = settings.webhookBaseUrl || "";
  $("#brainStatus").textContent = settings.hasGeminiKey ? "brain: gemini" : "brain: local";
}

async function loadCanvas() {
  try {
    state.canvasData = await api("/api/canvas/default");
  } catch {
    state.canvasData = null;
  }
}

async function refreshStatus() {
  try {
    const data = await api("/api/status");
    state.metrics = data.metrics || {};
    updateStatus(data);
    updateWidgetMetrics();
  } catch (error) {
    $("#trustStatus").textContent = "trust: offline";
  }
}

function updateStatus(data) {
  $("#corePower").textContent = `${data.metrics?.reactor ?? 91}%`;
  $("#coreState").textContent = String(data.state || "online").toUpperCase();
  $("#trustStatus").textContent = `trust: ${data.state || "online"}`;
  $("#brainStatus").textContent = data.settings?.hasGeminiKey ? "brain: gemini" : "brain: local";
}

function updateClock() {
  $("#clockReadout").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderModeWheel() {
  const wheel = $("#modeWheel");
  wheel.innerHTML = modes
    .map((mode, index) => {
      const angle = (index / modes.length) * Math.PI * 2 - Math.PI / 2;
      const radius = 44;
      const x = 50 + Math.cos(angle) * radius;
      const y = 50 + Math.sin(angle) * radius;
      return `<button class="mode-node" data-mode="${mode.id}" style="left:${x}%;top:${y}%"><span>${String(index + 1).padStart(2, "0")}</span><strong>${mode.label}</strong></button>`;
    })
    .join("");
}

function bindGlobalEvents() {
  $("#modeLauncher").addEventListener("click", () => $("#modeWheel").classList.toggle("open"));
  $("#modeWheel").addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    $("#modeWheel").classList.remove("open");
    switchMode(button.dataset.mode, "launcher");
  });
  $("#sendCommand").addEventListener("click", sendCommand);
  $("#commandInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendCommand();
  });
  $("#openBrainLink").addEventListener("click", () => {
    $("#brainPanel").hidden = false;
    gsap.fromTo("#brainPanel", { opacity: 0, y: -18 }, { opacity: 1, y: 0, duration: 0.25 });
  });
  $("#closeBrainLink").addEventListener("click", () => ($("#brainPanel").hidden = true));
  $("#saveBrain").addEventListener("click", saveBrain);
  $("#testBrain").addEventListener("click", testBrain);
  $("#verifyNow").addEventListener("click", () => runVerification("Manual verification", ["api", "ui", "console"]));
  $("#clearTimeline").addEventListener("click", () => {
    state.timeline = [];
    renderTimeline();
  });
  $("#micButton").addEventListener("click", oneShotVoice);
  $("#wakeToggle").addEventListener("click", toggleWake);
  $("#widgetLayer").addEventListener("click", handleWidgetAction);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", stopWidgetInteraction);
  window.addEventListener("resize", () => {
    onResize();
    drawStrategyCanvas();
  });
}

async function switchMode(mode, reason = "manual") {
  if (!modeById[mode]) mode = "command";
  state.mode = mode;
  document.body.dataset.mode = mode;
  updateModeText();
  pulseReactor(mode);
  addTimeline("mode", `Environment shifted to ${modeById[mode].title}.`);
  renderWidgets(true);
  api("/api/modes/switch", { method: "POST", body: { mode, reason } }).catch(() => {});
  if (mode === "kalshi" && !state.markets.length) loadMarkets();
  if (mode === "projects" && !state.projects.length) loadProjects();
  if (mode === "agents") loadAgents();
  if (mode === "phone" && !state.phone) pairPhone();
}

function updateModeText() {
  const mode = modeById[state.mode] || modeById.command;
  $("#modeTitle").textContent = mode.title;
  $("#modeKicker").textContent = mode.kicker;
  $("#modeBrief").textContent = mode.brief;
  $("#modeIntent").textContent = mode.kicker;
}

function renderWidgets(animate = false) {
  const layer = $("#widgetLayer");
  const template = $("#widgetTemplate");
  layer.innerHTML = "";
  for (const widget of visibleWidgets()) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.widget = widget.id;
    $(".widget-title", node).textContent = widget.title;
    $(".pin-widget", node).textContent = widget.pinned ? "PINNED" : "PIN";
    $(".widget-body", node).innerHTML = widgetContent(widget.id);
    applyWidgetGeometry(node, widget);
    bindWidgetChrome(node, widget);
    layer.appendChild(node);
  }
  if (animate) {
    gsap.fromTo(".holo-widget", { opacity: 0, y: 22, rotateX: -7 }, { opacity: 1, y: 0, rotateX: 0, duration: 0.42, stagger: 0.04, ease: "power2.out" });
  }
  reconnectMediaPreview();
  drawStrategyCanvas();
}

function visibleWidgets() {
  const current = state.mode;
  const commandIds = new Set(["voice", "verify", "agents", "projects"]);
  return state.widgets.filter((widget) => widget.mode === "all" || widget.mode === current || (current === "command" && commandIds.has(widget.id)));
}

function applyWidgetGeometry(node, widget) {
  const maxX = Math.max(20, window.innerWidth - widget.w - 24);
  const maxY = Math.max(88, window.innerHeight - widget.h - 118);
  node.style.left = `${Math.min(widget.x, maxX)}px`;
  node.style.top = `${Math.min(widget.y, maxY)}px`;
  node.style.width = `${widget.w}px`;
  node.style.height = `${widget.h}px`;
}

function bindWidgetChrome(node, widget) {
  $(".widget-chrome", node).addEventListener("pointerdown", (event) => {
    if (event.target.closest("button,input,textarea")) return;
    dragState = {
      type: "move",
      id: widget.id,
      node,
      startX: event.clientX,
      startY: event.clientY,
      left: parseFloat(node.style.left),
      top: parseFloat(node.style.top),
    };
    node.setPointerCapture?.(event.pointerId);
  });
  $(".resize-handle", node).addEventListener("pointerdown", (event) => {
    dragState = {
      type: "resize",
      id: widget.id,
      node,
      startX: event.clientX,
      startY: event.clientY,
      w: node.offsetWidth,
      h: node.offsetHeight,
    };
    event.preventDefault();
  });
}

function handlePointerMove(event) {
  if (!dragState) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  if (dragState.type === "move") {
    dragState.node.style.left = `${Math.max(14, Math.min(window.innerWidth - 220, dragState.left + dx))}px`;
    dragState.node.style.top = `${Math.max(82, Math.min(window.innerHeight - 140, dragState.top + dy))}px`;
  } else {
    dragState.node.style.width = `${Math.max(220, dragState.w + dx)}px`;
    dragState.node.style.height = `${Math.max(140, dragState.h + dy)}px`;
    drawStrategyCanvas();
  }
}

async function stopWidgetInteraction() {
  if (!dragState) return;
  const node = dragState.node;
  const widget = state.widgets.find((item) => item.id === dragState.id);
  if (widget) {
    Object.assign(widget, {
      x: Math.round(parseFloat(node.style.left)),
      y: Math.round(parseFloat(node.style.top)),
      w: Math.round(node.offsetWidth),
      h: Math.round(node.offsetHeight),
    });
    api(`/api/widgets/${widget.id}/layout`, { method: "PATCH", body: widget }).catch(() => {});
  }
  dragState = null;
}

function widgetContent(id) {
  const content = {
    voice: voiceWidget(),
    markets: marketWidget(),
    canvas: canvasWidget(),
    projects: projectsWidget(),
    agents: agentsWidget(),
    vision: visionWidget(),
    phone: phoneWidget(),
    prepare: prepareWidget(),
    study: studyWidget(),
    media: mediaWidget(),
    verify: verifyWidget(),
  };
  return content[id] || `<p class="empty-state">Widget not wired.</p>`;
}

function voiceWidget() {
  return `
    <div class="grid-two">
      <div class="metric"><span class="mini-label">Reactor</span><strong data-metric="reactor">${state.metrics.reactor ?? 91}%</strong><div class="progress"><span style="--value:${state.metrics.reactor ?? 91}%"></span></div></div>
      <div class="metric"><span class="mini-label">Latency</span><strong data-metric="latency">${state.metrics.latency ?? 18} ms</strong><div class="progress"><span style="--value:${Math.max(8, 100 - (state.metrics.latency ?? 18))}%"></span></div></div>
      <div class="metric"><span class="mini-label">Voice</span><strong>${state.wakeActive ? "wake live" : "ready"}</strong></div>
      <div class="metric"><span class="mini-label">Gesture</span><strong>${state.gesture}</strong></div>
    </div>
    <div class="chip-row">
      <button class="chip" data-action="voice">push to talk</button>
      <button class="chip" data-action="gesture">arm gestures</button>
      <button class="chip" data-action="screen-scan">screen scan</button>
    </div>`;
}

function marketWidget() {
  const rows = state.markets.length
    ? state.markets
        .slice(0, 6)
        .map((market) => `<article class="market-card"><strong>${escapeHtml(market.ticker || "MARKET")}</strong><span>${escapeHtml(market.title || "")}</span><div class="progress"><span style="--value:${market.yesAsk ?? market.yesBid ?? 50}%"></span></div><small>yes ${market.yesBid ?? "-"} / ${market.yesAsk ?? "-"} | volume ${market.volume ?? 0}</small></article>`)
        .join("")
    : `<p class="empty-state">No scan yet. Hit pulse scan.</p>`;
  return `
    <label>Market search<input id="marketSearch" placeholder="weather, fed, sports..." /></label>
    <div class="chip-row">
      <button class="chip" data-action="scan-markets">pulse scan</button>
      <button class="chip" data-action="market-agent">send agent</button>
      <button class="danger-chip" data-action="order-preview">risk preview</button>
    </div>
    <div class="mini-list">${rows}</div>`;
}

function canvasWidget() {
  return `
    <canvas class="strategy-canvas" id="strategyCanvas"></canvas>
    <div class="chip-row">
      <button class="chip" data-action="canvas-node">add node</button>
      <button class="chip" data-action="canvas-auto">auto diagram</button>
      <button class="chip" data-action="canvas-save">save</button>
      <button class="chip" data-action="canvas-export">export</button>
    </div>`;
}

function projectsWidget() {
  const rows = state.projects.length
    ? state.projects
        .slice(0, 5)
        .map((project) => `<article class="project-card"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.folder)} | ${project.hasGit ? "git" : "folder"} | ${project.fileCount} files</span><div class="chip-row"><button class="chip" data-action="open-project" data-path="${escapeAttr(project.path)}">open</button><button class="chip" data-action="project-agent" data-title="${escapeAttr(project.name)}">agent</button></div></article>`)
        .join("")
    : `<p class="empty-state">No project scan yet.</p>`;
  return `<div class="chip-row"><button class="chip" data-action="refresh-projects">refresh projects</button><button class="chip" data-action="project-health">health scan</button></div><div class="mini-list">${rows}</div>`;
}

function agentsWidget() {
  return `
    <label>Mission brief<input id="agentBrief" placeholder="Audit voice mode, build feature, research repo..." /></label>
    <div class="chip-row"><button class="chip" data-action="launch-agent">launch worker</button><button class="chip" data-action="verify-agents">verify board</button></div>
    <div class="mini-list agent-list">${agentRows()}</div>`;
}

function agentRows() {
  return state.agents.length
    ? state.agents
        .slice(0, 6)
        .map((agent) => `<article class="agent-card"><strong>${escapeHtml(agent.title)}</strong><span>${agent.progress ?? 0}% ${escapeHtml(agent.status || "queued")}</span><div class="progress"><span style="--value:${agent.progress ?? 0}%"></span></div></article>`)
        .join("")
    : `<p class="empty-state">No workers yet.</p>`;
}

function visionWidget() {
  return `
    <video class="camera-preview" id="visionPreview" autoplay playsinline muted></video>
    <div class="chip-row">
      <button class="chip" data-action="start-camera">camera</button>
      <button class="chip" data-action="capture-camera">capture</button>
      <button class="chip" data-action="screen-scan">screen</button>
      <button class="chip" data-action="analyze-frame">analyze</button>
      <button class="danger-chip" data-action="stop-vision">stop</button>
    </div>
    <p id="visionResult" class="empty-state">${state.lastFrame ? "Frame captured. Ready to analyze." : "Permission-gated. Camera and screen prompts come from the browser."}</p>`;
}

function phoneWidget() {
  const phone = state.phone;
  return `
    <div class="grid-two">
      <div class="metric"><span class="mini-label">PIN</span><strong>${phone?.pin || "------"}</strong></div>
      <div class="metric"><span class="mini-label">Webhook</span><strong>${phone ? "ready" : "not paired"}</strong></div>
    </div>
    <div class="chip-row"><button class="chip" data-action="pair-phone">pair phone</button><button class="chip" data-action="mock-phone">mock call task</button></div>
    <p>${phone ? escapeHtml(phone.urls?.[1] || phone.urls?.[0] || "") : "Pair to expose LAN URL and Twilio-compatible voice webhook."}</p>
    <p>${phone ? escapeHtml(phone.twilioWebhook || "") : ""}</p>`;
}

function prepareWidget() {
  return `
    <label>Recipient<input id="emailRecipient" placeholder="Alex" /></label>
    <label>Tone<input id="emailTone" value="confident, warm, concise" /></label>
    <label>Context<textarea id="emailContext">Write a polished update about the Jarvis rebuild, what changed, and next steps.</textarea></label>
    <div class="chip-row"><button class="chip" data-action="draft-email">draft email</button><button class="chip" data-action="rehearse">rehearse</button></div>
    <article class="brief-card"><strong>Draft</strong><span id="emailDraft">No draft yet.</span></article>`;
}

function studyWidget() {
  const minutes = String(Math.floor(state.focusSeconds / 60)).padStart(2, "0");
  const seconds = String(state.focusSeconds % 60).padStart(2, "0");
  return `
    <div class="grid-two">
      <div class="metric"><span class="mini-label">Focus</span><strong id="focusClock">${minutes}:${seconds}</strong></div>
      <div class="metric"><span class="mini-label">Mode</span><strong>deep work</strong></div>
    </div>
    <label>Notes<textarea id="studyNotes">Summarize, quiz me, and extract actions from this topic.</textarea></label>
    <div class="chip-row"><button class="chip" data-action="study-start">start</button><button class="chip" data-action="study-pause">pause</button><button class="chip" data-action="study-reset">reset</button><button class="chip" data-action="study-quiz">quiz</button></div>
    <article class="brief-card"><strong>Output</strong><span id="studyOutput">Ready.</span></article>`;
}

function mediaWidget() {
  return `<div class="mini-list">${state.mediaQueue.map((item) => `<article class="media-card"><strong>${escapeHtml(item)}</strong><span>queued</span></article>`).join("")}</div><div class="chip-row"><button class="chip" data-action="media-add">add ambience</button><button class="chip" data-action="media-play">play pulse</button></div>`;
}

function verifyWidget() {
  const rows = state.verification.length
    ? state.verification
        .slice(0, 4)
        .map((item) => `<article class="verify-card"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.status)} | ${item.confidence}% confidence</span></article>`)
        .join("")
    : `<p class="empty-state">Verification matrix is warming up.</p>`;
  return `<div class="chip-row"><button class="chip" data-action="run-verify">run checks</button><button class="danger-chip" data-action="force-fail">fail test</button></div><div class="mini-list">${rows}</div>`;
}

async function handleWidgetAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "voice") return oneShotVoice();
  if (action === "gesture") return armGestures();
  if (action === "scan-markets") return loadMarkets($("#marketSearch")?.value || "");
  if (action === "market-agent") return createAgent("Analyze top Kalshi market opportunities", "kalshi");
  if (action === "order-preview") return runVerification("Kalshi risk preview blocked live order", ["risk gate", "confirmation required", "no live trading"]);
  if (action === "canvas-node") return addCanvasNode();
  if (action === "canvas-auto") return autoDiagram();
  if (action === "canvas-save") return saveCanvas();
  if (action === "canvas-export") return exportCanvas();
  if (action === "refresh-projects") return loadProjects();
  if (action === "project-health") return runVerification("Project health scan", ["projects endpoint", "workspace paths", "no destructive action"]);
  if (action === "open-project") return openProject(button.dataset.path);
  if (action === "project-agent") return createAgent(`Inspect project ${button.dataset.title}`, "projects");
  if (action === "launch-agent") return createAgent($("#agentBrief")?.value || "Investigate mission", state.mode);
  if (action === "verify-agents") return runVerification("Agent board verification", ["agents endpoint", "progress refresh", "input preserved"]);
  if (action === "start-camera") return startCamera();
  if (action === "capture-camera") return captureFrame();
  if (action === "screen-scan") return startScreenScan();
  if (action === "analyze-frame") return analyzeFrame();
  if (action === "stop-vision") return stopVision();
  if (action === "pair-phone") return pairPhone();
  if (action === "mock-phone") return mockPhoneCommand();
  if (action === "draft-email") return draftEmail();
  if (action === "rehearse") return askBrain("Create three rehearsal questions for this briefing.", "prepare");
  if (action === "study-start") return startFocus();
  if (action === "study-pause") return pauseFocus();
  if (action === "study-reset") return resetFocus();
  if (action === "study-quiz") return studyQuiz();
  if (action === "media-add") return addMediaItem();
  if (action === "media-play") return addTimeline("media", "Ambient pulse queued. Browser autoplay requires a user gesture.");
  if (action === "run-verify") return runVerification("UI feature verification", ["api", "widgets", "mode", "console"]);
  if (action === "force-fail") return runVerification("Forced failing verification", ["api", "fail: simulated visual overlap"]);
}

async function sendCommand() {
  const input = $("#commandInput");
  const command = input.value.trim();
  if (!command) return;
  input.value = "";
  addTimeline("user", command);
  $("#coreState").textContent = "THINKING";
  pulseReactor("thinking");
  try {
    const data = await api("/api/brain", { method: "POST", body: { prompt: command, mode: state.mode } });
    addTimeline(data.source === "gemini" ? "gemini" : "jarvis", data.response || "Command complete.");
    await handleBrainActions(command, data);
    speakIfUseful(data.response);
  } catch (error) {
    addTimeline("fault", error.message);
  } finally {
    $("#coreState").textContent = "ONLINE";
  }
}

async function handleBrainActions(command, data) {
  const actions = data.actions || [];
  const modeAction = actions.find((action) => String(action).startsWith("mode:"));
  if (modeAction) await switchMode(modeAction.split(":")[1], "brain route");
  if (actions.includes("add-task")) await createAgent(command, state.mode);
  if (/email|mail|draft/i.test(command)) {
    await switchMode("prepare", "email command");
    await draftEmail(command);
  }
  if (/screen|camera|scan/i.test(command)) await switchMode("vision", "scan command");
  if (/kalshi|market/i.test(command)) await loadMarkets(command.replace(/kalshi|market/gi, "").trim());
  if (/canvas|diagram|map/i.test(command)) autoDiagram(command);
}

async function askBrain(prompt, mode = state.mode, imageData = "") {
  const data = await api("/api/brain", { method: "POST", body: { prompt, mode, imageData } });
  addTimeline(data.source === "gemini" ? "gemini" : "jarvis", data.response);
  return data;
}

async function saveBrain() {
  const geminiKey = $("#geminiKey").value.trim();
  const wakePhrase = $("#wakePhrase").value.trim() || "jarvis";
  const phoneNumber = $("#phoneNumber").value.trim();
  const webhookBaseUrl = $("#webhookBaseUrl").value.trim();
  const settings = await api("/api/settings", { method: "POST", body: { geminiKey, wakePhrase, phoneNumber, webhookBaseUrl } });
  state.settings = settings;
  $("#brainMessage").textContent = settings.hasGeminiKey ? "Brain linked. Model routing is automatic." : "Saved local settings. Add a Gemini key when ready.";
  $("#brainStatus").textContent = settings.hasGeminiKey ? "brain: gemini" : "brain: local";
  addTimeline("brain", $("#brainMessage").textContent);
}

async function testBrain() {
  try {
    const data = await api("/api/settings/test", { method: "POST", body: {} });
    $("#brainMessage").textContent = data.needsKey ? "Key needed. Paste it once and save." : `Gemini ready. ${data.models?.length || 0} compatible models detected automatically.`;
  } catch (error) {
    $("#brainMessage").textContent = error.message;
  }
}

async function loadMarkets(query = "") {
  const data = await api(`/api/kalshi/markets?q=${encodeURIComponent(query)}`);
  state.markets = data.markets || [];
  addTimeline("kalshi", `Loaded ${state.markets.length} public markets.`);
  renderWidgets(true);
  runVerification("Kalshi market scan", ["api", "render", state.markets.length ? "data" : "empty valid"]);
}

async function loadProjects() {
  const data = await api("/api/projects");
  state.projects = data.projects || [];
  addTimeline("projects", `Scanned ${state.projects.length} workspace projects.`);
  renderWidgets(true);
}

async function openProject(projectPath) {
  await api("/api/projects/open", { method: "POST", body: { path: projectPath } });
  addTimeline("projects", "Project opened in Explorer.");
}

async function loadAgents(silent = false) {
  const data = await api("/api/agents");
  state.agents = data.agents || [];
  const list = $(".agent-list");
  if (list) list.innerHTML = agentRows();
  if (!silent) renderWidgets(true);
}

async function createAgent(title, mode = state.mode) {
  const data = await api("/api/agents", { method: "POST", body: { title, mode } });
  state.agents = data.agents || [];
  addTimeline("agent", `Worker launched: ${title}`);
  const list = $(".agent-list");
  if (list) list.innerHTML = agentRows();
  else renderWidgets(true);
}

async function pairPhone() {
  const data = await api("/api/phone/pair");
  state.phone = data;
  addTimeline("phone", `Pair PIN ${data.pin}. LAN bridge ready.`);
  renderWidgets(true);
}

async function mockPhoneCommand() {
  const result = await fetch("/api/phone/voice-command", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ SpeechResult: "open projects and launch an agent" }).toString(),
  });
  const text = await result.text();
  addTimeline("phone", text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  createAgent("Phone bridge command simulation", "phone");
}

async function draftEmail(commandContext = "") {
  const recipient = $("#emailRecipient")?.value || "";
  const tone = $("#emailTone")?.value || "confident, warm, concise";
  const context = commandContext || $("#emailContext")?.value || "Write a polished update about the Jarvis rebuild.";
  const data = await api("/api/email/draft", { method: "POST", body: { recipient, tone, context } });
  const draft = $("#emailDraft");
  if (draft) draft.textContent = data.response || "Draft generated.";
  addTimeline("prepare", "Email draft generated.");
  runVerification("Prepare email draft", ["brain route", "draft render", "no model picker"]);
}

function startFocus() {
  if (state.focusTimer) return;
  state.focusTimer = setInterval(() => {
    state.focusSeconds = Math.max(0, state.focusSeconds - 1);
    const clockNode = $("#focusClock");
    if (clockNode) clockNode.textContent = `${String(Math.floor(state.focusSeconds / 60)).padStart(2, "0")}:${String(state.focusSeconds % 60).padStart(2, "0")}`;
    if (state.focusSeconds === 0) pauseFocus();
  }, 1000);
  addTimeline("study", "Focus timer started.");
}

function pauseFocus() {
  clearInterval(state.focusTimer);
  state.focusTimer = null;
  addTimeline("study", "Focus timer paused.");
}

function resetFocus() {
  pauseFocus();
  state.focusSeconds = 25 * 60;
  renderWidgets();
}

async function studyQuiz() {
  const notes = $("#studyNotes")?.value || "Jarvis command OS";
  const data = await askBrain(`Create a short useful quiz from these notes: ${notes}`, "study");
  const output = $("#studyOutput");
  if (output) output.textContent = data.response;
}

function addMediaItem() {
  state.mediaQueue.unshift(`Ambient Set ${state.mediaQueue.length + 1}`);
  renderWidgets(true);
  addTimeline("media", "Ambient item added.");
}

async function startCamera() {
  try {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    reconnectMediaPreview();
    $("#voiceStatus").textContent = "camera: live";
    addTimeline("vision", "Camera stream started.");
  } catch (error) {
    addTimeline("vision", `Camera blocked: ${error.message}`);
  }
}

async function startScreenScan() {
  try {
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    state.mediaStream = state.screenStream;
    reconnectMediaPreview();
    await switchMode("vision", "screen scan");
    addTimeline("vision", "Screen capture stream started.");
  } catch (error) {
    addTimeline("vision", `Screen capture blocked: ${error.message}`);
  }
}

function reconnectMediaPreview() {
  const video = $("#visionPreview");
  if (video && state.mediaStream) video.srcObject = state.mediaStream;
}

function captureFrame() {
  const video = $("#visionPreview");
  if (!video || !video.videoWidth) {
    addTimeline("vision", "No live video frame available.");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  state.lastFrame = canvas.toDataURL("image/jpeg", 0.82);
  const result = $("#visionResult");
  if (result) result.textContent = "Frame captured. Ready to analyze.";
  addTimeline("vision", "Frame captured.");
}

async function analyzeFrame() {
  if (!state.lastFrame) {
    addTimeline("vision", "Capture a camera or screen frame first.");
    return;
  }
  const data = await askBrain("Analyze this visual frame. Identify what matters and recommend the next action.", "vision", state.lastFrame);
  const result = $("#visionResult");
  if (result) result.textContent = data.response;
}

function stopVision() {
  for (const stream of [state.mediaStream, state.screenStream]) {
    for (const track of stream?.getTracks?.() || []) track.stop();
  }
  state.mediaStream = null;
  state.screenStream = null;
  state.lastFrame = "";
  renderWidgets();
  addTimeline("vision", "Vision streams stopped.");
}

async function armGestures() {
  try {
    await import("/vendor/mediapipe/vision_bundle.mjs");
    state.gesture = "ready";
    addTimeline("gesture", "MediaPipe Tasks loaded. Hand tracking can run after camera permission and model download.");
  } catch (error) {
    state.gesture = "blocked";
    addTimeline("gesture", `Gesture layer blocked: ${error.message}`);
  }
  renderWidgets();
}

function addCanvasNode() {
  const canvas = ensureCanvasData();
  const id = `node-${Date.now().toString(36)}`;
  canvas.nodes.push({ id, label: `Node ${canvas.nodes.length + 1}`, x: 160 + Math.random() * 520, y: 80 + Math.random() * 260, type: "note" });
  if (canvas.nodes.length > 1) canvas.edges.push([canvas.nodes[canvas.nodes.length - 2].id, id]);
  drawStrategyCanvas();
  addTimeline("canvas", "Node added.");
}

function autoDiagram(seed = "Jarvis architecture") {
  state.canvasData = {
    id: "default",
    nodes: [
      { id: "core", label: "Reactor Core", x: 410, y: 220, type: "core" },
      { id: "voice", label: "Voice Orb", x: 170, y: 88, type: "voice" },
      { id: "vision", label: "Vision Scan", x: 640, y: 90, type: "vision" },
      { id: "brain", label: "Gemini Brain", x: 190, y: 360, type: "brain" },
      { id: "tools", label: "Tools", x: 640, y: 360, type: "tools" },
      { id: "verify", label: "Trust Matrix", x: 410, y: 470, type: "verify" },
    ],
    edges: [
      ["voice", "core"],
      ["vision", "core"],
      ["core", "brain"],
      ["brain", "tools"],
      ["tools", "verify"],
      ["verify", "core"],
    ],
  };
  drawStrategyCanvas();
  saveCanvas();
  addTimeline("canvas", `Generated holographic diagram for ${seed}.`);
}

function ensureCanvasData() {
  if (!state.canvasData) autoDiagram("default");
  return state.canvasData;
}

async function saveCanvas() {
  const canvas = ensureCanvasData();
  await api("/api/canvas/default", { method: "PATCH", body: canvas });
  addTimeline("canvas", "Canvas saved.");
}

function exportCanvas() {
  const canvas = $("#strategyCanvas");
  if (!canvas) return;
  const link = document.createElement("a");
  link.download = "jarvis-canvas.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
  addTimeline("canvas", "Canvas exported.");
}

function drawStrategyCanvas() {
  const canvas = $("#strategyCanvas");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * devicePixelRatio));
  canvas.height = Math.max(180, Math.floor(rect.height * devicePixelRatio));
  const ctx = canvas.getContext("2d");
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const w = rect.width;
  const h = rect.height;
  const data = ensureCanvasData();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0, 10, 18, 0.38)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(90, 235, 255, 0.16)";
  for (let x = 0; x < w; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const sx = w / 840;
  const sy = h / 540;
  const nodeMap = Object.fromEntries(data.nodes.map((node) => [node.id, node]));
  ctx.lineWidth = 1.5;
  for (const [from, to] of data.edges) {
    const a = nodeMap[from];
    const b = nodeMap[to];
    if (!a || !b) continue;
    ctx.strokeStyle = "rgba(95, 240, 255, 0.58)";
    ctx.beginPath();
    ctx.moveTo(a.x * sx, a.y * sy);
    ctx.lineTo(b.x * sx, b.y * sy);
    ctx.stroke();
  }
  for (const node of data.nodes) {
    const x = node.x * sx;
    const y = node.y * sy;
    const r = node.type === "core" ? 24 : 16;
    const gradient = ctx.createRadialGradient(x, y, 2, x, y, r * 2.2);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.22, getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#42e8ff");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(230,252,255,0.92)";
    ctx.font = "13px Rajdhani, sans-serif";
    ctx.fillText(node.label, x + r + 6, y + 4);
  }
}

async function runVerification(title, checks) {
  const data = await api("/api/verify/run", { method: "POST", body: { title, checks } });
  state.verification = data.recent || [];
  renderVerifyOnly();
  addTimeline(data.verification.status, `${data.verification.title}: ${data.verification.status} (${data.verification.confidence}%).`);
}

function renderVerifyOnly() {
  const widget = $('[data-widget="verify"] .widget-body');
  if (widget) widget.innerHTML = verifyWidget();
}

function updateWidgetMetrics() {
  $$("[data-metric='reactor']").forEach((node) => (node.textContent = `${state.metrics.reactor ?? 91}%`));
  $$("[data-metric='latency']").forEach((node) => (node.textContent = `${state.metrics.latency ?? 18} ms`));
}

function addTimeline(kind, text) {
  state.timeline.unshift({ kind, text, time: new Date() });
  state.timeline = state.timeline.slice(0, 18);
  renderTimeline();
}

function renderTimeline() {
  $("#timeline").innerHTML = state.timeline.length
    ? state.timeline
        .map((item) => `<article><strong>${item.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} / ${escapeHtml(item.kind)}</strong><p>${escapeHtml(item.text)}</p></article>`)
        .join("")
    : `<article><strong>standby</strong><p>Mission feed clear.</p></article>`;
}

function oneShotVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addTimeline("voice", "Speech recognition is not available in this browser. Type command fallback is ready.");
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;
  $("#micButton").classList.add("listening");
  $("#voiceStatus").textContent = "voice: listening";
  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    $("#commandInput").value = transcript;
    addTimeline("voice", transcript);
    sendCommand();
  };
  recognition.onerror = (event) => addTimeline("voice", event.error || "Voice error");
  recognition.onend = () => {
    $("#micButton").classList.remove("listening");
    $("#voiceStatus").textContent = "voice: ready";
  };
  recognition.start();
}

function toggleWake() {
  const button = $("#wakeToggle");
  state.wakeActive = !state.wakeActive;
  button.classList.toggle("active", state.wakeActive);
  button.setAttribute("aria-pressed", String(state.wakeActive));
  $("#voiceStatus").textContent = state.wakeActive ? "voice: wake live" : "voice: ready";
  addTimeline("voice", state.wakeActive ? `Wake phrase armed: ${state.settings.wakePhrase || "jarvis"}` : "Wake phrase disarmed.");
  if (!state.wakeActive) {
    state.recognition?.stop?.();
    state.recognition = null;
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addTimeline("voice", "Wake mode unavailable in this browser.");
    return;
  }
  const recognition = new SpeechRecognition();
  state.recognition = recognition;
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const transcript = event.results[event.results.length - 1]?.[0]?.transcript || "";
    if (transcript.toLowerCase().includes(state.settings.wakePhrase || "jarvis")) {
      $("#commandInput").value = transcript.replace(new RegExp(state.settings.wakePhrase || "jarvis", "i"), "").trim();
      sendCommand();
    }
  };
  recognition.onend = () => {
    if (state.wakeActive) recognition.start();
  };
  recognition.start();
}

function speakIfUseful(text = "") {
  if (!("speechSynthesis" in window) || !text || !state.wakeActive) return;
  const utterance = new SpeechSynthesisUtterance(String(text).slice(0, 220));
  utterance.rate = 1.03;
  utterance.pitch = 0.86;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function initThree() {
  const canvas = $("#reactorScene");
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 7.5);
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  reactorGroup = new THREE.Group();
  scene.add(reactorGroup);
  scene.add(new THREE.AmbientLight(0x7eeeff, 0.7));
  const light = new THREE.PointLight(0x59eaff, 32, 18);
  light.position.set(0, 0, 3.4);
  scene.add(light);

  const material = new THREE.MeshBasicMaterial({ color: 0x5cecff, transparent: true, opacity: 0.68, wireframe: true });
  for (let i = 0; i < 8; i += 1) {
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1.05 + i * 0.18, 0.006 + i * 0.001, 12, 180), material.clone());
    torus.rotation.x = i % 2 ? Math.PI / 2.6 : Math.PI / 2;
    torus.rotation.y = i * 0.17;
    torus.userData.speed = 0.12 + i * 0.018;
    reactorGroup.add(torus);
  }
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 2), new THREE.MeshBasicMaterial({ color: 0xeaffff, transparent: true, opacity: 0.9, wireframe: true }));
  core.userData.core = true;
  reactorGroup.add(core);

  const particleCount = 1600;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i += 1) {
    const r = 1.7 + Math.random() * 3.2;
    const a = Math.random() * Math.PI * 2;
    const z = (Math.random() - 0.5) * 1.4;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = Math.sin(a) * r;
    positions[i * 3 + 2] = z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  particleSystem = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x70f0ff, size: 0.012, transparent: true, opacity: 0.58 }));
  reactorGroup.add(particleSystem);
  onResize();
  animateThree();
}

function pulseReactor(mode) {
  const color = new THREE.Color(getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#42e8ff");
  reactorGroup?.traverse((child) => {
    if (child.material?.color) child.material.color.copy(color);
  });
  if (mode === "thinking") {
    gsap.to(reactorGroup.scale, { x: 1.08, y: 1.08, z: 1.08, duration: 0.2, yoyo: true, repeat: 3 });
  } else {
    gsap.fromTo(reactorGroup.rotation, { z: reactorGroup.rotation.z - 0.2 }, { z: reactorGroup.rotation.z + 0.8, duration: 0.7, ease: "power3.out" });
  }
}

function animateThree() {
  requestAnimationFrame(animateThree);
  const t = (performance.now() - startedAt) / 1000;
  if (reactorGroup) {
    reactorGroup.rotation.z += 0.0018;
    reactorGroup.rotation.x = Math.sin(t * 0.18) * 0.08;
    reactorGroup.children.forEach((child, index) => {
      if (child.userData.core) {
        child.rotation.x += 0.008;
        child.rotation.y += 0.011;
      } else if (child.geometry?.type === "TorusGeometry") {
        child.rotation.z += child.userData.speed * 0.01 * (index % 2 ? -1 : 1);
      }
    });
  }
  if (particleSystem) particleSystem.rotation.z -= 0.0015;
  renderer.render(scene, camera);
}

function onResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
