// Arbiter HTTP routes. Serves the edge feed + timeline the ArbiterRoom renders.
//
//   GET  /api/arbiter/edges     → { edges, stats, scannedAt }
//   GET  /api/arbiter/timeline  → { catalysts, stats, scannedAt }
//   GET  /api/arbiter/signals   → { signals, stats, scannedAt } (raw firehose)
//   POST /api/arbiter/scan      → force a fresh scan, returns full result
//
// Results are cached from the most recent scan; the scan job (or a first
// on-demand hit) populates it. Scans hit live Kalshi + Polymarket.

const { scorecard } = require("./arbiter-db");

let engineRef = null;
let scanning = false;
let lastScanAt = 0;
const MIN_SCAN_INTERVAL_MS = 60_000; // don't hammer upstream on rapid requests

function initArbiterRoutes({ engine }) {
  engineRef = engine;
}

async function ensureFresh({ force = false } = {}) {
  if (!engineRef) return null;
  const last = engineRef.getLast();
  const stale = !last.scannedAt || Date.now() - lastScanAt > MIN_SCAN_INTERVAL_MS;
  if ((force || stale) && !scanning) {
    scanning = true;
    try {
      await engineRef.scan();
      lastScanAt = Date.now();
    } catch (err) {
      console.error("[Arbiter] scan failed:", err && err.stack ? err.stack : err);
    } finally {
      scanning = false;
    }
  }
  return engineRef.getLast();
}

// Returns true if it handled the request.
async function handleArbiterRoute(req, res, { pathname, sendJson }) {
  if (!pathname.startsWith("/api/arbiter/")) return false;
  if (!engineRef) {
    sendJson(res, 503, { error: "Arbiter engine not initialized" });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/arbiter/edges") {
    const data = await ensureFresh();
    sendJson(res, 200, { edges: data.edges, stats: data.stats, scannedAt: data.scannedAt });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/arbiter/timeline") {
    const data = await ensureFresh();
    sendJson(res, 200, { catalysts: data.catalysts, stats: data.stats, scannedAt: data.scannedAt });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/arbiter/signals") {
    const data = await ensureFresh();
    sendJson(res, 200, { signals: data.signals || [], stats: data.stats, scannedAt: data.scannedAt });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/arbiter/scorecard") {
    sendJson(res, 200, scorecard());
    return true;
  }

  if (req.method === "POST" && pathname === "/api/arbiter/scan") {
    const data = await ensureFresh({ force: true });
    sendJson(res, 200, data);
    return true;
  }

  sendJson(res, 404, { error: "Unknown Arbiter route" });
  return true;
}

module.exports = { initArbiterRoutes, handleArbiterRoute };
