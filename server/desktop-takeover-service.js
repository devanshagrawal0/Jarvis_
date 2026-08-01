"use strict";

const fs = require("fs");
const path = require("path");

const ACTIVE_PHASES = new Set(["starting", "observing", "planning", "acting", "verifying", "waiting_approval", "paused"]);

function clean(value, max = 500) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function createDesktopTakeoverService({ runtimeDir, emit, clock = () => new Date() } = {}) {
  if (!runtimeDir) throw new Error("runtimeDir is required");
  const statePath = path.join(runtimeDir, "desktop-takeover-state.json");
  let state = {
    version: 1,
    sessionId: null,
    taskId: null,
    objective: "",
    mode: "idle",
    phase: "idle",
    active: false,
    paused: false,
    overlayVisible: false,
    step: 0,
    action: "",
    detail: "",
    target: null,
    cursor: null,
    marks: [],
    startedAt: null,
    updatedAt: clock().toISOString(),
    endedAt: null,
    reason: "",
    emergencyShortcut: "Ctrl+Alt+Esc",
    pauseShortcut: "Ctrl+Alt+Space",
  };

  // Never silently resume physical input after a backend restart. Preserve the
  // previous session as an interrupted terminal record so Runtime can explain
  // what happened and the owner always starts a fresh takeover deliberately.
  try {
    if (fs.existsSync(statePath)) {
      const previous = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (previous && typeof previous === "object") {
        state = {
          ...state,
          ...previous,
          phase: previous.active ? "failed" : (previous.phase || "idle"),
          active: false,
          paused: false,
          overlayVisible: false,
          action: previous.active ? "Interrupted" : (previous.action || ""),
          detail: previous.active ? "Desktop control stopped safely because the JARVIS backend restarted." : (previous.detail || ""),
          reason: previous.active ? "Backend restart interrupted the desktop-control session" : (previous.reason || ""),
          endedAt: previous.active ? clock().toISOString() : (previous.endedAt || null),
          updatedAt: clock().toISOString(),
        };
      }
    }
  } catch {
    // A corrupt telemetry file must not prevent startup or grant input control.
    state.phase = "failed";
    state.action = "State recovery failed";
    state.detail = "Desktop takeover state was unreadable and has been reset safely.";
    state.reason = "Invalid persisted desktop takeover state";
    state.endedAt = clock().toISOString();
  }

  function persist() {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const temporary = `${statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, statePath);
  }

  function publish() {
    persist();
    try { emit?.({ ...state }); } catch {}
    if (typeof process.send === "function") {
      try { process.send({ type: "jarvis.desktop-takeover", state: { ...state } }); } catch {}
    }
    return { ...state };
  }

  function update(patch = {}) {
    state = { ...state, ...patch, updatedAt: clock().toISOString() };
    state.active = ACTIVE_PHASES.has(state.phase);
    state.paused = state.phase === "paused";
    state.overlayVisible = state.active;
    return publish();
  }

  function start({ taskId, objective, mode = "takeover", sessionId } = {}) {
    const id = clean(taskId, 200);
    if (!id) throw new Error("Desktop takeover requires a task id");
    if (!new Set(["takeover", "assist", "annotate"]).has(mode)) throw new Error("Desktop takeover mode must be takeover, assist, or annotate");
    const now = clock().toISOString();
    state = {
      ...state,
      sessionId: clean(sessionId, 200) || null,
      taskId: id,
      objective: clean(objective, 1_500),
      mode,
      phase: "starting",
      active: true,
      paused: false,
      overlayVisible: true,
      step: 0,
      action: "Preparing desktop control",
      detail: "JARVIS is binding the requested task to the visible desktop.",
      target: null,
      cursor: null,
      marks: [],
      startedAt: now,
      updatedAt: now,
      endedAt: null,
      reason: "",
    };
    return publish();
  }

  function observe(detail = "Reading the current screen") {
    return update({ phase: "observing", action: "Observe", detail: clean(detail), target: null });
  }

  function applyAgentStep(step = {}) {
    const phaseMap = {
      planned: "planning",
      executed: "verifying",
      failed: "observing",
      waiting_approval: "waiting_approval",
      committed: "verifying",
      done: "verifying",
      paused: "paused",
      resumed: "observing",
      cancelled: "cancelled",
    };
    const nextPhase = phaseMap[step.phase] || (step.action ? "acting" : "observing");
    const target = step.target || (step.x != null && step.y != null ? { x: Number(step.x), y: Number(step.y), label: clean(step.reasoning || step.action, 160) } : null);
    const marks = Array.isArray(step.marks) ? step.marks.slice(0, 80).map((mark) => ({
      x: Number(mark.x) || 0,
      y: Number(mark.y) || 0,
      width: Number(mark.width || mark.w) || 0,
      height: Number(mark.height || mark.h) || 0,
      label: clean(mark.label || mark.name, 100),
      confidence: Number(mark.confidence) || null,
    })) : state.marks;
    return update({
      phase: nextPhase,
      step: Number(step.step) || state.step,
      action: clean(step.action || step.phase || "Desktop action", 120),
      detail: clean(step.reasoning || step.error || step.detail || "", 500),
      target,
      cursor: target && target.x != null && target.y != null ? { x: target.x, y: target.y } : state.cursor,
      marks,
      reason: step.error ? clean(step.error, 500) : "",
    });
  }

  function pause(reason = "Paused by owner") {
    if (!state.active) return { ...state };
    return update({ phase: "paused", action: "Paused", detail: clean(reason), reason: clean(reason) });
  }

  function resume(reason = "Resumed by owner") {
    if (state.phase !== "paused") return { ...state };
    return update({ phase: "observing", action: "Resuming", detail: clean(reason), reason: "" });
  }

  function finish(phase, reason) {
    if (!new Set(["completed", "cancelled", "failed", "handed_back"]).has(phase)) throw new Error("Invalid desktop takeover terminal phase");
    return update({
      phase,
      action: phase === "completed" ? "Complete" : phase === "handed_back" ? "Control returned" : phase,
      detail: clean(reason, 500),
      reason: phase === "completed" ? "" : clean(reason, 500),
      target: null,
      marks: [],
      endedAt: clock().toISOString(),
    });
  }

  function controlState() {
    if (state.phase === "cancelled" || state.phase === "failed" || state.phase === "handed_back") return "cancelled";
    if (state.phase === "paused" || state.phase === "waiting_approval") return "paused";
    return "running";
  }

  function reset() {
    return update({
      sessionId: null, taskId: null, objective: "", mode: "idle", phase: "idle", active: false,
      paused: false, overlayVisible: false, step: 0, action: "", detail: "", target: null,
      cursor: null, marks: [], startedAt: null, endedAt: clock().toISOString(), reason: "",
    });
  }

  persist();
  return {
    start,
    observe,
    applyAgentStep,
    pause,
    resume,
    complete: (reason = "Desktop task completed and verified") => finish("completed", reason),
    cancel: (reason = "Cancelled by owner") => finish("cancelled", reason),
    fail: (reason = "Desktop task failed") => finish("failed", reason),
    handBack: (reason = "Control returned to owner") => finish("handed_back", reason),
    reset,
    controlState,
    status: () => ({ ...state }),
    statePath,
  };
}

module.exports = { ACTIVE_PHASES, createDesktopTakeoverService };
