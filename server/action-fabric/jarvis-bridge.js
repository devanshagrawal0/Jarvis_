"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TERMINAL = new Set(["delivered", "partial", "blocked", "failed", "cancelled"]);
const VISUAL_TOOLS = new Set([
  "screen_capture", "screen_inspect", "screen_act", "screen_analyze", "screen_locate",
  "desktop_control", "computer_use", "mouse_scroll", "open_url", "youtube_open_video",
]);
const BROWSER_ACTIONS = new Set([
  "browser_navigate", "browser_click", "browser_type", "browser_act", "browser_commit",
  "browser_login_handoff", "browser_wait",
]);

function short(value, max = 180) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function riskConsequence(risk) {
  if (risk === "commit") return 2;
  if (risk === "execute") return 1;
  return 0;
}

function effortFor(strength, route = {}) {
  if (strength === "full" || route.complexity === "deep" || route.deepResearch) return "deep";
  if (route.complexity === "instant") return "instant";
  return "normal";
}

function placementFor(prompt, tool) {
  const text = String(prompt || "").toLowerCase();
  if (/\b(in the background|background task|run (?:it|this) invisibly|without (?:opening|showing|flashing)|do not (?:open|show)|don'?t (?:open|show))\b/.test(text)) return "runtime";
  if (/\b(on|to) my screen\b|\bvisible screen\b|\bcurrent window\b|\bcontrol my cursor\b|\bshow me\b/.test(text)) return "visible";
  // computer_use owns both visible and headless surfaces; background/runtime is
  // its safe default. Low-level visual tools still belong on the visible desktop.
  if (tool === "computer_use") return "runtime";
  if (VISUAL_TOOLS.has(tool)) return "visible";
  return "runtime";
}

function isFile(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try { return fs.existsSync(value) && fs.statSync(value).isFile(); } catch { return false; }
}

function collectFiles(value, prefix = "result", found = [], seen = new Set()) {
  if (found.length >= 24 || value == null) return found;
  if (typeof value === "string") {
    if (isFile(value)) {
      const resolved = path.resolve(value);
      if (!seen.has(resolved)) { seen.add(resolved); found.push({ path: resolved, label: prefix }); }
    }
    return found;
  }
  if (typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.slice(0, 30).forEach((item, index) => collectFiles(item, `${prefix}[${index}]`, found, seen));
    return found;
  }
  for (const [key, item] of Object.entries(value)) collectFiles(item, `${prefix}.${key}`, found, seen);
  return found;
}

function isImageFile(filePath) {
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(path.extname(filePath).toLowerCase());
}

function safeJson(value, max = 4000) {
  try { return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "string" && item.length > 1200 ? `${item.slice(0, 1200)}…` : item).slice(0, max)); }
  catch { return { summary: short(value, 500) }; }
}

