// ECLIPSE ↔ Jarvis app integration (go-live). A self-contained handler the main server delegates
// `/api/eclipse/*` (and `/eclipse`) to. It launches REAL missions in the background using the
// same Gemini key Cortex uses (secretStore) + real web tools, streams progress over SSE, and
// serves a Mission Forge console. Feature-flagged and cost-capped. Nothing here runs unless the
// server explicitly mounts it, so the rest of Jarvis is untouched when the flag is off.
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const registry = require("../../gemini-models");
const { openStore } = require("../orchestration/store");
const { streamMission } = require("../orchestration/events");
const { runMission } = require("../orchestration/run-graph");
const { createInteractionsClient } = require("../model/interactions-client");
const { createLiveWebTools } = require("../tools/web-live");
const { bridgeSummary, createJarvisToolbox } = require("../capabilities/jarvis-bridge");
const { createReputation } = require("../agents/reputation");
const { renderConsole } = require("./console");

function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = ""; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("body too large")); req.destroy(); } else data += c; });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on("error", reject);
  });
}
function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }

// deps: { runtimeDir, secretStore, loadSettings, maxCostUsd?, isEnabled?,
//         capabilityEngine?, contactStore?, neuralVault? }
//
// The last three are what make an Eclipse mission part of JARVIS rather than a stranger that
// happens to share the text box. Without them a mission gets web search and page fetch only: it
// cannot name a contact, cannot recall anything the owner has said, and cannot use any of the
// capabilities the rest of the assistant runs on. They are optional so Eclipse still boots if the
// main server has not finished constructing them — but the missing tools are reported rather than
// silently absent, because "Eclipse could not find your contact" and "Eclipse was never given
// contacts" are different problems with the same symptom.
function createEclipseIntegration(deps) {
  const runtimeDir = deps.runtimeDir || "runtime";
  const maxCostUsd = deps.maxCostUsd ?? 0.5;
  const missions = new Map();            // missionId → { status, result, error, startedAt, effort, prompt }
  let store = null, reputation = null;   // opened lazily on first use
  const artifactsDir = path.join(runtimeDir, "eclipse-artifacts");

  function enabled() { try { return deps.isEnabled ? deps.isEnabled() : (deps.loadSettings().eclipseEnabled !== false); } catch { return true; } }
  function ensureStore() { if (!store) { store = openStore({ dir: runtimeDir }); reputation = createReputation(store.db); } return store; }

  function liveWiring() {
    const key = process.env.GEMINI_API_KEY || deps.secretStore.load().geminiKey;
    if (!key) { const e = new Error("Gemini key is not configured"); e.statusCode = 412; throw e; }
    const s = deps.loadSettings();
    const flash = s.geminiModel || registry.MODELS.main;
    const pro = s.geminiReasoningModel || registry.MODELS.reasoning;
    registry.MODELS.main = flash; registry.MODELS.reasoning = pro; registry.MODELS.router = s.geminiRouterModel || flash;
    const ai = new GoogleGenAI({ apiKey: key });
    return { liveCall: createInteractionsClient({ getApiKey: () => key }).liveCall, web: createLiveWebTools({ ai, searchModel: flash }) };
  }

  async function launch({ prompt, effort = "deep" }) {
    ensureStore();
    const { liveCall, web } = liveWiring();
    const missionId = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const mission = { schemaVersion: "eclipse.mission.v1", missionId, userId: "dev", prompt: String(prompt || "").slice(0, 4000), effort, createdAt: new Date().toISOString(), constraints: { maxCostUsd, maxTokens: 250000, allowedPaths: [], privacy: "provider" } };
    const rec = { status: "running", result: null, error: null, startedAt: Date.now(), effort, prompt: mission.prompt };
    missions.set(missionId, rec);
    // The mission's own knowledge of the owner: contacts, memory, and the real capability engine.
    const jarvisTools = createJarvisToolbox({
      capabilityEngine: deps.capabilityEngine || null,
      contactStore: deps.contactStore || null,
      neuralVault: deps.neuralVault || null,
      sessionId: `eclipse:${missionId}`,
      deviceId: "eclipse",
    });
    // Record what this mission was actually given. A run that failed for lack of a tool should be
    // diagnosable from its own event log rather than by re-reading the server's wiring.
    try { store.appendEvent(missionId, "mission.tools", bridgeSummary(jarvisTools)); } catch { /* logging must not fail a launch */ }

    // Fire-and-forget: the SSE stream carries progress; POST returns immediately.
    runMission({ mission, store, dir: runtimeDir, mode: "live", liveCall, toolMode: "live", search: web.search, webFetch: web.fetchUrl, useFoundry: true, reputation, artifactsDir, jarvisTools })
      .then((r) => { rec.status = r.status; rec.result = summarize(r); })
      .catch((e) => { rec.status = "failed"; rec.error = String(e.message); try { store.appendEvent(missionId, "mission.failed", { error: rec.error }); } catch {} });
    return { missionId };
  }
  function summarize(r) {
    let evidence = [];
    try { evidence = store.db.prepare("SELECT DISTINCT uri FROM evidence_objects WHERE mission_id=?").all(r.graphRunId).map((x) => x.uri).filter(Boolean); } catch {}
    return {
      status: r.status,
      answer: r.state && r.state.result ? r.state.result.draft : null,
      validated: r.state ? (r.state.validated || []).length : 0,
      packets: r.state ? (r.state.packets || []).length : 0,
      tokens: r.ledger ? r.ledger.tokens : 0,
      costUsd: r.ledger ? Number((r.ledger.costUsd || 0).toFixed(4)) : 0,
      artifact: r.state && r.state.artifacts && r.state.artifacts[0] ? r.state.artifacts[0] : null,
      evidence,
    };
  }

  // Main entry the server delegates to. Returns true if handled.
  async function handle(req, res, url) {
    const p = url.pathname;
    if (p === "/eclipse" || p === "/eclipse/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(renderConsole()); return true; }
    if (!p.startsWith("/api/eclipse")) return false;
    if (!enabled()) { json(res, 403, { error: "Eclipse is disabled (settings.eclipseEnabled=false)" }); return true; }

    if (p === "/api/eclipse/health") { json(res, 200, { enabled: true, running: [...missions.values()].filter((m) => m.status === "running").length, total: missions.size, maxCostUsd }); return true; }

    if (p === "/api/eclipse/missions" && req.method === "POST") {
      try { const body = await readJsonBody(req); if (!body.prompt) return json(res, 400, { error: "prompt required" }); const out = await launch(body); json(res, 202, out); }
      catch (e) { json(res, e.statusCode || 500, { error: e.message }); }
      return true;
    }
    const m = p.match(/^\/api\/eclipse\/missions\/([^/]+)(\/stream)?$/);
    if (m) {
      const missionId = m[1];
      if (m[2] === "/stream") { ensureStore(); streamMission(req, res, { store, missionId }); return true; }
      const rec = missions.get(missionId);
      json(res, rec ? 200 : 404, rec ? { missionId, ...rec } : { error: "unknown mission" });
      return true;
    }
    json(res, 404, { error: "no such eclipse route" });
    return true;
  }

  return { handle, launch, enabled, _missions: missions };
}

module.exports = { createEclipseIntegration };
