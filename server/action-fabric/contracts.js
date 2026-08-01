"use strict";

const crypto = require("crypto");

const TASK_STATES = Object.freeze([
  "queued", "planning", "ready", "running", "waiting_approval", "waiting_owner",
  "paused", "recovering", "verified", "delivered", "partial", "blocked", "failed", "cancelled",
]);
const TERMINAL_STATES = new Set(["delivered", "partial", "blocked", "failed", "cancelled"]);
const CONSEQUENCE = Object.freeze({ READ: 0, REVERSIBLE: 1, EXTERNAL: 2, SENSITIVE: 3, IRREVERSIBLE: 4 });
const PLACEMENTS = Object.freeze(["background", "runtime", "visible", "owner"]);
const EFFORTS = Object.freeze(["instant", "normal", "deep"]);

function id(prefix = "af") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function now() { return new Date().toISOString(); }

function cleanText(value, max = 20_000) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, max);
}

function asJson(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function consequence(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 4) return value;
  const key = cleanText(value, 32).toUpperCase();
  return Object.prototype.hasOwnProperty.call(CONSEQUENCE, key) ? CONSEQUENCE[key] : CONSEQUENCE.READ;
}

function placement(value, fallback = "runtime") {
  const candidate = cleanText(value, 32).toLowerCase();
  return PLACEMENTS.includes(candidate) ? candidate : fallback;
}

function effort(value, fallback = "normal") {
  const candidate = cleanText(value, 32).toLowerCase();
  return EFFORTS.includes(candidate) ? candidate : fallback;
}

function normalizeOutcome(input = {}) {
  const outcome = typeof input === "string" ? { description: input } : { ...input };
  const description = cleanText(outcome.description || outcome.goal || outcome.intent, 8_000);
  if (!description) throw new Error("A concrete desired outcome is required.");
  return {
    description,
    successCriteria: Array.isArray(outcome.successCriteria)
      ? outcome.successCriteria.map((item) => cleanText(item, 2_000)).filter(Boolean).slice(0, 30)
      : [],
    delivery: placement(outcome.delivery || outcome.placement),
    consequence: consequence(outcome.consequence),
    constraints: asJson(outcome.constraints, {}),
  };
}

function normalizeTaskInput(input = {}) {
  const outcome = normalizeOutcome(input.outcome || input.prompt || input.intent || input.description);
  return {
    id: cleanText(input.id, 128) || id("task"),
    requestId: cleanText(input.requestId || input.commandId, 200) || id("request"),
    parentTaskId: cleanText(input.parentTaskId, 128) || null,
    title: cleanText(input.title, 240) || outcome.description.slice(0, 96),
    prompt: cleanText(input.prompt || outcome.description, 20_000),
    outcome,
    placement: placement(input.placement || outcome.delivery),
    effort: effort(input.effort),
    metadata: asJson(input.metadata, {}),
  };
}

function assertTransition(from, to) {
  if (!TASK_STATES.includes(to)) throw new Error(`Unknown task state: ${to}`);
  if (from === to) return;
  if (TERMINAL_STATES.has(from)) {
    const reopen = from === "failed" || from === "blocked" || from === "partial";
    if (!(reopen && ["queued", "recovering"].includes(to))) throw new Error(`Cannot transition terminal task ${from} -> ${to}`);
    return;
  }
  const allowed = {
    queued: ["planning", "ready", "running", "waiting_approval", "waiting_owner", "paused", "cancelled", "blocked", "failed"],
    planning: ["ready", "running", "waiting_approval", "waiting_owner", "paused", "blocked", "failed", "cancelled"],
    ready: ["running", "waiting_approval", "waiting_owner", "paused", "blocked", "cancelled"],
    running: ["waiting_approval", "waiting_owner", "paused", "recovering", "verified", "partial", "blocked", "failed", "cancelled"],
    waiting_approval: ["ready", "running", "paused", "blocked", "cancelled"],
    waiting_owner: ["ready", "running", "paused", "blocked", "cancelled"],
    paused: ["ready", "running", "cancelled", "blocked"],
    recovering: ["running", "verified", "partial", "blocked", "failed", "cancelled"],
    verified: ["delivered", "partial", "failed"],
  };
  if (!(allowed[from] || []).includes(to)) throw new Error(`Invalid task transition ${from} -> ${to}`);
}

function serializeError(error) {
  return { name: error?.name || "Error", message: cleanText(error?.message || error, 4_000), code: error?.code || null };
}

module.exports = {
  TASK_STATES, TERMINAL_STATES, CONSEQUENCE, PLACEMENTS, EFFORTS,
  id, now, cleanText, asJson, consequence, placement, effort,
  normalizeOutcome, normalizeTaskInput, assertTransition, serializeError,
};