function createJarvisActionSession(options = {}) {
  const { fabric, capabilityEngine, runtimeDir, prompt, requestId, sessionId, deviceId, source, strength, route = {}, onEvent } = options;
  let task = null;
  let stepNumber = 0;
  let successes = 0;
  let failures = 0;
  let waitingApproval = false;

  const emitUi = (event) => { try { onEvent?.(event); } catch {} };
  const event = (type, payload = {}) => {
    if (!fabric || !task) return null;
    const saved = fabric.kernel.event(type, payload, task.id);
    emitUi({ kind: "runtime", status: type.endsWith("failed") ? "error" : type.includes("approval") ? "approval" : "running", label: type.replaceAll(".", " "), detail: short(payload.detail || payload.tool || payload.state || payload.reason || "", 240), taskId: task.id, eventSeq: saved.seq });
    return saved;
  };

  const transition = (state, payload = {}) => {
    if (!fabric || !task) return null;
    const current = fabric.kernel.get(task.id);
    if (current.state === state || TERMINAL.has(current.state)) return current;
    task = fabric.kernel.transition(task.id, state, payload);
    return task;
  };

  const ensureTask = (tool, definition) => {
    if (!fabric) return null;
    if (task) return task;
    const title = short(prompt, 92) || `${tool.replaceAll("_", " ")} task`;
    const consequence = riskConsequence(definition?.risk);
    task = fabric.createTask({
      requestId: `jarvis:${requestId}`,
      title,
      prompt,
      placement: placementFor(prompt, tool),
      effort: effortFor(strength, route),
      outcome: {
        description: prompt || title,
        successCriteria: ["Execute the requested real capability", "Record task-bound evidence", "Report only the verified outcome"],
        consequence,
        delivery: placementFor(prompt, tool),
      },
      metadata: { origin: "jarvis-chat", sessionId, deviceId, source, turnId: requestId, routeIntent: route.intent || null },
    });
    if (task.state === "queued") transition("planning", { currentStep: "Binding JARVIS turn to Action Fabric" });
    if (fabric.kernel.get(task.id).state === "planning") transition("ready", { currentStep: "Execution plan ready" });
    emitUi({ kind: "runtime", status: "running", label: "Runtime task created", detail: title, taskId: task.id });
    return task;
  };

  const attachFile = (file, tool, stepId, phase = "result") => {
    if (!task || !isFile(file.path)) return null;
    const image = isImageFile(file.path);
    const artifact = fabric.store.addArtifact({
      taskId: task.id,
      kind: image ? "frame" : "file",
      label: `${tool.replaceAll("_", " ")} · ${phase}`,
      uri: file.path,
      metadata: { tool, stepId, phase, sourceLabel: file.label, bytes: fs.statSync(file.path).size },
    });
    if (image) event("surface.frame", { tool, stepId, phase, artifactId: artifact.id, frameUrl: `/api/action/artifacts/${encodeURIComponent(artifact.id)}/content`, fileName: path.basename(file.path), placement: fabric.kernel.get(task.id).placement });
    else event("artifact.created", { tool, stepId, artifactId: artifact.id, label: artifact.label });
    return artifact;
  };

  const captureAfterAction = async (tool, context, stepId) => {
    if (!task || (!VISUAL_TOOLS.has(tool) && !BROWSER_ACTIONS.has(tool))) return null;
    // Autonomous browser tasks emit task-owned Playwright frames for every step.
    // A desktop capture here would be unrelated evidence when the task runs in background.
    if (tool === "computer_use") return null;
    const screenshotTool = BROWSER_ACTIONS.has(tool) ? "browser_screenshot" : "screen_capture";
    if (tool === "screen_capture" || tool === "browser_screenshot" || tool === "screen_act") return null;
    try {
      if (VISUAL_TOOLS.has(tool)) await new Promise((resolve) => setTimeout(resolve, 250));
      const shot = await capabilityEngine.execute(screenshotTool, screenshotTool === "browser_screenshot"
        ? { name: `runtime-${task.id}-${stepNumber}.png`, fullPage: false }
        : { reason: `Runtime evidence after ${tool}` }, context);
      if (shot.ok) {
        const files = collectFiles(shot.result, `${screenshotTool}.result`);
        files.forEach((file) => attachFile(file, tool, stepId, "after"));
        event("step.observed", { tool, stepId, observationTool: screenshotTool, detail: "Post-action frame captured" });
      }
      return shot;
    } catch (error) {
      event("step.observation_failed", { tool, stepId, reason: error.message });
      return null;
    }
  };

  const execute = async (tool, args = {}, context = {}) => {
    const definition = capabilityEngine.definitions?.find((item) => item.name === tool);
    ensureTask(tool, definition);
    const stepId = `turn-${String(requestId).slice(0, 12)}:${++stepNumber}:${tool}`;
    const current = fabric?.kernel.get(task.id);
    if (current && ["queued", "planning", "ready", "recovering"].includes(current.state)) transition("running", { currentStep: tool.replaceAll("_", " ") });
    event("step.started", { stepId, tool, args: safeJson(args, 2500), risk: definition?.risk || "observe", detail: `Executing ${tool}` });
    emitUi({ kind: "tool", status: "running", label: tool.replaceAll("_", " "), detail: "Action Fabric step started", tool, taskId: task?.id, stepId });
    const started = Date.now();
    let execution;
    try {
      const trackedContext = {
        ...context,
        actionTaskId: task?.id,
        actionStepId: stepId,
        controlState: () => {
          try { return fabric.kernel.get(task.id).state; } catch { return "cancelled"; }
        },
        onRuntimeActionStep: async (agentStep) => {
          const phase = agentStep.phase || "executed";
          event("agent.action", { stepId, tool, agentStep: agentStep.step, phase, mode: agentStep.mode, action: agentStep.action, target: agentStep.ref || agentStep.elementId || (agentStep.x != null ? { x:agentStep.x, y:agentStep.y } : null), detail: agentStep.reasoning || `${agentStep.action || "agent step"} ${phase}`, plannerModel: agentStep.model || agentStep.plannerTelemetry?.model || null, plannerLatencyMs: Number(agentStep.plannerLatencyMs || agentStep.plannerTelemetry?.latencyMs) || 0, plannerAttempts: agentStep.plannerAttempts || agentStep.plannerTelemetry?.attempts || [] });
          // Planned actions already have a structured Runtime event. Capturing the
          // unchanged page before every action doubled extension round-trips and
          // added several seconds per step. Capture the resulting state instead,
          // plus the exact approval boundary and final commit proof.
          if (!["executed", "failed", "waiting_approval", "committed", "done"].includes(phase)) return;
          const screenshotTool = agentStep.mode === "playwright" ? "browser_screenshot" : "screen_capture";
          try {
            const shot = await capabilityEngine.execute(screenshotTool, screenshotTool === "browser_screenshot"
              ? { taskId: agentStep.taskId, name:`runtime-${task.id}-agent-${agentStep.step}-${phase}.png`, fullPage:false }
              : { reason:`Runtime ${phase} frame for autonomous step ${agentStep.step}` }, { ...context, actionTaskId:task.id, actionStepId:stepId });
            if (shot.ok) collectFiles(shot.result, `${screenshotTool}.${phase}`).forEach((file)=>attachFile(file, tool, stepId, `${phase}-${agentStep.step}`));
          } catch (captureError) {
            event("agent.frame_failed", { stepId, agentStep:agentStep.step, phase, reason:captureError.message });
          }
        },
      };
      execution = await capabilityEngine.execute(tool, args, trackedContext);
    } catch (error) {
      execution = { ok: false, status: "failed", error: error.message || String(error), capability: definition };
    }

    if (execution.status === "confirmation_required") {
      waitingApproval = true;
      event("approval.capability_required", { stepId, tool, confirmationId: execution.confirmation?.id, summary: execution.confirmation?.summary, expiresAt: execution.confirmation?.expiresAt });
      transition("waiting_approval", { currentStep: `${tool.replaceAll("_", " ")} awaits owner approval`, metadata: { confirmationId: execution.confirmation?.id || null } });
      return execution;
    }

    const verified = Boolean(execution.ok && execution.receipt?.status === "verified");
    const receipt = fabric.store.addReceipt({
      taskId: task.id,
      stepId,
      status: verified ? "verified" : "failed",
      driver: `capability:${tool}`,
      target: { targetId: tool, capability: tool },
      proof: verified ? { method: "capability-receipt", providerObjectId: execution.receipt?.id || null, durationMs: Date.now() - started, result: safeJson(execution.result, 2600) } : {},
      error: verified ? null : { message: execution.error || "Capability did not return verified success", status: execution.status },
      idempotencyKey: `${task.id}:${stepId}`,
    });
    if (verified) successes += 1; else failures += 1;

    const files = collectFiles(execution.result);
    files.forEach((file) => attachFile(file, tool, stepId, file.label.includes("afterCapture") ? "after" : file.label.includes("beforeCapture") ? "before" : "result"));
    if (execution.ok) {
      if (context.deferVisualEvidence === true) void captureAfterAction(tool, context, stepId);
      else await captureAfterAction(tool, context, stepId);
    }
    event(verified ? "step.completed" : "step.failed", { stepId, tool, receiptId: receipt.id, durationMs: Date.now() - started, detail: verified ? "Verified capability result recorded" : execution.error || "Capability failed" });
    return execution;
  };

  const finalize = (completed = {}) => {
    if (!fabric || !task) return null;
    let current = fabric.kernel.get(task.id);
    if (TERMINAL.has(current.state)) return current;
    if (waitingApproval || completed.pendingConfirmations?.length) {
      if (current.state !== "waiting_approval") transition("waiting_approval", { currentStep: "Waiting for owner confirmation" });
      event("task.response_ready", { detail: "JARVIS response is ready; external action remains unexecuted pending confirmation" });
      return fabric.kernel.get(task.id);
    }
    if (failures > 0) {
      const state = successes > 0 ? "partial" : "failed";
      transition(state, { currentStep: state === "partial" ? "Completed with unverified or failed steps" : "Execution failed", reason: completed.error || "One or more real capability steps failed" });
      return fabric.kernel.get(task.id);
    }
    if (successes > 0) {
      if (current.state !== "running" && ["ready", "recovering"].includes(current.state)) transition("running", { currentStep: "Final verification" });
      current = fabric.kernel.get(task.id);
      if (current.state === "running") transition("verified", { currentStep: "All capability receipts verified", receiptCount: successes });
      current = fabric.kernel.get(task.id);
      if (current.state === "verified") task = fabric.kernel.deliver(task.id, { placement: current.placement, proof: fabric.store.receipts(task.id).at(-1)?.id || null });
      event("task.response_ready", { detail: short(completed.response, 500), model: completed.model || null });
    }
    return fabric.kernel.get(task.id);
  };

  return { execute, finalize, ensureTask, getTask: () => task && fabric.kernel.get(task.id), get taskId() { return task?.id || null; } };
}

module.exports = { createJarvisActionSession, collectFiles };
