"use strict";

// Structured tracing for the automation path.
//
// Why this exists: the whole automation stack (universal-browser-agent, browser-service,
// execution-lane-router, entity-resolver, navigation-memory, outcome-compiler, task-world-model)
// contained ZERO console output. When a real run failed, the only artefacts were screenshots and
// a receipt carrying a single sentence. Diagnosing a planner timeout required reading the source
// and inferring it from an AbortError message, because the planner already measured every attempt
// and then discarded the measurement.
//
// Everything here is a fact the code already had. Nothing is recomputed for logging.
//
// Enabled by default. Set JARVIS_AUTOMATION_TRACE=0 to silence.
//
// Deliberately NOT logged: page text, element values, message bodies, recipient identities beyond
// a length, and anything from an owner-authored field. A trace that leaks the content of a private
// DM into stdout is worse than no trace.

const ENABLED = process.env.JARVIS_AUTOMATION_TRACE !== "0";

const SECRET_KEY = /(?:token|secret|password|authorization|api[_-]?key|cookie|bearer)/i;

function scrub(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}…(${value.length})` : value;
  if (Array.isArray(value)) return depth > 2 ? `[${value.length} items]` : value.slice(0, 8).map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    if (depth > 2) return "{…}";
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) { out[k] = "[redacted]"; continue; }
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Emit one structured line. `scope` is the subsystem, `event` the thing that happened.
 * Never throws — a failure to trace must never fail a task.
 */
function trace(scope, event, data = {}) {
  if (!ENABLED) return;
  try {
    const payload = scrub(data);
    console.log(`[auto:${scope}] ${event} ${JSON.stringify(payload)}`);
  } catch { /* tracing must never break execution */ }
}

/** Millisecond timer that reads naturally at the call site. */
function since(startedAt) {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
}
function mark() {
  return process.hrtime.bigint();
}

module.exports = { trace, mark, since, TRACE_ENABLED: ENABLED };
