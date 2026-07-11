// T13: Proactive Intelligence Engine — Jarvis initiates based on memory patterns.
// Runs background cycles to detect open loops, patterns, and anomalies.
// Writes daily briefs to runtime/neural_vault/hot/daily_brief.json.
// Uses existing VAPID push for morning notifications.

const fs = require("fs");
const path = require("path");

const BRIEF_PATH_SEGMENT = path.join("neural_vault", "hot", "daily_brief.json");
// Cycle intervals
const POST_SESSION_IDLE_MS = 30 * 60 * 1000;    // 30 min idle → post-session consolidation
const ANOMALY_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4h

function isoNow() { return new Date().toISOString(); }

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function safeReadJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function createProactiveIntelligence({ runtimeDir, neuralVault, sendPushNotification = null }) {
  const briefPath = path.join(runtimeDir, BRIEF_PATH_SEGMENT);
  let idleTimer = null;
  let anomalyTimer = null;
  let lastInteractionAt = Date.now();

  // ─── Post-session consolidation ─────────────────────────────────────────
  function consolidateSession() {
    if (!neuralVault) return null;
    try {
      // Find recent memories from last 2 hours and run maintenance
      const result = neuralVault.maintenanceRun();
      const brief = safeReadJson(briefPath, { events: [] });
      brief.lastConsolidation = isoNow();
      brief.consolidationResult = result;
      writeJsonAtomic(briefPath, brief);
      console.log("[proactive] Post-session consolidation complete");
      return result;
    } catch (e) {
      console.warn("[proactive] Consolidation error:", e.message);
      return null;
    }
  }

  // ─── Pattern detection ───────────────────────────────────────────────────
  function detectPatterns() {
    if (!neuralVault) return [];
    const alerts = [];
    try {
      const procedures = neuralVault.getProcedural(30);
      // Find high-signal preferences that should be surfaced
      const corePrefs = procedures.filter((p) =>
        p.kind === "preference" && p.metadata?.behavior_level === "core",
      );
      if (corePrefs.length) {
        alerts.push({
          type: "core_preference_active",
          message: `${corePrefs.length} core behavioral preferences are active`,
          count: corePrefs.length,
        });
      }
    } catch {}
    return alerts;
  }

  // ─── Daily brief generation ──────────────────────────────────────────────
  function generateDailyBrief() {
    const now = new Date();
    const patterns = detectPatterns();
    const brief = {
      generatedAt: isoNow(),
      date: now.toISOString().split("T")[0],
      patterns,
      unresolvedLoops: [],
      habitSuggestions: [],
      kalshiContext: null,
    };

    // Check for unresolved loop patterns in memories
    if (neuralVault) {
      try {
        const recentMemories = neuralVault.hybridSearch("todo will research follow up", { limit: 5 });
        brief.unresolvedLoops = recentMemories
          .filter((m) => /\b(will|plan to|going to|need to|should|follow up|research later)\b/i.test(m.content || ""))
          .slice(0, 3)
          .map((m) => ({ id: m.id, summary: m.summary || m.content?.slice(0, 120) }));
      } catch {}
    }

    writeJsonAtomic(briefPath, brief);
    return brief;
  }

  // ─── Anomaly detection ───────────────────────────────────────────────────
  function checkAnomalies() {
    // Simple stub: check if neural vault maintenance hasn't run recently
    const brief = safeReadJson(briefPath, {});
    const lastConsolidation = brief.lastConsolidation
      ? Date.now() - new Date(brief.lastConsolidation).getTime()
      : Infinity;
    const alerts = [];
    if (lastConsolidation > 24 * 60 * 60 * 1000) {
      alerts.push({ type: "stale_consolidation", message: "Memory consolidation hasn't run in over 24 hours" });
    }
    return alerts;
  }

  // ─── Morning push notification ───────────────────────────────────────────
  function sendMorningBrief() {
    const brief = generateDailyBrief();
    if (!sendPushNotification) return brief;
    try {
      const loops = brief.unresolvedLoops.length;
      const patterns = brief.patterns.length;
      const body = [
        loops ? `${loops} open loop${loops > 1 ? "s" : ""} from recent sessions` : null,
        patterns ? `${patterns} behavioral pattern${patterns > 1 ? "s" : ""} active` : null,
        "Jarvis is ready.",
      ].filter(Boolean).join(" · ");
      sendPushNotification({ title: "Good morning — Jarvis brief ready", body });
    } catch (e) {
      console.warn("[proactive] Push notification failed:", e.message);
    }
    return brief;
  }

  // ─── Touch interaction timestamp ────────────────────────────────────────
  function touch() {
    lastInteractionAt = Date.now();
    // Reset idle timer
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      console.log("[proactive] 30-min idle → consolidating session");
      consolidateSession();
    }, POST_SESSION_IDLE_MS);
  }

  // ─── Nightly cron check ──────────────────────────────────────────────────
  // Called from start() via a setInterval that checks hour every minute
  let cronTimer = null;
  let lastNightly = null;
  let lastMorning = null;
  function startCronChecker() {
    cronTimer = setInterval(() => {
      const now = new Date();
      const hour = now.getHours();
      const dateStr = now.toISOString().split("T")[0];
      // Midnight nightly brief
      if (hour === 0 && lastNightly !== dateStr) {
        lastNightly = dateStr;
        generateDailyBrief();
      }
      // 8am morning push
      if (hour === 8 && lastMorning !== dateStr) {
        lastMorning = dateStr;
        sendMorningBrief();
      }
    }, 60_000);
  }

  function start() {
    startCronChecker();
    anomalyTimer = setInterval(checkAnomalies, ANOMALY_CHECK_INTERVAL_MS);
    console.log("[proactive] Proactive intelligence engine started");
    // Generate initial brief if none exists
    if (!fs.existsSync(briefPath)) generateDailyBrief();
  }

  function stop() {
    clearInterval(cronTimer);
    clearInterval(anomalyTimer);
    clearTimeout(idleTimer);
  }

  function status() {
    const brief = safeReadJson(briefPath, null);
    return {
      ok: true,
      lastBriefAt: brief?.generatedAt || null,
      briefPath,
      idleTimeout: POST_SESSION_IDLE_MS / 1000 / 60 + "min",
      anomalyCheckInterval: ANOMALY_CHECK_INTERVAL_MS / 1000 / 60 + "min",
    };
  }

  return { start, stop, touch, generateDailyBrief, consolidateSession, checkAnomalies, status };
}

module.exports = { createProactiveIntelligence };
